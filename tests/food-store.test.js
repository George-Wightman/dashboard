import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, clock } from './helpers.js';
import { mergeDocs } from '../js/merge.js';
import { recordProblem, MAPS } from '../js/doc.js';
import { usualMeals, fuelSettings } from '../js/food.js';

test('meals are a map of the synced document', () => {
  assert.ok(MAPS.includes('meals'));
  assert.equal(recordProblem('meals', 'meal:x', { id: 'meal:x', kind: 'meal', day: '2026-10-20', status: 'active' }), null);
});

test('a photo meal starts pending, with its slot and logical day; 01:00 belongs to the day before', () => {
  const store = makeStore({ now: clock(new Date(2026, 9, 20, 12, 34)) });
  const m = store.addMeal({ at: new Date(2026, 9, 20, 12, 34), text: 'chicken wrap', hasPhoto: true });
  assert.match(m.id, /^meal:/);
  assert.deepEqual([m.kind, m.day, m.slot, m.status, m.state, m.photoState, m.tries, m.text], ['meal', '2026-10-20', 'lunch', 'active', 'pending', 'local', 0, 'chicken wrap']);
  const late = store.addMeal({ at: new Date(2026, 9, 21, 1, 0), text: 'toast', hasPhoto: false });
  assert.equal(late.day, '2026-10-20');
  assert.equal(late.photoState, null);
});

test('a usual meal logs exactly, estimated at once, and counts a use', () => {
  const store = makeStore();
  const u = store.saveUsual({ name: 'Whey shake', protein: 25, kcal: 120 });
  assert.equal(u.id, 'usual:whey-shake');
  const m = store.addMeal({ at: new Date(2026, 8, 10, 9, 0), usualId: u.id });
  assert.deepEqual([m.state, m.final, m.text], ['estimated', { protein: 25, kcal: 120 }, 'Whey shake']);
  assert.equal(usualMeals(store.doc())[0].uses, 1);
  store.saveUsual({ name: 'Whey shake', protein: 27, kcal: 130 });
  assert.equal(usualMeals(store.doc()).length, 1);
  assert.equal(usualMeals(store.doc())[0].protein, 27);
});

test('updating a meal keeps what it does not touch; archiving hides it', () => {
  const store = makeStore();
  const m = store.addMeal({ at: new Date(2026, 8, 10, 12, 0), text: 'pasta', hasPhoto: true });
  store.updateMeal(m.id, { state: 'estimated', final: { protein: 30, kcal: 800 } });
  assert.deepEqual([store.doc().meals[m.id].text, store.doc().meals[m.id].photoState, store.doc().meals[m.id].final.kcal], ['pasta', 'local', 800]);
  store.archiveMeal(m.id);
  assert.equal(store.doc().meals[m.id].status, 'archived');
});

test('fuel settings are written by setFuel', () => {
  const store = makeStore();
  store.setFuel({ maintenanceKcal: 3100 });
  assert.deepEqual(fuelSettings(store.doc()), { protein: 180, maintenanceKcal: 3100 });
});

test('a phone meal and a laptop meal on the same day both survive the merge', () => {
  const phone = makeStore({ prefix: 'p' });
  const laptop = makeStore({ prefix: 'l' });
  phone.addMeal({ at: new Date(2026, 8, 10, 8, 0), text: 'eggs', hasPhoto: true });
  laptop.addMeal({ at: new Date(2026, 8, 10, 13, 0), text: 'soup', hasPhoto: false });
  const merged = mergeDocs(phone.doc(), laptop.doc());
  assert.deepEqual(Object.values(merged.meals).map((m) => m.text).sort(), ['eggs', 'soup']);
});
