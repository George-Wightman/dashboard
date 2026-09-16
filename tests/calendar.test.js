import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, emptyDoc } from '../js/doc.js';
import {
  CALENDAR_DEFAULTS, checkConfigField, readPlannerConfig, dayRecordId, dayRecord, plannerStatus,
  todaySlots, plannerNotes, visibleNotes, clockLabel, momentLabel, staleSince, timedOrder, plannerSummary,
} from '../js/calendar.js';
import { makeStore } from './helpers.js';

process.env.TZ = 'Europe/London';

const cal = (records) => ({ ...emptyDoc(), calendar: Object.fromEntries(records.map((r) => [r.id, { status: 'active', source: 'planner', ...r }])) });

test('the calendar map is part of the document', () => {
  assert.ok(MAPS.includes('calendar'));
  assert.deepEqual(emptyDoc().calendar, {});
});

test('readPlannerConfig: the defaults, good saved fields over them, a bad field kept at its default and named', () => {
  const plain = readPlannerConfig(emptyDoc());
  assert.deepEqual(plain.config, CALENDAR_DEFAULTS);
  assert.deepEqual(plain.problems, []);
  assert.notEqual(plain.config.hours, CALENDAR_DEFAULTS.hours, 'a copy, never the defaults themselves');
  const { config, problems } = readPlannerConfig(cal([{ id: 'config', hours: ['08:30', '18:00'], gapMinutes: 'lots' }]));
  assert.deepEqual(config.hours, ['08:30', '18:00']);
  assert.equal(config.gapMinutes, 15);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /gapMinutes should be a whole number from 0 to 60/);
});

test('checkConfigField: each setting checked, unknown ones refused by name', () => {
  assert.deepEqual(checkConfigField('hours', ['09:00', '17:30']), ['09:00', '17:30']);
  assert.throws(() => checkConfigField('hours', ['19:00', '09:00']), /the first earlier/);
  assert.throws(() => checkConfigField('hours', '9 to 5'), /two times like/);
  assert.equal(checkConfigField('firmUpHour', 21), 21);
  assert.throws(() => checkConfigField('days', 30), /days should be a whole number from 1 to 14/);
  assert.deepEqual(checkConfigField('areaCalendars', { ' Job search ': ' Application ' }), { 'Job search': 'Application' });
  assert.throws(() => checkConfigField('areaCalendars', ['Application']), /map each area to a calendar name/);
  assert.deepEqual(checkConfigField('habitEvents', [{ habit: 'Gym', calendar: 'Gym', title: 'Gym' }]), [{ habit: 'Gym', calendar: 'Gym', title: 'Gym' }]);
  assert.throws(() => checkConfigField('habitEvents', [{ habit: 'Gym' }]), /should be a list like/);
  assert.throws(() => checkConfigField('colour', 'red'), /The planner has no setting "colour" — settings: hours, /);
});

test('day records: one per weekday, read only when the day matches', () => {
  assert.equal(dayRecordId('2026-09-14'), 'day:1');
  assert.equal(dayRecordId('2026-09-20'), 'day:7');
  const doc = cal([{ id: 'day:2', day: '2026-09-15', blocks: [], skipped: [], missed: [], notes: ['Moved Gym to 09:30 (Learn Hebrew)'] }]);
  assert.equal(dayRecord(doc, '2026-09-15').day, '2026-09-15');
  assert.equal(dayRecord(doc, '2026-09-22'), null, "last week's Tuesday is not this Tuesday");
  assert.deepEqual(plannerNotes(doc, '2026-09-15'), ['Moved Gym to 09:30 (Learn Hebrew)']);
  assert.deepEqual(plannerNotes(doc, '2026-09-16'), []);
  assert.equal(plannerStatus(doc), null);
});

test("todaySlots: today's non-rough blocks by item; the later block wins for an item in two", () => {
  const b = (items, start, end, state) => ({ key: 'k', items, start, end, state, title: 't' });
  const doc = cal([{ id: 'day:2', day: '2026-09-15', skipped: [], missed: [], notes: [], blocks: [
    b(['a', 'b'], '2026-09-15T08:00:00.000Z', '2026-09-15T09:00:00.000Z', 'partial'),
    b(['b'], '2026-09-15T12:00:00.000Z', '2026-09-15T12:30:00.000Z', 'exact'),
    b(['c'], '2026-09-15T13:00:00.000Z', '2026-09-15T13:30:00.000Z', 'rough'),
  ] }]);
  const slots = todaySlots(doc, '2026-09-15');
  assert.deepEqual([...slots.keys()], ['a', 'b']);
  assert.equal(slots.get('b').start, '2026-09-15T12:00:00.000Z');
  assert.equal(clockLabel(slots.get('b').start), '13:00');
});

test('timedOrder: suggestions, then timed rows by time, then the rest in their order, done last', () => {
  const r = (id, extra = {}) => ({ item: { id }, suggested: false, done: false, ...extra });
  const rows = [r('s', { suggested: true }), r('u1'), r('t2'), r('t1'), r('u2'), r('d', { done: true })];
  const slots = new Map([['t1', { start: '2026-09-15T08:00:00.000Z' }], ['t2', { start: '2026-09-15T09:00:00.000Z' }], ['d', { start: '2026-09-15T07:00:00.000Z' }]]);
  assert.deepEqual(timedOrder(rows, slots).map((x) => x.item.id), ['s', 't1', 't2', 'u1', 'u2', 'd']);
});

test('visibleNotes: newest first, at most two, without the ones hidden today', () => {
  assert.deepEqual(visibleNotes(['a', 'b', 'c'], [], '2026-09-15'), ['c', 'b']);
  assert.deepEqual(visibleNotes(['a', 'b', 'c'], ['2026-09-15|c', '2026-09-14|b'], '2026-09-15'), ['b', 'a']);
});

test('staleSince and plannerSummary: quiet while it runs, a warning once it stops, nothing when paused', () => {
  const now = new Date(2026, 8, 15, 14, 0);
  const at = (h, m) => new Date(2026, 8, 15, h, m).toISOString();
  assert.equal(staleSince(emptyDoc(), now), null, 'never run: no warning');
  assert.equal(staleSince(cal([{ id: 'status', lastRun: at(13, 10), lastError: null, version: 'b1' }]), now), null);
  assert.equal(staleSince(cal([{ id: 'status', lastRun: at(12, 0), lastError: null, version: 'b1' }]), now), '12:00');
  assert.equal(staleSince(cal([{ id: 'status', lastRun: at(12, 0), paused: true }]), now), null);
  assert.equal(momentLabel(new Date(2026, 8, 14, 12, 0).toISOString(), now), 'Mon 14 Sep, 12:00');
  assert.deepEqual(plannerSummary(emptyDoc(), now).summary, 'not set up');
  const s = plannerSummary(cal([{ id: 'status', lastRun: at(13, 50), lastError: 'insert "Gym": Rate Limit Exceeded', version: 'b1' }]), now);
  assert.equal(s.summary, 'last ran 13:50');
  assert.equal(s.lines[0], 'Plans 09:00–19:00, 7 days ahead: today and tomorrow exact, rough after that.');
  assert.ok(s.lines.includes('Last problem: insert "Gym": Rate Limit Exceeded'));
});

test('putCalendar: creates, leaves unchanged content alone, replaces changed content', () => {
  const s = makeStore();
  const one = s.putCalendar('status', { lastRun: '2026-09-16T08:00:00.000Z', lastError: null });
  assert.equal(one.changed, true);
  assert.equal(s.doc().calendar.status.source, 'planner');
  const stamp = s.doc().calendar.status.updated;
  assert.equal(s.putCalendar('status', { lastRun: '2026-09-16T08:00:00.000Z', lastError: null }).changed, false);
  assert.equal(s.doc().calendar.status.updated, stamp);
  const two = s.putCalendar('config', { hours: ['08:00', '18:00'] }, 'claude');
  assert.equal(two.rec.source, 'claude');
  assert.equal(s.putCalendar('status', { lastRun: '2026-09-16T09:00:00.000Z', lastError: null }).changed, true);
  assert.equal(s.doc().calendar.status.lastRun, '2026-09-16T09:00:00.000Z');
});

test('items take a length and, for a task, a time — checked', () => {
  const s = makeStore();
  assert.equal(s.addItem({ type: 'task', title: 'Draft', minutes: 120, time: '09:30' }).minutes, 120);
  assert.equal(s.addItem({ type: 'habit', title: 'Read', minutes: 20 }).minutes, 20);
  assert.throws(() => s.addItem({ type: 'task', title: 'x', minutes: 3 }), /A length should be from 5 minutes to 12 hours/);
  assert.throws(() => s.addItem({ type: 'task', title: 'x', time: '25:00' }), /A time should look like 14:00/);
  assert.equal(s.addItem({ type: 'habit', title: 'x', time: '09:00' }).time, '09:00');
  assert.throws(() => s.addItem({ type: 'quota', title: 'x', target: 3, time: '09:00' }), /A weekly target has no time/);
  assert.equal(s.addItem({ type: 'task', title: 'plain' }).minutes, undefined);
});
