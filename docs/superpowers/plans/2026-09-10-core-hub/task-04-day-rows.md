# Task 4: What's on a day

Part of [the core hub plan](../2026-09-10-core-hub.md) — read its Global Constraints first.

**Files:**
- Create: `js/schedule.js`
- Test: `tests/schedule-day.test.js`

**Interfaces:**
- Consumes: `addDays`, `weekday`, `weekStart`, `dayOfMonth`, `daysInMonth` from `js/dates.js`;
  `fixture`, `done`, `amount` from `tests/helpers.js` (Task 3).
- Produces (all pure — a document and a day in, values out):
  - `countsOn(record, day)` — the record is `active` or `archived`, was created by `day`, and
    wasn't archived yet (`day < archivedOn`). Suggested and dismissed records never count.
  - `doneDays(doc, itemId)` → `Set` of days with an active `done` log.
  - `doneBetween(doc, itemId, from, to)` → ticks on days in `[from, to)`.
  - `isHabitDue(doc, item, day)` — the repeat rules from the spec. A `perWeek` habit is due
    while fewer than `n` ticks landed earlier that week, so it stays on the list (ticked) the day
    it's met and is gone after.
  - `rowsForDay(doc, day)` → the counted task and habit rows, sorted by `order`.
    `Row = { item, kind, done, carriedFrom, suggested, total? }`.
  - `weekTotal(doc, id, day)` → sum of active `amount` logs whose `itemId` **or** `goalId` is
    `id`, in `day`'s Monday–Sunday week.
  - `todayRows(doc, today)` → suggestions (any type, by order), then undone rows, then done rows
    (each by order). Active quotas are included with `total`, and are `done` once `total >= target`.
- Tasks: a task shows from its `date` until the day it's ticked, inclusive. `carriedFrom` is its
  `date` whenever that's before the day shown. Its `date` is never changed.

- [ ] **Step 1: Write the failing test**

`tests/schedule-day.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countsOn, doneDays, isHabitDue, rowsForDay, todayRows, weekTotal } from '../js/schedule.js';
import { fixture, done, amount } from './helpers.js';

const habit = (id, repeat, extra = {}) => ({ id, type: 'habit', title: id, repeat, order: 1, ...extra });
const task = (id, date, extra = {}) => ({ id, type: 'task', title: id, date, order: 1, ...extra });
const quota = (id, target, extra = {}) => ({ id, type: 'quota', title: id, target, unit: 'count', order: 1, ...extra });
const ids = (rows) => rows.map((r) => r.item.id);

test('countsOn: created, archived, and status', () => {
  const base = { status: 'active', created: '2026-09-05', archivedOn: null };
  assert.equal(countsOn(base, '2026-09-04'), false);
  assert.equal(countsOn(base, '2026-09-05'), true);
  const archived = { ...base, status: 'archived', archivedOn: '2026-09-10' };
  assert.equal(countsOn(archived, '2026-09-09'), true);
  assert.equal(countsOn(archived, '2026-09-10'), false);
  assert.equal(countsOn({ ...base, status: 'suggested' }, '2026-09-10'), false);
  assert.equal(countsOn({ ...base, status: 'dismissed' }, '2026-09-10'), false);
});

test('isHabitDue: fixed schedules', () => {
  const doc = fixture();
  assert.equal(isHabitDue(doc, habit('h', { kind: 'daily' }), '2026-09-10'), true);
  const mwf = habit('h', { kind: 'weekdays', days: [1, 3, 5] });
  assert.equal(isHabitDue(doc, mwf, '2026-09-09'), true);
  assert.equal(isHabitDue(doc, mwf, '2026-09-10'), false);
  assert.equal(isHabitDue(doc, habit('h', { kind: 'weekly', day: 4 }), '2026-09-10'), true);
  assert.equal(isHabitDue(doc, habit('h', { kind: 'weekly', day: 4 }), '2026-09-11'), false);
  assert.equal(isHabitDue(doc, habit('h', { kind: 'monthly', date: 10 }), '2026-09-10'), true);
  const on31st = habit('h', { kind: 'monthly', date: 31 });
  assert.equal(isHabitDue(doc, on31st, '2026-09-30'), true);
  assert.equal(isHabitDue(doc, on31st, '2026-09-29'), false);
  assert.equal(isHabitDue(doc, on31st, '2026-02-28'), true);
});

test('isHabitDue: perWeek drops off once met, and resets on Monday', () => {
  const gym = habit('gym', { kind: 'perWeek', n: 2 });
  const doc = fixture({ items: [gym], logs: [done('gym', '2026-09-07'), done('gym', '2026-09-08')] });
  assert.equal(isHabitDue(doc, gym, '2026-09-08'), true); // still listed the day it's met
  assert.equal(isHabitDue(doc, gym, '2026-09-09'), false);
  assert.equal(isHabitDue(doc, gym, '2026-09-14'), true);
});

test('tombstoned ticks are ignored', () => {
  const doc = fixture({ logs: [done('h', '2026-09-10', { status: 'archived' })] });
  assert.equal(doneDays(doc, 'h').size, 0);
});

test('tasks: today, carried over, done, future', () => {
  const doc = fixture({
    items: [
      task('today', '2026-09-10'),
      task('late', '2026-09-08'),
      task('doneWed', '2026-09-08'),
      task('future', '2026-09-11'),
    ],
    logs: [done('doneWed', '2026-09-09')],
  });
  const rows = rowsForDay(doc, '2026-09-10');
  assert.deepEqual(ids(rows).sort(), ['late', 'today']);
  assert.equal(rows.find((r) => r.item.id === 'late').carriedFrom, '2026-09-08');
  assert.equal(rows.find((r) => r.item.id === 'today').carriedFrom, null);
  const wed = rowsForDay(doc, '2026-09-09').find((r) => r.item.id === 'doneWed');
  assert.equal(wed.done, true);
  assert.equal(wed.carriedFrom, '2026-09-08');
  const tue = rowsForDay(doc, '2026-09-08').find((r) => r.item.id === 'doneWed');
  assert.equal(tue.done, false);
});

test('rowsForDay respects created and archivedOn', () => {
  const doc = fixture({
    items: [
      habit('new', { kind: 'daily' }, { created: '2026-09-10' }),
      habit('gone', { kind: 'daily' }, { status: 'archived', archivedOn: '2026-09-10' }),
      habit('idea', { kind: 'daily' }, { status: 'suggested' }),
    ],
  });
  assert.deepEqual(ids(rowsForDay(doc, '2026-09-09')), ['gone']);
  assert.deepEqual(ids(rowsForDay(doc, '2026-09-10')), ['new']);
});

test('weekTotal: this week only, active only, item or goal', () => {
  const doc = fixture({
    logs: [
      amount('a1', 'apps', '2026-09-07', 1),
      amount('a2', 'apps', '2026-09-10', 2),
      amount('a3', 'apps', '2026-09-06', 5),                          // last week
      amount('a4', 'apps', '2026-09-09', 4, { status: 'archived' }),  // removed
      { id: 'g1', itemId: null, goalId: 'goal', kind: 'amount', amount: 3, day: '2026-09-08' },
    ],
  });
  assert.equal(weekTotal(doc, 'apps', '2026-09-10'), 3);
  assert.equal(weekTotal(doc, 'apps', '2026-09-13'), 3);
  assert.equal(weekTotal(doc, 'apps', '2026-09-06'), 5);
  assert.equal(weekTotal(doc, 'goal', '2026-09-10'), 3);
});

test('todayRows: suggestions first, then undone by order, then done; quotas included', () => {
  const doc = fixture({
    items: [
      task('b', '2026-09-10', { order: 2 }),
      task('a', '2026-09-10', { order: 1 }),
      habit('ticked', { kind: 'daily' }, { order: 0 }),
      quota('apps', 5, { order: 3 }),
      quota('met', 1, { order: 4 }),
      task('s', '2026-09-10', { status: 'suggested', source: 'gemini', order: 9 }),
    ],
    logs: [done('ticked', '2026-09-10'), amount('x', 'apps', '2026-09-09', 3), amount('y', 'met', '2026-09-10', 1)],
  });
  const rows = todayRows(doc, '2026-09-10');
  assert.deepEqual(ids(rows), ['s', 'a', 'b', 'apps', 'ticked', 'met']);
  assert.equal(rows[0].suggested, true);
  const apps = rows.find((r) => r.item.id === 'apps');
  assert.equal(apps.kind, 'quota');
  assert.equal(apps.total, 3);
  assert.equal(apps.done, false);
  assert.equal(rows.find((r) => r.item.id === 'met').done, true);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `js/schedule.js`.

- [ ] **Step 3: Implement**

`js/schedule.js`:

```js
// What's on a day, and the numbers derived from it. Pure: a document and a day in, values out.

import { addDays, weekday, weekStart, dayOfMonth, daysInMonth } from './dates.js';

const values = (map) => Object.values(map ?? {});
const byOrder = (a, b) => (a.item.order ?? 0) - (b.item.order ?? 0);
const activeLogs = (doc, pred) => values(doc.logs).filter((l) => l.status === 'active' && pred(l));

// Live (or since archived), created by `day`, and not yet archived on it.
export function countsOn(record, day) {
  if (record.status !== 'active' && record.status !== 'archived') return false;
  if (record.created > day) return false;
  return !record.archivedOn || day < record.archivedOn;
}

export function doneDays(doc, itemId) {
  return new Set(activeLogs(doc, (l) => l.itemId === itemId && l.kind === 'done').map((l) => l.day));
}

// Ticks on days in [from, to).
export function doneBetween(doc, itemId, from, to) {
  let n = 0;
  for (const d of doneDays(doc, itemId)) if (d >= from && d < to) n++;
  return n;
}

export function isHabitDue(doc, item, day) {
  const r = item.repeat ?? { kind: 'daily' };
  switch (r.kind) {
    case 'daily': return true;
    case 'weekdays': return (r.days ?? []).includes(weekday(day));
    case 'weekly': return weekday(day) === r.day;
    case 'monthly': return dayOfMonth(day) === Math.min(r.date, daysInMonth(day));
    case 'perWeek': return doneBetween(doc, item.id, weekStart(day), day) < r.n;
    default: return false;
  }
}

function taskRow(doc, item, day) {
  if (item.date > day) return null;
  const doneOn = [...doneDays(doc, item.id)].sort()[0] ?? null;
  if (doneOn && doneOn < day) return null;
  return {
    item, kind: 'task', done: doneOn === day,
    carriedFrom: item.date < day ? item.date : null, suggested: false,
  };
}

// The tasks and habits that count on a day — what the header and the history measure.
export function rowsForDay(doc, day) {
  const rows = [];
  for (const item of values(doc.items)) {
    if (!countsOn(item, day)) continue;
    if (item.type === 'task') {
      const row = taskRow(doc, item, day);
      if (row) rows.push(row);
    } else if (item.type === 'habit' && isHabitDue(doc, item, day)) {
      rows.push({ item, kind: 'habit', done: doneDays(doc, item.id).has(day), carriedFrom: null, suggested: false });
    }
  }
  return rows.sort(byOrder);
}

// Amounts logged against an item or a goal in the Monday–Sunday week containing `day`.
export function weekTotal(doc, id, day) {
  const start = weekStart(day);
  const end = addDays(start, 6);
  return activeLogs(doc, (l) =>
    l.kind === 'amount' && (l.itemId === id || l.goalId === id) && l.day >= start && l.day <= end)
    .reduce((sum, l) => sum + l.amount, 0);
}

// Everything on Today, in display order.
export function todayRows(doc, today) {
  const suggestions = values(doc.items)
    .filter((item) => item.status === 'suggested')
    .map((item) => ({ item, kind: item.type, done: false, carriedFrom: null, suggested: true }))
    .sort(byOrder);
  const quotas = values(doc.items)
    .filter((item) => item.type === 'quota' && item.status === 'active' && countsOn(item, today))
    .map((item) => {
      const total = weekTotal(doc, item.id, today);
      return { item, kind: 'quota', done: total >= item.target, carriedFrom: null, suggested: false, total };
    });
  const rows = [...rowsForDay(doc, today).filter((r) => r.item.status === 'active'), ...quotas].sort(byOrder);
  return [...suggestions, ...rows.filter((r) => !r.done), ...rows.filter((r) => r.done)];
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — all suites so far.

- [ ] **Step 5: Commit**

```bash
git add js/schedule.js tests/schedule-day.test.js
git commit -m "Add day scheduling: habits, carry-over, weekly totals, today's list"
```

(End the commit message with the co-author line from the Global Constraints.)
