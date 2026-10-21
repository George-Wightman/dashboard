import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glanceOf, GLANCE_TILES, SITE } from '../js/glance.js';
import { fixture } from './helpers.js';

process.env.TZ = 'Europe/London';
const TODAY = '2026-10-21';
const at = (hh, mm = 0) => new Date(2026, 9, 21, hh, mm).toISOString();

function doc() {
  const d = fixture({ items: [
    { id: 'battery', type: 'task', title: 'Find a new laptop battery', date: TODAY, time: '08:45', minutes: 30, order: 1 },
    { id: 'nca', type: 'task', title: 'Email the landlord', date: TODAY, order: 2 },
    { id: 'james', type: 'task', title: 'Call the bank', date: TODAY, order: 3 },
  ] });
  d.calendar['day:3'] = { id: 'day:3', status: 'active', day: TODAY, blocks: [
    { key: 'battery-1', start: at(8, 45), end: at(9, 15), items: ['battery'], title: 'Find a new laptop battery', state: 'exact' },
    { key: 'nca-1', start: at(15, 30), end: at(16, 15), items: ['nca'], title: 'Email the landlord', state: 'exact' },
  ] };
  d.calendar.agenda = { id: 'agenda', status: 'active', syncedAt: at(7), busy: [{ title: 'Signify', start: at(10), end: at(12), calendar: 'Work' }] };
  return d;
}

test('every widget has content, and opens its tile big in the dashboard', () => {
  const g = glanceOf(doc(), TODAY, new Date(2026, 9, 21, 8, 0));
  assert.deepEqual(Object.keys(g.tiles), GLANCE_TILES);
  for (const [id, t] of Object.entries(g.tiles)) {
    assert.ok(t.title && Array.isArray(t.lines) && t.lines.length >= 1, id);
    assert.equal(t.open, id === 'day' ? SITE : `${SITE}?big=${id}`);
  }
  assert.equal(g.tiles.countdown.lines[0], 'Nothing to show yet.');
  assert.equal(g.tiles.week.title, 'This week');
});

test('the day widget is a short calendar: what is still to come, the next marked, the rest counted', () => {
  const d = doc();
  const morning = glanceOf(d, TODAY, new Date(2026, 9, 21, 8, 0)).tiles.day;
  assert.deepEqual(morning.lines, ['▸ 08:45  Find a new laptop battery', '10:00  Signify (until 12:00)', '15:30  Email the landlord', '+ 1 any time today']);
  assert.equal(morning.title, 'Wednesday 21');
  const afternoon = glanceOf(d, TODAY, new Date(2026, 9, 21, 13, 0)).tiles.day;
  assert.deepEqual(afternoon.lines, ['0 of 1 earlier done', '▸ 15:30  Email the landlord', '+ 1 any time today']);
});

test('fuel shows protein today and the meals', () => {
  const d = doc();
  d.meals = { 'meal:a': { id: 'meal:a', kind: 'meal', status: 'active', day: TODAY, at: at(8), slot: 'breakfast', state: 'estimated', text: 'eggs', estimate: { name: 'Big egg breakfast' }, final: { protein: 57, kcal: 1280 } } };
  const fuel = glanceOf(d, TODAY, new Date(2026, 9, 21, 9, 0)).tiles.fuel;
  assert.equal(fuel.number, '57 g');
  assert.match(fuel.caption, /of 180 g protein today/);
  assert.equal(fuel.lines[0], 'Breakfast: Big egg breakfast · 57 g');
});

test('a long list is cut with how many more', () => {
  const d = doc();
  d.goals = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`g${i}`, { id: `g${i}`, status: 'active', title: `Goal ${i}`, order: i, target: null }]));
  const goals = glanceOf(d, TODAY, new Date(2026, 9, 21, 9, 0)).tiles.goals;
  assert.equal(goals.lines.length, 8);
  assert.equal(goals.lines.at(-1), '+ 5 more');
});
