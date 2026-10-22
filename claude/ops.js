// The tool's changes. An op is a plain object from Claude's JSON ({ "op": "task", "title": … });
// runOp checks it, runs it through the store's own methods, and returns the one line Claude
// reports. Every check happens before the store is touched, so a bad op throws a plain-English
// error and changes nothing. What Claude adds is marked source 'claude'.

import { parseAmount, parseLength, parseClock, formatAmount, checkNotes } from '../js/parse.js';
import { undoLine } from '../js/changes.js';
import {
  checkConfigField, readPlannerConfig, mergeSetting, MERGED_SETTINGS, plannerStatus, COLOR_NAMES, checkTimeOff, nextOffId, offText, timeOff, offCovers, excused,
  checkCountdown, nextCountdownId, daysLeft,
} from '../js/calendar.js';
import { daysBetween } from '../js/dates.js';
import { gymConfig, gymHabitId, templatesOf } from '../js/gym.js';
import { checkSession, notesWith } from '../js/coach.js';
import { NOTES_MAX } from '../js/parse.js';
import { FLAG_TEXT_MAX, FLAG_KINDS } from '../js/flags.js';
import { resolveId, shortId } from './ids.js';
import { q, dayName, toDay, TYPE_NAMES, repeatText, amountText } from './text.js';
import { checkDetails } from '../js/workflow.js';
import { seriesOf } from '../planner/series.js';

const extraDetails = (op) => op.details === undefined ? {} : { details: checkDetails(op.details) };

function planFields(op, type) {
  const fields = { ...extraDetails(op), area: str(op.area) };
  if (op.notes !== undefined) fields.notes = checkNotes(op.notes);
  if (type !== 'quota') {
    if (op.minutes !== undefined) fields.minutes = lengthOf(op.minutes);
    if (op.time !== undefined) fields.time = clockOf(op.time);
    if (op.priority !== undefined) fields.priority = priorityOf(op.priority, type);
  }
  return fields;
}

function details(store, op) {
  const { map, id, rec } = resolveId(store.doc(), op.id, ['items', 'goals']);
  if (!op.set || typeof op.set !== 'object' || Array.isArray(op.set)) throw new Error('details needs set: { field: value }');
  const set = structuredClone(op.set);
  if (set.dependsOn) set.dependsOn = set.dependsOn.map((ref) => resolveId(store.doc(), ref, ['items']).id);
  for (const key of ['notBefore', 'deadline']) if (set[key]) set[key] = toDay(set[key], store.today());
  if (map !== 'goals' && set.reviewEveryDays !== undefined) throw new Error('reviewEveryDays is a goal setting');
  store.setDetails(map, id, set);
  return `Updated details for ${q(rec.title)}`;
}

function rule(store, op) {
  const previous = op.id ? resolveId(store.doc(), op.id, ['rules']).rec : null;
  const definition = structuredClone(op.definition ?? previous?.definition);
  if (!definition) throw new Error('rule needs definition');
  definition.sourceId = resolveId(store.doc(), definition.sourceId, ['items', 'goals']).id;
  if (Array.isArray(definition.actions)) for (const a of definition.actions) {
    if (a.itemId) a.itemId = resolveId(store.doc(), a.itemId, ['items']).id;
    if (a.targetId) a.targetId = resolveId(store.doc(), a.targetId, ['items', 'goals']).id;
    if (a.goalId) a.goalId = resolveId(store.doc(), a.goalId, ['goals']).id;
  }
  const rec = store.saveRule({ ...(previous ? { id: previous.id } : {}), title: op.title ?? previous?.title,
    enabled: op.enabled ?? previous?.enabled ?? false, definition });
  return tagged(`${rec.enabled ? 'Enabled' : 'Paused'} rule ${q(rec.title)}; applies to new matching reports`, rec.id);
}

function report(store, op) {
  if (op.reported !== true) throw new Error('report requires reported:true: use only answers George actually supplied, never infer them');
  const { id, rec } = resolveId(store.doc(), op.id, ['items', 'goals']);
  const outcome = store.reportOutcome({ sourceId: id, answers: op.answers, day: toDay(op.day ?? 'today', store.today()),
    complete: op.complete ?? false, ...(op.reportId ? { id: op.reportId } : {}), source: CLAUDE });
  return tagged(`Recorded outcome for ${q(rec.title)}; matching rules run on the next planner check`, outcome.id);
}

function review(store, op) {
  const { id, rec } = resolveId(store.doc(), op.id, ['goals']);
  const request = store.requestReview(id);
  return tagged(`Goal review for ${q(rec.title)}: ${request.result.state}; uses the planner's Gemini key, suggests at most three tasks`, request.id);
}

const CLAUDE = 'claude';
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const tagged = (line, id) => `${line} · #${shortId(id)}`;
const verb = (op) => (op.suggest ? 'Suggested' : 'Added');
const statusOf = (op) => (op.suggest ? 'suggested' : 'active');
const nameOf = (rec) => rec.title ?? rec.text ?? '';

function title(value, what) {
  const t = str(value);
  if (!t) throw new Error(`${what} needs a title`);
  return t;
}

function list(value, what) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${what} should be a list`);
  return value;
}

function noun(map, rec) {
  if (map === 'items') return TYPE_NAMES[rec.type] ?? 'item';
  return { goals: 'goal', milestones: 'milestone', flags: 'flag', logs: 'log', changes: 'change' }[map] ?? map;
}

// The same repeat shapes the edit panel writes (js/ui/edit.js).
function checkRepeat(r) {
  if (r == null) return { kind: 'daily' };
  switch (r.kind) {
    case 'daily':
      return { kind: 'daily' };
    case 'weekdays': {
      const days = [...new Set(r.days ?? [])];
      if (!days.length || !days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) {
        throw new Error('weekdays needs days: numbers from 1 (Mon) to 7 (Sun)');
      }
      return { kind: 'weekdays', days: days.sort((a, b) => a - b) };
    }
    case 'perWeek':
      if (!(Number.isInteger(r.n) && r.n >= 1 && r.n <= 7)) throw new Error('perWeek needs n: a whole number from 1 to 7');
      return { kind: 'perWeek', n: r.n };
    case 'weekly':
      if (!(Number.isInteger(r.day) && r.day >= 1 && r.day <= 7)) throw new Error('weekly needs day: 1 (Mon) to 7 (Sun)');
      return { kind: 'weekly', day: r.day };
    case 'monthly':
      if (!(Number.isInteger(r.date) && r.date >= 1 && r.date <= 31)) throw new Error('monthly needs date: 1 to 31');
      return { kind: 'monthly', date: r.date };
    default:
      throw new Error(`Unknown repeat kind ${JSON.stringify(r.kind)} — use daily, weekdays, perWeek, weekly or monthly`);
  }
}

function checkUnit(unit) {
  if (unit == null) return 'count';
  if (unit === 'count' || unit === 'minutes') return unit;
  throw new Error('unit is "count" or "minutes"');
}

// A weekly target: a time ("5h", "90m", "1h30") in minutes, or a number for a count.
function checkTarget(value, unit) {
  const n = unit === 'count' && typeof value === 'number' ? value : parseAmount(String(value ?? ''), unit);
  if (!(n > 0)) throw new Error(unit === 'minutes' ? 'target needs a time above 0, like "5h" or "90m"' : 'target needs a number above 0');
  return n;
}

function checkOrder(value) {
  if (!Number.isFinite(value)) throw new Error('order needs a number');
  return value;
}

// A length: "2h", "90m", "1h30" or a number of minutes, 5 to 720. Null clears it.
function lengthOf(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? (Number.isInteger(value) && value >= 5 && value <= 720 ? value : null) : parseLength(String(value));
  if (n == null) throw new Error('minutes needs a length from 5m to 12h, like "45m", "2h" or "1h30"');
  return n;
}

// A time of day, "14:00". Null clears it.
function clockOf(value) {
  if (value == null || value === '') return null;
  const t = parseClock(String(value));
  if (!t) throw new Error('time needs a time of day like "14:00"');
  return t;
}

// Priority: true or false, on a task or a habit only.
function priorityOf(value, type) {
  if (value == null) return undefined;
  if (typeof value !== 'boolean') throw new Error('priority is true or false');
  if (type !== 'task' && type !== 'habit') throw new Error('Only a task or a habit can be a priority');
  return value;
}

const notesOf = (value) => (value == null ? undefined : checkNotes(value));

const timing = (rec) => {
  const parts = [rec.minutes ? formatAmount(rec.minutes, 'minutes') : null, rec.time ? `at ${rec.time}` : null].filter(Boolean);
  return parts.length ? ` (${parts.join(', ')})` : '';
};

// The goal an op points at (null when it doesn't point at one); it must be live or suggested.
function goalOf(store, ref) {
  if (ref == null || ref === '') return null;
  const { id, rec } = resolveId(store.doc(), ref, ['goals']);
  if (rec.status !== 'active' && rec.status !== 'suggested') throw new Error(`Goal ${q(rec.title)} is ${rec.status}`);
  return id;
}

// ---- Adding -----------------------------------------------------------------------------------

// A series name: tasks that only make sense in order (planner/series.js). null or '' clears it.
function seriesName(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 60) throw new Error('series is a short name, up to 60 characters, or null to clear it');
  return value.trim();
}

const listed = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// Whether this task's date or time now puts it out of order in its series. The planner books a series
// in order and holds a later one back, so out-of-order dates are silently corrected — or, with a pin
// involved, left wrong. Either way the model that set them should hear about it at once.
function seriesNote(store, id) {
  const doc = store.doc();
  const t = doc.items[id];
  const series = seriesOf(t);
  if (!series || t.status !== 'active') return '';
  const ticked = new Set(Object.values(doc.logs ?? {}).filter((l) => l.kind === 'done' && l.status === 'active').map((l) => l.itemId));
  if (ticked.has(id)) return '';
  const members = Object.values(doc.items).filter((m) => m.id !== id && m.status === 'active' && !ticked.has(m.id) && seriesOf(m) === series);
  // -1 when a is booked before b; 0 when it can't be told (same day, not both timed).
  const when = (a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.time && b.time && a.time !== b.time ? (a.time < b.time ? -1 : 1) : 0);
  const order = (m) => m.order ?? 0;
  const later = members.filter((m) => order(m) > order(t) && when(m, t) < 0);
  const earlier = members.filter((m) => order(m) < order(t) && when(t, m) < 0);
  const out = [];
  const say = (offenders, where) => {
    const dated = offenders.every((m) => m.date === t.date) ? '' : 'dated ';
    const pinned = [t, ...offenders].some((m) => m.time);
    out.push(`Note: ${q(t.title)} is now ${dated}${where} ${listed(offenders.map((m) => q(m.title)))} in its series. `
      + (pinned ? "A pinned time is involved, so the planner won't put them back in order — change a date or time."
        : "The planner books a series in order, so the later ones will wait — change a date if that isn't what you want."));
  };
  if (later.length) say(later, 'after');
  if (earlier.length) say(earlier, 'before');
  return out.length ? `\n${out.join('\n')}` : '';
}

// A set time that has already gone on the task's own date — often not the day just read, since a
// carried-over task keeps its first date (21 Sep 2026). The planner books nothing in the past.
function pastNote(store, id) {
  const rec = store.doc().items[id];
  if (rec?.type !== 'task' || !rec.date || !/^\d\d:\d\d$/.test(rec.time ?? '')) return '';
  const [y, m, d] = rec.date.split('-').map(Number);
  const [hh, mm] = rec.time.split(':').map(Number);
  if (new Date(y, m - 1, d, hh, mm) > store.now()) return '';
  return `\nNote: ${rec.time} on ${dayName(rec.date, store.today())} has already gone, so the planner won't book it. Set the date too if you meant another day.`;
}

// A task dated on a day its area has off is neither listed nor booked that day: say so, so a task
// that seems added doesn't quietly vanish (20 Oct 2026: five Home tasks did).
function offNote(store, id) {
  const rec = store.doc().items[id];
  if (rec?.type !== 'task' || !rec.date || !excused(store.doc(), rec, rec.date)) return '';
  const off = timeOff(store.doc()).find((o) => offCovers(o, rec.date) && (!o.areas?.length || o.areas.some((a) => a.toLowerCase() === String(rec.area ?? '').toLowerCase())));
  return `\nNote: that day is time off for ${rec.area ? `"${rec.area}"` : 'everything'} (${off ? offText(off) : 'time off'}), so this task won't be on the list or booked then — it moves to the first day after. Give it another area or day if it's needed sooner.`;
}

function task(store, op) {
  const today = store.today();
  const minutes = lengthOf(op.minutes);
  const time = clockOf(op.time);
  const notes = notesOf(op.notes);
  const priority = priorityOf(op.priority, 'task');
  const series = seriesName(op.series);
  const rec = store.addItem({
    type: 'task', title: title(op.title, 'A task'), date: toDay(op.date ?? 'today', today),
    ...extraDetails(op),
    area: str(op.area), goalId: goalOf(store, op.goal), status: statusOf(op), source: CLAUDE,
    ...(minutes ? { minutes } : {}), ...(time ? { time } : {}), ...(notes ? { notes } : {}), ...(priority ? { priority } : {}),
    ...(series ? { series } : {}),
    ...(Number.isFinite(op.order) ? { order: op.order } : {}),
  });
  return tagged(`${verb(op)} task ${q(rec.title)} for ${dayName(rec.date, today)}${timing(rec)}${rec.priority ? ' ★' : ''}`, rec.id) + seriesNote(store, rec.id) + offNote(store, rec.id) + pastNote(store, rec.id);
}

function habit(store, op) {
  const minutes = lengthOf(op.minutes);
  const time = clockOf(op.time);
  const notes = notesOf(op.notes);
  const priority = priorityOf(op.priority, 'habit');
  const rec = store.addItem({
    type: 'habit', title: title(op.title, 'A habit'), repeat: checkRepeat(op.repeat),
    ...extraDetails(op),
    area: str(op.area), goalId: goalOf(store, op.goal), status: statusOf(op), source: CLAUDE,
    ...(minutes ? { minutes } : {}), ...(time ? { time } : {}), ...(notes ? { notes } : {}), ...(priority ? { priority } : {}),
  });
  const length = rec.minutes ? `, ${formatAmount(rec.minutes, 'minutes')}` : '';
  const when = rec.time ? `${rec.minutes ? '' : ','} at ${rec.time}` : '';
  return tagged(`${verb(op)} habit ${q(rec.title)} (${repeatText(rec.repeat)}${length}${when})${rec.priority ? ' ★' : ''}`, rec.id);
}

function target(store, op) {
  const unit = checkUnit(op.unit);
  const notes = notesOf(op.notes);
  const rec = store.addItem({
    type: 'quota', title: title(op.title, 'A weekly target'), target: checkTarget(op.target, unit), unit,
    ...extraDetails(op),
    unitLabel: unit === 'count' ? str(op.unitLabel) : '', area: str(op.area), goalId: goalOf(store, op.goal),
    status: statusOf(op), source: CLAUDE, ...(notes ? { notes } : {}),
  });
  return tagged(`${verb(op)} weekly target ${q(rec.title)} (${amountText(rec.target, rec.unit, rec.unitLabel)} a week)`, rec.id);
}

function goal(store, op) {
  const today = store.today();
  const t = title(op.title, 'A goal');
  const targetDate = op.targetDate == null || op.targetDate === '' ? null : toDay(op.targetDate, today);
  const milestones = list(op.milestones, 'milestones').map((m) => title(m, 'A milestone'));
  const why = str(op.why);
  const count = milestones.length ? ` with ${plural(milestones.length, 'milestone')}` : '';
  const notes = notesOf(op.notes);
  if (op.suggest) {
    const out = store.addPlan({ goal: { title: t, targetDate, why, ...extraDetails(op), ...(notes ? { notes } : {}) }, milestones, source: CLAUDE });
    return tagged(`Suggested goal ${q(t)}${count}`, out.goal.id);
  }
  const rec = store.addGoal({ title: t, targetDate, why, ...extraDetails(op), source: CLAUDE, ...(notes ? { notes } : {}) });
  for (const m of milestones) store.addMilestone(rec.id, m, { source: CLAUDE });
  return tagged(`Added goal ${q(t)}${count}`, rec.id);
}

function milestone(store, op) {
  const goalId = goalOf(store, op.goal);
  if (!goalId) throw new Error("A milestone needs goal: the goal's id");
  const rec = store.addMilestone(goalId, title(op.title, 'A milestone'), { source: CLAUDE, status: statusOf(op) });
  return tagged(`${verb(op)} milestone ${q(rec.title)} on ${q(store.doc().goals[goalId].title)}`, rec.id);
}

// A bigger job broken down: always suggestions, for George to take on in the app.
function plan(store, op) {
  const today = store.today();
  const g = op.goal == null ? null : {
    title: title(op.goal.title, "The plan's goal"),
    targetDate: op.goal.targetDate ? toDay(op.goal.targetDate, today) : null,
    why: str(op.goal.why),
    ...extraDetails(op.goal), ...(op.goal.notes !== undefined ? { notes: checkNotes(op.goal.notes) } : {}),
  };
  const milestones = list(op.milestones, 'milestones').map((m) => title(m, 'A milestone'));
  const habits = list(op.habits, 'habits').map((h) => ({ title: title(h.title, 'A habit'), repeat: checkRepeat(h.repeat), ...planFields(h, 'habit') }));
  const targets = list(op.targets, 'targets').map((t) => {
    const unit = checkUnit(t.unit);
    return { title: title(t.title, 'A weekly target'), target: checkTarget(t.target, unit), unit, unitLabel: unit === 'count' ? str(t.unitLabel) : '', ...planFields(t, 'quota') };
  });
  const tasks = list(op.tasks, 'tasks').map((t) => ({ title: title(t.title, 'A task'), date: toDay(t.date ?? 'today', today), ...planFields(t, 'task') }));
  if (!g && !habits.length && !targets.length && !tasks.length) {
    throw new Error('A plan needs a goal or at least one habit, target or task');
  }
  const out = store.addPlan({ goal: g, milestones, habits, targets, tasks, source: CLAUDE });
  const parts = [
    g ? `goal ${q(g.title)}` : null,
    milestones.length ? plural(milestones.length, 'milestone') : null,
    habits.length ? plural(habits.length, 'habit') : null,
    targets.length ? plural(targets.length, 'target') : null,
    tasks.length ? plural(tasks.length, 'task') : null,
  ].filter(Boolean);
  const line = `Suggested plan: ${parts.join(', ')}`;
  return out.goal ? tagged(line, out.goal.id) : line;
}

// ---- Ticking and logging ----------------------------------------------------------------------

function tick(store, op, on) {
  const today = store.today();
  const { map, id, rec } = resolveId(store.doc(), op.id, ['items', 'milestones']);
  const word = on ? 'ticked' : 'unticked';
  if (map === 'milestones') {
    if (!!rec.done === on) return `milestone ${q(rec.title)} was already ${word}`;
    store.updateMilestone(id, { done: on });
    return `${on ? 'Ticked' : 'Unticked'} milestone ${q(rec.title)}`;
  }
  if (rec.type === 'quota') throw new Error(`${q(rec.title)} is a weekly target — use log with an amount`);
  if (rec.status !== 'active') throw new Error(`${q(rec.title)} is ${rec.status}, not on the list`);
  const day = toDay(op.day ?? 'today', today);
  const isDone = Object.values(store.doc().logs).some((l) =>
    l.itemId === id && l.kind === 'done' && l.day === day && l.status === 'active');
  if (isDone === on) return `${q(rec.title)} was already ${word} for ${dayName(day, today)}`;
  store.toggleDone(id, day, CLAUDE);
  return `${on ? 'Ticked' : 'Unticked'} ${q(rec.title)} for ${dayName(day, today)}`;
}

function log(store, op) {
  const today = store.today();
  const { map, id, rec } = resolveId(store.doc(), op.id, ['items', 'goals']);
  if (map === 'items' && rec.type !== 'quota') throw new Error(`${q(rec.title)} is a ${TYPE_NAMES[rec.type]} — use done to tick it`);
  if (map === 'goals' && !(rec.target > 0)) throw new Error(`${q(rec.title)} is measured by milestones, not an amount`);
  const unit = map === 'items' ? rec.unit ?? 'count' : 'count';
  const amount = unit === 'count' && typeof op.amount === 'number' ? op.amount : parseAmount(String(op.amount ?? ''), unit);
  if (!(amount > 0)) {
    throw new Error(unit === 'minutes' ? 'amount needs a time, like "45m", "1.5h" or "1h30"' : 'amount needs a number above 0');
  }
  const day = toDay(op.day ?? 'today', today);
  store.logAmount({ [map === 'items' ? 'itemId' : 'goalId']: id, amount, day, note: str(op.note), source: CLAUDE });
  return `Logged ${amountText(amount, unit, rec.unitLabel ?? '')} on ${q(rec.title)} for ${dayName(day, today)}`;
}

// ---- Editing ----------------------------------------------------------------------------------

const onlyFor = (type, message) => (rec) => { if (rec.type !== type) throw new Error(message); };

// Field → check(value, rec, store) returning the value to write. Anything not listed is refused.
const EDITABLE = {
  items: {
    title: (v) => title(v, 'An item'),
    date: (v, rec, store) => { onlyFor('task', 'Only a task has a date')(rec); return toDay(v, store.today()); },
    area: (v) => str(v),
    goalId: (v, rec, store) => goalOf(store, v),
    repeat: (v, rec) => { onlyFor('habit', 'Only a habit repeats')(rec); return checkRepeat(v); },
    target: (v, rec) => { onlyFor('quota', 'Only a weekly target has a target')(rec); return checkTarget(v, rec.unit ?? 'count'); },
    unitLabel: (v, rec) => { onlyFor('quota', 'Only a weekly target has a unit label')(rec); return str(v); },
    order: (v) => checkOrder(v),
    minutes: (v, rec) => { if (rec.type === 'quota') throw new Error('A weekly target has no length'); return lengthOf(v); },
    time: (v, rec) => { if (rec.type === 'quota') throw new Error('A weekly target has no time'); return clockOf(v); },
    notes: (v) => checkNotes(v),
    priority: (v, rec) => (v == null ? false : priorityOf(v, rec.type)),
    series: (v, rec) => { onlyFor('task', 'Only a task can be in a series')(rec); return seriesName(v); },
    // Keep this where it is: the planner leaves a pinned block alone, as if George had dragged it.
    pinned: (v, rec) => {
      onlyFor('task', 'Only a task can be pinned to a slot')(rec);
      if (typeof v !== 'boolean' && v != null) throw new Error('pinned is true or false');
      return v === true;
    },
  },
  goals: {
    title: (v) => title(v, 'A goal'),
    targetDate: (v, rec, store) => (v == null || v === '' ? null : toDay(v, store.today())),
    target: (v) => {
      if (v == null || v === '') return null;
      if (!(typeof v === 'number' && v > 0)) throw new Error('target needs a number above 0, or null to measure by milestones');
      return v;
    },
    unitLabel: (v) => str(v),
    why: (v) => str(v),
    order: (v) => checkOrder(v),
    notes: (v) => checkNotes(v),
  },
  milestones: {
    title: (v) => title(v, 'A milestone'),
    done: (v) => { if (typeof v !== 'boolean') throw new Error('done is true or false'); return v; },
    goalId: (v, rec, store) => { const g = goalOf(store, v); if (!g) throw new Error('A milestone needs a goal'); return g; },
    order: (v) => checkOrder(v),
  },
};

function show(value, field, store) {
  if (value == null || value === '') return 'none';
  if (field === 'goalId') return `goal ${q(store.doc().goals[value]?.title ?? value)}`;
  if (field === 'date' || field === 'targetDate') return dayName(value, store.today());
  if (field === 'repeat') return repeatText(value);
  if (field === 'minutes') return formatAmount(value, 'minutes');
  if (field === 'time') return value;
  if (typeof value === 'string') return q(value, 40);
  return JSON.stringify(value);
}

function edit(store, op) {
  const { map, id, rec } = resolveId(store.doc(), op.id, ['items', 'goals', 'milestones']);
  const rules = EDITABLE[map];
  const set = op.set;
  if (!set || typeof set !== 'object' || Array.isArray(set) || !Object.keys(set).length) {
    throw new Error('edit needs set: { "field": value, … }');
  }
  const changes = {};
  for (const [field, value] of Object.entries(set)) {
    const rule = Object.hasOwn(rules, field) ? rules[field] : null;
    if (!rule) throw new Error(`Can't edit ${field} on a ${noun(map, rec)} — editable: ${Object.keys(rules).join(', ')}`);
    changes[field] = rule(value, rec, store);
  }
  const update = { items: store.updateItem, goals: store.updateGoal, milestones: store.updateMilestone }[map];
  update(id, changes);
  const what = Object.keys(changes).map((f) => `${f} → ${show(changes[f], f, store)}`).join(', ');
  const moved = map === 'items' && ['date', 'time', 'series', 'order'].some((f) => f in changes);
  const offMaybe = map === 'items' && ['date', 'area'].some((f) => f in changes) ? offNote(store, id) : '';
  const pastMaybe = map === 'items' && ['date', 'time'].some((f) => f in changes) ? pastNote(store, id) : '';
  return `Edited ${noun(map, rec)} ${q(rec.title)}: ${what}${moved ? seriesNote(store, id) : ''}${offMaybe}${pastMaybe}`;
}

// ---- Archiving and suggestions ----------------------------------------------------------------

function logText(store, entry) {
  const doc = store.doc();
  const on = doc.items[entry.itemId] ?? doc.goals[entry.goalId];
  const what = entry.kind === 'done' ? 'tick' : `log of ${amountText(entry.amount, on?.unit ?? 'count', on?.unitLabel ?? '')}`;
  return `the ${what} on ${q(on?.title ?? '?')} for ${dayName(entry.day, store.today())}`;
}

function archive(store, op) {
  const { map, id, rec } = resolveId(store.doc(), op.id, ['items', 'goals', 'milestones', 'logs', 'flags']);
  if (rec.status === 'archived') {
    return map === 'logs'
      ? `${logText(store, rec)} was already removed`
      : `${noun(map, rec)} ${q(nameOf(rec))} was already ${map === 'flags' ? 'addressed' : 'archived'}`;
  }
  switch (map) {
    case 'logs':
      store.removeLog(id);
      return `Removed ${logText(store, rec)}`;
    case 'flags':
      store.addressFlag(id);
      return `Marked flag ${q(rec.text)} addressed`;
    case 'goals':
      store.archiveGoal(id);
      break;
    case 'milestones':
      store.archiveMilestone(id);
      break;
    default: {
      // Released: no longer needed, in George's own words — a task he'd committed to that's archived
      // with a reason doesn't count as a miss (js/schedule.js's dayScore). Only when he says so.
      const reason = str(op.released);
      if (reason.length > 200) throw new Error('A release reason is at most 200 characters');
      if (reason) store.updateItem(id, { released: reason });
      store.archiveItem(id);
      if (reason) return `Archived ${noun(map, rec)} ${q(rec.title)}, released: ${q(reason)}`;
    }
  }
  return `Archived ${noun(map, rec)} ${q(rec.title)}`;
}

function suggestion(store, op) {
  const found = resolveId(store.doc(), op.id, ['items', 'goals', 'milestones']);
  if (found.rec.status !== 'suggested') throw new Error(`${q(found.rec.title)} isn't a suggestion (it's ${found.rec.status})`);
  return found;
}

function accept(store, op) {
  const { map, id, rec } = suggestion(store, op);
  if (map === 'goals') store.acceptGoalPlan(id); else store.acceptSuggestion(map, id);
  return `Accepted suggested ${noun(map, rec)} ${q(rec.title)}${map === 'goals' ? ' and its milestones' : ''}`;
}

function dismiss(store, op) {
  const { map, id, rec } = suggestion(store, op);
  if (map === 'goals') store.dismissGoalPlan(id); else store.dismissSuggestion(map, id);
  return `Dismissed suggested ${noun(map, rec)} ${q(rec.title)}${map === 'goals' ? ' and everything proposed with it' : ''}`;
}

// ---- Flags and undo ---------------------------------------------------------------------------

function flag(store, op) {
  const text = str(op.text);
  if (!text) throw new Error('A flag needs text');
  // addFlag slices silently at the cap, which cut two long notes off mid-sentence in September
  // before anyone read them. brief refuses rather than cut; so does this.
  if (text.length > FLAG_TEXT_MAX) {
    throw new Error(`A flag can be at most ${FLAG_TEXT_MAX} characters — for anything longer, and for anything meant for whoever maintains the app, use handoff instead: it has no limit`);
  }
  // A note for George unless said otherwise; kind sorts it in his ⚑ panel.
  const kind = op.kind ?? 'note';
  if (!Object.hasOwn(FLAG_KINDS, kind)) throw new Error(`A flag's kind is one of: ${Object.keys(FLAG_KINDS).join(', ')}`);
  const rec = store.addFlag(text, null, CLAUDE, kind);
  return tagged(`Flagged ${q(rec.text)} as ${FLAG_KINDS[kind]}`, rec.id);
}

// A handoff is written to its own file rather than the document, so nothing is capped and nothing
// merges. Both this op and cli.js read the op through here, so the two can't drift apart: the op
// checks it and says so, cli.js takes the same values and does the write once every op has run.
export function readHandoff(op) {
  const title = str(op.title);
  if (!title) throw new Error('A handoff needs a title');
  const text = str(op.text);
  if (!text) throw new Error('A handoff needs text — and there is no length limit on it, so put the whole story in');
  return { title, text };
}

function handoff(store, op) {
  const { title } = readHandoff(op);
  return `Handoff ${q(title)}`;
}

function undo(store, op) {
  const { id, rec } = resolveId(store.doc(), op.change ?? op.id, ['changes']);
  return `${undoLine(store.undoChange(id, CLAUDE))} (${rec.summary})`;
}

// ---- The calendar planner ----------------------------------------------------------------------

const settingText = (field, value) => {
  if (field === 'hours') return `${value[0]}–${value[1]}`;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value.join(', ') || 'none';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

// Changes the planner's settings (js/calendar.js); every other setting is kept. areaCalendars,
// areaColors and dayHours change one key at a time (null removes a key). An area colour one of
// George's calendars already takes (the planner's status says which) is refused.
function planner(store, op) {
  const fields = Object.keys(op).filter((k) => k !== 'op');
  if (!fields.length) throw new Error('planner needs a setting to change, like {"op": "planner", "hours": ["08:30", "18:00"]}');
  const { config } = readPlannerConfig(store.doc());
  const changes = {};
  for (const field of fields) changes[field] = checkConfigField(field, mergeSetting(field, config[field], op[field]));
  if (changes.areaColors) {
    const taken = plannerStatus(store.doc())?.takenColors ?? [];
    const clash = Object.values(changes.areaColors).find((c) => taken.includes(c));
    if (clash) {
      const used = new Set([...taken, ...Object.values(changes.areaColors)]);
      const free = Object.keys(COLOR_NAMES).filter((n) => !used.has(n));
      throw new Error(`${clash} is already used by one of George's calendars — taken: ${taken.join(', ')}; free: ${free.join(', ')}`);
    }
  }
  store.putCalendar('config', { ...config, ...changes }, CLAUDE);
  const shown = (f) => (MERGED_SETTINGS.includes(f) ? JSON.stringify(op[f]) : settingText(f, changes[f]));
  return `Changed the planner's settings: ${fields.map((f) => `${f} → ${shown(f)}`).join(', ')}`;
}

// ---- Directing: time off and the brief ---------------------------------------------------------

// Time off: whole days ("2026-09-16", or today/tomorrow) or a stretch of hours ("2026-09-18T13:00"),
// for everything or some areas; or `cancel` one by its id.
function off(store, op) {
  const doc = store.doc();
  if (op.cancel != null) {
    const { id, rec } = resolveId(doc, op.cancel, ['calendar']);
    if (!id.startsWith('off:')) throw new Error(`${id} isn't time off`);
    if (rec.status !== 'active') return `Time off ${offText(rec)} was already cancelled`;
    store.putCalendar(id, { status: 'archived', archivedOn: store.today() }, CLAUDE);
    return `Cancelled time off: ${offText(rec)}`;
  }
  const today = store.today();
  const when = (v) => (v == null || /^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? v : toDay(v, today));
  const t = checkTimeOff({ start: when(op.start), end: when(op.end ?? op.start), areas: op.areas ?? [], reason: op.reason });
  const areas = [...new Set(Object.values(doc.items ?? {}).filter((i) => i.status === 'active').map((i) => String(i.area ?? '').trim()).filter(Boolean))];
  for (const a of t.areas) {
    if (!areas.some((x) => x.toLowerCase() === a.toLowerCase())) throw new Error(`No item has the area "${a}" — areas: ${areas.join(', ') || 'none yet'}`);
  }
  const id = nextOffId(doc, t.start);
  store.putCalendar(id, t, CLAUDE);
  return `Time off: ${offText(t)} · #${id}`;
}

// A date George is counting down to — the assessment centre, a birthday — shown in his Countdown
// widget; nothing is booked for it. `cancel` stops one, by its id.
function countdown(store, op) {
  const today = store.today();
  if (op.cancel != null) {
    const key = String(op.cancel).trim().replace(/^#/, '');
    const rec = key.startsWith('count:') ? store.doc().calendar[key] : null;
    if (!rec || rec.status !== 'active') throw new Error(`There's no countdown ${key} — the week read lists them with their ids`);
    store.putCalendar(key, { status: 'archived', archivedOn: today }, CLAUDE);
    return `Stopped counting down to ${q(rec.title)}`;
  }
  const c = checkCountdown({ title: op.title, day: op.day == null ? null : toDay(op.day, today) }, today);
  const id = nextCountdownId(store.doc(), c.day);
  store.putCalendar(id, c, CLAUDE);
  return `Counting down to ${q(c.title)} on ${dayName(c.day, today)} (${daysLeft(daysBetween(today, c.day))}) · #${id}`;
}

// Today's brief (or another day's): one or two lines on what matters and why.
function brief(store, op) {
  const text = str(op.text);
  if (!text) throw new Error('A brief needs text');
  if (text.length > 500) throw new Error('A brief can be at most 500 characters');
  const today = store.today();
  const day = toDay(op.day ?? 'today', today);
  store.saveJournal({ kind: 'brief', day, text }, CLAUDE);
  return `Brief for ${dayName(day, today)}: ${q(text, 80)}`;
}

// ---- Food ----------------------------------------------------------------------------------------

// Correct a meal Gemini got badly wrong, remove one logged twice (with a reason), move one to when it
// was eaten, save a usual meal, or set Fuel's protein target and maintenance calories.
function meal(store, op) {
  const amount = (v, what) => {
    if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0)) throw new Error(`meal needs ${what} as a number, 0 or more`);
    return Math.round(v);
  };
  if (op.id) {
    const { id, rec } = resolveId(store.doc(), op.id, ['meals']);
    if (rec.kind !== 'meal') throw new Error(`${op.id} isn't a meal`);
    const why = String(op.why ?? '').trim();
    if (op.remove === true) {
      if (!why) throw new Error('Removing a meal needs a why, e.g. "logged twice"');
      store.archiveMeal(id);
      return `Removed the meal ${q(rec.estimate?.name ?? rec.text ?? 'the meal')} (${why})`;
    }
    // Moved to when it was really eaten (logged the morning after): a day and a time of day, his time.
    if (op.time != null || op.day != null) {
      if (op.protein != null || op.kcal != null) throw new Error('Move a meal and correct it in two separate meal ops');
      const day = toDay(op.day ?? rec.day, store.today());
      const t = clockOf(op.time ?? new Date(rec.at).toTimeString().slice(0, 5));
      const [y, m, d] = day.split('-').map(Number);
      const [hh, mm] = t.split(':').map(Number);
      const at = new Date(y, m - 1, d, hh, mm);
      if (at > store.now()) throw new Error('A meal can’t be moved to a time that hasn’t come yet');
      store.retimeMeal(id, at);
      return `Moved ${q(rec.estimate?.name ?? rec.text ?? 'the meal')} to ${dayName(store.doc().meals[id].day, store.today())} at ${t}`;
    }
    if (!why) throw new Error('A correction needs a why: say what the estimate missed, e.g. "the oil and cheese"');
    const protein = amount(op.protein, 'protein');
    const kcal = amount(op.kcal, 'kcal');
    store.updateMeal(id, { correction: { by: 'claude', protein, kcal, why: why.slice(0, 200), at: store.now().toISOString() } });
    return `Corrected ${q(rec.estimate?.name ?? rec.text ?? 'the meal')} to ${protein} g protein, ${kcal} kcal`;
  }
  if (op.usual) {
    const u = store.saveUsual({ name: op.usual.name, protein: amount(op.usual.protein, 'protein'), kcal: amount(op.usual.kcal, 'kcal') });
    return `Saved the usual meal ${q(u.name)}: ${u.protein} g, ${u.kcal} kcal`;
  }
  if (op.fuel) {
    const changes = {};
    if (op.fuel.protein !== undefined) changes.protein = amount(op.fuel.protein, 'a protein target');
    if (op.fuel.maintenanceKcal !== undefined) changes.maintenanceKcal = op.fuel.maintenanceKcal === null ? null : amount(op.fuel.maintenanceKcal, 'maintenance kcal');
    if (!Object.keys(changes).length) throw new Error('meal fuel takes protein and/or maintenanceKcal');
    store.setFuel(changes);
    return `Changed Fuel: ${Object.entries(changes).map(([k, v]) => `${k} ${v}`).join(', ')}`;
  }
  throw new Error('meal needs an id to correct, a usual meal, or fuel settings — e.g. {"op": "meal", "id": "…", "protein": 35, "kcal": 1050, "why": "…"}');
}

// ---- The gym --------------------------------------------------------------------------------------

// The weekly target cardio minutes count towards: a live one in minutes, by title or id.
function cardioTarget(doc, ref) {
  const want = str(ref).toLowerCase();
  const byTitle = Object.values(doc.items).filter((i) => i.type === 'quota' && i.status === 'active' && i.title.trim().toLowerCase() === want);
  const { id, rec } = byTitle.length === 1 ? { id: byTitle[0].id, rec: byTitle[0] } : resolveId(doc, ref, ['items']);
  if (rec.type !== 'quota' || rec.unit !== 'minutes' || rec.status !== 'active') {
    throw new Error(`${q(rec.title)} isn't a live weekly target in minutes — add one first: {"op": "target", "title": "Cardio", "target": "150m", "unit": "minutes"}`);
  }
  return { id, rec };
}

// Hevy's settings (js/gym.js): key lifts, lift targets (one lift per op; null removes), the weekly
// target cardio minutes count towards, and the habit a workout ticks. Nothing here reaches Hevy.
function gym(store, op) {
  const fields = Object.keys(op).filter((k) => k !== 'op');
  if (!fields.length) throw new Error('gym needs a setting, like {"op": "gym", "cardioQuota": "Cardio"}');
  const doc = store.doc();
  const next = gymConfig(doc);
  const said = [];
  for (const field of fields) {
    const v = op[field];
    if (field === 'keyLifts') {
      if (!Array.isArray(v) || !v.length || !v.every((x) => typeof x === 'string' && x.trim())) {
        throw new Error('keyLifts is a list of Hevy exercise names, like ["Squat (Barbell)", "Bench Press (Barbell)"]');
      }
      next.keyLifts = [...new Set(v.map((x) => x.trim()))];
      said.push(`key lifts → ${next.keyLifts.join(', ')}`);
    } else if (field === 'liftTargets') {
      if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== 1) {
        throw new Error('liftTargets changes one lift at a time, like {"Squat (Barbell)": 120} (null removes it)');
      }
      const [[lift, kg]] = Object.entries(v);
      const targets = { ...next.liftTargets };
      const key = Object.keys(targets).find((k) => k.toLowerCase() === lift.trim().toLowerCase()) ?? lift.trim();
      if (kg == null) {
        delete targets[key];
        said.push(`${key} target removed`);
      } else {
        if (!(typeof kg === 'number' && kg > 0 && kg <= 500)) throw new Error('A lift target is an estimated 1RM in kg, above 0 and at most 500');
        targets[key] = kg;
        said.push(`${key} target → ${kg} kg`);
      }
      next.liftTargets = targets;
    } else if (field === 'cardioQuota') {
      if (v == null || v === '') {
        next.cardioQuota = null;
        said.push('cardio minutes → no target');
      } else {
        const { id, rec } = cardioTarget(doc, v);
        next.cardioQuota = id;
        said.push(`cardio minutes → ${q(rec.title)}`);
      }
    } else if (field === 'habit') {
      const t = str(v);
      const id = t ? gymHabitId(doc, { ...next, habit: t }) : null;
      if (!id) throw new Error(`No single live habit is "${t}" (by id or the start of its title)`);
      next.habit = t;
      said.push(`workouts tick ${q(doc.items[id].title)}`);
    } else {
      throw new Error(`Unknown gym setting ${field} — settings: keyLifts, liftTargets, cardioQuota, habit`);
    }
  }
  store.putGym('config', next, CLAUDE);
  return `Changed the gym settings: ${said.join(', ')}`;
}

// A training session on a dated task (js/coach.js): on a task by id, on a new gym task by date
// (Health, 75 minutes), or cleared with null. The planner puts it into Hevy as a routine.
function session(store, op) {
  const doc = store.doc();
  const today = store.today();
  if (op.session === null) {
    if (!op.id) throw new Error('Clearing a session needs the id of its task');
    const { id, rec } = resolveId(doc, op.id, ['items']);
    store.setSession(id, null);
    return tagged(`Cleared the session on ${q(rec.title)}`, id);
  }
  if (op.id == null && op.date == null) {
    throw new Error('session needs a date or an id — e.g. {"op": "session", "date": "2026-10-21", "session": {"name": "Legs A", "exercises": [...]}}');
  }
  if (op.id != null && (op.date != null || op.time != null)) {
    const set = Object.entries({ date: op.date, time: op.time }).filter(([, v]) => v != null).map(([k, v]) => `"${k}": ${JSON.stringify(v)}`).join(', ');
    throw new Error(`With an id the session goes on that task as it is — move the task with {"op": "edit", "id": ${JSON.stringify(String(op.id))}, "set": {${set}}} first, then give the session without a date or time`);
  }
  const date = op.id ? null : toDay(op.date, today);
  if (date && date < today) throw new Error(`${dayName(date, today)} is in the past — a session goes on today or a day ahead`);
  const target = op.id ? resolveId(doc, op.id, ['items']) : null;
  if (target && (target.rec.type !== 'task' || target.rec.status !== 'active')) {
    throw new Error(`${q(target.rec.title)} isn't a dated task — a session goes on a task, or give a date to make one`);
  }
  const templates = templatesOf(doc);
  if (!Object.keys(templates).length) {
    throw new Error("Hevy's exercise list isn't on the dashboard yet — the planner fetches it on its next run once HEVY_KEY is set (see `gym`)");
  }
  const s = checkSession(op.session, templates);
  if (notesWith(target?.rec ?? {}, s).length > NOTES_MAX) throw new Error(`That session and the task's notes are too long to show in the calendar (${NOTES_MAX} characters) — shorten the notes`);
  const count = `(${s.exercises.length} exercise${s.exercises.length === 1 ? '' : 's'})`;
  if (target) {
    const { id, rec } = target;
    store.setSession(id, s);
    return tagged(`Set session ${q(s.name)} on ${q(rec.title)} ${dayName(rec.date, today)}${rec.time ? ` at ${rec.time}` : ''} ${count}`, id);
  }
  const time = clockOf(op.time);
  const rec = store.addItem({
    type: 'task', title: op.title == null ? `Gym · ${s.name}` : title(op.title, 'A session task'), date,
    area: 'Health', goalId: null, status: 'active', source: CLAUDE, minutes: 75, ...(time ? { time } : {}),
  });
  store.setSession(rec.id, s);
  return tagged(`Added session ${q(s.name)} on ${dayName(rec.date, today)}${time ? ` at ${time}` : ''} ${count}`, rec.id);
}

// What each op actually reads. A key that isn't here is dropped without a word, which is the worst
// thing that can happen to a model working from a half-remembered shape: it reports a length it
// never set and George never finds out. planner and gym check their own fields and say so
// themselves, so they are deliberately not listed here.
export const FIELDS = {
  details: ['id', 'set'],
  meal: ['id', 'protein', 'kcal', 'why', 'remove', 'day', 'time', 'usual', 'fuel'],
  session: ['id', 'date', 'time', 'title', 'session'],
  rule: ['id', 'title', 'enabled', 'definition'],
  report: ['id', 'answers', 'day', 'complete', 'reported', 'reportId'],
  review: ['id'],
  task: ['title', 'date', 'area', 'goal', 'minutes', 'time', 'notes', 'priority', 'series', 'order', 'suggest', 'details'],
  habit: ['title', 'repeat', 'area', 'goal', 'minutes', 'time', 'notes', 'priority', 'suggest', 'details'],
  target: ['title', 'target', 'unit', 'unitLabel', 'area', 'goal', 'notes', 'suggest', 'details'],
  goal: ['title', 'targetDate', 'why', 'milestones', 'notes', 'suggest', 'details'],
  milestone: ['goal', 'title', 'suggest'],
  plan: ['goal', 'milestones', 'tasks', 'habits', 'targets'],
  done: ['id', 'day'],
  undone: ['id', 'day'],
  log: ['id', 'amount', 'day', 'note'],
  edit: ['id', 'set'],
  archive: ['id', 'released'],
  accept: ['id'],
  dismiss: ['id'],
  flag: ['text', 'kind'],
  handoff: ['title', 'text'],
  undo: ['change', 'id'],
  off: ['start', 'end', 'areas', 'reason', 'cancel'],
  brief: ['text', 'day'],
  countdown: ['title', 'day', 'cancel'],
};

// Plan entries retain the same practical controls as their standalone counterparts.
const PLAN_FIELDS = {
  goal: ['title', 'targetDate', 'why', 'notes', 'details'],
  tasks: ['title', 'date', 'area', 'minutes', 'time', 'notes', 'priority', 'series', 'details'],
  habits: ['title', 'repeat', 'area', 'minutes', 'time', 'notes', 'priority', 'details'],
  targets: ['title', 'target', 'unit', 'unitLabel', 'area', 'notes', 'details'],
};

const noteFor = (key, what, allowed) => `Note: ${JSON.stringify(key)} isn't a field on ${what} — ignored. ${what} takes: ${allowed.join(', ')}.`;

const unknownIn = (obj, fields, what, out) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const key of Object.keys(obj)) if (key !== 'op' && !fields.includes(key)) out.push(noteFor(key, what, fields));
};

// Warnings, never refusals: an op that works today must go on working. The note is what turns a
// silent wrong success into something a model can act on.
// The shapes models reach for that mean one thing only, read as that thing. The trail showed an
// edit with its fields loose beside the id, not in set, refused eleven times; and goalId for goal.
export function plainOp(op) {
  if (!op || typeof op !== 'object' || Array.isArray(op)) return op;
  if (op.op === 'edit' && op.set === undefined) {
    const { op: _, id, ...loose } = op;
    if (Object.keys(loose).length) return { op: 'edit', id, set: loose };
  }
  if (['task', 'habit', 'target'].includes(op.op) && op.goalId !== undefined && op.goal === undefined) {
    const { goalId, ...rest } = op;
    return { ...rest, goal: goalId };
  }
  return op;
}

export function fieldWarnings(raw) {
  const op = plainOp(raw);
  if (!op || typeof op !== 'object' || Array.isArray(op)) return [];
  const allowed = FIELDS[op.op];
  if (!allowed) return [];
  const out = [];
  unknownIn(op, allowed, op.op, out);
  if (op.op === 'plan') {
    for (const [part, fields] of Object.entries(PLAN_FIELDS)) {
      const members = part === 'goal' ? [op.goal] : (Array.isArray(op[part]) ? op[part] : []);
      const what = `a plan's ${part === 'goal' ? 'goal' : part.replace(/s$/, '')}`;
      for (const m of members) unknownIn(m, fields, what, out);
    }
  }
  return out;
}

export const OPS = {
  task, habit, target, goal, milestone, plan,
  done: (store, op) => tick(store, op, true),
  undone: (store, op) => tick(store, op, false),
  log, edit, archive, accept, dismiss, flag, handoff, undo, planner, off, brief, countdown, gym,
  details, rule, report, review, meal, session,
};

// undo marks the change it undoes rather than being logged as a change of its own; a handoff
// changes no record at all, so there is nothing for George to see or undo.
export const UNLOGGED = new Set(['undo', 'handoff']);

export function runOp(store, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each op is an object like {"op": "task", "title": "…"}');
  const op = plainOp(raw);
  const fn = Object.hasOwn(OPS, op.op) ? OPS[op.op] : null;
  if (!fn) throw new Error(`Unknown op ${JSON.stringify(op.op)} — ops: ${Object.keys(OPS).join(', ')}`);
  if (['details', 'rule', 'report', 'review'].includes(op.op)) {
    const warnings = fieldWarnings(op);
    if (warnings.length) throw new Error(warnings.join(' '));
  }
  return fn(store, op);
}
