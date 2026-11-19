import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopwatch, addPhases } from '../planner/timing.js';
import { phaseLine, plannerBudget } from '../js/jobs.js';

test('the stopwatch gives each step the time since the last lap', () => {
  let t = 1000;
  const w = stopwatch(() => t);
  t += 400; w.lap('open');
  t += 100; w.lap('plan');
  t += 50; w.lap('open');
  t += 7; w.lap('not a name!');
  assert.deepEqual(w.phases(), { open: 450, plan: 100 });
});

test('the day adds up run by run, and junk in the property is dropped', () => {
  assert.deepEqual(addPhases({ open: 1000.4, bad: 'x', 'two words': 5, neg: -3 }, { open: 500, save: 200 }), { open: 1500, save: 200 });
  assert.deepEqual(addPhases(null, { plan: 3 }), { plan: 3 });
  assert.deepEqual(addPhases('nonsense', null), {});
});

test('the biggest steps in words, a minute or more each', () => {
  assert.equal(phaseLine({ calendarRead: 21 * 60000, save: 9 * 60000, open: 12 * 60000, tag: 10000, stocks: 2 * 60000, plan: 60000 }),
    'reading the calendars 21 min, reading the dashboard 12 min, saving 9 min, stocks 2 min');
  assert.equal(phaseLine({}), '');
  const doc = { calendar: { 'checkins:status': { status: 'active', day: '2026-11-20', runMs: 30 * 60000, runs: 40, phases: { calendarRead: 10 * 60000 } } } };
  assert.equal(plannerBudget(doc, '2026-11-20').line, "Apps Script today: 30 of Google's 90 minutes, over 40 runs (about 45 s each); most of it reading the calendars 10 min");
});
