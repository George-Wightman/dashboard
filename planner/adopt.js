// An event George adds himself on an area's calendar becomes a task
// (docs/superpowers/specs/2026-09-22-calendar-one-to-one-design.md). His main calendar is where he
// keeps reminders like "Dinner with dad", so it is left out; so is anything the planner doesn't book
// into. The event then becomes the task's own block: it carries the planner's markers from this run
// on, so moving, renaming, ticking and deleting work as for any block.

import { norm, resolveCalendars } from './calendars.js';
import { blockBody } from './plan.js';
import { P } from './events.js';
import { localDate, taskInput } from '../js/plan-state.js';
import { clockLabel } from '../js/calendar.js';

const TITLE_MAX = 200;
const NOTES_MAX = 1000;

// Calendar id → the area whose tasks it takes. The main calendar never counts. When two areas book
// into one calendar, a priority area wins, then whichever the settings name first.
export function adoptableCalendars(calendars, config) {
  const { find } = resolveCalendars(calendars, config);
  const main = find(config.defaultCalendar) ?? find('main');
  const priority = new Set(config.priorityAreas.map(norm));
  const out = new Map();
  for (const [area, name] of Object.entries(config.areaCalendars)) {
    const cal = find(name);
    if (!cal || cal.primary || cal.id === main?.id) continue;
    if (!out.has(cal.id) || (priority.has(norm(area)) && !priority.has(norm(out.get(cal.id))))) out.set(cal.id, area);
  }
  return out;
}

// Adopts George's new events as tasks, in one change. `events` are the raw events the planner is
// about to plan with; an adopted one gets the planner's markers here, in memory, so this same run
// treats it as the task's block rather than booking the task a second one — and writes the markers.
export function adoptEvents(store, events, { calendars, config, today, lastDay }) {
  const doc = store.doc();
  const areaOf = adoptableCalendars(calendars, config);
  if (!areaOf.size) return [];
  const { find } = resolveCalendars(calendars, config);
  // A habit's own sessions (habitEvents) are the habit's, whether or not the habit still matches.
  const links = config.habitEvents.map((l) => ({ calendarId: find(l.calendar)?.id, title: l.title }));
  const known = new Set(Object.values(doc.items ?? {}).map((i) => i.fromEvent).filter(Boolean));
  const fresh = events.filter((raw) => {
    const props = raw.extendedProperties?.private ?? {};
    if (!areaOf.has(raw.calendarId) || raw.status === 'cancelled' || props[P.mine] === '1') return false;
    if (!raw.start?.dateTime || !raw.end?.dateTime || raw.recurringEventId) return false;
    if (/dashboard:/.test(String(raw.description ?? ''))) return false;
    if (links.some((l) => l.calendarId === raw.calendarId && norm(l.title) === norm(raw.summary))) return false;
    const day = localDate(raw.start.dateTime);
    const minutes = (Date.parse(raw.end.dateTime) - Date.parse(raw.start.dateTime)) / 60000;
    return day >= today && day <= lastDay && minutes >= 5 && minutes <= 720
      && String(raw.summary ?? '').trim() && !known.has(`${raw.calendarId}|${raw.id}`);
  });
  if (!fresh.length) return [];
  const adopted = [];
  store.transaction(() => {
    for (const raw of fresh) {
      const title = String(raw.summary).trim().slice(0, TITLE_MAX);
      const notes = String(raw.description ?? '').trim().slice(0, NOTES_MAX);
      const item = store.addItem({
        type: 'task', title, date: localDate(raw.start.dateTime), time: clockLabel(raw.start.dateTime),
        minutes: Math.round((Date.parse(raw.end.dateTime) - Date.parse(raw.start.dateTime)) / 60000),
        area: areaOf.get(raw.calendarId), status: 'active', source: 'calendar',
        fromEvent: `${raw.calendarId}|${raw.id}`, ...(notes ? { notes } : {}),
      });
      const marks = blockBody({
        key: `task|${item.id}|0`, base: title, title, start: Date.parse(raw.start.dateTime), end: Date.parse(raw.end.dateTime),
        items: [item.id], state: 'fixed', input: taskInput(item), parts: 1,
      }).extendedProperties.private;
      raw.extendedProperties = { ...(raw.extendedProperties ?? {}), private: { ...(raw.extendedProperties?.private ?? {}), ...marks } };
      adopted.push(item.id);
    }
  }, { summary: 'Added tasks from Google Calendar', source: 'calendar' });
  return adopted;
}
