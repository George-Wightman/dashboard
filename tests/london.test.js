import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeHome, shrunk, rankScores, rankAreas, scoreArea, context, londonSettings, validLondon, DEFAULTS, SETTINGS_ID, spareRoomLink } from '../js/london.js';
import { emptyDoc } from '../js/doc.js';

// Invented areas and salary only: this repo is public.
const area = (id, side, allin, office, extra = {}) => ({
  id, name: id, borough: 'Testshire', side, lat: 51.5, lon: -0.1, line: 'Test', walk: 5, rooms: 10,
  rent: allin, allin, j: { office, west: [office + 10], kx: 20, stp: 20, stansted: { mins: 60, leave: '04:30' } },
  near: { gyms: 3, green: 10, eat: 30, crime: 100 }, ...extra,
});
const data = (areas) => ({ v: 1, areas, travelcard: { monthly: 175 }, defaults: { salaries: [30000, 32000, 34000], everythingElse: 800 } });
const settings = (patch = {}) => ({ ...londonSettings(emptyDoc(), data([area('a', 'S', 900, 20)])), ...patch });

test('takeHome: tax, NI, Plan 2 and the pension tier, worked by hand for £30,000', () => {
  assert.equal(Math.round(takeHome(30000) * 100) / 100, 1996.69);
  assert.equal(takeHome(null), null);
});

test('shrunk: one cheap room is pulled most of the way to its side’s typical rent', () => {
  assert.equal(shrunk(600, 1, 900, 4), 840);
  assert.equal(shrunk(600, 40, 900, 4), (40 * 600 + 4 * 900) / 44);
  assert.equal(shrunk(600, 1, 900, 0), 600);
});

test('rankScores: 0 to 1 by rank, ties share, lower crime scores higher', () => {
  const areas = [{ id: 'x', v: 1 }, { id: 'y', v: 5 }, { id: 'z', v: 5 }];
  const up = rankScores(areas, (a) => a.v);
  assert.equal(up.get('x'), 0);
  assert.equal(up.get('y'), 0.75);
  const down = rankScores(areas, (a) => a.v, false);
  assert.equal(down.get('x'), 1);
});

test('rankAreas: valuing commute time more moves a cheap far area down', () => {
  const d = data([area('near', 'S', 1000, 15), area('far', 'S', 850, 40)]);
  const cheapTime = rankAreas(d, settings({ hourValue: 0, maxCommute: 60 })).ranked.map((r) => r.area.id);
  const dearTime = rankAreas(d, settings({ hourValue: 20, maxCommute: 60 })).ranked.map((r) => r.area.id);
  assert.deepEqual(cheapTime, ['far', 'near']);
  assert.deepEqual(dearTime, ['near', 'far']);
});

test('rankAreas: anything over the commute limit ranks after everything within it', () => {
  const d = data([area('cheapFar', 'S', 600, 70), area('dear', 'S', 1100, 20)]);
  const r = rankAreas(d, settings({ maxCommute: 45 })).ranked;
  assert.equal(r[0].area.id, 'dear');
  assert.equal(r[1].score.flags.overCommute, true);
});

test('scoreArea: weights at zero make the neighbourhood worth nothing; a missing early flight costs a cab', () => {
  const d = data([area('a', 'S', 900, 20), area('b', 'S', 900, 20, { near: { gyms: 50, green: 50, eat: 50, crime: 1 }, j: { office: 20, kx: 20, stp: 20, stansted: null } })]);
  const s = settings({ near: { gyms: 0, green: 0, eat: 0, safety: 0 }, cab: 40, salzburgTrips: 2 });
  const ctx = context(d, s);
  const b = scoreArea(d.areas[1], s, ctx);
  assert.equal(b.parts.near, 0);
  assert.equal(b.flags.noEarlyFlight, true);
  assert.equal(b.parts.trips, (2 * 25 * 1) / 60 * s.hourValue + 80);
});

test('scoreArea: a savings shortfall is added to the monthly figure', () => {
  const d = data([area('a', 'S', 900, 20)]);
  const s = settings({ savings: 2000 });
  const sc = scoreArea(d.areas[0], s, context(d, s));
  assert.ok(sc.parts.shortfall > 0);
  assert.equal(Math.round(sc.parts.shortfall), Math.round(2000 - sc.leftover));
});

test('londonSettings: saved values win over the file defaults, which win over the built-in ones', () => {
  const doc = emptyDoc();
  doc.calendar[SETTINGS_ID] = { id: SETTINGS_ID, status: 'active', hourValue: 15, near: { gyms: 3 } };
  const s = londonSettings(doc, data([area('a', 'S', 900, 20)]));
  assert.equal(s.hourValue, 15);
  assert.equal(s.everythingElse, 800);
  assert.equal(s.maxCommute, DEFAULTS.maxCommute);
  assert.deepEqual(s.near, { gyms: 3, green: 1, eat: 1, safety: 1 });
  assert.deepEqual(s.salaries, [30000, 32000, 34000]);
});

test('validLondon and the SpareRoom link', () => {
  assert.equal(validLondon(data([area('a', 'S', 900, 20)])), true);
  assert.equal(validLondon({ v: 1, areas: [] }), false);
  assert.match(spareRoomLink('Elephant & Castle'), /search=Elephant\+and\+Castle\+station/);
});
