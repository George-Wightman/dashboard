# Task 5: Changing the dashboard

**Files:**
- Create: `claude/ops.js`
- Test: `tests/claude-ops.test.js`

**Interfaces:**
- Consumes: the store (Tasks 1–2: `addItem`, `addGoal`, `addMilestone(goalId, title, { source, status })`,
  `addPlan({ …, source })`, `toggleDone(itemId, day, source)`, `logAmount({ …, source })`, `updateItem`,
  `updateGoal`, `updateMilestone`, `archiveItem`, `archiveGoal`, `archiveMilestone`, `removeLog`,
  `addressFlag`, `acceptSuggestion`, `dismissSuggestion`, `acceptGoalPlan`, `dismissGoalPlan`,
  `addFlag(text, ctx, source)`, `undoChange(id, by)`); `resolveId, shortId` (Task 4); `q, dayName, toDay,
  TYPE_NAMES, repeatText, amountText` (Task 4); `parseAmount` (`js/parse.js`); `undoLine`
  (`js/changes.js`).
- Produces: `OPS` (keys in this order: `task, habit, target, goal, milestone, plan, done, undone, log,
  edit, archive, accept, dismiss, flag, undo`), `UNLOGGED = new Set(['undo'])`, `runOp(store, op)` →
  summary string. Task 6 runs ops through `runOp`; Task 7's `reference.md` documents every key of `OPS`.

- [ ] **Step 1: Write the failing tests** — create `tests/claude-ops.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore } from './helpers.js';
import { OPS, UNLOGGED, runOp } from '../claude/ops.js';
import { diffDocs } from '../js/changes.js';

// ids rec-1, rec-2, …; the helpers' clock makes today Thursday 10 Sep 2026.
const fresh = () => makeStore({ prefix: 'rec-' });
const pick = (r) => ({ type: r.type, title: r.title, date: r.date, status: r.status, source: r.source });

test("runOp refuses what isn't an op", () => {
  const s = fresh();
  assert.throws(() => runOp(s, null), /Each op is an object/);
  assert.throws(() => runOp(s, { op: 'fly' }),
    /Unknown op "fly" — ops: task, habit, target, goal, milestone, plan, done, undone, log, edit, archive, accept, dismiss, flag, undo/);
  assert.deepEqual(Object.keys(OPS), ['task', 'habit', 'target', 'goal', 'milestone', 'plan', 'done', 'undone', 'log', 'edit', 'archive', 'accept', 'dismiss', 'flag', 'undo']);
  assert.deepEqual([...UNLOGGED], ['undo']);
});

test('task: active and from Claude by default, a suggestion when asked, checked before anything is written', () => {
  const s = fresh();
  assert.equal(runOp(s, { op: 'task', title: ' Email Sarah ' }), 'Added task "Email Sarah" for today · #rec-1');
  assert.deepEqual(pick(s.doc().items['rec-1']), { type: 'task', title: 'Email Sarah', date: '2026-09-10', status: 'active', source: 'claude' });
  assert.equal(runOp(s, { op: 'task', title: 'Dentist', date: 'tomorrow', suggest: true }), 'Suggested task "Dentist" for Fri 11 Sep · #rec-2');
  assert.equal(s.doc().items['rec-2'].status, 'suggested');
  const before = JSON.stringify(s.doc());
  assert.throws(() => runOp(s, { op: 'task', title: '  ' }), /A task needs a title/);
  assert.throws(() => runOp(s, { op: 'task', title: 'x', date: 'friday' }), /isn't a date/);
  assert.throws(() => runOp(s, { op: 'task', title: 'x', goal: 'nope' }), /Nothing has the id nope/);
  assert.equal(JSON.stringify(s.doc()), before);
});

test('habit and target', () => {
  const s = fresh();
  assert.equal(runOp(s, { op: 'habit', title: 'Gym', repeat: { kind: 'weekdays', days: [5, 1, 3] } }), 'Added habit "Gym" (on Mon, Wed, Fri) · #rec-1');
  assert.deepEqual(s.doc().items['rec-1'].repeat, { kind: 'weekdays', days: [1, 3, 5] });
  assert.equal(runOp(s, { op: 'habit', title: 'Read' }), 'Added habit "Read" (every day) · #rec-2');
  assert.throws(() => runOp(s, { op: 'habit', title: 'x', repeat: { kind: 'perWeek', n: 9 } }), /perWeek needs n/);
  assert.throws(() => runOp(s, { op: 'habit', title: 'x', repeat: { kind: 'hourly' } }), /Unknown repeat kind "hourly"/);
  assert.equal(runOp(s, { op: 'target', title: 'Hebrew', target: '5h', unit: 'minutes' }), 'Added weekly target "Hebrew" (5h a week) · #rec-3');
  assert.equal(s.doc().items['rec-3'].target, 300);
  assert.equal(runOp(s, { op: 'target', title: 'Applications', target: 5, unitLabel: 'applications' }),
    'Added weekly target "Applications" (5 applications a week) · #rec-4');
  assert.throws(() => runOp(s, { op: 'target', title: 'x', target: 0 }), /target needs a number above 0/);
  assert.throws(() => runOp(s, { op: 'target', title: 'x', target: '5h', unit: 'hours' }), /unit is "count" or "minutes"/);
});

test('goal, milestone and plan', () => {
  const s = fresh();
  assert.equal(runOp(s, { op: 'goal', title: 'Research job', targetDate: '2026-12-01', milestones: ['CV', 'Apply'] }),
    'Added goal "Research job" with 2 milestones · #rec-1');
  assert.equal(s.doc().goals['rec-1'].source, 'claude');
  assert.deepEqual(Object.values(s.doc().milestones).map((m) => [m.title, m.goalId, m.source, m.status]),
    [['CV', 'rec-1', 'claude', 'active'], ['Apply', 'rec-1', 'claude', 'active']]);
  assert.equal(runOp(s, { op: 'milestone', goal: 'rec-1', title: 'Interview' }), 'Added milestone "Interview" on "Research job" · #rec-4');
  assert.throws(() => runOp(s, { op: 'milestone', title: 'x' }), /A milestone needs goal/);
  assert.throws(() => runOp(s, { op: 'goal', title: 'x', milestones: 'CV' }), /milestones should be a list/);
  const plan = runOp(s, {
    op: 'plan', goal: { title: 'NatCen application', targetDate: '2026-10-01' },
    milestones: ['Research', 'Draft', 'Submit'], tasks: [{ title: 'Read the job pack', date: 'tomorrow' }],
  });
  assert.match(plan, /^Suggested plan: goal "NatCen application", 3 milestones, 1 task · #rec-\d+$/);
  const planGoal = Object.values(s.doc().goals).find((g) => g.title === 'NatCen application');
  assert.equal(planGoal.status, 'suggested');
  assert.equal(planGoal.source, 'claude');
  assert.equal(Object.values(s.doc().items).find((i) => i.title === 'Read the job pack').date, '2026-09-11');
  assert.throws(() => runOp(s, { op: 'plan' }), /A plan needs a goal or at least one habit, target or task/);
  assert.match(runOp(s, { op: 'goal', title: 'Maybe', suggest: true, milestones: ['one'] }), /^Suggested goal "Maybe" with 1 milestone · #/);
});

test('done and undone tick tasks, habits and milestones, and say when there was nothing to do', () => {
  const s = fresh();
  const t = s.addItem({ type: 'task', title: 'CV' });
  assert.equal(runOp(s, { op: 'done', id: t.id }), 'Ticked "CV" for today');
  assert.equal(Object.values(s.doc().logs)[0].source, 'claude');
  assert.equal(runOp(s, { op: 'done', id: t.id }), '"CV" was already ticked for today');
  assert.equal(runOp(s, { op: 'undone', id: t.id }), 'Unticked "CV" for today');
  assert.equal(runOp(s, { op: 'undone', id: t.id }), '"CV" was already unticked for today');
  const h = s.addItem({ type: 'habit', title: 'Read' });
  assert.equal(runOp(s, { op: 'done', id: h.id, day: 'yesterday' }), 'Ticked "Read" for Wed 9 Sep');
  const quota = s.addItem({ type: 'quota', title: 'Apps', target: 3 });
  assert.throws(() => runOp(s, { op: 'done', id: quota.id }), /is a weekly target — use log/);
  const g = s.addGoal({ title: 'G' });
  const m = s.addMilestone(g.id, 'M');
  assert.equal(runOp(s, { op: 'done', id: m.id }), 'Ticked milestone "M"');
  assert.equal(s.doc().milestones[m.id].done, true);
  assert.equal(runOp(s, { op: 'done', id: m.id }), 'milestone "M" was already ticked');
});

test('log adds an amount to a weekly target, or to a goal measured by a number', () => {
  const s = fresh();
  const heb = s.addItem({ type: 'quota', title: 'Hebrew', target: 300, unit: 'minutes' });
  assert.equal(runOp(s, { op: 'log', id: heb.id, amount: '45m' }), 'Logged 45m on "Hebrew" for today');
  const log = Object.values(s.doc().logs)[0];
  assert.deepEqual([log.amount, log.source, log.itemId], [45, 'claude', heb.id]);
  assert.equal(runOp(s, { op: 'log', id: heb.id, amount: '1h30', day: 'yesterday', note: 'podcast' }), 'Logged 1.5h on "Hebrew" for Wed 9 Sep');
  const apps = s.addItem({ type: 'quota', title: 'Apps', target: 5, unitLabel: 'applications' });
  assert.equal(runOp(s, { op: 'log', id: apps.id, amount: 2 }), 'Logged 2 applications on "Apps" for today');
  const saved = s.addGoal({ title: 'Savings', target: 1000, unitLabel: '£' });
  assert.equal(runOp(s, { op: 'log', id: saved.id, amount: 50 }), 'Logged 50 £ on "Savings" for today');
  const habit = s.addItem({ type: 'habit', title: 'Read' });
  assert.throws(() => runOp(s, { op: 'log', id: habit.id, amount: 1 }), /is a habit — use done/);
  assert.throws(() => runOp(s, { op: 'log', id: heb.id, amount: 'lots' }), /amount needs a time/);
  const plain = s.addGoal({ title: 'Plain' });
  assert.throws(() => runOp(s, { op: 'log', id: plain.id, amount: 1 }), /measured by milestones/);
});

test('edit changes the fields it knows, refuses the rest, and says what it changed', () => {
  const s = fresh();
  const t = s.addItem({ type: 'task', title: 'CV' });
  const g = s.addGoal({ title: 'Job' });
  assert.equal(runOp(s, { op: 'edit', id: t.id, set: { title: 'Update CV', date: '2026-09-18', goalId: g.id } }),
    'Edited task "CV": title → "Update CV", date → Fri 18 Sep, goalId → goal "Job"');
  assert.equal(s.doc().items[t.id].title, 'Update CV');
  assert.throws(() => runOp(s, { op: 'edit', id: t.id, set: { repeat: { kind: 'daily' } } }), /Only a habit repeats/);
  assert.throws(() => runOp(s, { op: 'edit', id: t.id, set: { status: 'archived' } }),
    /Can't edit status on a task — editable: title, date, area, goalId, repeat, target, unitLabel, order/);
  assert.throws(() => runOp(s, { op: 'edit', id: t.id, set: {} }), /edit needs set/);
  const m = s.addMilestone(g.id, 'M');
  assert.equal(runOp(s, { op: 'edit', id: m.id, set: { done: true } }), 'Edited milestone "M": done → true');
  assert.equal(runOp(s, { op: 'edit', id: g.id, set: { targetDate: null, why: 'Money' } }), 'Edited goal "Job": targetDate → none, why → "Money"');
});

test('archive, accept and dismiss', () => {
  const s = fresh();
  const t = s.addItem({ type: 'task', title: 'Old' });
  assert.equal(runOp(s, { op: 'archive', id: t.id }), 'Archived task "Old"');
  assert.equal(s.doc().items[t.id].status, 'archived');
  assert.equal(runOp(s, { op: 'archive', id: t.id }), 'task "Old" was already archived');
  const f = s.addFlag('Too small');
  assert.equal(runOp(s, { op: 'archive', id: f.id }), 'Marked flag "Too small" addressed');
  const quota = s.addItem({ type: 'quota', title: 'Apps', target: 3, unitLabel: 'applications' });
  const l = s.logAmount({ itemId: quota.id, amount: 2 });
  assert.equal(runOp(s, { op: 'archive', id: l.id }), 'Removed the log of 2 applications on "Apps" for today');
  const plan = s.addPlan({ goal: { title: 'G' }, milestones: ['M'], tasks: [{ title: 'T' }], source: 'claude' });
  assert.equal(runOp(s, { op: 'accept', id: plan.items[0].id }), 'Accepted suggested task "T"');
  assert.equal(runOp(s, { op: 'accept', id: plan.goal.id }), 'Accepted suggested goal "G" and its milestones');
  assert.equal(s.doc().milestones[plan.milestones[0].id].status, 'active');
  assert.throws(() => runOp(s, { op: 'accept', id: t.id }), /isn't a suggestion \(it's archived\)/);
  const p2 = s.addPlan({ tasks: [{ title: 'U' }], source: 'claude' });
  assert.equal(runOp(s, { op: 'dismiss', id: p2.items[0].id }), 'Dismissed suggested task "U"');
  assert.equal(s.doc().items[p2.items[0].id].status, 'dismissed');
});

test('flag and undo', () => {
  const s = fresh();
  assert.equal(runOp(s, { op: 'flag', text: 'The week bars overlap' }), 'Flagged "The week bars overlap" · #rec-1');
  assert.equal(s.doc().flags['rec-1'].source, 'claude');
  const before = structuredClone(s.doc());
  runOp(s, { op: 'task', title: 'A' });
  const c = s.addChange({ summary: 'Added task "A" for today', edits: diffDocs(before, s.doc()) });
  assert.equal(runOp(s, { op: 'undo', change: c.id }), 'Undone. (Added task "A" for today)');
  assert.equal(runOp(s, { op: 'undo', change: c.id }), 'Already undone, or too old to undo. (Added task "A" for today)');
  assert.throws(() => runOp(s, { op: 'undo', change: 'rec-1' }), /Nothing has the id rec-1/);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/claude-ops.test.js`
Expected: FAIL — `Cannot find module '.../claude/ops.js'`.

- [ ] **Step 3: Create `claude/ops.js`**

```js
// The tool's changes. An op is a plain object from Claude's JSON ({ "op": "task", "title": … });
// runOp checks it, runs it through the store's own methods, and returns the one line Claude
// reports. Every check happens before the store is touched, so a bad op throws a plain-English
// error and changes nothing. What Claude adds is marked source 'claude'.

import { parseAmount } from '../js/parse.js';
import { undoLine } from '../js/changes.js';
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
  const rec = store.addItem({
    type: 'task', title: title(op.title, 'A task'), date: toDay(op.date ?? 'today', today),
    area: str(op.area), goalId: goalOf(store, op.goal), status: statusOf(op), source: CLAUDE,
  });
  return tagged(`${verb(op)} task ${q(rec.title)} for ${dayName(rec.date, today)}`, rec.id);
}

function habit(store, op) {
  const rec = store.addItem({
    type: 'habit', title: title(op.title, 'A habit'), repeat: checkRepeat(op.repeat),
    area: str(op.area), goalId: goalOf(store, op.goal), status: statusOf(op), source: CLAUDE,
  });
  return tagged(`${verb(op)} habit ${q(rec.title)} (${repeatText(rec.repeat)})`, rec.id);
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
    const rule = rules[field];
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

export const OPS = {
  task, habit, target, goal, milestone, plan,
  done: (store, op) => tick(store, op, true),
  undone: (store, op) => tick(store, op, false),
  log, edit, archive, accept, dismiss, flag, undo,
};

// undo marks the change it undoes rather than being logged as a change of its own.
export const UNLOGGED = new Set(['undo']);

export function runOp(store, op) {
  if (!op || typeof op !== 'object' || Array.isArray(op)) throw new Error('Each op is an object like {"op": "task", "title": "…"}');
  const fn = Object.hasOwn(OPS, op.op) ? OPS[op.op] : null;
  if (!fn) throw new Error(`Unknown op ${JSON.stringify(op.op)} — ops: ${Object.keys(OPS).join(', ')}`);
  return fn(store, op);
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/claude-ops.test.js` → PASS (9 tests). Then `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add claude/ops.js tests/claude-ops.test.js
git commit -m "Add the tool's ops: add, plan, tick, log, edit, archive, accept, dismiss, flag, undo

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
