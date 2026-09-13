# Task 4: Reading the dashboard

**Files:**
- Create: `claude/ids.js`, `claude/text.js`, `claude/read.js`
- Test: `tests/claude-read.test.js`

**Interfaces:**
- Consumes: `js/schedule.js` (`todayRows, streak, weekTotal, doneBetween, doneIndex, milestonesOf,
  goalProgress, history, dayDetail, dayCompletion`), `js/dates.js`, `js/parse.js` (`formatAmount,
  formatProgress`), `js/flags.js` (`openFlags`), `js/changes.js` (`changeList`), `js/doc.js` (`MAPS`).
- Produces: `shortId, resolveId` (ids.js); `q, dayName, when, toDay, TYPE_NAMES, repeatText, amountText`
  (text.js); `header, READS` (read.js) — signatures in the plan's Shared interfaces. Every read is
  `(doc, today, arg) => string`.

- [ ] **Step 1: Write the failing tests** — create `tests/claude-read.test.js`:

```js
process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, done, amount } from './helpers.js';
import { shortId, resolveId } from '../claude/ids.js';
import { q, dayName, toDay, repeatText, amountText } from '../claude/text.js';
import { header, READS } from '../claude/read.js';

const TODAY = '2026-09-13'; // a Sunday

const doc = () => fixture({
  items: [
    { id: 't1', type: 'task', title: 'Email Sarah', date: TODAY, source: 'claude' },
    { id: 't2', type: 'task', title: 'Update CV', date: '2026-09-10' },
    { id: 't3', type: 'task', title: 'Book flights', date: '2026-09-20', area: 'Travel' },
    { id: 'h1', type: 'habit', title: 'Read 20 pages', repeat: { kind: 'daily' }, goalId: 'g1' },
    { id: 'h2', type: 'habit', title: 'Hebrew', repeat: { kind: 'daily' } },
    { id: 'q1', type: 'quota', title: 'Applications', target: 5, unit: 'count', unitLabel: 'applications' },
    { id: 's1', type: 'task', title: 'Book dentist', date: '2026-09-15', status: 'suggested', source: 'claude' },
    { id: 'x1', type: 'task', title: 'Old CV idea', date: TODAY, status: 'dismissed' },
  ],
  logs: [
    done('h1', '2026-09-11'), done('h1', '2026-09-12'), done('h2', TODAY),
    amount('a1', 'q1', '2026-09-08', 2),
  ],
  goals: [
    { id: 'g1', title: 'Research job', targetDate: '2026-12-01', target: null },
    { id: 'g2', title: 'NatCen application', status: 'suggested', source: 'claude', target: null },
  ],
  milestones: [
    { id: 'm1', goalId: 'g1', title: 'CV updated', done: true, order: 1 },
    { id: 'm2', goalId: 'g1', title: 'Apply to 5', done: false, order: 2 },
  ],
  journal: [
    { id: 'digest:2026-09-07', kind: 'digest', day: '2026-09-07', summary: 'A good week.', wins: ['CV'], slipped: ['Gym'], focus: 'Apply', source: 'gemini' },
    { id: 'checkin:2026-09-12', kind: 'checkin', day: '2026-09-12', questions: ['How did it go?'], answers: ['Fine'], feedback: 'Nice work.', source: 'gemini' },
  ],
  flags: [{ id: 'f1', text: 'Button too small', updated: '2026-09-12T10:00:00.000Z' }],
  changes: [
    { id: 'c1', at: '2026-09-12T13:02:00.000Z', summary: 'Added task "Email Sarah" for today', edits: [], undoneAt: null, pruned: false, source: 'claude' },
    { id: 'c2', at: '2026-09-11T09:00:00.000Z', summary: 'Archived task "X"', edits: [], undoneAt: '2026-09-11T10:00:00.000Z', pruned: false, source: 'claude' },
  ],
});

test('shortId shortens random ids only; resolveId finds one record by id or prefix', () => {
  assert.equal(shortId('a1b2c3d4-e5f6-4789-9abc-def012345678'), 'a1b2c3d4');
  assert.equal(shortId('checkin:2026-09-13'), 'checkin:2026-09-13');
  const d = fixture({ items: [{ id: 'abcd1234-0000-4000-8000-000000000000', type: 'task', title: 'A', date: TODAY },
    { id: 'abce9999-0000-4000-8000-000000000000', type: 'task', title: 'B', date: TODAY }] });
  assert.equal(resolveId(d, '#abcd12').rec.title, 'A');
  assert.equal(resolveId(d, 'abcd1234-0000-4000-8000-000000000000').map, 'items');
  assert.throws(() => resolveId(d, 'abc'), /too short/);
  assert.throws(() => resolveId(d, 'abcd'), /abcd matches 2 records/);
  assert.throws(() => resolveId(d, 'ffff'), /Nothing has the id ffff/);
  assert.throws(() => resolveId(d, 'abcd12', ['goals']), /Nothing has the id abcd12/);
});

test('the wording helpers', () => {
  assert.equal(q('Email Sarah'), '"Email Sarah"');
  assert.equal(q('x'.repeat(80)).length, 72);
  assert.equal(dayName(TODAY, TODAY), 'today');
  assert.equal(dayName('2026-09-18', TODAY), 'Fri 18 Sep');
  assert.equal(toDay('today', TODAY), TODAY);
  assert.equal(toDay('Tomorrow', TODAY), '2026-09-14');
  assert.equal(toDay('yesterday', TODAY), '2026-09-12');
  assert.equal(toDay('2026-09-30', TODAY), '2026-09-30');
  assert.throws(() => toDay('2026-02-30', TODAY), /isn't a date/);
  assert.throws(() => toDay('fri', TODAY), /use YYYY-MM-DD, today, tomorrow or yesterday/);
  assert.equal(repeatText({ kind: 'daily' }), 'every day');
  assert.equal(repeatText({ kind: 'weekdays', days: [1, 3] }), 'on Mon, Wed');
  assert.equal(repeatText({ kind: 'perWeek', n: 3 }), '3× a week');
  assert.equal(repeatText({ kind: 'weekly', day: 5 }), 'every Fri');
  assert.equal(repeatText({ kind: 'monthly', date: 1 }), 'monthly on the 1st');
  assert.equal(repeatText({ kind: 'monthly', date: 22 }), 'monthly on the 22nd');
  assert.equal(amountText(45, 'minutes'), '45m');
  assert.equal(amountText(90, 'minutes'), '1.5h');
  assert.equal(amountText(5, 'count', 'applications'), '5 applications');
});

test('every read starts with the date and the day\'s count', () => {
  assert.equal(header(doc(), TODAY), 'Today is Sunday 13 September (2026-09-13) · 1 of 4 done');
  for (const [name, read] of Object.entries(READS)) {
    assert.match(read(doc(), TODAY, name === 'day' ? 'today' : 'cv'), /^Today is Sunday 13 September/, name);
  }
});

test('today: suggestions, then to do, then done, each with its id', () => {
  const text = READS.today(doc(), TODAY);
  const lines = text.split('\n');
  const at = (s) => lines.indexOf(s);
  assert.ok(at('Suggested (waiting for ✓/✕ in the app):') < at('To do:'));
  assert.ok(at('To do:') < at('Done:'));
  assert.ok(lines.includes('  ? task "Book dentist" #s1 · for Tue · by Claude'));
  assert.ok(lines.includes('  [ ] task "Email Sarah" #t1 · by Claude'));
  assert.ok(lines.includes('  [ ] task "Update CV" #t2 · from Thu'));
  assert.ok(lines.includes('  [ ] habit "Read 20 pages" #h1 · streak 2'));
  assert.ok(lines.includes('  [ ] weekly target "Applications" #q1 · 2 / 5 applications this week'));
  assert.ok(lines.includes('  [x] habit "Hebrew" #h2'));
  assert.doesNotMatch(text, /Old CV idea|Book flights/);
});

test('week, goals and list', () => {
  const week = READS.week(doc(), TODAY);
  assert.match(week, /^This week \(from Mon 7 Sep\):$/m);
  assert.match(week, /^ {2}target "Applications" #q1 · 2 \/ 5 applications$/m);
  const goals = READS.goals(doc(), TODAY);
  assert.match(goals, /^\? suggested goal "NatCen application" #g2 · 0 of 0 milestones \(0%\) · by Claude$/m);
  assert.match(goals, /^goal "Research job" #g1 · 1 of 2 milestones \(50%\) · by Tue 1 Dec$/m);
  assert.match(goals, /^ {2}\[x\] milestone "CV updated" #m1$/m);
  assert.match(goals, /^ {2}\[ \] milestone "Apply to 5" #m2$/m);
  assert.match(goals, /^ {2}· habit "Read 20 pages" #h1$/m);
  const list = READS.list(doc(), TODAY);
  assert.match(list, /^Upcoming tasks:\n {2}task "Book flights" #t3 · Sun 20 Sep · Travel$/m);
  assert.match(list, /^ {2}habit "Hebrew" #h2 · every day$/m);
  assert.match(list, /^ {2}target "Applications" #q1 · 5 applications a week$/m);
});

test('find, day and history', () => {
  const found = READS.find(doc(), TODAY, 'cv');
  assert.match(found, /^ {2}task "Update CV" #t2 · Thu 10 Sep$/m);
  assert.match(found, /^ {2}milestone "CV updated" #m1$/m);
  assert.doesNotMatch(found, /Old CV idea/);
  assert.throws(() => READS.find(doc(), TODAY, ''), /find needs some words/);
  const day = READS.day(doc(), TODAY, '2026-09-08');
  assert.match(day, /^Tuesday 8 September \(2026-09-08\)/m);
  assert.match(day, /^ {2}logged 2 applications on "Applications" #a1$/m);
  const hist = READS.history(doc(), TODAY).split('\n');
  assert.equal(hist.length, 5);
  assert.match(hist[2], /^ {2}w\/c Mon 24 Aug: Mon /);
  assert.match(hist[4], /Sun 1\/4$/);
});

test('journal, flags and changes', () => {
  const journal = READS.journal(doc(), TODAY);
  assert.match(journal, /^Weekly digest, week of Mon 7 Sep:\n {2}A good week\.$/m);
  assert.match(journal, /^ {2}Went well: CV$/m);
  assert.match(journal, /^ {2}Focus: Apply$/m);
  assert.match(journal, /^Check-in, Sat 12 Sep:\n {2}Q: How did it go\?\n {2}A: Fine\n {2}Coach: Nice work\.$/m);
  assert.match(READS.flags(doc(), TODAY), /^ {2}"Button too small" #f1 · Sat 12 Sep, 11:00$/m);
  const changes = READS.changes(doc(), TODAY);
  assert.match(changes, /^ {2}#c1 · Sat 12 Sep, 14:02 · Added task "Email Sarah" for today$/m);
  assert.match(changes, /^ {2}#c2 · .* · Archived task "X" · undone$/m);
  assert.match(READS.changes(doc(), TODAY, '1'), /Claude's last 1 changes/);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/claude-read.test.js`
Expected: FAIL — `Cannot find module '.../claude/ids.js'`.

- [ ] **Step 3: Create `claude/ids.js`**

```js
// Records as the tool shows them to Claude: a short id (the first 8 characters of a random id; a
// readable id such as 'checkin:2026-09-13' in full), and finding a record again from one.

import { MAPS } from '../js/doc.js';

const RANDOM = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

export const shortId = (id) => (RANDOM.test(id) ? id.slice(0, 8) : id);

// The one record in `maps` whose id is `ref`, or starts with it. A leading # is ignored. Throws a
// sentence Claude can act on when there is none, or more than one.
export function resolveId(doc, ref, maps = MAPS) {
  const key = String(ref ?? '').trim().replace(/^#/, '');
  if (key.length < 4) throw new Error(`"${ref}" is too short to be an id — use the id the tool shows`);
  const found = [];
  for (const map of maps) {
    for (const id of Object.keys(doc[map] ?? {})) {
      if (id === key) return { map, id, rec: doc[map][id] };
      if (id.startsWith(key)) found.push({ map, id, rec: doc[map][id] });
    }
  }
  if (found.length === 1) return found[0];
  if (!found.length) throw new Error(`Nothing has the id ${key}`);
  throw new Error(`${key} matches ${found.length} records — use more of the id`);
}
```

- [ ] **Step 4: Create `claude/text.js`**

```js
// Wording shared by the tool's reads and its change summaries.

import { addDays, shortWeekday, shortDate } from '../js/dates.js';
import { formatAmount } from '../js/parse.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const TYPE_NAMES = { task: 'task', habit: 'habit', quota: 'weekly target' };

// A title in quotes, clipped.
export function q(text, n = 70) {
  const t = String(text ?? '');
  return `"${t.length > n ? `${t.slice(0, n - 1)}…` : t}"`;
}

export const dayName = (day, today) => (day === today ? 'today' : `${shortWeekday(day)} ${shortDate(day)}`);

const pad = (n) => String(n).padStart(2, '0');

// A moment in the process's time zone (the tool sets it from the config first): 'Sat 12 Sep, 14:02'.
// Built by hand rather than with toLocaleString, whose en-GB months vary by ICU version ('Sept').
export function when(iso) {
  const d = new Date(iso);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${shortWeekday(day)} ${shortDate(day)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// A day from what Claude typed: today, tomorrow, yesterday or a real YYYY-MM-DD.
export function toDay(value, today) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'today') return today;
  if (v === 'tomorrow') return addDays(today, 1);
  if (v === 'yesterday') return addDays(today, -1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v) return v;
  throw new Error(`"${value}" isn't a date — use YYYY-MM-DD, today, tomorrow or yesterday`);
}

const ordinal = (n) => {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
};

export function repeatText(repeat = { kind: 'daily' }) {
  const r = repeat ?? { kind: 'daily' };
  switch (r.kind) {
    case 'weekdays': return `on ${(r.days ?? []).map((d) => WEEKDAYS[d - 1]).join(', ')}`;
    case 'perWeek': return `${r.n}× a week`;
    case 'weekly': return `every ${WEEKDAYS[r.day - 1]}`;
    case 'monthly': return `monthly on the ${r.date}${ordinal(r.date)}`;
    default: return 'every day';
  }
}

export function amountText(value, unit, label = '') {
  if (unit === 'minutes') return formatAmount(value, 'minutes');
  return `${formatAmount(value, 'count')}${label ? ` ${label}` : ''}`;
}
```

- [ ] **Step 5: Create `claude/read.js`**

```js
// The tool's read commands: the dashboard as short plain text for Claude, with an id on every
// line to act on. Each is (doc, today, arg) => string and starts with header().

import {
  todayRows, streak, weekTotal, doneBetween, doneIndex, milestonesOf, goalProgress, history, dayDetail,
  dayCompletion,
} from '../js/schedule.js';
import { longDate, weekStart, addDays, shortWeekday, carryLabel, forLabel } from '../js/dates.js';
import { formatProgress } from '../js/parse.js';
import { openFlags } from '../js/flags.js';
import { changeList } from '../js/changes.js';
import { shortId } from './ids.js';
import { q, dayName, when, toDay, TYPE_NAMES, repeatText, amountText } from './text.js';

const SOURCES = { claude: 'Claude', gemini: 'Gemini', hebrew: 'Hebrew app', notion: 'Notion' };
const by = (rec) => (SOURCES[rec.source] ? ` · by ${SOURCES[rec.source]}` : '');
const tag = (id) => `#${shortId(id)}`;
const values = (map) => Object.values(map ?? {});
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
const live = (doc) => values(doc.items).filter((i) => i.status === 'active').sort(byOrder);
const perWeekNote = (doc, item, today, idx) => {
  const start = weekStart(today);
  return `${doneBetween(doc, item.id, start, addDays(start, 7), idx)} of ${item.repeat.n}`;
};

export function header(doc, today) {
  const { done, total } = dayCompletion(doc, today);
  return `Today is ${longDate(today)} (${today}) · ${done} of ${total} done`;
}

function rowLine(doc, row, today, idx) {
  const { item } = row;
  const mark = row.suggested ? '?' : row.done ? '[x]' : '[ ]';
  const parts = [`${mark} ${TYPE_NAMES[item.type]} ${q(item.title)} ${tag(item.id)}`];
  if (row.suggested && item.type === 'task' && item.date && item.date !== today) parts.push(forLabel(item.date, today));
  if (row.carriedFrom) parts.push(carryLabel(row.carriedFrom, today));
  if (item.type === 'habit' && !row.suggested) {
    const s = streak(doc, item, today);
    if (s.current > 1) parts.push(`streak ${s.current}`);
    if (item.repeat?.kind === 'perWeek') parts.push(`${perWeekNote(doc, item, today, idx)} this week`);
  }
  if (item.type === 'quota') {
    const total = row.total ?? weekTotal(doc, item.id, today);
    parts.push(`${formatProgress(total, item.target, item.unit)}${item.unitLabel ? ` ${item.unitLabel}` : ''} this week`);
  }
  if (item.area) parts.push(item.area);
  return `  ${parts.join(' · ')}${by(item)}`;
}

function today(doc, day) {
  const rows = todayRows(doc, day);
  const idx = doneIndex(doc);
  const out = [header(doc, day)];
  const groups = [
    ['Suggested (waiting for ✓/✕ in the app)', rows.filter((r) => r.suggested)],
    ['To do', rows.filter((r) => !r.suggested && !r.done)],
    ['Done', rows.filter((r) => !r.suggested && r.done)],
  ];
  for (const [name, list] of groups) {
    if (list.length) out.push(`${name}:`, ...list.map((r) => rowLine(doc, r, day, idx)));
  }
  if (!rows.length) out.push('Nothing on today.');
  return out.join('\n');
}

function week(doc, day) {
  const idx = doneIndex(doc);
  const out = [header(doc, day), `This week (from ${dayName(weekStart(day), day)}):`];
  for (const i of live(doc).filter((x) => x.type === 'quota')) {
    const total = weekTotal(doc, i.id, day);
    out.push(`  target ${q(i.title)} ${tag(i.id)} · ${formatProgress(total, i.target, i.unit)}${i.unitLabel ? ` ${i.unitLabel}` : ''}${total >= i.target ? ' · met' : ''}`);
  }
  for (const i of live(doc).filter((x) => x.type === 'habit' && x.repeat?.kind === 'perWeek')) {
    const n = doneBetween(doc, i.id, weekStart(day), addDays(weekStart(day), 7), idx);
    out.push(`  habit ${q(i.title)} ${tag(i.id)} · ${n} of ${i.repeat.n}${n >= i.repeat.n ? ' · met' : ''}`);
  }
  if (out.length === 2) out.push('  No weekly targets or times-a-week habits.');
  return out.join('\n');
}

function goals(doc, day) {
  const list = values(doc.goals)
    .filter((g) => g.status === 'active' || g.status === 'suggested')
    .sort((a, b) => (a.status === b.status ? byOrder(a, b) : a.status === 'suggested' ? -1 : 1));
  const out = [header(doc, day)];
  if (!list.length) out.push('No goals.');
  for (const g of list) {
    const p = goalProgress(doc, g);
    const progress = p.numeric
      ? `${amountText(p.done, 'count', g.unitLabel)} of ${amountText(p.total, 'count', g.unitLabel)} (${p.pct}%)`
      : `${p.done} of ${p.total} milestones (${p.pct}%)`;
    const due = g.targetDate ? ` · by ${dayName(g.targetDate, day)}` : '';
    out.push(`${g.status === 'suggested' ? '? suggested ' : ''}goal ${q(g.title)} ${tag(g.id)} · ${progress}${due}${by(g)}`);
    if (g.why) out.push(`  why: ${g.why}`);
    for (const m of milestonesOf(doc, g.id)) {
      out.push(`  ${m.status === 'suggested' ? '?' : m.done ? '[x]' : '[ ]'} milestone ${q(m.title)} ${tag(m.id)}`);
    }
    for (const i of values(doc.items).filter((x) => x.goalId === g.id && (x.status === 'active' || x.status === 'suggested')).sort(byOrder)) {
      out.push(`  · ${i.status === 'suggested' ? 'suggested ' : ''}${TYPE_NAMES[i.type]} ${q(i.title)} ${tag(i.id)}`);
    }
  }
  return out.join('\n');
}

function list(doc, day) {
  const items = live(doc);
  const out = [header(doc, day)];
  const section = (name, rows) => { if (rows.length) out.push(`${name}:`, ...rows); };
  const area = (i) => (i.area ? ` · ${i.area}` : '');
  section('Upcoming tasks', items
    .filter((i) => i.type === 'task' && i.date > day)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : byOrder(a, b)))
    .map((i) => `  task ${q(i.title)} ${tag(i.id)} · ${dayName(i.date, day)}${area(i)}${by(i)}`));
  section('Habits', items.filter((i) => i.type === 'habit')
    .map((i) => `  habit ${q(i.title)} ${tag(i.id)} · ${repeatText(i.repeat)}${area(i)}${by(i)}`));
  section('Weekly targets', items.filter((i) => i.type === 'quota')
    .map((i) => `  target ${q(i.title)} ${tag(i.id)} · ${amountText(i.target, i.unit, i.unitLabel)} a week${area(i)}${by(i)}`));
  if (out.length === 1) out.push('Nothing beyond today.');
  return out.join('\n');
}

function find(doc, day, words) {
  const needle = String(words ?? '').trim().toLowerCase();
  if (!needle) throw new Error('find needs some words to look for');
  const kinds = { items: (r) => TYPE_NAMES[r.type], goals: () => 'goal', milestones: () => 'milestone', flags: () => 'flag' };
  const hits = [];
  for (const [map, kind] of Object.entries(kinds)) {
    for (const r of values(doc[map])) {
      if (r.status === 'dismissed') continue;
      const text = r.title ?? r.text ?? '';
      if (!text.toLowerCase().includes(needle)) continue;
      const extra = [r.status !== 'active' ? r.status : null, r.type === 'task' && r.date ? dayName(r.date, day) : null].filter(Boolean);
      hits.push(`  ${kind(r)} ${q(text)} ${tag(r.id)}${extra.length ? ` · ${extra.join(' · ')}` : ''}`);
    }
  }
  return [header(doc, day), hits.length ? `Matches for ${q(needle)}:` : `Nothing matches ${q(needle)}.`, ...hits].join('\n');
}

function day(doc, today, arg) {
  const d = toDay(arg || 'today', today);
  const { rows, amounts } = dayDetail(doc, d);
  const { done, total } = dayCompletion(doc, d);
  const out = [header(doc, today), `${longDate(d)} (${d}) · ${done} of ${total} done`];
  for (const r of rows) out.push(`  ${r.done ? '[x]' : '[ ]'} ${TYPE_NAMES[r.item.type]} ${q(r.item.title)} ${tag(r.item.id)}`);
  for (const { log, item, goal } of amounts) {
    const on = item ?? goal;
    const label = item ? item.unitLabel : goal?.unitLabel;
    out.push(`  logged ${amountText(log.amount, item?.unit ?? 'count', label ?? '')} on ${q(on?.title ?? '?')} ${tag(log.id)}${log.note ? ` · ${log.note}` : ''}`);
  }
  if (!rows.length && !amounts.length) out.push('  Nothing on this day.');
  return out.join('\n');
}

function hist(doc, today) {
  const cells = history(doc, today);
  const out = [header(doc, today), 'Last three weeks (done of total):'];
  for (let w = 0; w < 3; w++) {
    const days = cells.slice(w * 7, w * 7 + 7);
    out.push(`  w/c ${dayName(days[0].day, today)}: ${days.map((c) => `${shortWeekday(c.day)} ${c.future ? '–' : `${c.done}/${c.total}`}`).join(' · ')}`);
  }
  return out.join('\n');
}

function journal(doc, today) {
  const recs = values(doc.journal).filter((r) => r.status === 'active');
  const newest = (a, b) => (a.day < b.day ? 1 : -1);
  const digest = recs.filter((r) => r.kind === 'digest').sort(newest)[0];
  const checkins = recs.filter((r) => r.kind === 'checkin').sort(newest).slice(0, 3);
  const out = [header(doc, today)];
  if (digest) {
    out.push(`Weekly digest, week of ${dayName(digest.day, today)}:`, `  ${digest.summary}`);
    if (digest.wins?.length) out.push(`  Went well: ${digest.wins.join('; ')}`);
    if (digest.slipped?.length) out.push(`  Slipped: ${digest.slipped.join('; ')}`);
    if (digest.focus) out.push(`  Focus: ${digest.focus}`);
  } else {
    out.push('No weekly digest yet.');
  }
  for (const c of checkins) {
    out.push(`Check-in, ${dayName(c.day, today)}:`);
    (c.questions ?? []).forEach((question, i) => out.push(`  Q: ${question}`, `  A: ${c.answers?.[i] || '(not answered)'}`));
    if (c.feedback) out.push(`  Coach: ${c.feedback}`);
  }
  if (!checkins.length) out.push('No check-ins yet.');
  return out.join('\n');
}

function flags(doc, today) {
  const open = openFlags(doc);
  return [header(doc, today), open.length ? 'Open flags (newest first):' : 'No open flags.',
    ...open.map((f) => `  ${q(f.text, 200)} ${tag(f.id)} · ${when(f.updated)}${by(f)}`)].join('\n');
}

function changes(doc, today, arg) {
  const n = Number(arg) > 0 ? Math.floor(Number(arg)) : 10;
  const list = changeList(doc).slice(0, n);
  const state = (c) => (c.undoneAt ? ' · undone' : c.pruned ? ' · too old to undo' : '');
  return [header(doc, today), list.length ? `Claude's last ${list.length} changes (newest first):` : "Claude hasn't changed anything yet.",
    ...list.map((c) => `  ${tag(c.id)} · ${when(c.at)} · ${c.summary}${state(c)}`)].join('\n');
}

export const READS = { today, week, goals, list, find, day, history: hist, journal, flags, changes };
```

- [ ] **Step 6: Run the tests**

Run: `node --test tests/claude-read.test.js` → PASS (7 tests). If a line assertion fails, compare the
printed text with the expected line character by character before changing either — the expected lines
are the design. Then `npm test` → PASS.

- [ ] **Step 7: Commit**

```bash
git add claude/ids.js claude/text.js claude/read.js tests/claude-read.test.js
git commit -m "Add the tool's read commands: today, week, goals, list, find, day, history, journal, flags, changes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
