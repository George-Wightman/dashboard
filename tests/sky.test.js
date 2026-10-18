import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLACES, placeFor, sunTimes, skyPhase, arcPoint, sunAt, blockDots } from '../js/sky.js';

const near = (actual, iso, minutes) => assert.ok(Math.abs(actual - Date.parse(iso)) <= minutes * 60000, `${actual.toISOString()} vs ${iso}`);

test('London on 21 June and 20 October, within five minutes of the published times', () => {
  const june = sunTimes('2026-06-21', PLACES.london);
  near(june.sunrise, '2026-06-21T03:43:00Z', 5);
  near(june.sunset, '2026-06-21T20:21:00Z', 5);
  const oct = sunTimes('2026-10-20', PLACES.london);
  near(oct.sunrise, '2026-10-20T06:33:00Z', 5);
  near(oct.sunset, '2026-10-20T16:57:00Z', 5);
});

test('Salzburg on 20 October rises earlier than London', () => {
  const s = sunTimes('2026-10-20', PLACES.salzburg);
  // Generalblue's table gives 07:17 and 18:32 local on 9 Oct; eleven days on, about 07:35 and 18:12.
  near(s.sunrise, '2026-10-20T05:35:00Z', 5);
  near(s.sunset, '2026-10-20T16:12:00Z', 5);
});

test('the place follows the time zone unless the setting pins it', () => {
  assert.equal(placeFor('Europe/Vienna').key, 'salzburg');
  assert.equal(placeFor('Europe/London').key, 'london');
  assert.equal(placeFor('America/New_York').key, 'london');
  assert.equal(placeFor('Europe/Vienna', 'london').key, 'london');
});

test('phases across a day', () => {
  const t = sunTimes('2026-10-20', PLACES.london);
  const at = (ms) => skyPhase(new Date(ms), t);
  const [rise, noon, set] = [+t.sunrise, +t.noon, +t.sunset];
  assert.equal(at(rise - 60 * 60000), 'night');
  assert.equal(at(rise - 10 * 60000), 'dawn');
  assert.equal(at(rise + 60 * 60000), 'morning');
  assert.equal(at(noon), 'midday');
  assert.equal(at(set - 120 * 60000), 'afternoon');
  assert.equal(at(set - 30 * 60000), 'golden');
  assert.equal(at(set + 20 * 60000), 'dusk');
  assert.equal(at(set + 90 * 60000), 'night');
});

test('the arc runs from the left horizon over the top to the right', () => {
  assert.deepEqual(arcPoint(0), { x: 0.0417, y: 0.933 });
  assert.ok(Math.abs(arcPoint(0.5).x - 0.5) < 1e-9);
  assert.ok(arcPoint(0.5).y < arcPoint(0.1).y);
  assert.deepEqual(arcPoint(1.4), arcPoint(1));
});

test('the sun is only up between sunrise and sunset', () => {
  const t = sunTimes('2026-10-20', PLACES.london);
  assert.equal(sunAt(new Date(+t.sunrise - 60000), t).up, false);
  assert.equal(sunAt(new Date(+t.noon), t).up, true);
  assert.equal(sunAt(new Date(+t.sunset + 60000), t).up, false);
});

test('only blocks in daylight get a dot', () => {
  const t = sunTimes('2026-10-20', PLACES.london);
  const dots = blockDots([
    { id: 'a', title: 'Hebrew', start: '2026-10-20T08:00:00Z', done: true, area: 'Hebrew' },
    { id: 'b', title: 'Read', start: '2026-10-20T20:00:00Z', done: false, area: null },
  ], t);
  assert.deepEqual(dots.map((d) => [d.id, d.done]), [['a', true]]);
  assert.ok(dots[0].x > 0.0417 && dots[0].x < 0.5);
});
