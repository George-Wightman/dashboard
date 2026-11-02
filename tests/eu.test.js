import { test } from 'node:test';
import assert from 'node:assert/strict';
import { euDays, euCount, longestStay, euVisits, euSummary, dayRange, setEuDays, windowStart, euId } from '../js/eu.js';
import { addDays } from '../js/dates.js';
import { makeStore } from './helpers.js';

// makeStore's clock is Thursday 10 September 2026.
const TODAY = '2026-09-10';
const set = (...ranges) => new Set(ranges.flatMap(([a, b]) => dayRange(a, b ?? a)));

test('euCount: the day itself and the 179 before it', () => {
  const days = set(['2026-03-15'], ['2026-09-10']);
  assert.equal(windowStart(TODAY), '2026-03-15');
  assert.equal(euCount(days, TODAY), 2);
  assert.equal(euCount(days, '2026-09-11'), 1); // 15 Mar has dropped out
  assert.equal(euCount(days, '2026-09-09'), 1);
});

test('dayRange: every day between, either way round', () => {
  assert.deepEqual(dayRange('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(dayRange('2026-11-02', '2026-11-01'), ['2026-11-01', '2026-11-02']);
});

test('longestStay: up to 90 in the window, counting planned days already marked', () => {
  assert.equal(longestStay(new Set(), TODAY), 90);
  assert.equal(longestStay(set(['2026-08-01', '2026-08-30']), TODAY), 60);
  // A planned week inside the stay is part of it, not extra.
  assert.equal(longestStay(set(['2026-08-01', '2026-08-30'], ['2026-09-20', '2026-09-26']), TODAY), 60);
});

test('euVisits: runs of days, the ones not over yet', () => {
  const days = set(['2026-08-01', '2026-08-03'], ['2026-09-09', '2026-09-12'], ['2026-10-01']);
  assert.deepEqual(euVisits(days, TODAY), [
    { start: '2026-09-09', end: '2026-09-12', days: 4 },
    { start: '2026-10-01', end: '2026-10-01', days: 1 },
  ]);
});

test('euSummary: used, left, next visit, first day over, and when days come back', () => {
  const store = makeStore();
  // 80 days already used: 13 Jun to 31 Aug.
  setEuDays(store, dayRange('2026-06-13', '2026-08-31'), true);
  // A planned fortnight that goes over on its 11th day.
  setEuDays(store, dayRange('2026-09-20', '2026-10-03'), true);
  const s = euSummary(store.doc(), TODAY);
  assert.equal(s.used, 80);
  assert.equal(s.left, 10);
  assert.equal(s.planned, 14);
  assert.deepEqual(s.next, { start: '2026-09-20', end: '2026-10-03', days: 14 });
  assert.equal(s.here, null);
  assert.equal(s.over, '2026-09-30');
  assert.equal(s.back, addDays('2026-06-13', 180));
});

test('euSummary: the visit he is on now', () => {
  const store = makeStore();
  setEuDays(store, dayRange('2026-09-08', '2026-09-14'), true);
  const s = euSummary(store.doc(), TODAY);
  assert.deepEqual(s.here, { start: '2026-09-08', end: '2026-09-14', days: 7 });
  assert.equal(s.next, null);
  assert.equal(s.used, 3);
  assert.equal(s.over, null);
});

test('setEuDays: marks and unmarks in one save, and a day marked again comes back', () => {
  const store = makeStore();
  let saves = 0;
  store.subscribe?.(() => saves++);
  assert.equal(setEuDays(store, dayRange('2026-09-01', '2026-09-05'), true), 5);
  assert.equal(setEuDays(store, ['2026-09-01', '2026-09-02'], true), 0);
  assert.equal(setEuDays(store, ['2026-09-02', '2026-09-03'], false), 2);
  assert.deepEqual([...euDays(store.doc())].sort(), ['2026-09-01', '2026-09-04', '2026-09-05']);
  assert.equal(store.doc().calendar[euId('2026-09-02')].status, 'archived');
  setEuDays(store, ['2026-09-02'], true);
  assert.equal(store.doc().calendar[euId('2026-09-02')].status, 'active');
  if (store.subscribe) assert.equal(saves, 3);
});

test('Claude: the eu op marks a visit, says where that leaves him, and week reads it', async () => {
  const { runOp } = await import('../claude/ops.js');
  const { READS } = await import('../claude/read.js');
  const store = makeStore();
  assert.equal(runOp(store, { op: 'eu', from: '2026-09-20', to: '2026-09-26' }),
    'Marked Sun 20 Sep to Sat 26 Sep as in the EU (7 days changed) · 0 of 90 used today, 90 left · plans fit');
  assert.equal(store.doc().calendar[euId('2026-09-20')].source, 'claude');
  assert.match(READS.week(store.doc(), TODAY), /EU days \(90 in any 180\): 0 of 90 used today, 90 left · next visit Sun 20 Sep to Sat 26 Sep \(7 days\) · 7 planned days fit/);
  assert.match(runOp(store, { op: 'eu', from: '2026-09-26', clear: true }), /^Cleared Sat 26 Sep as not in the EU \(1 day changed\)/);
  assert.throws(() => runOp(store, { op: 'eu', from: '2026-09-26', to: '2026-09-20' }), /before "from"/);
  assert.doesNotMatch(READS.catchup(store.doc(), TODAY, '1'), /EU days/);
  runOp(store, { op: 'eu', from: '2026-09-27', to: '2026-12-31' });
  assert.match(READS.catchup(store.doc(), TODAY, '1'), /PLANS GO OVER 90 on/);
});
