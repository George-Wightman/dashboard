# Task 1: Scaffolding and dates

Part of [the core hub plan](../2026-09-10-core-hub.md) — read its Global Constraints first.

**Files:**
- Create: `package.json`, `.claude/launch.json`, `js/dates.js`
- Test: `tests/dates.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: every export of `js/dates.js` listed below. All take and return days as `'YYYY-MM-DD'` strings. Arithmetic runs in UTC on those strings, so daylight-saving changes can never shift a day; only `logicalDay` reads local time.

- [ ] **Step 1: Create the scaffolding**

`package.json`:

```json
{
  "name": "dashboard",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.js"
  }
}
```

`.claude/launch.json`:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "dashboard",
      "runtimeExecutable": "python",
      "runtimeArgs": ["-m", "http.server", "8080"],
      "port": 8080
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

`tests/dates.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  logicalDay, addDays, daysBetween, weekday, weekStart, dayOfMonth, daysInMonth,
  shortWeekday, shortDate, longDate, carryLabel,
} from '../js/dates.js';

test('logicalDay: before 04:00 counts as the previous day', () => {
  assert.equal(logicalDay(new Date(2026, 8, 11, 3, 59)), '2026-09-10');
  assert.equal(logicalDay(new Date(2026, 8, 11, 4, 0)), '2026-09-11');
});

test('logicalDay: dayStartHour 0 is plain midnight', () => {
  assert.equal(logicalDay(new Date(2026, 8, 11, 0, 30), 0), '2026-09-11');
});

test('logicalDay: crosses month and year', () => {
  assert.equal(logicalDay(new Date(2027, 0, 1, 2, 0)), '2026-12-31');
});

test('addDays and daysBetween', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-03-28', 2), '2026-03-30'); // across the UK clock change
  assert.equal(daysBetween('2026-09-03', '2026-09-10'), 7);
  assert.equal(daysBetween('2026-09-10', '2026-09-03'), -7);
});

test('weekday and weekStart (Mon = 1)', () => {
  assert.equal(weekday('2026-09-07'), 1);
  assert.equal(weekday('2026-09-10'), 4);
  assert.equal(weekday('2026-09-13'), 7);
  assert.equal(weekStart('2026-09-10'), '2026-09-07');
  assert.equal(weekStart('2026-09-13'), '2026-09-07');
  assert.equal(weekStart('2026-09-07'), '2026-09-07');
});

test('month helpers', () => {
  assert.equal(dayOfMonth('2026-09-10'), 10);
  assert.equal(daysInMonth('2026-02-10'), 28);
  assert.equal(daysInMonth('2028-02-01'), 29);
  assert.equal(daysInMonth('2026-09-30'), 30);
});

test('labels', () => {
  assert.equal(shortWeekday('2026-09-08'), 'Tue');
  assert.equal(shortDate('2026-09-03'), '3 Sep');
  assert.equal(longDate('2026-09-10'), 'Thursday 10 September');
});

test('carryLabel: weekday within 6 days, date beyond', () => {
  assert.equal(carryLabel('2026-09-08', '2026-09-10'), 'from Tue');
  assert.equal(carryLabel('2026-09-04', '2026-09-10'), 'from Fri');
  assert.equal(carryLabel('2026-09-03', '2026-09-10'), 'from 3 Sep');
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `js/dates.js`.

- [ ] **Step 4: Implement**

`js/dates.js`:

```js
// Pure day arithmetic. Days are 'YYYY-MM-DD' strings. Everything except logicalDay works in
// UTC on those strings, so a daylight-saving change can never move a day.

const pad = (n) => String(n).padStart(2, '0');
const DAY_MS = 86400000;

const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

// The day a moment belongs to, when the day starts at dayStartHour local time.
export function logicalDay(date, dayStartHour = 4) {
  const shifted = new Date(date.getTime() - dayStartHour * 3600000);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

function toUTC(day) {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(day, n) {
  return fromUTC(toUTC(day) + n * DAY_MS);
}

export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
}

export function weekday(day) {
  const w = new Date(toUTC(day)).getUTCDay();
  return w === 0 ? 7 : w;
}

export function weekStart(day) {
  return addDays(day, 1 - weekday(day));
}

export function dayOfMonth(day) {
  return Number(day.slice(8, 10));
}

export function daysInMonth(day) {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function shortWeekday(day) {
  return WEEKDAYS_SHORT[weekday(day) - 1];
}

export function shortDate(day) {
  return `${dayOfMonth(day)} ${MONTHS_SHORT[Number(day.slice(5, 7)) - 1]}`;
}

export function longDate(day) {
  return `${WEEKDAYS_LONG[weekday(day) - 1]} ${dayOfMonth(day)} ${MONTHS_LONG[Number(day.slice(5, 7)) - 1]}`;
}

// The orange marker on a carried-over task.
export function carryLabel(fromDay, today) {
  return daysBetween(fromDay, today) <= 6 ? `from ${shortWeekday(fromDay)}` : `from ${shortDate(fromDay)}`;
}
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — 8 tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add package.json .claude/launch.json js/dates.js tests/dates.test.js
git commit -m "Add scaffolding and date helpers"
```

(End the commit message with the co-author line from the Global Constraints.)
