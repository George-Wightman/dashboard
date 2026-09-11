# Task 3: Coach context and week stats

Part of [the Gemini coach plan](../2026-09-11-gemini-coach.md) — read its Global Constraints first.

**Files:**
- Create: `js/coach.js`
- Test: `tests/coach-context.test.js`

**Interfaces:**
- Consumes: `addDays`, `weekStart`, `shortWeekday`, `shortDate`, `longDate`, `carryLabel` from
  `js/dates.js`; `rowsForDay`, `doneIndex`, `dayCompletion`, `streak`, `weekTotal`, `countsOn`,
  `goalProgress`, `milestonesOf`, `doneBetween` from `js/schedule.js`; `formatAmount` from
  `js/parse.js`; `journalId` from `js/doc.js` (Task 1); `fixture`, `done`, `amount` from
  `tests/helpers.js` (`fixture` takes `journal` since Task 1).
- Produces (all pure):
  - `CONTEXT_CAP` (4000) and `clip(text, n)`.
  - `coachContext(doc, today)` — the context block. It has these parts:
    - `Today: <weekday> <d> <month> <yyyy>`
    - today's counted rows (active items only; suggestions left out): `✓`/`✗`, title, `[area]`, then
      `carried from Wed` and/or the streak (`6-day streak`, `3-week streak`, `4 in a row`; only from 2 up)
    - this week's active quotas, as `Title: done of target` via `formatAmount` (`3.5h of 6h`, `3 of 5`)
    - `Last 7 days:` today first, `Fri 1/2 · Thu 1/2 · …`
    - active goals: `Title — pct%, target 10 Nov; next: <first two undone milestones>`
    - `Recent check-ins (his answers):` — the three days before today, non-blank answers only,
      each clipped to 300 characters

    An empty section reads `Today's list: nothing scheduled` / `This week's targets: none` /
    `Goals: none`, and the check-ins section is left out. At most 25 rows, 10 targets and 8 goals are
    listed, each list ending with `…and N more` when cut. The whole block is cut to `CONTEXT_CAP`.
  - `weekStats(doc, monday)` — the shape is in the plan's Shared interfaces. Habits count due days and
    ticks from `rowsForDay`, except `perWeek` habits: ticks that week out of `n`, since they stay on the
    list until met. A task counts once however many days it was carried, and counts as done if it was
    ticked that week.
  - `checkinOf`, `digestOf`, `digestDue`, `checkinState`, `proposedItems` — the readers the Coach panel
    and the suggested-goal card use (Tasks 5–7).

- [ ] **Step 1: Write the failing test**

`tests/coach-context.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coachContext, weekStats, checkinOf, digestOf, digestDue, checkinState, proposedItems, clip, CONTEXT_CAP,
} from '../js/coach.js';
import { fixture, done, amount } from './helpers.js';

const TODAY = '2026-09-11'; // a Friday

const checkin = (day, fields = {}) => ({
  id: `checkin:${day}`, kind: 'checkin', day, questions: ['Q'], answers: [], feedback: '', tomorrowIds: [],
  source: 'gemini', ...fields,
});

// George's Friday: a 6-day Hebrew streak, a task carried from Wednesday, two weekly targets, a goal.
function friday() {
  return fixture({
    items: [
      { id: 'heb', type: 'habit', title: 'Hebrew practice', area: 'Hebrew', repeat: { kind: 'daily' }, order: 1 },
      { id: 'sarah', type: 'task', title: 'Email Sarah', area: 'Job', date: '2026-09-09', order: 2 },
      { id: 'js', type: 'quota', title: 'Job search', target: 360, unit: 'minutes', unitLabel: '', order: 3 },
      { id: 'apps', type: 'quota', title: 'Applications', target: 5, unit: 'count', unitLabel: '', order: 4 },
      { id: 'idea', type: 'task', title: 'Only a suggestion', date: TODAY, status: 'suggested', source: 'gemini', order: 5 },
    ],
    logs: [
      ...['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'].map((d) => done('heb', d)),
      amount('js1', 'js', '2026-09-08', 90), amount('js2', 'js', '2026-09-10', 120),
      amount('ap1', 'apps', '2026-09-07', 1), amount('ap2', 'apps', '2026-09-09', 2),
    ],
    goals: [{ id: 'role', title: 'Land an analyst role', targetDate: '2026-11-10', target: null, unit: 'count', unitLabel: '', order: 1 }],
    milestones: [
      { id: 'm1', goalId: 'role', title: 'CV finished', done: true, order: 1 },
      { id: 'm2', goalId: 'role', title: 'Five applications sent', done: false, order: 2 },
      { id: 'm3', goalId: 'role', title: 'First interview', done: false, order: 3 },
    ],
    journal: [
      checkin('2026-09-10', { answers: ['Sent two applications', '', 'Start earlier'], feedback: 'Good.' }),
      checkin('2026-09-07', { answers: ['Four days ago, so left out'] }),
      checkin(TODAY, { answers: ["Today's own answers go in the feedback prompt"] }),
    ],
  });
}

// ---- the context block -------------------------------------------------------------------------

test('the context names the real items, numbers and recent answers', () => {
  assert.equal(coachContext(friday(), TODAY), [
    'Today: Friday 11 September 2026',
    "Today's list:",
    '✓ Hebrew practice [Hebrew] — 6-day streak',
    '✗ Email Sarah [Job] — carried from Wed',
    "This week's targets:",
    'Job search: 3.5h of 6h',
    'Applications: 3 of 5',
    'Last 7 days: Fri 1/2 · Thu 1/2 · Wed 1/2 · Tue 1/1 · Mon 1/1 · Sun 1/1 · Sat 0/1',
    'Goals:',
    'Land an analyst role — 33%, target 10 Nov; next: Five applications sent, First interview',
    'Recent check-ins (his answers):',
    'Thu: Sent two applications / Start earlier',
  ].join('\n'));
});

test('the context of an empty document says so plainly', () => {
  assert.equal(coachContext(fixture(), TODAY), [
    'Today: Friday 11 September 2026',
    "Today's list: nothing scheduled",
    "This week's targets: none",
    'Last 7 days: Fri 0/0 · Thu 0/0 · Wed 0/0 · Tue 0/0 · Mon 0/0 · Sun 0/0 · Sat 0/0',
    'Goals: none',
  ].join('\n'));
});

test('the context stays under its size cap however much there is', () => {
  const long = 'x'.repeat(500);
  const items = Array.from({ length: 300 }, (_, i) => ({
    id: `h${i}`, type: 'habit', title: `${long}${i}`, area: long, repeat: { kind: 'daily' }, order: i,
  }));
  const goals = Array.from({ length: 50 }, (_, i) => ({ id: `g${i}`, title: long, order: i }));
  const journal = [checkin('2026-09-10', { answers: [long, long, long] })];
  const text = coachContext(fixture({ items, goals, journal }), TODAY);
  assert.ok(text.length <= CONTEXT_CAP, `${text.length} characters`);
  assert.ok(text.startsWith('Today: Friday 11 September 2026\n'));
  assert.match(text, /…and 275 more/);
});

test('clip collapses whitespace and marks a cut', () => {
  assert.equal(clip('  two\n  lines ', 80), 'two lines');
  assert.equal(clip('abcdefghij', 5), 'abcd…');
  assert.equal(clip(undefined, 5), '');
});

// ---- a week's numbers --------------------------------------------------------------------------

// The week of Monday 31 August 2026.
function lastWeek() {
  const since = { created: '2026-08-25' };
  return fixture({
    items: [
      { id: 'heb', type: 'habit', title: 'Hebrew', repeat: { kind: 'daily' }, order: 1, ...since },
      { id: 'gym', type: 'habit', title: 'Gym', repeat: { kind: 'weekdays', days: [1, 3, 5] }, order: 2, ...since },
      { id: 'run', type: 'habit', title: 'Run', repeat: { kind: 'perWeek', n: 2 }, order: 3, ...since },
      { id: 'cv', type: 'task', title: 'CV', date: '2026-08-30', order: 4, ...since },
      { id: 'call', type: 'task', title: 'Call', date: '2026-09-04', order: 5, ...since },
      { id: 'later', type: 'task', title: 'Later', date: '2026-09-07', order: 6, ...since },
      { id: 'apps', type: 'quota', title: 'Apps', target: 5, unit: 'count', unitLabel: 'applications', order: 7, ...since },
    ],
    logs: [
      done('heb', '2026-08-31'), done('heb', '2026-09-01'), done('heb', '2026-09-03'),
      done('gym', '2026-09-02'), done('run', '2026-09-01'), done('cv', '2026-09-02'),
      amount('a1', 'apps', '2026-09-01', 2), amount('a2', 'apps', '2026-09-06', 1), amount('a3', 'apps', '2026-09-07', 4),
    ],
    goals: [{ id: 'job', title: 'Job', target: null, unit: 'count', unitLabel: '', order: 1, ...since }],
    milestones: [
      { id: 'm1', goalId: 'job', title: 'A', done: true, order: 1 },
      { id: 'm2', goalId: 'job', title: 'B', done: false, order: 2 },
    ],
  });
}

test('weekStats counts habits, tasks, targets, goals and days for one Monday–Sunday week', () => {
  assert.deepEqual(weekStats(lastWeek(), '2026-08-31'), {
    monday: '2026-08-31',
    sunday: '2026-09-06',
    days: [
      { day: '2026-08-31', done: 1, total: 4 },
      { day: '2026-09-01', done: 2, total: 3 },
      { day: '2026-09-02', done: 2, total: 4 },
      { day: '2026-09-03', done: 1, total: 2 },
      { day: '2026-09-04', done: 0, total: 4 },
      { day: '2026-09-05', done: 0, total: 3 },
      { day: '2026-09-06', done: 0, total: 3 },
    ],
    habits: [
      { id: 'heb', title: 'Hebrew', done: 3, scheduled: 7 },
      { id: 'gym', title: 'Gym', done: 1, scheduled: 3 },
      { id: 'run', title: 'Run', done: 1, scheduled: 2 },
    ],
    tasks: { done: 1, total: 2 },
    targets: [{ id: 'apps', title: 'Apps', total: 3, target: 5, unit: 'count', unitLabel: 'applications' }],
    goals: [{ id: 'job', title: 'Job', pct: 50, done: 1, total: 2, numeric: false, unit: 'count', week: 0 }],
    amounts: 2,
    empty: false,
  });
});

test('weekStats takes any day of the week, and knows an empty week', () => {
  const doc = lastWeek();
  assert.deepEqual(weekStats(doc, '2026-09-03'), weekStats(doc, '2026-08-31'));
  assert.equal(weekStats(doc, '2026-08-17').empty, true);
  const onlyAnAmount = fixture({ logs: [amount('x', 'apps', '2026-08-18', 1)] });
  assert.equal(weekStats(onlyAnAmount, '2026-08-17').empty, false);
});

// ---- readers -----------------------------------------------------------------------------------

test('checkinOf and digestOf find the one record for a day or week', () => {
  const doc = fixture({
    journal: [
      checkin('2026-09-10', { feedback: 'Good.' }),
      { id: 'digest:2026-08-31', kind: 'digest', day: '2026-08-31', summary: 'S', wins: [], slipped: [], focus: 'F' },
    ],
  });
  assert.equal(checkinOf(doc, '2026-09-10').feedback, 'Good.');
  assert.equal(checkinOf(doc, '2026-09-11'), null);
  assert.equal(digestOf(doc, '2026-08-31').summary, 'S');
  assert.equal(digestOf(doc, '2026-09-02').summary, 'S'); // any day of that week
  assert.equal(digestOf(doc, '2026-09-07'), null);
});

test("digestDue: last week's Monday until its digest exists, and never for an empty week", () => {
  const doc = lastWeek();
  assert.equal(digestDue(doc, '2026-09-08'), '2026-08-31');
  assert.equal(digestDue(doc, '2026-09-13'), '2026-08-31'); // still last week's on the Sunday
  doc.journal['digest:2026-08-31'] = {
    id: 'digest:2026-08-31', kind: 'digest', day: '2026-08-31', summary: 'S', wins: [], slipped: [], focus: 'F',
    source: 'gemini', status: 'active', created: '2026-09-07', archivedOn: null, updated: '2026-09-07T09:00:00.000Z',
  };
  assert.equal(digestDue(doc, '2026-09-08'), null);
  assert.equal(digestDue(doc, '2026-08-26'), null); // the week of 17 Aug had nothing in it
});

test('checkinState: early, due, questions, done, and no key', () => {
  const base = { today: TODAY, dayStartHour: 4, checkinHour: 18, hasKey: true };
  const at = (hour) => new Date(2026, 8, 11, hour, 0);
  const none = fixture();
  assert.equal(checkinState({ ...base, doc: none, now: at(17) }), 'early');
  assert.equal(checkinState({ ...base, doc: none, now: at(18) }), 'due');
  assert.equal(checkinState({ ...base, doc: none, now: at(12), checkinHour: 12 }), 'due');
  assert.equal(checkinState({ ...base, doc: none, now: new Date(2026, 8, 12, 1, 0) }), 'due'); // 1am is still Friday evening
  assert.equal(checkinState({ ...base, doc: none, now: at(20), hasKey: false }), 'nokey');
  const asked = fixture({ journal: [checkin(TODAY, { questions: ['How did it go?'] })] });
  assert.equal(checkinState({ ...base, doc: asked, now: at(10) }), 'questions');
  const answered = fixture({ journal: [checkin(TODAY, { answers: ['Well'], feedback: 'Good.' })] });
  assert.equal(checkinState({ ...base, doc: answered, now: at(20), hasKey: false }), 'done');
  const yesterday = fixture({ journal: [checkin('2026-09-10', { feedback: 'Old.' })] });
  assert.equal(checkinState({ ...base, doc: yesterday, now: at(20) }), 'due');
});

test('proposedItems lists the still-suggested items linked to a goal, in order', () => {
  const doc = fixture({
    items: [
      { id: 'b', type: 'quota', title: 'B', target: 1, goalId: 'g', status: 'suggested', order: 2 },
      { id: 'a', type: 'habit', title: 'A', goalId: 'g', status: 'suggested', order: 1 },
      { id: 'taken', type: 'habit', title: 'Taken', goalId: 'g', order: 3 },
      { id: 'other', type: 'habit', title: 'Other', goalId: 'h', status: 'suggested', order: 4 },
    ],
  });
  assert.deepEqual(proposedItems(doc, 'g').map((i) => i.id), ['a', 'b']);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `js/coach.js`.

- [ ] **Step 3: Implement**

`js/coach.js`:

```js
// The coach's view of the document: the plain-text summary Gemini is given, a week's numbers, and
// the small readers the Coach panel needs. Pure: a document and a day in, values out.

import { addDays, weekStart, shortWeekday, shortDate, longDate, carryLabel } from './dates.js';
import {
  rowsForDay, doneIndex, dayCompletion, streak, weekTotal, countsOn, goalProgress, milestonesOf, doneBetween,
} from './schedule.js';
import { formatAmount } from './parse.js';
import { journalId } from './doc.js';

export const CONTEXT_CAP = 4000;
const ROW_CAP = 25;
const TARGET_CAP = 10;
const GOAL_CAP = 8;
const ANSWER_CAP = 300;

const values = (map) => Object.values(map ?? {});
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

// One line of at most n characters: whitespace collapsed, and … where it was cut.
export function clip(text, n) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

// A check-in's non-blank answers.
const answersOf = (checkin) => (Array.isArray(checkin?.answers) ? checkin.answers : [])
  .filter((a) => typeof a === 'string' && a.trim());

// A heading and its lines, with "…and N more" when `lines` is a cut-down `total`, or the heading
// and `none` on one line when there is nothing.
function section(heading, lines, total, none) {
  if (!total) return [`${heading} ${none}`];
  return [heading, ...lines, ...(total > lines.length ? [`…and ${total - lines.length} more`] : [])];
}

function streakText(item, s) {
  if (s.current < 2) return null;
  const kind = item.repeat?.kind ?? 'daily';
  if (kind === 'perWeek') return `${s.current}-week streak`;
  if (kind === 'daily') return `${s.current}-day streak`;
  return `${s.current} in a row`;
}

function rowLine(doc, row, today) {
  const { item } = row;
  const notes = [];
  if (row.carriedFrom) notes.push(`carried ${carryLabel(row.carriedFrom, today)}`);
  if (row.kind === 'habit') {
    const text = streakText(item, streak(doc, item, today));
    if (text) notes.push(text);
  }
  const area = item.area ? ` [${clip(item.area, 30)}]` : '';
  return `${row.done ? '✓' : '✗'} ${clip(item.title, 80)}${area}${notes.length ? ` — ${notes.join(', ')}` : ''}`;
}

// 'Job search: 3.5h of 6h' · 'Applications: 3 of 5'. Works on a quota item or a weekStats target.
function targetLine(target, total) {
  const unit = target.unit ?? 'count';
  const label = unit === 'count' && target.unitLabel ? ` ${clip(target.unitLabel, 30)}` : '';
  return `${clip(target.title, 80)}: ${formatAmount(total, unit)} of ${formatAmount(Number(target.target) || 0, unit)}${label}`;
}

function goalLine(doc, goal) {
  const { pct } = goalProgress(doc, goal);
  const next = milestonesOf(doc, goal.id)
    .filter((m) => m.status === 'active' && !m.done)
    .slice(0, 2)
    .map((m) => clip(m.title, 60));
  const date = goal.targetDate ? `, target ${shortDate(goal.targetDate)}` : '';
  return `${clip(goal.title, 80)} — ${pct}%${date}${next.length ? `; next: ${next.join(', ')}` : ''}`;
}

// ---- Readers -----------------------------------------------------------------------------------

export function checkinOf(doc, day) {
  const rec = doc.journal?.[journalId('checkin', day)];
  return rec && rec.status === 'active' ? rec : null;
}

export function digestOf(doc, monday) {
  const rec = doc.journal?.[journalId('digest', weekStart(monday))];
  return rec && rec.status === 'active' ? rec : null;
}

// Habits and weekly targets Gemini proposed for a goal that are still waiting on Today.
export function proposedItems(doc, goalId) {
  return values(doc.items).filter((i) => i.goalId === goalId && i.status === 'suggested').sort(byOrder);
}

// What the Coach panel shows for today's check-in:
//   'done'      — today's feedback is in (shown even without a key)
//   'nokey'     — no Gemini key on this device
//   'questions' — the questions are saved and waiting for answers
//   'due'       — no check-in yet, and it's the check-in hour or later
//   'early'     — no check-in yet, before the check-in hour
// Hours before the day starts (after midnight) still count as the evening of the logical day.
export function checkinState({ doc, today, now, dayStartHour = 4, checkinHour = 18, hasKey }) {
  const rec = checkinOf(doc, today);
  if (rec?.feedback) return 'done';
  if (!hasKey) return 'nokey';
  if (Array.isArray(rec?.questions) && rec.questions.length) return 'questions';
  const hour = now.getHours();
  return (hour < dayStartHour ? hour + 24 : hour) >= checkinHour ? 'due' : 'early';
}

// ---- The context block -------------------------------------------------------------------------

// Everything Gemini is told about George's day, as compact plain text, never over CONTEXT_CAP.
export function coachContext(doc, today) {
  const idx = doneIndex(doc);
  const rows = rowsForDay(doc, today, idx).filter((r) => r.item.status === 'active');
  const quotas = values(doc.items)
    .filter((q) => q.type === 'quota' && q.status === 'active' && countsOn(q, today))
    .sort(byOrder);
  const goals = values(doc.goals).filter((g) => g.status === 'active').sort(byOrder);
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, -i);
    const { done, total } = dayCompletion(doc, day, idx);
    return `${shortWeekday(day)} ${done}/${total}`;
  });
  const checkins = [1, 2, 3]
    .map((n) => checkinOf(doc, addDays(today, -n)))
    .filter((c) => c && answersOf(c).length)
    .map((c) => `${shortWeekday(c.day)}: ${answersOf(c).map((a) => clip(a, ANSWER_CAP)).join(' / ')}`);

  const lines = [
    `Today: ${longDate(today)} ${today.slice(0, 4)}`,
    ...section("Today's list:", rows.slice(0, ROW_CAP).map((r) => rowLine(doc, r, today)), rows.length, 'nothing scheduled'),
    ...section("This week's targets:", quotas.slice(0, TARGET_CAP).map((q) => targetLine(q, weekTotal(doc, q.id, today))), quotas.length, 'none'),
    `Last 7 days: ${week.join(' · ')}`,
    ...section('Goals:', goals.slice(0, GOAL_CAP).map((g) => goalLine(doc, g)), goals.length, 'none'),
    ...(checkins.length ? ['Recent check-ins (his answers):', ...checkins] : []),
  ];
  const text = lines.join('\n');
  return text.length > CONTEXT_CAP ? `${text.slice(0, CONTEXT_CAP - 1)}…` : text;
}

// ---- A week's numbers --------------------------------------------------------------------------

// The Monday–Sunday week containing `monday` (normally its Monday), for the weekly digest.
export function weekStats(doc, monday) {
  const start = weekStart(monday);
  const end = addDays(start, 6);
  const idx = doneIndex(doc);
  const days = [];
  const habits = new Map();
  const tasks = new Map();
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const rows = rowsForDay(doc, day, idx);
    days.push({ day, done: rows.filter((r) => r.done).length, total: rows.length });
    for (const r of rows) {
      if (r.kind === 'task') {
        tasks.set(r.item.id, (tasks.get(r.item.id) ?? false) || r.done);
        continue;
      }
      const h = habits.get(r.item.id) ?? { id: r.item.id, title: r.item.title, done: 0, scheduled: 0 };
      h.scheduled++;
      if (r.done) h.done++;
      habits.set(r.item.id, h);
    }
  }
  // A few-times-a-week habit stays on the list until it's met, so days listed aren't its target.
  for (const h of habits.values()) {
    const repeat = doc.items[h.id].repeat;
    if (repeat?.kind === 'perWeek') {
      h.done = doneBetween(doc, h.id, start, addDays(start, 7), idx);
      h.scheduled = repeat.n;
    }
  }
  const targets = values(doc.items)
    .filter((q) => q.type === 'quota' && days.some((d) => countsOn(q, d.day)))
    .sort(byOrder)
    .map((q) => ({
      id: q.id, title: q.title, total: weekTotal(doc, q.id, start), target: q.target,
      unit: q.unit ?? 'count', unitLabel: q.unitLabel ?? '',
    }));
  const goals = values(doc.goals)
    .filter((g) => g.status === 'active' && g.created <= end)
    .sort(byOrder)
    .map((g) => {
      const p = goalProgress(doc, g);
      return {
        id: g.id, title: g.title, pct: p.pct, done: p.done, total: p.total, numeric: p.numeric,
        unit: g.unit ?? 'count', week: weekTotal(doc, g.id, start),
      };
    });
  const amounts = values(doc.logs)
    .filter((l) => l.status === 'active' && l.kind === 'amount' && l.day >= start && l.day <= end).length;
  const doneTasks = [...tasks.values()].filter(Boolean).length;
  return {
    monday: start,
    sunday: end,
    days,
    habits: [...habits.values()].sort((a, b) => byOrder(doc.items[a.id], doc.items[b.id])),
    tasks: { done: doneTasks, total: tasks.size },
    targets,
    goals,
    amounts,
    empty: days.every((d) => d.total === 0) && amounts === 0,
  };
}

// Last week's Monday when its digest should be written: none exists yet and the week had any
// counted rows or amounts. Otherwise null.
export function digestDue(doc, today) {
  const monday = addDays(weekStart(today), -7);
  if (digestOf(doc, monday)) return null;
  return weekStats(doc, monday).empty ? null : monday;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — 158 tests (10 new).

- [ ] **Step 5: Commit**

```bash
git add js/coach.js tests/coach-context.test.js
git commit -m "Add the coach context and week stats" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
