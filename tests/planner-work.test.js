// Signify shifts (planner/work.js): the Work calendar's events, once over, become `work:` records the
// map turns into hammers (docs/superpowers/specs/2026-10-29-salzburg-era-design.md).

process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordShifts } from '../planner/work.js';
import { at } from '../planner/time.js';
import { makeStore } from './helpers.js';

const WED = '2026-11-11', THU = '2026-11-12';
const WORK = 'work-cal';
const ev = (id, day, from, to, extra = {}) => ({
  id, calendarId: WORK, summary: 'Signify', status: 'confirmed',
  start: { dateTime: at(day, from).toISOString() }, end: { dateTime: at(day, to).toISOString() }, ...extra,
});
const shifts = (store) => Object.values(store.doc().calendar).filter((r) => String(r.id).startsWith('work:') && r.status === 'active');
const run = (store, events, now, today = WED) => recordShifts(store, events, { calendarId: WORK, today, now, dayStartHour: 4 });

test('an ended shift on the Work calendar is recorded once, with its day and minutes', () => {
  const store = makeStore();
  const events = [ev('a', WED, '09:00', '13:00')];
  run(store, events, at(WED, '14:00'));
  run(store, events, at(WED, '15:00'));
  assert.deepEqual(shifts(store).map((r) => [r.id, r.day, r.minutes, r.title]), [['work:a', WED, 240, 'Signify']]);
  assert.equal(store.doc().calendar['work-status'].startedOn, WED);
});

test('a shift not yet over, all-day, cancelled, free, or on another calendar is not recorded', () => {
  const store = makeStore();
  run(store, [
    ev('later', WED, '13:00', '17:00'),
    { ...ev('allday', WED, '00:00', '00:00'), start: { date: WED }, end: { date: THU } },
    ev('gone', WED, '08:00', '09:00', { status: 'cancelled' }),
    ev('free', WED, '08:00', '09:00', { transparency: 'transparent' }),
    ev('gym', WED, '08:00', '09:00', { calendarId: 'gym-cal' }),
  ], at(WED, '14:00'));
  assert.deepEqual(shifts(store), []);
});

test('a recorded shift that moves follows; one that goes is archived', () => {
  const store = makeStore();
  run(store, [ev('a', WED, '09:00', '13:00'), ev('b', WED, '07:00', '08:00')], at(WED, '14:00'));
  run(store, [ev('a', WED, '09:00', '11:00')], at(WED, '15:00'));
  assert.deepEqual(shifts(store).map((r) => [r.id, r.minutes]), [['work:a', 120]]);
  assert.equal(store.doc().calendar['work:b'].status, 'archived');
});

test('shifts before startedOn are never recorded', () => {
  const store = makeStore();
  run(store, [], at(THU, '10:00'), THU);
  run(store, [ev('old', WED, '09:00', '13:00'), ev('new', THU, '09:00', '10:00')], at(THU, '11:00'), THU);
  assert.deepEqual(shifts(store).map((r) => r.id), ['work:new']);
});

test('no Work calendar: nothing recorded, no error', () => {
  const store = makeStore();
  assert.equal(recordShifts(store, [ev('a', WED, '09:00', '13:00')], { calendarId: null, today: WED, now: at(WED, '14:00') }), 0);
  assert.deepEqual(shifts(store), []);
});
