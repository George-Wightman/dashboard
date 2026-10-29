# Salzburg Era Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second city, Salzburg, on George's map from 7 Nov 2026, with Household and Work tracks, Signify shifts earning hammers in both cities, chapters by visit, and Salzburg's own ground and finds.

**Architecture:** The replay engine (js/map/engine.js) gains three inputs: per-map finds, a camp cap from the map's tracks, and work records (`work:<eventId>` in the document's `calendar` map, written by the planner from his Work calendar). The builder (dev/build-map.mjs) learns a landlocked mode and mountain ground; Salzburg's places and drawings are private files built with it and uploaded to the sync repo.

**Tech Stack:** Plain ES modules, `node --test`, Google Apps Script bundle (planner/), Overpass for OSM.

**Spec:** docs/superpowers/specs/2026-10-29-salzburg-era-design.md (builds on docs/superpowers/specs/2026-10-22-civ-map-design.md)

## Global Constraints

- Live by 7 Nov 2026. Salzburg map: `id: 'salzburg'`, `place: 'salzburg'`, `start: '2026-11-07'`, `end: '2027-04-30'`.
- Work hammers: 20 for a shift of 60 minutes or more, 10 for shorter. Never a miss; never in a day's done/total.
- Shifts count from the release onwards (a `startedOn` in `calendar['work-status']`), never backfilled.
- Salzburg tracks: learning (Hebrew), sport (Health, Gym), household (Home, Food), work (no areas: shifts only), culture (Reading).
- Camp cap = number of the map's tracks + 1.
- Nothing personal in this repo: the flat, places, names, thresholds and drawings live in the sync repo's `map/` and `~/.dashboard-map/`. Never tell George which places are hidden.
- Mansfield must build byte-identical with the changed builder.
- Every commit touching a `sw.js` SHELL file runs `npm run build` and commits `release.json` and `planner/planner.js`; no SHELL file may contain `\r`.

## Review Focus

- A day with only a shift (nothing else counted): the shift's hammers still reach the pool and the Work track, and no turn, golden-age change or camp happens. Test in Task 1.
- A shift event deleted or moved after it was recorded: its record follows (archived, or re-dated). Test in Task 3.
- A Work-calendar event that is all-day, cancelled, marked free, or hasn't ended yet: not a shift. Test in Task 3.
- A UK day between two Salzburg runs: the second run is Chapter 2, and Mansfield replays those UK days as before. Test in Task 1.
- An old map file with no `findNames` and Mansfield's three tracks: unchanged behaviour (cap 4, Mansfield names). Test in Task 1.

---

### Task 1: Engine — finds, camp cap, work hammers, chapters

**Files:**
- Modify: `js/map/engine.js`
- Modify: `js/map/summary.js` (chapter line, find names)
- Test: `tests/map-engine.test.js`, `tests/map-summary.test.js`, fixture `tests/fixtures/map-town.js`

**Interfaces:**
- Produces: `workHammers(minutes: number) => 10 | 20`; `workRecords(doc) => Map<day, minutes[]>` (active `calendar` records whose id starts `work:`, with `day` and `minutes`); `findName(map, kind) => string` (map.findNames?.[kind] ?? FIND_NAME[kind] ?? 'A find'); `campCap(map) => Object.keys(map.tracks ?? {}).length + 1`; state gains `chapter: { n: number, start: string } | null` (the latest run of days where `cityOf(d) === map.id`, counted over `d <= today`).

- [ ] **Step 1: Write the failing tests** in `tests/map-engine.test.js` (the town fixture gets a `work` track with one build, `['office', 50]`, and the place `office`):
  - `'a shift adds 20 hammers (10 under an hour) to the pool and the work track, and is never a miss'`: putCalendar `work:e1` {day: day(0), minutes: 240} and `work:e2` {day: day(0), minutes: 45} on a finished day; assert `s.last.hammers === 100 + 30`, `s.track.work === 30`, `s.camps.length === 0`.
  - `'a day with only a shift earns its hammers without a turn'`: all rows off for day(0) (time off), one 240-minute shift; assert `s.turn === 0`, `s.pool === 20`, `s.track.work === 20`.
  - `'an archived shift earns nothing'`.
  - `'camps are capped at tracks + 1'`: town with four tracks misses every track for 12 days; assert `camps.length <= 5`; and with Mansfield-shaped three tracks `<= 4`.
  - `'a find takes its name from the map, else the engine list'`: map.findNames {salt: 'Salt'} → claim event text `'Salt: +…'`; a coal find without findNames still reads `'Coal seam: +20 hammers'`.
  - `'a UK day between Salzburg days starts chapter 2'`: two maps (town as `place: 'salzburg'`, a second map as `uk`), day stamps salzburg d0–d2, uk d3, salzburg d4; replay town at day(5) → `chapter` `{ n: 2, start: day(4) }`; at day(2) → `{ n: 1, start: day(0) }`.
- [ ] **Step 2: Run** `node --test tests/map-engine.test.js` — expect the new tests to FAIL.
- [ ] **Step 3: Implement** in `js/map/engine.js`: `MAX_CAMPS` replaced by `campCap(map)`; in `settle(d)`, compute the day's work hammers first and add them to `state.pool` and `state.track.work` (when the track exists) before the `score.total === 0` early return (which then calls `bank()` too); count them in the entry's `hammers`; `claim()` uses `findName`. Chapters are counted in the main day loop.
- [ ] **Step 4: Summary** — `mapSummary` adds `Chapter N (since <weekday date>).` after the first line when `state.chapter` exists and the map's place is `salzburg`; the camp line names the track for household and work. Test in `tests/map-summary.test.js`: `'a Salzburg map names its chapter'`.
- [ ] **Step 5: Run** `npm test` — expect PASS except the bundle/release checks.
- [ ] **Step 6: Commit** `Map: shifts earn hammers, finds and camp cap per map, chapters by visit`.

### Task 2: The day's points show shifts

**Files:** Modify `js/map/points.js`, `js/ui/map.js` (points section); Test `tests/map-points.test.js`

**Interfaces:** Consumes `workRecords`, `workHammers` (Task 1). Produces `dayPoints(...).work: [{ minutes, hammers }]`, with `earned` including them.

- [ ] **Step 1: Failing test** `'a shift shows as earned work, never a miss'`: a 240-minute `work:` record on the day → `p.work` deep-equals `[{ minutes: 240, hammers: 20 }]`, `p.earned` includes 20, `p.total` unchanged; `pointsLines` has a line `  ✓ Signify shift (4h) +20`.
- [ ] **Step 2: Run** `node --test tests/map-points.test.js` — FAIL.
- [ ] **Step 3: Implement**; the UI's points list shows the same row, marked earned, with the note "A shift: never a miss".
- [ ] **Step 4: Run** — PASS. **Commit** `Map: the day's points show shifts`.

### Task 3: Planner records shifts from the Work calendar

**Files:**
- Create: `planner/work.js`
- Modify: `planner/gas.js` (call after `adoptEvents`), `js/calendar.js` (`workCalendar: 'Work'` in `CALENDAR_DEFAULTS` and `CONFIG_CHECKS`, a calendar name), `claude/skill/reference.md` (the setting)
- Test: `tests/planner-work.test.js`

**Interfaces:**
- Produces: `recordShifts(store, events, { calendarId: string | null, today: string, now: Date, dayStartHour: number }) => number` (records written). Status in `calendar['work-status']`: `{ startedOn }`, set to `today` on first run and kept. Record `calendar['work:<eventId>']`: `{ day, start, end, minutes, title }`, source `'planner'`. Day by `logicalDay(start, dayStartHour)`.
- Consumes: `events` as listed in gas.js (yesterday 00:00 to `days` ahead), each with `calendarId`, `id`, `start.dateTime`, `end.dateTime`, `status`, `transparency`.

- [ ] **Step 1: Failing tests:**
  - `'an ended shift on the Work calendar is recorded once, with its day and minutes'`
  - `'a shift not yet over, all-day, cancelled, free, or on another calendar is not recorded'`
  - `'a recorded shift that moves follows; one that goes is archived'` (only for days inside the listed window: yesterday onwards)
  - `'shifts before startedOn are never recorded'`
  - `'no Work calendar: nothing recorded, no error'`
- [ ] **Step 2: Run** `node --test tests/planner-work.test.js` — FAIL.
- [ ] **Step 3: Implement** `planner/work.js`; wire it in gas.js with `find(config.workCalendar)?.id` from `resolveCalendars`.
- [ ] **Step 4: Run** `npm test` — PASS except bundle/release.
- [ ] **Step 5: Commit** `Planner: Signify shifts become work records`.

### Task 4: Renderer — mountains, Salzburg finds, new tracks, chapter

**Files:** Modify `js/ui/map-art.js`, `js/ui/map.js`; Test `tests/map-art.test.js`, `tests/map-ui.test.js`

**Interfaces:** Consumes `findName`, `state.chapter` (Task 1). Produces terrain `mountain` in `TERRAIN` (`{ name: 'Mountains', top: '#9aa39a' }`, snow-capped in winter via `seasonTop`), `decoSvg('mountain', …)` (two grey peaks with snow tips), `findSvg` cases `salt`, `cows`, `timber`, `trout`, `marble`, `beer`, `PLAZA` and `TRACK_COLOUR` entries for `household` (`#e3c48f` / `#d9a548`) and `work` (`#b9c2a4` / `#8fa36a`).

- [ ] **Step 1: Failing tests:** `'mountain ground draws peaks'` (decoSvg('mountain') contains `<polygon`), `'each Salzburg find has a drawing'` (findSvg for each of the six kinds is non-empty and differs from the default), `'the tooltip names a find from the map'` (map.findNames), `'the big view shows the chapter on a Salzburg map'` (`Chapter 1` in the HUD).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Map: mountains, Salzburg finds, household and work tracks on the board`.

### Task 5: Builder — landlocked cities, mountain ground, per-map finds

**Files:** Modify `dev/build-map.mjs`

**Interfaces:** Places-file keys: `coast: false` (skip the island clip and the home-island detail; Europe still drawn from `europeBox`), `findsByTerrain` (overrides the `FIND` table per terrain), `findNames` and `finds` (values) copied into the output, `mountains: true` (OSM query adds `natural~peak|bare_rock|cliff|ridge|scree`; areas → `mountain`, ranked after water; tiles within 600 m of a peak node → `mountain`), `views.austria` like `views.england`.

- [ ] **Step 1: Mansfield guard** — with the caches in `~/.dashboard-map/`, rebuild Mansfield to a temp file and compare with `~/.dashboard-map/mansfield.json`: must be byte-identical before and after the change. Run: `node dev/build-map.mjs ~/.dashboard-map/mansfield.places.json ~/.dashboard-map/art.mjs <tmp>/m.json ~/.dashboard-map/map-osm.json ~/.dashboard-map/land-50m.json && cmp <tmp>/m.json ~/.dashboard-map/mansfield.json`. Expected: no output.
- [ ] **Step 2: Implement** the keys; rerun Step 1 — identical.
- [ ] **Step 3: Commit** `Map builder: landlocked cities, mountain ground, per-map finds`.

### Task 6: Salzburg's places, drawings and file (private)

**Files (private, never committed here):** `~/.dashboard-map/salzburg.places.json`, `~/.dashboard-map/salzburg-art.mjs`, `~/.dashboard-map/salzburg-osm.json` (cache), `salzburg.json`; uploaded to the sync repo as `map/salzburg.json`, `map/source/salzburg.places.json`, `map/source/salzburg-art.mjs`, and `map/index.json` gains `salzburg`.

- [ ] **Step 1: Places.** Centre: his flat (centreName: the street area). `kmPerTile: 0.5`, `coast: false`, `mountains: true`, `home: 'centre'`. Visible early: the nearest Billa (found), the nearest outdoor fitness station (found). Hidden: 10–14 found places across Salzburg's neighbourhoods, parks, river and old town; one build spot per card; wonder sites including the fortress and the mountains (Gaisberg, Untersberg). Each place carries a one-line `note`.
- [ ] **Step 2: Tracks and thresholds.** From his live habits' minutes (`run.sh list`) at "good weeks" rates (daily things 5 days in 7; bodyweight 3.5 and runs 2 a week; Home rows as the Salzburg habits stand; reading 3 a week; shifts 3 a week), the first card on each track at about 70% of a 27-day month; later cards spaced for about 130 Salzburg days. Work's first card at three shifts' worth.
- [ ] **Step 3: Finds.** `findsByTerrain` and `findNames` for salt, cows, timber, trout, marble, beer, with values 10–20.
- [ ] **Step 4: Drawings.** One SVG per build and wonder, in the Mansfield art module's style and box.
- [ ] **Step 5: Build** with `node dev/build-map.mjs` and check: tiles 350–600, every place on land, `validMap` true, the centre at 0,0, the fortress a wonder.
- [ ] **Step 6: Upload** the four files with `createFileStore` and the skill's config (as Mansfield was).

### Task 7: Release and check

- [ ] **Step 1:** `npm run build && npm test` — all PASS; no `\r` in SHELL files.
- [ ] **Step 2:** In the browser pane, with the page's time zone set to Europe/Vienna and the date on 7 Nov, the big map shows Salzburg, Chapter 1, the flat at the centre, Billa and the park in sight; on UK time it shows Mansfield unchanged. Screenshot both.
- [ ] **Step 3:** Commit, push (George approves the push), then `run.sh map` shows Mansfield with any shifts since release.
