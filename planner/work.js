// Signify shifts (docs/superpowers/specs/2026-10-29-salzburg-era-design.md): each event on his Work
// calendar that has ended becomes a `work:<event id>` record in the calendar map, which the map
// (js/map/engine.js) turns into hammers. Recorded from the first run onwards, never backfilled, so his
// map doesn't change under him; a moved shift follows and a deleted one goes, for the days still
// listed (yesterday onwards). Pure apart from the store.

import { logicalDay, addDays } from '../js/dates.js';

const isShift = (r) => r?.status === 'active' && String(r.id).startsWith('work:');

export function recordShifts(store, events, { calendarId, today, now, dayStartHour = 4 }) {
  if (!calendarId) return 0;
  const status = store.doc().calendar?.['work-status'];
  const startedOn = status?.startedOn ?? today;
  if (!status?.startedOn) store.putCalendar('work-status', { startedOn });
  const seen = new Set();
  let n = 0;
  for (const ev of events) {
    if (ev.calendarId !== calendarId || ev.status === 'cancelled' || ev.transparency === 'transparent') continue;
    const start = Date.parse(ev.start?.dateTime), end = Date.parse(ev.end?.dateTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > now.getTime()) continue;
    const day = logicalDay(new Date(start), dayStartHour);
    if (day < startedOn) continue;
    const id = `work:${ev.id}`;
    seen.add(id);
    const rec = {
      status: 'active', day, start: new Date(start).toISOString(), end: new Date(end).toISOString(),
      minutes: Math.round((end - start) / 60000), title: String(ev.summary ?? '').trim().slice(0, 80),
    };
    const had = store.doc().calendar?.[id];
    if (had && Object.entries(rec).every(([k, v]) => had[k] === v)) continue;
    store.putCalendar(id, rec);
    n++;
  }
  const listedFrom = addDays(today, -1);
  for (const r of Object.values(store.doc().calendar ?? {})) {
    if (!isShift(r) || r.day < listedFrom || seen.has(r.id)) continue;
    store.putCalendar(r.id, { status: 'archived' });
    n++;
  }
  return n;
}
