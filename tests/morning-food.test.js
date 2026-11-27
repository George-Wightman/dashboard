process.env.TZ = 'Europe/London';

import test from 'node:test';
import assert from 'node:assert/strict';
import { rowUsuals, rowPots, MEAL_TIMES, POT_SHARES, mealsOn } from '../js/food.js';
import { logTap, usualFromMeal } from '../js/morning.js';
import { makeStore, clock } from './helpers.js';

const TODAY = '2026-11-27';
const at = (day, hh, mm = 0) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, hh, mm); };

function setup() {
  const now = clock(at('2026-11-01', 9));
  const store = makeStore({ now, prefix: 'r' });
  const granola = store.saveUsual({ name: 'Granola bowl', protein: 45, kcal: 1000 });
  const eggsToast = store.saveUsual({ name: '4 eggs on Philly toast', protein: 40, kcal: 700 });
  const eggsPitta = store.saveUsual({ name: '6 eggs in pittas', protein: 50, kcal: 900 });
  const shake = store.saveUsual({ name: 'Protein shake', protein: 40, kcal: 300 });
  return { now, store, granola, eggsToast, eggsPitta, shake };
}

test('a row offers the usuals had most recently at that meal, two at most', () => {
  const { now, store, granola, eggsToast, eggsPitta, shake } = setup();
  // London lunches early in the month, Salzburg lunches lately.
  store.addMeal({ at: at('2026-11-12', 13), usualId: eggsPitta.id });
  store.addMeal({ at: at('2026-11-20', 13), usualId: shake.id });
  store.addMeal({ at: at('2026-11-25', 13), usualId: eggsToast.id });
  store.addMeal({ at: at('2026-11-26', 8, 30), usualId: granola.id });
  now.set(at(TODAY, 8));
  const doc = store.doc();
  assert.deepEqual(rowUsuals(doc, 'lunch', TODAY).map((u) => u.name), ['4 eggs on Philly toast', 'Protein shake']);
  assert.deepEqual(rowUsuals(doc, 'breakfast', TODAY).map((u) => u.name), ['Granola bowl']);
  assert.deepEqual(rowUsuals(doc, 'dinner', TODAY), []);
});

test('a usual not had at that meal for two weeks drops off; one Claude gave a home meal shows straight away', () => {
  const { now, store, eggsPitta } = setup();
  store.addMeal({ at: at('2026-11-10', 13), usualId: eggsPitta.id });
  now.set(at(TODAY, 8));
  assert.deepEqual(rowUsuals(store.doc(), 'lunch', TODAY), []);
  store.saveUsual({ name: 'Chicken salad', protein: 45, kcal: 600, slot: 'lunch' });
  assert.deepEqual(rowUsuals(store.doc(), 'lunch', TODAY).map((u) => u.name), ['Chicken salad']);
  assert.equal(store.doc().meals['usual:chicken-salad'].slot, 'lunch');
});

test('an archived usual is never offered', () => {
  const { now, store, eggsToast } = setup();
  store.addMeal({ at: at('2026-11-25', 13), usualId: eggsToast.id });
  store.archiveMeal(eggsToast.id);
  now.set(at(TODAY, 8));
  assert.deepEqual(rowUsuals(store.doc(), 'lunch', TODAY), []);
});

test('pots in the fridge show on lunch and dinner, with shares to tap', () => {
  const { now, store } = setup();
  now.set(at('2026-11-25', 20));
  store.saveBatch({ name: 'Chilli', ingredients: 'beef, beans', protein: 200, kcal: 3000, cookedOn: '2026-11-25' });
  now.set(at(TODAY, 8));
  assert.deepEqual(rowPots(store.doc(), 'dinner', TODAY).map((b) => b.name), ['Chilli']);
  assert.deepEqual(rowPots(store.doc(), 'lunch', TODAY).map((b) => b.name), ['Chilli']);
  assert.deepEqual(rowPots(store.doc(), 'breakfast', TODAY), []);
  assert.deepEqual(POT_SHARES, [0.167, 0.2, 0.25, 0.333, 0.5]);
  assert.deepEqual(MEAL_TIMES, { breakfast: '08:30', lunch: '13:00', dinner: '19:00', snack: '16:00' });
});

test('a tap logs yesterday\'s meal at its row: a usual, a share of a pot, or his words', () => {
  const { now, store, granola } = setup();
  now.set(at('2026-11-25', 20));
  const pot = store.saveBatch({ name: 'Chilli', ingredients: 'beef', protein: 200, kcal: 3000, cookedOn: '2026-11-25' });
  now.set(at(TODAY, 8));
  logTap(store, { day: '2026-11-26', slot: 'breakfast', usualId: granola.id }, 4);
  logTap(store, { day: '2026-11-26', slot: 'dinner', batchId: pot.id, share: 0.2 }, 4);
  logTap(store, { day: '2026-11-26', slot: 'dinner', batchId: pot.id, share: 0.2 }, 4);
  logTap(store, { day: '2026-11-26', slot: 'snack', text: 'a protein bar' }, 4);
  const ms = mealsOn(store.doc(), '2026-11-26');
  assert.deepEqual(ms.map((m) => [m.slot, m.at.slice(11, 16) && new Date(m.at).getHours()]), [['breakfast', 8], ['snack', 16], ['dinner', 19], ['dinner', 19]]);
  assert.equal(ms.filter((m) => m.batchId === pot.id).length, 2);
  assert.equal(ms.find((m) => m.text === 'a protein bar').state, 'pending');
  assert.throws(() => logTap(store, { day: '2026-11-26', slot: 'lunch', text: '  ' }, 4), /Say what you had/);
});

test('an estimated meal can become a usual for its row; a pending one cannot', () => {
  const { now, store } = setup();
  now.set(at(TODAY, 8));
  const m = logTap(store, { day: '2026-11-26', slot: 'lunch', text: 'chicken wrap' }, 4);
  assert.throws(() => usualFromMeal(store, m.id), /once it has numbers/);
  store.updateMeal(m.id, { state: 'estimated', estimate: { name: 'Chicken wrap', protein: { low: 30, mid: 35, high: 40 }, kcal: { low: 500, mid: 550, high: 600 } }, final: { protein: 35, kcal: 550 } });
  const u = usualFromMeal(store, m.id);
  assert.equal(u.name, 'Chicken wrap');
  assert.equal(u.slot, 'lunch');
  assert.equal(store.doc().meals[m.id].usualId, u.id);
  assert.deepEqual(rowUsuals(store.doc(), 'lunch', TODAY).map((x) => x.name), ['Chicken wrap']);
});
