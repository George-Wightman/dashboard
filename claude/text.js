// Wording shared by the tool's reads and its change summaries.

import { addDays, shortWeekday, shortDate } from '../js/dates.js';
import { formatAmount } from '../js/parse.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad = (n) => String(n).padStart(2, '0');

export const TYPE_NAMES = { task: 'task', habit: 'habit', quota: 'weekly target' };

// A title in quotes, clipped.
export function q(text, n = 70) {
  const t = String(text ?? '');
  return `"${t.length > n ? `${t.slice(0, n - 1)}…` : t}"`;
}

export const dayName = (day, today) => (day === today ? 'today' : `${shortWeekday(day)} ${shortDate(day)}`);

// A moment in the process's time zone (the tool sets it from the config first): 'Sat 12 Sep, 14:02'.
// Built by hand rather than with toLocaleString, whose en-GB months vary by ICU version ('Sept').
export function when(iso) {
  const d = new Date(iso);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${shortWeekday(day)} ${shortDate(day)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// A day from what Claude typed: today, tomorrow, yesterday or a real YYYY-MM-DD.
export function toDay(value, today) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'today') return today;
  if (v === 'tomorrow') return addDays(today, 1);
  if (v === 'yesterday') return addDays(today, -1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v) return v;
  throw new Error(`"${value}" isn't a date — use YYYY-MM-DD, today, tomorrow or yesterday`);
}

const ordinal = (n) => {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
};

export function repeatText(repeat = { kind: 'daily' }) {
  const r = repeat ?? { kind: 'daily' };
  switch (r.kind) {
    case 'weekdays': return `on ${(r.days ?? []).map((d) => WEEKDAYS[d - 1]).join(', ')}`;
    case 'perWeek': return `${r.n}× a week`;
    case 'weekly': return `every ${WEEKDAYS[r.day - 1]}`;
    case 'monthly': return `monthly on the ${r.date}${ordinal(r.date)}`;
    default: return 'every day';
  }
}

export function amountText(value, unit, label = '') {
  if (unit === 'minutes') return formatAmount(value, 'minutes');
  return `${formatAmount(value, 'count')}${label ? ` ${label}` : ''}`;
}
