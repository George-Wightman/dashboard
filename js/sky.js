// The sky over Daylight's header: where George is, when the sun rises and sets there, which part
// of the day it is, and where on the arc the sun (and each of today's blocks) sits. Pure, and worked
// out on the device with no network, so it draws offline too.

// The places the dashboard knows. A device on Central European time is in Salzburg; anywhere else
// is London, unless ⚙ → The day pins one.
import { CENTRAL } from './travel.js';

export const PLACES = {
  london: { name: 'London', lat: 51.5074, lon: -0.1278 },
  salzburg: { name: 'Salzburg', lat: 47.8095, lon: 13.055 },
};

// The top of the sky in each phase (styles/daylight.css --s1), for the installed app's title bar, so
// it reads as part of the sky rather than a strip above it.
export const SKY_TOP = Object.freeze({
  dawn: '#FFBF94', morning: '#B9D7F7', midday: '#9CC8F2', afternoon: '#A9CDEF', golden: '#FFB27A', dusk: '#3E3270', night: '#1B1840',
});

export function placeFor(timeZone, setting = 'auto') {
  const key = PLACES[setting] ? setting : CENTRAL.test(timeZone ?? '') ? 'salzburg' : 'london';
  return { key, ...PLACES[key] };
}

const rad = (deg) => (deg * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// Sunrise, solar noon and sunset for one day at a place: NOAA's solar position algorithm (the sun's
// declination and the equation of time at noon UTC, zenith 90.833° for refraction and the sun's
// disc), all in UTC from the place's longitude, so the machine's own time zone never matters.
export function sunTimes(day, place) {
  const [y, m, d] = day.split('-').map(Number);
  const midnight = Date.UTC(y, m - 1, d);
  const t = (midnight / 86400000 + 2440587.5 + 0.5 - 2451545) / 36525;
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const anomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre = Math.sin(rad(anomaly)) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(rad(2 * anomaly)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * anomaly)) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + centre - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(rad(omega));
  const decl = Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda)));
  const yy = Math.tan(rad(eps / 2)) ** 2;
  const eqTime = 4 * deg(yy * Math.sin(2 * rad(l0)) - 2 * e * Math.sin(rad(anomaly))
    + 4 * e * yy * Math.sin(rad(anomaly)) * Math.cos(2 * rad(l0))
    - 0.5 * yy * yy * Math.sin(4 * rad(l0)) - 1.25 * e * e * Math.sin(2 * rad(anomaly)));
  const lat = rad(place.lat);
  const cosHa = Math.cos(rad(90.833)) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl);
  const ha = deg(Math.acos(Math.min(1, Math.max(-1, cosHa))));
  const noonMin = 720 - 4 * place.lon - eqTime;
  const at = (minutes) => new Date(midnight + Math.round(minutes * 60000));
  return { sunrise: at(noonMin - 4 * ha), noon: at(noonMin), sunset: at(noonMin + 4 * ha) };
}

const MIN = 60000;

// Which part of the day it is, for the sky's colours.
export function skyPhase(now, { sunrise, noon, sunset }) {
  const n = +now;
  if (n < sunrise - 45 * MIN) return 'night';
  if (n < +sunrise + 30 * MIN) return 'dawn';
  if (n < noon - 90 * MIN) return 'morning';
  if (n <= +noon + 90 * MIN) return 'midday';
  if (n < sunset - 75 * MIN) return 'afternoon';
  if (n < +sunset) return 'golden';
  if (n < +sunset + 45 * MIN) return 'dusk';
  return 'night';
}

const round4 = (v) => Math.round(v * 10000) / 10000;
const P0 = { x: 0.0417, y: 0.933 };
const P1 = { x: 0.5, y: -0.4 };
const P2 = { x: 0.9583, y: 0.933 };

// A point on the sun's arc, in a unit box (x right, y down): a quadratic curve from the left
// horizon over the top to the right one. t is how far through the day, 0 at sunrise, 1 at sunset.
export function arcPoint(t) {
  const u = Math.min(1, Math.max(0, t));
  const a = (1 - u) ** 2;
  const b = 2 * (1 - u) * u;
  const c = u ** 2;
  return { x: round4(a * P0.x + b * P1.x + c * P2.x), y: round4(a * P0.y + b * P1.y + c * P2.y) };
}

const through = (ms, { sunrise, sunset }) => (ms - sunrise) / (sunset - sunrise);

// Where the sun is now, and whether it's up at all (before sunrise and after sunset the moon shows).
export function sunAt(now, times) {
  const n = +now;
  const t = through(n, times);
  return { up: n >= +times.sunrise && n <= +times.sunset, t, ...arcPoint(t) };
}

// One dot on the arc per block that starts in daylight; the rest have nowhere on it to go.
export function blockDots(blocks, times) {
  return blocks
    .filter((b) => { const s = Date.parse(b.start); return s >= +times.sunrise && s <= +times.sunset; })
    .map((b) => ({ id: b.id, title: b.title, done: b.done, area: b.area, ...arcPoint(through(Date.parse(b.start), times)) }));
}
