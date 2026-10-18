// What needs George, and what to say about it: a Calendar/Dashboard conflict, a task taken out of
// Calendar, or a later task still waiting for a slot. The classic Upcoming widget lists these; so
// does Daylight's Needs you tile, in plain words with the choice spelled out. Pure.

import { scheduleView } from './plan-state.js';
import { addDays, shortWeekday } from './dates.js';

const HORIZON_DAYS = 14;

const needsYou = (e, today, end) => e.state === 'conflict' || e.item.scheduleHold
  || (e.state === 'unscheduled' && e.day > today && e.day < end);

export function needsEntries(doc, today) {
  const end = addDays(today, HORIZON_DAYS);
  return scheduleView(doc, today).entries.filter((e) => needsYou(e, today, end));
}

const DASHBOARD = "Keep the dashboard's";

export function needsCopy(entry, doc) {
  const { item } = entry;
  if (entry.state === 'conflict') {
    const conflict = doc.calendar?.[`conflict:${item.id}`] ?? {};
    if (conflict.calendarValid === false) {
      return { text: `The Calendar edit to ${item.title} isn't a time the dashboard can use.`, choices: [{ choice: 'dashboard', label: DASHBOARD }] };
    }
    const moved = conflict.changes?.time;
    if (moved && item.time) {
      return {
        text: `You moved ${item.title} to ${moved} in Google Calendar, but the dashboard still has ${item.time}.`,
        choices: [{ choice: 'calendar', label: `Keep ${moved}` }, { choice: 'dashboard', label: `Back to ${item.time}` }],
      };
    }
    return { text: `${item.title} was changed in Google Calendar and here.`, choices: [{ choice: 'calendar', label: "Keep Calendar's" }, { choice: 'dashboard', label: DASHBOARD }] };
  }
  if (item.scheduleHold) return { text: `${item.title} was taken out of Google Calendar. Tell Claude when to do it.`, choices: [] };
  return { text: `${item.title} · ${shortWeekday(entry.day)}: waiting for a calendar slot.`, choices: [] };
}
