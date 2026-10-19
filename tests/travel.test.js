process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zoneOffset, zoneWarning, zoneNote, deviceZone } from '../js/travel.js';
import { placeFor } from '../js/sky.js';
import { attention } from '../js/attention.js';
import { fixture } from './helpers.js';
import { createPlanner } from '../planner/gas.js';
import { FakeCalendar } from './planner-fakes.js';
import { FakeRepo, appsScript } from './planner-apps.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const NOV = new Date('2026-11-10T09:00:00Z');

test('offsets are worked out for the moment, so summer and winter both come right', () => {
  assert.equal(zoneOffset('Europe/London', NOV), 0);
  assert.equal(zoneOffset('Europe/Vienna', NOV), 60);
  assert.equal(zoneOffset('Europe/London', new Date('2026-07-01T09:00:00Z')), 60);
  assert.equal(zoneOffset('Not/AZone', NOV), null);
});

test('the old warning text (kept for reference): a planner in London time and a device in Salzburg', () => {
  const w = zoneWarning({ plannerZone: 'Europe/London', deviceZone: 'Europe/Vienna', at: NOV });
  assert.match(w, /^The planner books your calendar in London time, but you're on Central European time, so every block lands an hour late\./);
  assert.match(w, /Project Settings → Time zone → \(GMT\+01:00\) Vienna/);
  assert.equal(zoneWarning({ plannerZone: 'Europe/Vienna', deviceZone: 'Europe/Berlin', at: NOV }), null, 'same offset, different names: fine');
  assert.equal(zoneWarning({ plannerZone: 'Europe/London', deviceZone: 'Europe/London', at: NOV }), null);
  assert.equal(zoneWarning({ plannerZone: null, deviceZone: 'Europe/Vienna', at: NOV }), null, 'an old planner that does not say yet');
  const back = zoneWarning({ plannerZone: 'Europe/Vienna', deviceZone: 'Europe/London', at: NOV });
  assert.match(back, /in Central European time, but you're on London time, so every block lands an hour early\..*\(GMT\+00:00\) London/);
});

test('a device anywhere in Central Europe is in Salzburg for the sky', () => {
  for (const z of ['Europe/Vienna', 'Europe/Berlin', 'Europe/Zurich', 'Europe/Prague']) assert.equal(placeFor(z).key, 'salzburg', z);
  assert.equal(placeFor('Europe/London').key, 'london');
  assert.equal(placeFor('Europe/Berlin', 'london').key, 'london', 'a pinned place wins');
});

test("every read tells Claude where George is and how to turn his times into the planner's", async () => {
  const { header } = await import('../claude/read.js');
  const doc = fixture();
  doc.calendar.status = { id: 'status', status: 'active', timeZone: 'Europe/London', lastRun: NOV.toISOString() };
  doc.calendar['device-zone'] = { id: 'device-zone', status: 'active', zone: 'Europe/Vienna' };
  assert.equal(deviceZone(doc), 'Europe/Vienna');
  assert.equal(zoneNote({ plannerZone: 'Europe/London', deviceZone: 'Europe/Vienna', at: NOV }),
    "George is on Central European time (his phone says Europe/Vienna); the planner books in London time, an hour behind. A time he gives you is his local time: take an hour off for `time` (his 17:00 is \"16:00\"). His phone shows every block in his own time.");
  assert.match(header(doc, '2026-11-10'), /\nGeorge is on Central European time/);
  assert.doesNotMatch(header(fixture(), '2026-11-10'), /George is on/);
  assert.ok(!attention(doc, '2026-11-10').some((l) => /lands an hour/.test(l)), 'no warning: it is not a problem to fix');
});

test('a planner run writes its time zone into its status', async () => {
  const repo = new FakeRepo(fixture());
  const run = appsScript({ cal: new FakeCalendar(), repo, props: { GITHUB_TOKEN: 'ghp_dummy_token', SYNC_REPO: 'o/r' }, now: () => new Date('2026-11-10T09:00:00Z') });
  assert.equal(await createPlanner({ ...run, version: 't' }).run(), 'ok');
  assert.equal(repo.doc().calendar.status.timeZone, 'Europe/London');
});

test('devices report their zone; Needs you has no warning to clear', () => {
  assert.match(read('js/app.js'), /putCalendar\('device-zone'/);
  assert.doesNotMatch(read('js/ui/needs.js'), /zoneWarning\(/);
});
