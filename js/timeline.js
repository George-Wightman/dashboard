// Daylight's day, as one timeline: the rows with a calendar time and the calendar's own commitments
// (a shift, an appointment) in start order, with the now line between them; everything without a
// time under "Any time today"; and a line for tomorrow. Pure: the drawing is js/ui/timeline.js.

import { dayRecord, clockLabel } from './calendar.js';
import { localDate } from './plan-state.js';
import { addDays } from './dates.js';

// rows: today's list rows (js/ui/today.js's listRows), in their display order. slots: today's
// times by item id (js/calendar.js's todaySlots). commitments: the planner's busy events.
export function timelineModel({ rows, slots, commitments, today, now }) {
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
  const rank = (e) => (e.kind === 'row' ? 0 : 1);
  timed.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || rank(a) - rank(b) || a.order - b.order);
  const entries = timed.map(({ order, ...e }) => e);
  const after = entries.findIndex((e) => Date.parse(e.start) > +now);
  return { timed: entries, anytime, nowIndex: after === -1 ? entries.length : after };
}

// "Hebrew practice 09:00 · Gym ~17:30": tomorrow's booked blocks, a rough one's time marked with ~.
export function tomorrowLine(doc, today) {
  const blocks = (dayRecord(doc, addDays(today, 1))?.blocks ?? [])
    .filter((b) => b.title && b.start)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  if (!blocks.length) return null;
  return blocks.map((b) => `${b.title} ${b.state === 'rough' ? '~' : ''}${clockLabel(b.start)}`).join(' · ');
}
