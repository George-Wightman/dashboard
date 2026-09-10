# Task 2: Amount parsing and formatting

Part of [the core hub plan](../2026-09-10-core-hub.md) — read its Global Constraints first.

**Files:**
- Create: `js/parse.js`
- Test: `tests/parse.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseAmount(text, unit)` → number or `null`. `unit` is `'count'` or `'minutes'`. For
    `'minutes'` the result is whole minutes. Anything zero, negative or unreadable is `null`.
  - `formatAmount(value, unit)` → `'3'` for counts; `'45m'` under an hour, `'1.5h'` from an hour
    up, for minutes.
  - `formatProgress(total, target, unit)` → `'3 / 5'` for counts; `'1.5 / 4h'` for minutes (both
    sides in hours, one decimal, trailing `.0` dropped).

- [ ] **Step 1: Write the failing test**

`tests/parse.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatAmount, formatProgress } from '../js/parse.js';

test('parseAmount: counts', () => {
  assert.equal(parseAmount('1', 'count'), 1);
  assert.equal(parseAmount(' 3 ', 'count'), 3);
  assert.equal(parseAmount('2.5', 'count'), 2.5);
  assert.equal(parseAmount('0', 'count'), null);
  assert.equal(parseAmount('-2', 'count'), null);
  assert.equal(parseAmount('3m', 'count'), null);
  assert.equal(parseAmount('', 'count'), null);
});

test('parseAmount: minutes', () => {
  assert.equal(parseAmount('45m', 'minutes'), 45);
  assert.equal(parseAmount('45', 'minutes'), 45);
  assert.equal(parseAmount('1.5h', 'minutes'), 90);
  assert.equal(parseAmount('2h', 'minutes'), 120);
  assert.equal(parseAmount('1h30', 'minutes'), 90);
  assert.equal(parseAmount('1h 30m', 'minutes'), 90);
  assert.equal(parseAmount('0.5H', 'minutes'), 30);
  assert.equal(parseAmount('abc', 'minutes'), null);
  assert.equal(parseAmount('0m', 'minutes'), null);
  assert.equal(parseAmount('1h75', 'minutes'), null);
  assert.equal(parseAmount(null, 'minutes'), null);
});

test('formatAmount', () => {
  assert.equal(formatAmount(3, 'count'), '3');
  assert.equal(formatAmount(2.5, 'count'), '2.5');
  assert.equal(formatAmount(45, 'minutes'), '45m');
  assert.equal(formatAmount(60, 'minutes'), '1h');
  assert.equal(formatAmount(90, 'minutes'), '1.5h');
  assert.equal(formatAmount(100, 'minutes'), '1.7h');
  assert.equal(formatAmount(240, 'minutes'), '4h');
});

test('formatProgress', () => {
  assert.equal(formatProgress(3, 5, 'count'), '3 / 5');
  assert.equal(formatProgress(90, 240, 'minutes'), '1.5 / 4h');
  assert.equal(formatProgress(45, 240, 'minutes'), '0.8 / 4h');
  assert.equal(formatProgress(0, 240, 'minutes'), '0 / 4h');
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `js/parse.js`.

- [ ] **Step 3: Implement**

`js/parse.js`:

```js
// Quick-add parsing and amount display. Minute quotas are stored in minutes and shown in hours.

const positive = (n) => (Number.isFinite(n) && n > 0 ? n : null);

export function parseAmount(text, unit) {
  const s = String(text ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;

  if (unit === 'count') {
    return /^\d+(\.\d+)?$/.test(s) ? positive(Number(s)) : null;
  }

  let m;
  if ((m = s.match(/^(\d+(?:\.\d+)?)m?$/))) return positive(Math.round(Number(m[1])));
  if ((m = s.match(/^(\d+(?:\.\d+)?)h$/))) return positive(Math.round(Number(m[1]) * 60));
  if ((m = s.match(/^(\d+)h(\d{1,2})m?$/))) {
    const mins = Number(m[2]);
    return mins < 60 ? positive(Number(m[1]) * 60 + mins) : null;
  }
  return null;
}

const oneDecimal = (n) => String(Number(n.toFixed(1)));
const hours = (minutes) => oneDecimal(minutes / 60);

export function formatAmount(value, unit) {
  if (unit === 'minutes') return value < 60 ? `${Math.round(value)}m` : `${hours(value)}h`;
  return String(Number(value.toFixed(2)));
}

export function formatProgress(total, target, unit) {
  if (unit === 'minutes') return `${hours(total)} / ${hours(target)}h`;
  return `${formatAmount(total, unit)} / ${formatAmount(target, unit)}`;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — all tests in `dates.test.js` and `parse.test.js`.

- [ ] **Step 5: Commit**

```bash
git add js/parse.js tests/parse.test.js
git commit -m "Add amount parsing and formatting"
```

(End the commit message with the co-author line from the Global Constraints.)
