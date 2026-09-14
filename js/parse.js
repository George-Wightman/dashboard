// Quick-add parsing and amount display. Minute quotas are stored in minutes and shown in hours.

const positive = (n) => (Number.isFinite(n) && n > 0 ? n : null);

export function parseAmount(text, unit) {
  const s = String(text ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;

  if (unit === 'count') {
    return /^\d+(\.\d+)?$/.test(s) ? positive(Number(s)) : null;
  }

  let m;
  if ((m = s.match(/^(\d+(?:\.\d+)?)m?$/))) return positive(Math.round(Number(m[1])));
  if ((m = s.match(/^(\d+(?:\.\d+)?)h$/))) return positive(Math.round(Number(m[1]) * 60));
  if ((m = s.match(/^(\d+)h(\d{1,2})m?$/))) {
    const mins = Number(m[2]);
    return mins < 60 ? positive(Number(m[1]) * 60 + mins) : null;
  }
  return null;
}

const oneDecimal = (n) => String(Number(n.toFixed(1)));
const hours = (minutes) => oneDecimal(minutes / 60);

export function formatAmount(value, unit) {
  if (unit === 'minutes') return value < 60 ? `${Math.round(value)}m` : `${hours(value)}h`;
  return String(Number(value.toFixed(2)));
}

export function formatProgress(total, target, unit) {
  if (unit === 'minutes') return `${hours(total)} / ${hours(target)}h`;
  return `${formatAmount(total, unit)} / ${formatAmount(target, unit)}`;
}

// ---- Lengths and times (the calendar planner) ------------------------------------------------

export const LENGTH_MIN = 5;
export const LENGTH_MAX = 720;

// A task's or habit's length in minutes: "45m", "2h", "1h30", "1.5h" or a bare number of minutes,
// from 5 minutes to 12 hours.
export function parseLength(text) {
  const n = parseAmount(text, 'minutes');
  return n != null && n >= LENGTH_MIN && n <= LENGTH_MAX ? n : null;
}

// A time of day, "14:00" or "9:30", as "HH:MM".
export function parseClock(text) {
  const m = String(text ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? `${String(h).padStart(2, '0')}:${m[2]}` : null;
}

const LENGTH_WORD = /^(\d+(\.\d+)?h|\d+m|\d+h\d{1,2}m?)$/i;

// The add box: a trailing length and/or time come off the title ("Draft cover letter 2h", "Call
// NatCen 14:00", "Mock interview 14:00 1h"). A bare number stays in the title ("Read 20"), and the
// title always keeps at least one word.
export function splitTaskInput(text) {
  const words = String(text ?? '').trim().split(/\s+/);
  let minutes = null;
  let time = null;
  while (words.length > 1) {
    const last = words[words.length - 1];
    if (time == null && parseClock(last)) { time = parseClock(last); words.pop(); continue; }
    if (minutes == null && LENGTH_WORD.test(last) && parseLength(last)) { minutes = parseLength(last); words.pop(); continue; }
    break;
  }
  return { title: words.join(' '), minutes, time };
}

export function checkLength(v) {
  if (v == null || v === '') return null;
  if (!(Number.isInteger(v) && v >= LENGTH_MIN && v <= LENGTH_MAX)) throw new Error('A length should be from 5 minutes to 12 hours');
  return v;
}

export function checkClock(v) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || parseClock(v) !== v) throw new Error('A time should look like 14:00');
  return v;
}
