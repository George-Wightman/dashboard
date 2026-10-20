import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropTime, movedSlot, toClock } from '../js/timeline.js';

const at = (hh, mm = 0) => new Date(2026, 9, 21, hh, mm).toISOString();
const now = new Date(2026, 9, 21, 8, 7);

test('a task dropped between two entries goes after the first, in quarter hours', () => {
  const above = { start: at(9), end: at(10) };
  const below = { start: at(13), end: at(15) };
  assert.equal(toClock(dropTime({ above, below, fraction: 0, minutes: 30, now })), '10:00');
  assert.equal(toClock(dropTime({ above, below, fraction: 1, minutes: 30, now })), '12:30', 'ends as the next one starts');
  assert.equal(toClock(dropTime({ above, below, fraction: 0.5, minutes: 30, now })), '11:15');
});

test('above the first entry it ends as that one starts; below the last it starts as that one ends', () => {
  assert.equal(toClock(dropTime({ below: { start: at(13) }, minutes: 45, now })), '12:15');
  assert.equal(toClock(dropTime({ above: { start: at(18), end: at(19, 20) }, minutes: 30, now })), '19:15');
});

test('never before now', () => {
  assert.equal(toClock(dropTime({ below: { start: at(8, 30) }, minutes: 60, now })), '08:15');
  assert.equal(toClock(dropTime({ now })), '08:15');
});

test('a task given a new time today shows there before the planner moves its block', () => {
  const item = { type: 'task', date: '2026-10-21', time: '08:45', minutes: 30 };
  const old = { start: at(17, 30), end: at(18), state: 'exact' };
  const moved = movedSlot(item, old, '2026-10-21');
  assert.equal(moved.state, 'moving');
  assert.equal(toClock(new Date(moved.start)), '08:45');
  assert.equal(toClock(new Date(moved.end)), '09:15');
  assert.equal(movedSlot(item, { start: at(8, 45), end: at(9, 15) }, '2026-10-21').state, undefined, 'already there');
  assert.equal(movedSlot({ ...item, time: null }, old, '2026-10-21'), old);
  assert.equal(movedSlot({ ...item, type: 'habit' }, old, '2026-10-21'), old);
  assert.equal(movedSlot({ ...item, date: '2026-10-22' }, old, '2026-10-21'), old);
  assert.equal(movedSlot({ ...item }, undefined, '2026-10-21').state, 'moving', 'from "any time" onto the day');
});

test('a time after midnight is on the next calendar date', async () => {
  const { toDay } = await import('../js/timeline.js');
  assert.equal(toDay(new Date(2026, 9, 21, 0, 45)), '2026-10-21');
  assert.equal(toDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});
