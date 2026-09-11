import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countsOn, doneDays, isHabitDue, rowsForDay, todayRows, weekTotal } from '../js/schedule.js';
import { fixture, done, amount } from './helpers.js';

const habit = (id, repeat, extra = {}) => ({ id, type: 'habit', title: id, repeat, order: 1, ...extra });
const task = (id, date, extra = {}) => ({ id, type: 'task', title: id, date, order: 1, ...extra });
const quota = (id, target, extra = {}) => ({ id, type: 'quota', title: id, target, unit: 'count', order: 1, ...extra });
const ids = (rows) => rows.map((r) => r.item.id);

test('countsOn: created, archived, and status', () => {
  const base = { status: 'active', created: '2026-09-05', archivedOn: null };
  assert.equal(countsOn(base, '2026-09-04'), false);
  assert.equal(countsOn(base, '2026-09-05'), true);
  const archived = { ...base, status: 'archived', archivedOn: '2026-09-10' };
  assert.equal(countsOn(archived, '2026-09-09'), true);
  assert.equal(countsOn(archived, '2026-09-10'), false);
  assert.equal(countsOn({ ...base, status: 'suggested' }, '2026-09-10'), false);
  assert.equal(countsOn({ ...base, status: 'dismissed' }, '2026-09-10'), false);
});

test('isHabitDue: fixed schedules', () => {
  const doc = fixture();
  assert.equal(isHabitDue(doc, habit('h', { kind: 'daily' }), '2026-09-10'), true);
  const mwf = habit('h', { kind: 'weekdays', days: [1, 3, 5] });
  assert.equal(isHabitDue(doc, mwf, '2026-09-09'), true);
  assert.equal(isHabitDue(doc, mwf, '2026-09-10'), false);
  assert.equal(isHabitDue(doc, habit('h', { kind: 'weekly', day: 4 }), '2026-09-10'), true);
  assert.equal(isHabitDue(doc, habit('h', { kind: 'weekly', day: 4 }), '2026-09-11'), false);
  assert.equal(isHabitDue(doc, habit('h', { kind: 'monthly', date: 10 }), '2026-09-10'), true);
  const on31st = habit('h', { kind: 'monthly', date: 31 });
  assert.equal(isHabitDue(doc, on31st, '2026-09-30'), true);
  assert.equal(isHabitDue(doc, on31st, '2026-09-29'), false);
  assert.equal(isHabitDue(doc, on31st, '2026-02-28'), true);
});

test('isHabitDue: perWeek drops off once met, and resets on Monday', () => {
  const gym = habit('gym', { kind: 'perWeek', n: 2 });
  const doc = fixture({ items: [gym], logs: [done('gym', '2026-09-07'), done('gym', '2026-09-08')] });
  assert.equal(isHabitDue(doc, gym, '2026-09-08'), true); // still listed the day it's met
  assert.equal(isHabitDue(doc, gym, '2026-09-09'), false);
  assert.equal(isHabitDue(doc, gym, '2026-09-14'), true);
});

test('tombstoned ticks are ignored', () => {
  const doc = fixture({ logs: [done('h', '2026-09-10', { status: 'archived' })] });
  assert.equal(doneDays(doc, 'h').size, 0);
});

test('tasks: today, carried over, done, future', () => {
  const doc = fixture({
    items: [
      task('today', '2026-09-10'),
      task('late', '2026-09-08'),
      task('doneWed', '2026-09-08'),
      task('future', '2026-09-11'),
    ],
    logs: [done('doneWed', '2026-09-09')],
  });
  const rows = rowsForDay(doc, '2026-09-10');
  assert.deepEqual(ids(rows).sort(), ['late', 'today']);
  assert.equal(rows.find((r) => r.item.id === 'late').carriedFrom, '2026-09-08');
  assert.equal(rows.find((r) => r.item.id === 'today').carriedFrom, null);
  const wed = rowsForDay(doc, '2026-09-09').find((r) => r.item.id === 'doneWed');
  assert.equal(wed.done, true);
  assert.equal(wed.carriedFrom, '2026-09-08');
  const tue = rowsForDay(doc, '2026-09-08').find((r) => r.item.id === 'doneWed');
  assert.equal(tue.done, false);
});

test('rowsForDay respects created and archivedOn', () => {
  const doc = fixture({
    items: [
      habit('new', { kind: 'daily' }, { created: '2026-09-10' }),
      habit('gone', { kind: 'daily' }, { status: 'archived', archivedOn: '2026-09-10' }),
      habit('idea', { kind: 'daily' }, { status: 'suggested' }),
    ],
  });
  assert.deepEqual(ids(rowsForDay(doc, '2026-09-09')), ['gone']);
  assert.deepEqual(ids(rowsForDay(doc, '2026-09-10')), ['new']);
});

test('weekTotal: this week only, active only, item or goal', () => {
  const doc = fixture({
    logs: [
      amount('a1', 'apps', '2026-09-07', 1),
      amount('a2', 'apps', '2026-09-10', 2),
      amount('a3', 'apps', '2026-09-06', 5),                          // last week
      amount('a4', 'apps', '2026-09-09', 4, { status: 'archived' }),  // removed
      { id: 'g1', itemId: null, goalId: 'goal', kind: 'amount', amount: 3, day: '2026-09-08' },
    ],
  });
  assert.equal(weekTotal(doc, 'apps', '2026-09-10'), 3);
  assert.equal(weekTotal(doc, 'apps', '2026-09-13'), 3);
  assert.equal(weekTotal(doc, 'apps', '2026-09-06'), 5);
  assert.equal(weekTotal(doc, 'goal', '2026-09-10'), 3);
});

test('todayRows: suggestions first, then undone by order, then done; quotas included', () => {
  const doc = fixture({
    items: [
      task('b', '2026-09-10', { order: 2 }),
      task('a', '2026-09-10', { order: 1 }),
      habit('ticked', { kind: 'daily' }, { order: 0 }),
      quota('apps', 5, { order: 3 }),
      quota('met', 1, { order: 4 }),
      task('s', '2026-09-10', { status: 'suggested', source: 'gemini', order: 9 }),
    ],
    logs: [done('ticked', '2026-09-10'), amount('x', 'apps', '2026-09-09', 3), amount('y', 'met', '2026-09-10', 1)],
  });
  const rows = todayRows(doc, '2026-09-10');
  assert.deepEqual(ids(rows), ['s', 'a', 'b', 'apps', 'ticked', 'met']);
  assert.equal(rows[0].suggested, true);
  const apps = rows.find((r) => r.item.id === 'apps');
  assert.equal(apps.kind, 'quota');
  assert.equal(apps.total, 3);
  assert.equal(apps.done, false);
  assert.equal(rows.find((r) => r.item.id === 'met').done, true);
});
