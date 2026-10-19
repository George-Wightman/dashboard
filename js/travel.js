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
    + `A time he gives you is his local time: ${diff > 0 ? 'take' : 'add'} ${hrs} ${diff > 0 ? 'off' : 'on'} for \`time\` (his 17:00 is "${pad(Math.floor(example / 60))}:${pad(example % 60)}"), and the same for dayHours and off hours; near midnight the date moves too. `
    + `Times in these reads are ${zoneName(plannerZone)}: ${diff > 0 ? 'add' : 'take'} ${hrs} ${diff > 0 ? '' : 'off '}when you tell him one. `
    + 'His phone shows every block in his own time.';
}

const pad2 = (n) => String(n).padStart(2, '0');

// The wall clock in `zone` at `t`: its date, minutes since midnight and HH:MM. A zone this device
// doesn't know (or none) gives the device's own clock.
export function wallClock(t, zone) {
  let parts = null;
  try {
    if (zone) {
      parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(t).map((p) => [p.type, p.value]));
    }
  } catch { parts = null; }
  const [y, mo, d, h, mi] = parts
    ? [parts.year, parts.month, parts.day, Number(parts.hour), Number(parts.minute)]
    : [String(t.getFullYear()), pad2(t.getMonth() + 1), pad2(t.getDate()), t.getHours(), t.getMinutes()];
  return { date: `${y}-${mo}-${d}`, minutes: h * 60 + mi, hhmm: `${pad2(h)}:${pad2(mi)}` };
}

// An HH:MM in one zone as the same moment's HH:MM in another, on `day` (the offsets of that day).
// Unknown zones, or an empty time, leave it as it is.
export function shiftClock(hhmm, fromZone, toZone, day) {
  if (!hhmm || !/^\d\d:\d\d$/.test(hhmm) || !fromZone || !toZone || fromZone === toZone) return hhmm;
  const at = new Date(`${day}T12:00:00Z`);
  const a = zoneOffset(fromZone, at);
  const b = zoneOffset(toZone, at);
  if (a == null || b == null || a === b) return hhmm;
  const m = ((Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) + (b - a)) % 1440 + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

const ZONE_FRESH_DAYS = 3;

// What a device writes as `device-zone`, or null to leave the record alone. A phone (touch) goes where
// George goes, so it wins; a laptop (often pinned to one zone) reports only when no phone has in the
// last few days. A phone refreshes its record once a day so that "lately" stays true.
export function chooseZoneRecord(rec, { zone, touch }, now = new Date()) {
  if (!zone) return null;
  const live = rec && rec.status !== 'archived' && rec.zone;
  const age = live && rec.at ? (now.getTime() - Date.parse(rec.at)) / 86400000 : Infinity;
  if (live && rec.touch && !touch && age < ZONE_FRESH_DAYS) return null;
  if (live && rec.zone === zone && !!rec.touch === !!touch && age < 1) return null;
  return { zone, touch: !!touch, at: now.toISOString() };
}
