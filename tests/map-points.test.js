// The day's points, row by row (js/map/points.js): what counts towards the map and what doesn't.

process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, done } from './helpers.js';
import { at } from '../planner/time.js';
import { commitKey } from '../js/commit.js';
import { dayPoints, pointsLines } from '../js/map/points.js';
import { mapTown } from './fixtures/map-town.js';

const DAY = '2026-10-23';
const gym = { id: 'gym', type: 'habit', title: 'Gym', area: 'Health', minutes: 120, repeat: { kind: 'daily' }, created: '2026-10-01', order: 1 };
const read = { id: 'read', type: 'habit', title: 'Read 10 pages', area: 'Reading', minutes: 20, repeat: { kind: 'daily' }, created: '2026-10-01', order: 2 };
const task = (id, date, extra = {}) => ({ id, type: 'task', title: id, area: 'Job search', date, created: '2026-10-01', order: 10, ...extra });
const meal = (id) => ({ id, kind: 'meal', day: DAY, at: `${DAY}T12:00:00.000Z`, slot: 'lunch', status: 'active' });

function day({ items, logs = [], meals = [], commits = [] }) {
  const d = fixture({ items, logs });
  for (const m of meals) d.meals[m.id] = m;
  for (const [cday, tasks] of commits) d.calendar[commitKey(cday)] = { id: commitKey(cday), day: cday, at: at(cday, '11:00').toISOString(), tasks };
  return d;
}

test('each row says what it is worth and whether it has been earned', () => {
  const doc = day({
    items: [gym, read, task('evetting', DAY, { minutes: 120 })],
    logs: [done('gym', DAY)],
    meals: [meal('m1'), meal('m2')],
  });
  const p = dayPoints(doc, DAY, mapTown());
  const by = Object.fromEntries(p.rows.map((r) => [r.id, r]));
  assert.deepEqual([by.gym.state, by.gym.hammers, by.gym.track], ['earned', 20, 'sport']);
  assert.deepEqual([by.read.state, by.read.hammers, by.read.track], ['open', 10, 'culture']);
  assert.deepEqual([by.evetting.state, by.evetting.hammers], ['open', 20]);
  assert.deepEqual([by.meals.state, by.meals.hammers, by.meals.note, by.meals.track], ['open', 10, '2 of 3 meals logged', 'sport']);
  assert.deepEqual([p.earned, p.toEarn], [20, 40]);
  assert.deepEqual(p.bonus, { amount: 20, earned: false, possible: true, left: 3 });
});

test('a task moved after the lock is left out the first time, and says so', () => {
  const doc = day({ items: [gym, task('james', '2026-10-24')], logs: [done('gym', DAY)], commits: [[DAY, ['james']]] });
  const p = dayPoints(doc, DAY);
  const james = p.rows.find((r) => r.id === 'james');
  assert.deepEqual([james.state, james.hammers], ['pushed', 0]);
  assert.match(james.note, /Moved to Sat: left out today, a miss if it moves again/);
  const text = pointsLines(p).join('\n');
  assert.match(text, /↷ james · Moved to Sat/);
  assert.match(text, /fewer than 3 rows count/);
});

test('a finished day says it has the bonus', () => {
  const doc = day({ items: [gym, read], logs: [done('gym', DAY), done('read', DAY)], meals: ['a', 'b', 'c'].map(meal) });
  const p = dayPoints(doc, DAY, mapTown());
  assert.equal(p.bonus.earned, true);
  assert.equal(p.earned, 40);
  assert.match(pointsLines(p)[0], /^Today's points: \+40 so far; finished: \+20 bonus\./);
});
