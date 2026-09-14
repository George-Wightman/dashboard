# Task 4: One planning pass

**Files:**
- Create: `planner/plan.js`, `tests/planner-fakes.js`
- Test: `tests/planner-plan.test.js`

**Interfaces:**
- Consumes: Tasks 1–3 by their *Shared interfaces* names; `addDays`, `logicalDay`, `daysBetween`,
  `shortWeekday` (`js/dates.js`).
- Produces: `blockTitle`, `blockBody`, `plan`, `fillIds` (planner/plan.js); in `tests/planner-fakes.js`:
  `CALS`, `MAIN`, `APP`, `GYM`, `WORK`, `FAMILY`, `EVENT_COLORS`, `FakeCalendar`, `ev`, `step`. Task 5
  uses `plan`/`fillIds` and the fakes; Task 6 uses the fakes.

- [ ] **Step 1: Create the fakes** — `tests/planner-fakes.js`:

```js
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
```

- [ ] **Step 2: Write the failing tests** — create `tests/planner-plan.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockTitle } from '../planner/plan.js';
import { at } from '../planner/time.js';
import { clockLabel } from '../js/calendar.js';
import { fixture, done } from './helpers.js';
import { FakeCalendar, ev, step, MAIN, APP, GYM, WORK, FAMILY } from './planner-fakes.js';

process.env.TZ = 'Europe/London';

const TUE = '2026-09-15';
const WED = '2026-09-16';
const THU = '2026-09-17';
const now = (day, hhmm) => at(day, hhmm);
const task = (id, title, area, date, extra = {}) => ({ id, type: 'task', title, area, date, order: 1, ...extra });
const instance = (calendarId, title, day, from, to, series, originalFrom = from) =>
  ev(calendarId, title, day, from, to, { recurringEventId: series, originalStartTime: { dateTime: at(day, originalFrom).toISOString() } });
const span = (e) => `${clockLabel(e.start.dateTime)}–${clockLabel(e.end.dateTime)}`;
const inserts = (r) => r.actions.filter((a) => a.op === 'insert');
const summaries = (cal) => cal.mine().map((e) => `${e.start.dateTime.slice(0, 10)} ${span(e)} ${e.summary}`).sort();

// Tuesday 15 September: Hebrew and Gym on Tuesday and Wednesday, a Signify shift on Tuesday, a
// family day on a calendar the planner ignores.
function tuesday() {
  const doc = fixture({ items: [
    { id: 'hebrew', type: 'habit', title: 'Hebrew - app plus Duolingo', area: 'Hebrew', repeat: { kind: 'daily' }, order: 1 },
    { id: 'gym', type: 'habit', title: 'Gym', area: 'Health', repeat: { kind: 'perWeek', n: 5 }, order: 2 },
    task('chase', 'Chase the GSS outcome', 'Job search', TUE),
    task('dayout', 'Write the day out', 'Assessment centre', TUE, { minutes: 60 }),
    task('who', 'Trace the WHO figure', 'Job search', WED),
    task('pharma', 'Trace the pharma figure', 'Job search', WED),
    task('natcen', 'Read the NatCen pack', 'Job search', THU),
  ] });
  const cal = new FakeCalendar([
    instance(MAIN, 'Learn Hebrew', TUE, '09:30', '10:15', 'heb'),
    instance(MAIN, 'Learn Hebrew', WED, '09:30', '10:15', 'heb'),
    instance(GYM, 'Gym', TUE, '11:00', '13:00', 'gym'),
    instance(GYM, 'Gym', WED, '11:00', '13:00', 'gym'),
    ev(WORK, 'Signify', TUE, '14:00', '16:00'),
    ev(FAMILY, 'Family day', TUE, '09:00', '19:00'),
  ]);
  return { doc, cal };
}

test('blockTitle', () => {
  assert.equal(blockTitle('Job search ×2', 'exact'), 'Job search ×2');
  assert.equal(blockTitle('Job search ×2', 'rough'), '~ Job search ×2');
  assert.equal(blockTitle('Job search ×2', 'done'), '✓ Job search ×2');
  assert.equal(blockTitle('Job search ×2', 'partial', 1, 2), 'Job search ×2 · 1 of 2 done');
});

test('first run: blocks by area around fixed events, exact today and tomorrow, rough after', () => {
  const { doc, cal } = tuesday();
  const r = step(cal, doc, now(TUE, '08:00'));
  assert.equal(inserts(r).length, 4);
  assert.ok(inserts(r).every((a) => a.calendarId === APP));
  assert.deepEqual(summaries(cal), [
    '2026-09-15 13:15–13:45 Chase the GSS outcome',
    '2026-09-15 16:15–17:15 Write the day out',
    '2026-09-16 13:15–14:15 Job search ×2',
    '2026-09-17 09:00–09:30 ~ Read the NatCen pack',
  ]);
  const rough = cal.byTitle('~ Read the NatCen pack');
  assert.equal(rough.colorId, '4');
  assert.deepEqual(rough.reminders, { useDefault: false, overrides: [] });
  const exact = cal.byTitle('Job search ×2');
  assert.equal(exact.colorId, undefined);
  assert.equal(exact.description, 'dashboard:who\ndashboard:pharma\nPlanned from your dashboard. Move it and it stays where you put it.');
  assert.equal(exact.extendedProperties.private.dashState, 'exact');
  assert.equal(r.days[TUE].blocks.length, 2);
  assert.ok(r.days[TUE].blocks.every((b) => b.eventId));
});

test('running again changes nothing', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  const again = step(cal, doc, now(TUE, '08:00'), first.days);
  assert.deepEqual(again.actions, []);
});

test('a shift on top of a block moves it, and only it, with a note', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  cal.add(ev(WORK, 'Signify', WED, '13:00', '15:00'));
  const r = step(cal, doc, now(TUE, '08:30'), first.days);
  assert.deepEqual(r.actions.map((a) => a.op), ['patch']);
  assert.equal(span(cal.byTitle('Job search ×2')), '15:15–16:15');
  assert.ok(r.days[TUE].notes.includes('Moved Job search ×2 on Wed to 15:15 (Signify)'));
});

test('a block George moves stays where he put it', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  const id = cal.byTitle('Write the day out').id;
  cal.move(id, TUE, '17:30', '18:30');
  const r = step(cal, doc, now(TUE, '08:30'), first.days);
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].eventId, id);
  assert.equal(cal.get(id).extendedProperties.private.dashPin, '1');
  assert.equal(span(cal.get(id)), '17:30–18:30');
  assert.deepEqual(step(cal, doc, now(TUE, '08:35'), r.days).actions, []);
});

test('ticked during its block: the block ends at the tick', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  const ticked = fixture({ items: Object.values(doc.items), logs: [done('chase', TUE, { at: at(TUE, '13:30').toISOString() })] });
  const r = step(cal, ticked, now(TUE, '13:40'), first.days);
  assert.equal(r.actions.length, 1);
  const e = cal.byTitle('✓ Chase the GSS outcome');
  assert.equal(span(e), '13:15–13:30');
  assert.equal(e.extendedProperties.private.dashState, 'done');
});

test('ticked before its block: the block moves to end at the tick', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  const ticked = fixture({ items: Object.values(doc.items), logs: [done('dayout', TUE, { at: at(TUE, '09:05').toISOString() })] });
  const r = step(cal, ticked, now(TUE, '09:10'), first.days);
  assert.equal(r.actions.length, 1);
  assert.equal(span(cal.byTitle('✓ Write the day out')), '08:05–09:05');
});

test('missed: the block goes and the task gets a new slot; ticked later, a record ends at the tick', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  const later = step(cal, doc, now(TUE, '14:00'), first.days);
  assert.deepEqual(later.actions.map((a) => a.op), ['delete', 'insert']);
  assert.equal(span(cal.byTitle('Chase the GSS outcome')), '17:30–18:00');
  assert.deepEqual(later.days[TUE].missed, [{ itemId: 'chase', minutes: 30 }]);
  const ticked = fixture({ items: Object.values(doc.items), logs: [done('chase', TUE, { at: at(TUE, '15:00').toISOString() })] });
  const r = step(cal, ticked, now(TUE, '15:05'), later.days);
  assert.equal(r.actions.length, 1);
  assert.equal(span(cal.byTitle('✓ Chase the GSS outcome')), '14:30–15:00');
  assert.deepEqual(r.days[TUE].missed, []);
});

test('part done when the block ends: the title says so and the rest gets a new slot', () => {
  const doc = fixture({ items: [task('pa', 'Email Sarah', 'Job search', TUE), task('pb', 'Update CV', 'Job search', TUE, { order: 2 })] });
  const cal = new FakeCalendar();
  const first = step(cal, doc, now(TUE, '08:00'));
  assert.equal(span(cal.byTitle('Job search ×2')), '09:00–10:00');
  const ticked = fixture({ items: Object.values(doc.items), logs: [done('pa', TUE, { at: at(TUE, '09:20').toISOString() })] });
  const r = step(cal, ticked, now(TUE, '10:05'), first.days);
  assert.equal(cal.byTitle('Job search ×2 · 1 of 2 done').extendedProperties.private.dashState, 'partial');
  const rest = cal.byTitle('Update CV');
  assert.equal(span(rest), '10:15–10:45');
  assert.equal(rest.extendedProperties.private.dashKey, `${TUE}|job search|1`);
  assert.equal(inserts(r).length, 1);
});

test('a block George deletes is not booked again that day', () => {
  const { doc, cal } = tuesday();
  const first = step(cal, doc, now(TUE, '08:00'));
  cal.remove(cal.byTitle('Job search ×2').id);
  const r = step(cal, doc, now(TUE, '08:30'), first.days);
  assert.deepEqual(r.actions, []);
  assert.deepEqual(r.days[WED].skipped, ['pharma', 'who']);
});

test('Hebrew and Gym: a session George placed stays; the other one moves off it', () => {
  const doc = fixture({ items: [
    { id: 'hebrew', type: 'habit', title: 'Hebrew - app plus Duolingo', area: 'Hebrew', repeat: { kind: 'daily' } },
    { id: 'gym', type: 'habit', title: 'Gym', area: 'Health', repeat: { kind: 'perWeek', n: 5 } },
  ] });
  const cal = new FakeCalendar([
    instance(MAIN, 'Learn Hebrew', TUE, '11:45', '12:30', 'heb', '09:30'),
    instance(GYM, 'Gym', TUE, '11:00', '13:00', 'gym'),
    ev(WORK, 'Signify', TUE, '14:00', '16:00'),
  ]);
  const r = step(cal, doc, now(TUE, '08:00'));
  assert.deepEqual(r.actions.map((a) => a.op), ['patch']);
  assert.equal(span(cal.byTitle('Gym')), '09:30–11:30');
  assert.equal(span(cal.byTitle('Learn Hebrew')), '11:45–12:30');
  assert.ok(r.days[TUE].notes.includes('Moved Gym to 09:30 (Learn Hebrew)'));
  assert.deepEqual(step(cal, doc, now(TUE, '08:10'), r.days).actions, []);
});

test('an event Claude booked for a task counts as its block', () => {
  const doc = fixture({ items: [task('task-chase-gss', 'Chase the GSS outcome', 'Job search', TUE)] });
  const cal = new FakeCalendar([ev(WORK, 'Call about GSS', TUE, '10:30', '11:00', { description: 'dashboard:task-cha' })]);
  assert.deepEqual(step(cal, doc, now(TUE, '08:00')).actions, []);
});

test('a task with a time is a fixed event: blocks go round it, and it gets a tick when done', () => {
  const doc = fixture({ items: [
    task('acday', 'ASSESSMENT CENTRE', 'Assessment centre', WED, { time: '10:30', minutes: 390 }),
    task('who', 'Trace the WHO figure', 'Job search', WED),
    task('pharma', 'Trace the pharma figure', 'Job search', WED),
  ] });
  const cal = new FakeCalendar();
  const first = step(cal, doc, now(TUE, '08:00'));
  const fixed = cal.byTitle('ASSESSMENT CENTRE');
  assert.equal(span(fixed), '10:30–17:00');
  assert.equal(fixed.calendarId, APP);
  assert.equal(fixed.extendedProperties.private.dashState, 'fixed');
  assert.equal(span(cal.byTitle('Job search ×2')), '09:00–10:00');
  const ticked = fixture({ items: Object.values(doc.items), logs: [done('acday', WED, { at: at(WED, '17:05').toISOString() })] });
  step(cal, ticked, now(WED, '18:00'), first.days);
  assert.equal(span(cal.byTitle('✓ ASSESSMENT CENTRE')), '10:30–17:00');
});

test('at 20:00 the day after tomorrow turns exact where it stands', () => {
  const doc = fixture({ items: [task('natcen', 'Read the NatCen pack', 'Job search', THU)] });
  const cal = new FakeCalendar();
  const first = step(cal, doc, now(TUE, '19:00'));
  const roughId = cal.byTitle('~ Read the NatCen pack').id;
  const r = step(cal, doc, now(TUE, '20:05'), first.days);
  assert.deepEqual(r.actions.map((a) => a.op), ['delete', 'insert']);
  assert.equal(cal.get(roughId), undefined);
  const exact = cal.byTitle('Read the NatCen pack');
  assert.equal(span(exact), '09:00–09:30');
  assert.equal(exact.colorId, undefined);
  assert.deepEqual(exact.reminders, { useDefault: true });
});

test("what doesn't fit moves to the next day, with a note", () => {
  const doc = fixture({ items: [task('who', 'Trace the WHO figure', 'Job search', WED), task('pharma', 'Trace the pharma figure', 'Job search', WED)] });
  const cal = new FakeCalendar([ev(WORK, 'Signify', WED, '09:00', '19:00')]);
  const r = step(cal, doc, now(TUE, '08:00'));
  assert.deepEqual(summaries(cal), ['2026-09-17 09:00–10:00 ~ Job search ×2']);
  assert.ok(r.days[TUE].notes.includes("Couldn't fit Job search ×2 on Wed — moved to Thu"));
});

test('the clocks going back: nine o\'clock is nine o\'clock on both sides', () => {
  const doc = fixture({ items: [task('d1', 'Before', '', '2026-10-24'), task('d2', 'After', '', '2026-10-25')] });
  const cal = new FakeCalendar();
  const r = step(cal, doc, at('2026-10-24', '08:00'));
  const starts = Object.fromEntries(inserts(r).map((a) => [a.body.summary, a.body.start.dateTime]));
  assert.deepEqual(starts, { Before: '2026-10-24T08:00:00.000Z', After: '2026-10-25T09:00:00.000Z' });
  assert.ok(inserts(r).every((a) => a.calendarId === MAIN));
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `node --test tests/planner-plan.test.js`
Expected: FAIL — `Cannot find module '.../planner/plan.js'`.

- [ ] **Step 4: Create `planner/plan.js`**

```js
// One planning pass: the dashboard and George's calendars in; the calendar changes to make and the
// planner's day records out. Pure — planner/gas.js reads the calendars, applies the changes and
// keeps the records. The rules are the design's (docs/superpowers/specs/2026-09-14-calendar-planner-design.md):
// blocks by area, around fixed events, exact for the first days and rough after; never moved once
// George has moved them; trimmed, or moved to the tick, when he ticks; removed when missed.

import { addDays, logicalDay, daysBetween, shortWeekday } from '../js/dates.js';
import { readPlannerConfig } from '../js/calendar.js';
import { at, localDay, iso, MINUTE } from './time.js';
import { P, normEvent, atText, movedByGeorge, habitPinned, linkedIds, roughColor } from './events.js';
import { norm, resolveCalendars, calendarFor, habitLinks } from './calendars.js';
import { demand, fixedTasks } from './demand.js';
import { fits, earliestFit, nearestFit, ceilQuarter } from './place.js';

const DESCRIPTION_LINE = 'Planned from your dashboard. Move it and it stays where you put it.';
const HISTORY = new Set(['done', 'partial']);
const MIN_BLOCK = 15 * MINUTE;
const MAX_NOTES = 20;
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const splitIds = (s) => String(s ?? '').split(',').filter(Boolean);

export function blockTitle(base, state, done = 0, total = 0) {
  if (state === 'rough') return `~ ${base}`;
  if (state === 'done') return `✓ ${base}`;
  if (done > 0 && done < total) return `${base} · ${done} of ${total} done`;
  return base;
}

export function blockBody({ key, base, title, start, end, items, state, colorId = null, pinned = false }) {
  const rough = state === 'rough';
  const props = {
    [P.mine]: '1', [P.key]: key, [P.items]: items.join(','), [P.title]: base,
    [P.at]: atText(start, end), [P.state]: state,
  };
  if (pinned) props[P.pin] = '1';
  return {
    summary: title,
    description: [...items.map((id) => `dashboard:${id}`), DESCRIPTION_LINE].join('\n'),
    start: { dateTime: iso(start) },
    end: { dateTime: iso(end) },
    ...(rough && colorId ? { colorId } : {}),
    reminders: rough ? { useDefault: false, overrides: [] } : { useDefault: true },
    extendedProperties: { private: props },
  };
}

// Whether an event already is what `body` describes, so nothing needs writing.
function sameAs(ev, body) {
  const want = body.extendedProperties.private;
  return ev.title === body.summary
    && ev.description === body.description
    && ev.start.getTime() === Date.parse(body.start.dateTime)
    && ev.end.getTime() === Date.parse(body.end.dateTime)
    && (body.colorId === undefined || ev.colorId === body.colorId)
    && ev.useDefault === body.reminders.useDefault
    && Object.keys(want).every((k) => ev.props[k] === want[k]);
}

// The day records with the ids Google gave the new events, matched by block key.
export function fillIds(days, byKey) {
  const out = JSON.parse(JSON.stringify(days));
  for (const rec of Object.values(out)) {
    for (const b of rec.blocks) if (!b.eventId && byKey[b.key]) b.eventId = byKey[b.key];
  }
  return out;
}

export function plan({ doc, now, dayStartHour = 4, calendars, events: raw, eventColors = {}, memory = {} }) {
  const { config, problems: configProblems } = readPlannerConfig(doc);
  const problems = new Set(configProblems);
  const notes = [];
  const note = (text) => { if (!notes.includes(text)) notes.push(text); };
  const gap = config.gapMinutes * MINUTE;
  const nowMs = now.getTime();
  const today = logicalDay(now, dayStartHour);
  const yesterday = addDays(today, -1);
  const days = Array.from({ length: config.days }, (_, i) => addDays(today, i));
  const lastDay = days[days.length - 1];
  const onDay = (d) => (d === today ? '' : ` on ${shortWeekday(d)}`);
  const exactDay = (d) => {
    const i = daysBetween(today, d);
    return i < config.exactDays || (i === config.exactDays && now.getHours() >= config.firmUpHour);
  };

  const { watched, find } = resolveCalendars(calendars, config);
  const watchedIds = new Set(watched.map((c) => c.id));
  const calName = (id) => calendars.find((c) => c.id === id)?.name ?? '';
  const links = habitLinks(doc, config, find, problems);
  const items = doc.items ?? {};
  const itemIds = Object.keys(items);

  const listed = raw.filter((e) => watchedIds.has(e.calendarId)).map((e) => normEvent(e, e.calendarId));
  const present = new Set(listed.map((e) => e.id));
  const timed = listed.filter((e) => !e.cancelled && !e.allDay && e.start && e.end);

  // A task counts as done from the day it's ticked; a habit only on the day ticked. `at` is the
  // latest tick's time, when the log has one.
  const doneLogs = Object.values(doc.logs ?? {}).filter((l) => l.kind === 'done' && l.status === 'active' && l.itemId);
  function tickOf(id, day) {
    const isTask = items[id]?.type === 'task';
    let finished = false;
    let when = null;
    for (const l of doneLogs) {
      if (l.itemId !== id || (isTask ? l.day > day : l.day !== day)) continue;
      finished = true;
      const t = Date.parse(l.at ?? '');
      if (Number.isFinite(t) && (when == null || t > when)) when = t;
    }
    return { finished, at: when };
  }

  const recs = {};
  const rec = (d) => (recs[d] ??= {
    blocks: [], skipped: new Set(memory[d]?.skipped ?? []), missed: [...(memory[d]?.missed ?? [])],
  });
  const covered = new Map();
  const cover = (d, ids) => { const s = covered.get(d) ?? new Set(); for (const id of ids) s.add(id); covered.set(d, s); };
  const usedKeys = new Map();
  const useKey = (d, k) => { const s = usedKeys.get(d) ?? new Set(); s.add(k); usedKeys.set(d, s); };
  const hard = [];
  const busy = (start, end, title) => hard.push({ start, end, title });
  const keep = new Map();
  const actions = [];
  const record = (d, b) => rec(d).blocks.push({
    key: b.key, eventId: b.eventId, calendarId: b.calendarId, calendar: calName(b.calendarId), title: b.title,
    start: iso(b.start), end: iso(b.end), state: b.state, items: b.items,
  });

  // An event's new shape: nothing when it's already right; a patch; or, for a rough block becoming
  // anything else, a fresh event (a patch can't be relied on to take the rough colour off).
  function emit(ev, body, key) {
    if (ev.props[P.state] === 'rough' && body.extendedProperties.private[P.state] !== 'rough') {
      actions.push({ op: 'delete', calendarId: ev.calendarId, eventId: ev.id });
      actions.push({ op: 'insert', calendarId: ev.calendarId, key, body });
      return null;
    }
    if (!sameAs(ev, body)) actions.push({ op: 'patch', calendarId: ev.calendarId, eventId: ev.id, body });
    return ev.id;
  }

  function patchHabit(ev, span, extra, keepAt = false) {
    const props = { ...ev.props, ...extra };
    if (!keepAt) props[P.at] = atText(span.start, span.end);
    const same = span.start === ev.start.getTime() && span.end === ev.end.getTime()
      && Object.keys(props).every((k) => ev.props[k] === props[k]);
    if (same) return;
    actions.push({
      op: 'patch', calendarId: ev.calendarId, eventId: ev.id,
      body: { start: { dateTime: iso(span.start) }, end: { dateTime: iso(span.end) }, extendedProperties: { private: props } },
    });
  }

  // Where finished work goes when it was done outside its block: ending at the tick, as long as the
  // block was, but not starting before whatever came before it that day; at least a quarter hour.
  function recordSpan(tick, length, exceptId) {
    const d = localDay(new Date(tick));
    const before = timed
      .filter((e) => e.id !== exceptId && !e.free && e.end.getTime() <= tick && localDay(e.start) === d)
      .map((e) => e.end.getTime());
    let start = Math.max(tick - length, at(d, '00:00').getTime(), ...before);
    if (tick - start < MIN_BLOCK) start = tick - MIN_BLOCK;
    return { start, end: tick };
  }

  // What George deleted: a block booked last run, not yet over, whose event has gone.
  for (const [d, prev] of Object.entries(memory)) {
    if (d < yesterday) continue;
    for (const b of prev.blocks ?? []) {
      if (!b.eventId || !['rough', 'exact', 'fixed'].includes(b.state)) continue;
      if (present.has(b.eventId) || Date.parse(b.end) <= nowMs) continue;
      const kd = String(b.key).split('|')[0] || d;
      for (const id of b.items ?? []) rec(kd).skipped.add(id);
    }
  }

  // ---- The planner's own events -----------------------------------------------------------------
  const fixedWanted = new Map(fixedTasks({ doc, days, config }).map((f) => [f.key, f]));
  for (const ev of timed.filter((e) => e.mine)) {
    const key = ev.props[P.key] ?? '';
    const kd = key.split('|')[0] || localDay(ev.start);
    const state = ev.props[P.state];
    const ids = splitIds(ev.props[P.items]);
    const base = ev.props[P.title] ?? ev.title;
    const start = ev.start.getTime();
    const end = ev.end.getTime();
    const pinned = movedByGeorge(ev);
    const settle = (span, nextState, title, coverIds = ids, nextBase = base) => {
      const body = blockBody({ key, base: nextBase, title, start: span.start, end: span.end, items: ids, state: nextState, pinned });
      const eventId = emit(ev, body, key);
      busy(span.start, span.end, title);
      cover(kd, coverIds);
      useKey(kd, key);
      record(localDay(new Date(span.start)), { key, eventId, calendarId: ev.calendarId, title, start: span.start, end: span.end, state: nextState, items: ids });
    };

    if (HISTORY.has(state)) {
      settle({ start, end }, state, ev.title, state === 'done' ? ids : ids.filter((id) => tickOf(id, kd).finished));
      continue;
    }
    if (state === 'fixed') {
      const want = fixedWanted.get(key);
      fixedWanted.delete(key);
      const finished = ids.length > 0 && tickOf(ids[0], kd).finished;
      if (!want && !finished && start > nowMs && !pinned) {
        actions.push({ op: 'delete', calendarId: ev.calendarId, eventId: ev.id });
        continue;
      }
      const span = want && !pinned && start > nowMs ? { start: want.start, end: want.end } : { start, end };
      const name = want?.title ?? base;
      settle(span, 'fixed', finished ? `✓ ${name}` : name, ids, name);
      continue;
    }

    const ticks = ids.map((id) => tickOf(id, kd));
    const doneCount = ticks.filter((t) => t.finished).length;
    const lastTick = ticks.reduce((m, t) => (t.at != null && (m == null || t.at > m) ? t.at : m), null);
    const allDone = ids.length > 0 && doneCount === ids.length;

    if (allDone && lastTick != null) {
      let span = { start, end };
      if (lastTick >= start && lastTick < end) span = { start, end: Math.max(lastTick, start + MIN_BLOCK) };
      else if (lastTick < start || localDay(new Date(lastTick)) === localDay(ev.start)) span = recordSpan(lastTick, end - start, ev.id);
      settle(span, 'done', blockTitle(base, 'done'));
      continue;
    }
    if (allDone) {
      if (start > nowMs && !pinned) {
        actions.push({ op: 'delete', calendarId: ev.calendarId, eventId: ev.id });
        continue;
      }
      settle({ start, end }, 'done', blockTitle(base, 'done'));
      continue;
    }
    if (end <= nowMs) {
      if (doneCount > 0) {
        settle({ start, end }, 'partial', blockTitle(base, 'partial', doneCount, ids.length), ids.filter((_, i) => ticks[i].finished));
      } else if (!ids.length) {
        settle({ start, end }, 'done', base);
      } else {
        actions.push({ op: 'delete', calendarId: ev.calendarId, eventId: ev.id });
        for (const id of ids) {
          if (!rec(kd).missed.some((m) => m.itemId === id)) rec(kd).missed.push({ itemId: id, minutes: items[id]?.minutes ?? config.defaultMinutes });
        }
      }
      continue;
    }
    if (start <= nowMs) {
      const nextState = state === 'rough' ? 'exact' : state;
      settle({ start, end }, nextState, blockTitle(base, nextState, doneCount, ids.length));
      continue;
    }
    if (pinned) {
      const nextState = state === 'rough' && exactDay(kd) ? 'exact' : state;
      settle({ start, end }, nextState, blockTitle(base, nextState, doneCount, ids.length));
      continue;
    }
    keep.set(key, ev);
  }

  // Tasks with a time that have no event yet.
  for (const f of fixedWanted.values()) {
    if (f.start <= nowMs || tickOf(f.itemId, f.day).finished || rec(f.day).skipped.has(f.itemId)) continue;
    const cal = calendarFor(f.area, config, find, problems);
    if (!cal) continue;
    actions.push({ op: 'insert', calendarId: cal.id, key: f.key, body: blockBody({ key: f.key, base: f.title, title: f.title, start: f.start, end: f.end, items: [f.itemId], state: 'fixed' }) });
    busy(f.start, f.end, f.title);
    cover(f.day, [f.itemId]);
    useKey(f.day, f.key);
    record(f.day, { key: f.key, eventId: null, calendarId: cal.id, title: f.title, start: f.start, end: f.end, state: 'fixed', items: [f.itemId] });
  }

  // ---- Everything else: fixed events, links to tasks, Hebrew and Gym ------------------------------
  const resolveRef = (ref) => {
    if (items[ref]) return ref;
    if (ref.length < 4) return null;
    const hits = itemIds.filter((id) => id.startsWith(ref));
    return hits.length === 1 ? hits[0] : null;
  };
  const movableHabits = [];
  for (const ev of timed.filter((e) => !e.mine)) {
    const start = ev.start.getTime();
    const end = ev.end.getTime();
    const d = localDay(ev.start);
    const link = links.find((l) => l.calendarId === ev.calendarId && norm(l.title) === norm(ev.title));
    if (!link) {
      if (!ev.free) busy(start, end, ev.title);
      const ids = linkedIds(ev.description).map(resolveRef).filter(Boolean);
      if (ids.length) cover(d, ids);
      continue;
    }
    const tick = tickOf(link.habitId, d);
    if (ev.props[P.state] === 'done' || d < today) { busy(start, end, ev.title); continue; }
    if (tick.finished) {
      let span = { start, end };
      if (tick.at != null && tick.at >= start && tick.at < end) span = { start, end: Math.max(tick.at, start + MIN_BLOCK) };
      else if (tick.at != null && localDay(new Date(tick.at)) === d) span = recordSpan(tick.at, end - start, ev.id);
      patchHabit(ev, span, { [P.state]: 'done', [P.habit]: link.habitId });
      busy(span.start, span.end, ev.title);
      continue;
    }
    const placedByGeorge = habitPinned(ev);
    if (start <= nowMs || placedByGeorge) {
      if (placedByGeorge && ev.props[P.at] && ev.props[P.pin] !== '1') patchHabit(ev, { start, end }, { [P.pin]: '1' }, true);
      busy(start, end, ev.title);
      continue;
    }
    movableHabits.push({ ev, link, day: d });
  }
  movableHabits.sort((a, b) => a.ev.start - b.ev.start);

  // A missed task ticked later today: a record of it, ending at the tick.
  const todayRec = rec(today);
  todayRec.missed = todayRec.missed.filter((m) => {
    const t = tickOf(m.itemId, today);
    if (!t.finished) return true;
    if (t.at == null || covered.get(today)?.has(m.itemId) || !items[m.itemId]) return false;
    const cal = calendarFor(items[m.itemId].area ?? '', config, find, problems);
    if (!cal) return false;
    const key = `${today}|done|${m.itemId}`;
    const span = recordSpan(t.at, m.minutes * MINUTE, null);
    const title = blockTitle(items[m.itemId].title, 'done');
    actions.push({ op: 'insert', calendarId: cal.id, key, body: blockBody({ key, base: items[m.itemId].title, title, start: span.start, end: span.end, items: [m.itemId], state: 'done' }) });
    busy(span.start, span.end, title);
    cover(today, [m.itemId]);
    useKey(today, key);
    record(today, { key, eventId: null, calendarId: cal.id, title, start: span.start, end: span.end, state: 'done', items: [m.itemId] });
    return false;
  });

  // ---- What needs time, and where it goes ---------------------------------------------------------
  const windowOf = (d) => {
    const open = at(d, config.hours[0]).getTime();
    const close = at(d, config.hours[1]).getTime();
    return { open, start: d === today ? Math.max(open, ceilQuarter(nowMs)) : open, end: close };
  };
  const todayWindow = windowOf(today);
  const todayClosed = todayWindow.start + MIN_BLOCK > todayWindow.end;
  for (const d of days) cover(d, rec(d).skipped);
  const { blocks: wanted } = demand({ doc, today, days, config, links, covered, usedKeys, todayClosed });

  const placed = [];
  let overflow = [];
  for (const d of days) {
    const win = windowOf(d);
    for (const { ev, link } of movableHabits.filter((m) => m.day === d)) {
      const start = ev.start.getTime();
      const length = ev.end.getTime() - start;
      const clash = hard.find((h) => start < h.end && h.start < start + length);
      if (!clash) { busy(start, start + length, ev.title); continue; }
      const to = nearestFit(length, start, win, hard, gap);
      if (to == null) {
        note(`${ev.title}${onDay(d)} clashes with ${clash.title} and there's no free time to move it to`);
        busy(start, start + length, ev.title);
        continue;
      }
      patchHabit(ev, { start: to, end: to + length }, { [P.habit]: link.habitId });
      if (exactDay(d)) note(`Moved ${ev.title}${onDay(d)} to ${hhmm(to)} (${clash.title})`);
      busy(to, to + length, ev.title);
    }

    const queue = [...overflow, ...wanted.filter((b) => b.day === d)]
      .sort((a, b) => Number(b.carried) - Number(a.carried) || b.minutes - a.minutes || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    overflow = [];
    const taken = [...hard];
    const slot = new Map();
    const take = (b, s) => { slot.set(b.key, s); taken.push({ start: s, end: s + b.minutes * MINUTE, title: b.base }); };
    if (exactDay(d)) {
      for (const b of queue) {
        const ex = keep.get(b.key);
        if (!ex || localDay(ex.start) !== d) continue;
        const s = ex.start.getTime();
        const e = s + b.minutes * MINUTE;
        if (s >= win.open && e <= win.end && fits(s, e, taken, gap)) take(b, s);
      }
    }
    for (const b of queue) {
      if (slot.has(b.key)) continue;
      const s = earliestFit(b.minutes * MINUTE, win, taken, gap);
      if (s != null) { take(b, s); continue; }
      const next = addDays(d, 1);
      if (next <= lastDay) {
        overflow.push({ ...b, carried: true });
        if (exactDay(d) && !(d === today && todayClosed)) note(`Couldn't fit ${b.base}${onDay(d)} — moved to ${shortWeekday(next)}`);
      } else {
        note(`Couldn't fit ${b.base} in the next ${config.days} days`);
      }
    }
    for (const b of queue) if (slot.has(b.key)) placed.push({ b, day: d, start: slot.get(b.key) });
  }

  for (const { b, day, start } of placed) {
    const end = start + b.minutes * MINUTE;
    const state = exactDay(day) ? 'exact' : 'rough';
    const cal = calendarFor(b.area, config, find, problems);
    if (!cal) continue;
    const title = blockTitle(b.base, state);
    const body = blockBody({ key: b.key, base: b.base, title, start, end, items: b.items, state, colorId: roughColor(cal.backgroundColor, eventColors) });
    const ex = keep.get(b.key);
    keep.delete(b.key);
    let eventId = null;
    if (ex && ex.calendarId === cal.id) {
      eventId = emit(ex, body, b.key);
      if (state === 'exact' && ex.props[P.state] === 'exact' && ex.start.getTime() !== start) {
        const s0 = ex.start.getTime();
        const e0 = ex.end.getTime();
        const why = hard.find((h) => !fits(s0, e0, [h], gap))?.title;
        note(`Moved ${b.base}${onDay(day)} to ${hhmm(start)}${why ? ` (${why})` : ''}`);
      }
    } else {
      if (ex) actions.push({ op: 'delete', calendarId: ex.calendarId, eventId: ex.id });
      actions.push({ op: 'insert', calendarId: cal.id, key: b.key, body });
    }
    record(day, { key: b.key, eventId, calendarId: cal.id, title, start, end, state, items: b.items });
  }
  for (const ex of keep.values()) actions.push({ op: 'delete', calendarId: ex.calendarId, eventId: ex.id });

  const out = {};
  for (const d of [yesterday, ...days]) {
    const r = rec(d);
    out[d] = {
      day: d,
      blocks: [...r.blocks].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)),
      skipped: [...r.skipped].sort(),
      missed: r.missed,
      notes: [],
    };
  }
  const before = memory[today]?.notes ?? [];
  out[today].notes = [...before, ...[...problems, ...notes].filter((n) => !before.includes(n))].slice(-MAX_NOTES);
  return { actions, days: out, problems: [...problems] };
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test tests/planner-plan.test.js` → PASS (16 tests). Then `npm test` → PASS.

If a scenario's times differ from the test, work the placement out by hand from the rules (quarter
hours, the 15-minute gap on both sides, earliest first) before changing either side; the tests'
times were worked out that way.

- [ ] **Step 6: Commit**

```bash
git add planner/plan.js tests/planner-fakes.js tests/planner-plan.test.js
git commit -m "Add the planning pass: ticks, pins, Hebrew and Gym, placement, the calendar changes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
