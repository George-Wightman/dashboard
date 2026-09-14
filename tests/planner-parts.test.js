import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at, localDay, iso, MINUTE } from '../planner/time.js';
import { P, normEvent, atText, movedByGeorge, habitPinned, linkedIds, roughColor } from '../planner/events.js';
import { norm, resolveCalendars, calendarFor, habitLinks } from '../planner/calendars.js';
import { QUARTER, ceilQuarter, fits, earliestFit, nearestFit } from '../planner/place.js';
import { CALENDAR_DEFAULTS } from '../js/calendar.js';
import { fixture } from './helpers.js';

process.env.TZ = 'Europe/London';

const COLORS = { 1: '#a4bdfc', 2: '#7ae7bf', 3: '#dbadff', 4: '#ff887c', 5: '#fbd75b', 6: '#ffb878', 7: '#46d6db', 8: '#e1e1e1', 9: '#5484ed', 10: '#51b749', 11: '#dc2127' };
const LIST = [
  { id: 'main', name: 'Tasks', primary: true, backgroundColor: '#9fe1e7' },
  { id: 'app', name: 'Application ', backgroundColor: '#f83a22' },
  { id: 'gym', name: 'Gym ', backgroundColor: '#7bd148' },
  { id: 'uni', name: 'University of York - Personal timetable: George Wightman', backgroundColor: '#cccccc' },
  { id: 'hol', name: 'Holidays in United Kingdom', backgroundColor: '#16a765' },
];

test('local times, across the clocks going back', () => {
  assert.equal(at('2026-10-24', '09:00').toISOString(), '2026-10-24T08:00:00.000Z');
  assert.equal(at('2026-10-25', '09:00').toISOString(), '2026-10-25T09:00:00.000Z');
  assert.equal(localDay(new Date('2026-09-15T23:30:00.000Z')), '2026-09-16');
  assert.equal(iso(at('2026-09-15', '13:15').getTime()), '2026-09-15T12:15:00.000Z');
  assert.equal(MINUTE, 60000);
});

test('normEvent: what the planner needs from a Google event', () => {
  const e = normEvent({
    id: 'e1', summary: 'Signify', description: 'Shift', start: { dateTime: '2026-09-15T14:00:00+01:00' }, end: { dateTime: '2026-09-15T16:00:00+01:00' },
    attendees: [{ email: 'me', self: true }, { email: 'boss' }], transparency: 'transparent', reminders: { useDefault: false },
    recurringEventId: 'r', originalStartTime: { dateTime: '2026-09-15T13:00:00+01:00' }, colorId: '4',
    extendedProperties: { private: { dash: '1', dashKey: 'k' } },
  }, 'work');
  assert.equal(e.calendarId, 'work');
  assert.equal(e.title, 'Signify');
  assert.equal(e.start.toISOString(), '2026-09-15T13:00:00.000Z');
  assert.equal(e.others, 1);
  assert.equal(e.free, true);
  assert.equal(e.mine, true);
  assert.equal(e.useDefault, false);
  assert.equal(e.originalStart.toISOString(), '2026-09-15T12:00:00.000Z');
  const allDay = normEvent({ id: 'e2', summary: 'Holiday', start: { date: '2026-09-15' }, end: { date: '2026-09-16' } }, 'hol');
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.start, null);
  assert.equal(allDay.mine, false);
  assert.equal(allDay.useDefault, true);
});

test('movedByGeorge and habitPinned: where the planner put it versus where it is', () => {
  const s = at('2026-09-15', '13:15');
  const e = at('2026-09-15', '13:45');
  const block = (props, start = s, end = e) => normEvent({ id: 'b', start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() }, extendedProperties: { private: props } }, 'app');
  assert.equal(movedByGeorge(block({ dash: '1', [P.at]: atText(s, e) })), false);
  assert.equal(movedByGeorge(block({ dash: '1', [P.at]: atText(s, e) }, at('2026-09-15', '17:30'), at('2026-09-15', '18:00'))), true);
  assert.equal(movedByGeorge(block({ dash: '1', [P.at]: atText(s, e), [P.pin]: '1' })), true);
  const inst = (start, original, props = {}) => normEvent({ id: 'h', start: { dateTime: start.toISOString() }, end: { dateTime: new Date(start.getTime() + 45 * MINUTE).toISOString() }, originalStartTime: { dateTime: original.toISOString() }, extendedProperties: { private: props } }, 'main');
  assert.equal(habitPinned(inst(at('2026-09-15', '09:30'), at('2026-09-15', '09:30'))), false);
  assert.equal(habitPinned(inst(at('2026-09-15', '11:45'), at('2026-09-15', '09:30'))), true, 'moved by hand from its series time');
  const moved = at('2026-09-15', '10:30');
  assert.equal(habitPinned(inst(moved, at('2026-09-15', '09:30'), { [P.at]: atText(moved, new Date(moved.getTime() + 45 * MINUTE)) })), false, 'moved by the planner');
});

test('linkedIds and roughColor', () => {
  assert.deepEqual(linkedIds('Prep\ndashboard:a1b2c3d4\ndashboard:task-chase-gss'), ['a1b2c3d4', 'task-chase-gss']);
  assert.deepEqual(linkedIds(''), []);
  assert.equal(roughColor('#f83a22', COLORS), '4', 'red calendar → Tomato → Flamingo');
  assert.equal(roughColor('#4986e7', COLORS), '1', 'blue → Blueberry → Lavender');
  assert.equal(roughColor('#a4bdfc', COLORS), '8', 'already a light colour → Graphite');
  assert.equal(roughColor('not a colour', COLORS), '8');
});

test('resolveCalendars: ignored by the start of the name, found by name ignoring case and spaces', () => {
  const { watched, find } = resolveCalendars(LIST, CALENDAR_DEFAULTS);
  assert.deepEqual(watched.map((c) => c.id), ['main', 'app', 'gym']);
  assert.equal(find('main').id, 'main');
  assert.equal(find('gym').id, 'gym');
  assert.equal(find('Application').id, 'app');
  assert.equal(find('Challenger'), null);
  assert.equal(norm('  Job Search '), 'job search');
});

test('calendarFor: by area, the default for the rest, the main calendar with a note when a name is missing', () => {
  const { find } = resolveCalendars(LIST, CALENDAR_DEFAULTS);
  const problems = new Set();
  assert.equal(calendarFor('job search', CALENDAR_DEFAULTS, find, problems).id, 'app');
  assert.equal(calendarFor('Health', CALENDAR_DEFAULTS, find, problems).id, 'gym');
  assert.equal(calendarFor('', CALENDAR_DEFAULTS, find, problems).id, 'main');
  assert.equal(problems.size, 0);
  assert.equal(calendarFor('Challenger', CALENDAR_DEFAULTS, find, problems).id, 'main');
  assert.deepEqual([...problems], ['Can\'t find the "Challenger" calendar — blocks for Challenger went to your main calendar']);
});

test('habitLinks: a habit by the start of its title or its id; ambiguous or missing ones noted', () => {
  const { find } = resolveCalendars(LIST, CALENDAR_DEFAULTS);
  const doc = fixture({ items: [
    { id: 'heb', type: 'habit', title: 'Hebrew - app plus Duolingo', area: 'Hebrew' },
    { id: 'gym1', type: 'habit', title: 'Gym', area: 'Health' },
    { id: 'gym2', type: 'habit', title: 'Gym stretches', area: 'Health' },
  ] });
  const problems = new Set();
  const links = habitLinks(doc, CALENDAR_DEFAULTS, find, problems);
  assert.deepEqual(links, [{ habitId: 'heb', calendarId: 'main', title: 'Learn Hebrew', area: 'Hebrew' }]);
  assert.match([...problems][0], /can't tell which habit "Gym" is \(more than one match\)/);
  const byId = habitLinks(doc, { ...CALENDAR_DEFAULTS, habitEvents: [{ habit: 'gym1', calendar: 'Gym', title: 'Gym' }] }, find, new Set());
  assert.deepEqual(byId.map((l) => l.habitId), ['gym1']);
});

test('finding time: quarter hours, the gap, the window, the nearest start', () => {
  const t = (hhmm) => at('2026-09-15', hhmm).getTime();
  assert.equal(ceilQuarter(t('09:01')), t('09:15'));
  assert.equal(ceilQuarter(t('09:15')), t('09:15'));
  assert.equal(QUARTER, 15 * MINUTE);
  const busy = [{ start: t('09:30'), end: t('10:15') }, { start: t('11:00'), end: t('13:00') }];
  const gap = 15 * MINUTE;
  assert.equal(fits(t('10:30'), t('10:45'), busy, gap), true);
  assert.equal(fits(t('10:30'), t('11:00'), busy, gap), false);
  const win = { start: t('09:00'), end: t('19:00') };
  assert.equal(earliestFit(60 * MINUTE, win, busy, gap), t('13:15'));
  assert.equal(earliestFit(15 * MINUTE, win, busy, gap), t('09:00'), 'ends 15 minutes clear of 09:30');
  assert.equal(earliestFit(11 * 60 * MINUTE, win, busy, gap), null);
  assert.equal(nearestFit(120 * MINUTE, t('11:00'), win, [{ start: t('11:45'), end: t('12:30') }], gap), t('09:30'));
  assert.equal(nearestFit(30 * MINUTE, t('12:00'), win, [{ start: t('11:00'), end: t('13:00') }], 0), t('13:00'), 'the nearer one');
  assert.equal(nearestFit(30 * MINUTE, t('11:45'), win, [{ start: t('11:00'), end: t('13:00') }], 0), t('10:30'), 'earlier on a tie');
});
