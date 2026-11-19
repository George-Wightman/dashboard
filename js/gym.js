// The gym, from Hevy. planner/hevy.js copies George's workouts into the `gym` map (records
// `w:<hevy id>`, plus `templates`, `status` and Claude's `config`); this works out what the
// dashboard and Claude show from them — estimated 1RMs, PRs, pace and projections for
// his key lifts, cardio minutes, and each day's sessions in a line. Pure: a document and a day in.

import { addDays, weekStart, shortWeekday, logicalDay, daysBetween } from './dates.js';
import { weekTotal } from './schedule.js';

export const GYM_DEFAULTS = Object.freeze({
  keyLifts: Object.freeze(['Squat (Barbell)', 'Bench Press (Barbell)']), liftTargets: Object.freeze({}), cardioQuota: null, habit: 'Gym',
});
export const KEEP_SETS_DAYS = 400; // after this a workout keeps its summary and drops its sets
// How a workout record is worked out from Hevy's. 2 (20 Nov 2026): bodyweight exercises keep their
// reps, and holds (planks, L-sits) their seconds, instead of holds counting as cardio minutes and
// pull-ups and dips as nothing at all. planner/hevy.js copies the history again when this moves.
export const RECORD_SHAPE = 2;
export const KEY_LIFTS_SHOWN = 2; // key lifts on the Body tile and in Claude's read
export const KEY_LIFT_DAYS = 28; // "what he's training now" looks back four weeks …
const KEY_LIFT_HALF_LIFE = 7; // … the most recent sessions counting most
const PACE_DAYS = 56; // pace is fitted over the last 8 weeks …
const PACE_MIN = 4; // … and only with this many sessions in them
const SPARK = 12; // session bests in a lift's sparkline
// Hevy's exercise types. Cardio is moving for time or distance; a duration exercise on a muscle (a
// plank, an L-sit, a dead hang) is a hold, not cardio. Bodyweight ones count reps.
const CARDIO_TYPES = new Set(['distance_duration', 'floors_duration', 'steps_duration']);
const REPS_TYPES = new Set(['reps_only', 'bodyweight_reps', 'bodyweight_weighted', 'bodyweight_assisted', 'bodyweight_assisted_reps']);
// Everything that is strength work, for "lifted" on the week strip and the year grid.
export const STRENGTH_KINDS = Object.freeze(['lift', 'reps', 'hold']);
const strength = (e) => STRENGTH_KINDS.includes(e?.kind);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const values = (map) => Object.values(map ?? {});
const norm = (s) => String(s ?? '').trim().toLowerCase();
const round1 = (n) => Math.round(n * 10) / 10;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sameLift = (a, b) => norm(a) === norm(b);

// Kilograms as George reads them: to the nearest half, without a trailing ".0".
export const half = (n) => Math.round(n * 2) / 2;
export const kgText = (n) => (Number.isInteger(half(n)) ? String(half(n)) : half(n).toFixed(1));

// 'Squat (Barbell)' → 'Squat'.
export const shortLift = (name) => String(name ?? '').replace(/\s*\((barbell|dumbbell|machine|smith machine|cable)\)\s*$/i, '').trim();

// Estimated one-rep max (Epley), from a set of 1–12 reps; null for anything else.
export function e1rm(kg, reps) {
  const w = Number(kg);
  const r = Number(reps);
  return w > 0 && Number.isFinite(r) && r >= 1 && r <= 12 ? w * (1 + r / 30) : null;
}

// ---- Settings and status ------------------------------------------------------------------------

// Claude's settings (the `gym` op), with the defaults for anything unset or unreadable.
export function gymConfig(doc) {
  const c = doc?.gym?.config;
  const live = c && c.status === 'active' ? c : {};
  const lifts = Array.isArray(live.keyLifts) ? live.keyLifts.filter((l) => typeof l === 'string' && l.trim()).map((l) => l.trim()) : null;
  const targets = live.liftTargets && typeof live.liftTargets === 'object' && !Array.isArray(live.liftTargets) ? live.liftTargets : {};
  return {
    keyLifts: lifts?.length ? lifts : [...GYM_DEFAULTS.keyLifts],
    liftTargets: Object.fromEntries(Object.entries(targets).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])),
    cardioQuota: typeof live.cardioQuota === 'string' && live.cardioQuota ? live.cardioQuota : null,
    habit: typeof live.habit === 'string' && live.habit.trim() ? live.habit.trim() : GYM_DEFAULTS.habit,
  };
}

export function gymStatus(doc) {
  const s = doc?.gym?.status;
  return s && s.status === 'active' ? s : null;
}

// Hevy's exercise templates as the script keeps them: { id: [title, type, primary muscle] }.
export function templatesOf(doc) {
  const t = doc?.gym?.templates;
  return t && t.status === 'active' && t.list && typeof t.list === 'object' ? t.list : {};
}

// The habit Hevy ticks: by id, or the one active habit whose title starts with the setting.
export function gymHabitId(doc, config = gymConfig(doc)) {
  const habits = values(doc?.items).filter((i) => i.type === 'habit' && i.status === 'active');
  const byId = habits.filter((h) => h.id === config.habit);
  const hits = byId.length ? byId : habits.filter((h) => norm(h.title).startsWith(norm(config.habit)));
  return hits.length === 1 ? hits[0].id : null;
}

// The weekly target cardio minutes count towards (a live one, measured in minutes), or null.
export function cardioQuotaId(doc, config = gymConfig(doc)) {
  if (!config.cardioQuota) return null;
  const q = doc?.items?.[config.cardioQuota];
  return q && q.type === 'quota' && q.status === 'active' && q.unit === 'minutes' ? q.id : null;
}

// ---- A workout from Hevy -----------------------------------------------------------------------

export function exerciseKind(tpl, sets = []) {
  const [, type, muscle] = Array.isArray(tpl) ? tpl : [];
  if (CARDIO_TYPES.has(type) || muscle === 'cardio') return 'cardio';
  if (type === 'duration') return 'hold';
  if (type === 'weight_reps') return 'lift';
  if (REPS_TYPES.has(type)) return 'reps';
  if (!tpl) {
    if (sets.some((s) => Number(s?.weight_kg) > 0 && Number(s?.reps) > 0)) return 'lift';
    // Without its template a timed set is cardio, as it always was: a template that says it's a hold
    // is the only way to know (the planner reloads them when one is missing).
    if (sets.some((s) => Number(s?.duration_seconds) > 0 || Number(s?.distance_meters) > 0)) return 'cardio';
    if (sets.some((s) => Number(s?.reps) > 0)) return 'reps';
  }
  return 'other';
}

function exerciseRecord(ex, templates, keyLifts, allSets = false) {
  const all = Array.isArray(ex?.sets) ? ex.sets : [];
  const working = all.filter((s) => s?.type !== 'warmup');
  const tpl = String(ex?.exercise_template_id ?? '');
  const name = String(ex?.title ?? '').trim() || templates[tpl]?.[0] || 'Exercise';
  const kind = exerciseKind(templates[tpl], all);
  const out = { name, tpl, kind, n: working.length };
  if (kind === 'cardio') {
    // A cardio "warm-up" is still cardio, so every set counts.
    out.minutes = round1(all.reduce((sum, s) => sum + (Number(s?.duration_seconds) || 0), 0) / 60);
    out.km = Math.round(all.reduce((sum, s) => sum + (Number(s?.distance_meters) || 0), 0) / 10) / 100;
    return out;
  }
  const keep = (kind !== 'other' && allSets) || keyLifts.some((l) => sameLift(l, name));
  if (kind === 'hold') {
    // The longest hold, and every hold's seconds.
    const secs = working.map((s) => Math.round(Number(s?.duration_seconds) || 0)).filter((n) => n > 0);
    if (secs.length) { out.sec = Math.max(...secs); out.secs = secs.reduce((a, b) => a + b, 0); }
    if (keep && secs.length) out.sets = secs.map((n) => [0, n, null]);
    return out;
  }
  if (kind === 'reps') {
    // The set with the most reps (the heavier on a tie: kg is weight added, or taken off when assisted).
    let top = null;
    let reps = 0;
    for (const st of working) {
      const r = Number(st?.reps) || 0;
      const kg = Number(st?.weight_kg) || 0;
      reps += r;
      if (r > 0 && (!top || r > top[1] || (r === top[1] && kg > top[0]))) top = [kg, r];
    }
    if (top) { out.best = top; out.top = top[1]; out.reps = reps; }
    if (keep) out.sets = working.map((st) => [Number(st?.weight_kg) || 0, Number(st?.reps) || 0, st?.rpe ?? null]);
    return out;
  }
  let best = null;
  let volume = 0;
  for (const s of working) {
    const kg = Number(s?.weight_kg) || 0;
    const reps = Number(s?.reps) || 0;
    volume += kg * reps;
    const e = e1rm(kg, reps);
    if (e != null && (!best || e > best.e)) best = { kg, reps, e };
  }
  if (best) {
    out.best = [best.kg, best.reps];
    out.e1rm = round1(best.e);
  }
  if (volume) out.volume = Math.round(volume);
  // Sets are kept for the key lifts, and for every lift of a workout from a routine (the coach's
  // sessions are routines; js/coach.js readyMarks reads them).
  if ((kind === 'lift' && allSets) || keyLifts.some((l) => sameLift(l, name))) {
    out.sets = working.map((s) => [Number(s?.weight_kg) || 0, Number(s?.reps) || 0, s?.rpe ?? null]);
  }
  return out;
}

// One of Hevy's workout objects as the `gym` map keeps it. Throws on anything that isn't one.
export function workoutRecord(w, templates = {}, keyLifts = GYM_DEFAULTS.keyLifts, dayStartHour = 4) {
  const start = Date.parse(w?.start_time ?? '');
  const end = Date.parse(w?.end_time ?? '');
  if (typeof w?.id !== 'string' || !w.id || !Number.isFinite(start) || !Array.isArray(w.exercises)) {
    throw new Error("Hevy's reply didn't make sense");
  }
  const finish = Number.isFinite(end) && end >= start ? end : start;
  return {
    hevyId: w.id,
    title: String(w.title ?? '').trim() || 'Workout',
    day: logicalDay(new Date(start), dayStartHour),
    start: new Date(start).toISOString(),
    end: new Date(finish).toISOString(),
    minutes: Math.round((finish - start) / 60000),
    routineId: typeof w.routine_id === 'string' && w.routine_id ? w.routine_id : null,
    exercises: w.exercises.map((ex) => exerciseRecord(ex, templates, keyLifts, !!w.routine_id)),
    shape: RECORD_SHAPE,
  };
}

// ---- Reading the workouts ----------------------------------------------------------------------

export function workouts(doc) {
  return values(doc?.gym)
    .filter((r) => r.status === 'active' && String(r.id).startsWith('w:'))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

export const workoutsOn = (doc, day) => workouts(doc).filter((w) => w.day === day);

export function cardioOf(w) {
  let minutes = 0;
  let km = 0;
  for (const e of w?.exercises ?? []) {
    if (e.kind !== 'cardio') continue;
    minutes += Number(e.minutes) || 0;
    km += Number(e.km) || 0;
  }
  return { minutes: round1(minutes), km: Math.round(km * 100) / 100 };
}

// Every session with the lift in it, oldest first: its best estimated 1RM, that set, and the
// working sets (when kept).
export function liftSessions(doc, lift) {
  const out = [];
  for (const w of workouts(doc)) {
    let top = null;
    const sets = [];
    for (const e of w.exercises ?? []) {
      if (!sameLift(e.name, lift) || e.e1rm == null) continue;
      if (!top || e.e1rm > top.e1rm) top = e;
      if (Array.isArray(e.sets)) sets.push(...e.sets);
    }
    if (top) out.push({ day: w.day, hevyId: w.hevyId, e1rm: top.e1rm, best: top.best, sets });
  }
  return out;
}

// The number an exercise is measured by in a session: the estimated 1RM for a lift, the most reps in a
// set for a bodyweight one, the longest hold for a hold. Null when the record has none (records from
// before RECORD_SHAPE 2 kept nothing for bodyweight work).
export function measureOf(e) {
  if (e?.kind === 'reps') return Number(e.top) > 0 ? { value: Number(e.top), unit: 'reps' } : null;
  if (e?.kind === 'hold') return Number(e.sec) > 0 ? { value: Number(e.sec), unit: 's' } : null;
  return e?.e1rm != null && Number.isFinite(Number(e.e1rm)) ? { value: Number(e.e1rm), unit: 'kg' } : null;
}

// A value in its unit, as he reads it: '124 kg', '12 reps', '45 s', '1:20'.
export function measureText(value, unit) {
  if (unit === 'kg') return `${kgText(value)} kg`;
  if (unit === 'reps') return plural(Math.round(value), 'rep');
  if (unit === 's') return value >= 60 ? `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, '0')}` : `${Math.round(value)} s`;
  return String(value);
}

// The best set behind a session's number: '100 × 5', '+10 kg × 6', '12 reps', '45 s'.
export function setText(unit, best, value) {
  if (unit === 'kg' && Array.isArray(best)) return `${kgText(best[0])} × ${best[1]}`;
  if (unit === 'reps' && Array.isArray(best)) {
    if (best[0] > 0) return `+${kgText(best[0])} kg × ${best[1]}`;
    if (best[0] < 0) return `${kgText(best[0])} kg × ${best[1]}`;
    return plural(best[1], 'rep');
  }
  return measureText(value, unit);
}

// Every session with the exercise in it, oldest first, measured in its own unit: { day, hevyId,
// value, unit, best, sets }. A session keeps its best if the exercise was done twice in it.
export function exerciseSessions(doc, name) {
  const out = [];
  for (const w of workouts(doc)) {
    let top = null;
    const sets = [];
    for (const e of w.exercises ?? []) {
      if (!sameLift(e.name, name)) continue;
      const m = measureOf(e);
      if (!m) continue;
      if (!top || m.value > top.value) top = { ...m, best: e.best ?? null };
      if (Array.isArray(e.sets)) sets.push(...e.sets);
    }
    if (top) out.push({ day: w.day, hevyId: w.hevyId, value: top.value, unit: top.unit, best: top.best, sets, e1rm: top.unit === 'kg' ? top.value : null });
  }
  return out;
}

// Each session marked with whether it beat every one before it (the first never does).
function marked(sessions) {
  let max = null;
  return sessions.map((s) => {
    const v = s.value ?? s.e1rm;
    const pr = max != null && v > max;
    max = max == null ? v : Math.max(max, v);
    return { ...s, pr };
  });
}

// The exercises that are George's key lifts right now: the ones set with Claude's gym op while he's
// still doing them, then what he has trained most in the last four weeks (recent sessions counting
// most, at least two sessions each), KEY_LIFTS_SHOWN in all. With nothing trained in four weeks, the
// set ones. So bodyweight work in a park shows pull-ups and dips, and the barbell lifts come back with a gym.
export function keyLiftsNow(doc, today, config = gymConfig(doc)) {
  const from = addDays(today, -(KEY_LIFT_DAYS - 1));
  const seen = new Map();
  for (const w of workouts(doc)) {
    if (w.day < from || w.day > today) continue;
    const inThis = new Set();
    for (const e of w.exercises ?? []) {
      const k = norm(e.name);
      if (inThis.has(k) || !strength(e) || !measureOf(e)) continue;
      inThis.add(k);
      const row = seen.get(k) ?? { name: e.name, sessions: 0, score: 0, last: '' };
      row.sessions++;
      row.score += 0.5 ** (daysBetween(w.day, today) / KEY_LIFT_HALF_LIFE);
      if (w.day > row.last) row.last = w.day;
      seen.set(k, row);
    }
  }
  const chosen = config.keyLifts.filter((l) => seen.has(norm(l)));
  const ranked = [...seen.values()].filter((r) => r.sessions >= 2)
    .sort((a, b) => b.score - a.score || b.last.localeCompare(a.last) || a.name.localeCompare(b.name));
  for (const r of ranked) {
    if (chosen.length >= KEY_LIFTS_SHOWN) break;
    if (!chosen.some((c) => sameLift(c, r.name))) chosen.push(r.name);
  }
  return (chosen.length ? chosen : config.keyLifts).slice(0, KEY_LIFTS_SHOWN);
}

// '+1 rep' when the last session's best set beat the most reps done at that weight before.
function repNote(sessions) {
  if (sessions.length < 2) return null;
  const last = sessions.at(-1);
  const [kg, reps] = last.best;
  let before = null;
  for (const s of sessions.slice(0, -1)) {
    for (const [w, r] of [...s.sets, s.best]) if (w === kg && (before == null || r > before)) before = r;
  }
  if (before == null || reps <= before) return null;
  return `+${plural(reps - before, 'rep')}`;
}

// A straight line through the last 8 weeks' session bests: its unit a week, and where it is today.
function paceOf(sessions, today) {
  const from = addDays(today, -PACE_DAYS);
  const pts = sessions.filter((s) => s.day > from && s.day <= today).map((s) => [daysBetween(from, s.day), s.value ?? s.e1rm]);
  if (pts.length < PACE_MIN) return null;
  const mx = pts.reduce((a, [x]) => a + x, 0) / pts.length;
  const my = pts.reduce((a, [, y]) => a + y, 0) / pts.length;
  const sxx = pts.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  if (!sxx) return null;
  const slope = pts.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / sxx;
  return { perWeek: round1(slope * 7), perDay: slope };
}

// '~late Oct': the part of the month a day falls in.
export function roughDate(day) {
  const d = Number(day.slice(8, 10));
  return `${d <= 10 ? 'early' : d <= 20 ? 'mid' : 'late'} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
}

function projectionOf(pace, target, current, today) {
  if (!target) return null;
  if (current >= target) return { reached: true };
  if (!pace || !(pace.perDay > 0)) return null;
  const days = Math.ceil((target - current) / pace.perDay);
  if (days > 365) return null;
  const day = addDays(today, days);
  return { reached: false, day, label: roughDate(day) };
}

// Everything the Gym panel and Claude say about one key lift, or null before it's been done. A lift
// is in kg (estimated 1RM), a bodyweight exercise in reps, a hold in seconds (`unit`); `value` is
// the latest session's number, and `e1rm` stays for a lift. A target from the gym op is in its unit.
export function liftSummary(doc, lift, today, config = gymConfig(doc)) {
  const all = exerciseSessions(doc, lift).filter((s) => s.day <= today);
  if (!all.length) return null;
  // One unit: the one it's measured in now (an exercise Hevy re-typed starts its line again).
  const unit = all.at(-1).unit;
  const sessions = marked(all.filter((s) => s.unit === unit));
  const last = sessions.at(-1);
  const lastPr = [...sessions].reverse().find((s) => s.pr) ?? null;
  const pace = paceOf(sessions, today);
  const key = Object.keys(config.liftTargets).find((k) => sameLift(k, lift));
  const target = key ? config.liftTargets[key] : null;
  const best = Array.isArray(last.best) ? last.best : null;
  return {
    lift,
    name: shortLift(lift),
    unit,
    value: last.value,
    e1rm: unit === 'kg' ? last.value : null,
    best: sessions.reduce((m, s) => Math.max(m, s.value), 0),
    pr: last.pr,
    prDay: lastPr?.day ?? null,
    last: { kg: best ? best[0] : 0, reps: best ? best[1] : null, value: last.value, text: setText(unit, best, last.value), day: last.day },
    repNote: unit === 'kg' ? repNote(sessions) : null,
    pace: pace?.perWeek ?? null,
    target,
    projection: projectionOf(pace, target, last.value, today),
    points: sessions.slice(-SPARK).map((s) => s.value),
    sessions: sessions.length,
  };
}

// A pace in its unit: '+2.2 kg/wk', '+1 rep/wk', '+5 s/wk'.
export function paceText(pace, unit) {
  if (pace == null) return null;
  const sign = pace >= 0 ? '+' : '';
  if (unit === 'reps') return `${sign}${pace} rep${Math.abs(pace) === 1 ? '' : 's'}/wk`;
  return `${sign}${pace} ${unit}/wk`;
}

// Whether a workout set a PR on a lift.
function prIn(doc, lift, w) {
  return marked(exerciseSessions(doc, lift)).find((s) => s.hevyId === w.hevyId)?.pr === true;
}

// ---- Weeks and days ----------------------------------------------------------------------------

// Monday to Sunday of the week containing `today`: sessions, whether he lifted, cardio minutes.
export function weekStrip(doc, today) {
  const start = weekStart(today);
  const list = workouts(doc);
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(start, i);
    const ws = list.filter((w) => w.day === day);
    return {
      day,
      future: day > today,
      sessions: ws.length,
      lifted: ws.some((w) => w.exercises.some(strength)),
      cardio: round1(ws.reduce((m, w) => m + cardioOf(w).minutes, 0)),
    };
  });
}

// One session in a line: 'Legs A · 62 min · Squat 100 × 5 PR · 3 other exercises · Walking 15 min'.
export function sessionLine(doc, w, config = gymConfig(doc), keys = keyLiftsNow(doc, w.day, config)) {
  const parts = [`${w.title} · ${w.minutes} min`];
  const used = new Set();
  for (const lift of keys) {
    const ex = (w.exercises ?? []).filter((e) => sameLift(e.name, lift) && measureOf(e));
    if (!ex.length) continue;
    ex.forEach((e) => used.add(e));
    const top = ex.reduce((a, b) => (measureOf(b).value > measureOf(a).value ? b : a));
    const m = measureOf(top);
    const said = m.unit === 's' ? measureText(m.value, m.unit) : setText(m.unit, top.best, m.value);
    parts.push(`${shortLift(lift)} ${said}${prIn(doc, lift, w) ? ' PR' : ''}`);
  }
  const others = (w.exercises ?? []).filter((e) => e.kind !== 'cardio' && !used.has(e)).length;
  if (others) parts.push(plural(others, used.size ? 'other exercise' : 'exercise'));
  for (const e of w.exercises ?? []) {
    if (e.kind === 'cardio' && e.minutes) parts.push(`${e.name} ${Math.round(e.minutes)} min${e.km ? `, ${e.km} km` : ''}`);
  }
  return parts.join(' · ');
}

export const dayLines = (doc, day) => workoutsOn(doc, day).map((w) => sessionLine(doc, w));

// ---- Muscles and cardio over time (the Muscles and Cardio trend widgets) ----------------------

// Broad groups, the way they're trained together, in the order the radar goes round (clockwise
// from the top). Hevy's primary muscle for an exercise decides its group; forearms go with
// biceps, traps with back, calves with quads. Cardio, full body and "other" count for none.
export const MUSCLE_GROUPS = Object.freeze([
  { name: 'Chest', muscles: ['chest'] },
  { name: 'Shoulders', muscles: ['shoulders', 'neck'] },
  { name: 'Triceps', muscles: ['triceps'] },
  { name: 'Biceps', muscles: ['biceps', 'forearms'] },
  { name: 'Back', muscles: ['lats', 'upper_back', 'lower_back', 'traps'] },
  { name: 'Core', muscles: ['abdominals'] },
  { name: 'Glutes & hams', muscles: ['glutes', 'hamstrings', 'abductors', 'adductors'] },
  { name: 'Quads', muscles: ['quadriceps', 'calves'] },
].map((g) => Object.freeze({ name: g.name, muscles: Object.freeze(g.muscles) })));

const GROUP_OF = new Map(MUSCLE_GROUPS.flatMap((g) => g.muscles.map((m) => [m, g.name])));
export const muscleGroupOf = (muscle) => GROUP_OF.get(norm(muscle)) ?? null;

// Each non-cardio exercise done by `today` as [day, group, working sets]; exercises whose
// template the app hasn't been sent, or whose muscle has no group, are left out.
function groupSets(doc, today) {
  const templates = templatesOf(doc);
  const out = [];
  for (const w of workouts(doc)) {
    if (w.day > today) continue;
    for (const e of w.exercises ?? []) {
      if (e.kind === 'cardio') continue;
      const group = muscleGroupOf(templates[e.tpl]?.[2]);
      if (group && Number(e.n) > 0) out.push([w.day, group, Number(e.n)]);
    }
  }
  return out;
}

// Working sets per group over the 7 days ending `today`, in MUSCLE_GROUPS order.
export function muscleWeek(doc, today) {
  const from = addDays(today, -6);
  const sets = new Map(MUSCLE_GROUPS.map((g) => [g.name, 0]));
  for (const [day, group, n] of groupSets(doc, today)) if (day >= from) sets.set(group, sets.get(group) + n);
  return MUSCLE_GROUPS.map((g) => ({ name: g.name, sets: sets.get(g.name) }));
}

// The `count` groups longest since a working set: days since, or null for never (those first).
export function longestRested(doc, today, count = 3) {
  const last = new Map();
  for (const [day, group] of groupSets(doc, today)) if (!(last.get(group) >= day)) last.set(group, day);
  const rest = MUSCLE_GROUPS.map((g, i) => ({ i, name: g.name, days: last.has(g.name) ? daysBetween(last.get(g.name), today) : null }));
  rest.sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity) || a.i - b.i);
  return rest.slice(0, count).map(({ name, days }) => ({ name, days }));
}

// Cardio minutes for each of the `count` weeks up to this one (so far), oldest first. With a
// cardio target they're its weekly totals, as the Gym panel shows; without, Hevy's minutes.
export function cardioWeeks(doc, today, config = gymConfig(doc), count = 8) {
  const quota = cardioQuotaId(doc, config);
  const list = workouts(doc);
  const thisWeek = weekStart(today);
  const weeks = Array.from({ length: count }, (_, i) => {
    const monday = addDays(thisWeek, 7 * (i - count + 1));
    const last = monday === thisWeek ? today : addDays(monday, 6);
    const minutes = quota
      ? weekTotal(doc, quota, monday)
      : list.filter((w) => w.day >= monday && w.day <= last).reduce((m, w) => m + cardioOf(w).minutes, 0);
    return { monday, minutes: Math.round(minutes), current: monday === thisWeek };
  });
  return { weeks, target: quota ? Number(doc.items[quota].target) : null };
}

// ---- The long view (Gym opened big, js/ui/gym.js) ----------------------------------------------

// Every exercise he has done, with its best ever in its own unit (estimated 1RM, reps or a hold), the
// set behind it, and the day. The ones he does most first, `limit` of them. `e1rm` stays for a lift.
export function prBoard(doc, today, limit = 12) {
  const byLift = new Map();
  for (const w of workouts(doc)) {
    if (w.day > today) continue;
    const seen = new Set();
    for (const e of w.exercises ?? []) {
      const m = strength(e) ? measureOf(e) : null;
      if (!m) continue;
      const key = `${norm(e.name)}|${m.unit}`;
      const row = byLift.get(key) ?? { name: e.name, unit: m.unit, sessions: 0, value: 0, e1rm: null, best: null, day: null, last: null };
      if (!seen.has(key)) { row.sessions++; seen.add(key); }
      if (m.value > row.value) Object.assign(row, { value: m.value, e1rm: m.unit === 'kg' ? m.value : null, best: e.best ?? null, day: w.day });
      row.last = w.day;
      byLift.set(key, row);
    }
  }
  return [...byLift.values()]
    .sort((a, b) => b.sessions - a.sessions || b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// The `weeks` weeks up to this one, Monday to Sunday, each day with whether he lifted, cardio
// minutes and sessions — the year of training as a grid.
export function sessionDays(doc, today, weeks = 52) {
  const first = addDays(weekStart(today), -7 * (weeks - 1));
  const byDay = new Map();
  for (const w of workouts(doc)) {
    if (w.day < first || w.day > today) continue;
    const d = byDay.get(w.day) ?? { sessions: 0, lifted: false, cardio: 0 };
    d.sessions++;
    d.lifted ||= (w.exercises ?? []).some(strength);
    d.cardio = round1(d.cardio + cardioOf(w).minutes);
    byDay.set(w.day, d);
  }
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const day = addDays(first, i);
    return { day, future: day > today, ...(byDay.get(day) ?? { sessions: 0, lifted: false, cardio: 0 }) };
  });
}

// Working sets per muscle group, week by week for the `count` weeks up to this one (so far):
// { weeks: [monday…], groups: [{ name, sets: [n per week] }] }, groups in MUSCLE_GROUPS order.
export function groupWeeks(doc, today, count = 8) {
  const thisWeek = weekStart(today);
  const weeks = Array.from({ length: count }, (_, i) => addDays(thisWeek, 7 * (i - count + 1)));
  const at = new Map(weeks.map((m, i) => [m, i]));
  const sets = new Map(MUSCLE_GROUPS.map((g) => [g.name, weeks.map(() => 0)]));
  for (const [day, group, n] of groupSets(doc, today)) {
    const i = at.get(weekStart(day));
    if (i != null) sets.get(group)[i] += n;
  }
  return { weeks, groups: MUSCLE_GROUPS.map((g) => ({ name: g.name, sets: sets.get(g.name) })) };
}

// A week's training in a line, for Claude's catch-up: sessions, cardio, key lifts.
export function trainingWeek(doc, day, config = gymConfig(doc)) {
  const start = weekStart(day);
  const end = addDays(start, 6);
  const ws = workouts(doc).filter((w) => w.day >= start && w.day <= end && w.day <= day);
  const parts = [plural(ws.length, 'session')];
  const quota = cardioQuotaId(doc, config);
  const minutes = Math.round(ws.reduce((m, w) => m + cardioOf(w).minutes, 0));
  parts.push(quota
    ? `cardio ${Math.round(weekTotal(doc, quota, day))} of ${doc.items[quota].target} min`
    : `cardio ${minutes} min`);
  for (const lift of keyLiftsNow(doc, day, config)) {
    const s = liftSummary(doc, lift, day, config);
    if (!s) continue;
    const pr = s.prDay && s.prDay >= start ? ` (PR ${shortWeekday(s.prDay)})` : '';
    const pace = s.pace != null ? `, ${paceText(s.pace, s.unit)}` : '';
    parts.push(`${s.name} ${s.unit === 'kg' ? `est. 1RM ${kgText(s.value)}` : `best ${measureText(s.value, s.unit)}`}${pr}${pace}`);
  }
  return parts.join('; ');
}

// The Hevy tick on an item for a day, as { from, at } ISO strings, or null.
export function hevyTick(doc, itemId, day) {
  const log = values(doc?.logs).find((l) => l.status === 'active' && l.kind === 'done' && l.source === 'hevy'
    && l.itemId === itemId && l.day === day);
  return log ? { from: log.from ?? null, at: log.at ?? null } : null;
}

// The connection in a few lines, for ⚙ and Claude. `when` formats a moment.
export function gymStatusLines(doc, when = (iso) => iso) {
  const s = gymStatus(doc);
  const out = [];
  if (!s) out.push("Hevy isn't connected — the planner script needs the key as HEVY_KEY in its Script properties");
  else {
    out.push(`Hevy: last checked ${s.lastSync ? when(s.lastSync) : 'never'} · ${plural(Number(s.count) || 0, 'workout')}`);
    if (s.backfillPage != null) out.push(`Still copying your Hevy history — page ${s.backfillPage} next`);
    if (s.lastError) out.push(`Problem: ${s.lastError}`);
  }
  // Google Health's cardio (planner/health.js), once the planner has its HEALTH_ properties.
  const h = doc?.gym?.['health-status'];
  if (h?.status === 'active') {
    out.push(`Google Health: last checked ${h.lastSync ? when(h.lastSync) : 'never'} · ${plural(Number(h.count) || 0, 'exercise')} this week or so`);
    if (h.lastError) out.push(`Problem: ${h.lastError}`);
  }
  return out;
}
