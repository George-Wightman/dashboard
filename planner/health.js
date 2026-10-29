// Google Health, for the planner's run: the cardio George's watch and apps log (a run in Strava, a
// ride the Pixel Watch spots) copied into the dashboard's `gym` map as `h:<id>` records, and the
// minutes they add to his cardio target. Read only. Hevy stays the source for the gym itself: its
// workouts also reach Google Health (as strength training, with no device), so anything that is
// strength, a walk, or overlaps a Hevy workout is left out, and two records of the same run (the
// watch and Strava both) count once.
//
// Google Health refuses Apps Script's own login, so this uses its own OAuth client: the planner
// script keeps HEALTH_CLIENT_ID, HEALTH_CLIENT_SECRET and HEALTH_REFRESH_TOKEN in its properties
// (copied from the Health test script that got the refresh token). A failure is kept as a sentence in
// the `health-status` record and never stops the planner.

import { gymConfig, cardioQuotaId, workouts } from '../js/gym.js';
import { addDays, weekStart, logicalDay } from '../js/dates.js';
import { plannedTaskDay } from '../js/plan-state.js';

export const HEALTH = 'https://health.googleapis.com/v4/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const LOOKBACK_DAYS = 7; // edits and late uploads (Strava syncs when it likes) inside a week follow
const PAGES = 10;
const MIN_MINUTES = 5; // shorter than this is the watch guessing, not a session
const HEVY_MARGIN_MS = 10 * 60000; // a Hevy workout's own record in Google Health can start a little apart
// Strength is Hevy's; walks are getting about, not training.
const LEFT_OUT = /STRENGTH|WEIGHT|WALK/i;

class HealthError extends Error {}

// An access token, from the cached one while it lasts, else from the refresh token.
async function accessToken(fetch, creds, cache, t) {
  const kept = cache.get();
  if (kept?.token && kept.expires > t.getTime() + 60000) return kept.token;
  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      // By hand: Apps Script has no URLSearchParams.
      body: Object.entries({
        refresh_token: creds.refreshToken, client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: 'refresh_token',
      }).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'),
    });
  } catch {
    throw new HealthError("Couldn't reach Google's sign-in");
  }
  let json = {};
  try { json = await res.json(); } catch { /* handled below */ }
  if (!res.ok || !json.access_token) {
    if (json.error === 'invalid_grant') throw new HealthError('Google Health signed out — run authorize in the Health test script again and copy the new refresh token');
    throw new HealthError(`Google's sign-in refused the planner (${json.error ?? res.status}) — check the HEALTH_ properties`);
  }
  cache.put({ token: json.access_token, expires: t.getTime() + (Number(json.expires_in) || 3000) * 1000 });
  return json.access_token;
}

async function healthGet(fetch, token, path) {
  let res;
  try {
    res = await fetch(`${HEALTH}${path}`, { headers: { Authorization: `Bearer ${token}`, accept: 'application/json' } });
  } catch {
    throw new HealthError("Couldn't reach Google Health");
  }
  if (res.status === 401 || res.status === 403) throw new HealthError('Google Health refused the planner — check the HEALTH_ properties');
  let json = null;
  try { json = await res.json(); } catch { /* handled below */ }
  return { status: res.status, ok: res.ok, json };
}

// Every exercise from `from` on. Asks Google to filter; if it won't take the filter, reads the
// newest pages and filters here.
async function listExercises(fetch, token, from) {
  const base = '/dataTypes/exercise/dataPoints?pageSize=25';
  const filter = `&filter=${encodeURIComponent(`exercise.interval.civil_start_time >= "${from}T00:00:00"`)}`;
  let filtered = true;
  const out = [];
  for (let page = 0, next = ''; page < PAGES; page++) {
    let r = await healthGet(fetch, token, `${base}${filtered ? filter : ''}${next ? `&pageToken=${encodeURIComponent(next)}` : ''}`);
    if (r.status === 400 && filtered && !next) {
      filtered = false;
      r = await healthGet(fetch, token, base);
    }
    if (!r.ok) throw new HealthError(`Couldn't read Google Health (it answered ${r.status})`);
    const points = r.json?.dataPoints;
    if (points != null && !Array.isArray(points)) throw new HealthError("Google Health's reply didn't make sense (dataPoints wasn't a list)");
    out.push(...(points ?? []));
    next = r.json?.nextPageToken ?? '';
    if (!next) return out;
  }
  // Ran out of pages: what's left is older or the same, and a partial list mustn't take records away.
  throw new HealthError('Google Health had more exercise than one run reads');
}

// One data point as the `gym` map keeps it, or null when it isn't a session with a start and end.
export function healthRecord(p, dayStartHour = 4) {
  const e = p?.exercise;
  const i = e?.interval;
  const start = Date.parse(i?.startTime);
  const end = Date.parse(i?.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const name = String(p.name ?? '');
  const healthId = (name.split('/').pop() || `${e.exerciseType ?? 'x'}-${start}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  if (!healthId) return null;
  return {
    kind: 'health',
    healthId,
    type: String(e.exerciseType ?? 'EXERCISE'),
    title: String(e.displayName ?? '').slice(0, 80),
    device: String(p.dataSource?.device?.displayName ?? p.dataSource?.application?.packageName ?? '').slice(0, 80),
    day: logicalDay(new Date(start), dayStartHour),
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    minutes: Math.round((end - start) / 60000),
  };
}

// "RUNNING" → "Run", "CARDIO_WORKOUT" → "Cardio workout".
export function healthLabel(rec) {
  if (rec.title) return rec.title;
  const words = { RUNNING: 'Run', BIKING: 'Ride', CYCLING: 'Ride', SWIMMING: 'Swim', HIKING: 'Hike' };
  const t = String(rec.type).toUpperCase();
  if (words[t]) return words[t];
  const s = t.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const healthRecords = (doc) => Object.values(doc?.gym ?? {}).filter((r) => String(r.id).startsWith('h:'));

// The minutes each record adds: the part of it no Hevy workout covers and no earlier record of the
// same stretch has already counted. { healthId: minutes }.
export function countedMinutes(doc) {
  const hevy = workouts(doc).map((w) => [Date.parse(w.start) - HEVY_MARGIN_MS, Date.parse(w.end) + HEVY_MARGIN_MS]);
  const list = healthRecords(doc)
    .filter((r) => r.status === 'active' && !LEFT_OUT.test(r.type))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.healthId < b.healthId ? -1 : 1));
  const counted = [];
  const out = {};
  for (const r of list) {
    const s = Date.parse(r.start), e = Date.parse(r.end);
    if (r.minutes < MIN_MINUTES || hevy.some(([hs, he]) => s < he && e > hs)) { out[r.healthId] = 0; continue; }
    // Walk the stretch, skipping what's already counted.
    let ms = 0, from = s;
    for (const [cs, ce] of [...counted].sort((a, b) => a[0] - b[0])) {
      if (ce <= from || cs >= e) continue;
      if (cs > from) ms += cs - from;
      from = Math.max(from, ce);
    }
    if (from < e) ms += e - from;
    counted.push([s, e]);
    out[r.healthId] = r.minutes >= MIN_MINUTES ? Math.round(ms / 60000) : 0;
  }
  return out;
}

// The run task a run on `day` ticks ("Easy run", "Long run"): one dated or booked that day, not yet
// ticked, first in his order; else a run habit not yet ticked that day (runs became 2× a week on 29
// Oct 2026). Hevy ticks the Gym; the watch's run used to reach only the cardio minutes, and the
// morning's Easy run sat unticked (27 Oct 2026).
const RUN_TASK = /\brun\b/i;
function runTask(doc, day) {
  const ticks = Object.values(doc.logs ?? {}).filter((l) => l.kind === 'done' && l.status === 'active');
  const ticked = new Set(ticks.map((l) => l.itemId));
  const tickedOn = new Set(ticks.filter((l) => l.day === day).map((l) => l.itemId));
  const first = (list) => list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : 1))[0] ?? null;
  const runs = Object.values(doc.items ?? {}).filter((i) => i.status === 'active' && RUN_TASK.test(i.title));
  return first(runs.filter((i) => i.type === 'task' && !ticked.has(i.id) && (i.date === day || plannedTaskDay(doc, i) === day)))
    ?? first(runs.filter((i) => i.type === 'habit' && !tickedOn.has(i.id) && (i.created ?? '') <= day));
}
const isRun = (r) => /RUN/i.test(r.type) || RUN_TASK.test(r.title);

// The minutes as logs on the cardio target, and a run's tick on its run task, made once each (fixed
// ids), following edits, taken off when the record goes — and never put back once George has taken
// one off.
function reconcile(store, startedOn) {
  const quotaId = cardioQuotaId(store.doc(), gymConfig(store.doc()));
  const minutes = countedMinutes(store.doc());
  for (const r of healthRecords(store.doc())) {
    const doneId = `health-done-${r.healthId}`;
    const tick = store.doc().logs[doneId];
    const ticks = r.status === 'active' && r.day >= startedOn && isRun(r) && (minutes[r.healthId] ?? 0) > 0;
    if (!tick) {
      const task = ticks ? runTask(store.doc(), r.day) : null;
      if (task) store.putLog(doneId, { itemId: task.id, kind: 'done', day: r.day, at: r.end, from: r.start, source: 'health' });
    } else if (tick.status === 'active') {
      store.putLog(doneId, ticks ? { day: r.day, at: r.end, from: r.start } : { status: 'archived' });
    }
    const id = `health-cardio-${r.healthId}`;
    const log = store.doc().logs[id];
    const amount = r.status === 'active' && r.day >= startedOn ? minutes[r.healthId] ?? 0 : 0;
    if (!log) {
      if (quotaId && amount > 0) {
        store.putLog(id, { itemId: quotaId, kind: 'amount', amount, day: r.day, at: r.end, note: `${healthLabel(r)} (Google Health)`, source: 'health' });
      }
    } else if (log.status === 'active') {
      store.putLog(id, amount > 0 ? { amount, day: r.day, at: r.end } : { status: 'archived' });
    }
  }
}

export function healthStatus(doc) {
  const s = doc?.gym?.['health-status'];
  return s && s.status === 'active' ? s : null;
}

// One check: the last week's exercise in, records Google no longer has taken out, minutes counted.
// `cache` keeps the access token between runs ({ get, put }). Returns the status as it now stands.
export async function syncHealth({
  fetch, creds, cache, store, now = () => new Date(), dayStartHour = 4, scrub = (s) => s,
}) {
  const t = now();
  const today = logicalDay(t, dayStartHour);
  const prev = healthStatus(store.doc());
  const status = {
    lastSync: prev?.lastSync ?? null,
    lastError: null,
    startedOn: prev?.startedOn ?? weekStart(today),
    count: prev?.count ?? 0,
  };
  try {
    const token = await accessToken(fetch, creds, cache, t);
    const from = [status.startedOn, addDays(today, -LOOKBACK_DAYS)].sort().pop();
    const seen = new Set();
    for (const p of await listExercises(fetch, token, from)) {
      const rec = healthRecord(p, dayStartHour);
      if (!rec || rec.day < from) continue;
      seen.add(rec.healthId);
      store.putGym(`h:${rec.healthId}`, rec, 'health');
    }
    // Inside the window, a record Google no longer lists was deleted there.
    for (const r of healthRecords(store.doc())) {
      if (r.status === 'active' && r.day >= from && !seen.has(r.healthId)) store.putGym(r.id, { status: 'archived', archivedOn: today }, 'health');
    }
    reconcile(store, status.startedOn);
    status.lastSync = t.toISOString();
  } catch (err) {
    status.lastError = scrub(err instanceof HealthError ? err.message : `Google Health sync stopped: ${err?.message ?? err}`);
  }
  status.count = healthRecords(store.doc()).filter((r) => r.status === 'active').length;
  store.putGym('health-status', status, 'health');
  return status;
}
