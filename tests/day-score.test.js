// An honest day score (docs/superpowers/specs/2026-09-23-honest-day-score-design.md): what George
// committed to at the 11:00 lock still counts when it's moved or deleted, and a
// times-a-week habit only counts on the days he needs it.

process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, done, makeStore, clock } from './helpers.js';
import { at } from '../planner/time.js';
import { dayScore, dayCompletion } from '../js/schedule.js';
import { lockDue, ensureCommitment, commitKey } from '../js/commit.js';

const MON = '2026-09-21', TUE = '2026-09-22', WED = '2026-09-23', THU = '2026-09-24';

const walk = { id: 'walk', type: 'habit', title: 'Morning walk', repeat: { kind: 'daily' }, created: '2026-09-01', order: 1 };
const gym = { id: 'gym', type: 'habit', title: 'Gym', repeat: { kind: 'perWeek', n: 5 }, created: '2026-09-01', order: 2 };
const task = (id, date, extra = {}) => ({ id, type: 'task', title: id, date, order: 10, ...extra });
const commit = (day, tasks) => ({ [commitKey(day)]: { id: commitKey(day), day, at: at(day, '09:00').toISOString(), tasks } });

function doc({ items = [], logs = [], commits = {} } = {}) {
  const d = fixture({ items, logs });
  d.calendar = { ...(d.calendar ?? {}), ...commits };
  return d;
}
const ids = (list) => list.map((r) => r.item?.id ?? r.id).sort();

// ---- Habits ------------------------------------------------------------------------------------

test('a daily habit not done counts against the day', () => {
  const s = dayScore(doc({ items: [walk] }), WED);
  assert.deepEqual([s.done, s.total], [0, 1]);
});

test('a times-a-week habit on pace is optional: a rest day, not a miss', () => {
  // Gym twice by Tuesday: three to go, five days left.
  const s = dayScore(doc({ items: [walk, gym], logs: [done('gym', MON), done('gym', TUE)] }), WED);
  assert.deepEqual([s.done, s.total], [0, 1]);
  assert.deepEqual(ids(s.optional), ['gym']);
});

test('a times-a-week habit counts once the week needs it every remaining day', () => {
  // Nothing by Wednesday: five to go, five days left.
  const s = dayScore(doc({ items: [gym] }), WED);
  assert.deepEqual([s.done, s.total], [0, 1]);
  assert.deepEqual(s.optional, []);
});

test('doing an optional habit still counts', () => {
  const s = dayScore(doc({ items: [gym], logs: [done('gym', MON), done('gym', TUE), done('gym', WED)] }), WED);
  assert.deepEqual([s.done, s.total], [1, 1]);
});

test('a row in an uncounted area is never a miss, moved or not, but counts when done', () => {
  const uncounted = { config: { id: 'config', status: 'active', uncountedAreas: ['Food'] } };
  const cook = task('cook', WED, { area: 'Food' });
  const open = doc({ items: [walk, cook], commits: commit(WED, ['cook']) });
  open.calendar = { ...open.calendar, ...uncounted };
  const s = dayScore(open, WED);
  assert.deepEqual([s.done, s.total], [0, 1]);
  assert.deepEqual(ids(s.optional), ['cook']);
  const moved = doc({ items: [walk, { ...cook, date: THU }], commits: commit(WED, ['cook']) });
  moved.calendar = { ...moved.calendar, ...uncounted };
  assert.deepEqual(dayScore(moved, WED).pushed, []);
  const cooked = doc({ items: [walk, cook], logs: [done('cook', WED)] });
  cooked.calendar = { ...cooked.calendar, ...uncounted };
  assert.deepEqual([dayScore(cooked, WED).done, dayScore(cooked, WED).total], [1, 2]);
});

// ---- Committed tasks ---------------------------------------------------------------------------

test('moving a committed task to another day is pushed: out of the score, but listed', () => {
  const s = dayScore(doc({ items: [task('a', WED, { date: THU }), task('b', WED)], logs: [done('b', WED)], commits: commit(WED, ['a', 'b']) }), WED);
  assert.deepEqual([s.done, s.total], [1, 1]);
  assert.deepEqual(ids(s.pushed), ['a']);
});

test('a task pushed on a second day counts as missed', () => {
  const d = doc({ items: [task('a', THU)], commits: { ...commit(TUE, ['a']), ...commit(WED, ['a']) } });
  const wed = dayScore(d, WED);
  assert.deepEqual([wed.done, wed.total], [0, 1]);
  assert.deepEqual(ids(wed.missed), ['a']);
  assert.deepEqual(wed.pushed, []);
  assert.deepEqual(ids(dayScore(d, TUE).pushed), ['a']);
});

test('deleting a committed task is a miss, unless it was released as no longer needed', () => {
  const dropped = task('a', WED, { status: 'archived', archivedOn: WED });
  const s = dayScore(doc({ items: [dropped], commits: commit(WED, ['a']) }), WED);
  assert.deepEqual([s.done, s.total], [0, 1]);
  assert.deepEqual(ids(s.dropped), ['a']);
  const released = dayScore(doc({ items: [{ ...dropped, released: 'Recruiter cancelled it' }], commits: commit(WED, ['a']) }), WED);
  assert.deepEqual([released.done, released.total], [0, 0]);
  assert.deepEqual(ids(released.released), ['a']);
});

test('a task the planner carried to a later day, still dated today, is left out', () => {
  const d = doc({ items: [task('a', WED)], commits: commit(WED, ['a']) });
  d.calendar.agenda = { from: WED, blocks: [{ start: at(THU, '09:00').toISOString(), end: at(THU, '10:00').toISOString(), items: ['a'], state: 'rough' }] };
  const s = dayScore(d, WED);
  assert.deepEqual([s.done, s.total], [0, 0]);
  assert.deepEqual(s.pushed, []);
});

test('without a commitment a day scores from its list, as before', () => {
  const s = dayScore(doc({ items: [task('a', WED), task('b', WED)], logs: [done('a', WED)] }), WED);
  assert.deepEqual([s.done, s.total], [1, 2]);
});

test('dayCompletion is the score as two numbers', () => {
  const d = doc({ items: [walk, task('a', THU)], commits: commit(WED, ['a']) });
  assert.deepEqual(dayCompletion(d, WED), { done: 0, total: 1 });
});

// ---- The lock ----------------------------------------------------------------------------------


test('the lock: at 11:00, once', () => {
  const d = doc();
  assert.equal(lockDue(d, WED, at(WED, '10:59')), false);
  assert.equal(lockDue(d, WED, at(WED, '11:00')), true);
  d.calendar[`commit:${WED}`] = { id: `commit:${WED}`, day: WED, tasks: [], status: 'active' };
  assert.equal(lockDue(d, WED, at(WED, '12:00')), false, 'already locked');
});

test('ensureCommitment: the day as it stands at the lock, written once', () => {
  const store = makeStore({ now: clock(at(WED, '11:05')), prefix: 'x-' });
  const a = store.addItem({ type: 'task', title: 'Role play 1', date: WED });
  const b = store.addItem({ type: 'task', title: 'Role play 2', date: WED });
  store.addItem({ type: 'task', title: 'Tomorrow', date: THU });
  assert.equal(ensureCommitment(store, WED, at(WED, '10:00')), null);
  const rec = ensureCommitment(store, WED, at(WED, '11:05'));
  assert.deepEqual([...rec.tasks].sort(), [a.id, b.id].sort());
  store.updateItem(b.id, { date: THU });
  assert.equal(ensureCommitment(store, WED, at(WED, '12:00')), null);
  assert.deepEqual([...store.doc().calendar[commitKey(WED)].tasks].sort(), [a.id, b.id].sort());
  const s = dayScore(store.doc(), WED);
  assert.deepEqual(ids(s.pushed), [b.id]);
});

// ---- The Coach ---------------------------------------------------------------------------------


// ---- Meals --------------------------------------------------------------------------------------

const OCT23 = '2026-10-23';
const meal = (id, day, extra = {}) => ({ id, kind: 'meal', day, at: `${day}T12:00:00.000Z`, slot: 'lunch', status: 'active', ...extra });
function withMeals(items, meals) {
  const d = doc({ items });
  for (const m of meals) d.meals[m.id] = m;
  return d;
}

test('logging meals is a row of its own from 23 October, done at three meals', () => {
  const s = dayScore(withMeals([walk], [meal('m1', OCT23), meal('m2', OCT23)]), OCT23);
  assert.deepEqual([s.done, s.total], [0, 2]);
  const row = s.open.find((r) => r.kind === 'meals');
  assert.deepEqual([row.logged, row.needed, row.item.title], [2, 3, 'Log your meals']);
  const full = dayScore(withMeals([walk], [meal('m1', OCT23), meal('m2', OCT23), meal('m3', OCT23, { slot: 'snack' })]), OCT23);
  assert.deepEqual([full.done, full.total], [1, 2]);
  assert.ok(full.doneRows.some((r) => r.kind === 'meals'));
});

test('meals don\'t count before 23 October, nor archived ones, nor on a day off', () => {
  assert.equal(dayScore(withMeals([walk], []), '2026-10-22').total, 1);
  const archived = dayScore(withMeals([walk], ['a', 'b', 'c'].map((id) => meal(id, OCT23, { status: 'archived' }))), OCT23);
  assert.deepEqual([archived.done, archived.total], [0, 2]);
  const off = withMeals([walk], [meal('old', '2026-10-20')]);
  off.calendar['off:x'] = { id: 'off:x', status: 'active', start: OCT23, end: OCT23, areas: [], reason: 'Away' };
  assert.equal(dayScore(off, OCT23).total, 0);
});
