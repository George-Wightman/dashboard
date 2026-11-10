// The map's words (js/ui/map.js): what a tile says on hover, the tile's lines, the morning line, and
// which city is showing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore } from './helpers.js';
import { replay } from '../js/map/engine.js';
import { describeTile, tileLines, morningLine, currentMap, mapSvg, chapterLabel } from '../js/ui/map.js';
import { decoSvg, findSvg } from '../js/ui/map-art.js';
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

test('a Salzburg map labels its chapter; Mansfield has none', () => {
  const state = { chapter: { n: 2, start: '2027-01-04' } };
  assert.equal(chapterLabel({ place: 'salzburg' }, state), 'Chapter 2 · since Mon 4 Jan');
  assert.equal(chapterLabel({ place: 'uk' }, state), null);
});

test('a find is named by its map; mountain ground and each Salzburg find have drawings', () => {
  const { store } = fresh();
  const salty = mapTown({ tiles: mapTown().tiles.map((t) => (t.q === 2 && t.r === 0 ? { ...t, find: 'salt' } : t)), findNames: { salt: 'Salt' }, finds: { salt: 20 } });
  store.putGame('claim:town:1,0', { city: 'town', q: 1, r: 0, day: map.start, at: `${map.start}T10:00:00.000Z` });
  const state = replay({ doc: store.doc(), map: salty, today: map.start });
  assert.ok(describeTile(state, salty, '2,0')[1].includes('Salt: +20 hammers when you claim it'));
  assert.match(decoSvg('mountain', 0, 0), /<polygon/);
  for (const f of ['salt', 'cows', 'timber', 'trout', 'marble', 'beer']) assert.notEqual(findSvg(f, 0, 0), '', f);
});

test('the board zooms in to a few tiles and out no further than Europe, and stays over it', async () => {
  const { viewLimits, clampView } = await import('../js/ui/map.js');
  const lim = viewLimits([-1000, -500, 2000, 1000], [0, 0, 100, 50], 2);
  assert.deepEqual(clampView([-5000, -2500, 10000, 5000], lim), [-1000, -500, 2000, 1000]);
  const tiny = clampView([0, 0, 10, 5], lim);
  assert.equal(tiny[2], lim.minW);
  assert.equal(tiny[2] / tiny[3], 2);
  const far = clampView([50000, 0, 200, 100], lim);
  assert.equal(far[0] + far[2] / 2, 1000);
  // No Europe view: a wide ring round the land.
  assert.equal(viewLimits(null, [0, 0, 100, 50], 2).maxW, 600);
});

test('another city shows where its pin is, and its pin gives way to it', async () => {
  const { neighbourCities } = await import('../js/ui/map.js');
  const home = mapTown({ pins: [{ name: 'Faraway', sub: 'Next', at: [10, 5] }, { name: 'London', at: [1, 1] }] });
  const away = mapTown({ id: 'away', name: 'Faraway' });
  const n = neighbourCities(home, [home, away]);
  assert.equal(n.length, 1);
  assert.equal(n[0].map.id, 'away');
  const { state } = fresh();
  const awayState = replay({ doc: makeStore().doc(), map: away, today: map.start });
  const svg = mapSvg(state, home, { today: map.start, world: true, others: [{ ...n[0], state: awayState }] });
  assert.ok(svg.includes('FARAWAY'));
  // Its own pin ("Next") gives way to its land, and a far-off pin with its tiles.
  assert.ok(svg.includes('LONDON') && !svg.includes('>Next<') && svg.includes('class="map-far"'));
  assert.equal(neighbourCities(home, [home]).length, 0);
});

test('painted ground: by time of year, by where the city is, and drawn land from April', async () => {
  const { paintSeason, paintPicker } = await import('../js/ui/map.js');
  assert.equal(paintSeason('2026-11-10'), 'autumn');
  assert.equal(paintSeason('2026-12-05'), 'late');
  assert.equal(paintSeason('2027-01-15'), 'winter');
  assert.equal(paintSeason('2027-02-28'), 'winter');
  assert.equal(paintSeason('2027-03-10'), 'late');
  assert.equal(paintSeason('2027-04-10'), null);
  assert.equal(paintPicker({ place: 'uk' }, '2027-04-10'), null);
  const uk = paintPicker({ place: 'uk' }, '2026-11-10'), sz = paintPicker({ place: 'salzburg' }, '2026-11-10');
  const town = { q: 3, r: -1, terrain: 'town' };
  assert.equal(uk(town).length, 4);
  assert.notDeepEqual(uk(town), sz(town));
  assert.deepEqual(uk({ q: 2, r: 2, terrain: 'meadow' }), uk({ q: 2, r: 2, terrain: 'meadow' }));
  assert.equal(uk({ q: 0, r: 1, terrain: 'nothing-painted' }), null);
  // A Salzburg town has no deep-winter set: it falls back to first snow.
  assert.ok(paintPicker({ place: 'salzburg' }, '2027-01-15')(town));
});

test('the board draws painted ground from the atlas, and the drawn land when asked', () => {
  const { state } = fresh();
  const on = mapSvg(state, map, { today: '2026-11-10' });
  assert.match(on, /icons\/terrain\.webp/);
  assert.doesNotMatch(mapSvg(state, map, { today: '2026-11-10', painted: false }), /terrain\.webp/);
});

test('a painted landmark is drawn as its whole tile once it is in sight, never before', async () => {
  const { validMap } = await import('../js/map/files.js');
  const dot = 'data:image/png;base64,iVBORw0KGgo=';
  const site = mapTown().places.find((p) => p.kind === 'found');
  const painted = mapTown({ paint: { centre: { src: dot, w: 128, h: 140 }, [site.id]: { src: dot + 'AA', w: 128, h: 150 } } });
  assert.ok(validMap(painted));
  assert.equal(validMap(mapTown({ paint: { centre: { src: 'javascript:alert(1)', w: 1, h: 1 } } })), false);
  const { state } = fresh();
  const svg = mapSvg(state, painted, { today: '2026-11-10' });
  assert.ok(svg.includes(`href="${dot}"`));
  assert.equal(state.visible.has(`${site.q},${site.r}`), svg.includes(`href="${dot}AA"`));
  assert.ok(!mapSvg(state, painted, { today: '2026-11-10', painted: false }).includes(dot));
});
