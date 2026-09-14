import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockTitle } from '../planner/plan.js';
import { at } from '../planner/time.js';
import { clockLabel } from '../js/calendar.js';
import { fixture, done } from './helpers.js';
import { FakeCalendar, ev, step, MAIN, APP, GYM, WORK, FAMILY } from './planner-fakes.js';

process.env.TZ = 'Europe/London';

const TUE = '2026-09-15';
const WED = '2026-09-16';
const THU = '2026-09-17';
const now = (day, hhmm) => at(day, hhmm);
const task = (id, title, area, date, extra = {}) => ({ id, type: 'task', title, area, date, order: 1, ...extra });
const instance = (calendarId, title, day, from, to, series, originalFrom = from) =>
  ev(calendarId, title, day, from, to, { recurringEventId: series, originalStartTime: { dateTime: at(day, originalFrom).toISOString() } });
const span = (e) => `${clockLabel(e.start.dateTime)}–${clockLabel(e.end.dateTime)}`;
const inserts = (r) => r.actions.filter((a) => a.op === 'insert');
const summaries = (cal) => cal.mine().map((e) => `${e.start.dateTime.slice(0, 10)} ${span(e)} ${e.summary}`).sort();

// Tuesday 15 September: Hebrew and Gym on Tuesday and Wednesday, a Signify shift on Tuesday, a
// family day on a calendar the planner ignores.
function tuesday() {
  const doc = fixture({ items: [
    { id: 'hebrew', type: 'habit', title: 'Hebrew - app plus Duolingo', area: 'Hebrew', repeat: { kind: 'daily' }, order: 1 },
    { id: 'gym', type: 'habit', title: 'Gym', area: 'Health', repeat: { kind: 'perWeek', n: 5 }, order: 2 },
    task('chase', 'Chase the GSS outcome', 'Job search', TUE),
    task('dayout', 'Write the day out', 'Assessment centre', TUE, { minutes: 60 }),
    task('who', 'Trace the WHO figure', 'Job search', WED),
    task('pharma', 'Trace the pharma figure', 'Job search', WED),
    task('natcen', 'Read the NatCen pack', 'Job search', THU),
  ] });
  const cal = new FakeCalendar([
    instance(MAIN, 'Learn Hebrew', TUE, '09:30', '10:15', 'heb'),
    instance(MAIN, 'Learn Hebrew', WED, '09:30', '10:15', 'heb'),
    instance(GYM, 'Gym', TUE, '11:00', '13:00', 'gym'),
    instance(GYM, 'Gym', WED, '11:00', '13:00', 'gym'),
    ev(WORK, 'Signify', TUE, '14:00', '16:00'),
    ev(FAMILY, 'Family day', TUE, '09:00', '19:00'),
  ]);
  return { doc, cal };
}

test('blockTitle', () => {
  assert.equal(blockTitle('Job search ×2', 'exact'), 'Job search ×2');
  assert.equal(blockTitle('Job search ×2', 'rough'), '~ Job search ×2');
  assert.equal(blockTitle('Job search ×2', 'done'), '✓ Job search ×2');
  assert.equal(blockTitle('Job search ×2', 'partial', 1, 2), 'Job search ×2 · 1 of 2 done');
});

test('first run: blocks by area around fixed events, exact today and tomorrow, rough after', () => {
  const { doc, cal } = tuesday();
  const r = step(cal, doc, now(TUE, '08:00'));
  assert.equal(inserts(r).length, 4);
  assert.ok(inserts(r).every((a) => a.calendarId === APP));
  assert.deepEqual(summaries(cal), [
    '2026-09-15 13:15–13:45 Chase the GSS outcome',
    '2026-09-15 16:15–17:15 Write the day out',
    '2026-09-16 13:15–14:15 Job search ×2',
    '2026-09-17 09:00–09:30 ~ Read the NatCen pack',
  ]);
  const rough = cal.byTitle('~ Read the NatCen pack');
  assert.equal(rough.colorId, '4');
  assert.deepEqual(rough.reminders, { useDefault: false, overrides: [] });
  const exact = cal.byTitle('Job search ×2');
  assert.equal(exact.colorId, undefined);
  assert.equal(exact.description, 'dashboard:pharma\ndashboard:who\nPlanned from your dashboard. Move it and it stays where you put it.', 'same order, so by id');
  assert.equal(exact.extendedProperties.private.dashState, 'exact');
  assert.equal(r.days[TUE].blocks.length, 2);
  assert.ok(r.days[TUE].blocks.every((b) => b.eventId));
});

test('running again changes nothing', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  const again = step(cal, doc, now(TUE, '08:00'), first.days);
  assert.deepEqual(again.actions, []);
});

test('a shift on top of a block moves it, and only it, with a note', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  cal.add(ev(WORK, 'Signify', WED, '13:00', '15:00'));
  const r = step(cal, doc, now(TUE, '08:30'), first.days);
  assert.deepEqual(r.actions.map((a) => a.op), ['patch']);
  assert.equal(span(cal.byTitle('Job search ×2')), '15:15–16:15');
  assert.ok(r.days[TUE].notes.includes('Moved Job search ×2 on Wed to 15:15 (Signify)'));
});

test('a block George moves stays where he put it', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  const id = cal.byTitle('Write the day out').id;
  cal.move(id, TUE, '17:30', '18:30');
  const r = step(cal, doc, now(TUE, '08:30'), first.days);
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].eventId, id);
  assert.equal(cal.get(id).extendedProperties.private.dashPin, '1');
  assert.equal(span(cal.get(id)), '17:30–18:30');
  assert.deepEqual(step(cal, doc, now(TUE, '08:35'), r.days).actions, []);
});

test('ticked during its block: the block ends at the tick', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  const ticked = fixture({ items: Object.values(doc.items), logs: [done('chase', TUE, { at: at(TUE, '13:30').toISOString() })] });
  const r = step(cal, ticked, now(TUE, '13:40'), first.days);
  assert.equal(r.actions.length, 1);
  const e = cal.byTitle('✓ Chase the GSS outcome');
  assert.equal(span(e), '13:15–13:30');
  assert.equal(e.extendedProperties.private.dashState, 'done');
});

test('ticked before its block: the block moves to end at the tick', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  const ticked = fixture({ items: Object.values(doc.items), logs: [done('dayout', TUE, { at: at(TUE, '09:05').toISOString() })] });
  const r = step(cal, ticked, now(TUE, '09:10'), first.days);
  assert.equal(r.actions.length, 1);
  assert.equal(span(cal.byTitle('✓ Write the day out')), '08:05–09:05');
});

test('missed: the block goes and the task gets a new slot; ticked later, a record ends at the tick', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  const later = step(cal, doc, now(TUE, '14:00'), first.days);
  assert.deepEqual(later.actions.map((a) => a.op), ['delete', 'insert']);
  assert.equal(span(cal.byTitle('Chase the GSS outcome')), '17:30–18:00');
  assert.deepEqual(later.days[TUE].missed, [{ itemId: 'chase', minutes: 30 }]);
  const ticked = fixture({ items: Object.values(doc.items), logs: [done('chase', TUE, { at: at(TUE, '15:00').toISOString() })] });
  const r = step(cal, ticked, now(TUE, '15:05'), later.days);
  assert.equal(r.actions.length, 1);
  assert.equal(span(cal.byTitle('✓ Chase the GSS outcome')), '14:30–15:00');
  assert.deepEqual(r.days[TUE].missed, []);
});

test('part done when the block ends: the title says so and the rest gets a new slot', () => {
  const doc = fixture({ items: [task('pa', 'Email Sarah', 'Job search', TUE), task('pb', 'Update CV', 'Job search', TUE, { order: 2 })] });
  const cal = new FakeCalendar();
  const first = step(cal, doc, now(TUE, '08:00'));
  assert.equal(span(cal.byTitle('Job search ×2')), '09:00–10:00');
  const ticked = fixture({ items: Object.values(doc.items), logs: [done('pa', TUE, { at: at(TUE, '09:20').toISOString() })] });
  const r = step(cal, ticked, now(TUE, '10:05'), first.days);
  assert.equal(cal.byTitle('Job search ×2 · 1 of 2 done').extendedProperties.private.dashState, 'partial');
  const rest = cal.byTitle('Update CV');
  assert.equal(span(rest), '10:15–10:45');
  assert.equal(rest.extendedProperties.private.dashKey, `${TUE}|job search|1`);
  assert.equal(inserts(r).length, 1);
});

test('a block George deletes is not booked again that day', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  cal.remove(cal.byTitle('Job search ×2').id);
  const r = step(cal, doc, now(TUE, '08:30'), first.days);
  assert.deepEqual(r.actions, []);
  assert.deepEqual(r.days[WED].skipped, ['pharma', 'who']);
});

test('Hebrew and Gym: a session George placed stays; the other one moves off it', () => {
  const doc = fixture({ items: [
    { id: 'hebrew', type: 'habit', title: 'Hebrew - app plus Duolingo', area: 'Hebrew', repeat: { kind: 'daily' } },
    { id: 'gym', type: 'habit', title: 'Gym', area: 'Health', repeat: { kind: 'perWeek', n: 5 } },
  ] });
  const cal = new FakeCalendar([
    instance(MAIN, 'Learn Hebrew', TUE, '11:45', '12:30', 'heb', '09:30'),
    instance(GYM, 'Gym', TUE, '11:00', '13:00', 'gym'),
    ev(WORK, 'Signify', TUE, '14:00', '16:00'),
  ]);
  const r = step(cal, doc, now(TUE, '08:00'));
  assert.deepEqual(r.actions.map((a) => a.op), ['patch']);
  assert.equal(span(cal.byTitle('Gym')), '09:30–11:30');
  assert.equal(span(cal.byTitle('Learn Hebrew')), '11:45–12:30');
  assert.ok(r.days[TUE].notes.includes('Moved Gym to 09:30 (Learn Hebrew)'));
  assert.deepEqual(step(cal, doc, now(TUE, '08:10'), r.days).actions, []);
});

test('an event Claude booked for a task counts as its block', () => {
  const doc = fixture({ items: [task('task-chase-gss', 'Chase the GSS outcome', 'Job search', TUE)] });
  const cal = new FakeCalendar([ev(WORK, 'Call about GSS', TUE, '10:30', '11:00', { description: 'dashboard:task-cha' })]);
  assert.deepEqual(step(cal, doc, now(TUE, '08:00')).actions, []);
});

test('a task with a time is a fixed event: blocks go round it, and it gets a tick when done', () => {
  const doc = fixture({ items: [
    task('acday', 'ASSESSMENT CENTRE', 'Assessment centre', WED, { time: '10:30', minutes: 390 }),
    task('who', 'Trace the WHO figure', 'Job search', WED),
    task('pharma', 'Trace the pharma figure', 'Job search', WED),
  ] });
  const cal = new FakeCalendar();
  const first = step(cal, doc, now(TUE, '08:00'));
  const fixed = cal.byTitle('ASSESSMENT CENTRE');
  assert.equal(span(fixed), '10:30–17:00');
  assert.equal(fixed.calendarId, APP);
  assert.equal(fixed.extendedProperties.private.dashState, 'fixed');
  assert.equal(span(cal.byTitle('Job search ×2')), '09:00–10:00');
  const ticked = fixture({ items: Object.values(doc.items), logs: [done('acday', WED, { at: at(WED, '17:05').toISOString() })] });
  step(cal, ticked, now(WED, '18:00'), first.days);
  assert.equal(span(cal.byTitle('✓ ASSESSMENT CENTRE')), '10:30–17:00');
});

test('at 20:00 the day after tomorrow turns exact where it stands', () => {
  const doc = fixture({ items: [task('natcen', 'Read the NatCen pack', 'Job search', THU)] });
  const cal = new FakeCalendar();
  const first = step(cal, doc, now(TUE, '19:00'));
  const roughId = cal.byTitle('~ Read the NatCen pack').id;
  const r = step(cal, doc, now(TUE, '20:05'), first.days);
  assert.deepEqual(r.actions.map((a) => a.op), ['delete', 'insert']);
  assert.equal(cal.get(roughId), undefined);
  const exact = cal.byTitle('Read the NatCen pack');
  assert.equal(span(exact), '09:00–09:30');
  assert.equal(exact.colorId, undefined);
  assert.deepEqual(exact.reminders, { useDefault: true });
});

test("what doesn't fit moves to the next day, with a note", () => {
  const doc = fixture({ items: [task('who', 'Trace the WHO figure', 'Job search', WED), task('pharma', 'Trace the pharma figure', 'Job search', WED)] });
  const cal = new FakeCalendar([ev(WORK, 'Signify', WED, '09:00', '19:00')]);
  const r = step(cal, doc, now(TUE, '08:00'));
  assert.deepEqual(summaries(cal), ['2026-09-17 09:00–10:00 ~ Job search ×2']);
  assert.ok(r.days[TUE].notes.includes("Couldn't fit Job search ×2 on Wed — moved to Thu"));
});

test('the clocks going back: nine o\'clock is nine o\'clock on both sides', () => {
  const doc = fixture({ items: [task('d1', 'Before', '', '2026-10-24'), task('d2', 'After', '', '2026-10-25')] });
  const cal = new FakeCalendar();
  const r = step(cal, doc, at('2026-10-24', '08:00'));
  const starts = Object.fromEntries(inserts(r).map((a) => [a.body.summary, a.body.start.dateTime]));
  assert.deepEqual(starts, { Before: '2026-10-24T08:00:00.000Z', After: '2026-10-25T09:00:00.000Z' });
  assert.ok(inserts(r).every((a) => a.calendarId === MAIN));
});
