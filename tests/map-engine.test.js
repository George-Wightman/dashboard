// The map's replay (js/map/engine.js) on an invented town: hammers, tiles, choices, golden ages,
// barbarians, roads, cards, levels and wonders.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore } from './helpers.js';
import { addDays } from '../js/dates.js';
import { replay, claimable, placeable, makeCityOf, campCap } from '../js/map/engine.js';
import { mapTown } from './fixtures/map-town.js';

const START = '2026-09-10';
const day = (n) => addDays(START, n);
const at = (n, m = 0) => `${day(n)}T10:${String(m).padStart(2, '0')}:00.000Z`;

// Six daily habits: two long (an hour or more), one per track and three plain.
function town() {
  const store = makeStore();
  const habit = (title, area, minutes) => store.addItem({ type: 'habit', title, area, ...(minutes ? { minutes } : {}) }).id;
  const ids = {
    study: habit('Study', 'Study', 60),
    gym: habit('Gym', 'Health', 120),
    read: habit('Read', 'Reading'),
    a: habit('Chore A', 'Home'), b: habit('Chore B', 'Home'), c: habit('Chore C', 'Home'),
  };
  const all = Object.values(ids);
  const done = (n, which = all) => { for (const id of which) store.toggleDone(id, day(n)); };
  return { store, ids, all, done };
}
const run = (store, today, map = mapTown(), opts = {}) => replay({ doc: store.doc(), map, today, ...opts });

test('a finished day of six with two long rows gives 100 hammers: two tiles to claim and 20 over', () => {
  const t = town();
  t.done(0);
  const s = run(t.store, day(1));
  assert.equal(s.turn, 1);
  assert.equal(s.last.hammers, 100);
  assert.equal(s.ready, 3); // the founding tile and two more
  assert.equal(s.pool, 20);
});

test('past five waiting, a tile is claimed for him nearest the centre', () => {
  const t = town();
  for (let n = 0; n < 3; n++) t.done(n);
  const s = run(t.store, day(3));
  assert.equal(s.ready, 5);
  assert.ok(s.owned.size > 7);
  assert.ok(s.chronicle.some((e) => e.events.some((x) => x.kind === 'auto')));
});

test('a claim of a tile off the border is ignored; one next to it is kept', () => {
  const t = town();
  t.store.putGame('claim:town:4,0', { city: 'town', q: 4, r: 0, day: START, at: at(0) });
  t.store.putGame('claim:town:2,0', { city: 'town', q: 2, r: 0, day: START, at: at(0, 1) });
  const s = run(t.store, START);
  assert.ok(!s.owned.has('4,0'));
  assert.ok(s.owned.has('2,0'));
});

test('two claims with one tile banked keep the earlier one', () => {
  const t = town();
  t.store.putGame('claim:town:2,-1', { city: 'town', q: 2, r: -1, day: START, at: at(0, 5) });
  t.store.putGame('claim:town:-2,1', { city: 'town', q: -2, r: 1, day: START, at: at(0, 2) });
  const s = run(t.store, START);
  assert.ok(s.owned.has('-2,1'));
  assert.ok(!s.owned.has('2,-1'));
});

test('a choice dated after today is ignored', () => {
  const t = town();
  t.store.putGame('claim:town:2,0', { city: 'town', q: 2, r: 0, day: day(5), at: at(5) });
  assert.ok(!run(t.store, day(2)).owned.has('2,0'));
});

test('three finished days start a golden age: the third costs 30; a miss ends it', () => {
  const t = town();
  for (let n = 0; n < 3; n++) t.done(n);
  const s = run(t.store, day(3));
  assert.equal(s.golden.on, true);
  assert.equal(s.cost, 30);
  t.done(3, t.all.slice(0, 5));
  const after = run(t.store, day(4));
  assert.equal(after.golden.on, false);
  assert.equal(after.cost, 40);
});

test('a missed gym sends barbarians for the gym, one step a turn', () => {
  const t = town();
  t.done(0, t.all.filter((id) => id !== t.ids.gym));
  const s = run(t.store, day(1));
  assert.equal(s.camps.length, 1);
  assert.equal(s.camps[0].target, 'gym');
  const first = [s.camps[0].q, s.camps[0].r];
  t.done(1, t.all.filter((id) => id !== t.ids.gym));
  const s2 = run(t.store, day(2));
  const moved = s2.camps.find((c) => c.target === 'gym');
  assert.notDeepEqual([moved.q, moved.r], first);
});

test('a camp at the border raids on a miss; the next 20 hammers repair it; a finished day drives one off', () => {
  const t = town();
  for (let n = 0; n < 4; n++) t.done(n, t.all.filter((id) => id !== t.ids.gym));
  const raided = run(t.store, day(4));
  assert.ok(raided.pillaged.size >= 1);
  assert.ok(raided.chronicle.some((e) => e.events.some((x) => x.kind === 'raid')));
  t.done(4);
  const fixed = run(t.store, day(5));
  assert.ok(fixed.pillaged.size < raided.pillaged.size);
  assert.equal(fixed.camps.length, raided.camps.length - 1);
});

test('one camp per track, and on a miss only the camps of what was missed raid', () => {
  const t = town();
  // Reading missed every day: one camp for it, however many days.
  for (let n = 0; n < 6; n++) t.done(n, t.all.filter((id) => id !== t.ids.read));
  const s = run(t.store, day(6));
  assert.equal(s.camps.length, 1);
  assert.equal(s.camps[0].track, 'culture');
  assert.ok(s.chronicle.some((e) => e.events.some((x) => x.kind === 'raid')));
  // Now only a chore is missed: a home camp sets out, and the reading camp at the border holds off.
  t.done(6, t.all.filter((id) => id !== t.ids.a));
  const next = run(t.store, day(7));
  assert.deepEqual(next.camps.map((c) => c.track).sort(), ['culture', 'home']);
  assert.ok(!next.last.events.some((x) => x.kind === 'raid'));
});

// A work track, as Salzburg has: shifts only, no areas.
const withWork = (o = {}) => {
  const m = mapTown(o);
  return { ...m, places: [...m.places, { id: 'office', name: 'The Office', kind: 'build', track: 'work', q: 1, r: 2 }],
    tracks: { ...m.tracks, work: { name: 'Work', areas: [], list: [['office', 50]] } } };
};
const shift = (store, id, d, minutes) => store.putCalendar(`work:${id}`, { day: d, minutes }, 'planner');

test('a shift adds 20 hammers (10 under an hour) to the pool and the work track, and is never a miss', () => {
  const t = town();
  t.done(0);
  shift(t.store, 'e1', day(0), 240);
  shift(t.store, 'e2', day(0), 45);
  const s = run(t.store, day(1), withWork());
  assert.equal(s.last.hammers, 130);
  assert.equal(s.track.work, 30);
  assert.equal(s.camps.length, 0);
});

test('a day with only a shift earns its hammers without a turn', () => {
  const t = town();
  t.store.putCalendar('off:all', { start: day(0), end: day(0), reason: 'A day off' }, 'claude');
  shift(t.store, 'e1', day(0), 240);
  const s = run(t.store, day(1), withWork());
  assert.equal(s.turn, 0);
  assert.equal(s.pool, 20);
  assert.equal(s.track.work, 20);
});

test('an archived shift earns nothing', () => {
  const t = town();
  t.store.putCalendar('off:all', { start: day(0), end: day(0), reason: 'A day off' }, 'claude');
  shift(t.store, 'e1', day(0), 240);
  t.store.putCalendar('work:e1', { status: 'archived' }, 'planner');
  assert.equal(run(t.store, day(1), withWork()).pool, 0);
});

test('camps are capped at the number of tracks and one for home', () => {
  assert.equal(campCap(mapTown()), 4);
  assert.equal(campCap(withWork()), 5);
});

test('a find takes its name from the map, else the engine list', () => {
  const t = town();
  t.store.putGame('claim:town:2,0', { city: 'town', q: 2, r: 0, day: START, at: at(0) });
  const named = run(t.store, START, mapTown({ findNames: { wheat: 'Golden wheat' } }));
  assert.ok(named.today.some((e) => e.text === 'Golden wheat: +10 hammers'));
  assert.ok(run(t.store, START).today.some((e) => e.text === 'Wheat: +10 hammers'));
});

test('a UK day between Salzburg days starts chapter 2', () => {
  const t = town();
  const salz = mapTown({ place: 'salzburg' });
  const uk = mapTown({ id: 'uk1', place: 'uk' });
  for (const [n, place] of [[0, 'salzburg'], [1, 'salzburg'], [2, 'salzburg'], [3, 'uk'], [4, 'salzburg']]) t.store.putGame(`day:${day(n)}`, { day: day(n), place });
  const cityOf = makeCityOf(t.store.doc(), [salz, uk]);
  assert.deepEqual(run(t.store, day(5), salz, { cityOf }).chapter, { n: 2, start: day(4) });
  assert.deepEqual(run(t.store, day(2), salz, { cityOf }).chapter, { n: 1, start: day(0) });
});

test('25 cardio minutes lay two road steps and carry five', () => {
  const t = town();
  const cardio = t.store.addItem({ type: 'quota', title: 'Cardio', area: 'Health', target: 90, unit: 'minutes' });
  t.store.putGym('config', { cardioQuota: cardio.id });
  t.store.logAmount({ itemId: cardio.id, amount: 25, day: START });
  t.done(0);
  t.store.putGame('claim:town:2,-1', { city: 'town', q: 2, r: -1, day: day(1), at: at(1) });
  t.store.putGame('claim:town:3,-1', { city: 'town', q: 3, r: -1, day: day(1), at: at(1, 1) });
  const s = run(t.store, day(1));
  assert.equal(s.roadCarry, 5);
  assert.ok(s.roads.length >= 1 && s.roads.length <= 2);
});

test('a track card goes only in its zone', () => {
  const t = town();
  for (let n = 0; n < 5; n++) t.done(n);
  let s = run(t.store, day(5));
  const card = s.cards.find((c) => c.id === 'school');
  assert.ok(card, 'the school card is earned');
  assert.ok(placeable(s, card).every((k) => ['2,1', '3,1', '3,0', '2,0', '1,1', '1,2', '2,2'].includes(k)));
  t.store.putGame('place:town:school', { city: 'town', card: 'school', q: -1, r: 0, day: day(5), at: at(5) });
  s = run(t.store, day(5));
  assert.equal(s.built.school, undefined);
  t.store.putGame('claim:town:2,0', { city: 'town', q: 2, r: 0, day: day(5), at: at(5, 1) });
  t.store.putGame('place:town:school', { city: 'town', card: 'school', q: 2, r: 0, day: day(5), at: at(5, 2) });
  s = run(t.store, day(5));
  assert.equal(s.built.school, '2,0');
});

test('400 more learning points after the last card raise the school to level 2', () => {
  const t = town();
  t.done(0);
  t.store.putGame('claim:town:2,0', { city: 'town', q: 2, r: 0, day: day(1), at: at(1) });
  for (let n = 1; n < 30; n++) t.done(n, [t.ids.study, t.ids.a, t.ids.b]);
  t.store.putGame('place:town:school', { city: 'town', card: 'school', q: 2, r: 0, day: day(6), at: at(6) });
  const s = run(t.store, day(30));
  assert.ok(s.track.learning >= 100 + 400);
  assert.equal(s.levels.school, 2);
});

test('a ticked milestone gives a wonder card, placed only on an owned wonder site', () => {
  const t = town();
  const goal = t.store.addGoal({ title: 'A goal' });
  const m = t.store.addMilestone(goal.id, 'A step');
  t.store.toggleMilestone(m.id);
  t.done(0);
  let s = run(t.store, day(1));
  const card = s.cards.find((c) => c.kind === 'wonder');
  assert.ok(card);
  assert.deepEqual(placeable(s, card), []);
});

test('a day in another city, or before the start, changes nothing', () => {
  const t = town();
  t.done(0);
  t.store.putGame(`day:${START}`, { day: START, place: 'salzburg' });
  const cityOf = makeCityOf(t.store.doc(), [mapTown()]);
  assert.equal(cityOf(START), null);
  assert.equal(run(t.store, day(1), mapTown(), { cityOf }).turn, 0);
  assert.equal(run(t.store, day(1), mapTown({ start: day(1) })).turn, 0);
});

test('claiming a find pays once; seeing a place logs it once', () => {
  const t = town();
  t.store.putGame('claim:town:2,0', { city: 'town', q: 2, r: 0, day: START, at: at(0) });
  const s = run(t.store, START);
  assert.equal(s.pool, 10); // wheat
  t.done(0);
  t.store.putGame('claim:town:2,-1', { city: 'town', q: 2, r: -1, day: day(1), at: at(1) });
  const s2 = run(t.store, day(1));
  const seen = [...s2.chronicle.flatMap((e) => e.events), ...s2.today].filter((x) => x.kind === 'discovered' && x.id === 'mill');
  assert.equal(seen.length, 1);
  assert.ok(claimable(s2).includes('3,-1'));
});

test('no more than four camps, however many days are missed', () => {
  const t = town();
  for (let n = 0; n < 12; n++) t.done(n, [t.ids.a]);
  assert.ok(run(t.store, day(12)).camps.length <= 4);
});

test('a goal step and a run on a day with nothing counted still count', () => {
  const t = town();
  const cardio = t.store.addItem({ type: 'quota', title: 'Cardio', area: 'Health', target: 90, unit: 'minutes' });
  t.store.putGym('config', { cardioQuota: cardio.id });
  t.store.putCalendar('off:all', { start: day(1), end: day(1), reason: 'A day off' }, 'claude');
  t.store.logAmount({ itemId: cardio.id, amount: 15, day: day(1) });
  const goal = t.store.addGoal({ title: 'A goal' });
  const m = t.store.addMilestone(goal.id, 'A step');
  t.store.updateMilestone(m.id, { done: true, doneOn: day(1) });
  const s = run(t.store, day(2));
  assert.ok(s.cards.some((c) => c.kind === 'wonder'));
  assert.equal(s.roadCarry, 5);
});

test("a camp's tile can't be claimed while the camp is on it", () => {
  const t = town();
  for (let n = 0; n < 4; n++) t.done(n, t.all.filter((id) => id !== t.ids.gym));
  const s = run(t.store, day(4));
  const camps = new Set(s.camps.map((c) => `${c.q},${c.r}`));
  assert.ok(claimable(s).every((k) => !camps.has(k)));
});

test('a big land with misses replays in well under a second a turn', () => {
  const tiles = [];
  for (let q = -30; q <= 30; q++) for (let r = -30; r <= 30; r++) if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 30) tiles.push({ q, r, terrain: 'meadow' });
  const big = mapTown({ tiles });
  const t = town();
  for (let n = 0; n < 200; n++) t.done(n, n % 3 === 0 ? t.all.slice(0, 4) : t.all);
  const t0 = performance.now();
  const s = run(t.store, day(200), big);
  const ms = performance.now() - t0;
  assert.ok(s.owned.size > 300, `owned ${s.owned.size}`);
  assert.ok(ms < 3000, `took ${ms.toFixed(0)} ms`);
});
