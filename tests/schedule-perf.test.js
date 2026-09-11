import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { history, todayRows, dayCompletion } from '../js/schedule.js';
import { addDays } from '../js/dates.js';
import { fixture, done, amount } from './helpers.js';

const TODAY = '2026-09-10';

// A year of real use: 6 daily habits ticked every day, 3 tasks per day each ticked on its date,
// 2 quotas with 2 amount logs a day.
function buildDoc() {
  const start = addDays(TODAY, -365);
  const items = [];
  const logs = [];

  for (let h = 0; h < 6; h++) {
    items.push({ id: `habit${h}`, type: 'habit', title: `habit${h}`, repeat: { kind: 'daily' }, created: start, order: h });
  }
  for (let q = 0; q < 2; q++) {
    items.push({ id: `quota${q}`, type: 'quota', title: `quota${q}`, target: 100000, unit: 'count', created: start, order: 900 + q });
  }

  let taskN = 0;
  let day = start;
  while (day <= TODAY) {
    for (let h = 0; h < 6; h++) logs.push(done(`habit${h}`, day));
    for (let t = 0; t < 3; t++) {
      const id = `task${taskN++}`;
      items.push({ id, type: 'task', title: id, date: day, order: 1000 + taskN });
      logs.push(done(id, day));
    }
    for (let q = 0; q < 2; q++) {
      logs.push(amount(`amt-${q}-${day}-1`, `quota${q}`, day, 1));
      logs.push(amount(`amt-${q}-${day}-2`, `quota${q}`, day, 1));
    }
    day = addDays(day, 1);
  }

  return fixture({ items, logs });
}

test('history + todayRows + dayCompletion stay fast on a year of data', () => {
  const doc = buildDoc();
  const t0 = performance.now();
  history(doc, TODAY);
  todayRows(doc, TODAY);
  dayCompletion(doc, TODAY);
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 250, `expected under 250ms, took ${elapsed.toFixed(1)}ms`);
});
