import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockTitle, blockBody } from '../planner/plan.js';
import { at } from '../planner/time.js';
import { clockLabel } from '../js/calendar.js';
import { fixture, done } from './helpers.js';
import { FakeCalendar, ev, allDayEv, step, MAIN, APP, GYM, WORK, FAMILY } from './planner-fakes.js';

process.env.TZ = 'Europe/London';

const MON = '2026-09-14';
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

test('first run: individually named tasks around fixed events, exact today and tomorrow, rough after', () => {
  const { doc, cal } = tuesday();
  const r = step(cal, doc, now(TUE, '08:00'));
  assert.equal(inserts(r).length, 5);
  assert.ok(inserts(r).every((a) => a.calendarId === APP));
  assert.deepEqual(summaries(cal), [
    '2026-09-15 13:15–13:45 Chase the GSS outcome',
    '2026-09-15 16:15–17:15 Write the day out',
    '2026-09-16 13:15–13:45 Trace the pharma figure',
    '2026-09-16 14:00–14:30 Trace the WHO figure',
    '2026-09-17 09:00–09:30 ~ Read the NatCen pack',
  ]);
  const rough = cal.byTitle('~ Read the NatCen pack');
  assert.equal(rough.colorId, '4');
  assert.deepEqual(rough.reminders, { useDefault: false, overrides: [] });
  const exact = cal.byTitle('Trace the pharma figure');
  assert.equal(exact.colorId, undefined);
  assert.match(exact.description, /dashboard:pharma/);
  assert.doesNotMatch(exact.description, /dashboard:who/);
  assert.match(exact.description, /Open task \/ mark complete:/);
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
  assert.deepEqual(r.actions.map((a) => a.op), ['patch', 'patch']);
  assert.equal(span(cal.byTitle('Trace the pharma figure')), '15:15–15:45');
  assert.equal(span(cal.byTitle('Trace the WHO figure')), '16:00–16:30');
  assert.ok(r.days[TUE].notes.includes('Moved Trace the pharma figure on Wed to 15:15 (Signify)'));
});

test('a booked block stays put when earlier time opens up', () => {
  // 22 Oct 2026: blocks slid earlier on nearly every run — cooking ended up at 08:45 — and George
  // couldn't trust anything to be where he'd last seen it. Once booked, a block only moves for a clash.
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  const gym = cal.all().find((e) => e.summary === 'Gym' && e.start.dateTime.startsWith(WED));
  cal.move(gym.id, WED, '15:00', '17:00');
  const r = step(cal, doc, now(TUE, '08:30'), first.days);
  assert.equal(span(cal.byTitle('Trace the pharma figure')), '13:15–13:45');
  assert.equal(span(cal.byTitle('Trace the WHO figure')), '14:00–14:30');
  assert.deepEqual(step(cal, doc, now(TUE, '08:40'), r.days).actions, []);
});

test('freed time is used when sliding is the only way the day fits its work', () => {
  const doc = fixture({ items: [
    task('a', 'Task A', 'Job search', WED),
    task('b', 'Task B', 'Job search', WED),
  ] });
  doc.calendar.config = { id: 'config', status: 'active', dayHours: { [WED]: ['09:00', '12:00'] } };
  const cal = new FakeCalendar([instance(GYM, 'Gym', WED, '09:00', '10:00', 'gym')]);
  const first = step(cal, doc, now(TUE, '08:00'));
  assert.equal(span(cal.byTitle('Task A')), '10:15–10:45');
  assert.equal(span(cal.byTitle('Task B')), '11:00–11:30');
  // The gym moves off and a 90-minute task arrives: with A and B where they are, it can't fit; slid
  // into the freed hour, all three do.
  cal.move(cal.all().find((e) => e.summary === 'Gym').id, WED, '15:00', '17:00');
  doc.items.c = { ...doc.items.a, id: 'c', title: 'Task C', minutes: 90 };
  step(cal, doc, now(TUE, '08:30'), first.days);
  assert.deepEqual(summaries(cal).filter((s) => s.includes('Task')), [
    '2026-09-16 09:00–09:30 Task A',
    '2026-09-16 09:45–10:15 Task B',
    '2026-09-16 10:30–12:00 Task C',
  ]);
});

test('a hole left behind a block never drags it later', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  cal.remove(cal.byTitle('Trace the WHO figure').id);
  const r = step(cal, doc, now(TUE, '08:30'), first.days);
  assert.equal(span(cal.byTitle('Trace the pharma figure')), '13:15–13:45');
  assert.deepEqual(r.days[WED].skipped, ['who']);
});

test('a short carried task no longer crowds out a long one the day had room for', () => {
  const doc = fixture({ items: [
    task('chase', 'Chase the GSS outcome', 'Job search', MON),
    task('dayout', 'Write the day out', 'Assessment centre', TUE, { minutes: 150 }),
  ] });
  const cal = new FakeCalendar([ev(WORK, 'Signify', TUE, '12:00', '19:00')]);
  const r = step(cal, doc, now(TUE, '08:00'));
  // Carried-first puts the 30-minute chase at 09:00 and leaves no run long enough for the
  // 150-minute one. Tuesday is worth more the other way round, so the other way round is what it gets.
  assert.equal(span(cal.byTitle('Write the day out')), '09:00–11:30');
  assert.ok(r.days[TUE].notes.includes("Couldn't fit Chase the GSS outcome — moved to Wed"));
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

// 27 Oct 2026: a block that ended unticked went at once and the task was booked again later, or the
// next day — when George just hadn't ticked yet. It now waits, pale, where it was, until the next
// day's hours begin.
test('over and unticked: the block stays where it was, pale, and nothing is booked again', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  const later = step(cal, doc, now(TUE, '14:00'), first.days);
  assert.deepEqual(later.actions.map((a) => a.op), ['patch']);
  const e = cal.byTitle('Chase the GSS outcome');
  assert.equal(span(e), '13:15–13:45');
  assert.equal(e.colorId, '4');
  assert.equal(e.extendedProperties.private.dashState, 'exact');
  assert.equal(cal.mine().filter((x) => x.summary.includes('Chase')).length, 1);
  assert.deepEqual(later.days[TUE].missed, []);
  assert.deepEqual(step(cal, doc, now(TUE, '14:10'), later.days).actions, []);
});

test('ticked that evening, after its block: it stays where it was booked', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  const later = step(cal, doc, now(TUE, '14:00'), first.days);
  const ticked = fixture({ items: Object.values(doc.items), logs: [done('chase', TUE, { at: at(TUE, '22:00').toISOString() })] });
  step(cal, ticked, now(TUE, '22:05'), later.days);
  assert.equal(span(cal.byTitle('✓ Chase the GSS outcome')), '13:15–13:45');
});

test('ticked by a run the watch recorded: the block goes to when he ran', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  const later = step(cal, doc, now(TUE, '14:00'), first.days);
  const ticked = fixture({ items: Object.values(doc.items), logs: [done('chase', TUE, { from: at(TUE, '18:00').toISOString(), at: at(TUE, '18:40').toISOString() })] });
  step(cal, ticked, now(TUE, '19:00'), later.days);
  assert.equal(span(cal.byTitle('✓ Chase the GSS outcome')), '18:00–18:40');
});

test('ticked the next morning before his hours: yesterday\'s block becomes the record', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  const later = step(cal, doc, now(TUE, '22:00'), first.days);
  const morning = step(cal, doc, now(WED, '07:00'), later.days);
  assert.equal(span(cal.byTitle('Chase the GSS outcome')), '13:15–13:45');
  assert.ok(!morning.actions.some((a) => a.op === 'delete' && a.eventId === cal.byTitle('Chase the GSS outcome').id));
  const ticked = fixture({ items: Object.values(doc.items), logs: [done('chase', WED, { at: at(WED, '07:30').toISOString() })] });
  step(cal, ticked, now(WED, '07:35'), morning.days);
  const e = cal.byTitle('✓ Chase the GSS outcome');
  assert.equal(e.start.dateTime.slice(0, 10), TUE);
  assert.equal(span(e), '13:15–13:45');
});

test('still unticked once the next day\'s hours begin: a miss, booked again; ticked for its day, back where it was', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  const later = step(cal, doc, now(TUE, '22:00'), first.days);
  const wed = step(cal, doc, now(WED, '09:30'), later.days);
  const missed = wed.days[TUE].missed;
  assert.deepEqual(missed.map((m) => m.itemId).sort(), ['chase', 'dayout']);
  const chase = missed.find((m) => m.itemId === 'chase');
  assert.equal(span({ start: { dateTime: chase.start }, end: { dateTime: chase.end } }), '13:15–13:45');
  const again = cal.byTitle('Chase the GSS outcome');
  assert.equal(again.start.dateTime.slice(0, 10), WED);
  // Ticked for Tuesday from Wednesday's back-a-day: the record goes back to Tuesday's booking.
  const ticked = fixture({ items: Object.values(doc.items), logs: [done('chase', TUE, { at: at(WED, '10:00').toISOString() })] });
  const r = step(cal, ticked, now(WED, '10:05'), wed.days);
  const e = cal.byTitle('✓ Chase the GSS outcome');
  assert.equal(e.start.dateTime.slice(0, 10), TUE);
  assert.equal(span(e), '13:15–13:45');
  assert.deepEqual(r.days[TUE].missed.map((m) => m.itemId), ['dayout']);
  assert.ok(!cal.mine().some((x) => x.summary.includes('Chase') && x.start.dateTime.startsWith(WED)));
  assert.deepEqual(step(cal, ticked, now(WED, '10:15'), r.days).actions, []);
});

test('part done when the block ends: the title says so and the rest gets a new slot', () => {
  const doc = fixture({ items: [task('pa', 'Email Sarah', 'Job search', TUE), task('pb', 'Update CV', 'Job search', TUE, { order: 2 })] });
  const cal = new FakeCalendar([{ calendarId: APP, ...blockBody({ key: `${TUE}|job search|0`, base: 'Job search ×2', title: 'Job search ×2', start: at(TUE, '09:00'), end: at(TUE, '10:00'), items: ['pa', 'pb'], state: 'exact' }) }]);
  const first = step(cal, doc, now(TUE, '09:01'));
  assert.equal(span(cal.byTitle('Job search ×2')), '09:00–10:00');
  const ticked = fixture({ items: Object.values(doc.items), logs: [done('pa', TUE, { at: at(TUE, '09:20').toISOString() })] });
  const r = step(cal, ticked, now(TUE, '10:05'), first.days);
  assert.equal(cal.byTitle('Job search ×2 · 1 of 2 done').extendedProperties.private.dashState, 'partial');
  const rest = cal.byTitle('Update CV');
  assert.equal(span(rest), '10:15–10:45');
  assert.equal(rest.extendedProperties.private.dashKey, 'task|pb|0');
  assert.equal(inserts(r).length, 1);
});

test('a block George deletes is not booked again that day', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  assert.equal(span(cal.byTitle('Trace the WHO figure')), '14:00–14:30');
  cal.remove(cal.byTitle('Trace the pharma figure').id);
  const r = step(cal, doc, now(TUE, '08:30'), first.days);
  assert.deepEqual(inserts(r), []);
  assert.deepEqual(r.days[WED].skipped, ['pharma']);
  assert.ok(cal.byTitle('Trace the WHO figure'));
  // What was behind it stays where it was: nothing needed the time it freed.
  assert.equal(span(cal.byTitle('Trace the WHO figure')), '14:00–14:30');
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
  assert.equal(span(cal.byTitle('Trace the pharma figure')), '09:00–09:30');
  assert.equal(span(cal.byTitle('Trace the WHO figure')), '09:45–10:15');
  const ticked = fixture({ items: Object.values(doc.items), logs: [done('acday', WED, { at: at(WED, '17:05').toISOString() })] });
  step(cal, ticked, now(WED, '18:00'), first.days);
  assert.equal(span(cal.byTitle('✓ ASSESSMENT CENTRE')), '10:30–17:00');
});

test('an area with hours of its own books only in them, even past the day\'s hours', () => {
  const doc = fixture({ items: [
    task('cook', 'Cook: chilli', 'Food', WED, { minutes: 60 }),
    task('who', 'Trace the WHO figure', 'Job search', WED),
  ] });
  doc.calendar.config = { id: 'config', status: 'active', areaHours: { food: ['18:30', '21:00'] } };
  const cal = new FakeCalendar();
  step(cal, doc, now(TUE, '08:00'));
  assert.deepEqual(summaries(cal), [
    '2026-09-16 09:00–09:30 Trace the WHO figure',
    '2026-09-16 18:30–19:30 Cook: chilli',
  ]);
});

test('a task with a time moved to a later day takes its block with it, even once the old one has passed', () => {
  // 22 Oct 2026: "Email James" was booked for Wednesday 19:00, missed, and moved to Friday from the
  // dashboard. Its Wednesday block was in the past, so it stayed there, and Friday got nothing.
  const doc = fixture({ items: [task('james', 'Email James', 'Job search', MON, { time: '19:00', minutes: 20 })] });
  const cal = new FakeCalendar();
  const first = step(cal, doc, now(MON, '08:00'));
  assert.deepEqual(summaries(cal), ['2026-09-14 19:00–19:20 Email James']);
  doc.items.james = { ...doc.items.james, date: WED, time: '17:00' };
  step(cal, doc, now(TUE, '08:00'), first.days);
  assert.deepEqual(summaries(cal), ['2026-09-16 17:00–17:20 Email James']);
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
  assert.deepEqual(summaries(cal), ['2026-09-17 09:00–09:30 ~ Trace the pharma figure', '2026-09-17 09:45–10:15 ~ Trace the WHO figure']);
  assert.ok(r.days[TUE].notes.includes("Couldn't fit Trace the pharma figure on Wed — moved to Thu"));
});

test('the clocks going back: nine o\'clock is nine o\'clock on both sides', () => {
  const doc = fixture({ items: [task('d1', 'Before', '', '2026-10-24'), task('d2', 'After', '', '2026-10-25')] });
  const cal = new FakeCalendar();
  const r = step(cal, doc, at('2026-10-24', '08:00'));
  const starts = Object.fromEntries(inserts(r).map((a) => [a.body.summary, a.body.start.dateTime]));
  assert.deepEqual(starts, { Before: '2026-10-24T08:00:00.000Z', After: '2026-10-25T09:00:00.000Z' });
  assert.ok(inserts(r).every((a) => a.calendarId === MAIN));
});

test('an all-day event George marked busy keeps the planner off that day', () => {
  const { doc, cal } = tuesday();
  cal.add(allDayEv(MAIN, 'No work', WED, THU));
  const r = step(cal, doc, now(TUE, '08:00'));
  assert.deepEqual(summaries(cal).filter((s) => s.startsWith(WED)), [], 'nothing booked on the day off');
  assert.ok(summaries(cal).some((s) => s.startsWith(TUE)), 'the rest of the week is untouched');
  assert.ok(inserts(r).length > 0);
});

test('an all-day event marked free is not a day off', () => {
  const { doc, cal } = tuesday();
  cal.add(allDayEv(MAIN, 'Payday', WED, THU, { transparency: 'transparent' }));
  step(cal, doc, now(TUE, '08:00'));
  assert.ok(summaries(cal).some((s) => s.startsWith(WED)), 'a free marker blocks nothing');
});

test('an all-day event on a calendar the planner ignores is not a day off', () => {
  const { doc, cal } = tuesday();
  cal.add(allDayEv(FAMILY, 'Grandma visiting', WED, THU));
  step(cal, doc, now(TUE, '08:00'));
  assert.ok(summaries(cal).some((s) => s.startsWith(WED)), 'an ignored calendar stays ignored');
});

test('an all-day event over several days holds all of them', () => {
  const { doc, cal } = tuesday();
  cal.add(allDayEv(MAIN, 'Away', WED, '2026-09-18'));
  step(cal, doc, now(TUE, '08:00'));
  const booked = summaries(cal);
  assert.deepEqual(booked.filter((s) => s.startsWith(WED)), []);
  assert.deepEqual(booked.filter((s) => s.startsWith(THU)), []);
});

test('a block that slipped to the next day does not let that day book a second one', () => {
  // A block the planner moved off its own day keeps the key it was made with, so `settle` used to
  // cover the day the *key* named rather than the day the block actually sits on. The day it landed
  // on never learned it was booked, and booked the same habit again.
  const doc = fixture({ items: [
    { id: 'reading', type: 'habit', title: 'Read ten pages', area: 'Reading', repeat: { kind: 'daily' }, minutes: 20, order: 1 },
  ] });
  const FRI = '2026-09-18';
  const SAT = '2026-09-19';
  // Made for Friday, dragged onto Saturday: dashAt still says Friday, so the planner treats it as
  // George's and leaves it where he put it.
  const slipped = ev(MAIN, '~ Read ten pages', SAT, '16:30', '16:50', {
    extendedProperties: { private: {
      dash: '1', dashKey: `${FRI}|reading|0`, dashItems: 'reading', dashTitle: 'Read ten pages', dashState: 'rough',
      dashAt: `${at(FRI, '16:30').toISOString()}/${at(FRI, '16:50').toISOString()}`,
    } },
  });
  const cal = new FakeCalendar([slipped]);
  step(cal, doc, now(TUE, '08:00'));
  const onSat = cal.mine().filter((e) => e.start.dateTime.startsWith(SAT) && /Read ten pages/.test(e.summary));
  assert.equal(onSat.length, 1, 'one reading block on the day it landed, not two');
});

test('a daily habit that will not fit is missed, not carried into the next day', () => {
  // Carrying is right for a task: it still needs doing. A habit that repeats daily already has an
  // instance tomorrow, so carrying booked two there and left today with none — which is how one
  // reading habit ended up twice on a Sunday and not at all on the Friday.
  const doc = fixture({ items: [
    { id: 'reading', type: 'habit', title: 'Read ten pages', area: 'Reading', repeat: { kind: 'daily' }, minutes: 20, order: 1 },
  ] });
  const cal = new FakeCalendar([ev(WORK, 'Signify all day', TUE, '09:00', '19:00')]);
  const r = step(cal, doc, now(TUE, '08:00'));
  const onWed = cal.mine().filter((e) => e.start.dateTime.startsWith(WED) && /Read ten pages/.test(e.summary));
  assert.equal(onWed.length, 1, "Wednesday gets its own instance and only its own");
  assert.equal(cal.mine().filter((e) => e.start.dateTime.startsWith(TUE)).length, 0, 'nothing fitted on Tuesday');
  assert.ok(r.days[TUE]?.notes?.some((n) => /Read ten pages/.test(n)), 'and it says so');
});

test('a task with a time that George has linked to his own event gets no event of its own', () => {
  const doc = fixture({ items: [task('visa-d', 'Research the Visa D', 'Admin', TUE, { time: '13:00', minutes: 75 })] });
  const cal = new FakeCalendar([ev(WORK, 'Visa D', TUE, '13:00', '14:15', { description: 'dashboard:visa-d' })]);
  assert.deepEqual(step(cal, doc, now(TUE, '08:00')).actions, []);
  // One the planner made before George linked his: taken away, his stays.
  const doc2 = fixture({ items: [task('visa-d', 'Research the Visa D', 'Admin', TUE, { time: '13:00', minutes: 75 })] });
  const cal2 = new FakeCalendar();
  step(cal2, doc2, now(TUE, '08:00'));
  assert.ok(cal2.byTitle('Research the Visa D'), 'booked while unlinked');
  cal2.add(ev(WORK, 'Visa D', TUE, '13:00', '14:15', { description: 'dashboard:visa-d' }));
  step(cal2, doc2, now(TUE, '08:10'));
  assert.equal(cal2.byTitle('Research the Visa D'), undefined, 'the planner\'s copy went');
  assert.ok(cal2.byTitle('Visa D'));
});

test('a weekly target raised late in the week never crowds out next week\'s tasks', () => {
  const SAT = '2026-09-19';
  const MON2 = '2026-09-21';
  const doc = fixture({ items: [
    { id: 'acprep', type: 'quota', title: 'Assessment centre prep', area: 'Assessment centre', unit: 'minutes', target: 1800, order: 1 },
    task('rp1', 'Role play 1', 'Assessment centre', MON2, { minutes: 120 }),
    task('rp2', 'Role play 2', 'Assessment centre', MON2, { minutes: 120 }),
  ] });
  const cal = new FakeCalendar();
  const r = step(cal, doc, now(SAT, '08:00'));
  const mine = summaries(cal);
  assert.ok(mine.some((s) => s.startsWith(MON2) && s.endsWith('Role play 1')), mine.join('\n'));
  assert.ok(mine.some((s) => s.startsWith(MON2) && s.endsWith('Role play 2')), mine.join('\n'));
  const notes = Object.values(r.days).flatMap((d) => d.notes ?? []);
  assert.ok(!notes.some((n) => /unscheduled time.*moved to/.test(n)), notes.join('\n'));
  assert.ok(!notes.some((n) => /Role play/.test(n) && /Couldn't fit/.test(n)), notes.join('\n'));
});
