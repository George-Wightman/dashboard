process.env.TZ = 'Europe/London';

import test from 'node:test';
import assert from 'node:assert/strict';
import { POT_SYSTEM, potPrompt, parsePot, liveBatches } from '../js/food.js';
import { savePot } from '../js/morning.js';
import { makeStore, clock } from './helpers.js';

const reply = {
  name: 'Chicken and rice',
  items: [
    { name: 'raw chicken breast', qty: 6, unit: 'breasts', protein: 186, kcal: 990, carbs: 0, fat: 21, fibre: 0, sugar: 0, veg: 0, fruit: 0, oilyFish: 0 },
    { name: 'dry basmati rice', qty: 500, unit: 'g', protein: 40, kcal: 1750, carbs: 390, fat: 3, fibre: 5, sugar: 0, veg: 0, fruit: 0, oilyFish: 0 },
    { name: 'chopped tomatoes', qty: 2, unit: 'tins', protein: 8, kcal: 160, carbs: 28, fat: 1, fibre: 7, sugar: 20, veg: 5, fruit: 0, oilyFish: 0 },
  ],
  plants: ['rice', 'tomato'],
};

test('the pot prompt carries his words and asks for the whole pot, raw and dry weights as said', () => {
  assert.match(potPrompt({ text: '6 chicken breasts, 500 g dry rice, 2 tins tomatoes' }), /What went in: 6 chicken breasts, 500 g dry rice, 2 tins tomatoes/);
  assert.match(POT_SYSTEM, /whole pot/);
  assert.match(POT_SYSTEM, /dry/);
});

test('a pot is its items added up', () => {
  const p = parsePot(reply);
  assert.equal(p.name, 'Chicken and rice');
  assert.equal(p.items.length, 3);
  assert.equal(p.protein, 234);
  assert.equal(p.kcal, 2900);
  assert.equal(p.veg, 5);
  assert.deepEqual(p.plants, ['rice', 'tomato']);
});

test('a pot with no name or no items is refused', () => {
  for (const bad of [null, {}, { ...reply, name: ' ' }, { ...reply, items: [] }, { ...reply, items: [{ name: 'x' }] }]) {
    assert.throws(() => parsePot(bad), /pot didn.t make sense/);
  }
});

test('saving a pot puts it in the fridge, cooked on the day given, with his words kept', () => {
  const store = makeStore({ now: clock(new Date(2026, 10, 27, 8, 0)) });
  const b = savePot(store, { text: '6 chicken breasts, 500 g dry rice', pot: parsePot(reply), cookedOn: '2026-11-26' });
  assert.equal(b.kind, 'batch');
  assert.equal(b.cookedOn, '2026-11-26');
  assert.equal(b.protein, 234);
  assert.match(b.ingredients, /6 chicken breasts/);
  assert.deepEqual(liveBatches(store.doc(), '2026-11-27').map((x) => x.id), [b.id]);
});
