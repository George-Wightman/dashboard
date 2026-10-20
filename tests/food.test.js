import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slotFor, parseEstimate, finalFor, mealValue, dayProtein, weekKcal, maintenanceVerdict, usualMeals, mealWork, mealPrompt,
  MEAL_SYSTEM, fuelSettings, mealsOn, withQty, nextQty, itemsTotal,
} from '../js/food.js';
import { fixture } from './helpers.js';

const est = { name: 'Chicken wrap and crisps', items: [{ name: 'Wrap', protein: 40, kcal: 560 }], protein: { low: 38, mid: 46, high: 54 }, kcal: { low: 650, mid: 780, high: 900 } };
const meal = (id, day, extra) => ({ id, kind: 'meal', day, at: `${day}T12:30:00.000Z`, state: 'estimated', estimate: est, portion: 'right', final: { protein: 46, kcal: 780 }, ...extra });

test('slots follow the clock', () => {
  assert.equal(slotFor(new Date(2026, 9, 20, 7, 20)), 'breakfast');
  assert.equal(slotFor(new Date(2026, 9, 20, 12, 34)), 'lunch');
  assert.equal(slotFor(new Date(2026, 9, 20, 16, 0)), 'snack');
  assert.equal(slotFor(new Date(2026, 9, 20, 19, 0)), 'dinner');
  assert.equal(slotFor(new Date(2026, 9, 20, 22, 0)), 'snack');
});

test('a sound estimate is kept and rounded; nonsense or a partial reply is refused', () => {
  assert.deepEqual(parseEstimate({ ...est, protein: { low: 37.6, mid: 46.2, high: 54 }, kcal: { low: 648, mid: 783, high: 901 } }).kcal, { low: 650, mid: 780, high: 900 });
  for (const bad of [{}, { ...est, name: '' }, { ...est, protein: { low: 50, mid: 40, high: 60 } }, { ...est, kcal: { low: -1, mid: 1, high: 2 } }, 'text', null]) {
    assert.throws(() => parseEstimate(bad), /didn’t make sense/);
  }
});

test('portions scale the middle of the range', () => {
  assert.deepEqual(finalFor(est, 'right'), { protein: 46, kcal: 780 });
  assert.deepEqual(finalFor(est, 'lighter'), { protein: 35, kcal: 590 });
  assert.deepEqual(finalFor(est, 'bigger'), { protein: 60, kcal: 1010 });
});

test("Claude's correction wins in every total", () => {
  const doc = fixture();
  doc.meals = { a: meal('a', '2026-10-20'), b: meal('b', '2026-10-20', { correction: { by: 'claude', protein: 20, kcal: 900, why: 'big pasta' } }) };
  assert.deepEqual(mealValue(doc.meals.b), { protein: 20, kcal: 900 });
  assert.equal(mealValue(meal('p', '2026-10-20', { state: 'pending', final: null })), null);
  assert.equal(dayProtein(doc, '2026-10-20'), 66);
});

test('meals of a day, in time order, archived ones left out', () => {
  const doc = fixture();
  doc.meals = {
    b: meal('b', '2026-10-20', { at: '2026-10-20T18:00:00.000Z' }),
    a: meal('a', '2026-10-20', { at: '2026-10-20T07:00:00.000Z' }),
    x: meal('x', '2026-10-20', { status: 'archived' }),
    y: meal('y', '2026-10-19'),
  };
  assert.deepEqual(mealsOn(doc, '2026-10-20').map((m) => m.id), ['a', 'b']);
});

test("the week's kcal is a mean over days with meals, and the verdict is ±10%", () => {
  const doc = fixture();
  doc.meals = { a: meal('a', '2026-10-19'), b: meal('b', '2026-10-20'), c: meal('c', '2026-10-20') };
  assert.deepEqual(weekKcal(doc, '2026-10-20'), { average: 1170, days: 2 });
  assert.deepEqual(weekKcal(fixture(), '2026-10-20'), { average: null, days: 0 });
  assert.equal(maintenanceVerdict(3050, 3000), 'about maintenance');
  assert.equal(maintenanceVerdict(3400, 3000), 'above maintenance');
  assert.equal(maintenanceVerdict(2600, 3000), 'below maintenance');
  assert.equal(maintenanceVerdict(3050, null), null);
  assert.equal(maintenanceVerdict(null, 3000), null);
});

test('fuel settings default to 180 g and no maintenance figure', () => {
  assert.deepEqual(fuelSettings(fixture()), { protein: 180, maintenanceKcal: null });
  const doc = fixture();
  doc.meals = { 'fuel:settings': { id: 'fuel:settings', kind: 'settings', protein: 190, maintenanceKcal: 3100, status: 'active' } };
  assert.deepEqual(fuelSettings(doc), { protein: 190, maintenanceKcal: 3100 });
});

test('usual meals by use; work only for meals this device holds a photo for, plus words-only ones', () => {
  const doc = fixture();
  doc.meals = {
    u1: { id: 'u1', kind: 'usual', name: 'Whey shake', protein: 25, kcal: 120, uses: 9, status: 'active' },
    u2: { id: 'u2', kind: 'usual', name: 'Usual breakfast', protein: 42, kcal: 610, uses: 14, status: 'active' },
    p: meal('p', '2026-10-20', { state: 'pending', photoState: 'local', tries: 0 }),
    f: meal('f', '2026-10-20', { state: 'failed', tries: 3, photoState: 'uploaded' }),
    g: meal('g', '2026-10-20', { state: 'failed', tries: 1, photoState: 'local' }),
    w: meal('w', '2026-10-20', { state: 'pending', photoState: null, tries: 0 }),
    o: meal('o', '2026-10-20', { state: 'pending', photoState: 'local', tries: 0 }),
  };
  assert.deepEqual(usualMeals(doc).map((u) => u.name), ['Usual breakfast', 'Whey shake']);
  const work = mealWork(doc, new Set(['p', 'g']));
  assert.deepEqual(work.estimate.map((m) => m.id).sort(), ['g', 'p', 'w']);
  assert.deepEqual(work.upload.map((m) => m.id).sort(), ['g', 'p']);
  assert.deepEqual(mealWork(doc, new Set()).estimate.map((m) => m.id), ['w']);
});

test('the prompt carries the words and the time, and the system asks for JSON only', () => {
  const p = mealPrompt({ text: 'chicken wrap, a big one', at: new Date(2026, 9, 20, 12, 34), hasPhoto: true });
  assert.match(p, /chicken wrap, a big one/);
  assert.match(p, /12:34/);
  assert.match(MEAL_SYSTEM, /JSON/);
  assert.match(mealPrompt({ text: '', at: new Date(2026, 9, 20, 12, 34), hasPhoto: true }), /photo/i);
});

test("review: the prompt doesn't name him", () => {
  const p = mealPrompt({ text: 'wrap', at: new Date(2026, 9, 20, 12, 34), hasPhoto: true });
  assert.doesNotMatch(p + MEAL_SYSTEM, /George/);
});

test('review: a marker logs the meal it names, at its time, once that time has passed', async () => {
  const { snapTime } = await import('../js/food.js');
  const now = new Date(2026, 9, 20, 14, 0);
  const breakfast = { slot: 'breakfast', start: new Date(2026, 9, 20, 8, 0).toISOString() };
  const dinner = { slot: 'dinner', start: new Date(2026, 9, 20, 19, 0).toISOString() };
  assert.equal(snapTime(now, breakfast).getHours(), 8);
  assert.equal(slotFor(snapTime(now, breakfast)), 'breakfast');
  assert.equal(snapTime(now, dinner).getTime(), now.getTime(), 'a marker still ahead: now');
  assert.equal(snapTime(now, null).getTime(), now.getTime());
});

test('items keep a count, and a new count moves the total from where it started', () => {
  const e = parseEstimate({ name: 'Egg breakfast', items: [{ name: 'Fried egg', qty: 4, unit: 'eggs', protein: 25, kcal: 360 }, { name: 'Pitta', qty: 2, unit: 'pittas', protein: 12, kcal: 330 }],
    protein: { low: 30, mid: 37, high: 45 }, kcal: { low: 600, mid: 700, high: 800 } });
  assert.deepEqual(e.items[0], { name: 'Fried egg', qty: 4, unit: 'eggs', protein: 25, kcal: 360, each: { protein: 6.3, kcal: 90 } });
  assert.deepEqual(finalFor(e), { protein: 37, kcal: 690 });
  const five = withQty(e.items[0], 5);
  assert.deepEqual([five.qty, five.protein, five.kcal], [5, 32, 450]);
  assert.deepEqual(itemsTotal([five, e.items[1]]), { protein: 44, kcal: 780 });
  // Back to four lands where it began: no drift.
  assert.equal(withQty(five, 4).kcal, 360);
});

test('an item with no count counts as one; an estimate without counts uses the range', () => {
  const e = parseEstimate(est);
  assert.deepEqual([e.items[0].qty, e.items[0].unit], [1, '']);
  assert.deepEqual(finalFor({ ...est, items: [] }, 'right'), { protein: 46, kcal: 780 });
});

test('a count steps by one, a half below one, and 25 for grams', () => {
  assert.equal(nextQty({ qty: 4, unit: 'eggs' }, 1), 5);
  assert.equal(nextQty({ qty: 1, unit: 'pitta' }, -1), 0.5);
  assert.equal(nextQty({ qty: 0.5, unit: 'pitta' }, 1), 1);
  assert.equal(nextQty({ qty: 0.5, unit: 'pitta' }, -1), 0);
  assert.equal(nextQty({ qty: 0, unit: 'pitta' }, -1), 0);
  assert.equal(nextQty({ qty: 100, unit: 'g' }, 1), 125);
});

test('the prompt trusts his words for amounts and gives his usual meals for scale', () => {
  assert.match(MEAL_SYSTEM, /trust his words over the photo/);
  assert.match(MEAL_SYSTEM, /"qty"/);
  const p = mealPrompt({ text: '5 eggs', at: new Date(2026, 9, 20, 8, 0), hasPhoto: false, usual: [{ name: 'Big egg breakfast', protein: 52, kcal: 1030 }] });
  assert.match(p, /For scale, his usual meals: Big egg breakfast: 52 g protein, 1030 kcal/);
  assert.doesNotMatch(mealPrompt({ text: 'x', at: new Date(), hasPhoto: false }), /For scale/);
});

test('a meal whose photo was uploaded is estimated again from its words', () => {
  const doc = fixture();
  doc.meals = { a: meal('a', '2026-10-20', { state: 'pending', photoState: 'uploaded' }), b: meal('b', '2026-10-20', { state: 'pending', photoState: 'local' }) };
  assert.deepEqual(mealWork(doc, new Set()).estimate.map((m) => m.id), ['a']);
});
