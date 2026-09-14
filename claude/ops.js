// The tool's changes. An op is a plain object from Claude's JSON ({ "op": "task", "title": … });
// runOp checks it, runs it through the store's own methods, and returns the one line Claude
// reports. Every check happens before the store is touched, so a bad op throws a plain-English
// error and changes nothing. What Claude adds is marked source 'claude'.

import { parseAmount, parseLength, parseClock, formatAmount } from '../js/parse.js';
import { undoLine } from '../js/changes.js';
import { checkConfigField, readPlannerConfig } from '../js/calendar.js';
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
  const rec = store.addItem({
    type: 'task', title: title(op.title, 'A task'), date: toDay(op.date ?? 'today', today),
    area: str(op.area), goalId: goalOf(store, op.goal), status: statusOf(op), source: CLAUDE,
    ...(minutes ? { minutes } : {}), ...(time ? { time } : {}),
  });
  return tagged(`${verb(op)} task ${q(rec.title)} for ${dayName(rec.date, today)}${timing(rec)}`, rec.id);
}

function habit(store, op) {
  if (op.time != null && op.time !== '') throw new Error('Only a task has a time');
  const minutes = lengthOf(op.minutes);
  const rec = store.addItem({
    type: 'habit', title: title(op.title, 'A habit'), repeat: checkRepeat(op.repeat),
    area: str(op.area), goalId: goalOf(store, op.goal), status: statusOf(op), source: CLAUDE,
    ...(minutes ? { minutes } : {}),
  });
  const length = rec.minutes ? `, ${formatAmount(rec.minutes, 'minutes')}` : '';
  return tagged(`${verb(op)} habit ${q(rec.title)} (${repeatText(rec.repeat)}${length})`, rec.id);
}

function target(store, op) {
  const unit = checkUnit(op.unit);
  const rec = store.addItem({
    type: 'quota', title: title(op.title, 'A weekly target'), target: checkTarget(op.target, unit), unit,
    unitLabel: unit === 'count' ? str(op.unitLabel) : '', area: str(op.area), goalId: goalOf(store, op.goal),
    status: statusOf(op), source: CLAUDE,
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
  const rec = store.addGoal({ title: t, targetDate, why, source: CLAUDE });
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
  const rec = store.addFlag(text, null, CLAUDE);
  return tagged(`Flagged ${q(rec.text)}`, rec.id);
}

function undo(store, op) {
  const { id, rec } = resolveId(store.doc(), op.change ?? op.id, ['changes']);
  return `${undoLine(store.undoChange(id, CLAUDE))} (${rec.summary})`;
}

// ---- The calendar planner ----------------------------------------------------------------------

const settingText = (field, value) => (field === 'hours' ? `${value[0]}–${value[1]}` : typeof value === 'object' ? JSON.stringify(value) : String(value));

// Changes the planner's settings (js/calendar.js); every other setting is kept.
function planner(store, op) {
  const fields = Object.keys(op).filter((k) => k !== 'op');
  if (!fields.length) throw new Error('planner needs a setting to change, like {"op": "planner", "hours": ["08:30", "18:00"]}');
  const changes = {};
  for (const field of fields) changes[field] = checkConfigField(field, op[field]);
  const { config } = readPlannerConfig(store.doc());
  store.putCalendar('config', { ...config, ...changes }, CLAUDE);
  return `Changed the planner's settings: ${fields.map((f) => `${f} → ${settingText(f, changes[f])}`).join(', ')}`;
}

export const OPS = {
  task, habit, target, goal, milestone, plan,
  done: (store, op) => tick(store, op, true),
  undone: (store, op) => tick(store, op, false),
  log, edit, archive, accept, dismiss, flag, undo, planner,
};

// undo marks the change it undoes rather than being logged as a change of its own.
export const UNLOGGED = new Set(['undo']);

export function runOp(store, op) {
  if (!op || typeof op !== 'object' || Array.isArray(op)) throw new Error('Each op is an object like {"op": "task", "title": "…"}');
  const fn = Object.hasOwn(OPS, op.op) ? OPS[op.op] : null;
  if (!fn) throw new Error(`Unknown op ${JSON.stringify(op.op)} — ops: ${Object.keys(OPS).join(', ')}`);
  return fn(store, op);
}
