# Claude as Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Claude the controls to direct the dashboard — time off, notes, briefs, priorities, area colours, per-day hours, an attention list — with George seeing all of it in the app and in ⚙ → Claude.

**Architecture:** New fields (`notes`, `priority`) and records (`off:*` in the `calendar` map, `brief:*` in `journal`) with pure readers in `js/calendar.js` and a new `js/attention.js`; `js/schedule.js` excuses items on time off; the planner (`planner/demand.js`, `planner/plan.js`) honours time off, priority, area colours and per-day hours; the page shows the brief, time off, ★ and notes and gains ⚙ → Claude (`js/ui/claude.js`); Claude's tool gains the ops and reads.

**Tech Stack:** as before — plain ES modules, `node:test`, no dependencies.

**Spec:** [`docs/superpowers/specs/2026-09-14-claude-director-design.md`](../specs/2026-09-14-claude-director-design.md).

Written for inline execution by the author straight after the design: each task lists its files, the
interfaces it produces, and the tests that define it; code is written test-first in the task.

## Global Constraints

- The calendar planner plan's constraints stand (no dependencies, `npm test`, commit per task with the
  Co-Authored-By line, never push without George's yes, British English, nothing hard-deleted).
- Branch **`claude-director`** from `main`.
- Planner modules stay bundle-safe; run `npm run build-planner` whenever `planner/` or a module it
  imports changes, and commit `planner/planner.js`.
- Run the whole suite with `node --test --test-concurrency=1 tests/*.test.js` before each commit (the
  timing test is flaky under parallel load).

## Shared interfaces

```js
// js/calendar.js (Task 1)
COLOR_NAMES = { Lavender: '1', Sage: '2', Grape: '3', Flamingo: '4', Banana: '5', Tangerine: '6',
                Peacock: '7', Graphite: '8', Blueberry: '9', Basil: '10', Tomato: '11' }
CALENDAR_DEFAULTS += { priorityAreas: [], areaColors: {}, dayHours: {} }
MERGED_SETTINGS = ['areaCalendars', 'areaColors', 'dayHours']
mergeSetting(field, current, value): value      // one-key merge for MERGED_SETTINGS (null deletes)
timeOff(doc): OffRecord[]                        // active, by start
offCovers(off, day): boolean                     // whole-day record covering the day
offWindows(doc, day): [{ start: ms, end: ms, areas }]   // hours-only records on the day
excused(doc, item, day, offs = timeOff(doc)): boolean
offLine(doc, day): string | null                 // 'Time off — reason · areas'
isPriority(doc, item): boolean
briefFor(doc, day): string | null
nextOffId(doc, start): 'off:YYYY-MM-DD[b…]'

// js/attention.js (Task 1)
attention(doc, today): string[]

// js/schedule.js (Task 1)
rowsForDay skips excused items; occurrenceStreak skips excused days;
history cells gain `off: reason | null` (whole-day time off for everything)

// js/data.js (Task 1)
itemFields / goalFields check `notes` (≤1000) and `priority` (boolean, tasks and habits)
saveJournal(record, source = 'gemini') accepts kind 'brief' { text }

// planner/demand.js, planner/plan.js (Task 2)
demand blocks gain `priority`; plan honours time off, dayHours, priority order, area colours
(+ takenColors, a clash note), notes in descriptions; plan returns { …, takenColors: string[] }
events.js: nearestColor(hex, eventColors): id

// planner/gas.js (Task 2): status record gains takenColors
```

## Tasks

- [ ] **Task 1: Data, time off, schedule and attention** — `js/calendar.js`, `js/attention.js`,
  `js/schedule.js`, `js/data.js`; tests `tests/director-data.test.js`, `tests/calendar.test.js`.
  Tests: config checks for `priorityAreas` (names), `areaColors` (known names, no two areas alike),
  `dayHours` (real dates, ordered times); `mergeSetting` sets and deletes one key; `timeOff` /
  `offCovers` / `offWindows` / `excused` (everything; area-limited, case-insensitive; hours never
  excuse; archived ignored); `offLine`; `isPriority` by flag and by area; `briefFor`; `nextOffId`;
  `rowsForDay` without excused items and a task dated in time off carried to the next day;
  `dayCompletion` counts; a daily habit's streak unbroken across an excused day; `history` cell `off`;
  `attention` lines for no length, carried 3+ days, behind pace, planner problems and taken colours;
  store checks for `notes`/`priority`; `saveJournal` brief with source `claude`.
- [ ] **Task 2: The planner** — `planner/demand.js`, `planner/plan.js`, `planner/events.js`,
  `planner/gas.js`, `planner/planner.js`; tests in `tests/planner-director.test.js`. Tests: whole-day
  time off for everything books nothing that day and a dated task lands the next day; area-limited time
  off books other areas; hours time off keeps covered areas' blocks out of the stretch; quota share
  skips off days; priority blocks placed first; an area colour on exact blocks and its light partner on
  rough ones; a taken colour ignored with a note and `takenColors` returned; removing a colour replaces
  the block; `dayHours` narrows a day; notes lead the description; idempotent re-run; gas status
  carries `takenColors`.
- [ ] **Task 3: The page** — `js/ui/today.js`, `js/app.js`, `js/ui/side.js`, `js/ui/edit.js`,
  `js/ui/settings.js`, new `js/ui/claude.js`, `index.html`, `styles.css`, `sw.js`, `js/flags.js`,
  `dev/seed.html`; tests in `tests/today-list.test.js`, `tests/changes-ui.test.js`, `tests/sw.test.js`
  expectations. Checks: brief and time-off lines, ★, the notes mark and its row, *off* history cells,
  the Notes box, ⚙ → Claude with its sections; browser check with the seed.
- [ ] **Task 4: Claude's tool, skill and README** — `claude/ops.js`, `claude/read.js`,
  `claude/cli.js`, `claude/skill/SKILL.md`, `claude/skill/reference.md`, `README.md`; tests in
  `tests/claude-ops.test.js`, `tests/claude-read.test.js`, `tests/claude-cli.test.js`. Tests: `notes`
  and `priority` on add and edit; `off` add, area check, hours form, cancel; `brief`; `planner` one-key
  merges, colour name and clash refusals (from `status.takenColors`); `attention` read; `today` brief,
  time off, ★, notes; `week` time off; `planner` read's new lines. Rebuild the skill zip.
