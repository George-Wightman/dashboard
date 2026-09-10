# Task 5: Streaks

Part of [the core hub plan](../2026-09-10-core-hub.md) — read its Global Constraints first.

**Files:**
- Modify: `js/schedule.js` (append)
- Test: `tests/schedule-streaks.test.js`

**Interfaces:**
- Consumes: `doneDays`, `doneBetween`, `isHabitDue`, `weekTotal` from `js/schedule.js` (Task 4);
  `addDays`, `weekStart` from `js/dates.js`; `fixture`, `done`, `amount` from `tests/helpers.js`.
- Produces: `streak(doc, item, today)` → `{ current, best }`.
  - `daily` / `weekdays` / `weekly` / `monthly` habits: consecutive **scheduled occurrences**
    ticked, from the item's `created` day.
  - `perWeek` habits and quotas: consecutive **weeks** meeting the target (`n` ticks, or
    `weekTotal >= target`), from the week containing `created`.
  - An occurrence still in progress — today, or this week — counts if already met and is
    skipped (never breaks the streak) if not.
  - Tasks: `{ current: 0, best: 0 }`.

- [ ] **Step 1: Write the failing test**

`tests/schedule-streaks.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streak } from '../js/schedule.js';
import { fixture, done, amount } from './helpers.js';

const TODAY = '2026-09-10'; // Thursday
const ticks = (id, days) => days.map((d) => done(id, d));
const range = (from, to) => {
  const out = [];
  for (let d = Number(from.slice(8)); d <= Number(to.slice(8)); d++) out.push(`${from.slice(0, 8)}${String(d).padStart(2, '0')}`);
  return out;
};

test('daily: an unticked today does not break the streak', () => {
  const h = { id: 'h', type: 'habit', repeat: { kind: 'daily' }, created: '2026-09-01' };
  const doc = fixture({ items: [h], logs: ticks('h', range('2026-09-05', '2026-09-09')) });
  assert.deepEqual(streak(doc, doc.items.h, TODAY), { current: 5, best: 5 });
  const withToday = fixture({ items: [h], logs: ticks('h', range('2026-09-05', '2026-09-10')) });
  assert.deepEqual(streak(withToday, withToday.items.h, TODAY), { current: 6, best: 6 });
});

test('daily: a gap resets current but not best', () => {
  const h = { id: 'h', type: 'habit', repeat: { kind: 'daily' }, created: '2026-09-01' };
  const days = [...range('2026-09-01', '2026-09-05'), ...range('2026-09-07', '2026-09-09')];
  const doc = fixture({ items: [h], logs: ticks('h', days) });
  assert.deepEqual(streak(doc, doc.items.h, TODAY), { current: 3, best: 5 });
});

test('daily: missing yesterday means current is 0', () => {
  const h = { id: 'h', type: 'habit', repeat: { kind: 'daily' }, created: '2026-09-01' };
  const doc = fixture({ items: [h], logs: ticks('h', range('2026-09-01', '2026-09-08')) });
  assert.deepEqual(streak(doc, doc.items.h, TODAY), { current: 0, best: 8 });
});

test('weekdays: only scheduled days count', () => {
  const h = { id: 'h', type: 'habit', repeat: { kind: 'weekdays', days: [1, 3, 5] }, created: '2026-09-01' };
  const doc = fixture({ items: [h], logs: ticks('h', ['2026-09-02', '2026-09-04', '2026-09-07', '2026-09-09']) });
  assert.deepEqual(streak(doc, doc.items.h, TODAY), { current: 4, best: 4 });
});

test('perWeek: counts weeks; this week in progress is skipped', () => {
  const h = { id: 'h', type: 'habit', repeat: { kind: 'perWeek', n: 2 }, created: '2026-08-24' };
  const doc = fixture({
    items: [h],
    logs: ticks('h', ['2026-08-24', '2026-08-25', '2026-08-31', '2026-09-03', '2026-09-08']),
  });
  assert.deepEqual(streak(doc, doc.items.h, TODAY), { current: 2, best: 2 });
});

test('quota: consecutive weeks meeting the target', () => {
  const q = { id: 'q', type: 'quota', target: 3, unit: 'count', created: '2026-08-24' };
  const doc = fixture({
    items: [q],
    logs: [
      amount('w1', 'q', '2026-08-26', 3),
      amount('w2', 'q', '2026-09-02', 2),
      amount('w3', 'q', '2026-09-08', 3),
    ],
  });
  assert.deepEqual(streak(doc, doc.items.q, TODAY), { current: 1, best: 1 });
});

test('tasks have no streak', () => {
  const t = { id: 't', type: 'task', date: TODAY, created: TODAY };
  const doc = fixture({ items: [t] });
  assert.deepEqual(streak(doc, doc.items.t, TODAY), { current: 0, best: 0 });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test`
Expected: FAIL — `streak` is not exported from `js/schedule.js` (SyntaxError: does not provide an export named 'streak').

- [ ] **Step 3: Implement**

In `js/schedule.js`, change the dates import to include `addDays` and `weekStart` if they
aren't already there (they are, from Task 4), then append:

```js
// ---- Streaks --------------------------------------------------------------------------------

function runs(outcomes) {
  let best = 0;
  let current = 0;
  for (const ok of outcomes) {
    current = ok ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return { current, best };
}

function occurrenceStreak(doc, item, today) {
  const ticked = doneDays(doc, item.id);
  const outcomes = [];
  for (let day = item.created; day <= today; day = addDays(day, 1)) {
    if (!isHabitDue(doc, item, day)) continue;
    const ok = ticked.has(day);
    if (day === today && !ok) continue; // today isn't over yet
    outcomes.push(ok);
  }
  return runs(outcomes);
}

function weeklyStreak(doc, item, today) {
  const thisWeek = weekStart(today);
  const outcomes = [];
  for (let week = weekStart(item.created); week <= thisWeek; week = addDays(week, 7)) {
    const ok = item.type === 'quota'
      ? weekTotal(doc, item.id, week) >= item.target
      : doneBetween(doc, item.id, week, addDays(week, 7)) >= item.repeat.n;
    if (week === thisWeek && !ok) continue; // this week isn't over yet
    outcomes.push(ok);
  }
  return runs(outcomes);
}

export function streak(doc, item, today) {
  if (item.type === 'quota' || item.repeat?.kind === 'perWeek') return weeklyStreak(doc, item, today);
  if (item.type === 'habit') return occurrenceStreak(doc, item, today);
  return { current: 0, best: 0 };
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — all suites so far.

- [ ] **Step 5: Commit**

```bash
git add js/schedule.js tests/schedule-streaks.test.js
git commit -m "Add streaks"
```

(End the commit message with the co-author line from the Global Constraints.)
