process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEstimate, claudeEstimate, finalFor, withQty, itemsTotal, mealValue, macroGap, dayBalance, weekBalance, fuelSettings, servingValue,
} from '../js/food.js';
import { READS } from '../claude/read.js';
import { runOp } from '../claude/ops.js';
import { fixture, makeStore, clock } from './helpers.js';

const TODAY = '2026-11-17';
const egg = { name: 'fried egg', qty: 4, unit: 'eggs', protein: 24, kcal: 360, carbs: 2, fat: 28, fibre: 0, sugar: 1, veg: 0, fruit: 0, oilyFish: 0 };
const toast = { name: 'wholemeal toast', qty: 2, unit: 'slices', protein: 8, kcal: 200, carbs: 34, fat: 3, fibre: 6, sugar: 3, veg: 0, fruit: 0, oilyFish: 0 };
const spinach = { name: 'spinach', qty: 160, unit: 'g', protein: 4, kcal: 40, carbs: 2, fat: 1, fibre: 4, sugar: 0, veg: 2, fruit: 0, oilyFish: 0 };

test('a full estimate keeps carbs, fat, fibre, sugar, the groups and the plants', () => {
  const est = parseEstimate({ name: 'Eggs on toast', items: [egg, toast, spinach], plants: ['Spinach', 'wheat', 'spinach', ''], protein: { low: 30, mid: 36, high: 42 }, kcal: { low: 550, mid: 600, high: 700 } });
  assert.deepEqual([est.carbs, est.fat, est.fibre, est.sugar, est.veg, est.fruit, est.oilyFish], [38, 32, 10, 4, 2, 0, 0]);
  assert.deepEqual(est.plants, ['spinach', 'wheat']);
  const final = finalFor(est);
  assert.equal(final.fibre, 10);
  assert.deepEqual(final.plants, ['spinach', 'wheat']);
});

test('an old-style estimate (protein and kcal only) has no balance, and the portion still scales', () => {
  const est = parseEstimate({ name: 'Wrap', items: [{ name: 'wrap', protein: 40, kcal: 560 }], protein: { low: 38, mid: 46, high: 54 }, kcal: { low: 650, mid: 780, high: 900 } });
  assert.equal(est.fibre, undefined);
  assert.equal(est.plants, undefined);
  const est2 = parseEstimate({ name: 'Soup', items: [], fibre: 8, veg: 2, protein: { low: 10, mid: 12, high: 14 }, kcal: { low: 300, mid: 320, high: 340 } });
  assert.deepEqual(finalFor(est2, 'bigger'), { protein: 16, kcal: 420, fibre: 10, veg: 2.5 });
});

test('changing a count moves every number of that item, and veg portions by the half', () => {
  const [, , sp] = parseEstimate({ name: 'x', items: [egg, toast, spinach], protein: { low: 1, mid: 2, high: 3 }, kcal: { low: 1, mid: 2, high: 3 } }).items;
  const more = withQty(sp, 200);
  assert.deepEqual([more.protein, more.fibre, more.veg], [5, 5, 2.5]);
  assert.equal(itemsTotal([withQty(sp, 0)]).veg, undefined);
  assert.equal(itemsTotal([withQty(sp, 0), withQty(sp, 80)]).veg, 1);
});

test('Claude’s estimate is exact: the range is the total, and a meal without items is refused', () => {
  const est = claudeEstimate({ name: 'Eggs on toast', items: [egg, toast], plants: ['wheat'] });
  assert.deepEqual(est.protein, { low: 32, mid: 32, high: 32 });
  assert.equal(est.by, 'claude');
  assert.equal(est.fibre, 6);
  assert.throws(() => claudeEstimate({ items: [] }), /needs items/);
});

test('a correction of protein and kcal keeps the rest of the estimate; one with fibre replaces it', () => {
  const meal = { final: { protein: 30, kcal: 600, carbs: 60, fat: 20, fibre: 5, plants: ['oat'] } };
  assert.deepEqual(mealValue({ ...meal, correction: { protein: 40, kcal: 700, why: 'x' } }), { protein: 40, kcal: 700, carbs: 60, fat: 20, fibre: 5, plants: ['oat'] });
  assert.equal(mealValue({ ...meal, correction: { protein: 40, kcal: 700, fibre: 9, why: 'x' } }).fibre, 9);
});

test('grams that don’t add up to the calories are flagged', () => {
  assert.equal(macroGap({ protein: 30, kcal: 600, carbs: 60, fat: 20 }), null); // 120 + 240 + 180 = 540
  assert.equal(macroGap({ protein: 30, kcal: 1200, carbs: 60, fat: 20 }), 540);
  assert.equal(macroGap({ protein: 30, kcal: 600 }), null);
});

test('a serving takes its share of every number in the pot', () => {
  assert.deepEqual(servingValue({ protein: 260, kcal: 4200, fibre: 45, veg: 8, plants: ['bean'] }, 0.25), { protein: 65, kcal: 1050, fibre: 11, veg: 2, plants: ['bean'] });
});

function balanceDoc() {
  const doc = fixture();
  const m = (id, day, final) => ({ id, kind: 'meal', day, at: `${day}T12:00:00.000Z`, slot: 'lunch', state: 'estimated', status: 'active', final });
  doc.meals = {
    'meal:a': m('meal:a', TODAY, { protein: 40, kcal: 800, carbs: 80, fat: 30, fibre: 12, sugar: 10, veg: 2, fruit: 1, oilyFish: 1, plants: ['oat', 'apple'] }),
    'meal:b': m('meal:b', TODAY, { protein: 50, kcal: 900, carbs: 90, fat: 30, fibre: 8, sugar: 20, veg: 1, fruit: 0, oilyFish: 0, plants: ['oat', 'carrot'] }),
    'meal:c': m('meal:c', '2026-11-16', { protein: 60, kcal: 1000 }),
    'meal:d': m('meal:d', '2026-11-16', { protein: 20, kcal: 300, carbs: 30, fat: 10, fibre: 5, sugar: 5, veg: 0, fruit: 1, oilyFish: 0, plants: ['banana'] }),
  };
  return doc;
}

test('a day adds up the meals with a full estimate; the week averages only full days', () => {
  const doc = balanceDoc();
  const today = dayBalance(doc, TODAY);
  assert.deepEqual([today.meals, today.known, today.fibre, today.fruitVeg, today.oilyFish], [2, 2, 20, 4, 1]);
  assert.deepEqual(today.plants, ['oat', 'apple', 'carrot']);
  assert.deepEqual([dayBalance(doc, '2026-11-16').known, dayBalance(doc, '2026-11-16').meals], [1, 2]);
  const week = weekBalance(doc, TODAY);
  assert.equal(week.days, 1);
  assert.equal(week.fibre, 20);
  assert.deepEqual(week.plants, ['apple', 'banana', 'carrot', 'oat']);
  assert.equal(week.oilyFish, 1);
  // 90 g protein, 170 g carbs, 60 g fat: 360, 680 and 540 kcal of 1,580.
  assert.deepEqual(week.split, { protein: 23, carbs: 43, fat: 34 });
  assert.equal(fuelSettings(doc).fibre, 35);
});

test('the food read shows each meal’s balance and the week’s', () => {
  const text = READS.food(balanceDoc(), TODAY, '');
  assert.match(text, /Tue 17 Nov: protein 90 of 180 g · fibre 20 of 35 g, fruit & veg 4 of 5/);
  assert.match(text, /Mon 16 Nov: protein 80 of 180 g · fibre 5 of 35 g, fruit & veg 1 of 5 \(from 1 of 2 meals\)/);
  assert.match(text, /carbs 80 g, fat 30 g, fibre 12 g, sugar 10 g; veg 2, fruit 1, oily fish 1; plants oat, apple/);
  assert.match(text, /Balance, last 7 days \(averages from 1 full day\): fibre 20 g a day \(target 35\)/);
  assert.match(text, /4 different plants \(30\) · oily fish 1 \(1\)/);
});

test('Claude logs a meal with his own estimate, counted at once, and sets the balance targets', () => {
  const store = makeStore({ now: clock(new Date(2026, 10, 17, 21, 0)) });
  const said = runOp(store, { op: 'meal', log: '4 fried eggs, 2 slices wholemeal toast', time: '08:00', name: 'Eggs on toast', items: [egg, toast], plants: ['wheat'] });
  assert.match(said, /Logged "Eggs on toast" for today at 08:00: 32 g protein, 560 kcal, 36 g carbs, 31 g fat, 6 g fibre, 0 fruit & veg/);
  const meal = Object.values(store.doc().meals).find((m) => m.kind === 'meal');
  assert.equal(meal.state, 'estimated');
  assert.equal(meal.estimate.by, 'claude');
  assert.equal(mealValue(meal).fibre, 6);
  assert.match(runOp(store, { op: 'meal', log: 'cereal', time: '09:00', items: [{ name: 'cereal', qty: 1, unit: 'bowl', protein: 5, kcal: 900, carbs: 40, fat: 5, fibre: 3, sugar: 10 }] }), /the grams come to about 230 kcal, not 900/);
  assert.match(runOp(store, { op: 'meal', log: 'shake', time: '10:00', items: [{ name: 'shake', qty: 1, protein: 25, kcal: 120 }] }), /left out of the balance/);
  assert.throws(() => runOp(store, { op: 'meal', log: 'x', time: '10:00', items: [] }), /needs items/);
  runOp(store, { op: 'meal', fuel: { fibre: 38 } });
  assert.equal(fuelSettings(store.doc()).fibre, 38);
  assert.throws(() => runOp(store, { op: 'meal', fuel: { fibre: 0 } }), /fibre as a number above 0/);
});

test('a correction can carry the balance, and a batch keeps it for every serving', () => {
  const store = makeStore({ now: clock(new Date(2026, 10, 17, 21, 0)) });
  const meal = store.addMeal({ at: new Date(2026, 10, 17, 12, 0), text: 'pasta' });
  store.updateMeal(meal.id, { state: 'estimated', final: { protein: 30, kcal: 700 } });
  assert.match(runOp(store, { op: 'meal', id: meal.id, protein: 35, kcal: 1000, fibre: 6, carbs: 120, fat: 40, plants: ['wheat'], why: 'the cheese' }), /6 g fibre/);
  assert.equal(dayBalance(store.doc(), TODAY).known, 1);
  runOp(store, { op: 'meal', batch: { name: 'Chilli', ingredients: 'mince, beans', protein: 260, kcal: 4200, fibre: 40, veg: 8, plants: ['kidney bean'], day: 'today' } });
  runOp(store, { op: 'meal', share: '1/4', of: 'chilli', time: '19:00' });
  const serving = Object.values(store.doc().meals).find((m) => m.batchId);
  assert.deepEqual([serving.final.fibre, serving.final.veg, serving.final.plants], [10, 2, ['kidney bean']]);
});
