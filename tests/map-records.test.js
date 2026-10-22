// The map's records (docs/superpowers/specs/2026-10-22-civ-map-design.md): George's choices in the
// `game` map, the day a milestone was ticked, the done rows of a day's score, and the store's revision.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, clock } from './helpers.js';
import { dayScore } from '../js/schedule.js';

const AT = '2026-10-23T09:00:00.000Z';

test('a claim round-trips through the game map', () => {
  const store = makeStore();
  store.putGame('claim:town:1,0', { city: 'town', q: 1, r: 0, day: '2026-10-23', at: AT });
  const rec = store.doc().game['claim:town:1,0'];
  assert.equal(rec.q, 1);
  assert.equal(rec.city, 'town');
  assert.equal(rec.source, 'me');
});

test('a claim with a broken tile is refused', () => {
  const store = makeStore();
  assert.throws(() => store.putGame('claim:town:x', { city: 'town', q: 1.5, r: 0, day: '2026-10-23', at: AT }), /Invalid map choice/);
  assert.throws(() => store.putGame('day:2026-10-23', { day: '2026-10-23', place: 'mars' }), /Invalid map choice/);
});

test("a day's place is a game record", () => {
  const store = makeStore();
  store.putGame('day:2026-10-23', { day: '2026-10-23', place: 'salzburg' });
  assert.equal(store.doc().game['day:2026-10-23'].place, 'salzburg');
});

test('ticking a milestone stamps the day, unticking clears it', () => {
  const store = makeStore();
  const goal = store.addGoal({ title: 'Hebrew' });
  const m = store.addMilestone(goal.id, 'Read a story aloud');
  store.toggleMilestone(m.id);
  assert.equal(store.doc().milestones[m.id].doneOn, store.today());
  store.toggleMilestone(m.id);
  assert.equal(store.doc().milestones[m.id].doneOn, null);
  store.updateMilestone(m.id, { done: true });
  assert.equal(store.doc().milestones[m.id].doneOn, store.today());
});

test("a day's score lists its done rows", () => {
  const now = clock();
  const store = makeStore({ now });
  const today = store.today();
  const a = store.addItem({ type: 'task', title: 'One', date: today });
  const b = store.addItem({ type: 'task', title: 'Two', date: today });
  store.addItem({ type: 'task', title: 'Three', date: today });
  store.toggleDone(a.id);
  store.toggleDone(b.id);
  const score = dayScore(store.doc(), today);
  assert.deepEqual(score.doneRows.map((r) => r.item.title).sort(), ['One', 'Two']);
});

test('the revision grows with every change', () => {
  const store = makeStore();
  const before = store.revision();
  store.addItem({ type: 'task', title: 'One', date: store.today() });
  assert.ok(store.revision() > before);
});

test('a milestone ticked before the map keeps its day when it is edited or archived later', () => {
  const store = makeStore();
  const goal = store.addGoal({ title: 'Hebrew' });
  const m = store.addMilestone(goal.id, 'Old step');
  store.doc().milestones[m.id] = { ...store.doc().milestones[m.id], done: true, updated: '2026-09-01T10:00:00.000Z' };
  delete store.doc().milestones[m.id].doneOn;
  store.updateMilestone(m.id, { title: 'Old step, renamed' });
  assert.equal(store.doc().milestones[m.id].doneOn, '2026-09-01');
});
