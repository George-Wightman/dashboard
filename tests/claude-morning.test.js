process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, clock } from './helpers.js';
import { runOp } from '../claude/ops.js';
import { READS } from '../claude/read.js';
import { morningRecord } from '../js/morning.js';
import { closedRecord } from '../js/close.js';

// Thursday 12 Nov 2026, 09:00; yesterday had one task done and one not.
function setup() {
  const now = clock(new Date(2026, 10, 11, 20, 0));
  const store = makeStore({ now, prefix: 'rec-' });
  const a = store.addItem({ type: 'task', title: 'Wash up', date: '2026-11-11' });
  store.addItem({ type: 'task', title: 'Raise dish rack', date: '2026-11-11' });
  store.toggleDone(a.id, '2026-11-11');
  now.set(new Date(2026, 10, 12, 9, 0));
  return store;
}

test('back: his answer this morning, from Claude', () => {
  const s = setup();
  assert.equal(runOp(s, { op: 'back', score: 'stiff' }), 'Back: stiff this morning');
  const r = s.doc().gym['back:2026-11-12'];
  assert.equal(r.score, 1);
  assert.equal(r.source, 'claude');
  assert.throws(() => runOp(s, { op: 'back', score: 'meh' }), /fine, stiff, sore or bad/);
});

test('close: a past day or today, never one to come, and the misses named', () => {
  const s = setup();
  assert.match(runOp(s, { op: 'close', day: 'yesterday' }), /^Closed Wed 11 Nov · 1 of 2 done · not done: Raise dish rack/);
  assert.ok(closedRecord(s.doc(), '2026-11-11'));
  assert.match(runOp(s, { op: 'close', day: 'yesterday' }), /was already closed/);
  assert.throws(() => runOp(s, { op: 'close', day: 'tomorrow' }), /hasn't happened yet/);
});

test('morning: marks Start the day done, so the card and the push stop', () => {
  const s = setup();
  runOp(s, { op: 'back', score: 'fine' });
  runOp(s, { op: 'close', day: 'yesterday' });
  assert.match(runOp(s, { op: 'morning' }), /^Morning done at 09:00 · back fine · Wed closed/);
  assert.deepEqual(morningRecord(s.doc(), '2026-11-12').skipped, ['food']);
  assert.equal(morningRecord(s.doc(), '2026-11-12').source, 'claude');
});

test('catchup leads with an unfinished morning, and says nothing of it once done', () => {
  const s = setup();
  const before = READS.catchup(s.doc(), s.today(), '', new Date(2026, 10, 12, 9, 0));
  assert.match(before, /Start the day isn't done: back not answered; Wed not closed \(1 open\); 0 meals logged for Wed \(0 of 3 main\)/);
  assert.ok(before.indexOf("Start the day isn't done") < before.indexOf('Day by day:'));
  runOp(s, { op: 'morning' });
  assert.doesNotMatch(READS.catchup(s.doc(), s.today(), '', new Date(2026, 10, 12, 9, 5)), /Start the day/);
});
