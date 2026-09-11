import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  logicalDay, addDays, daysBetween, weekday, weekStart, dayOfMonth, daysInMonth,
  shortWeekday, shortDate, longDate, carryLabel,
} from '../js/dates.js';

test('logicalDay: before 04:00 counts as the previous day', () => {
  assert.equal(logicalDay(new Date(2026, 8, 11, 3, 59)), '2026-09-10');
  assert.equal(logicalDay(new Date(2026, 8, 11, 4, 0)), '2026-09-11');
});

test('logicalDay: dayStartHour 0 is plain midnight', () => {
  assert.equal(logicalDay(new Date(2026, 8, 11, 0, 30), 0), '2026-09-11');
});

test('logicalDay: crosses month and year', () => {
  assert.equal(logicalDay(new Date(2027, 0, 1, 2, 0)), '2026-12-31');
});

test('logicalDay: counted in wall-clock time, so a DST boundary cannot shift the day (F10)', () => {
  assert.equal(logicalDay(new Date(2026, 2, 29, 4, 30)), '2026-03-29'); // UK spring-forward Sunday
});

test('addDays and daysBetween', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-03-28', 2), '2026-03-30'); // across the UK clock change
  assert.equal(daysBetween('2026-09-03', '2026-09-10'), 7);
  assert.equal(daysBetween('2026-09-10', '2026-09-03'), -7);
});

test('weekday and weekStart (Mon = 1)', () => {
  assert.equal(weekday('2026-09-07'), 1);
  assert.equal(weekday('2026-09-10'), 4);
  assert.equal(weekday('2026-09-13'), 7);
  assert.equal(weekStart('2026-09-10'), '2026-09-07');
  assert.equal(weekStart('2026-09-13'), '2026-09-07');
  assert.equal(weekStart('2026-09-07'), '2026-09-07');
});

test('month helpers', () => {
  assert.equal(dayOfMonth('2026-09-10'), 10);
  assert.equal(daysInMonth('2026-02-10'), 28);
  assert.equal(daysInMonth('2028-02-01'), 29);
  assert.equal(daysInMonth('2026-09-30'), 30);
});

test('labels', () => {
  assert.equal(shortWeekday('2026-09-08'), 'Tue');
  assert.equal(shortDate('2026-09-03'), '3 Sep');
  assert.equal(longDate('2026-09-10'), 'Thursday 10 September');
});

test('carryLabel: weekday within 6 days, date beyond', () => {
  assert.equal(carryLabel('2026-09-08', '2026-09-10'), 'from Tue');
  assert.equal(carryLabel('2026-09-04', '2026-09-10'), 'from Fri');
  assert.equal(carryLabel('2026-09-03', '2026-09-10'), 'from 3 Sep');
});
