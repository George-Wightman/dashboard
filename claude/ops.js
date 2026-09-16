// The tool's changes. An op is a plain object from Claude's JSON ({ "op": "task", "title": … });
// runOp checks it, runs it through the store's own methods, and returns the one line Claude
// reports. Every check happens before the store is touched, so a bad op throws a plain-English
// error and changes nothing. What Claude adds is marked source 'claude'.

import { parseAmount, parseLength, parseClock, formatAmount, checkNotes } from '../js/parse.js';
import { undoLine } from '../js/changes.js';
import {
  checkConfigField, readPlannerConfig, mergeSetting, MERGED_SETTINGS, plannerStatus, COLOR_NAMES, checkTimeOff, nextOffId, offText,
} from '../js/calendar.js';
import { gymConfig, gymHabitId } from '../js/gym.js';
import { FLAG_TEXT_MAX } from '../js/flags.js';
import { GUIDE_MAX } from '../js/talk.js';
import { weekStart } from '../js/dates.js';
import { resolveId, shortId } from './ids.js';
import { q, dayName, toDay, TYPE_NAMES, repeatText, amountText } from './text.js';

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

function task(store, op) {
  const today = store.today();
  const minutes = lengthOf(op.minutes);
  const time = clockOf(op.time);
  const notes = notesOf(op.notes);
  const priority = priorityOf(op.priority, 'task');
  const rec = store.addItem({
    type: 'task', title: title(op.title, 'A task'), date: toDay(op.date ?? 'today', today),
    area: str(op.area), goalId: goalOf(store, op.goal), status: statusOf(op), source: CLAUDE,
    ...(minutes ? { minutes } : {}), ...(time ? { time } : {}), ...(notes ? { notes } : {}), ...(priority ? { priority } : {}),
  });
  return tagged(`${verb(op)} task ${q(rec.title)} for ${dayName(rec.date, today)}${timing(rec)}${rec.priority ? ' ★' : ''}`, rec.id);
}

function habit(store, op) {
  if (op.time != null && op.time !== '') throw new Error('Only a task has a time');
  const minutes = lengthOf(op.minutes);
  const notes = notesOf(op.notes);
  const priority = priorityOf(op.priority, 'habit');
  const rec = store.addItem({
    type: 'habit', title: title(op.title, 'A habit'), repeat: checkRepeat(op.repeat),
    area: str(op.area), goalId: goalOf(store, op.goal), status: statusOf(op), source: CLAUDE,
    ...(minutes ? { minutes } : {}), ...(notes ? { notes } : {}), ...(priority ? { priority } : {}),
  });
  const length = rec.minutes ? `, ${formatAmount(rec.minutes, 'minutes')}` : '';
  return tagged(`${verb(op)} habit ${q(rec.title)} (${repeatText(rec.repeat)}${length})${rec.priority ? ' ★' : ''}`, rec.id);
}

function target(store, op) {
  const unit = checkUnit(op.unit);
  const notes = notesOf(op.notes);
  const rec = store.addItem({
    type: 'quota', title: title(op.title, 'A weekly target'), target: checkTarget(op.target, unit), unit,
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
  if (op.suggest) {
    const out = store.addPlan({ goal: { title: t, targetDate, why }, milestones, source: CLAUDE });
    return tagged(`Suggested goal ${q(t)}${count}`, out.goal.id);
  }
  const notes = notesOf(op.notes);
  const rec = store.addGoal({ title: t, targetDate, why, source: CLAUDE, ...(notes ? { notes } : {}) });
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
  };
  const milestones = list(op.milestones, 'milestones').map((m) => title(m, 'A milestone'));
  const habits = list(op.habits, 'habits').map((h) => ({ title: title(h.title, 'A habit'), repeat: checkRepeat(h.repeat) }));
  const targets = list(op.targets, 'targets').map((t) => {
    const unit = checkUnit(t.unit);
    return { title: title(t.title, 'A weekly target'), target: checkTarget(t.target, unit), unit, unitLabel: unit === 'count' ? str(t.unitLabel) : '' };
  });
  const tasks = list(op.tasks, 'tasks').map((t) => ({ title: title(t.title, 'A task'), date: toDay(t.date ?? 'today', today) }));
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
    time: (v, rec) => { onlyFor('task', 'Only a task has a time')(rec); return clockOf(v); },
    notes: (v) => checkNotes(v),
    priority: (v, rec) => (v == null ? false : priorityOf(v, rec.type)),
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
  return `Edited ${noun(map, rec)} ${q(rec.title)}: ${what}`;
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
    default:
      store.archiveItem(id);
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
  // before anyone read them. brief and guide both refuse rather than cut; so does this.
  if (text.length > FLAG_TEXT_MAX) {
    throw new Error(`A flag can be at most ${FLAG_TEXT_MAX} characters — for anything longer, and for anything meant for whoever maintains the app, use handoff instead: it has no limit`);
  }
  const rec = store.addFlag(text, null, CLAUDE);
  return tagged(`Flagged ${q(rec.text)}`, rec.id);
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

// The Coach's guide for a week (a few lines on what to focus on and ask about), given to it every
// time it talks with George. Filed under the week's Monday; writing one again replaces it.
function guide(store, op) {
  const text = str(op.text);
  if (!text) throw new Error('A guide needs text');
  if (text.length > GUIDE_MAX) throw new Error(`A guide can be at most ${GUIDE_MAX} characters`);
  const today = store.today();
  const monday = weekStart(toDay(op.week ?? 'today', today));
  store.saveJournal({ kind: 'guide', day: monday, text }, CLAUDE);
  return `Guide for the Coach, week of ${dayName(monday, today)}: ${q(text, 80)}`;
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

export const OPS = {
  task, habit, target, goal, milestone, plan,
  done: (store, op) => tick(store, op, true),
  undone: (store, op) => tick(store, op, false),
  log, edit, archive, accept, dismiss, flag, handoff, undo, planner, off, brief, gym, guide,
};

// undo marks the change it undoes rather than being logged as a change of its own; a handoff
// changes no record at all, so there is nothing for George to see or undo.
export const UNLOGGED = new Set(['undo', 'handoff']);

export function runOp(store, op) {
  if (!op || typeof op !== 'object' || Array.isArray(op)) throw new Error('Each op is an object like {"op": "task", "title": "…"}');
  const fn = Object.hasOwn(OPS, op.op) ? OPS[op.op] : null;
  if (!fn) throw new Error(`Unknown op ${JSON.stringify(op.op)} — ops: ${Object.keys(OPS).join(', ')}`);
  return fn(store, op);
}
