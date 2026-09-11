import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streak } from '../js/schedule.js';
import { fixture, done, amount } from './helpers.js';

const TODAY = '2026-09-10'; // Thursday
const ticks = (id, days) => days.map((d) => done(id, d));
const range = (from, to) => {
  const out = [];
  for (let d = Number(from.slice(8)); d <= Number(to.slice(8)); d++) out.push(`${from.slice(0, 8)}${String(d).padStart(2, '0')}`);
  return out;
};

test('daily: an unticked today does not break the streak', () => {
  const h = { id: 'h', type: 'habit', repeat: { kind: 'daily' }, created: '2026-09-01' };
  const doc = fixture({ items: [h], logs: ticks('h', range('2026-09-05', '2026-09-09')) });
  assert.deepEqual(streak(doc, doc.items.h, TODAY), { current: 5, best: 5 });
  const withToday = fixture({ items: [h], logs: ticks('h', range('2026-09-05', '2026-09-10')) });
  assert.deepEqual(streak(withToday, withToday.items.h, TODAY), { current: 6, best: 6 });
});

test('daily: a gap resets current but not best', () => {
  const h = { id: 'h', type: 'habit', repeat: { kind: 'daily' }, created: '2026-09-01' };
  const days = [...range('2026-09-01', '2026-09-05'), ...range('2026-09-07', '2026-09-09')];
  const doc = fixture({ items: [h], logs: ticks('h', days) });
  assert.deepEqual(streak(doc, doc.items.h, TODAY), { current: 3, best: 5 });
});

test('daily: missing yesterday means current is 0', () => {
  const h = { id: 'h', type: 'habit', repeat: { kind: 'daily' }, created: '2026-09-01' };
  const doc = fixture({ items: [h], logs: ticks('h', range('2026-09-01', '2026-09-08')) });
  assert.deepEqual(streak(doc, doc.items.h, TODAY), { current: 0, best: 8 });
});

test('weekdays: only scheduled days count', () => {
  const h = { id: 'h', type: 'habit', repeat: { kind: 'weekdays', days: [1, 3, 5] }, created: '2026-09-01' };
  const doc = fixture({ items: [h], logs: ticks('h', ['2026-09-02', '2026-09-04', '2026-09-07', '2026-09-09']) });
  assert.deepEqual(streak(doc, doc.items.h, TODAY), { current: 4, best: 4 });
});

test('perWeek: counts weeks; this week in progress is skipped', () => {
  const h = { id: 'h', type: 'habit', repeat: { kind: 'perWeek', n: 2 }, created: '2026-08-24' };
  const doc = fixture({
    items: [h],
    logs: ticks('h', ['2026-08-24', '2026-08-25', '2026-08-31', '2026-09-03', '2026-09-08']),
  });
  assert.deepEqual(streak(doc, doc.items.h, TODAY), { current: 2, best: 2 });
});

test('quota: consecutive weeks meeting the target', () => {
  const q = { id: 'q', type: 'quota', target: 3, unit: 'count', created: '2026-08-24' };
  const doc = fixture({
    items: [q],
    logs: [
      amount('w1', 'q', '2026-08-26', 3),
      amount('w2', 'q', '2026-09-02', 2),
      amount('w3', 'q', '2026-09-08', 3),
    ],
  });
  assert.deepEqual(streak(doc, doc.items.q, TODAY), { current: 1, best: 1 });
});

test('tasks have no streak', () => {
  const t = { id: 't', type: 'task', date: TODAY, created: TODAY };
  const doc = fixture({ items: [t] });
  assert.deepEqual(streak(doc, doc.items.t, TODAY), { current: 0, best: 0 });
});
