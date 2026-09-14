# Task 2: Events, calendars and finding time

**Files:**
- Create: `planner/time.js`, `planner/events.js`, `planner/calendars.js`, `planner/place.js`
- Test: `tests/planner-parts.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks except `CALENDAR_DEFAULTS` (Task 1) in the test.
- Produces: the `planner/time.js`, `planner/events.js`, `planner/calendars.js` and `planner/place.js`
  entries in the plan's *Shared interfaces*. Tasks 3–5 import them by those names.

- [ ] **Step 1: Write the failing tests** — create `tests/planner-parts.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at, localDay, iso, MINUTE } from '../planner/time.js';
import { P, normEvent, atText, movedByGeorge, habitPinned, linkedIds, roughColor } from '../planner/events.js';
import { norm, resolveCalendars, calendarFor, habitLinks } from '../planner/calendars.js';
import { QUARTER, ceilQuarter, fits, earliestFit, nearestFit } from '../planner/place.js';
import { CALENDAR_DEFAULTS } from '../js/calendar.js';
import { fixture } from './helpers.js';

process.env.TZ = 'Europe/London';

const COLORS = { 1: '#a4bdfc', 2: '#7ae7bf', 3: '#dbadff', 4: '#ff887c', 5: '#fbd75b', 6: '#ffb878', 7: '#46d6db', 8: '#e1e1e1', 9: '#5484ed', 10: '#51b749', 11: '#dc2127' };
const LIST = [
  { id: 'main', name: 'Tasks', primary: true, backgroundColor: '#9fe1e7' },
  { id: 'app', name: 'Application ', backgroundColor: '#f83a22' },
  { id: 'gym', name: 'Gym ', backgroundColor: '#7bd148' },
  { id: 'uni', name: 'University of York - Personal timetable: George Wightman', backgroundColor: '#cccccc' },
  { id: 'hol', name: 'Holidays in United Kingdom', backgroundColor: '#16a765' },
];

test('local times, across the clocks going back', () => {
  assert.equal(at('2026-10-24', '09:00').toISOString(), '2026-10-24T08:00:00.000Z');
  assert.equal(at('2026-10-25', '09:00').toISOString(), '2026-10-25T09:00:00.000Z');
  assert.equal(localDay(new Date('2026-09-15T23:30:00.000Z')), '2026-09-16');
  assert.equal(iso(at('2026-09-15', '13:15').getTime()), '2026-09-15T12:15:00.000Z');
  assert.equal(MINUTE, 60000);
});

test('normEvent: what the planner needs from a Google event', () => {
  const e = normEvent({
    id: 'e1', summary: 'Signify', description: 'Shift', start: { dateTime: '2026-09-15T14:00:00+01:00' }, end: { dateTime: '2026-09-15T16:00:00+01:00' },
    attendees: [{ email: 'me', self: true }, { email: 'boss' }], transparency: 'transparent', reminders: { useDefault: false },
    recurringEventId: 'r', originalStartTime: { dateTime: '2026-09-15T13:00:00+01:00' }, colorId: '4',
    extendedProperties: { private: { dash: '1', dashKey: 'k' } },
  }, 'work');
  assert.equal(e.calendarId, 'work');
  assert.equal(e.title, 'Signify');
  assert.equal(e.start.toISOString(), '2026-09-15T13:00:00.000Z');
  assert.equal(e.others, 1);
  assert.equal(e.free, true);
  assert.equal(e.mine, true);
  assert.equal(e.useDefault, false);
  assert.equal(e.originalStart.toISOString(), '2026-09-15T12:00:00.000Z');
  const allDay = normEvent({ id: 'e2', summary: 'Holiday', start: { date: '2026-09-15' }, end: { date: '2026-09-16' } }, 'hol');
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.start, null);
  assert.equal(allDay.mine, false);
  assert.equal(allDay.useDefault, true);
});

test('movedByGeorge and habitPinned: where the planner put it versus where it is', () => {
  const s = at('2026-09-15', '13:15');
  const e = at('2026-09-15', '13:45');
  const block = (props, start = s, end = e) => normEvent({ id: 'b', start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() }, extendedProperties: { private: props } }, 'app');
  assert.equal(movedByGeorge(block({ dash: '1', [P.at]: atText(s, e) })), false);
  assert.equal(movedByGeorge(block({ dash: '1', [P.at]: atText(s, e) }, at('2026-09-15', '17:30'), at('2026-09-15', '18:00'))), true);
  assert.equal(movedByGeorge(block({ dash: '1', [P.at]: atText(s, e), [P.pin]: '1' })), true);
  const inst = (start, original, props = {}) => normEvent({ id: 'h', start: { dateTime: start.toISOString() }, end: { dateTime: new Date(start.getTime() + 45 * MINUTE).toISOString() }, originalStartTime: { dateTime: original.toISOString() }, extendedProperties: { private: props } }, 'main');
  assert.equal(habitPinned(inst(at('2026-09-15', '09:30'), at('2026-09-15', '09:30'))), false);
  assert.equal(habitPinned(inst(at('2026-09-15', '11:45'), at('2026-09-15', '09:30'))), true, 'moved by hand from its series time');
  const moved = at('2026-09-15', '10:30');
  assert.equal(habitPinned(inst(moved, at('2026-09-15', '09:30'), { [P.at]: atText(moved, new Date(moved.getTime() + 45 * MINUTE)) })), false, 'moved by the planner');
});

test('linkedIds and roughColor', () => {
  assert.deepEqual(linkedIds('Prep\ndashboard:a1b2c3d4\ndashboard:task-chase-gss'), ['a1b2c3d4', 'task-chase-gss']);
  assert.deepEqual(linkedIds(''), []);
  assert.equal(roughColor('#f83a22', COLORS), '4', 'red calendar → Tomato → Flamingo');
  assert.equal(roughColor('#4986e7', COLORS), '1', 'blue → Blueberry → Lavender');
  assert.equal(roughColor('#a4bdfc', COLORS), '8', 'already a light colour → Graphite');
  assert.equal(roughColor('not a colour', COLORS), '8');
});

test('resolveCalendars: ignored by the start of the name, found by name ignoring case and spaces', () => {
  const { watched, find } = resolveCalendars(LIST, CALENDAR_DEFAULTS);
  assert.deepEqual(watched.map((c) => c.id), ['main', 'app', 'gym']);
  assert.equal(find('main').id, 'main');
  assert.equal(find('gym').id, 'gym');
  assert.equal(find('Application').id, 'app');
  assert.equal(find('Challenger'), null);
  assert.equal(norm('  Job Search '), 'job search');
});

test('calendarFor: by area, the default for the rest, the main calendar with a note when a name is missing', () => {
  const { find } = resolveCalendars(LIST, CALENDAR_DEFAULTS);
  const problems = new Set();
  assert.equal(calendarFor('job search', CALENDAR_DEFAULTS, find, problems).id, 'app');
  assert.equal(calendarFor('Health', CALENDAR_DEFAULTS, find, problems).id, 'gym');
  assert.equal(calendarFor('', CALENDAR_DEFAULTS, find, problems).id, 'main');
  assert.equal(problems.size, 0);
  assert.equal(calendarFor('Challenger', CALENDAR_DEFAULTS, find, problems).id, 'main');
  assert.deepEqual([...problems], ['Can\'t find the "Challenger" calendar — blocks for Challenger went to your main calendar']);
});

test('habitLinks: a habit by the start of its title or its id; ambiguous or missing ones noted', () => {
  const { find } = resolveCalendars(LIST, CALENDAR_DEFAULTS);
  const doc = fixture({ items: [
    { id: 'heb', type: 'habit', title: 'Hebrew - app plus Duolingo', area: 'Hebrew' },
    { id: 'gym1', type: 'habit', title: 'Gym', area: 'Health' },
    { id: 'gym2', type: 'habit', title: 'Gym stretches', area: 'Health' },
  ] });
  const problems = new Set();
  const links = habitLinks(doc, CALENDAR_DEFAULTS, find, problems);
  assert.deepEqual(links, [{ habitId: 'heb', calendarId: 'main', title: 'Learn Hebrew', area: 'Hebrew' }]);
  assert.match([...problems][0], /can't tell which habit "Gym" is \(more than one match\)/);
  const byId = habitLinks(doc, { ...CALENDAR_DEFAULTS, habitEvents: [{ habit: 'gym1', calendar: 'Gym', title: 'Gym' }] }, find, new Set());
  assert.deepEqual(byId.map((l) => l.habitId), ['gym1']);
});

test('finding time: quarter hours, the gap, the window, the nearest start', () => {
  const t = (hhmm) => at('2026-09-15', hhmm).getTime();
  assert.equal(ceilQuarter(t('09:01')), t('09:15'));
  assert.equal(ceilQuarter(t('09:15')), t('09:15'));
  assert.equal(QUARTER, 15 * MINUTE);
  const busy = [{ start: t('09:30'), end: t('10:15') }, { start: t('11:00'), end: t('13:00') }];
  const gap = 15 * MINUTE;
  assert.equal(fits(t('10:30'), t('10:45'), busy, gap), true);
  assert.equal(fits(t('10:30'), t('11:00'), busy, gap), false);
  const win = { start: t('09:00'), end: t('19:00') };
  assert.equal(earliestFit(60 * MINUTE, win, busy, gap), t('13:15'));
  assert.equal(earliestFit(15 * MINUTE, win, busy, gap), t('10:30'));
  assert.equal(earliestFit(11 * 60 * MINUTE, win, busy, gap), null);
  assert.equal(nearestFit(120 * MINUTE, t('11:00'), win, [{ start: t('11:45'), end: t('12:30') }], gap), t('09:30'));
  assert.equal(nearestFit(30 * MINUTE, t('12:00'), win, [{ start: t('11:00'), end: t('13:00') }], 0), t('10:30'), 'earlier on a tie');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/planner-parts.test.js`
Expected: FAIL — `Cannot find module '.../planner/time.js'`.

- [ ] **Step 3: Create `planner/time.js`**

```js
// Moments on George's days, in local time. The tests set TZ=Europe/London; Apps Script uses the
// project's time zone (Europe/London in appsscript.json), so a planning hour is a wall-clock hour
// on both sides of a clock change.

export const MINUTE = 60000;
const pad = (n) => String(n).padStart(2, '0');

export function at(day, hhmm) {
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, h, min);
}

export const localDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const iso = (msOrDate) => new Date(msOrDate).toISOString();
```

- [ ] **Step 4: Create `planner/events.js`**

```js
// Google Calendar events as the planner sees them. Pure. The planner marks every event it makes
// with private properties George never sees — that it's the planner's, which block, which items,
// the title without its prefixes, where it last put it, its state, whether George has moved it — so
// its memory of each block lives on the event itself.

export const P = {
  mine: 'dash', key: 'dashKey', items: 'dashItems', title: 'dashTitle', at: 'dashAt',
  state: 'dashState', pin: 'dashPin', habit: 'dashHabit',
};

const when = (v) => (v ? new Date(v) : null);

export function normEvent(raw, calendarId) {
  const allDay = !!raw.start?.date && !raw.start?.dateTime;
  const props = { ...(raw.extendedProperties?.private ?? {}) };
  return {
    id: raw.id,
    calendarId,
    title: String(raw.summary ?? ''),
    description: String(raw.description ?? ''),
    start: allDay ? null : when(raw.start?.dateTime),
    end: allDay ? null : when(raw.end?.dateTime),
    allDay,
    free: raw.transparency === 'transparent',
    others: (raw.attendees ?? []).filter((a) => !a.self && !a.resource).length,
    cancelled: raw.status === 'cancelled',
    recurringEventId: raw.recurringEventId ?? null,
    originalStart: when(raw.originalStartTime?.dateTime),
    props,
    mine: props[P.mine] === '1',
    colorId: raw.colorId ?? null,
    useDefault: raw.reminders?.useDefault ?? true,
  };
}

export const atText = (start, end) => `${new Date(start).toISOString()}/${new Date(end).toISOString()}`;

// George has moved it: marked so already, or no longer where the planner last put it.
export function movedByGeorge(ev) {
  if (ev.props[P.pin] === '1') return true;
  const at = ev.props[P.at];
  if (!at || !ev.start || !ev.end) return false;
  const [s, e] = at.split('/');
  return Date.parse(s) !== ev.start.getTime() || Date.parse(e) !== ev.end.getTime();
}

// A Hebrew or Gym session George placed himself: away from where the planner put it, or — if the
// planner never touched it — away from its series' own time.
export function habitPinned(ev) {
  if (ev.props[P.at] || ev.props[P.pin]) return movedByGeorge(ev);
  return !!ev.originalStart && !!ev.start && ev.originalStart.getTime() !== ev.start.getTime();
}

// "dashboard:<id>" lines: Claude writes the id as its tool shows it (the first 8 characters).
export function linkedIds(description) {
  return [...String(description ?? '').matchAll(/dashboard:([\w:.-]+)/g)].map((m) => m[1]);
}

// Google's event colours pair up dark and light. A rough block takes the light partner of the event
// colour nearest its calendar's colour — Graphite when that colour is already a light one.
const PALE = { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '5', 7: '1', 8: '8', 9: '1', 10: '2', 11: '4' };

function rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

export function roughColor(calendarHex, eventColors) {
  const c = rgb(calendarHex);
  if (!c) return '8';
  let best = null;
  let bestDistance = Infinity;
  for (const [id, hex] of Object.entries(eventColors ?? {}).sort(([a], [b]) => Number(a) - Number(b))) {
    const e = rgb(hex);
    if (!e) continue;
    const d = (c[0] - e[0]) ** 2 + (c[1] - e[1]) ** 2 + (c[2] - e[2]) ** 2;
    if (d < bestDistance) { best = id; bestDistance = d; }
  }
  const pale = best == null ? '8' : PALE[best] ?? '8';
  return pale === best ? '8' : pale;
}
```

- [ ] **Step 5: Create `planner/calendars.js`**

```js
// Which of George's calendars the planner reads, which one each area's blocks go on, and which
// habits are linked to events — from its settings, by the names George sees. Pure.

export const norm = (s) => String(s ?? '').trim().toLowerCase();

// list: [{ id, name, primary, backgroundColor, accessRole }]. A calendar is ignored when its name
// starts with an `ignore` entry; `main` is the primary calendar.
export function resolveCalendars(list, config) {
  const prefixes = config.ignore.map(norm).filter(Boolean);
  const watched = list.filter((c) => !prefixes.some((p) => norm(c.name).startsWith(p)));
  const find = (name) => (norm(name) === 'main'
    ? list.find((c) => c.primary)
    : list.find((c) => norm(c.name) === norm(name))) ?? null;
  return { watched, find };
}

export function calendarFor(area, config, find, problems) {
  const key = Object.keys(config.areaCalendars).find((a) => norm(a) === norm(area));
  const wanted = key ? config.areaCalendars[key] : config.defaultCalendar;
  const cal = find(wanted);
  if (cal) return cal;
  problems.add(`Can't find the "${wanted}" calendar — ${area ? `blocks for ${area}` : 'those blocks'} went to your main calendar`);
  return find('main');
}

// Each `habitEvents` entry names its habit by id or by the start of its title. One matching no
// active habit, or more than one, is skipped with a note (its events are then just fixed events).
export function habitLinks(doc, config, find, problems) {
  const habits = Object.values(doc.items ?? {}).filter((i) => i.type === 'habit' && i.status === 'active');
  const links = [];
  for (const link of config.habitEvents) {
    const byId = habits.filter((h) => h.id === link.habit);
    const matches = byId.length ? byId : habits.filter((h) => norm(h.title).startsWith(norm(link.habit)));
    if (matches.length !== 1) {
      problems.add(`The planner can't tell which habit "${link.habit}" is (${matches.length ? 'more than one match' : 'no match'}) — its events are treated as fixed`);
      continue;
    }
    const cal = find(link.calendar);
    if (!cal) {
      problems.add(`Can't find the "${link.calendar}" calendar for ${link.title}`);
      continue;
    }
    links.push({ habitId: matches[0].id, calendarId: cal.id, title: link.title, area: String(matches[0].area ?? '').trim() });
  }
  return links;
}
```

- [ ] **Step 6: Create `planner/place.js`**

```js
// Finding time. Pure. Times are milliseconds; a window is { start, end }, busy is [{ start, end }].
// Starts fall on the quarter hour, and a block keeps `gap` clear of everything busy.

export const QUARTER = 15 * 60000;

export const ceilQuarter = (ms) => Math.ceil(ms / QUARTER) * QUARTER;

export function fits(start, end, busy, gap) {
  return busy.every((b) => end + gap <= b.start || start >= b.end + gap);
}

export function earliestFit(length, window, busy, gap) {
  for (let s = ceilQuarter(window.start); s + length <= window.end; s += QUARTER) {
    if (fits(s, s + length, busy, gap)) return s;
  }
  return null;
}

// The free start nearest `want`; the earlier one on a tie.
export function nearestFit(length, want, window, busy, gap) {
  let best = null;
  for (let s = ceilQuarter(window.start); s + length <= window.end; s += QUARTER) {
    if (!fits(s, s + length, busy, gap)) continue;
    if (best == null || Math.abs(s - want) < Math.abs(best - want)) best = s;
  }
  return best;
}
```

- [ ] **Step 7: Run the tests**

Run: `node --test tests/planner-parts.test.js` → PASS. Then `npm test` → PASS.

- [ ] **Step 8: Commit**

```bash
git add planner/time.js planner/events.js planner/calendars.js planner/place.js tests/planner-parts.test.js
git commit -m "Add the planner's parts: local times, events and pins, calendars, finding time

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
