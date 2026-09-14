# Task 1: Lengths, times and the planner's records

**Files:**
- Modify: `js/doc.js`, `js/parse.js`, `js/data.js`, `sw.js`, `js/flags.js`
- Create: `js/calendar.js`
- Test: `tests/calendar.test.js` (new), `tests/parse.test.js` (append), `tests/flags.test.js` (edit)

**Interfaces:**
- Consumes: `weekday`, `shortWeekday`, `shortDate` (`js/dates.js`); `stableStringify` (`js/doc.js`).
- Produces: everything listed for `js/doc.js`, `js/parse.js`, `js/calendar.js` and `js/data.js` in the
  plan's *Shared interfaces*. Tasks 2–8 import these by exactly those names.

- [ ] **Step 1: Write the failing tests** — create `tests/calendar.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, emptyDoc } from '../js/doc.js';
import {
  CALENDAR_DEFAULTS, checkConfigField, readPlannerConfig, dayRecordId, dayRecord, plannerStatus,
  todaySlots, plannerNotes, visibleNotes, clockLabel, momentLabel, staleSince, timedOrder, plannerSummary,
} from '../js/calendar.js';
import { makeStore } from './helpers.js';

process.env.TZ = 'Europe/London';

const cal = (records) => ({ ...emptyDoc(), calendar: Object.fromEntries(records.map((r) => [r.id, { status: 'active', source: 'planner', ...r }])) });

test('the calendar map is part of the document', () => {
  assert.ok(MAPS.includes('calendar'));
  assert.deepEqual(emptyDoc().calendar, {});
});

test('readPlannerConfig: the defaults, good saved fields over them, a bad field kept at its default and named', () => {
  const plain = readPlannerConfig(emptyDoc());
  assert.deepEqual(plain.config, CALENDAR_DEFAULTS);
  assert.deepEqual(plain.problems, []);
  assert.notEqual(plain.config.hours, CALENDAR_DEFAULTS.hours, 'a copy, never the defaults themselves');
  const { config, problems } = readPlannerConfig(cal([{ id: 'config', hours: ['08:30', '18:00'], gapMinutes: 'lots' }]));
  assert.deepEqual(config.hours, ['08:30', '18:00']);
  assert.equal(config.gapMinutes, 15);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /gapMinutes should be a whole number from 0 to 60/);
});

test('checkConfigField: each setting checked, unknown ones refused by name', () => {
  assert.deepEqual(checkConfigField('hours', ['09:00', '17:30']), ['09:00', '17:30']);
  assert.throws(() => checkConfigField('hours', ['19:00', '09:00']), /the first earlier/);
  assert.throws(() => checkConfigField('hours', '9 to 5'), /two times like/);
  assert.equal(checkConfigField('firmUpHour', 21), 21);
  assert.throws(() => checkConfigField('days', 30), /days should be a whole number from 1 to 14/);
  assert.deepEqual(checkConfigField('areaCalendars', { ' Job search ': ' Application ' }), { 'Job search': 'Application' });
  assert.throws(() => checkConfigField('areaCalendars', ['Application']), /map each area to a calendar name/);
  assert.deepEqual(checkConfigField('habitEvents', [{ habit: 'Gym', calendar: 'Gym', title: 'Gym' }]), [{ habit: 'Gym', calendar: 'Gym', title: 'Gym' }]);
  assert.throws(() => checkConfigField('habitEvents', [{ habit: 'Gym' }]), /should be a list like/);
  assert.throws(() => checkConfigField('colour', 'red'), /The planner has no setting "colour" — settings: hours, /);
});

test('day records: one per weekday, read only when the day matches', () => {
  assert.equal(dayRecordId('2026-09-14'), 'day:1');
  assert.equal(dayRecordId('2026-09-20'), 'day:7');
  const doc = cal([{ id: 'day:2', day: '2026-09-15', blocks: [], skipped: [], missed: [], notes: ['Moved Gym to 09:30 (Learn Hebrew)'] }]);
  assert.equal(dayRecord(doc, '2026-09-15').day, '2026-09-15');
  assert.equal(dayRecord(doc, '2026-09-22'), null, "last week's Tuesday is not this Tuesday");
  assert.deepEqual(plannerNotes(doc, '2026-09-15'), ['Moved Gym to 09:30 (Learn Hebrew)']);
  assert.deepEqual(plannerNotes(doc, '2026-09-16'), []);
  assert.equal(plannerStatus(doc), null);
});

test("todaySlots: today's non-rough blocks by item; the later block wins for an item in two", () => {
  const b = (items, start, end, state) => ({ key: 'k', items, start, end, state, title: 't' });
  const doc = cal([{ id: 'day:2', day: '2026-09-15', skipped: [], missed: [], notes: [], blocks: [
    b(['a', 'b'], '2026-09-15T08:00:00.000Z', '2026-09-15T09:00:00.000Z', 'partial'),
    b(['b'], '2026-09-15T12:00:00.000Z', '2026-09-15T12:30:00.000Z', 'exact'),
    b(['c'], '2026-09-15T13:00:00.000Z', '2026-09-15T13:30:00.000Z', 'rough'),
  ] }]);
  const slots = todaySlots(doc, '2026-09-15');
  assert.deepEqual([...slots.keys()], ['a', 'b']);
  assert.equal(slots.get('b').start, '2026-09-15T12:00:00.000Z');
  assert.equal(clockLabel(slots.get('b').start), '13:00');
});

test('timedOrder: suggestions, then timed rows by time, then the rest in their order, done last', () => {
  const r = (id, extra = {}) => ({ item: { id }, suggested: false, done: false, ...extra });
  const rows = [r('s', { suggested: true }), r('u1'), r('t2'), r('t1'), r('u2'), r('d', { done: true })];
  const slots = new Map([['t1', { start: '2026-09-15T08:00:00.000Z' }], ['t2', { start: '2026-09-15T09:00:00.000Z' }], ['d', { start: '2026-09-15T07:00:00.000Z' }]]);
  assert.deepEqual(timedOrder(rows, slots).map((x) => x.item.id), ['s', 't1', 't2', 'u1', 'u2', 'd']);
});

test('visibleNotes: newest first, at most two, without the ones hidden today', () => {
  assert.deepEqual(visibleNotes(['a', 'b', 'c'], [], '2026-09-15'), ['c', 'b']);
  assert.deepEqual(visibleNotes(['a', 'b', 'c'], ['2026-09-15|c', '2026-09-14|b'], '2026-09-15'), ['b', 'a']);
});

test('staleSince and plannerSummary: quiet while it runs, a warning once it stops, nothing when paused', () => {
  const now = new Date(2026, 8, 15, 14, 0);
  const at = (h, m) => new Date(2026, 8, 15, h, m).toISOString();
  assert.equal(staleSince(emptyDoc(), now), null, 'never run: no warning');
  assert.equal(staleSince(cal([{ id: 'status', lastRun: at(13, 10), lastError: null, version: 'b1' }]), now), null);
  assert.equal(staleSince(cal([{ id: 'status', lastRun: at(12, 0), lastError: null, version: 'b1' }]), now), '12:00');
  assert.equal(staleSince(cal([{ id: 'status', lastRun: at(12, 0), paused: true }]), now), null);
  assert.equal(momentLabel(new Date(2026, 8, 14, 12, 0).toISOString(), now), 'Mon 14 Sep, 12:00');
  assert.deepEqual(plannerSummary(emptyDoc(), now).summary, 'not set up');
  const s = plannerSummary(cal([{ id: 'status', lastRun: at(13, 50), lastError: 'insert "Gym": Rate Limit Exceeded', version: 'b1' }]), now);
  assert.equal(s.summary, 'last ran 13:50');
  assert.equal(s.lines[0], 'Plans 09:00–19:00, 7 days ahead: today and tomorrow exact, rough after that.');
  assert.ok(s.lines.includes('Last problem: insert "Gym": Rate Limit Exceeded'));
});

test('putCalendar: creates, leaves unchanged content alone, replaces changed content', () => {
  const s = makeStore();
  const one = s.putCalendar('status', { lastRun: 'x', lastError: null });
  assert.equal(one.changed, true);
  assert.equal(s.doc().calendar.status.source, 'planner');
  const stamp = s.doc().calendar.status.updated;
  assert.equal(s.putCalendar('status', { lastRun: 'x', lastError: null }).changed, false);
  assert.equal(s.doc().calendar.status.updated, stamp);
  const two = s.putCalendar('config', { hours: ['08:00', '18:00'] }, 'claude');
  assert.equal(two.rec.source, 'claude');
  assert.equal(s.putCalendar('status', { lastRun: 'y', lastError: null }).changed, true);
  assert.equal(s.doc().calendar.status.lastRun, 'y');
});

test('items take a length and, for a task, a time — checked', () => {
  const s = makeStore();
  assert.equal(s.addItem({ type: 'task', title: 'Draft', minutes: 120, time: '09:30' }).minutes, 120);
  assert.equal(s.addItem({ type: 'habit', title: 'Read', minutes: 20 }).minutes, 20);
  assert.throws(() => s.addItem({ type: 'task', title: 'x', minutes: 3 }), /A length should be from 5 minutes to 12 hours/);
  assert.throws(() => s.addItem({ type: 'task', title: 'x', time: '25:00' }), /A time should look like 14:00/);
  assert.throws(() => s.addItem({ type: 'habit', title: 'x', time: '09:00' }), /Only a task has a time/);
  assert.equal(s.addItem({ type: 'task', title: 'plain' }).minutes, undefined);
});
```

Append to `tests/parse.test.js` (keep its existing imports; add this import line under them):

```js
import { parseLength, parseClock, splitTaskInput, checkLength, checkClock } from '../js/parse.js';

test('parseLength: a length from 5 minutes to 12 hours', () => {
  assert.equal(parseLength('45m'), 45);
  assert.equal(parseLength('2h'), 120);
  assert.equal(parseLength('1h30'), 90);
  assert.equal(parseLength('1.5h'), 90);
  assert.equal(parseLength('90'), 90);
  assert.equal(parseLength('3m'), null);
  assert.equal(parseLength('13h'), null);
  assert.equal(parseLength('soon'), null);
});

test('parseClock: a time of day', () => {
  assert.equal(parseClock('14:00'), '14:00');
  assert.equal(parseClock('9:30'), '09:30');
  assert.equal(parseClock('24:00'), null);
  assert.equal(parseClock('9.30'), null);
});

test('splitTaskInput: a trailing length and time come off the title', () => {
  assert.deepEqual(splitTaskInput('Draft cover letter 2h'), { title: 'Draft cover letter', minutes: 120, time: null });
  assert.deepEqual(splitTaskInput('Call NatCen 14:00'), { title: 'Call NatCen', minutes: null, time: '14:00' });
  assert.deepEqual(splitTaskInput('Mock interview 14:00 1h'), { title: 'Mock interview', minutes: 60, time: '14:00' });
  assert.deepEqual(splitTaskInput('Read 20 pages'), { title: 'Read 20 pages', minutes: null, time: null });
  assert.deepEqual(splitTaskInput('2h'), { title: '2h', minutes: null, time: null }, 'a title keeps at least one word');
});

test('checkLength and checkClock: null for nothing, the value when right, a sentence when not', () => {
  assert.equal(checkLength(null), null);
  assert.equal(checkLength(''), null);
  assert.equal(checkLength(30), 30);
  assert.throws(() => checkLength(2.5), /A length should be from 5 minutes to 12 hours/);
  assert.equal(checkClock(null), null);
  assert.equal(checkClock('07:05'), '07:05');
  assert.throws(() => checkClock('7am'), /A time should look like 14:00/);
});
```

In `tests/flags.test.js`, change the two lines that list the maps and the version:

```js
  assert.deepEqual(MAPS, ['items', 'goals', 'milestones', 'logs', 'journal', 'flags', 'changes', 'calendar']);
  assert.deepEqual(emptyDoc(), { schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {}, flags: {}, changes: {}, calendar: {} });
```

```js
  assert.equal(APP_VERSION, 'dash-v7');
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/calendar.test.js tests/parse.test.js tests/flags.test.js`
Expected: FAIL — `Cannot find module '.../js/calendar.js'`, missing `parseLength`, and the `MAPS`/version asserts.

- [ ] **Step 3: `js/doc.js`** — add `calendar`:

```js
export const MAPS = ['items', 'goals', 'milestones', 'logs', 'journal', 'flags', 'changes', 'calendar'];

export function emptyDoc() {
  return { schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {}, flags: {}, changes: {}, calendar: {} };
}
```

- [ ] **Step 4: `js/parse.js`** — append:

```js
// ---- Lengths and times (the calendar planner) ------------------------------------------------

export const LENGTH_MIN = 5;
export const LENGTH_MAX = 720;

// A task's or habit's length in minutes: "45m", "2h", "1h30", "1.5h" or a bare number of minutes,
// from 5 minutes to 12 hours.
export function parseLength(text) {
  const n = parseAmount(text, 'minutes');
  return n != null && n >= LENGTH_MIN && n <= LENGTH_MAX ? n : null;
}

// A time of day, "14:00" or "9:30", as "HH:MM".
export function parseClock(text) {
  const m = String(text ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? `${String(h).padStart(2, '0')}:${m[2]}` : null;
}

const LENGTH_WORD = /^(\d+(\.\d+)?h|\d+m|\d+h\d{1,2}m?)$/i;

// The add box: a trailing length and/or time come off the title ("Draft cover letter 2h", "Call
// NatCen 14:00", "Mock interview 14:00 1h"). A bare number stays in the title ("Read 20"), and the
// title always keeps at least one word.
export function splitTaskInput(text) {
  const words = String(text ?? '').trim().split(/\s+/);
  let minutes = null;
  let time = null;
  while (words.length > 1) {
    const last = words[words.length - 1];
    if (time == null && parseClock(last)) { time = parseClock(last); words.pop(); continue; }
    if (minutes == null && LENGTH_WORD.test(last) && parseLength(last)) { minutes = parseLength(last); words.pop(); continue; }
    break;
  }
  return { title: words.join(' '), minutes, time };
}

export function checkLength(v) {
  if (v == null || v === '') return null;
  if (!(Number.isInteger(v) && v >= LENGTH_MIN && v <= LENGTH_MAX)) throw new Error('A length should be from 5 minutes to 12 hours');
  return v;
}

export function checkClock(v) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || parseClock(v) !== v) throw new Error('A time should look like 14:00');
  return v;
}
```

- [ ] **Step 5: Create `js/calendar.js`**

```js
// The calendar planner's records in the synced document — the `calendar` map — and what the page
// and Claude's tool read from them. Pure. The planner (planner/) writes `day:1` … `day:7` (one per
// weekday, overwritten when that weekday comes round again: the blocks it booked, what George
// deleted or missed, its notes) and `status`; `config` holds its settings, written by Claude or
// seeded by the planner.

import { weekday, shortWeekday, shortDate } from './dates.js';

export const CALENDAR_DEFAULTS = {
  hours: ['09:00', '19:00'], gapMinutes: 15, defaultMinutes: 30, maxBlockMinutes: 150,
  days: 7, exactDays: 2, firmUpHour: 20,
  ignore: ['University of York', 'MiM Committee Meetings', 'Family', 'PhD', 'Holidays in United Kingdom'],
  areaCalendars: { 'Job search': 'Application', 'Assessment centre': 'Application', Health: 'Gym', Challenger: 'Challenger' },
  defaultCalendar: 'main',
  habitEvents: [{ habit: 'Hebrew', calendar: 'main', title: 'Learn Hebrew' }, { habit: 'Gym', calendar: 'Gym', title: 'Gym' }],
};

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const pad = (n) => String(n).padStart(2, '0');
const text = (v) => typeof v === 'string' && v.trim() !== '';
const copy = (v) => JSON.parse(JSON.stringify(v));

export function clockMinutes(hhmm) {
  const m = CLOCK.exec(String(hhmm ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function wholeNumber(lo, hi) {
  return (v, field) => {
    if (!(Number.isInteger(v) && v >= lo && v <= hi)) throw new Error(`${field} should be a whole number from ${lo} to ${hi}`);
    return v;
  };
}

// Each setting's check: the value to keep, or a plain-English reason.
export const CONFIG_CHECKS = {
  hours: (v, field) => {
    const ok = Array.isArray(v) && v.length === 2 && clockMinutes(v[0]) != null && clockMinutes(v[1]) != null
      && clockMinutes(v[0]) < clockMinutes(v[1]);
    if (!ok) throw new Error(`${field} should be two times like ["09:00", "19:00"], the first earlier`);
    return [v[0], v[1]];
  },
  gapMinutes: wholeNumber(0, 60),
  defaultMinutes: wholeNumber(5, 240),
  maxBlockMinutes: wholeNumber(30, 480),
  days: wholeNumber(1, 14),
  exactDays: wholeNumber(1, 7),
  firmUpHour: wholeNumber(12, 23),
  ignore: (v, field) => {
    if (!Array.isArray(v) || !v.every(text)) throw new Error(`${field} should be a list of calendar names`);
    return v.map((s) => s.trim());
  },
  areaCalendars: (v, field) => {
    const ok = v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([a, c]) => text(a) && text(c));
    if (!ok) throw new Error(`${field} should map each area to a calendar name, like {"Job search": "Application"}`);
    return Object.fromEntries(Object.entries(v).map(([a, c]) => [a.trim(), c.trim()]));
  },
  defaultCalendar: (v, field) => {
    if (!text(v)) throw new Error(`${field} should be a calendar name, or "main"`);
    return v.trim();
  },
  habitEvents: (v, field) => {
    const ok = Array.isArray(v) && v.every((l) => l && typeof l === 'object' && text(l.habit) && text(l.calendar) && text(l.title));
    if (!ok) throw new Error(`${field} should be a list like [{"habit": "Gym", "calendar": "Gym", "title": "Gym"}]`);
    return v.map((l) => ({ habit: l.habit.trim(), calendar: l.calendar.trim(), title: l.title.trim() }));
  },
};

export function checkConfigField(field, value) {
  const check = Object.hasOwn(CONFIG_CHECKS, field) ? CONFIG_CHECKS[field] : null;
  if (!check) throw new Error(`The planner has no setting "${field}" — settings: ${Object.keys(CONFIG_CHECKS).join(', ')}`);
  return check(value, field);
}

// The planner's settings: the defaults, with every good saved field over them. A bad saved field
// keeps its default and is named in `problems`.
export function readPlannerConfig(doc) {
  const config = copy(CALENDAR_DEFAULTS);
  const problems = [];
  const saved = doc?.calendar?.config;
  if (saved && saved.status === 'active') {
    for (const field of Object.keys(CONFIG_CHECKS)) {
      if (saved[field] === undefined) continue;
      try {
        config[field] = checkConfigField(field, saved[field]);
      } catch (e) {
        problems.push(`The planner setting ${field} isn't usable (${e.message}), so it's using the default`);
      }
    }
  }
  return { config, problems };
}

export const dayRecordId = (day) => `day:${weekday(day)}`;

export function dayRecord(doc, day) {
  const rec = doc?.calendar?.[dayRecordId(day)];
  return rec && rec.status === 'active' && rec.day === day ? rec : null;
}

export function plannerStatus(doc) {
  const rec = doc?.calendar?.status;
  return rec && rec.status === 'active' ? rec : null;
}

// Today's planned times by item, from today's exact, fixed, done and part-done blocks (rough ones
// never show on the list). An item in two blocks (the rest of a part-done one) shows the later.
export function todaySlots(doc, today) {
  const slots = new Map();
  for (const b of dayRecord(doc, today)?.blocks ?? []) {
    if (b.state === 'rough') continue;
    for (const id of b.items ?? []) {
      const had = slots.get(id);
      if (!had || Date.parse(b.start) > Date.parse(had.start)) slots.set(id, { start: b.start, end: b.end, state: b.state, title: b.title });
    }
  }
  return slots;
}

export const plannerNotes = (doc, today) => [...(dayRecord(doc, today)?.notes ?? [])];

// The notes the header shows: newest first, at most two, without the ones hidden on this device
// today (hidden keys are "<day>|<note>").
export function visibleNotes(notes, hiddenKeys, today) {
  const hidden = new Set(hiddenKeys);
  return notes.filter((n) => !hidden.has(`${today}|${n}`)).reverse().slice(0, 2);
}

export function clockLabel(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const localDayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 'HH:MM' for a moment today; 'Mon 14 Sep, 12:00' for any other day.
export function momentLabel(iso, now) {
  const d = new Date(iso);
  const day = localDayOf(d);
  return day === localDayOf(now) ? clockLabel(iso) : `${shortWeekday(day)} ${shortDate(day)}, ${clockLabel(iso)}`;
}

// When the planner last ran, if that's more than `minutes` ago; null while it's running, before it
// has ever run, and while it's paused.
export function staleSince(doc, now, minutes = 70) {
  const s = plannerStatus(doc);
  if (!s?.lastRun || s.paused) return null;
  return now.getTime() - Date.parse(s.lastRun) > minutes * 60000 ? momentLabel(s.lastRun, now) : null;
}

// Today's rows in the day's order: suggestions stay on top; then undone rows with a time, earliest
// first; then every other row in the order it came (undone, then done).
export function timedOrder(rows, slots) {
  const timed = (r) => !r.suggested && !r.done && slots.has(r.item.id);
  const start = (r) => Date.parse(slots.get(r.item.id).start);
  return [
    ...rows.filter((r) => r.suggested),
    ...rows.filter(timed).sort((a, b) => start(a) - start(b)),
    ...rows.filter((r) => !r.suggested && !timed(r)),
  ];
}

// ⚙ → Calendar planner: the folded line and what's inside.
export function plannerSummary(doc, now) {
  const { config } = readPlannerConfig(doc);
  const exact = config.exactDays === 1 ? 'today exact' : config.exactDays === 2 ? 'today and tomorrow exact' : `the first ${config.exactDays} days exact`;
  const lines = [`Plans ${config.hours[0]}–${config.hours[1]}, ${config.days} days ahead: ${exact}, rough after that.`];
  const s = plannerStatus(doc);
  if (!s) return { summary: 'not set up', lines: [...lines, "It hasn't run yet — the README says how to set it up."] };
  lines.push(`Last ran ${momentLabel(s.lastRun, now)}${s.version ? ` · build ${s.version}` : ''}.`);
  if (s.lastError) lines.push(`Last problem: ${s.lastError}`);
  lines.push('To change its settings, ask Claude — for example "plan between 8:30 and 6".');
  return { summary: s.paused ? 'paused' : `last ran ${momentLabel(s.lastRun, now)}`, lines };
}
```

- [ ] **Step 6: `js/data.js`** — lengths and times on items, and `putCalendar`.

Add `checkLength, checkClock` to the imports:

```js
import { checkLength, checkClock } from './parse.js';
```

In `itemFields`, replace its `return` line with:

```js
    const out = { ...defaults, ...fields, title };
    if (fields.minutes !== undefined) out.minutes = checkLength(fields.minutes);
    if (fields.time !== undefined && fields.time !== null && fields.time !== '') {
      if (fields.type !== 'task') throw new Error('Only a task has a time');
      out.time = checkClock(fields.time);
    }
    return out;
```

Above `// Move `id` to just before`, add:

```js
  // The calendar planner's records (js/calendar.js): created, or given new content. A record whose
  // content is already the same is left alone — nothing is written, so nothing syncs.
  function putCalendar(id, fields, source = 'planner') {
    const content = JSON.parse(JSON.stringify(fields));
    const existing = doc.calendar[id];
    if (existing && existing.status === 'active') {
      const same = existing.source === source
        && Object.keys(content).every((k) => stableStringify(existing[k]) === stableStringify(content[k]));
      if (same) return { rec: existing, changed: false };
      doc.calendar[id] = { ...existing, ...content, id, source, updated: stamp() };
      commit('local');
      return { rec: doc.calendar[id], changed: true };
    }
    return { rec: create('calendar', { ...content, id, source }), changed: true };
  }
```

And in the returned object, after `pruneChanges,`:

```js
    putCalendar,
```

- [ ] **Step 7: `sw.js` and `js/flags.js`** — `const CACHE = 'dash-v7';`, add `'js/calendar.js'` to `SHELL`
right after `'js/changes.js'`; `export const APP_VERSION = 'dash-v7';`.

- [ ] **Step 8: Run the tests**

Run: `node --test tests/calendar.test.js tests/parse.test.js tests/flags.test.js` → PASS. Then `npm test` → PASS
(the merge tests pick `calendar` up through `MAPS`; `tests/sw.test.js` checks `CACHE` and `APP_VERSION` agree).

- [ ] **Step 9: Commit**

```bash
git add js/doc.js js/parse.js js/calendar.js js/data.js sw.js js/flags.js tests/calendar.test.js tests/parse.test.js tests/flags.test.js
git commit -m "Add lengths and times on items, and the calendar planner's records

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
