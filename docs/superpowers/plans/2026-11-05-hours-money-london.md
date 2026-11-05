# Hours, Money and London Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two new dashboard tools: Money (with an Hours section fed by the Work calendar) and London (a room-area finder on a real map). Each is a tile with a phone-first big view.

**Architecture:** Pure modules (`js/hours.js`, `js/money.js`, `js/london.js`) hold the logic and are unit-tested. Small facts live in the synced doc's `calendar` map as records. Big private data (`money.json`, `london/areas.json`) lives in the sync repo and is loaded and cached like the map files. The UI (`js/ui/money.js`, `js/ui/london.js`) registers two tiles. Claude gets reads and ops. A dev script builds the London file from TfL, OpenStreetMap and police.uk.

**Tech Stack:** Vanilla ES modules, `node --test`, Google Apps Script planner (bundled by `planner/build.mjs`), Leaflet 1.9.4 vendored.

**Spec:** `docs/superpowers/specs/2026-11-05-hours-money-london-design.md`

## Global Constraints

- Public repo: no real pay rate, salary, balances, office address or spending in code, tests or docs. Fixtures are invented.
- Never write or change `work:` records (they are the Civ map's hammers).
- Phone first: every big view works at 380 px wide with no horizontal page scroll; touch targets ≥ 44 px; light and dark.
- No paid APIs. Gemini never sees money, pay or London data.
- Any change to a `sw.js` SHELL file ships with `npm run build-release` in the same commit.
- Text files are written with LF line endings.

## Review Focus

- A Work-calendar event with no title is a shift; one titled "Interview …" is not, unless overridden.
- A shift exactly on the cut-off day belongs to that pay period (cut-off is inclusive); one the next day belongs to the next.
- Money with no `money.json` yet: the tile says what to do and the Hours section still works from the doc alone.
- London with an area that has 0 or 1 rooms: shrinkage keeps its rent near its side's median, and it shows "few rooms".
- London offline or tiles blocked: list, cards and chart still render, and the map shows a placeholder.

---

### Task 1: Hours logic (`js/hours.js`)

**Files:** Create `js/hours.js`, `tests/hours.test.js`.

**Interfaces (produces):**
- `isShiftTitle(title: string) → boolean`: true for empty or loosely "signify" (`/^\s*s[iy]n?g?n?i/i` style). False for "Interview …".
- `shifts(doc) → [{id, eventId, day, start, end, minutes, title, counted, source: 'work'|'hours'|'upcoming'}]`: merges `work:*` and `hours:*` records (by eventId, `work` wins) with `calendar['hours:upcoming'].list`, and applies overrides `calendar['hours-count:<eventId>'] = {count: boolean}`.
- `paySettings(doc) → {rate, holidayPct, cutoff}` from `calendar['money:pay']` (defaults `{rate: null, holidayPct: 12.07, cutoff: 23}`).
- `payPeriodOf(day, cutoff) → 'YYYY-MM'`: the month whose payslip pays it. A day ≤ the cut-off is that month, otherwise the next.
- `payslips(doc) → [{period, paid, hours, holiday, gross, tax, ni, net}]` from `payslip:<YYYY-MM>` records, sorted.
- `hoursSummary(doc, today) → {period, periodHours, expected: {period, hours, gross, net, payday}, weeks: [{start, hours}], slips: [{...payslip, calendarHours, diff}], notCounted: [...], weeklyAverage}`. `net = gross` unless the last three payslips show tax or NI, then net/gross ratio. Payday = last weekday of the period's month. `weeklyAverage` is over the last 8 complete weeks.

- [ ] Write tests: titles (`''`, `'Signifi'`, `'singify'`, `'Interview : Pre-Training'`); `payPeriodOf('2026-10-23', 23) === '2026-10'` and `payPeriodOf('2026-10-24', 23) === '2026-11'`; merge dedupes a `work:` and `hours:` record with the same event id; an override makes the interview counted; expected pay = hours × rate × 1.1207 with an invented rate 10; the slip diff is paid hours − calendar hours.
- [ ] Run `node --test tests/hours.test.js`: it fails.
- [ ] Implement.
- [ ] Run: it passes. Commit "Hours: shifts, pay periods and expected pay from the Work calendar".

### Task 2: Planner saves shifts ahead (`planner/hours.js`)

**Files:** Create `planner/hours.js`, `tests/hours-planner.test.js`. Modify `planner/gas.js` (near the `recordShifts` call), and rebuild `planner/planner.js` with `npm run build-planner`.

**Interfaces:** `recordUpcoming(store, events, {calendarId, now}) → boolean` writes `calendar['hours:upcoming'] = {status:'active', at, list:[{eventId, day, start, end, minutes, title}]}` for Work events that haven't ended, and only writes when the list changed. In gas.js, one extra `listEvents([workId], now, now + 42 days)` call feeds it, inside a try so a failure never stops a run.

- [ ] Tests: ended events are left out; cancelled ones are left out; an unchanged list makes no write.
- [ ] Implement, build the planner, run all tests, commit "Planner: Work shifts six weeks ahead for Hours".

### Task 3: Claude for Hours (op `hours`, read `hours`)

**Files:** Modify `claude/ops.js` (op and FIELDS), `claude/read.js` (READS.hours), `claude/skill/reference.md`, `claude/cli.js` USAGE. Test `tests/claude-hours.test.js`.

**Interfaces:** op `{"op":"hours", "shifts":[{eventId, day, start, end, title}]}` backfills `hours:<eventId>` records (skipping ids that have a `work:` record). `{"op":"hours","payslip":{period, paid, hours, holiday, gross, tax, ni, net}}` writes `payslip:<period>`. `{"op":"hours","pay":{rate, holidayPct, cutoff}}` merges `money:pay`. `{"op":"hours","count":{eventId, on}}` writes an override. Read `hours` prints the summary.

- [ ] Tests for each op form and the read's key lines. Implement. Commit.

### Task 4: Private files (`js/private.js`) and money data (`js/money.js`)

**Files:** Create `js/private.js`, `js/money.js`, `tests/money.test.js`. Modify `js/app.js` (load and refresh `money.json` and `london/areas.json` beside the maps).

**Interfaces:**
- `loadCached(storage, key, valid) → doc|null`, `refreshFile({clientFor, storage, key, path, valid}) → doc|null` (keeps the cache on a fetch error).
- `money.json` shape: `{v:1, updated, days:{'YYYY-MM-DD':{cat:pence}}, income:[{day, amount, kind:'pay'|'refund'|'other', oneOff?:true, note?}], balances:[{day, total}], plan:[{month, label, amount, cat?, kind:'spend'|'income'}], categories:[ids]}`. `validMoney(doc) → boolean`.
- `CATEGORIES`: groceries, eating-out, going-out, local-travel, trips, gym-health, phone-subs, shopping, gifts, rent-bills, other, each with a label and colour token.
- `monthActuals(money, month) → {spend:{cat:pence}, total, income}`; `averageSpend(money, today, months=3) → {cat:pence}`.
- `potForecast({money, doc, today, start}) → [{month, actual:boolean, income, spend, pot}]` uses the last balance, Hours' expected pay and weekly average for future income, the average spend plus plan lines, up to the month before `start` (`calendar['move:start'].day`, default `'2027-05-01'`).
- `compare(money, doc, a, b)`: two ranges `{from, to}` or the preset `'eu'` (EU days vs the rest) → per-week spend by category for each side.
- `moneySummary(money, doc, today) → {atStart, thisMonth:{spent, plan}, nextPay}`.

- [ ] Tests with an invented ledger: a transfer never appears (the import is already clean, so the test checks a one-off refund is left out of "normal" income); the pot steps month by month; the EU split uses `eu:` records; an empty ledger returns nulls, not NaN.
- [ ] Implement, test, commit.

### Task 5: Claude for Money (`money` read, `money-import` command, playbook)

**Files:** Modify `claude/cli.js` (command `money` read and `money-import <file.json>`, which validates with `validMoney`, merges days, income and balances by key, and writes `money.json` through the file store), `claude/skill/reference.md`, add `claude/skill/playbooks/money.md` (how to read statements: drop own-account transfers, the categories, never store shop names) and add `'money'` to PLAYBOOKS. Test in `tests/claude-money.test.js` with the fake file store.

- [ ] Tests: import merges into an existing file; an invalid file is refused with a reason; the read prints the pot at the start date. Implement, `npm run build-skill`, commit.

### Task 6: Money tile and big view (`js/ui/money.js`)

**Files:** Create `js/ui/money.js`, `styles/money.css` (or a block in `styles.css`, following the existing pattern). Modify `js/tiles.js` (TILE_IDS adds `money`, `london`), `js/ui/tiles.js` (register), `sw.js` SHELL. Test `tests/money-ui.test.js` (render with the DOM helper the other UI tests use).

- **Tile:** "£x at the start" hero; one line "Next pay ~£y, <date>"; "This month £spent of £plan".
- **Big view, top to bottom:** pot line plus month bars (stacked categories, actual solid and plan hatched; tap a month for its breakdown); the Compare panel (preset "Salzburg vs UK" and a two-range picker); Hours (pay-period hours, expected pay, weekly bars, payslips with paid vs calendar, upcoming shifts, "Not counted" with a switch); plan lines.
- [ ] Test the tile with and without `money.json`. Implement. Check in the browser at 380 px and 1900 px. `npm run build-release`. Commit.

### Task 7: London data (`dev/build-london.mjs`)

**Files:** Create `dev/london-seed.mjs` (reads the saved artifact HTML given as an argument and prints the 56 areas as JSON: name, line, side, station minutes, walk, rooms, rent, all-in rent; plus the take-home rules and Travelcard prices), `dev/build-london.mjs` (seed → `london/areas.json`: station coordinates and borough from TfL StopPoint search and postcodes.io; journeys from the TfL Journey Planner arriving 08:30 on a Tuesday to the office, to four west points, to King's Cross and St Pancras, and to Stansted Airport for 05:30; OSM Overpass counts within 900 m of gyms (`leisure=fitness_centre`), green space area (`leisure=park`), eat and drink (`amenity=restaurant|cafe|pub|bar`); police.uk street crime within 1 mile for the last 12 months; responses cached under `~/.dashboard-london/cache`). Private inputs (office location, salary, budget defaults) come from `~/.dashboard-london/private.json`. Output uploaded with `createFileStore` to `london/areas.json`.

`areas.json` shape: `{v:1, prices:'2026-10-24', built, office:{name, lat, lon}, rail:{newark:{mins, fare}, nottingham:{mins, fare}}, defaults:{...}, tax:{...}, travelcard:{z12, z13, annual}, areas:[{id, name, borough, side, lat, lon, line, walk, rooms, rent, allin, j:{office, west:[...], kx, stp, stansted:{leave, route}|null}, near:{gyms, green, eat, crime}}]}`.

- [ ] Unit-test the seed parser on a small invented HTML snippet, and the pure step that turns raw API results into an area (`tests/london-build.test.js`). Run the script for real and upload. Commit the scripts only.

### Task 8: London ranking (`js/london.js`)

**Files:** Create `js/london.js`, `tests/london.test.js`.

**Interfaces:**
- `takeHome(salary, {pensionTiers}) → monthly` (the room finder's formula: pension tiers 4.6% to £36,199, 5.45% to £56,000, then 7.35%; 2026/27 tax, NI and Plan 2).
- `DEFAULTS`: year 1, ceiling 50%, savings 300, hour £10, maxCommute 45, west 0.33, mansfieldTrips 1, salzburgTrips 1, trust k 4, cab 40, near weights all 1, stepValue 25.
- `shrunkRent(area, prior, k) = (n·rent + k·prior)/(n + k)`, where `prior` is the median rent of the area's side.
- `scoreArea(area, s, ctx) → {total, parts:{rent, bills, travel, commute, trips, savingsShortfall, near}, flags:{stretch, overCommute, thin, noEarlyFlight}}`. Hours a month = `2 × ((1−west)·office + west·mean(west)) × 21.7 / 60`. Trips: `2 × kx × mansfieldTrips + 2 × stansted × salzburgTrips`, in hours × hour value. `near` = Σ weight × stepValue × (avg − score) over gyms, green, eat and safety (safety = 1 − crime score), with scores scaled 0 to 1 by rank across areas.
- `rankAreas(data, settings, ctx) → [{area, score, rank}]`: within the commute limit first, then by `stretch`, then by total.
- `settings(doc) / setSettings(store, patch)` on `calendar['london:settings']`.

- [ ] Tests: takeHome matches the artifact's figure for its default salary within £1 (invented-salary check in the test uses a hand-worked value); shrinkage pulls a 1-room cheap area to near the prior; raising the hour value moves a far area down; an area over the commute limit ranks after every area within it; weights at 0 make `near` 0.
- [ ] Implement, test, commit.

### Task 9: London tile and big view (`js/ui/london.js`)

**Files:** Add `js/vendor/leaflet/leaflet.js` + `leaflet.css` (1.9.4, BSD-2, licence header kept), create `js/ui/london.js` and its CSS; register the tile; add the files to the `sw.js` SHELL.

- **Tile:** top area name · borough, "£x a month all in", "£y left to save".
- **Big view:** the map (CARTO light/dark tiles by theme, OSM attribution), with numbered pins coloured by stretch or within budget and greyed when over the commute limit; a settings sheet (collapsible, a bottom sheet under 760 px) with a one-line explanation under each control; an area card on tap (the spec's contents, including a SpareRoom link built like the room finder's `srLink`); the ranked list; the cost vs commute chart; the budget panel with "£x from Money at the start". With no network the map area shows "Map needs a connection", and the rest works.
- [ ] Test that the tile renders from an invented `areas.json` and the card shows the breakdown. Implement. Check in the browser at 380 and 1900 px, light and dark. `npm run build-release`. Commit.

### Task 10: Finish

- [ ] `npm test` all green; `npm run build`; browser smoke.
- [ ] Update `claude/skill/reference.md` and rebuild the skill zip; ask George to re-upload it.
- [ ] Ask George before pushing ("this publishes the update to your laptop and phone").
