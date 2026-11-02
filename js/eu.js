// Days in the EU (the Schengen 90/180 rule): George may be there at most 90 days in any 180, counting
// the day itself and the 179 before it, with the days he flies in and out both counted. Each day he
// marks is its own `eu:<day>` record beside the planner's, so two devices marking days merge cleanly;
// unmarking archives it. Days up to today are days he was there, later ones are visits he's planning.
// The EU days tile (js/ui/eu.js) and Claude (the `eu` op) both read and write them here. Pure.

import { addDays } from './dates.js';

export const EU_LIMIT = 90;
export const EU_WINDOW = 180;
export const EU_PREFIX = 'eu:';
export const euId = (day) => `${EU_PREFIX}${day}`;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The days marked, as a Set of YYYY-MM-DD.
export function euDays(doc) {
  const out = new Set();
  for (const r of Object.values(doc?.calendar ?? {})) {
    if (r.status === 'active' && String(r.id).startsWith(EU_PREFIX) && DAY.test(r.day ?? '')) out.add(r.day);
  }
  return out;
}

// How many marked days fall in the 180 days ending on `day`.
export function euCount(days, day) {
  let n = 0;
  for (let i = 0; i < EU_WINDOW; i++) if (days.has(addDays(day, -i))) n++;
  return n;
}

// The longest stay starting on `day` (planned days already marked count towards it) before a day
// would go over 90. Later visits it pushes over show red on the calendar.
export function longestStay(days, day) {
  const trial = new Set(days);
  let n = 0;
  while (n < EU_WINDOW) {
    const d = addDays(day, n);
    trial.add(d);
    if (euCount(trial, d) > EU_LIMIT) break;
    n++;
  }
  return n;
}

// The visits (runs of marked days) that end after `from`, first first: { start, end, days }.
export function euVisits(days, from) {
  const sorted = [...days].sort();
  const out = [];
  for (const d of sorted) {
    const last = out.at(-1);
    if (last && addDays(last.end, 1) === d) { last.end = d; last.days++; } else out.push({ start: d, end: d, days: 1 });
  }
  return out.filter((v) => v.end > from);
}

// Everything the tile and Claude say, as of `today`, looking `ahead` days on.
// used/left: days used and left today. planned: marked days after today. next: the next visit not
// yet started (or null). over: the first planned day that goes over 90 (or null). back: the next
// day an old day drops out of the window (or null). stay: the longest stay starting tomorrow.
// spare: days left to plan, taking the planned ones: 90 less the most counted on any day from today
// on, so it's never more than he can add without some day going over.
export function euSummary(doc, today, ahead = 365) {
  const days = euDays(doc);
  const used = euCount(days, today);
  const end = addDays(today, ahead);
  let planned = 0;
  let over = null;
  for (const d of days) {
    if (d <= today || d > end) continue;
    planned++;
    if ((over == null || d < over) && euCount(days, d) > EU_LIMIT) over = d;
  }
  let back = null;
  for (let d = addDays(today, 1); d <= end && back == null; d = addDays(d, 1)) {
    if (days.has(addDays(d, -EU_WINDOW))) back = d;
  }
  const next = euVisits(days, today).find((v) => v.start > today) ?? null;
  let peak = used;
  for (let d = addDays(today, 1); d <= end; d = addDays(d, 1)) peak = Math.max(peak, euCount(days, d));
  const here = days.has(today) ? euVisits(days, addDays(today, -1)).find((v) => v.start <= today) ?? null : null;
  return { used, left: Math.max(0, EU_LIMIT - used), planned, next, here, over, back, stay: longestStay(days, addDays(today, 1)), spare: Math.max(0, EU_LIMIT - peak) };
}

// Every day from `from` to `to`, either way round.
export function dayRange(from, to) {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const out = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

// Marks (on) or unmarks the given days in one save. Returns how many changed.
export function setEuDays(store, list, on, source = 'me') {
  const days = euDays(store.doc());
  const changing = [...new Set(list)].filter((day) => DAY.test(day) && days.has(day) !== on);
  if (!changing.length) return 0;
  store.transaction(() => {
    for (const day of changing) {
      store.putCalendar(euId(day), on ? { day, status: 'active', archivedOn: null } : { day, status: 'archived', archivedOn: store.today() }, source);
    }
  });
  return changing.length;
}

// The oldest day still counted on `today`.
export const windowStart = (today) => addDays(today, -(EU_WINDOW - 1));
