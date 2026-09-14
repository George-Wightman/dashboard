// Moments on George's days, in local time. The tests set TZ=Europe/London; Apps Script uses the
// project's time zone (Europe/London in appsscript.json), so a planning hour is a wall-clock hour
// on both sides of a clock change.

export const MINUTE = 60000;
const pad = (n) => String(n).padStart(2, '0');

export function at(day, hhmm) {
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, h, min);
}

export const localDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const iso = (msOrDate) => new Date(msOrDate).toISOString();
