// The map's private files (js/map/files.js): reading, checking and keeping them, and the day's place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, MemoryStorage, FullStorage } from './helpers.js';
import { refreshMaps, loadCachedMaps, validMap, ensureDayPlace, safeArt } from '../js/map/files.js';
import { makeCityOf } from '../js/map/engine.js';
import { mapTown } from './fixtures/map-town.js';

const repo = (files) => (path) => ({ get: async () => (path in files ? { doc: files[path], sha: 'x' } : null) });

test('no index means no maps', async () => {
  assert.deepEqual(await refreshMaps({ clientFor: repo({}), storage: new MemoryStorage() }), []);
});

test('a broken city file is dropped and the rest kept, and cached', async () => {
  const storage = new MemoryStorage();
  const maps = await refreshMaps({ clientFor: repo({ 'map/index.json': { cities: ['town', 'bad'] }, 'map/town.json': mapTown(), 'map/bad.json': { id: 'bad' } }), storage });
  assert.deepEqual(maps.map((m) => m.id), ['town']);
  assert.deepEqual(loadCachedMaps(storage).map((m) => m.id), ['town']);
});

test('a full device still gets the maps for this visit', async () => {
  const maps = await refreshMaps({ clientFor: repo({ 'map/index.json': { cities: ['town'] }, 'map/town.json': mapTown() }), storage: new FullStorage() });
  assert.equal(maps.length, 1);
});

test('a drawing that could run is refused', () => {
  assert.ok(safeArt('<svg viewBox="0 0 1 1"><rect/></svg>'));
  assert.ok(!safeArt('<svg><script>alert(1)</script></svg>'));
  assert.ok(!safeArt('<svg onload="x()"></svg>'));
  assert.equal(validMap(mapTown({ art: { mill: '<svg><foreignObject/></svg>' } })), false);
  assert.equal(validMap(mapTown()), true);
});

test("the day's place is stamped once", () => {
  const store = makeStore();
  const day = store.today();
  assert.equal(ensureDayPlace(store, day, 'Europe/Vienna').place, 'salzburg');
  assert.equal(ensureDayPlace(store, day, 'Europe/London'), null);
  assert.equal(store.doc().game[`day:${day}`].place, 'salzburg');
});

test('a day with no stamp takes the one before; a UK day after the end has no city', () => {
  const store = makeStore();
  store.putGame('day:2026-09-12', { day: '2026-09-12', place: 'salzburg' });
  store.putGame('day:2026-09-20', { day: '2026-09-20', place: 'uk' });
  const cityOf = makeCityOf(store.doc(), [mapTown({ end: '2026-09-25' })]);
  assert.equal(cityOf('2026-09-11'), 'town');
  assert.equal(cityOf('2026-09-15'), null);
  assert.equal(cityOf('2026-09-21'), 'town');
  assert.equal(cityOf('2026-09-26'), null);
});
