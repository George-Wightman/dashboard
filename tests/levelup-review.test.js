process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wallClock, shiftClock, zoneNote, chooseZoneRecord } from '../js/travel.js';
import { dueNudges, quietAt } from '../js/nudges.js';
import { jobLines } from '../js/jobs.js';
import { dayRecordId } from '../js/calendar.js';
import { makeStore, clock, fixture } from './helpers.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const NOV = '2026-11-10';
const utc = (hhmm) => new Date(`${NOV}T${hhmm}:00Z`); // London is UTC in November; Vienna UTC+1

test('final review: the wall clock in a zone, and a time moved between zones', () => {
  assert.deepEqual(wallClock(utc('06:40'), 'Europe/Vienna'), { date: NOV, minutes: 7 * 60 + 40, hhmm: '07:40' });
  assert.deepEqual(wallClock(utc('23:30'), 'Europe/Vienna'), { date: '2026-11-11', minutes: 30, hhmm: '00:30' });
  assert.equal(shiftClock('17:00', 'Europe/Vienna', 'Europe/London', NOV), '16:00');
  assert.equal(shiftClock('16:00', 'Europe/London', 'Europe/Vienna', NOV), '17:00');
  assert.equal(shiftClock('17:00', null, 'Europe/London', NOV), '17:00', 'an unknown zone leaves the time alone');
  assert.equal(shiftClock('', 'Europe/Vienna', 'Europe/London', NOV), '');
});

test("final review: nudges follow George's clock where he is, not the planner's", () => {
  const store = makeStore({ now: clock(utc('06:00')) });
  store.putCalendar('device-zone', { zone: 'Europe/Vienna' }, 'me');
  // 06:40 London is 07:40 in Salzburg: the back nudge is due there.
  assert.deepEqual(dueNudges(store.doc(), utc('06:40'), 4).map((n) => n.id), [`back:${NOV}`]);
  // 21:40 London is 22:40 in Salzburg: quiet there.
  assert.equal(quietAt(utc('21:40'), 'Europe/Vienna'), true);
  assert.equal(quietAt(utc('21:40'), 'Europe/London'), false);
  // A session's time is said in his time.
  store.setBack(NOV, 0);
  const t = store.addItem({ type: 'task', title: 'Gym · Legs A', date: NOV });
  store.setSession(t.id, { name: 'Legs A', exercises: [{ name: 'Squat (Barbell)', tpl: 'SQ', sets: 3, reps: 5, kg: 95 }] });
  store.putCalendar(dayRecordId(NOV), { day: NOV, blocks: [{ key: 'k', start: utc('16:30').toISOString(), end: utc('17:45').toISOString(), items: [t.id], state: 'exact' }] });
  const [n] = dueNudges(store.doc(), utc('16:00'), 4);
  assert.equal(n.title, 'Legs A at 17:30');
});

test('final review: the Hebrew nudge says what is logged so far, since the Reader syncs from his devices', () => {
  const store = makeStore({ now: clock(utc('20:10')) });
  store.addItem({ id: 'hebrew-minutes', type: 'quota', title: 'Hebrew learning time', unit: 'minutes', target: 420 });
  store.setBack(NOV, 0);
  const n = dueNudges(store.doc(), utc('20:10'), 4).find((x) => x.id.startsWith('hebrew'));
  assert.equal(n.body, 'Hebrew logged so far today: 0 of 60 minutes.');
});

test("final review: Claude's reads say their own times are the planner's, and other clock settings move too", () => {
  const note = zoneNote({ plannerZone: 'Europe/London', deviceZone: 'Europe/Vienna', at: utc('12:00') });
  assert.match(note, /Times in these reads are London time: add an hour when you tell him/);
  assert.match(note, /dayHours and off hours/);
});

test('final review: a phone wins the device zone over a laptop, and a laptop only reports when no phone has lately', () => {
  const now = utc('12:00');
  assert.equal(chooseZoneRecord(null, { zone: 'Europe/London', touch: false }, now)?.zone, 'Europe/London');
  const phone = { zone: 'Europe/Vienna', touch: true, at: utc('09:00').toISOString(), status: 'active' };
  assert.equal(chooseZoneRecord(phone, { zone: 'Europe/London', touch: false }, now), null, 'the laptop leaves the phone’s zone alone');
  const old = { ...phone, at: new Date(now.getTime() - 4 * 86400000).toISOString() };
  assert.equal(chooseZoneRecord(old, { zone: 'Europe/London', touch: false }, now)?.zone, 'Europe/London');
  assert.equal(chooseZoneRecord(phone, { zone: 'Europe/Vienna', touch: true }, now), null, 'same zone, written today: nothing to write');
  assert.equal(chooseZoneRecord(phone, { zone: 'Europe/London', touch: true }, now)?.zone, 'Europe/London');
  assert.match(read('js/app.js'), /chooseZoneRecord\(/);
});

test('final review: the planner counts as quiet only after 70 minutes, as its heartbeat is hourly', () => {
  const doc = fixture();
  const at = (min) => new Date(utc('12:00').getTime() - min * 60000).toISOString();
  doc.calendar.status = { id: 'status', status: 'active', lastRun: at(50), lastError: null };
  assert.equal(jobLines(doc, utc('12:00'))[0].ok, true);
  doc.calendar.status.lastRun = at(75);
  assert.equal(jobLines(doc, utc('12:00'))[0].ok, false);
});

test('final review: nudges keep a status of their own, shown as their own job', () => {
  const doc = fixture();
  doc.calendar['nudges:status'] = { id: 'nudges:status', status: 'active', day: NOV, lastRun: utc('11:00').toISOString(), sent: 2, lastError: 'A ping to the phone failed (HTTP 403)' };
  const job = jobLines(doc, utc('12:00')).find((j) => j.name === 'Nudges');
  assert.deepEqual([job.ok, job.line], [false, 'A ping to the phone failed (HTTP 403)']);
  assert.match(read('planner/nudges.js'), /putCalendar\('nudges:status'/);
});

test('final review: every Needs-you decision is reachable (three shown, the rest one tap away)', () => {
  assert.match(read('js/ui/needs.js'), /const SHOWN = 3;/);
  assert.doesNotMatch(read('styles/daylight.css'), /needs-entry:nth-of-type/);
});

test("final review: the app's own time field is in George's time, and the back shortcut ends with the day", () => {
  const edit = read('js/ui/edit.js');
  assert.match(edit, /shiftClock\(existing\.time, plannerZone, here/);
  assert.match(edit, /shiftClock\(draft\.time, here, plannerZone/);
  assert.match(read('js/ui/coach.js'), /localTime\(/);
  assert.match(read('js/app.js'), /ui\.backAsk = false;/);
});
