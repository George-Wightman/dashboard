process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at } from '../planner/time.js';
import { createPlanner } from '../planner/gas.js';
import { clockLabel } from '../js/calendar.js';
import { fixture } from './helpers.js';
import { FakeCalendar, step } from './planner-fakes.js';
import { FakeRepo, appsScript } from './planner-apps.js';

const TUE = '2026-09-15';
const WED = '2026-09-16';
const THU = '2026-09-17';
const task = (id, title, area, date, extra = {}) => ({ id, type: 'task', title, area, date, order: 1, ...extra });
const span = (e) => `${clockLabel(e.start.dateTime)}–${clockLabel(e.end.dateTime)}`;
const summaries = (cal) => cal.mine().map((e) => `${e.start.dateTime.slice(0, 10)} ${span(e)} ${e.summary}`).sort();

// A document with items, planner settings and time off.
function docWith(items, { config = {}, offs = [] } = {}) {
  const doc = fixture({ items });
  doc.calendar = { config: { id: 'config', status: 'active', ...config } };
  for (const o of offs) doc.calendar[o.id] = { status: 'active', source: 'claude', areas: [], reason: 'Away', ...o };
  return doc;
}

test('a day off for everything: nothing booked on it, and its tasks move to the next day', () => {
  const doc = docWith([task('who', 'Trace the WHO figure', 'Job search', WED), task('pharma', 'Trace the pharma figure', 'Job search', WED),
    task('natcen', 'Read the NatCen pack', 'Job search', THU)], { offs: [{ id: 'off:2026-09-16', start: WED, end: WED }] });
  const cal = new FakeCalendar();
  step(cal, doc, at(TUE, '08:00'));
  assert.deepEqual(summaries(cal), ['2026-09-17 09:00–09:30 ~ Trace the pharma figure', '2026-09-17 09:45–10:15 ~ Trace the WHO figure', '2026-09-17 10:30–11:00 ~ Read the NatCen pack']);
});

test('time off for some areas: the others are still booked that day', () => {
  const doc = docWith([task('who', 'Trace the WHO figure', 'Job search', WED), task('map', 'Map competencies', 'Assessment centre', WED)],
    { offs: [{ id: 'off:2026-09-16', start: WED, end: WED, areas: ['job search'] }] });
  const cal = new FakeCalendar();
  step(cal, doc, at(TUE, '08:00'));
  assert.deepEqual(summaries(cal), ['2026-09-16 09:00–09:30 Map competencies', '2026-09-17 09:00–09:30 ~ Trace the WHO figure']);
});

test('a stretch of hours off: blocks go round it', () => {
  const doc = docWith([task('chase', 'Chase the GSS outcome', 'Job search', TUE), task('dayout', 'Write the day out', 'Assessment centre', TUE, { minutes: 60 })],
    { offs: [{ id: 'off:2026-09-15', start: `${TUE}T09:00`, end: `${TUE}T12:00` }] });
  const cal = new FakeCalendar();
  step(cal, doc, at(TUE, '08:00'));
  assert.deepEqual(summaries(cal), ['2026-09-15 12:15–13:15 Write the day out', '2026-09-15 13:30–14:00 Chase the GSS outcome']);
});

test('priority areas are booked first', () => {
  const items = [task('chase', 'Chase the GSS outcome', 'Job search', TUE, { minutes: 90 }), task('dayout', 'Write the day out', 'Assessment centre', TUE)];
  const plain = new FakeCalendar();
  step(plain, docWith(items), at(TUE, '08:00'));
  assert.deepEqual(summaries(plain), ['2026-09-15 09:00–10:30 Chase the GSS outcome', '2026-09-15 10:45–11:15 Write the day out']);
  const first = new FakeCalendar();
  step(first, docWith(items, { config: { priorityAreas: ['Assessment centre'] } }), at(TUE, '08:00'));
  assert.deepEqual(summaries(first), ['2026-09-15 09:00–09:30 Write the day out', '2026-09-15 09:45–11:15 Chase the GSS outcome']);
});

test("an area's colour on its blocks, pale when rough; removing it restores the calendar's", () => {
  const items = [task('dayout', 'Write the day out', 'Assessment centre', TUE), task('mock', 'Mock interview', 'Assessment centre', THU)];
  const cal = new FakeCalendar();
  const r = step(cal, docWith(items, { config: { areaColors: { 'Assessment centre': 'Blueberry' } } }), at(TUE, '08:00'));
  assert.equal(cal.byTitle('Write the day out').colorId, '9');
  assert.equal(cal.byTitle('~ Mock interview').colorId, '1');
  assert.deepEqual(r.takenColors, ['Basil', 'Lavender', 'Tomato']);
  const again = step(cal, docWith(items, { config: { areaColors: { 'Assessment centre': 'Blueberry' } } }), at(TUE, '08:05'), r.days);
  assert.deepEqual(again.actions, []);
  step(cal, docWith(items), at(TUE, '08:10'), again.days);
  assert.equal(cal.byTitle('Write the day out').colorId, undefined);
  assert.equal(cal.byTitle('~ Mock interview').colorId, '4');
});

test("a colour one of George's calendars already has is not used, and Claude is told what's free", () => {
  const cal = new FakeCalendar();
  const r = step(cal, docWith([task('chase', 'Chase the GSS outcome', 'Job search', TUE)], { config: { areaColors: { 'Job search': 'Tomato' } } }), at(TUE, '08:00'));
  assert.equal(cal.byTitle('Chase the GSS outcome').colorId, undefined);
  assert.ok(r.days[TUE].notes.includes('Tomato is taken by your Application calendar — free: Sage, Grape, Flamingo, Banana, Tangerine, Peacock, Graphite, Blueberry'), r.days[TUE].notes.join('\n'));
});

test('hours for a particular day', () => {
  const doc = docWith([task('chase', 'Chase the GSS outcome', 'Job search', TUE), task('dayout', 'Write the day out', 'Assessment centre', TUE, { minutes: 60 })],
    { config: { dayHours: { [TUE]: ['14:00', '16:00'] } } });
  const cal = new FakeCalendar();
  step(cal, doc, at(TUE, '08:00'));
  assert.deepEqual(summaries(cal), ['2026-09-15 14:00–15:00 Write the day out', '2026-09-15 15:15–15:45 Chase the GSS outcome']);
});

test("notes lead a block's description; the title stays the title", () => {
  const doc = docWith([
    task('dayout', 'Write the day out', 'Assessment centre', TUE, { notes: 'Bring the pack' }),
    task('who', 'Trace the WHO figure', 'Job search', WED, { notes: 'Use the 2023 report' }),
    task('pharma', 'Trace the pharma figure', 'Job search', WED),
  ]);
  const cal = new FakeCalendar();
  step(cal, doc, at(TUE, '08:00'));
  assert.equal(cal.byTitle('Write the day out').description, 'Bring the pack\nOpen task / mark complete: https://george-wightman.github.io/dashboard/?task=dayout\ndashboard:dayout\nPlanned from your dashboard. Move it and it stays where you put it.');
  assert.match(cal.byTitle('Trace the WHO figure').description, /^Use the 2023 report\nOpen task \/ mark complete:/);
  assert.match(cal.byTitle('Trace the pharma figure').description, /dashboard:pharma/);
});

test("the planner's status tells the dashboard which colours are taken", async () => {
  const repo = new FakeRepo(docWith([task('chase', 'Chase the GSS outcome', 'Job search', TUE)]));
  const env = appsScript({ cal: new FakeCalendar(), repo, props: { GITHUB_TOKEN: 'ghp_dummy_token', SYNC_REPO: 'o/r' }, now: () => at(TUE, '08:00') });
  assert.equal(await createPlanner({ ...env, version: 't' }).run(), 'ok');
  assert.deepEqual(repo.doc().calendar.status.takenColors, ['Basil', 'Lavender', 'Tomato']);
});
