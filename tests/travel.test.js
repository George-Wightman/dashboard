process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zoneOffset, zoneWarning, deviceZone } from '../js/travel.js';
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

test('a planner booking in London time while the device is in Salzburg is a warning that says how to fix it', () => {
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

test("Claude's attention list carries the warning, from the zone a device last reported", () => {
  const doc = fixture();
  doc.calendar.status = { id: 'status', status: 'active', timeZone: 'Europe/London', lastRun: NOV.toISOString() };
  doc.calendar['device-zone'] = { id: 'device-zone', status: 'active', zone: 'Europe/Vienna' };
  assert.equal(deviceZone(doc), 'Europe/Vienna');
  assert.ok(attention(doc, '2026-11-10').some((l) => /lands an hour late/.test(l)));
});

test('a planner run writes its time zone into its status', async () => {
  const repo = new FakeRepo(fixture());
  const run = appsScript({ cal: new FakeCalendar(), repo, props: { GITHUB_TOKEN: 'ghp_dummy_token', SYNC_REPO: 'o/r' }, now: () => new Date('2026-11-10T09:00:00Z') });
  assert.equal(await createPlanner({ ...run, version: 't' }).run(), 'ok');
  assert.equal(repo.doc().calendar.status.timeZone, 'Europe/London');
});

test('devices report their zone; Needs you shows the warning', () => {
  assert.match(read('js/app.js'), /putCalendar\('device-zone'/);
  assert.match(read('js/ui/needs.js'), /zoneWarning\(/);
});
