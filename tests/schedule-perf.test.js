import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { history, todayRows, dayCompletion, streak } from '../js/schedule.js';
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

// What this guards is the cost of the work: history and the streaks each walk a year of logs, and a
// regression here means re-scanning them per item, which costs seconds. It is not a budget for how
// long the call happens to take while the rest of the suite competes for the same cores.
//
// node --test runs the suite's files in parallel, so a single wall-clock sample mostly measures how
// often this process got descheduled: one run on its own takes ~95ms, but under the full suite the
// same run has been seen at 300ms, and adding three unrelated tests to another file was enough to
// push it past a 250ms budget. The fastest of several runs measures the work instead -- it is the
// sample that was interrupted least, and it doesn't care what else is running: best-of-5 lands at
// 57-72ms both on its own and under the full suite. It also drops the JIT warm-up that only the
// first run pays for, which is ~100ms and was most of what the old single sample measured.
// process.cpuUsage() would be the obvious way to ignore contention outright, but on Windows it
// ticks in ~15.6ms steps -- too coarse to time a block this size.
//
// The budget stays deliberately generous on top of that, leaving room for a slower or busier
// machine, because it is here to catch an algorithmic blow-up, not a constant-factor drift.
const RUNS = 5;
const BUDGET_MS = 500;

test('history + todayRows + dayCompletion stay fast on a year of data', () => {
  const doc = buildDoc();
  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    history(doc, TODAY);
    todayRows(doc, TODAY);
    dayCompletion(doc, TODAY);
    streak(doc, doc.items.quota0, TODAY);
    streak(doc, doc.items.quota1, TODAY);
    samples.push(performance.now() - t0);
  }
  const best = Math.min(...samples);
  const all = samples.map((s) => s.toFixed(1)).join(', ');
  assert.ok(best < BUDGET_MS, `expected under ${BUDGET_MS}ms, best of ${RUNS} runs took ${best.toFixed(1)}ms (${all})`);
});
