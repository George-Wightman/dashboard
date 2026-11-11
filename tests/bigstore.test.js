// The big-file store (js/bigstore.js): the map's files out of localStorage, which the Hebrew app shares.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MemoryStorage } from './helpers.js';
import { createBigStore, idbBackend } from '../js/bigstore.js';
import { refreshMaps, loadCachedMaps, MAPS_KEY } from '../js/map/files.js';
import { mapTown } from './fixtures/map-town.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function fakeBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { map, get: async (k) => map.get(k), put: async (k, v) => { map.set(k, v); }, del: async (k) => { map.delete(k); } };
}
const brokenBackend = () => ({ get: async () => { throw new Error('no IndexedDB'); }, put: async () => { throw new Error('no IndexedDB'); }, del: async () => { throw new Error('no IndexedDB'); } });
const repo = (files) => (path) => ({ get: async () => (path in files ? { doc: files[path], sha: 'x' } : null) });
const town = () => repo({ 'map/index.json': { cities: ['town'] }, 'map/town.json': mapTown() });

test('maps saved through it never touch localStorage, and are read back on the next open', async () => {
  const legacy = new MemoryStorage();
  const backend = fakeBackend();
  const store = createBigStore({ backend, legacy, keys: [MAPS_KEY] });
  await store.ready();
  await refreshMaps({ clientFor: town(), storage: store });
  await settle();
  assert.equal(legacy.getItem(MAPS_KEY), null);
  assert.ok(backend.map.has(MAPS_KEY));

  const next = createBigStore({ backend, legacy, keys: [MAPS_KEY] });
  assert.deepEqual(loadCachedMaps(next), [], 'nothing until it has loaded');
  await next.ready();
  assert.deepEqual(loadCachedMaps(next).map((m) => m.id), ['town']);
});

test('maps already in localStorage are moved across and removed from it', async () => {
  const legacy = new MemoryStorage();
  await refreshMaps({ clientFor: town(), storage: legacy });
  legacy.setItem('dash_data', '{"kept":true}');
  const backend = fakeBackend();
  const store = createBigStore({ backend, legacy, keys: [MAPS_KEY] });
  await store.ready();
  await settle();
  assert.equal(legacy.getItem(MAPS_KEY), null, 'the shared allowance is freed');
  assert.equal(legacy.getItem('dash_data'), '{"kept":true}', 'nothing else in localStorage is touched');
  assert.deepEqual(loadCachedMaps(store).map((m) => m.id), ['town']);
  assert.ok(backend.map.has(MAPS_KEY));
});

test('with no IndexedDB the old copy still leaves localStorage and the maps work for this visit', async () => {
  const legacy = new MemoryStorage();
  await refreshMaps({ clientFor: town(), storage: legacy });
  const store = createBigStore({ backend: brokenBackend(), legacy, keys: [MAPS_KEY] });
  await store.ready();
  await settle();
  assert.equal(legacy.getItem(MAPS_KEY), null);
  assert.deepEqual(loadCachedMaps(store).map((m) => m.id), ['town']);
  assert.equal((await refreshMaps({ clientFor: town(), storage: store })).length, 1);
});

test('maps fetched while it was still loading are not replaced by the older saved ones', async () => {
  const old = JSON.stringify({ at: '2026-01-01T00:00:00.000Z', maps: [] });
  const backend = fakeBackend({ [MAPS_KEY]: old });
  const store = createBigStore({ backend, keys: [MAPS_KEY] });
  const loading = store.ready();
  await refreshMaps({ clientFor: town(), storage: store });
  await loading;
  assert.deepEqual(loadCachedMaps(store).map((m) => m.id), ['town']);
});

test('removing a file removes it from both', async () => {
  const backend = fakeBackend({ a: 'one' });
  const store = createBigStore({ backend, keys: ['a'] });
  await store.ready();
  assert.equal(store.getItem('a'), 'one');
  store.removeItem('a');
  await settle();
  assert.equal(store.getItem('a'), null);
  assert.ok(!backend.map.has('a'));
});

test('a page with no IndexedDB gets a backend that rejects, not one that throws', async () => {
  const backend = idbBackend(undefined);
  await assert.rejects(backend.get('a'));
  await assert.rejects(backend.put('a', 'b'));
});

test('js/app.js keeps the maps in the big-file store, not localStorage', () => {
  const src = read('js/app.js');
  assert.match(src, /createBigStore\(\{ backend: idbBackend\(\), legacy: localStorage, keys: \[MAPS_KEY\] \}\)/);
  assert.match(src, /refreshMaps\(\{ clientFor, storage: bigFiles \}\)/);
  assert.doesNotMatch(src, /loadCachedMaps\(localStorage\)/);
  assert.doesNotMatch(src, /refreshMaps\(\{ clientFor, storage: localStorage \}\)/);
});

test('the offline release includes it', () => {
  assert.match(read('sw.js'), /'js\/bigstore\.js'/);
});
