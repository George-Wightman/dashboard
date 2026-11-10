process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { READS } from '../claude/read.js';
import { runOp } from '../claude/ops.js';
import { parseShare, shareWords, liveBatches, batchEaten, dayProtein, mealValue } from '../js/food.js';
import { makeStore, clock } from './helpers.js';

const TODAY = '2026-10-20';
const store9pm = () => makeStore({ now: clock(new Date(2026, 9, 20, 21, 0)) });
const chilli = { name: 'Chilli', ingredients: '1kg beef mince, 2 tins kidney beans, 400g rice, a jar of sauce', protein: 260, kcal: 4200, day: 'yesterday' };
const batchId = (store) => Object.values(store.doc().meals).find((m) => m.kind === 'batch').id;

test('a share is part of the whole pot, said as a number, a fraction or a percentage', () => {
  assert.equal(parseShare(0.25), 0.25);
  assert.equal(parseShare('1/4'), 0.25);
  assert.equal(parseShare('20%'), 0.2);
  assert.equal(parseShare('1/3'), 0.333);
  for (const bad of [0, 1.5, '3/2', 'a quarter', -0.1]) assert.throws(() => parseShare(bad), /part of the whole pot/);
  assert.equal(shareWords(0.25), 'a quarter');
  assert.equal(shareWords(0.2), 'a fifth');
  assert.equal(shareWords(0.3), '30%');
});

test('a batch is saved whole, and each serving is his share of it, counted exactly', () => {
  const store = store9pm();
  assert.match(runOp(store, { op: 'meal', batch: chilli }), /Saved the batch "Chilli", cooked Mon 19 Oct: 260 g protein, 4200 kcal for the whole pot/);
  const id = batchId(store);
  assert.equal(store.doc().meals[id].cookedOn, '2026-10-19');
  assert.match(runOp(store, { op: 'meal', share: '1/4', of: 'the chilli', time: '12:30' }),
    /Logged a quarter of the chilli for today at 12:30: 65 g, 1050 kcal; about 75% of the pot not logged yet/);
  const serving = Object.values(store.doc().meals).find((m) => m.batchId === id);
  assert.equal(serving.state, 'estimated');
  assert.equal(serving.text, 'a quarter of the chilli');
  assert.deepEqual(mealValue(serving), { protein: 65, kcal: 1050 });
  assert.equal(dayProtein(store.doc(), TODAY), 65);
  assert.equal(batchEaten(store.doc(), id), 0.25);
});

test('more than the whole pot is refused unless "over" says so', () => {
  const store = store9pm();
  runOp(store, { op: 'meal', batch: chilli });
  runOp(store, { op: 'meal', share: 0.5, of: 'chilli', day: 'yesterday', time: '19:00' });
  runOp(store, { op: 'meal', share: 0.4, of: 'chilli', time: '12:30' });
  assert.throws(() => runOp(store, { op: 'meal', share: '1/4', of: 'chilli', time: '19:00' }), /makes 115% of the chilli \(90% already logged\)/);
  assert.match(runOp(store, { op: 'meal', share: '1/4', of: 'chilli', time: '19:00', over: true }), /whole pot logged/);
});

test('a serving needs a live batch, a time, and a day on or after the cooking', () => {
  const store = store9pm();
  assert.throws(() => runOp(store, { op: 'meal', share: '1/4', of: 'curry', time: '12:30' }), /No batch called "curry"/);
  runOp(store, { op: 'meal', batch: chilli });
  assert.throws(() => runOp(store, { op: 'meal', share: '1/4', of: 'curry', time: '12:30' }), /there's "Chilli"/);
  assert.throws(() => runOp(store, { op: 'meal', share: '1/4', of: 'chilli' }), /needs the time/);
  assert.throws(() => runOp(store, { op: 'meal', share: '1/4', of: 'chilli', day: '2026-10-18', time: '12:30' }), /wasn’t cooked until Mon 19 Oct/);
  assert.throws(() => runOp(store, { op: 'meal', batch: { ...chilli, ingredients: '' } }), /what went in/);
});

test('correcting a batch moves the servings already logged; removing it keeps them', () => {
  const store = store9pm();
  runOp(store, { op: 'meal', batch: chilli });
  const id = batchId(store);
  runOp(store, { op: 'meal', share: '1/4', of: 'chilli', time: '12:30' });
  assert.match(runOp(store, { op: 'meal', batch: { id, protein: 300, kcal: 4800 } }), /300 g protein, 4800 kcal for the pot; 1 serving moved with it/);
  assert.equal(dayProtein(store.doc(), TODAY), 75);
  assert.throws(() => runOp(store, { op: 'meal', id, remove: true }), /needs a why/);
  assert.match(runOp(store, { op: 'meal', id, remove: true, why: 'finished' }), /out of the fridge \(finished\)/);
  assert.equal(liveBatches(store.doc(), TODAY).length, 0);
  assert.equal(dayProtein(store.doc(), TODAY), 75);
});

test('a batch shows as in the fridge for a week, until it is all logged', () => {
  const store = store9pm();
  runOp(store, { op: 'meal', batch: { ...chilli, day: '2026-10-13' } });
  assert.equal(liveBatches(store.doc(), TODAY).length, 0, 'a week old');
  runOp(store, { op: 'meal', batch: { ...chilli, name: 'Curry' } });
  assert.deepEqual(liveBatches(store.doc(), TODAY).map((b) => b.name), ['Curry']);
  runOp(store, { op: 'meal', share: 1, of: 'curry', time: '12:30' });
  assert.equal(liveBatches(store.doc(), TODAY).length, 0, 'all logged');
});

test('rewording a serving in the app makes it an ordinary meal again', () => {
  const store = store9pm();
  runOp(store, { op: 'meal', batch: chilli });
  runOp(store, { op: 'meal', share: '1/4', of: 'chilli', time: '12:30' });
  const serving = Object.values(store.doc().meals).find((m) => m.batchId);
  store.redoMeal(serving.id, 'chilli and rice');
  assert.equal(store.doc().meals[serving.id].batchId, null);
  assert.equal(store.doc().meals[serving.id].state, 'pending');
});

test('the food read shows each batch with what went in and how much of it is logged', () => {
  const store = store9pm();
  runOp(store, { op: 'meal', batch: chilli });
  runOp(store, { op: 'meal', share: '1/4', of: 'chilli', time: '12:30' });
  const text = READS.food(store.doc(), TODAY, '');
  assert.match(text, /12:30 lunch · a quarter of the chilli · 65 g, 1,050 kcal \(his share 0\.25 of batch #batch:/);
  assert.match(text, /Chilli, cooked Mon 19 Oct · 260 g, 4,200 kcal · "1kg beef mince, 2 tins kidney beans, 400g rice, a jar of sauce" · 1 serving, 25% of the pot logged/);
});
