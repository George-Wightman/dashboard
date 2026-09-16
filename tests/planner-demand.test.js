import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evenPicks, fixedTasks, demand } from '../planner/demand.js';
import { CALENDAR_DEFAULTS } from '../js/calendar.js';
import { addDays } from '../js/dates.js';
import { at } from '../planner/time.js';
import { fixture, done, amount } from './helpers.js';

process.env.TZ = 'Europe/London';

const TUE = '2026-09-15';
const DAYS = Array.from({ length: 7 }, (_, i) => addDays(TUE, i));
const config = JSON.parse(JSON.stringify(CALENDAR_DEFAULTS));
const run = (doc, extra = {}) => demand({ doc, today: TUE, days: DAYS, config, links: [], covered: new Map(), usedKeys: new Map(), todayClosed: false, ...extra }).blocks;
const brief = (b) => [b.key, b.base, b.minutes, b.items.join(',')];
const task = (id, title, area, date, extra = {}) => ({ id, type: 'task', title, area, date, order: Number(id.replace(/\D/g, '')) || 0, ...extra });

test('evenPicks: spread from the first', () => {
  assert.deepEqual(evenPicks(['a', 'b', 'c', 'd', 'e', 'f'], 2), ['a', 'd']);
  assert.deepEqual(evenPicks(['a', 'b'], 5), ['a', 'b']);
  assert.deepEqual(evenPicks(['a', 'b'], 0), []);
});

test("a day's tasks: grouped by area, carried-over first, done and timed ones left out", () => {
  const doc = fixture({
    items: [
      task('t1', 'Email Sarah', 'Job search', TUE),
      task('t2', 'Update CV', 'Job search', TUE, { minutes: 45 }),
      task('t3', 'Write the day out', 'Assessment centre', TUE),
      task('t4', 'Buy stamps', '', TUE),
      task('t5', 'Chase GSS', 'Job search', '2026-09-14'),
      task('t6', 'Done already', 'Job search', TUE),
      task('t7', 'Call NatCen', 'Job search', TUE, { time: '14:00' }),
      { id: 's1', type: 'task', title: 'Suggested', area: 'Job search', date: TUE, status: 'suggested' },
    ],
    logs: [done('t6', TUE)],
  });
  assert.deepEqual(run(doc).filter((b) => b.day === TUE).map(brief), [
    [`${TUE}||0`, 'Buy stamps', 30, 't4'],
    [`${TUE}|assessment centre|0`, 'Write the day out', 30, 't3'],
    [`${TUE}|job search|0`, 'Job search ×3', 105, 't5,t1,t2'],
  ]);
  assert.equal(run(doc).find((b) => b.key === `${TUE}|job search|0`).carried, true);
});

test('long blocks split: tasks packed in order, a very long task in equal parts', () => {
  const doc = fixture({ items: [
    task('t1', 'A', 'Job search', TUE, { minutes: 60 }),
    task('t2', 'B', 'Job search', TUE, { minutes: 60 }),
    task('t3', 'C', 'Job search', TUE, { minutes: 60 }),
    task('t4', 'Full mock day', 'Assessment centre', TUE, { minutes: 300 }),
  ] });
  assert.deepEqual(run(doc).map(brief), [
    [`${TUE}|assessment centre|0`, 'Full mock day (1 of 2)', 150, 't4'],
    [`${TUE}|assessment centre|1`, 'Full mock day (2 of 2)', 150, 't4'],
    [`${TUE}|job search|0`, 'Job search ×2', 120, 't1,t2'],
    [`${TUE}|job search|1`, 'C', 60, 't3'],
  ]);
});

test('covered items and used keys are left alone', () => {
  const doc = fixture({ items: [task('t1', 'A', 'Job search', TUE), task('t2', 'B', 'Job search', TUE)] });
  const blocks = run(doc, { covered: new Map([[TUE, new Set(['t1'])]]), usedKeys: new Map([[TUE, new Set([`${TUE}|job search|0`])]]) });
  assert.deepEqual(blocks.map(brief), [[`${TUE}|job search|1`, 'B', 30, 't2']]);
});

test("a weekly time target: what's left spread over the week's days, next week an even share", () => {
  const doc = fixture({ items: [
    { id: 'q1', type: 'quota', title: 'Assessment centre prep', area: 'Assessment centre', target: 300, unit: 'minutes' },
    { id: 'q2', type: 'quota', title: 'Hebrew', area: 'Hebrew', target: 240, unit: 'minutes' },
    { id: 'q3', type: 'quota', title: 'Applications', area: 'Job search', target: 3, unit: 'count' },
    task('t1', 'Write the day out', 'Assessment centre', TUE, { minutes: 60 }),
    task('t2', 'Map competencies', 'Assessment centre', '2026-09-17'),
  ] });
  const links = [{ habitId: 'heb', calendarId: 'main', title: 'Learn Hebrew', area: 'Hebrew' }];
  const blocks = run(doc, { links });
  assert.deepEqual(blocks.map(brief), [
    [`${TUE}|assessment centre|0`, 'Write the day out', 60, 't1'],
    ['2026-09-16|assessment centre|0', 'Assessment centre prep', 60, ''],
    ['2026-09-17|assessment centre|0', 'Assessment centre', 60, 't2'],
    ['2026-09-18|assessment centre|0', 'Assessment centre prep', 60, ''],
    ['2026-09-19|assessment centre|0', 'Assessment centre prep', 60, ''],
    ['2026-09-20|assessment centre|0', 'Assessment centre prep', 60, ''],
    ['2026-09-21|assessment centre|0', 'Assessment centre prep', 45, ''],
  ]);
  const logged = fixture({ items: Object.values(doc.items), logs: [amount('a1', 'q1', '2026-09-14', 240)] });
  assert.equal(run(logged, { links }).find((b) => b.day === '2026-09-16').minutes, 15, '60 left over 6 days');
  const closed = run(doc, { links, todayClosed: true });
  assert.equal(closed.find((b) => b.day === '2026-09-16').minutes, 60, '300 over the 5 days left');
});

test('habits: due days, times-a-week spread over the week, linked ones never booked', () => {
  const doc = fixture({
    items: [
      { id: 'h1', type: 'habit', title: 'Outreach', area: 'Job search', repeat: { kind: 'perWeek', n: 2 } },
      { id: 'h2', type: 'habit', title: 'Sweep the boards', area: 'Job search', repeat: { kind: 'weekdays', days: [1, 3, 5] } },
      { id: 'h3', type: 'habit', title: 'Hebrew - app plus Duolingo', area: 'Hebrew', repeat: { kind: 'daily' } },
    ],
  });
  const links = [{ habitId: 'h3', calendarId: 'main', title: 'Learn Hebrew', area: 'Hebrew' }];
  const byDay = (blocks) => Object.fromEntries(DAYS.map((d) => [d, blocks.filter((b) => b.day === d).flatMap((b) => b.items).join(',')]));
  assert.deepEqual(byDay(run(doc, { links })), {
    '2026-09-15': 'h1', '2026-09-16': 'h2', '2026-09-17': '', '2026-09-18': 'h1,h2',
    '2026-09-19': '', '2026-09-20': '', '2026-09-21': 'h1,h2',
  });
  const once = fixture({ items: Object.values(doc.items), logs: [done('h1', '2026-09-14')] });
  assert.equal(byDay(run(once, { links }))['2026-09-18'], 'h2', 'one left this week: today only');
});

test('fixedTasks: a task with a time, on its date, for its length', () => {
  const doc = fixture({ items: [
    task('t1', 'ASSESSMENT CENTRE', 'Assessment centre', '2026-09-16', { time: '09:30', minutes: 390 }),
    task('t2', 'Call', '', '2026-09-30', { time: '10:00' }),
  ] });
  assert.deepEqual(fixedTasks({ doc, days: DAYS, config }), [{
    key: '2026-09-16|fixed|t1', itemId: 't1', day: '2026-09-16', title: 'ASSESSMENT CENTRE', area: 'Assessment centre',
    start: at('2026-09-16', '09:30').getTime(), end: at('2026-09-16', '16:00').getTime(),
  }]);
});

test('a habit with a set time is a fixed event on every day it is due', () => {
  const doc = fixture({ items: [
    { id: 'heb', type: 'habit', title: 'Hebrew', area: 'Hebrew', repeat: { kind: 'daily' }, minutes: 45, time: '09:30' },
    { id: 'gym', type: 'habit', title: 'Gym', area: 'Health', repeat: { kind: 'weekdays', days: [1, 3, 5] }, time: '18:00' },
  ] });
  const days = ['2026-09-15', '2026-09-16', '2026-09-17'];
  const fixed = fixedTasks({ doc, days, config: { defaultMinutes: 30 }, links: [] });
  const hebrew = fixed.filter((f) => f.itemId === 'heb');
  assert.equal(hebrew.length, 3, 'a daily habit is fixed on each day');
  assert.equal(new Date(hebrew[0].start).getHours(), 9);
  assert.equal((hebrew[0].end - hebrew[0].start) / 60000, 45);
  const gym = fixed.filter((f) => f.itemId === 'gym').map((f) => f.day);
  assert.deepEqual(gym, ['2026-09-16'], 'only the weekdays it repeats on');
});

test('a habit linked to its own calendar events is not also booked at a set time', () => {
  const doc = fixture({ items: [
    { id: 'heb', type: 'habit', title: 'Hebrew', area: 'Hebrew', repeat: { kind: 'daily' }, time: '09:30' },
  ] });
  const fixed = fixedTasks({
    doc, days: ['2026-09-15'], config: { defaultMinutes: 30 }, links: [{ habitId: 'heb', calendarId: 'c', title: 'Learn Hebrew', area: 'Hebrew' }],
  });
  assert.deepEqual(fixed, [], 'the link already gives it a real event');
});

test('a habit already ticked, or on time off, is not booked at its set time', () => {
  const doc = fixture({
    items: [{ id: 'heb', type: 'habit', title: 'Hebrew', repeat: { kind: 'daily' }, time: '09:30' }],
    logs: [done('heb', '2026-09-15')],
  });
  doc.calendar = { 'off:2026-09-16': { id: 'off:2026-09-16', status: 'active', start: '2026-09-16', end: '2026-09-16', areas: [], reason: 'away', source: 'claude' } };
  const days = ['2026-09-15', '2026-09-16', '2026-09-17'];
  const fixed = fixedTasks({ doc, days, config: { defaultMinutes: 30 }, links: [] });
  assert.deepEqual(fixed.map((f) => f.day), ['2026-09-17']);
});
