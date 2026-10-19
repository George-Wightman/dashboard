// Moving between London and Salzburg. The app follows the device's own clock, but the planner books
// the calendar in its Apps Script project's time zone, which only George can change. When the two
// disagree every block lands an hour out, so the dashboard says so and how to fix it. Pure.

// Central Europe: one hour ahead of London all year (both change clocks on the same days).
export const CENTRAL = /^Europe\/(Vienna|Berlin|Zurich|Prague|Budapest|Bratislava|Ljubljana|Zagreb|Belgrade|Rome|Vatican|San_Marino|Malta|Paris|Monaco|Andorra|Madrid|Brussels|Amsterdam|Luxembourg|Copenhagen|Oslo|Stockholm|Warsaw|Vaduz|Busingen|Gibraltar|Tirane|Podgorica|Sarajevo|Skopje)$/;

// Minutes ahead of UTC in `zone` at the moment `at`, or null for a zone this device doesn't know.
export function zoneOffset(zone, at = new Date()) {
  try {
    const name = new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? '';
    const m = /GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?/.exec(name);
    if (!m) return null;
    return m[1] ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
  } catch {
    return null;
  }
}

const zoneName = (zone) => (zone === 'Europe/London' ? 'London time' : CENTRAL.test(zone) ? 'Central European time' : zone);
const SETTING = { 0: '(GMT+00:00) London', 60: '(GMT+01:00) Vienna' };

// The zone a device last reported (js/app.js writes it when it changes).
export function deviceZone(doc) {
  const r = doc?.calendar?.['device-zone'];
  return r && r.status === 'active' && typeof r.zone === 'string' ? r.zone : null;
}

// What to tell George when the planner books in a different zone from the one he's in, or null.
export function zoneWarning({ plannerZone, deviceZone: here, at = new Date() }) {
  if (!plannerZone || !here) return null;
  const a = zoneOffset(plannerZone, at);
  const b = zoneOffset(here, at);
  if (a == null || b == null || a === b) return null;
  const hours = Math.abs(b - a) / 60;
  const gap = hours === 1 ? 'an hour' : `${hours} hours`;
  const winter = zoneOffset(here, new Date(Date.UTC(at.getUTCFullYear(), 0, 15)));
  const setting = SETTING[winter] ?? here;
  return `The planner books your calendar in ${zoneName(plannerZone)}, but you're on ${zoneName(here)}, so every block lands ${gap} ${b > a ? 'late' : 'early'}. `
    + `To fix it, open the Dashboard planner script → ⚙ Project Settings → Time zone → ${setting}.`;
}

// For Claude, at the top of every read when George's phone and the planner are in different zones:
// where he is, and how to turn a time he says into the planner's. Not a problem to fix — his phone
// shows every block in his own time — just something to book by.
export function zoneNote({ plannerZone, deviceZone: here, at = new Date() }) {
  if (!plannerZone || !here) return null;
  const a = zoneOffset(plannerZone, at);
  const b = zoneOffset(here, at);
  if (a == null || b == null || a === b) return null;
  const diff = (b - a) / 60;
  const hrs = Math.abs(diff) === 1 ? 'an hour' : `${Math.abs(diff)} hours`;
  const pad = (n) => String(n).padStart(2, '0');
  const example = ((17 * 60 - (b - a)) % 1440 + 1440) % 1440;
  return `George is on ${zoneName(here)} (his phone says ${here}); the planner books in ${zoneName(plannerZone)}, ${hrs} ${diff > 0 ? 'behind' : 'ahead'}. `
    + `A time he gives you is his local time: ${diff > 0 ? 'take' : 'add'} ${hrs} ${diff > 0 ? 'off' : 'on'} for \`time\` (his 17:00 is "${pad(Math.floor(example / 60))}:${pad(example % 60)}"). `
    + 'His phone shows every block in his own time.';
}
