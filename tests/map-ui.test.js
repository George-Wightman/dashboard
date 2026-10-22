// The map's words (js/ui/map.js): what a tile says on hover, the tile's lines, the morning line, and
// which city is showing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore } from './helpers.js';
import { replay } from '../js/map/engine.js';
import { describeTile, tileLines, morningLine, currentMap, mapSvg } from '../js/ui/map.js';
import { mapTown } from './fixtures/map-town.js';

const map = mapTown();
const fresh = () => { const store = makeStore(); return { store, state: replay({ doc: store.doc(), map, today: map.start }) }; };

test('plain land says nothing; a find, a zone and a place say what they are', () => {
  const { store } = fresh();
  store.putGame('claim:town:2,0', { city: 'town', q: 2, r: 0, day: map.start, at: `${map.start}T10:00:00.000Z` });
  const state = replay({ doc: store.doc(), map, today: map.start });
  assert.equal(describeTile(state, map, '-1,1'), null);
  const zone = describeTile(state, map, '2,1');
  assert.ok(zone[1].some((l) => /Good ground for The School/.test(l)));
  const centre = describeTile(state, map, '0,0');
  assert.equal(centre[0], 'Townsby');
});

test('a wonder in the fog is something on the horizon; in sight, something to build', () => {
  const { state } = fresh();
  assert.deepEqual(describeTile(state, map, '4,-2'), ['Something on the horizon', 'Get closer to find out']);
  assert.equal(describeTile(state, map, '4,-1'), null);
});

test("the tile's lines name what's waiting", () => {
  const { state } = fresh();
  assert.deepEqual(tileLines(state, map), ['1 tile to claim']);
});

test('the morning line reads like a turn', () => {
  const line = morningLine({ done: 5, total: 6, hammers: 70, events: [{ kind: 'camp', text: 'Barbarians set out for The Gym' }] });
  assert.equal(line, 'Yesterday: 5 of 6 done, +70 hammers. Barbarians set out for The Gym.');
  assert.equal(morningLine(null), null);
});

test('the city showing is where he is, else the latest one started', () => {
  const { store } = fresh();
  assert.equal(currentMap([map], store.doc(), map.start).id, 'town');
  store.putGame(`day:${map.start}`, { day: map.start, place: 'salzburg' });
  assert.equal(currentMap([map], store.doc(), map.start).id, 'town');
  assert.equal(currentMap([], store.doc(), map.start), null);
});

test('the board draws, with nothing that could run', () => {
  const { state } = fresh();
  const svg = mapSvg(state, map, { today: map.start, world: true });
  assert.ok(svg.includes('TOWNSBY'));
  assert.ok(!/<script|\son[a-z]+=/i.test(svg));
});
