import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayCompletion, history, dayDetail, goalTotal, goalProgress, milestonesOf, goalItems,
} from '../js/schedule.js';
import { fixture, done, amount } from './helpers.js';

const TODAY = '2026-09-10';

test('dayCompletion counts tasks and habits, not quotas', () => {
  const doc = fixture({
    items: [
      { id: 't', type: 'task', title: 't', date: TODAY },
      { id: 'h', type: 'habit', title: 'h', repeat: { kind: 'daily' } },
      { id: 'q', type: 'quota', title: 'q', target: 5, unit: 'count' },
    ],
    logs: [done('t', TODAY), amount('a', 'q', TODAY, 5)],
  });
  assert.deepEqual(dayCompletion(doc, TODAY), { done: 1, total: 2 });
});

test('history: three weeks, Monday first, future days blank', () => {
  const doc = fixture({
    items: [{ id: 'h', type: 'habit', title: 'h', repeat: { kind: 'daily' }, created: '2026-09-01' }],
    logs: [done('h', '2026-09-01'), done('h', TODAY)],
  });
  const cells = history(doc, TODAY);
  assert.equal(cells.length, 21);
  assert.equal(cells[0].day, '2026-08-24');
  assert.equal(cells[20].day, '2026-09-13');
  assert.deepEqual(cells.find((c) => c.day === '2026-08-31'), { day: '2026-08-31', future: false, done: 0, total: 0 });
  assert.deepEqual(cells.find((c) => c.day === '2026-09-01'), { day: '2026-09-01', future: false, done: 1, total: 1 });
  assert.deepEqual(cells.find((c) => c.day === '2026-09-02'), { day: '2026-09-02', future: false, done: 0, total: 1 });
  assert.deepEqual(cells.find((c) => c.day === TODAY), { day: TODAY, future: false, done: 1, total: 1 });
  assert.equal(cells.filter((c) => c.future).length, 3);
});

test('dayDetail lists rows and that day\'s amounts in time order', () => {
  const doc = fixture({
    items: [
      { id: 'q', type: 'quota', title: 'Job search', target: 360, unit: 'minutes' },
      { id: 'h', type: 'habit', title: 'Hebrew', repeat: { kind: 'daily' } },
    ],
    goals: [{ id: 'g', title: 'Savings', target: 1000 }],
    logs: [
      amount('late', 'q', TODAY, 30, { at: '2026-09-10T15:00:00.000Z' }),
      amount('early', 'q', TODAY, 45, { at: '2026-09-10T09:00:00.000Z' }),
      amount('gone', 'q', TODAY, 99, { status: 'archived', at: '2026-09-10T10:00:00.000Z' }),
      { id: 'sv', itemId: null, goalId: 'g', kind: 'amount', amount: 50, day: TODAY, at: '2026-09-10T12:00:00.000Z' },
      amount('other', 'q', '2026-09-09', 20, { at: '2026-09-09T09:00:00.000Z' }),
    ],
  });
  const detail = dayDetail(doc, TODAY);
  assert.deepEqual(detail.rows.map((r) => r.item.id), ['h']);
  assert.deepEqual(detail.amounts.map((a) => a.log.id), ['early', 'sv', 'late']);
  assert.equal(detail.amounts[0].item.title, 'Job search');
  assert.equal(detail.amounts[1].item, null);
  assert.equal(detail.amounts[1].goal.title, 'Savings');
});

test('goalProgress from milestones', () => {
  const doc = fixture({
    goals: [{ id: 'g', title: 'Get a job' }, { id: 'empty', title: 'Nothing yet' }],
    milestones: [
      { id: 'm1', goalId: 'g', title: 'CV', done: true, order: 2 },
      { id: 'm2', goalId: 'g', title: 'Portfolio', done: false, order: 1 },
      { id: 'm3', goalId: 'g', title: 'Idea', done: false, order: 3, status: 'suggested' },
      { id: 'm4', goalId: 'g', title: 'Old', done: true, order: 4, status: 'archived' },
    ],
  });
  assert.deepEqual(goalProgress(doc, doc.goals.g), { numeric: false, done: 1, total: 2, pct: 50 });
  assert.deepEqual(goalProgress(doc, doc.goals.empty), { numeric: false, done: 0, total: 0, pct: 0 });
  assert.deepEqual(milestonesOf(doc, 'g').map((m) => m.id), ['m2', 'm1', 'm3']);
});

test('goalProgress from a numeric target, capped at 100', () => {
  const log = (id, value, extra = {}) => ({ id, itemId: null, goalId: 'g', kind: 'amount', amount: value, day: TODAY, ...extra });
  const doc = fixture({
    goals: [{ id: 'g', title: 'Save', target: 10, unit: 'count' }],
    logs: [log('a', 3), log('b', 4), log('c', 50, { status: 'archived' })],
  });
  assert.equal(goalTotal(doc, 'g'), 7);
  assert.deepEqual(goalProgress(doc, doc.goals.g), { numeric: true, done: 7, total: 10, pct: 70 });
  doc.logs.d = { ...log('d', 20), source: 'me', status: 'active', created: TODAY, archivedOn: null };
  assert.equal(goalProgress(doc, doc.goals.g).pct, 100);
});

test('goalItems: active linked items by order', () => {
  const doc = fixture({
    items: [
      { id: 'b', type: 'task', title: 'b', goalId: 'g', order: 2, date: TODAY },
      { id: 'a', type: 'habit', title: 'a', goalId: 'g', order: 1, repeat: { kind: 'daily' } },
      { id: 'x', type: 'task', title: 'x', goalId: 'g', order: 0, date: TODAY, status: 'archived' },
      { id: 'y', type: 'task', title: 'y', goalId: 'other', order: 0, date: TODAY },
    ],
  });
  assert.deepEqual(goalItems(doc, 'g').map((i) => i.id), ['a', 'b']);
});
