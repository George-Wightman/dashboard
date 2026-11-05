import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordUpcoming, upcomingShifts } from '../planner/hours.js';
import { UPCOMING_ID } from '../js/hours.js';
import { makeStore } from './helpers.js';

const ev = (id, start, end, extra = {}) => ({ id, calendarId: 'work', summary: '', start: { dateTime: start }, end: { dateTime: end }, ...extra });
const now = new Date('2026-11-05T12:00:00Z');

test('upcomingShifts: only Work events still to come, not cancelled ones', () => {
  const list = upcomingShifts([
    ev('past', '2026-11-05T08:00:00Z', '2026-11-05T10:00:00Z'),
    ev('later', '2026-11-06T08:00:00Z', '2026-11-06T11:00:00Z'),
    ev('gone', '2026-11-07T08:00:00Z', '2026-11-07T10:00:00Z', { status: 'cancelled' }),
    ev('other', '2026-11-08T08:00:00Z', '2026-11-08T10:00:00Z', { calendarId: 'gym' }),
  ], { calendarId: 'work', now });
  assert.deepEqual(list.map((s) => s.eventId), ['later']);
  assert.equal(list[0].minutes, 180);
  assert.equal(list[0].day, '2026-11-06');
});

test('recordUpcoming: writes the list, then nothing while it stays the same', () => {
  const store = makeStore();
  const events = [ev('later', '2026-11-06T08:00:00Z', '2026-11-06T11:00:00Z')];
  assert.equal(recordUpcoming(store, events, { calendarId: 'work', now }), true);
  assert.equal(store.doc().calendar[UPCOMING_ID].list.length, 1);
  assert.equal(recordUpcoming(store, events, { calendarId: 'work', now }), false);
  assert.equal(recordUpcoming(store, [], { calendarId: 'work', now }), true);
  assert.equal(store.doc().calendar[UPCOMING_ID].list.length, 0);
});

test('recordUpcoming: no Work calendar, no record', () => {
  const store = makeStore();
  assert.equal(recordUpcoming(store, [], { calendarId: null, now }), false);
  assert.equal(store.doc().calendar[UPCOMING_ID], undefined);
});
