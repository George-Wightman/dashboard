// The coach's sessions into Hevy, for the planner's run: each session Claude wrote on a dated task
// (js/coach.js) for the coming 7 days becomes a routine in George's "Dashboard" folder, so he
// starts it in Hevy with the weights filled in. The only thing the planner ever writes to Hevy, and
// only in that folder. Hevy's API can't delete a routine, so they're a small pool: a routine whose
// session has passed or gone is rewritten for the next one. The pool is the `gym` record
// `routines`; a failure is a sentence in it and never stops the planner.

import { logicalDay, addDays, shortWeekday, shortDate } from '../js/dates.js';
import { templatesOf } from '../js/gym.js';
import { sessionTasks, routinesOf, routineBody } from '../js/coach.js';
import { doneIndex } from '../js/schedule.js';
import { HEVY } from './hevy.js';

export const FOLDER = 'Dashboard';
const WINDOW_DAYS = 7;
const FOLDER_PAGES = 10;

class HevyError extends Error {}

async function call(fetch, key, method, path, body) {
  let res;
  try {
    res = await fetch(`${HEVY}${path}`, {
      method,
      headers: { 'api-key': key, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new HevyError("Couldn't reach Hevy");
  }
  if (res.status === 401 || res.status === 403) throw new HevyError("Hevy refused the key — check HEVY_KEY in the planner script's properties");
  let data = null;
  try { data = await res.json(); } catch { /* answered without JSON */ }
  if (!res.ok) {
    const said = typeof data?.error === 'string' ? `: ${data.error.slice(0, 200)}` : '';
    const err = new HevyError(`it answered ${res.status}${said}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Hevy answers a routine write with { routine: [ {...} ] } (a list of one), a folder with
// { routine_folder: {...} }; either may come as a bare object.
const first = (v) => (Array.isArray(v) ? v[0] : v);

export const routineTitle = (session, day) => `${session.name} · ${shortWeekday(day)} ${shortDate(day)}`;

// A short fingerprint of what Hevy was last sent for a routine, so an unchanged session isn't sent again.
function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Routines in the folder the pool doesn't know: ones Hevy made when its reply never reached the
// planner (a timeout), or after the pool failed to save. Taken back in, so nothing piles up.
async function strays(fetch, key, folderId, known) {
  const out = [];
  for (let page = 1, count = 1; page <= count && page <= FOLDER_PAGES; page++) {
    const r = await call(fetch, key, 'GET', `/routines?page=${page}&pageSize=10`);
    for (const x of r?.routines ?? []) if (x?.id != null && x.folder_id === folderId && !known.has(String(x.id))) out.push(String(x.id));
    count = Math.max(0, Math.floor(Number(r?.page_count) || 0));
  }
  return out;
}

async function findFolder(fetch, key) {
  for (let page = 1, count = 1; page <= count && page <= FOLDER_PAGES; page++) {
    const r = await call(fetch, key, 'GET', `/routine_folders?page=${page}&pageSize=10`);
    const hit = (r?.routine_folders ?? []).find((f) => String(f?.title ?? '').trim() === FOLDER);
    if (hit) return hit.id;
    count = Math.max(0, Math.floor(Number(r?.page_count) || 0));
  }
  const made = first((await call(fetch, key, 'POST', '/routine_folders', { routine_folder: { title: FOLDER } }))?.routine_folder);
  if (made?.id == null) throw new HevyError("Hevy's reply to making the Dashboard folder didn't make sense");
  return made.id;
}

// One run. Returns the pool as it now stands.
export async function syncRoutines({ fetch, key, store, now = () => new Date(), dayStartHour = 4, scrub = (s) => s }) {
  const today = logicalDay(now(), dayStartHour);
  const doc = store.doc();
  const prev = routinesOf(doc);
  const state = { folderId: prev.folderId ?? null, byRoutine: structuredClone(prev.byRoutine ?? {}), lastError: null };
  const idx = doneIndex(doc);
  const sessions = sessionTasks(doc, today, addDays(today, WINDOW_DAYS - 1)).filter((t) => !idx.get(t.id)?.has(t.date));
  if (!sessions.length && prev.lastError == null) return prev;
  const templates = templatesOf(doc);
  const problems = [];
  const wanted = new Set(sessions.map((t) => t.id));
  const held = (taskId) => Object.keys(state.byRoutine).find((id) => state.byRoutine[id]?.taskId === taskId);
  const spare = Object.keys(state.byRoutine).filter((id) => !wanted.has(state.byRoutine[id]?.taskId));
  let looked = false;
  try {
    for (const t of sessions) {
      const label = `${JSON.stringify(t.session.name)} (${shortWeekday(t.date)} ${shortDate(t.date)})`;
      const missing = t.session.exercises.filter((e) => !templates[e.tpl]);
      if (missing.length) {
        problems.push(`${label}: ${missing.map((e) => e.name).join(', ')} isn't in Hevy's exercise list any more — write the session again`);
        continue;
      }
      const body = routineBody(t.session, { title: routineTitle(t.session, t.date) });
      const sig = hash(JSON.stringify(body));
      let id = held(t.id);
      if (id && state.byRoutine[id].hash === sig && state.byRoutine[id].day === t.date) continue;
      try {
        if (!id && !spare.length && !looked) {
          looked = true;
          if (state.folderId == null) state.folderId = await findFolder(fetch, key);
          for (const stray of await strays(fetch, key, state.folderId, new Set(Object.keys(state.byRoutine)))) {
            state.byRoutine[stray] = { taskId: null, day: null, hash: null };
            spare.push(stray);
          }
        }
        if (!id && spare.length) id = spare.shift();
        if (id) {
          await call(fetch, key, 'PUT', `/routines/${encodeURIComponent(id)}`, body);
        } else {
          if (state.folderId == null) state.folderId = await findFolder(fetch, key);
          const made = first((await call(fetch, key, 'POST', '/routines', routineBody(t.session, { title: body.routine.title, folderId: state.folderId })))?.routine);
          if (typeof made?.id !== 'string' && typeof made?.id !== 'number') throw new HevyError("Hevy's reply to a new routine didn't make sense");
          id = String(made.id);
        }
      } catch (e) {
        // A routine Hevy no longer has (he deleted it in the app) is forgotten, and made again next run.
        if (e.status === 404 && id) delete state.byRoutine[id];
        // A new routine refused: the folder may be gone (deleted in the app), so look it up again next run.
        if (e.status && !id) state.folderId = null;
        if (e instanceof HevyError && e.status) { problems.push(`Hevy wouldn't take the routine for ${label} (${e.message})`); continue; }
        throw e;
      }
      state.byRoutine[id] = { taskId: t.id, day: t.date, hash: sig };
    }
  } catch (err) {
    problems.push(err instanceof HevyError ? err.message : `Putting sessions into Hevy stopped: ${err?.message ?? err}`);
  }
  state.lastError = problems.length ? scrub(problems.join('; ')) : null;
  store.putGym('routines', state, 'planner');
  return state;
}
