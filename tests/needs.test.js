import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsCopy, needsEntries } from '../js/needs.js';
import { emptyDoc } from '../js/doc.js';

const entry = (item, state) => ({ item, state, day: item.date, bookings: [] });

test('a moved time says both times and offers both, Calendar first', () => {
  const doc = emptyDoc();
  const item = { id: 'g', title: 'Gym · Lower A', date: '2026-10-20', time: '17:30' };
  doc.calendar['conflict:g'] = { open: true, changes: { time: '18:30' }, calendarValid: true };
  assert.deepEqual(needsCopy(entry(item, 'conflict'), doc), {
    text: 'You moved Gym · Lower A to 18:30 in Google Calendar, but the dashboard still has 17:30.',
    choices: [{ choice: 'calendar', label: 'Keep 18:30' }, { choice: 'dashboard', label: 'Back to 17:30' }],
  });
});

test("an invalid Calendar edit only offers the dashboard's", () => {
  const doc = emptyDoc();
  doc.calendar['conflict:g'] = { open: true, changes: { time: 'invalid' }, calendarValid: false };
  const c = needsCopy(entry({ id: 'g', title: 'Gym', date: '2026-10-20', time: '17:30' }, 'conflict'), doc);
  assert.deepEqual(c.choices, [{ choice: 'dashboard', label: "Keep the dashboard's" }]);
});

test('any other conflict offers both sides by name', () => {
  const doc = emptyDoc();
  doc.calendar['conflict:g'] = { open: true, changes: { title: 'Gym B' }, calendarValid: true };
  const c = needsCopy(entry({ id: 'g', title: 'Gym', date: '2026-10-20' }, 'conflict'), doc);
  assert.equal(c.text, 'Gym was changed in Google Calendar and here.');
  assert.deepEqual(c.choices.map((x) => x.label), ["Keep Calendar's", "Keep the dashboard's"]);
});

test('taken out of Calendar, and waiting for a slot, have no buttons', () => {
  const doc = emptyDoc();
  assert.deepEqual(needsCopy(entry({ id: 'a', title: 'Call the GP', date: '2026-10-21', scheduleHold: true }, 'unscheduled'), doc).choices, []);
  assert.match(needsCopy(entry({ id: 'b', title: 'Waist', date: '2026-10-22' }, 'unscheduled'), doc).text, /^Waist · Thu: waiting for a calendar slot\.$/);
});

test('needsEntries is empty on an empty dashboard', () => {
  assert.deepEqual(needsEntries(emptyDoc(), '2026-10-20'), []);
});

test('final review: a block moved to another day says the day, not the same time twice', () => {
  const doc = emptyDoc();
  const item = { id: 'g', title: 'Gym', date: '2026-10-20', time: '17:30' };
  doc.calendar['conflict:g'] = { open: true, changes: { date: '2026-10-21', time: '17:30' }, calendarValid: true };
  assert.deepEqual(needsCopy(entry(item, 'conflict'), doc), {
    text: 'You moved Gym to Wed in Google Calendar, but the dashboard still has Tue.',
    choices: [{ choice: 'calendar', label: 'Keep Wed' }, { choice: 'dashboard', label: 'Back to Tue' }],
  });
  doc.calendar['conflict:g'].changes = { date: '2026-10-21', time: '18:30' };
  assert.equal(needsCopy(entry(item, 'conflict'), doc).text, 'You moved Gym to Wed 18:30 in Google Calendar, but the dashboard still has Tue 17:30.');
  doc.calendar['conflict:g'].changes = { date: '2026-10-20', time: '17:30' };
  assert.deepEqual(needsCopy(entry(item, 'conflict'), doc).choices.map((c) => c.label), ["Keep Calendar's", "Keep the dashboard's"]);
});
