// The map in words (js/map/summary.js), for Claude and the phone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore } from './helpers.js';
import { addDays } from '../js/dates.js';
import { mapToday, mapSummary, glanceMap, readMaps } from '../js/map/summary.js';
import { validMap } from '../js/map/files.js';
import { mapTown } from './fixtures/map-town.js';

const START = '2026-09-10';

function missedGym() {
  const store = makeStore();
  const gym = store.addItem({ type: 'habit', title: 'Gym', area: 'Health', minutes: 120 }).id;
  const others = ['Study', 'Read', 'Home'].map((area) => store.addItem({ type: 'habit', title: area, area }).id);
  for (let n = 0; n < 3; n++) for (const id of others) store.toggleDone(id, addDays(START, n));
  return { store, gym };
}

test("Claude's summary names tiles, camps and their target, and keeps hidden places hidden", () => {
  const { store } = missedGym();
  const got = mapToday(store.doc(), [mapTown()], addDays(START, 3));
  const text = mapSummary(got).join('\n');
  assert.match(text, /^Townsby: turn 3, 7 tiles of 61/m);
  assert.match(text, /Barbarians heading for The Gym/);
  assert.match(text, /still hidden \(don't tell him what\)/);
  assert.doesNotMatch(text, /The Mill|Duck Pond/);
});

test('a Salzburg map names its chapter', () => {
  const { store } = missedGym();
  for (let n = 0; n < 3; n++) store.putGame(`day:${addDays(START, n)}`, { day: addDays(START, n), place: 'salzburg' });
  const text = mapSummary(mapToday(store.doc(), [mapTown({ place: 'salzburg' })], addDays(START, 3))).join('\n');
  assert.match(text, /^Chapter 1, since Thu 10 Sep: this visit\.$/m);
  assert.doesNotMatch(mapSummary(mapToday(missedGym().store.doc(), [mapTown()], addDays(START, 3))).join('\n'), /Chapter/);
});

test('the Map widget shows the city, its tiles and what is waiting', () => {
  const { store } = missedGym();
  const g = glanceMap(mapToday(store.doc(), [mapTown()], addDays(START, 3)), 'https://example.test/');
  assert.equal(g.title, 'Townsby');
  assert.equal(g.number, '7');
  assert.equal(g.open, 'https://example.test/?big=map');
  assert.ok(g.lines.some((l) => /Barbarians heading for The Gym/.test(l)));
});

test('no map files, no map', async () => {
  assert.equal(mapToday(makeStore().doc(), [], START), null);
  assert.deepEqual(await readMaps({ read: async () => null }, validMap), []);
  const files = { read: async (p) => (p === 'map/index.json' ? { text: '{"cities":["town"]}' } : p === 'map/town.json' ? { text: JSON.stringify(mapTown()) } : null) };
  assert.equal((await readMaps(files, validMap))[0].id, 'town');
});
