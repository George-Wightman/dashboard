import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timelineModel, tomorrowLine } from '../js/timeline.js';
import { dayRecordId } from '../js/calendar.js';
import { emptyDoc } from '../js/doc.js';

const row = (id, extra = {}) => ({ item: { id, title: id }, done: false, ...extra });
const now = new Date('2026-10-20T09:20:00Z');
const today = '2026-10-20';

test('timed rows and commitments in start order; untimed and suggested rows go to any time', () => {
  const slots = new Map([['heb', { start: '2026-10-20T08:00:00Z', end: '2026-10-20T09:00:00Z' }], ['gym', { start: '2026-10-20T16:30:00Z', end: '2026-10-20T17:45:00Z' }]]);
  const m = timelineModel({
    rows: [row('gym'), row('gp'), row('heb', { done: true }), row('socks', { suggested: true })],
    slots, today, now,
    commitments: [{ title: 'Signify QA shift', calendar: 'Work', start: '2026-10-20T13:00:00Z', end: '2026-10-20T16:00:00Z' },
      { title: 'Bank holiday', calendar: 'UK', start: '2026-10-20T00:00:00Z', end: '2026-10-21T00:00:00Z', allDay: true },
      { title: 'Tomorrow thing', calendar: 'Work', start: '2026-10-21T10:00:00Z', end: '2026-10-21T11:00:00Z' }],
  });
  assert.deepEqual(m.timed.map((e) => e.kind === 'row' ? e.row.item.id : e.title), ['heb', 'Signify QA shift', 'gym']);
  assert.deepEqual(m.anytime.map((r) => r.item.id), ['gp', 'socks']);
  assert.equal(m.nowIndex, 1);
});

test('no calendar data: everything is any time, and the now line has nothing after it', () => {
  const m = timelineModel({ rows: [row('a'), row('b')], slots: new Map(), commitments: [], today, now });
  assert.deepEqual(m.timed, []);
  assert.deepEqual(m.anytime.map((r) => r.item.id), ['a', 'b']);
  assert.equal(m.nowIndex, 0);
  assert.deepEqual(timelineModel({ rows: [], slots: new Map(), commitments: [], today, now }), { timed: [], anytime: [], nowIndex: 0 });
});

test('two tasks in one block and a commitment at the same minute keep a stable order, none lost', () => {
  const start = '2026-10-20T10:00:00Z';
  const slots = new Map([['x', { start, end: '2026-10-20T11:00:00Z' }], ['y', { start, end: '2026-10-20T11:00:00Z' }]]);
  const m = timelineModel({ rows: [row('y'), row('x')], slots, commitments: [{ title: 'Call', calendar: 'Main', start, end: '2026-10-20T10:30:00Z' }], today, now });
  assert.deepEqual(m.timed.map((e) => e.kind === 'row' ? e.row.item.id : e.title), ['y', 'x', 'Call']);
});

test('after midnight, still the same logical day, the now line comes after everything', () => {
  const slots = new Map([['read', { start: '2026-10-20T20:00:00Z', end: '2026-10-20T20:20:00Z' }]]);
  const m = timelineModel({ rows: [row('read')], slots, commitments: [], today, now: new Date('2026-10-21T00:10:00Z') });
  assert.equal(m.nowIndex, 1);
});

test('meal markers at 08:00, 12:30 and 19:00, each only while its slot has no meal', async () => {
  const { mealMarkers } = await import('../js/timeline.js');
  const doc = emptyDoc();
  const at = (m) => new Date(m.start);
  const three = mealMarkers(doc, today);
  assert.deepEqual(three.map((m) => [m.slot, at(m).getHours(), at(m).getMinutes()]), [['breakfast', 8, 0], ['lunch', 12, 30], ['dinner', 19, 0]]);
  doc.meals = { 'meal:a': { id: 'meal:a', kind: 'meal', day: today, slot: 'lunch', status: 'active', at: '2026-10-20T11:40:00.000Z' } };
  assert.deepEqual(mealMarkers(doc, today).map((m) => m.slot), ['breakfast', 'dinner']);
});

test('meal markers take their place in the day, after rows at the same time', () => {
  const slots = new Map([['heb', { start: '2026-10-20T07:00:00Z', end: '2026-10-20T08:00:00Z' }]]);
  const m = timelineModel({ rows: [row('heb')], slots, commitments: [], today, now, markers: [{ slot: 'lunch', start: '2026-10-20T11:30:00Z' }] });
  assert.deepEqual(m.timed.map((e) => e.kind), ['row', 'meal']);
  assert.equal(m.timed[1].slot, 'lunch');
});

test("tomorrow's line, with rough times marked", () => {
  const doc = emptyDoc();
  doc.calendar[dayRecordId('2026-10-21')] = { status: 'active', day: '2026-10-21', blocks: [
    { title: 'Hebrew practice', start: '2026-10-21T08:00:00Z', state: 'exact' },
    { title: 'Gym', start: '2026-10-21T16:30:00Z', state: 'rough' },
  ] };
  assert.match(tomorrowLine(doc, today), /^Hebrew practice \d\d:\d\d · Gym ~\d\d:\d\d$/);
  assert.equal(tomorrowLine(emptyDoc(), today), null);
});
