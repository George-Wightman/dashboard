process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLOR_NAMES, checkConfigField, readPlannerConfig, mergeSetting, timeOff, offCovers, offWindows, excused,
  offLine, isPriority, briefFor, nextOffId, checkTimeOff,
} from '../js/calendar.js';
import { rowsForDay, dayCompletion, streak, history } from '../js/schedule.js';
import { attention } from '../js/attention.js';
import { checkNotes } from '../js/parse.js';
import { fixture, done, amount, makeStore } from './helpers.js';

const WED = '2026-09-16';
const off = (id, start, end, extra = {}) => ({ id, status: 'active', source: 'claude', start, end, areas: [], reason: 'Away', ...extra });
const withCalendar = (doc, records) => ({ ...doc, calendar: Object.fromEntries(records.map((r) => [r.id, r])) });

test('new settings: priority areas, area colours, hours for a day — checked', () => {
  assert.equal(COLOR_NAMES.Grape, '3');
  assert.deepEqual(checkConfigField('priorityAreas', [' Assessment centre ']), ['Assessment centre']);
  assert.throws(() => checkConfigField('priorityAreas', 'AC'), /list of area names/);
  assert.deepEqual(checkConfigField('areaColors', { 'Assessment centre': 'grape' }), { 'Assessment centre': 'Grape' });
  assert.throws(() => checkConfigField('areaColors', { AC: 'Purple' }), /"Purple" isn't one of Google's colours — Lavender, Sage/);
  assert.throws(() => checkConfigField('areaColors', { A: 'Grape', B: 'grape' }), /gives Grape to both A and B/);
  assert.deepEqual(checkConfigField('dayHours', { '2026-09-18': ['09:00', '13:00'] }), { '2026-09-18': ['09:00', '13:00'] });
  assert.throws(() => checkConfigField('dayHours', { '2026-02-30': ['09:00', '13:00'] }), /map a date to two times/);
  assert.throws(() => checkConfigField('dayHours', { '2026-09-18': ['13:00', '09:00'] }), /map a date to two times/);
  const { config } = readPlannerConfig(fixture());
  assert.deepEqual([config.priorityAreas, config.areaColors, config.dayHours], [[], {}, {}]);
});

test('mergeSetting: one key at a time, null removes it, other settings replace', () => {
  const current = { 'Job search': 'Application', 'Assessment centre': 'Application' };
  assert.deepEqual(mergeSetting('areaCalendars', current, { 'assessment centre': 'Tasks' }), { 'Job search': 'Application', 'assessment centre': 'Tasks' });
  assert.deepEqual(mergeSetting('areaCalendars', current, { 'Job search': null }), { 'Assessment centre': 'Application' });
  assert.deepEqual(mergeSetting('hours', ['09:00', '19:00'], ['08:00', '18:00']), ['08:00', '18:00']);
});

test('time off: whole days and stretches of hours, everything or some areas', () => {
  const doc = withCalendar(fixture(), [
    off('off:2026-09-16', WED, '2026-09-17', { areas: ['Job search', 'assessment centre'], reason: 'Maya leaves for Austria' }),
    off('off:2026-09-18', '2026-09-18T13:00', '2026-09-18T19:00', { reason: 'Dentist and errands' }),
    off('off:2026-09-20', '2026-09-20', '2026-09-20', { status: 'archived' }),
    { id: 'config', status: 'active', hours: ['09:00', '19:00'] },
  ]);
  assert.deepEqual(timeOff(doc).map((o) => o.id), ['off:2026-09-16', 'off:2026-09-18']);
  assert.equal(offCovers(timeOff(doc)[0], '2026-09-17'), true);
  assert.equal(offCovers(timeOff(doc)[0], '2026-09-18'), false);
  assert.equal(offCovers(timeOff(doc)[1], '2026-09-18'), false, 'hours are never a whole day');
  const job = { area: 'Job Search' };
  const gym = { area: 'Health' };
  assert.equal(excused(doc, job, WED), true);
  assert.equal(excused(doc, gym, WED), false);
  assert.equal(excused(doc, job, '2026-09-18'), false);
  assert.equal(excused(doc, job, '2026-09-20'), false, 'cancelled time off');
  const [w] = offWindows(doc, '2026-09-18');
  assert.deepEqual([new Date(w.start).getHours(), new Date(w.end).getHours(), w.areas], [13, 19, []]);
  assert.deepEqual(offWindows(doc, WED), []);
  assert.equal(offLine(doc, WED), 'Time off — Maya leaves for Austria · Job search, assessment centre');
  assert.equal(offLine(doc, '2026-09-18'), 'Time off — Dentist and errands · 13:00–19:00');
  assert.equal(offLine(doc, '2026-09-19'), null);
  assert.equal(nextOffId(doc, '2026-09-16'), 'off:2026-09-16b');
  assert.equal(nextOffId(doc, '2026-09-22T10:00'), 'off:2026-09-22');
});

test('checkTimeOff: dates or date-and-times, ending after starting', () => {
  assert.deepEqual(checkTimeOff({ start: WED, reason: ' Away ' }), { start: WED, end: WED, areas: [], reason: 'Away' });
  assert.deepEqual(checkTimeOff({ start: '2026-09-18T13:00', end: '2026-09-18T19:00', areas: [' Job search '] }).areas, ['Job search']);
  assert.throws(() => checkTimeOff({ start: WED, end: '2026-09-15' }), /end after it starts/);
  assert.throws(() => checkTimeOff({ start: '2026-09-18T13:00', end: '2026-09-18T13:00' }), /end after it starts/);
  assert.throws(() => checkTimeOff({ start: 'wednesday' }), /dates \(YYYY-MM-DD\)/);
  assert.throws(() => checkTimeOff({ start: WED, areas: 'Job search' }), /list of area names/);
});

test('priority, the brief and notes', () => {
  const doc = withCalendar(fixture({ journal: [{ id: `brief:${WED}`, kind: 'brief', day: WED, text: 'AC prep first.', source: 'claude' }] }),
    [{ id: 'config', status: 'active', priorityAreas: ['Assessment centre'] }]);
  assert.equal(isPriority(doc, { area: 'assessment centre' }), true);
  assert.equal(isPriority(doc, { area: 'Job search' }), false);
  assert.equal(isPriority(doc, { area: 'Job search', priority: true }), true);
  assert.equal(briefFor(doc, WED), 'AC prep first.');
  assert.equal(briefFor(doc, '2026-09-17'), null);
  assert.equal(checkNotes('  Say the date is 5 Oct  '), 'Say the date is 5 Oct');
  assert.equal(checkNotes(null), '');
  assert.throws(() => checkNotes('x'.repeat(1001)), /at most 1000 characters/);
  assert.throws(() => checkNotes(5), /Notes should be text/);
});

test('excused items: off the list and the count, a dated task carried to the next day, streaks unbroken', () => {
  const base = fixture({
    items: [
      { id: 'read', type: 'habit', title: 'Read', area: 'Job search', repeat: { kind: 'daily' }, created: '2026-09-13' },
      { id: 'heb', type: 'habit', title: 'Hebrew', area: 'Hebrew', repeat: { kind: 'daily' }, created: '2026-09-13' },
      { id: 'cv', type: 'task', title: 'CV', area: 'Job search', date: WED },
    ],
    logs: [done('read', '2026-09-14'), done('read', '2026-09-15'), done('read', '2026-09-17')],
  });
  const doc = withCalendar(base, [off('off:2026-09-16', WED, WED, { areas: ['Job search'] })]);
  assert.deepEqual(rowsForDay(doc, WED).map((r) => r.item.id), ['heb']);
  assert.deepEqual(dayCompletion(doc, WED), { done: 0, total: 1 });
  const thu = rowsForDay(doc, '2026-09-17');
  assert.deepEqual(thu.map((r) => [r.item.id, r.carriedFrom]), [['read', null], ['heb', null], ['cv', WED]]);
  assert.equal(streak(doc, doc.items.read, '2026-09-17').current, 3, 'Mon, Tue, Thu — Wednesday excused');
  assert.equal(streak(base, base.items.read, '2026-09-17').current, 1, 'without the time off, Wednesday breaks it');
});

test('history: a day off for everything shows off, with its reason', () => {
  const doc = withCalendar(fixture({ items: [{ id: 'read', type: 'habit', title: 'Read', repeat: { kind: 'daily' }, created: '2026-09-01' }] }),
    [off('off:2026-09-16', WED, WED, { reason: 'Maya leaves for Austria' })]);
  const cells = history(doc, '2026-09-17');
  const wed = cells.find((c) => c.day === WED);
  assert.deepEqual([wed.off, wed.total], ['Maya leaves for Austria', 0]);
  assert.equal('off' in cells.find((c) => c.day === '2026-09-15'), false);
});

test('attention: what Claude should look at', () => {
  const doc = withCalendar(fixture({
    items: [
      { id: 't1', type: 'task', title: 'Email NatCen', area: 'Job search', date: '2026-09-17' },
      { id: 't2', type: 'task', title: 'Update CV', area: 'Job search', date: '2026-09-10', minutes: 30 },
      { id: 't3', type: 'task', title: 'Later', date: '2026-10-30' },
      { id: 'q1', type: 'quota', title: 'Applications', target: 7, unit: 'count', unitLabel: 'applications' },
      { id: 'q2', type: 'quota', title: 'Hebrew', target: 60, unit: 'minutes' },
    ],
    logs: [amount('a1', 'q1', '2026-09-14', 1), amount('a2', 'q2', '2026-09-15', 60)],
  }), [
    { id: 'day:3', status: 'active', day: WED, blocks: [], skipped: [], missed: [], notes: ['Moved Gym to 09:30 (Learn Hebrew)', "Couldn't fit Job search ×2 on Thu — moved to Fri"] },
  ]);
  const lines = attention(doc, WED);
  assert.ok(lines.includes('1 task with no length (the planner gives it 30 minutes): "Email NatCen"'), lines.join('\n'));
  assert.ok(lines.includes('"Update CV" has carried over since Thu 10 Sep'), lines.join('\n'));
  assert.ok(lines.includes('"Applications" is behind: 1 / 7 applications with 5 days left'), lines.join('\n'));
  assert.ok(lines.includes("Planner: Couldn't fit Job search ×2 on Thu — moved to Fri"), lines.join('\n'));
  assert.ok(!lines.some((l) => /Moved Gym|Hebrew/.test(l)), lines.join('\n'));
  assert.deepEqual(attention(fixture(), WED), []);
});

test('the store: notes and priority on items and goals, and a brief from Claude', () => {
  const s = makeStore();
  const t = s.addItem({ type: 'task', title: 'Email York Careers', notes: ' Say the date is 5 Oct. ', priority: true });
  assert.deepEqual([t.notes, t.priority], ['Say the date is 5 Oct.', true]);
  assert.throws(() => s.addItem({ type: 'quota', title: 'x', target: 3, priority: true }), /Only a task or a habit can be a priority/);
  assert.throws(() => s.addItem({ type: 'task', title: 'x', priority: 'yes' }), /Priority is true or false/);
  assert.equal(s.addGoal({ title: 'Land the role', notes: 'MI5 first' }).notes, 'MI5 first');
  const brief = s.saveJournal({ kind: 'brief', day: '2026-09-10', text: 'AC prep first.' }, 'claude');
  assert.deepEqual([brief.id, brief.source, brief.text], ['brief:2026-09-10', 'claude', 'AC prep first.']);
});
