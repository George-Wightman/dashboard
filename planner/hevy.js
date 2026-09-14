// Hevy, for the planner's run: George's workouts copied into the dashboard's `gym` map, and the
// ticks and cardio minutes they give. Read only — nothing is ever sent to Hevy but the key, in its
// header. `fetch` is the app's (in Apps Script, planner/shims.js's, over UrlFetchApp). A failure is
// kept as a sentence in the gym's status for the dashboard and never stops the planner.

import {
  workoutRecord, workouts, gymConfig, gymStatus, templatesOf, gymHabitId, cardioQuotaId, cardioOf, KEEP_SETS_DAYS,
} from '../js/gym.js';
import { addDays, weekStart, logicalDay } from '../js/dates.js';
import { countsOn } from '../js/schedule.js';

export const HEVY = 'https://api.hevyapp.com/v1';
export const BACKFILL_PAGES = 20; // pages of history a run, inside Apps Script's time limit
const TEMPLATE_PAGES = 30;
const OVERLAP_MS = 5 * 60000; // events are asked for from a little before the last check
const QUIET_MS = 55 * 60000; // a check that found nothing is recorded at most hourly

class HevyError extends Error {}
const nonsense = () => new HevyError("Hevy's reply didn't make sense");
const pageCount = (r) => Math.max(0, Math.floor(Number(r?.page_count) || 0));

// One GET. A 404 is a page past the end (null); anything else that isn't a 200 is a HevyError.
async function hevyGet(fetch, key, path) {
  let res;
  try {
    res = await fetch(`${HEVY}${path}`, { headers: { 'api-key': key, accept: 'application/json' } });
  } catch {
    throw new HevyError("Couldn't reach Hevy");
  }
  if (res.status === 401 || res.status === 403) throw new HevyError("Hevy refused the key — check HEVY_KEY in the planner script's properties");
  if (res.status === 404) return null;
  if (!res.ok) throw new HevyError(`Couldn't reach Hevy (it answered ${res.status})`);
  try {
    return await res.json();
  } catch {
    throw nonsense();
  }
}

// A workout Hevy says was deleted: archived, if the dashboard has it.
function drop(store, hevyId, today) {
  const rec = store.doc().gym[`w:${hevyId}`];
  if (rec?.status === 'active') store.putGym(rec.id, { status: 'archived', archivedOn: today });
}

// The ticks and cardio minutes every workout gives, made once each (fixed ids), following edits,
// taken off when the workout goes — and never put back once George has taken one off. Old
// workouts lose their sets.
function reconcile(store, startedOn, today) {
  const config = gymConfig(store.doc());
  const habitId = gymHabitId(store.doc(), config);
  const quotaId = cardioQuotaId(store.doc(), config);
  const cutoff = addDays(today, -KEEP_SETS_DAYS);
  const all = Object.values(store.doc().gym).filter((r) => String(r.id).startsWith('w:'));
  for (const w of all) {
    const doneId = `hevy-done-${w.hevyId}`;
    const cardioId = `hevy-cardio-${w.hevyId}`;
    const logs = store.doc().logs;
    if (w.status !== 'active') {
      for (const id of [doneId, cardioId]) if (logs[id]?.status === 'active') store.putLog(id, { status: 'archived' });
      continue;
    }
    if (w.day < cutoff && w.exercises.some((e) => e.sets)) store.putGym(w.id, { exercises: w.exercises.map(({ sets, ...e }) => e) });
    if (w.day < startedOn) continue;
    const habit = habitId ? store.doc().items[habitId] : null;
    if (habit && countsOn(habit, w.day)) {
      const tick = logs[doneId];
      if (!tick) store.putLog(doneId, { itemId: habitId, kind: 'done', day: w.day, at: w.end, from: w.start, source: 'hevy' });
      else if (tick.status === 'active') store.putLog(doneId, { day: w.day, at: w.end, from: w.start });
    }
    const minutes = Math.round(cardioOf(w).minutes);
    const cardio = logs[cardioId];
    if (!cardio) {
      if (quotaId && minutes > 0) {
        store.putLog(cardioId, { itemId: quotaId, kind: 'amount', amount: minutes, day: w.day, at: w.end, note: w.title, source: 'hevy' });
      }
    } else if (cardio.status === 'active') {
      store.putLog(cardioId, minutes > 0 ? { amount: minutes, day: w.day, at: w.end } : { status: 'archived' });
    }
  }
}

// One check. The first runs copy the whole history, `pages` a run; after that only what changed
// since the last check. Returns the gym's status as it now stands.
export async function syncHevy({
  fetch, key, store, now = () => new Date(), dayStartHour = 4, pages = BACKFILL_PAGES, scrub = (s) => s,
}) {
  const t = now();
  const today = logicalDay(t, dayStartHour);
  const prev = gymStatus(store.doc());
  const status = {
    lastSync: prev?.lastSync ?? null,
    lastError: null,
    since: prev?.since ?? t.toISOString(),
    backfillPage: prev ? prev.backfillPage ?? null : 1,
    startedOn: prev?.startedOn ?? weekStart(today),
    count: prev?.count ?? 0,
  };
  const backfilling = status.backfillPage != null;
  let writes = 0;
  const unsubscribe = store.subscribe((reason) => { if (reason === 'local') writes++; });
  try {
    let templates = templatesOf(store.doc());
    let refreshed = false;
    const loadTemplates = async () => {
      const list = {};
      for (let page = 1, count = 1; page <= count && page <= TEMPLATE_PAGES; page++) {
        const r = await hevyGet(fetch, key, `/exercise_templates?page=${page}&pageSize=100`);
        if (r == null) break;
        if (!Array.isArray(r.exercise_templates)) throw nonsense();
        for (const x of r.exercise_templates) {
          if (x && typeof x.id === 'string') list[x.id] = [String(x.title ?? ''), String(x.type ?? ''), String(x.primary_muscle_group ?? '')];
        }
        count = pageCount(r);
      }
      templates = list;
      refreshed = true;
      store.putGym('templates', { list });
    };
    if (!Object.keys(templates).length) await loadTemplates();
    const { keyLifts } = gymConfig(store.doc());
    const upsert = async (w) => {
      if (!refreshed && (w?.exercises ?? []).some((e) => !templates[e?.exercise_template_id])) await loadTemplates();
      let rec;
      try {
        rec = workoutRecord(w, templates, keyLifts, dayStartHour);
      } catch {
        throw nonsense();
      }
      store.putGym(`w:${rec.hevyId}`, rec);
    };

    if (backfilling) {
      let page = status.backfillPage;
      for (let n = 0; n < pages && page != null; n++) {
        const r = await hevyGet(fetch, key, `/workouts?page=${page}&pageSize=10`);
        if (r == null) { page = null; break; }
        if (!Array.isArray(r.workouts)) throw nonsense();
        for (const w of r.workouts) await upsert(w);
        page = page >= pageCount(r) ? null : page + 1;
      }
      status.backfillPage = page;
    } else {
      const since = new Date(Date.parse(status.since) - OVERLAP_MS).toISOString();
      for (let page = 1, count = 1; page <= count; page++) {
        const r = await hevyGet(fetch, key, `/workouts/events?page=${page}&pageSize=10&since=${encodeURIComponent(since)}`);
        if (r == null) break;
        if (!Array.isArray(r.events)) throw nonsense();
        for (const e of r.events) {
          if (e?.type === 'updated' && e.workout) await upsert(e.workout);
          else if (e?.type === 'deleted' && typeof e.id === 'string') drop(store, e.id, today);
        }
        count = pageCount(r);
      }
    }
    reconcile(store, status.startedOn, today);
  } catch (err) {
    status.lastError = scrub(err instanceof HevyError ? err.message : `Hevy sync stopped: ${err?.message ?? err}`);
  } finally {
    unsubscribe();
  }

  // A check that found nothing writes nothing, so the dashboard isn't pushed every ten minutes: the
  // status moves on when something came in, when a problem starts or ends, and at least hourly.
  const quiet = prev && !writes && !status.lastError && !prev.lastError && !backfilling
    && prev.lastSync && t.getTime() - Date.parse(prev.lastSync) < QUIET_MS;
  if (quiet) return prev;
  if (!status.lastError) {
    status.lastSync = t.toISOString();
    if (!backfilling) status.since = t.toISOString();
  }
  status.count = workouts(store.doc()).length;
  store.putGym('status', status);
  return status;
}
