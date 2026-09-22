// A series — tasks that only make sense in order, like Role play 1 to 7 — is booked in order: a
// later one never starts before an earlier one has ended, and when an earlier one slips a day the
// later ones go with it. On 22 September Role play 1 couldn't fit on Wednesday, was carried to
// Thursday, and landed after Role plays 2 and 3.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at } from '../planner/time.js';
import { clockLabel } from '../js/calendar.js';
import { fixture, done } from './helpers.js';
import { FakeCalendar, ev, step, WORK } from './planner-fakes.js';
import { seriesOf, inSeriesOrder } from '../planner/series.js';

process.env.TZ = 'Europe/London';

const TUE = '2026-09-15';
const WED = '2026-09-16';
const THU = '2026-09-17';
const now = (day, hhmm) => at(day, hhmm);
const rp = (n, date, minutes, extra = {}) => ({
  id: `rp${n}`, type: 'task', title: `Role play ${n}`, area: 'Assessment centre', date, minutes,
  order: n, series: 'Role plays', ...extra,
});
const span = (e) => `${clockLabel(e.start.dateTime)}–${clockLabel(e.end.dateTime)}`;
const booked = (cal) => cal.mine().map((e) => `${e.start.dateTime.slice(0, 10)} ${span(e)} ${e.summary.replace(/^~ /, '')}`).sort();
const run = (items, events = [], extra = {}) => {
  const doc = fixture({ items, ...extra });
  const cal = new FakeCalendar(events);
  return { r: step(cal, doc, now(TUE, '08:00')), cal };
};

test('seriesOf: trimmed and case-folded; no series, no key', () => {
  assert.equal(seriesOf({ type: 'task', series: '  Role Plays ' }), 'role plays');
  assert.equal(seriesOf({ type: 'task' }), null);
  assert.equal(seriesOf({ type: 'task', series: '   ' }), null);
  assert.equal(seriesOf({ type: 'habit', series: 'x' }), null);
});

test('inSeriesOrder: series members swap into order in the places they hold; the rest stay put', () => {
  const list = ['b3', 'x', 'b1', 'y', 'b2'];
  const rank = { b1: 1, b2: 2, b3: 3 };
  const out = inSeriesOrder(list, (k) => (k in rank ? { series: 's', rank: [rank[k], 0] } : null));
  assert.deepEqual(out, ['b1', 'x', 'b2', 'y', 'b3']);
});

test('the same day: the earlier one goes first, even when the later one is bigger', () => {
  const { cal } = run([rp(1, WED, 60), rp(2, WED, 150)]);
  assert.deepEqual(booked(cal), [
    '2026-09-16 09:00–10:00 Role play 1',
    '2026-09-16 10:15–12:45 Role play 2',
  ]);
});

test("room for one: the earlier one takes it, and the later one waits a day", () => {
  // Wednesday 09:00–14:45 is taken, leaving 15:00–19:00: room for either, not both.
  const { cal, r } = run([rp(1, WED, 120), rp(2, WED, 150)], [ev(WORK, 'Shift', WED, '09:00', '14:45')]);
  assert.deepEqual(booked(cal), [
    '2026-09-16 15:00–17:00 Role play 1',
    '2026-09-17 09:00–11:30 Role play 2',
  ]);
  const notes = Object.values(r.days).flatMap((d) => d.notes);
  assert.ok(notes.some((n) => /Role play 2.*Thu/.test(n)), notes.join('\n'));
});

test('an earlier one that slips takes the later ones with it, even ones that would have fitted', () => {
  // Wednesday has 90 minutes free: not enough for Role play 1, enough for Role play 2.
  const { cal } = run([rp(1, WED, 150), rp(2, WED, 60)], [ev(WORK, 'Shift', WED, '09:00', '17:15')]);
  assert.deepEqual(booked(cal), [
    '2026-09-17 09:00–11:30 Role play 1',
    '2026-09-17 11:45–12:45 Role play 2',
  ]);
});

test('a later one dated before an earlier one waits for it', () => {
  const { cal } = run([rp(1, THU, 60), rp(2, WED, 60)]);
  assert.deepEqual(booked(cal), [
    '2026-09-17 09:00–10:00 Role play 1',
    '2026-09-17 10:15–11:15 Role play 2',
  ]);
});

test('a pinned earlier one: the later one starts after it ends', () => {
  const { cal } = run([rp(1, WED, 60, { time: '14:00' }), rp(2, WED, 60)]);
  assert.deepEqual(booked(cal), [
    '2026-09-16 14:00–15:00 Role play 1',
    '2026-09-16 15:15–16:15 Role play 2',
  ]);
});

test('ticked ones hold nothing back', () => {
  const { cal } = run([rp(1, TUE, 60), rp(2, WED, 60)], [], { logs: [done('rp1', TUE)] });
  assert.deepEqual(booked(cal), ['2026-09-16 09:00–10:00 Role play 2']);
});

test("22 September: pins that leave the first one nowhere to go are named, not silently reordered", () => {
  // Role plays 2 and 3 pinned into Wednesday; Role play 1, unpinned, fits neither gap.
  const { r } = run([rp(1, WED, 150), rp(2, WED, 150, { time: '09:00' }), rp(3, WED, 150, { time: '14:00' })]);
  const notes = Object.values(r.days).flatMap((d) => d.notes);
  assert.ok(notes.some((n) => /Role play 1.*after.*Role play 2/.test(n)), notes.join('\n'));
});

test('tasks without a series are packed exactly as before', () => {
  const { cal } = run([rp(1, WED, 60, { series: undefined }), rp(2, WED, 150, { series: undefined })]);
  assert.deepEqual(booked(cal), [
    '2026-09-16 09:00–11:30 Role play 2',
    '2026-09-16 11:45–12:45 Role play 1',
  ]);
});
