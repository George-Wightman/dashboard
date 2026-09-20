// The shared schedule contract. A requested day is not a booking. Calendar, the
// Dashboard and the Coach resolve the same confirmed placements through here.
import { blockers } from './workflow.js';
import { addDays } from './dates.js';

export const taskInput = (i) => ({ title: i.title, date: i.date ?? null, time: i.time || null,
  minutes: i.minutes ?? null, hold: i.scheduleHold === true });

// George's pin, typed at the front of a title: keep this where it is. He types the word; the
// planner writes it back as 📌, which is then his handle for taking it off again. Either form
// reads as a pin, and neither ever becomes part of the task's name. Markers can stack
// ("📌 ~ Draft the answer"), so they come off in whatever order they arrive.
const PIN_MARK = /^\s*(?:stay\b[\s:.,–—-]*|📌\s*)/i;
const STATE_MARK = /^\s*[~✓]\s*/;
export function readPinMarker(summary) {
  let rest = String(summary ?? ''), pinned = false;
  for (;;) {
    const pin = rest.match(PIN_MARK);
    if (pin) { pinned = true; rest = rest.slice(pin[0].length); continue; }
    const mark = rest.match(STATE_MARK);
    if (mark) { rest = rest.slice(mark[0].length); continue; }
    return { title: rest.trim(), pinned };
  }
}
export const localDate = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const dayClosed = (doc, day) => doc.calendar?.[`closed:${day}`]?.closed === true;
export function scheduleBlocks(doc) {
  if (doc.calendar?.agenda?.blocks) return doc.calendar.agenda.blocks;
  return Object.values(doc.calendar ?? {}).filter((r) => r.id?.startsWith('day:')).flatMap((r) => r.blocks ?? []);
}
export function bookingsFor(doc, item) {
  if (item.scheduleHold) return [];
  return scheduleBlocks(doc).filter((b) => (!doc.calendar?.agenda?.from || localDate(b.end) >= doc.calendar.agenda.from) && b.items.includes(item.id) && !['done', 'partial'].includes(b.state)
    && (!b.input || ['date', 'time', 'minutes', 'hold'].every((k) => b.input[k] === taskInput(item)[k])))
    .sort((a, b) => a.start.localeCompare(b.start));
}
export function plannedTaskDay(doc, item) {
  return bookingsFor(doc, item)[0]?.start ? localDate(bookingsFor(doc, item)[0].start) : item.date;
}
export function scheduleView(doc, today, days = 14) {
  const end = addDays(today, days);
  const done = new Set(Object.values(doc.logs ?? {}).filter((l) => l.kind === 'done' && l.status === 'active').map((l) => l.itemId));
  const tasks = Object.values(doc.items ?? {}).filter((i) => i.type === 'task' && i.status === 'active' && !done.has(i.id));
  const entries = tasks.map((item) => {
    const bookings = bookingsFor(doc, item).filter((b) => localDate(b.end) >= today);
    const scheduledDay = bookings[0] ? localDate(bookings[0].start) : null;
    const conflict = doc.calendar?.[`conflict:${item.id}`];
    const blocked = blockers(doc, item, scheduledDay ?? (item.date < today ? today : item.date)).join('; ');
    const reason = conflict?.open ? 'Calendar and Dashboard edits need resolving'
      : blocked ? blocked
      : item.scheduleHold ? 'Removed from Calendar — choose a new day to schedule'
      : scheduledDay && scheduledDay !== item.date ? `Requested ${item.date}; placed ${scheduledDay}`
      : !bookings.length ? item.date >= end ? 'Beyond the current calendar horizon' : 'Waiting for a calendar slot' : '';
    return { item, requestedDay: item.date, scheduledDay, bookings, reason,
      day: scheduledDay ?? (item.date < today ? today : item.date), state: conflict?.open ? 'conflict' : bookings.length ? 'scheduled' : 'unscheduled' };
  }).sort((a, b) => a.day.localeCompare(b.day) || (a.bookings[0]?.start ?? 'z').localeCompare(b.bookings[0]?.start ?? 'z')
    || (a.item.order ?? 0) - (b.item.order ?? 0));
  return { entries, commitments: doc.calendar?.agenda?.busy ?? [], lastSynced: doc.calendar?.agenda?.syncedAt ?? doc.calendar?.status?.lastRun ?? null,
    through: doc.calendar?.agenda?.through ?? null, closed: dayClosed(doc, today) };
}
