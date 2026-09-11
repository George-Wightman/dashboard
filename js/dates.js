// Pure day arithmetic. Days are 'YYYY-MM-DD' strings. Everything except logicalDay works in
// UTC on those strings, so a daylight-saving change can never move a day.

const pad = (n) => String(n).padStart(2, '0');
const DAY_MS = 86400000;

const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

// The day a moment belongs to, when the day starts at dayStartHour local time.
export function logicalDay(date, dayStartHour = 4) {
  const shifted = new Date(date.getTime() - dayStartHour * 3600000);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

function toUTC(day) {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(day, n) {
  return fromUTC(toUTC(day) + n * DAY_MS);
}

export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
}

export function weekday(day) {
  const w = new Date(toUTC(day)).getUTCDay();
  return w === 0 ? 7 : w;
}

export function weekStart(day) {
  return addDays(day, 1 - weekday(day));
}

export function dayOfMonth(day) {
  return Number(day.slice(8, 10));
}

export function daysInMonth(day) {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function shortWeekday(day) {
  return WEEKDAYS_SHORT[weekday(day) - 1];
}

export function shortDate(day) {
  return `${dayOfMonth(day)} ${MONTHS_SHORT[Number(day.slice(5, 7)) - 1]}`;
}

export function longDate(day) {
  return `${WEEKDAYS_LONG[weekday(day) - 1]} ${dayOfMonth(day)} ${MONTHS_LONG[Number(day.slice(5, 7)) - 1]}`;
}

// The orange marker on a carried-over task.
export function carryLabel(fromDay, today) {
  return daysBetween(fromDay, today) <= 6 ? `from ${shortWeekday(fromDay)}` : `from ${shortDate(fromDay)}`;
}
