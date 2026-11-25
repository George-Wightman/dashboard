import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY_SPLIT_SYSTEM, daySplitPrompt, parseDaySplit, SPLIT_DEFAULT_TIMES, SPLIT_MAX_MEALS } from '../js/food.js';

const batches = [{ id: 'batch:1', name: 'Chilli' }];
const logged = [{ at: '2026-11-11T08:30:00', slot: 'breakfast', text: '5 eggs, 2 pittas' }];

test('the split prompt names the day, what is already logged and the pots in the fridge', () => {
  const p = daySplitPrompt({ text: 'eggs and pittas, then a quarter of the chilli, then pasta', day: '2026-11-11', logged, batches });
  assert.match(p, /Wednesday 11 November/);
  assert.match(p, /Already logged \(leave these out\): 08:30 breakfast: 5 eggs, 2 pittas/);
  assert.match(p, /batch:1: Chilli/);
  assert.match(p, /What he said: eggs and pittas, then a quarter of the chilli, then pasta/);
  assert.match(DAY_SPLIT_SYSTEM, /"meals"/);
  assert.match(DAY_SPLIT_SYSTEM, /pittas/);
});

test('a sensible split is kept, in time order, with batch servings recognised', () => {
  const out = parseDaySplit({ meals: [
    { slot: 'dinner', time: '19:30', text: 'pasta with pesto, a big bowl' },
    { slot: 'lunch', time: '13:00', text: 'a quarter of the chilli', batch: 'batch:1', share: 0.25 },
    { slot: 'snack', text: 'a protein shake' },
  ] }, { batches });
  assert.deepEqual(out, [
    { slot: 'lunch', time: '13:00', text: 'a quarter of the chilli', batchId: 'batch:1', share: 0.25 },
    { slot: 'snack', time: SPLIT_DEFAULT_TIMES.snack, text: 'a protein shake', batchId: null, share: null },
    { slot: 'dinner', time: '19:30', text: 'pasta with pesto, a big bowl', batchId: null, share: null },
  ]);
});

test('a batch it made up is dropped, and the words stay', () => {
  const [m] = parseDaySplit({ meals: [{ slot: 'lunch', time: '13:00', text: 'some stew', batch: 'batch:9', share: 0.5 }] }, { batches });
  assert.equal(m.batchId, null);
  assert.equal(m.share, null);
  assert.equal(m.text, 'some stew');
});

test('a split that makes no sense is refused', () => {
  const bad = [
    null, 'meals', { meals: 'x' }, { meals: [] },
    { meals: Array.from({ length: SPLIT_MAX_MEALS + 1 }, () => ({ slot: 'snack', time: '10:00', text: 'a biscuit' })) },
    { meals: [{ slot: 'brunch', time: '11:00', text: 'eggs' }] },
    { meals: [{ slot: 'lunch', time: '25:00', text: 'eggs' }] },
    { meals: [{ slot: 'lunch', time: '13:00', text: '  ' }] },
  ];
  for (const b of bad) assert.throws(() => parseDaySplit(b, { batches }), /split didn.t make sense/);
});
