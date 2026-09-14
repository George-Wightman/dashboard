# Calendar Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep George's Google Calendar planned from the dashboard — every task given time, grouped by area, around fixed events, exact for today and tomorrow and rough after, moved out of the way of new shifts, trimmed or moved to the tick when he ticks — through a Google Apps Script planner, with the dashboard showing today's times and Claude doing the weekly thinking.

**Architecture:** A pure planning core (`planner/plan.js` with `events.js`, `calendars.js`, `demand.js`, `place.js`, `time.js`) takes the dashboard document, the calendars' events and its memory of the last run, and returns calendar changes plus day records. `planner/gas.js` runs it inside Apps Script (Calendar advanced service, the app's own GitHub client and sync, script properties for memory); `planner/bundle.mjs` bundles it with the app modules into one plain script, `planner/planner.js`, which a 20-line loader in George's Apps Script project fetches from GitHub Pages on every run. The synced document gains a `calendar` map (`js/calendar.js`); items gain `minutes` and `time`; the page shows today's times, the planner's notes and its health; Claude's tool learns lengths, times and the planner's settings.

**Tech Stack:** HTML, CSS, JavaScript ES modules; Node's built-in `node:test`, `node:vm`, `node:crypto`. Google Apps Script (V8) with the Calendar advanced service. No npm dependencies.

**Spec:** [`docs/superpowers/specs/2026-09-14-calendar-planner-design.md`](../specs/2026-09-14-calendar-planner-design.md) — read it before starting any task. The earlier plans describe the code this builds on.

## Global Constraints

Standing project rules:

- No framework, **no npm dependencies** (not even dev ones). The app has no build step; the builds are
  `npm run build-skill` (zips the skill) and, new here, `npm run build-planner` (bundles the planner).
- Test command, from the repo root: `npm test` (runs `node --test tests/*.test.js`; **345 tests before
  this plan**). Every task ends with the whole suite passing.
- Nothing is ever hard-deleted from the synced document — archive, dismiss, or tombstone. (Calendar
  events the planner made are its own and may be deleted.)
- Work on the branch **`calendar-planner`**. Commit after every task. Every commit message ends with a
  blank line and then `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Never** `git push`. Never create or modify GitHub repos, tokens, Google projects or calendar
  events outside the tests' fakes.
- Never read, print or log a real key. Tests use dummy keys only.
- Every planner test file starts with `process.env.TZ = 'Europe/London';` before any date is made.
- Everything under `planner/` except `bundle.mjs` and `build.mjs` is bundled for Apps Script: named
  static imports only (`import { a } from './x.js'`), `export function|const|let|class` only, no
  `node:` imports, no top-level code that touches Apps Script globals except `planner/entry.js`.
- British English in every string George or Claude reads.

Binding values from the design (copied verbatim; do not change them):

- **Window:** "The planner looks at **today and the next 6 days**."
- **Blocks:** "A day's active tasks and habits are grouped by `area` into one block per area per day: *Job search ×2*. A block of one task takes the task's title. Tasks with no area group as *Tasks*. A block longer than **2½ hours** splits into two. Carried-over tasks join today's blocks. Suggested items are never planned."
- **Length:** "The item's own length (`minutes`) if set, otherwise **30 minutes**."
- **Weekly time targets:** "spreads what's left of the week — target minus logged — over the remaining days: that area's block on each day is at least its share (rounded up to 15 minutes), and a day with no tasks in the area gets a block of its own. Next week's days in the window take an even share of the full target. A target whose area is covered by a calendar habit (Hebrew) adds nothing … Count targets … add no time."
- **Rough and exact:** "Today and tomorrow are **exact**. Days 3–7 are **rough**: … titled with a leading `~ ` and painted the paler partner of the calendar's colour … **At 20:00 each evening** the day after tomorrow turns exact where it stands".
- **Titles:** "Exact: *Job search ×2*. Rough: *~ Job search ×2*. Done: *✓ Job search ×2*. Part-done: *Job search · 1 of 2 done*. The description lists each task with a `dashboard:<id>` line … and one line: *Planned from your dashboard. Move it and it stays where you put it.*"
- **Placement:** "**Planning hours: 9:00–19:00, every day.** A block keeps **15 minutes** clear of fixed events." "All-day events don't block." "Order, per day: fixed events → anything George placed himself → linked habit events at their current times → exact planner blocks that can stay → everything else, carried-over first, then biggest first, each into the **earliest** free stretch that fits." "Nothing that has started is ever moved."
- **Ticks:** "**Ticked during its block** → the block ends at the tick … **Ticked before its block, or later the same day** → the block moves to end at the tick, keeping its length, but never starting before the previous event that day ends (at least 15 minutes long) … **Part of a group done when the block ends** → the title shows *1 of 2 done*; the rest gets a new slot. **Block ends with nothing ticked** → the block is removed and its tasks get a new slot … **Linked habit events** follow the first two rules. They are never removed."
- **Data:** "`minutes` | tasks, habits | Length, a whole number of minutes, 5 to 720" · "`time` | tasks | `HH:MM`". "`config` … `status` … `lastRun` (ISO), `lastError` (text or null), `version`". Config defaults exactly as in the design's JSON block.
- **Writes:** "The planner pushes to `data.json` only when a `calendar` record changed, plus a `status` heartbeat at most once an hour".
- **Script:** "Triggers, made by `install`: every 10 minutes, and on event changes in each watched calendar. A calendar-triggered run within 2 minutes of the planner's own last write is skipped". "**Script properties:** `GITHUB_TOKEN` …, `SYNC_REPO`, and optionally `GEMINI_KEY`." Loader URL: `https://george-wightman.github.io/dashboard/planner/planner.js`.
- **Tagging:** "A task in the window with no area gets one Gemini call choosing among the dashboard's existing areas, or none. The answer is remembered by item id in script properties … At most 5 per run; skipped when there's no `GEMINI_KEY`."
- **Dashboard:** "The add box reads a trailing length or time: *Draft cover letter 2h* (`2h`, `90m`, `1h30`, `1.5h`) and *Call NatCen 14:00*." "undone rows with a time first, by time; then undone rows without one, in manual order; done rows last … Dragging reorders only rows without a time." "today's notes as one line each under the header (at most two, newest first), each with × to hide it on that device." "the header warns *calendar planner hasn't run since 12:00* when `lastRun` is over 70 minutes old." "`sw.js` cache and `APP_VERSION` → `dash-v7`."
- **Claude:** "`task` and `habit` take `minutes` (`"2h"`, `"90m"`); `task` takes `time` (`"14:00"`); `edit` accepts both. `week` shows each day's blocks … A new read, `planner` … A new op, `planner`, changes settings: `{"op": "planner", "hours": ["08:30", "18:00"]}`."

## Decisions this plan makes (where the design was silent or ambiguous)

- **The `calendar` map's records.** `config`, `status`, and seven rotating day records `day:1` … `day:7`
  (ISO weekday), each `{ day, blocks, skipped, missed, notes }`, overwritten when that weekday comes
  round again. So the map never grows beyond nine records. The app reads a day record only when its
  `day` matches. Block: `{ key, eventId, calendarId, calendar, title, start, end, state, items }`
  with `state` one of `rough · exact · fixed · done · partial`.
- **The planner's memory** of its last run is the same day records, kept in the script property `DAYS`
  (so a failed push can't make it forget); the dashboard gets a copy.
- **Block keys** are `<day>|<area, lower-cased>|<n>`, `<day>|fixed|<itemId>` for a task with a time,
  and `<day>|done|<itemId>` for a record of a missed task ticked later. A key names the day the work
  belongs to, even when the event sits on another day.
- **Event properties** (private extended properties, strings): `dash` = `'1'`, `dashKey`, `dashItems`
  (ids, comma-separated), `dashTitle` (the title without prefixes), `dashAt` (`<start ISO>/<end ISO>`
  where the planner last put it), `dashState`, `dashPin` = `'1'` once George has moved it, `dashHabit`
  (on a habit instance the planner moved).
- **Rough → anything else** is a delete and a fresh insert at the same time, never a patch: a patch
  can't be relied on to clear the rough colour. Reminders: rough blocks none, others the calendar's
  defaults.
- **Rough colour:** the event colour (Google's 11) nearest the calendar's colour by RGB distance,
  then its light partner `{1:1, 2:2, 3:3, 4:4, 5:5, 6:5, 7:1, 8:8, 9:1, 10:2, 11:4}`; Graphite (`8`)
  when that partner is the colour itself.
- **Gap and grid.** Blocks start on the quarter hour; the 15-minute gap applies between a new block
  and everything already busy that day, planner blocks included. A linked habit instance counts as
  clashing only when it overlaps (no gap).
- **Placement ties:** carried-over first, then longer first, then key order. A habit instance moves to
  the free start nearest its own, earlier on a tie.
- **Splitting:** tasks are packed in order into blocks of at most `maxBlockMinutes`; a task longer than
  that becomes equal parts titled *Title (1 of 2)*. A weekly target's extra time tops up the last
  ordinary part, then adds parts of its own. A topped-up block is titled by its area (*Assessment
  centre* or *Assessment centre ×2*); a block of only target time takes the target's title.
- **Times-a-week habits** (not linked to events): what's left this week is spread over this week's
  remaining days with `evenPicks` (index `floor(i × n / k)`); next week's days take `n` spread over
  the whole week.
- **A task counts as done** from the day it's ticked onward; a habit only on its day. A block whose
  items were all finished on an earlier day, with no tick time, is deleted if it's still ahead, else
  marked done.
- **Notes** go on today's record only, deduplicated, at most 20, naming the day when it isn't today
  (*Moved Job search ×2 on Wed to 15:15 (Signify)*). "Couldn't fit" notes aren't written for today
  once its planning hours are over.
- **What George deleted** is worked out from the memory: a block the planner booked last run, not yet
  over, whose event is gone → its items are `skipped` for that day.
- **Day start hour** for the planner: 4, or the script property `DAY_START_HOUR`.
- **Apps Script** runs the planner's async code with `UrlFetchApp` behind a Promise-returning `fetch`
  shim; the loader returns the Promise from each entry point. Checked live after install (see
  *After the build*).
- **The app version** becomes `dash-v7` in Task 1, where `js/calendar.js` joins the offline shell.

## File map

| File | Responsibility | Task |
|---|---|---|
| `js/doc.js`, `js/parse.js`, `js/calendar.js`, `js/data.js`, `sw.js`, `js/flags.js`, `tests/calendar.test.js`, `tests/parse.test.js`, `tests/flags.test.js` | `calendar` in `MAPS`; lengths, times, the add box's split; the planner's records and readers; `putCalendar`; `dash-v7` | 1 |
| `planner/time.js`, `planner/events.js`, `planner/calendars.js`, `planner/place.js`, `tests/planner-parts.test.js` | Local times; Google events as the planner sees them, pins, links, rough colour; which calendars; finding time | 2 |
| `planner/demand.js`, `tests/planner-demand.test.js` | What needs time each day: blocks by area, lengths, splits, target shares, spread habits, timed tasks | 3 |
| `planner/plan.js`, `tests/planner-fakes.js`, `tests/planner-plan.test.js` | One planning pass: ticks, pins, habits, placement, the calendar changes and day records | 4 |
| `planner/tag.js`, `planner/shims.js`, `planner/gas.js`, `tests/planner-gas.test.js` | Gemini tagging; browser globals for Apps Script; the Apps Script runner (run, install, pause, resume, removeAll) | 5 |
| `planner/entry.js`, `planner/bundle.mjs`, `planner/build.mjs`, `planner/planner.js`, `planner/apps-script/Code.gs`, `planner/apps-script/appsscript.json`, `package.json`, `tests/planner-bundle.test.js` | The bundle, the loader George pastes, the build | 6 |
| `index.html`, `js/app.js`, `js/ui/today.js`, `js/ui/edit.js`, `js/ui/settings.js`, `styles.css`, `tests/today-list.test.js` | Row times and time order, the add box, Length and Time fields, notes, the stale warning, ⚙ → Calendar planner | 7 |
| `claude/ops.js`, `claude/read.js`, `claude/cli.js`, `claude/skill/SKILL.md`, `claude/skill/reference.md`, `README.md`, `tests/claude-ops.test.js`, `tests/claude-read.test.js` | `minutes`, `time`, the `planner` op and read, the week's blocks; the skill's calendar section; the README | 8 |

## Tasks

Each task lives in its own file under [`2026-09-14-calendar-planner/`](2026-09-14-calendar-planner/). Tick here when a task is committed.

- [x] [Task 1: Lengths, times and the planner's records](2026-09-14-calendar-planner/task-01-data.md)
- [x] [Task 2: Events, calendars and finding time](2026-09-14-calendar-planner/task-02-parts.md)
- [x] [Task 3: What needs time](2026-09-14-calendar-planner/task-03-demand.md)
- [x] [Task 4: One planning pass](2026-09-14-calendar-planner/task-04-plan.md)
- [x] [Task 5: The planner in Apps Script](2026-09-14-calendar-planner/task-05-gas.md)
- [x] [Task 6: The bundle and the loader](2026-09-14-calendar-planner/task-06-bundle.md)
- [x] [Task 7: The dashboard shows the plan](2026-09-14-calendar-planner/task-07-ui.md)
- [x] [Task 8: Claude, the skill and the README](2026-09-14-calendar-planner/task-08-claude.md)

Built 14 Sep: 407 tests. Task 1 also updated `tests/data.test.js` (the store's map list) and Task 7
`tests/changes-ui.test.js` (⚙'s group order); two test expectations in Tasks 2 and 4 were worked out
wrong in the plan and corrected. `tests/schedule-perf.test.js` (a 250ms timing check) can fail when the
machine is busy; it passes on its own.

Task 7 is browser work, checked in the Browser pane: serve with `preview_start` `dashboard`, open
`http://localhost:8080/dev/seed.html?replace`, then `http://localhost:8080/`, reload twice (the
offline cache).

## Shared interfaces (the contract between tasks)

```js
// ---- js/doc.js (Task 1) ------------------------------------------------------------------------
MAPS = ['items', 'goals', 'milestones', 'logs', 'journal', 'flags', 'changes', 'calendar']

// ---- js/parse.js (Task 1) ----------------------------------------------------------------------
LENGTH_MIN = 5; LENGTH_MAX = 720
parseLength(text): number | null          // '45m' '2h' '1h30' '1.5h' '90' → minutes within 5–720
parseClock(text): string | null           // '14:00' '9:30' → 'HH:MM'
splitTaskInput(text): { title, minutes: number|null, time: string|null }
checkLength(v): number | null             // null/'' → null; integer 5–720 → v; else throws
checkClock(v): string | null              // null/'' → null; 'HH:MM' → v; else throws

// ---- js/calendar.js (Task 1) — pure, imports ./dates.js only -----------------------------------
CALENDAR_DEFAULTS                          // the design's config JSON
CONFIG_CHECKS                              // field → (value, field) => value | throws
clockMinutes(hhmm): number | null
checkConfigField(field, value): value      // throws plain English
readPlannerConfig(doc): { config, problems: string[] }
dayRecordId(day): 'day:<1–7>'
dayRecord(doc, day): DayRecord | null      // only when record.day === day and active
plannerStatus(doc): { lastRun, lastError, version, paused } | null
todaySlots(doc, today): Map<itemId, { start, end, state, title }>   // non-rough blocks; later start wins
plannerNotes(doc, today): string[]
visibleNotes(notes, hiddenKeys, today): string[]   // not hidden, newest first, at most 2
clockLabel(iso): 'HH:MM'
momentLabel(iso, now): 'HH:MM' | 'Mon 14 Sep, 12:00'
staleSince(doc, now, minutes = 70): string | null
timedOrder(rows, slots): rows              // suggestions, timed undone by start, other undone, done
plannerSummary(doc, now): { summary: string, lines: string[] }

// ---- js/data.js (Task 1) -----------------------------------------------------------------------
store.putCalendar(id, fields, source = 'planner'): { rec, changed: boolean }

// ---- planner/time.js (Task 2) ------------------------------------------------------------------
MINUTE = 60000
at(day, 'HH:MM'): Date                     // local time
localDay(date): 'YYYY-MM-DD'               // local calendar date
iso(msOrDate): string

// ---- planner/events.js (Task 2) ----------------------------------------------------------------
P = { mine: 'dash', key: 'dashKey', items: 'dashItems', title: 'dashTitle', at: 'dashAt',
      state: 'dashState', pin: 'dashPin', habit: 'dashHabit' }
Ev = { id, calendarId, title, description, start: Date|null, end: Date|null, allDay, free, others,
       cancelled, recurringEventId, originalStart: Date|null, props, mine, colorId, useDefault }
normEvent(raw, calendarId): Ev
atText(start, end): string                 // `${iso}/${iso}`
movedByGeorge(ev): boolean
habitPinned(ev): boolean
linkedIds(description): string[]
roughColor(calendarHex, eventColors): string   // eventColors: { '1': '#a4bdfc', … }

// ---- planner/calendars.js (Task 2) -------------------------------------------------------------
norm(s): string                             // trimmed, lower case
resolveCalendars(list, config): { watched, find(name) }   // list: [{ id, name, primary, backgroundColor, accessRole }]
calendarFor(area, config, find, problems: Set): calendar | null
habitLinks(doc, config, find, problems: Set): [{ habitId, calendarId, title, area }]

// ---- planner/place.js (Task 2) -----------------------------------------------------------------
QUARTER; ceilQuarter(ms); fits(start, end, busy, gap); earliestFit(length, window, busy, gap);
nearestFit(length, want, window, busy, gap)     // window { start, end }; busy [{ start, end }] in ms

// ---- planner/demand.js (Task 3) ----------------------------------------------------------------
evenPicks(list, k): list
fixedTasks({ doc, days, config }): [{ key, itemId, day, title, area, start, end }]
demand({ doc, today, days, config, links, covered, usedKeys, todayClosed }):
  { blocks: [{ key, day, area, items: string[], minutes, carried, base }] }

// ---- planner/plan.js (Task 4) ------------------------------------------------------------------
blockTitle(base, state, done = 0, total = 0): string
blockBody({ key, base, title, start, end, items, state, colorId = null, pinned = false }): GoogleEvent
plan({ doc, now, dayStartHour = 4, calendars, events, eventColors, memory }):
  { actions: Action[], days: { [day]: DayRecord }, problems: string[] }
  // Action: { op: 'insert', calendarId, key, body } | { op: 'patch', calendarId, eventId, body }
  //       | { op: 'delete', calendarId, eventId }
fillIds(days, byKey): days

// ---- planner/tag.js, planner/shims.js, planner/gas.js (Task 5) ---------------------------------
tagPrompt(title, areas): { system, prompt }; readArea(data, areas): string
installShims(g, { Utilities, UrlFetchApp }): void
createPlanner({ Calendar, UrlFetchApp, PropertiesService, LockService, ScriptApp, Logger, fetch, now, version }):
  { run(e?): Promise<'ok'|'partly'|'paused'|'busy'|'echo'|'failed'>, install(): Promise<string>,
    pause(): Promise<string>, resume(): Promise<string>, removeAll(): Promise<string> }

// ---- planner/bundle.mjs, planner/entry.js (Task 6) ---------------------------------------------
bundle({ entry = 'planner/entry.js', read }): { code, build }   // defines PLANNER_BUILD and Planner
```

## After the build (things only George can do, then checks)

1. **Publish** — George says yes to pushing `calendar-planner` into `main`: this updates the app on
   his laptop and phone and puts `planner/planner.js` on the site for the loader.
2. **George's setup** — the design's *George's one-off setup* steps 1–4.
3. **First run check** — Claude reads his calendars through the connector: blocks where the design
   says, rough ones pale with `~`, nothing touched on Work. If `new Function` or the async run fails in
   Apps Script, switch the loader to a pasted copy of `planner/planner.js`.
4. **Tidy-ups** through the tool: *ASSESSMENT CENTRE* `time` 09:30 and 6½h; realistic lengths on the
   bigger tasks.
