process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { READS } from '../claude/read.js';
import { runOp, FIELDS } from '../claude/ops.js';
import { main } from '../claude/cli.js';
import { createFileStore } from '../claude/files.js';
import { fixture, makeStore, clock, FakeGitHub, ids, fakeApi } from './helpers.js';

const TODAY = '2026-10-20';
const est = { name: 'Chicken wrap and crisps', items: [], protein: { low: 38, mid: 46, high: 54 }, kcal: { low: 650, mid: 780, high: 900 } };

function foodDoc() {
  const doc = fixture();
  doc.meals = {
    'meal:aaaa1111': { id: 'meal:aaaa1111', kind: 'meal', day: TODAY, at: '2026-10-20T06:20:00.000Z', slot: 'breakfast', text: 'yoghurt, oats, whey', state: 'estimated', estimate: { ...est, name: 'Yoghurt, oats and whey' }, portion: 'right', final: { protein: 42, kcal: 610 }, photo: 'photos/2026/10/aaaa1111.jpg', photoState: 'uploaded', status: 'active' },
    'meal:bbbb2222': { id: 'meal:bbbb2222', kind: 'meal', day: TODAY, at: '2026-10-20T11:34:00.000Z', slot: 'lunch', text: 'pasta', state: 'estimated', estimate: { ...est, name: 'Pasta bake' }, portion: 'bigger', final: { protein: 30, kcal: 700 }, correction: { by: 'claude', protein: 30, kcal: 1100, why: 'oil and cheese', at: '2026-10-20T20:00:00.000Z' }, photoState: 'local', status: 'active' },
    'meal:cccc3333': { id: 'meal:cccc3333', kind: 'meal', day: TODAY, at: '2026-10-20T15:00:00.000Z', slot: 'snack', text: 'banana', state: 'pending', photoState: null, status: 'active' },
    'fuel:settings': { id: 'fuel:settings', kind: 'settings', protein: 180, maintenanceKcal: 3000, status: 'active' },
  };
  return doc;
}

test('food lists each meal with its value, photo, and corrections, then protein by day and the week', () => {
  const text = READS.food(foodDoc(), TODAY, '');
  assert.match(text, /07:20 breakfast · Yoghurt, oats and whey · 42 g, 610 kcal \(about right\) · he said "yoghurt, oats, whey" · photo photos\/2026\/10\/aaaa1111\.jpg · #meal:aaaa1111/);
  assert.match(text, /12:34 lunch · Pasta bake · 30 g, 1,100 kcal — corrected by you from 700 \(oil and cheese\) · he said "pasta" · \(photo on the phone, not uploaded yet\)/);
  assert.match(text, /16:00 snack · banana · waiting to be estimated/);
  assert.match(text, /Tue 20 Oct: protein 72 of 180 g/);
  assert.match(text, /Week: about 1,710 kcal a day over 1 day — below maintenance \(3,000\)/);
  assert.match(text, /1 meal waiting to be estimated/);
});

test('the meal op corrects a meal with a reason, saves a usual meal, and sets Fuel; bad input is refused', () => {
  const store = makeStore({ now: clock(new Date(2026, 9, 20, 21, 0)) });
  const meal = store.addMeal({ at: new Date(2026, 9, 20, 12, 0), text: 'pasta', hasPhoto: false });
  store.updateMeal(meal.id, { state: 'estimated', estimate: est, final: { protein: 46, kcal: 780 } });
  assert.match(runOp(store, { op: 'meal', id: meal.id, protein: 35, kcal: 1050, why: 'the oil' }), /Corrected/);
  assert.deepEqual({ ...store.doc().meals[meal.id].correction, at: 'x' }, { by: 'claude', protein: 35, kcal: 1050, why: 'the oil', at: 'x' });
  assert.throws(() => runOp(store, { op: 'meal', id: meal.id, protein: 35, kcal: 1050 }), /needs a why/);
  assert.throws(() => runOp(store, { op: 'meal', id: meal.id, protein: -1, kcal: 1050, why: 'x' }), /0 or more/);
  runOp(store, { op: 'meal', usual: { name: 'Whey shake', protein: 25, kcal: 120 } });
  assert.equal(store.doc().meals['usual:whey-shake'].protein, 25);
  runOp(store, { op: 'meal', fuel: { maintenanceKcal: 3100 } });
  assert.equal(store.doc().meals['fuel:settings'].maintenanceKcal, 3100);
  assert.throws(() => runOp(store, { op: 'meal' }), /meal needs/);
  assert.deepEqual(FIELDS.meal, ['id', 'protein', 'kcal', 'why', 'usual', 'fuel']);
});

test('catchup says how eating went', () => {
  const text = READS.catchup(foodDoc(), TODAY, '1');
  assert.match(text, /Food: protein on target 0 of 1 day · about 1,710 kcal a day \(below maintenance\) · 1 waiting/);
});

test('photo downloads a meal photo to a file and says where; a meal without one says so', async () => {
  const remote = new FakeGitHub();
  remote.file = { doc: foodDoc(), sha: 'sha0' };
  const api = fakeApi({ 'photos/2026/10/aaaa1111.jpg': 'JPEGBYTES' });
  const files = createFileStore({ token: 'x', repo: 'o/r', fetch: api });
  const written = [];
  const run = (argv) => main({
    argv: ['--config', 'c.json', ...argv], readText: () => JSON.stringify({ token: 'github_pat_TESTKEY0123456789abcdef', repo: 'o/r', dayStartHour: 4, timeZone: 'Europe/London' }),
    readStdin: async () => '', makeClient: () => remote, makeFiles: () => files, now: () => new Date('2026-10-20T20:00:00Z'), newId: ids('n'),
    writeFile: (path, bytes) => written.push({ path, text: Buffer.from(bytes).toString('utf8') }),
  });
  const ok = await run(['photo', 'meal:aaaa1111']);
  assert.equal(ok.code, 0);
  assert.match(ok.text, /dashboard-photos[\\/]meal-aaaa1111\.jpg/);
  assert.equal(written[0].text, 'JPEGBYTES');
  const none = await run(['photo', 'meal:bbbb2222']);
  assert.match(none.text, /hasn't been uploaded yet/);
});
