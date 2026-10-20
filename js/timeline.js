// Daylight's day, as one timeline: the rows with a calendar time and the calendar's own commitments
// (a shift, an appointment) in start order, with the now line between them; everything without a
// time under "Any time today"; and a line for tomorrow. Pure: the drawing is js/ui/timeline.js.

import { dayRecord, clockLabel } from './calendar.js';
import { localDate } from './plan-state.js';
import { addDays } from './dates.js';
import { mealsOn } from './food.js';

// rows: today's list rows (js/ui/today.js's listRows), in their display order. slots: today's
// times by item id (js/calendar.js's todaySlots). commitments: the planner's busy events.
export function timelineModel({ rows, slots, commitments, today, now, markers = [] }) {
  const timed = [];
  const anytime = [];
  rows.forEach((row, order) => {
    const slot = row.suggested ? null : slots.get(row.item.id);
    if (slot) timed.push({ kind: 'row', start: slot.start, end: slot.end, row, order });
    else anytime.push(row);
  });
  commitments
    .filter((c) => !c.allDay && localDate(c.start) === today)
    .forEach((c, i) => timed.push({ kind: 'commitment', start: c.start, end: c.end, title: c.title, calendar: c.calendar, order: i }));
  markers.forEach((m, i) => timed.push({ kind: 'meal', start: m.start, end: m.start, slot: m.slot, order: i }));
  const rank = (e) => ({ row: 0, meal: 1, commitment: 2 }[e.kind]);
  timed.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || rank(a) - rank(b) || a.order - b.order);
  const entries = timed.map(({ order, ...e }) => e);
  const after = entries.findIndex((e) => Date.parse(e.start) > +now);
  return { timed: entries, anytime, nowIndex: after === -1 ? entries.length : after };
}

// A prompt to snap breakfast, lunch and dinner, at 08:00, 12:30 and 19:00, each only while that
// meal hasn't been logged today. Not a task: nothing counts it.
const MEAL_TIMES = [['breakfast', 8, 0], ['lunch', 12, 30], ['dinner', 19, 0]];
export function mealMarkers(doc, today) {
  const logged = new Set(mealsOn(doc, today).map((m) => m.slot));
  const [y, mo, d] = today.split('-').map(Number);
  return MEAL_TIMES.filter(([slot]) => !logged.has(slot))
    .map(([slot, hh, mm]) => ({ slot, start: new Date(y, mo - 1, d, hh, mm).toISOString() }));
}

// "Hebrew practice 09:00 · Gym ~17:30": tomorrow's booked blocks, a rough one's time marked with ~.
export function tomorrowLine(doc, today) {
  const blocks = (dayRecord(doc, addDays(today, 1))?.blocks ?? [])
    .filter((b) => b.title && b.start)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  if (!blocks.length) return null;
  return blocks.map((b) => `${b.title} ${b.state === 'rough' ? '~' : ''}${clockLabel(b.start)}`).join(' · ');
}

// ---- Dragging a task to a new time (js/ui/timedrag.js) -------------------------------------------

const QUARTER = 15 * 60000;
const pad = (n) => String(n).padStart(2, '0');
export const toClock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
// The calendar date a time falls on (after midnight that's tomorrow's, even before the day starts).
export const toDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Where a task dropped on the day lands. `above` and `below` are the entries either side ({ start,
// end } as ISO, either may be missing); `fraction` is how far down the gap between them it was let go.
// It goes after what's above and before what's below, in quarter hours, and never before now.
export function dropTime({ above, below, fraction = 0, minutes = 30, now }) {
  const length = Math.max(15, minutes) * 60000;
  const lo = above ? Date.parse(above.end ?? above.start) : null;
  const hi = below ? Date.parse(below.start) : null;
  let t;
  if (lo !== null && hi !== null) t = lo + Math.max(0, Math.min(1, fraction)) * Math.max(0, hi - length - lo);
  else if (hi !== null) t = hi - length;
  else if (lo !== null) t = lo;
  else t = +now;
  const earliest = Math.ceil(+now / QUARTER) * QUARTER;
  return new Date(Math.max(earliest, Math.round(t / QUARTER) * QUARTER));
}

// A task given a time today in the dashboard shows there at once, ahead of the planner moving its
// block (within ten minutes): its own time and length, marked as on its way.
export function movedSlot(item, slot, today) {
  if (item?.type !== 'task' || item.date !== today || !/^\d\d:\d\d$/.test(item.time ?? '')) return slot ?? null;
  const [y, mo, d] = today.split('-').map(Number);
  const [hh, mm] = item.time.split(':').map(Number);
  const start = new Date(y, mo - 1, d, hh, mm);
  if (slot && toClock(new Date(slot.start)) === item.time) return slot;
  return { start: start.toISOString(), end: new Date(+start + (item.minutes ?? 30) * 60000).toISOString(), state: 'moving' };
}
