// The coach. Claude writes George's training sessions onto dated gym tasks (the `session` op);
// the planner puts each into Hevy as a routine (planner/routines.js); this holds the fixed rules
// both sides share: how a session reads, checking it against Hevy's exercises, the routine Hevy
// is sent, the morning back question and its warning, and lifts ready for more weight. Pure.

import { addDays, shortWeekday } from './dates.js';
import { kgText } from './gym.js';

const norm = (s) => String(s ?? '').trim().toLowerCase();
const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
const isNum = (n, lo, hi) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
const isPair = (p, lo, hi) => Array.isArray(p) && p.length === 2 && isInt(p[0], lo, hi) && isInt(p[1], lo, hi) && p[0] < p[1];

export const BACK = Object.freeze(['fine', 'stiff', 'sore', 'bad']); // the morning answer's score is its index
export const BACK_UNTIL_HOUR = 11;
const HEAVY_SHARE = 0.85;

// ---- How a session reads -----------------------------------------------------------------------

function exerciseLine(ex) {
  const reps = ex.repRange ? `${ex.repRange[0]}–${ex.repRange[1]}` : String(ex.reps);
  const load = [ex.kg != null ? `${kgText(ex.kg)} kg` : null, ex.rpe != null ? `RPE ${ex.rpe}` : null].filter(Boolean).join(', ');
  return `${ex.name} ${ex.sets}×${reps}${ex.each ? ' each' : ''}${load ? ` @ ${load}` : ''}${ex.note ? ` (${ex.note})` : ''}`;
}

function cardioLine(c) {
  return `${c.kind} ${c.minutes} min${c.hr ? `, ${c.hr[0]}–${c.hr[1]} bpm` : ''}`;
}

export function sessionLines(session) {
  if (!session) return [];
  return [
    ...(session.note ? [session.note] : []),
    ...(session.exercises ?? []).map(exerciseLine),
    ...(session.cardio ? [cardioLine(session.cardio)] : []),
  ];
}

export const sessionText = (session) => sessionLines(session).join('\n');

// The part of a task's notes George (or Claude) wrote, without the session's lines the store adds
// after them; and the notes with a session's lines after that part.
export function ownNotes(item) {
  const notes = String(item?.notes ?? '');
  if (!item?.session) return notes;
  const lines = sessionText(item.session);
  if (notes === lines) return '';
  return notes.endsWith(`\n\n${lines}`) ? notes.slice(0, -(lines.length + 2)) : notes;
}

export function notesWith(item, session) {
  const own = ownNotes(item);
  if (!session) return own;
  return own ? `${own}\n\n${sessionText(session)}` : sessionText(session);
}

// ---- Checking a session ------------------------------------------------------------------------

const words = (s) => new Set(norm(s).replace(/[()]/g, ' ').split(/[^a-z0-9]+/).filter(Boolean));

function closest(name, templates, count = 3) {
  const want = words(name);
  return Object.values(templates)
    .map((t) => ({ title: t[0], score: [...words(t[0])].filter((w) => want.has(w)).length }))
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, count)
    .map((t) => t.title);
}

function checkExercise(ex, i, byTitle, templates) {
  const at = `Exercise ${i + 1}`;
  if (!ex || typeof ex !== 'object') throw new Error(`${at} isn't an exercise`);
  if (typeof ex.name !== 'string' || !ex.name.trim()) throw new Error(`${at} needs a name`);
  const hit = byTitle.get(norm(ex.name));
  if (!hit) {
    const near = closest(ex.name, templates);
    throw new Error(`"${ex.name.trim()}" isn't one of Hevy's exercises.${near.length ? ` Closest: ${near.join(', ')}` : ''}`);
  }
  const [tpl, title] = hit;
  if (!isInt(ex.sets, 1, 10)) throw new Error(`${title}: sets is a whole number from 1 to 10`);
  if (ex.reps != null && ex.repRange != null) throw new Error(`${title}: give reps or repRange, not both`);
  if (ex.repRange != null ? !isPair(ex.repRange, 1, 50) : !isInt(ex.reps, 1, 50)) {
    throw new Error(ex.repRange != null ? `${title}: repRange is [low, high], 1 to 50` : `${title}: reps is a whole number from 1 to 50`);
  }
  if (ex.kg != null && !isNum(ex.kg, 0, 500)) throw new Error(`${title}: kg is a weight from 0 to 500`);
  if (ex.rpe != null && !isNum(ex.rpe, 5, 10)) throw new Error(`${title}: rpe is from 5 to 10`);
  if (ex.restSec != null && !isInt(ex.restSec, 0, 600)) throw new Error(`${title}: restSec is 0 to 600 seconds`);
  if (ex.note != null && (typeof ex.note !== 'string' || ex.note.length > 200)) throw new Error(`${title}: note is a sentence`);
  const out = { name: title, tpl, sets: ex.sets };
  if (ex.repRange != null) out.repRange = [...ex.repRange]; else out.reps = ex.reps;
  if (ex.kg != null) out.kg = ex.kg;
  if (ex.rpe != null) out.rpe = ex.rpe;
  if (ex.each) out.each = true;
  if (ex.restSec != null) out.restSec = ex.restSec;
  if (ex.note?.trim()) out.note = ex.note.trim();
  return out;
}

// A session as Claude wrote it, checked and tidied: each exercise named as Hevy names it, with
// its template id. `templates` is { id: [title, type, muscle] }. Throws a sentence.
export function checkSession(session, templates) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) throw new Error("A session is { name, exercises: [...] }");
  if (typeof session.name !== 'string' || !session.name.trim() || session.name.length > 60) throw new Error('A session needs a short name');
  if (!Array.isArray(session.exercises) || !session.exercises.length) throw new Error('A session needs at least one exercise');
  if (session.exercises.length > 15) throw new Error('A session has at most 15 exercises');
  if (session.note != null && (typeof session.note !== 'string' || session.note.length > 300)) throw new Error("The session's note is a sentence or two");
  const byTitle = new Map(Object.entries(templates ?? {}).map(([id, t]) => [norm(t?.[0]), [id, t[0]]]));
  const out = { name: session.name.trim(), exercises: session.exercises.map((ex, i) => checkExercise(ex, i, byTitle, templates)) };
  if (session.note?.trim()) out.note = session.note.trim();
  const c = session.cardio;
  if (c != null) {
    if (typeof c !== 'object' || typeof c.kind !== 'string' || !c.kind.trim()) throw new Error('Cardio is { kind, minutes, hr? }');
    if (!isInt(c.minutes, 1, 180)) throw new Error('Cardio minutes is a whole number from 1 to 180');
    if (c.hr != null && !isPair(c.hr, 60, 200)) throw new Error('Cardio hr is [low, high] beats a minute');
    out.cardio = { kind: c.kind.trim(), minutes: c.minutes, ...(c.hr ? { hr: [...c.hr] } : {}) };
  }
  return out;
}

// ---- The routine Hevy is sent ------------------------------------------------------------------

// A checked session as a Hevy routine (POST /v1/routines; PUT leaves out the folder). Hevy's sets
// have no RPE or "each side", so those go in the exercise's notes.
export function routineBody(session, { title, folderId } = {}) {
  const routine = {
    title,
    ...(folderId != null ? { folder_id: folderId } : {}),
    notes: [session.note, session.cardio ? cardioLine(session.cardio) : null].filter(Boolean).join('\n'),
    exercises: session.exercises.map((ex) => ({
      exercise_template_id: ex.tpl,
      superset_id: null,
      rest_seconds: ex.restSec ?? null,
      notes: [ex.rpe != null ? `RPE ${ex.rpe}` : null, ex.each ? 'each side' : null, ex.note].filter(Boolean).join(' · '),
      sets: Array.from({ length: ex.sets }, () => ({
        type: 'normal',
        weight_kg: ex.kg ?? null,
        reps: ex.repRange ? null : ex.reps,
        distance_meters: null,
        duration_seconds: null,
        custom_metric: null,
        rep_range: ex.repRange ? { start: ex.repRange[0], end: ex.repRange[1] } : null,
      })),
    })),
  };
  return { routine };
}

// ---- The back --------------------------------------------------------------------------------------

export const isHinge = (name) => /deadlift|good morning|romanian|\brdl\b/i.test(String(name ?? ''));
const isBigSquat = (name) => /squat/i.test(name) && !/split|bulgarian|goblet|lunge|pistol/i.test(name);

// What the session row says on a sore (2) or bad (3) morning when the session loads the back:
// a hinge, or a squat at RPE 8+ or at 85% or more of his estimated 1RM. Null otherwise.
export function backFlag(session, score, e1rmOf = () => null) {
  if (!(score >= 2) || !session) return null;
  const word = score >= 3 ? 'bad' : 'sore';
  for (const ex of session.exercises ?? []) {
    if (isHinge(ex.name)) return `Back's ${word}: swap the ${ex.name.replace(/\s*\(.*\)$/, '').toLowerCase()} for back extensions, or drop the load.`;
    if (isBigSquat(ex.name)) {
      const max = e1rmOf(ex.name);
      if (ex.rpe >= 8 || (max > 0 && ex.kg >= max * HEAVY_SHARE)) return `Back's ${word}: go lighter on the squat, or swap it for split squats.`;
    }
  }
  return null;
}

// The morning answers, `gym` records `back:<day>`, over the `days` up to today, oldest first.
export function backScores(doc, today, days = 14) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    const r = doc?.gym?.[`back:${day}`];
    if (r && r.status === 'active' && isInt(r.score, 0, 3)) out.push({ day, score: r.score });
  }
  return out;
}

// ---- Ready for more weight -------------------------------------------------------------------------

// The exercises in `session` that `workout` (as js/gym.js keeps it, sets as [kg, reps, rpe]) did
// in full: every prescribed set at the weight, at the top of the reps, and at or under the RPE
// where Hevy has one.
export function readyMarks(session, workout) {
  const done = workout?.exercises ?? [];
  const out = [];
  for (const ex of session?.exercises ?? []) {
    if (!(ex.kg > 0)) continue;
    const hit = done.find((d) => (ex.tpl && d.tpl ? d.tpl === ex.tpl : norm(d.name) === norm(ex.name)));
    const sets = Array.isArray(hit?.sets) ? hit.sets : [];
    const top = ex.repRange ? ex.repRange[1] : ex.reps;
    const easyEnough = (s) => ex.rpe == null || s[2] == null || s[2] <= ex.rpe;
    if (sets.filter((s) => s[0] >= ex.kg && s[1] >= top && easyEnough(s)).length >= ex.sets) out.push(ex.name);
  }
  return out;
}

// ---- Sessions on the dashboard -------------------------------------------------------------------

// Live tasks with a session, dated `from` to `to`, in date and time order.
export function sessionTasks(doc, from, to) {
  return Object.values(doc?.items ?? {})
    .filter((i) => i.type === 'task' && i.status === 'active' && i.session && i.date >= from && i.date <= to)
    .sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
}

// The planner's routine pool (planner/routines.js): { folderId, byRoutine: { routineId: { taskId,
// day, hash } }, lastError }.
export function routinesOf(doc) {
  const r = doc?.gym?.routines;
  return r && r.status === 'active' ? r : { folderId: null, byRoutine: {}, lastError: null };
}

// The Hevy routine a session task is in, if the planner has put it there.
export function routineFor(doc, item) {
  const hit = Object.entries(routinesOf(doc).byRoutine ?? {}).find(([, v]) => v?.taskId === item.id && v.day === item.date);
  return hit ? hit[0] : null;
}

// The workout he saved from a session's routine: the one its Hevy tick names (that lasts after the
// routine is reused for a later session), else the routine's on the session's day.
export function sessionWorkout(doc, item) {
  const tick = Object.values(doc?.logs ?? {}).find((l) => l.status === 'active' && l.itemId === item.id && String(l.id).startsWith('hevy-session-'));
  const ticked = tick ? doc?.gym?.[`w:${String(tick.id).slice('hevy-session-'.length)}`] : null;
  if (ticked && ticked.status === 'active') return ticked;
  const ids = new Set(Object.entries(routinesOf(doc).byRoutine ?? {}).filter(([, v]) => v?.taskId === item.id).map(([id]) => id));
  if (!ids.size) return null;
  return Object.values(doc?.gym ?? {}).find((w) => w.status === 'active' && String(w.id).startsWith('w:') && ids.has(w.routineId) && w.day === item.date) ?? null;
}

// ---- The morning question, on the screen ----------------------------------------------------------

// What the timeline's first row is: the question from the day's start until 11:00, the answer after
// it's given (until 11:00 too), else nothing.
export function backRowState(doc, today, now, dayStartHour = 4) {
  const hour = now.getHours();
  if (hour < dayStartHour || hour >= BACK_UNTIL_HOUR) return null;
  const r = doc?.gym?.[`back:${today}`];
  if (r && r.status === 'active' && isInt(r.score, 0, 3)) return { state: 'answered', score: r.score, word: BACK[r.score] };
  return { state: 'ask' };
}

// Sore (2) or bad (3) this morning and the one before.
export function soreRun(doc, today) {
  const [a, b] = [addDays(today, -1), today].map((d) => doc?.gym?.[`back:${d}`]);
  return [a, b].every((r) => r && r.status === 'active' && r.score >= 2);
}

// The For Claude flag two sore mornings leave.
export function soreFlagText(doc, today) {
  const word = (d) => `${shortWeekday(d)} ${BACK[doc.gym[`back:${d}`].score]}`;
  return `Back sore two mornings running (${word(addDays(today, -1))}, ${word(today)})`;
}

// The first session from today on (two weeks ahead) not yet done.
export function nextSession(doc, today) {
  const done = (t) => Object.values(doc?.logs ?? {}).some((l) => l.status === 'active' && l.kind === 'done' && l.itemId === t.id);
  return sessionTasks(doc, today, addDays(today, 13)).find((t) => !done(t)) ?? null;
}
