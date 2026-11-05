// Shifts booked ahead, for Hours (js/hours.js): the Work calendar's events that haven't ended yet, as
// one `hours:upcoming` record. Separate from planner/work.js, whose `work:` records are the map's
// hammers and only take shifts once they're over. Written only when the list changes. Pure apart from
// the store.

import { logicalDay } from '../js/dates.js';
import { UPCOMING_ID } from '../js/hours.js';

export function upcomingShifts(events, { calendarId, now, dayStartHour = 4 }) {
  const out = [];
  for (const ev of events) {
    if (ev.calendarId !== calendarId || ev.status === 'cancelled' || ev.transparency === 'transparent') continue;
    const start = Date.parse(ev.start?.dateTime), end = Date.parse(ev.end?.dateTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end <= now.getTime()) continue;
    out.push({
      eventId: String(ev.id), day: logicalDay(new Date(start), dayStartHour),
      start: new Date(start).toISOString(), end: new Date(end).toISOString(),
      minutes: Math.round((end - start) / 60000), title: String(ev.summary ?? '').trim().slice(0, 80),
    });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// Returns true when it wrote.
export function recordUpcoming(store, events, { calendarId, now, dayStartHour = 4 }) {
  if (!calendarId) return false;
  const list = upcomingShifts(events, { calendarId, now, dayStartHour });
  const had = store.doc().calendar?.[UPCOMING_ID];
  if (had?.status === 'active' && JSON.stringify(had.list) === JSON.stringify(list)) return false;
  store.putCalendar(UPCOMING_ID, { status: 'active', at: now.toISOString(), list });
  return true;
}
