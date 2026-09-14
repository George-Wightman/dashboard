// A Google Calendar in memory, for the planner's tests: George's calendars, events as the
// Calendar API returns them, the planner's changes applied, and the Apps Script service shape.

import { at } from '../planner/time.js';
import { plan, fillIds } from '../planner/plan.js';

export const MAIN = 'georgewight03@gmail.com';
export const APP = 'application@group';
export const GYM = 'gym@group';
export const WORK = 'work@group';
export const FAMILY = 'family@group';

export const CALS = [
  { id: MAIN, name: 'Tasks', primary: true, backgroundColor: '#9fe1e7', accessRole: 'owner' },
  { id: APP, name: 'Application ', backgroundColor: '#f83a22', accessRole: 'owner' },
  { id: GYM, name: 'Gym ', backgroundColor: '#7bd148', accessRole: 'owner' },
  { id: WORK, name: 'Work', backgroundColor: '#9a9cff', accessRole: 'owner' },
  { id: FAMILY, name: 'Family', backgroundColor: '#fad165', accessRole: 'owner' },
];

export const EVENT_COLORS = {
  1: '#a4bdfc', 2: '#7ae7bf', 3: '#dbadff', 4: '#ff887c', 5: '#fbd75b', 6: '#ffb878',
  7: '#46d6db', 8: '#e1e1e1', 9: '#5484ed', 10: '#51b749', 11: '#dc2127',
};

const copy = (v) => JSON.parse(JSON.stringify(v));

export function ev(calendarId, title, day, from, to, extra = {}) {
  return { calendarId, summary: title, start: { dateTime: at(day, from).toISOString() }, end: { dateTime: at(day, to).toISOString() }, ...extra };
}

export class FakeCalendar {
  constructor(events = [], calendars = CALS) {
    this.calendars = calendars;
    this.events = new Map();
    this.n = 0;
    this.fail = null;
    for (const e of events) this.add(e);
  }

  add(e) {
    const id = e.id ?? `ev${++this.n}`;
    this.events.set(id, copy({ status: 'confirmed', ...e, id }));
    return id;
  }

  all() { return [...this.events.values()].map(copy); }
  get(id) { return this.events.get(id); }
  byTitle(title) { return [...this.events.values()].find((e) => e.summary === title); }
  mine() { return this.all().filter((e) => e.extendedProperties?.private?.dash === '1'); }
  remove(id) { this.events.delete(id); }

  move(id, day, from, to) {
    const e = this.events.get(id);
    e.start = { dateTime: at(day, from).toISOString() };
    e.end = { dateTime: at(day, to).toISOString() };
  }

  apply(actions) {
    const byKey = {};
    for (const a of actions) {
      if (a.op === 'insert') byKey[a.key] = this.add({ ...a.body, calendarId: a.calendarId });
      else if (a.op === 'patch') Object.assign(this.events.get(a.eventId), copy(a.body));
      else this.events.delete(a.eventId);
    }
    return byKey;
  }

  // The Calendar advanced service, as planner/gas.js calls it.
  service() {
    const self = this;
    const time = (t) => Date.parse(t?.dateTime ?? `${t?.date}T00:00:00`);
    return {
      CalendarList: {
        list: () => ({ items: self.calendars.map((c) => ({ id: c.id, summary: c.name, primary: c.primary || undefined, backgroundColor: c.backgroundColor, accessRole: c.accessRole ?? 'owner' })) }),
      },
      Colors: {
        get: () => ({ event: Object.fromEntries(Object.entries(EVENT_COLORS).map(([id, hex]) => [id, { background: hex, foreground: '#1d1d1d' }])) }),
      },
      Events: {
        list(calendarId, opts = {}) {
          const lo = opts.timeMin ? Date.parse(opts.timeMin) : -Infinity;
          const hi = opts.timeMax ? Date.parse(opts.timeMax) : Infinity;
          const [pk, pv] = String(opts.privateExtendedProperty ?? '').split('=');
          const items = self.all()
            .filter((e) => e.calendarId === calendarId && time(e.end) > lo && time(e.start) < hi)
            .filter((e) => !pk || e.extendedProperties?.private?.[pk] === pv)
            .map(({ calendarId: _, ...e }) => e);
          return { items };
        },
        insert(body, calendarId) {
          if (self.fail === 'insert') { self.fail = null; throw new Error('Rate Limit Exceeded'); }
          return { id: self.add({ ...body, calendarId }) };
        },
        patch(body, calendarId, eventId) {
          Object.assign(self.events.get(eventId), copy(body));
          return copy(self.events.get(eventId));
        },
        remove(calendarId, eventId) { self.events.delete(eventId); },
      },
    };
  }
}

// One planning pass against the fake, applied: what plan returned, with the new events' ids filled in.
export function step(cal, doc, now, memory = {}) {
  const r = plan({ doc, now, calendars: cal.calendars, events: cal.all(), eventColors: EVENT_COLORS, memory });
  const byKey = cal.apply(r.actions);
  return { ...r, days: fillIds(r.days, byKey) };
}
