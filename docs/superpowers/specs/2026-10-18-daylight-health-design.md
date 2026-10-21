# Daylight: the dashboard turns to health and Hebrew (18 Oct 2026)

George's aims until May are personal: his health and training, food, and Hebrew. The job search is over. He asked for a heavy redesign that keeps everything
the app does but feels alive, a link to his Pixel Watch, a coach that shapes his training from what
he has done, and a food log that needs no weighing.

This spec covers four builds that share one design. Each gets its own plan and ships on its own:

1. **Daylight**: the new look, with today's data.
2. **Health link**: Pixel Watch data through the Google Health API.
3. **Food**: snap a meal; Gemini estimates it, Claude checks it.
4. **Coach**: Claude writes the training plan into Hevy and the calendar; the app runs fixed rules.

The mockups are on the canvas *Today: redesign directions*
(https://claude.ai/artifact/P5eXz4WSve5YXvyybkzYFb), row **Daylight v2**: the laptop at 10:20, the phone
at 10:20, snapping a meal, and the phone at 21:40. The numbers there that aren't George's real ones
(meals, cardio minutes, Hebrew hours, back history, loads) are stand-ins.

## Decisions already made

- **Claude is the coach.** The thinking happens in George's chats with Claude, which writes the week's
  sessions into Hevy and the calendar. The app shows the plan and runs simple fixed rules. No in-app
  chat, no AI planning in the app or the planner (as on 26 Sep, when the Coach was retired).
- **No paid AI.** The free Gemini tier and George's Claude subscription only. Gemini may see meal photos
  and what George says about them. It never sees watch data.
- **Look C, "Daylight"**, over A (Field Journal) and B (Instrument).
- **Food**: an instant Gemini estimate as a range, protein first. A small copy of each photo is kept so
  Claude can correct big misses when planning. Saved "usual meals" log exactly. Calories are judged as
  a weekly average against maintenance, never a daily target.
- **His own health rules** are the coach's rulebook. They're personal, so they live in the private
  sync repo (`notes/gym.md`, printed by `reference gym`), not in this public one. Not medical advice:
  his own professionals have the final say.

## Rules for the screen

These carry over from the current app and still hold:

- Each number in one place. Depth sits behind a tile's big view, not on the page.
- Nothing is added in the app. New work comes through Claude. The app is for ticking, check-ins,
  notes and meals.
- Ticked work stays visible. Moving or deleting work never makes a day a success.
- Words for "added by" are hover text. The row shows a small mark.
- The laptop is the main screen. The phone is for ticking, check-ins and meals.

---

# Build 1: Daylight

## The three layers

1. **The sky: how today is going.** A header drawn as the sky for the time of day: dawn, morning,
   midday, afternoon, golden hour, dusk or night. The sun (the moon at night) sits on an arc from
   sunrise to sunset at the current time, and the sky's colours follow its phase. Today's timed blocks
   are dots on the arc; a dot turns gold when the block is done. The sky holds:
   - the date, place and time;
   - the greeting ("Morning, George.");
   - the day's progress ("2 of 6 done", as segments);
   - Claude's brief for the day, with Claude's mark (today's `brief` journal record);
   - time off today and the planner's notes, as dismissible chips (as now, × for the rest of the day);
   - the header actions: sync status, ⚑, Arrange, ⚙, and "Update ready · reload";
   - warnings (save failed, planner stopped and, from Build 2, watch data stale) as a small cloud chip
     with the sentence on hover.

   From Build 2 the brief line also carries last night: sleep, HRV and resting heart rate.

2. **Today: what to do.** One vertical timeline, top to bottom, with a moving "now" line. **This is the
   only place things are ticked.** In order:
   - the waiting **check-in**, as a card at the top (the current check-in UI, restyled);
   - a **task error**, if a tick failed (as now);
   - **timed rows** at their calendar time (`todaySlots`), in the day's order;
   - **calendar commitments** that aren't tasks (from the planner's `commitments`), as greyed, hatched
     blocks with no tick, e.g. "Signify QA shift · until 17:00 · Work calendar";
   - **meal prompts** (Build 3) as dashed markers at 08:00, 12:30 and 19:00, each shown only while that
     slot has no meal logged, opening the snap flow; they are not tasks and are never counted;
   - **"Any time today"**: untimed rows, which can still be dragged into order;
   - **suggestions** as dashed cards with ✓ and ✕ and the source's mark, at their time or under "Any
     time today";
   - **"Tomorrow: …"**, one line of tomorrow's booked blocks;
   - the **Tell Claude** bar (today's Note for Claude: type or mic, Send, Ctrl+Enter).

   Every row keeps what it shows today: the time, ★ priority, the pin, the notes mark ≡ (opens the note
   under the row), "Waiting" for blocked tasks, "by …" deadlines, the amber "from Sat" carry-over, the
   source mark, area colour, habit streaks, weekly dots, "via Hevy · 18:32–19:48", outcome forms on
   tick, and clicking the title to open the editor. A row's card is tinted by its area. Done rows
   fade, with a gold tick.

3. **Tiles: how the aims are going.** Each tile has one big number and a ⤢ that opens its big view.
   Area colours: Body coral, Fuel green, Hebrew indigo; everything else cream or white. Gold always
   means "you did it".

## Where each current widget goes

| Today | Daylight |
|---|---|
| Today's list, check-in card | The timeline (above) |
| Suggestions | Dashed cards in the timeline |
| Note for Claude | The Tell Claude bar under the timeline (fixed at the bottom on the phone) |
| Upcoming | **Needs you** (decisions only) plus the "Tomorrow" line |
| Countdown | **Countdown** tile, a ticket ("18 days to Salzburg") |
| This week | **This week** tile, unchanged, shown only when a target isn't shown elsewhere |
| Goals | **Goals** tile: each goal as a path with milestone stones and its pace line |
| Last 3 weeks | **Your weeks** tile: one sun per day, filled gold by the day score; tap for the day's misses by name |
| Hebrew | **Hebrew** tile: week's hours, the ladder as stepping stones, the next rung, words said live |
| Gym, Muscles, Cardio trend | One **Body** tile: cardio this week, key lifts, the next session; Muscles, Cardio trend, the PB board and the year grid move into its big view |
| *(new, Build 3)* | **Fuel** tile |

**Needs you** appears only when something needs a decision. It holds what Upcoming's "needs you" list
holds today, in plain words: a Calendar/Dashboard conflict ("You moved Gym to 18:30 in Google Calendar,
but the dashboard still has 17:30." **Keep 18:30** / **Back to 17:30**, mapping to the existing
`resolveConflict` choices), a task taken out of Calendar, and a later task still without a slot. Five at
a time, as now.

The big views keep their content: Your weeks (every week since the start, misses by name), Hebrew (the
whole ladder, ticking conversation stages, the last two weeks) and Body (Gym's big view plus Muscles
and Cardio trend; from Build 2, recovery trends).

Everything else keeps its function and takes the new look: the edit panel, the task card that calendar
links open (`?task=`), outcome forms, flags, ⚙ settings (with ⚙ → Claude, changes and Undo), backups
and notifications.

## Arrange

The timeline stays first. Tiles can be reordered (drag, or ↑ ↓ on touch and narrow windows) and hidden,
as now. The arrangement stays per device. `js/layout.js` keeps its shape. Old ids map to new ones on
load: `gym` becomes `body`, `history` becomes `weeks`, and `agenda` becomes `needs`. `muscles` and
`cardio` are dropped into Body's big view. `note` leaves the tiles for the timeline. `fuel` arrives
hidden until Build 3.

## Sky details

- **The sun's position** comes from sunrise and sunset worked out on the device (the standard NOAA
  solar formula), with no network. The place follows the device's time zone: `Europe/London` is London,
  `Europe/Vienna` is Salzburg, and anything else falls back to London. A ⚙ → The day setting can pin it.
- **Phases** are bands of flat colour (no gradient washes). Each phase has a fixed palette, defined as
  tokens.
- **Day and night.** The Look setting keeps its three values: *Follow the day* (default), *Paper* (always
  the day palette) and *Night* (always night). The existing rule stays the same, and so does the inline
  `<head>` script that sets it before paint: night from the evening hour until the day starts. At night
  the sky is dark with stars and the moon, and every tile has a night tint. Both palettes are checked
  for contrast: text 4.5:1, large text 3:1.
- **Motion** is limited to things that mean something: the sun's slow glow, the now line, a ring or
  plate filling when its number changes, and a short gold burst on a tick. All of it is off under
  `prefers-reduced-motion`.

## Type and assets

- Bricolage Grotesque for display, Figtree for text and Rubik for Hebrew (all SIL OFL).
- The fonts are **self-hosted** as woff2 under `fonts/` and added to `sw.js`'s shell, so the app looks
  the same offline. No Google Fonts request.
- Icons are inline stroke SVG, as now. No emoji in the interface.

## Switching over

- Daylight is built beside the current screen and reads the same store. ⚙ → Look gains **Screen:
  Daylight / Classic**. It starts on Classic, and `?daylight` turns Daylight on for one visit.
- When George is happy (a few days on both devices), Daylight becomes the default. A week later the
  classic screen and its CSS are deleted in their own commit.
- Every release runs `npm run build` and `npm test` and includes `release.json`, since nearly every
  shell file changes and a stale manifest blocks the offline update.

## Files

- `index.html`: new shell (sky, timeline, tiles), with the same ids where the logic needs them.
- `styles.css` becomes `styles/daylight.css` plus `styles/tokens.css` (day and night tokens). The classic
  CSS stays until it is removed.
- `js/sky.js` (pure): sun times, phase, arc position, dots for blocks.
- `js/ui/sky.js`: draws the header.
- `js/ui/timeline.js`: replaces `js/ui/today.js`'s list drawing, reusing its row logic (`renderRow`,
  `progressCell`, suggestions, drag). The pure ordering of rows, commitments and meal markers goes in
  `js/timeline.js` so it can be tested.
- `js/ui/tiles/*.js`: one file per tile (body, fuel, hebrew, goals, weeks, needs, countdown, week),
  each exporting `render(ctx)` and an optional `big(ctx)`, registered as `WIDGETS` is today.
- `js/ui/widgets.js` keeps Arrange and becomes the tile registry.

## Tests

`js/sky.js` (sunrise and sunset for London and Salzburg against published times; phase boundaries;
arc positions), `js/timeline.js` (order with commitments, untimed, carried and suggested rows; the now
line), layout migration of old ids, the palette and contrast check extended to both token sets, the
head script test unchanged, and the browser smoke test run against Daylight.

---

# Build 2: Health link

The 18 Oct test (`dev/health-spike/`, not committed) showed the Google Health API returns George's
resting heart rate, daily HRV, SpO2, sleep with stages, Active Zone Minutes by the minute, exercise
sessions (auto-detected walks and cardio, with average heart rate, zone minutes, heart-rate zone
durations and calories) and daily steps. VO2 max and weight came back empty. Apps Script's own login is
refused by the API (`DISALLOWED_OAUTH_SCOPES`), so the script uses its own OAuth client with the three
read-only health scopes and keeps a refresh token.

**Gate:** the test's hourly heartbeat must still be fine on Mon 26 Oct, past Google's 7-day mark, before
this build goes live. If the refresh token lapses, the fallback is the official Google Health CLI run on
the laptop, and this section is rewritten before building.

## The script

- The **Health test** Apps Script project becomes **Dashboard health**, in the same Cloud project (now
  "In production", unverified, which is fine for one user). Like the planner, it loads its code from the
  site (`planner/health.js`, bundled by `planner/build.mjs`), so updates arrive with a push.
- **Script properties:** `CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN` (already set), plus `GITHUB_TOKEN`
  and `SYNC_REPO` (a token limited to `dashboard-sync`, Contents read and write). `saveClient` and
  `authorize` stay for re-linking.
- **Every 30 minutes** it reads the last 3 days (to catch late syncs from the watch), and on its first
  run 120 days. It writes **`health.json`** at the root of `dashboard-sync`.
- It is a **separate file with one writer**, so it can never clash with `data.json`'s merge, and a fault
  here can't touch the calendar planner.
- **Read only.** Nothing is written to Google Health.

## `health.json`

```json
{
  "v": 1,
  "updated": "2026-10-20T09:05:00Z",
  "status": { "lastRun": "…", "lastOk": "…", "error": null },
  "days": {
    "2026-10-20": {
      "rhr": 61,
      "hrv": { "avg": 46.2, "deep": 32.2 },
      "spo2": { "avg": 95.6, "low": 93.5, "high": 97.4 },
      "sleep": { "start": "…", "end": "…", "asleepMin": 452, "stages": { "deep": 0, "light": 0, "rem": 0, "awake": 0 } },
      "steps": 7120,
      "azm": 24,
      "cardioMin": 18
    }
  },
  "sessions": [
    { "id": "…", "start": "…", "end": "…", "type": "WALKING", "avgHr": 101, "azm": 2,
      "zones": { "light": 1680, "moderate": 60, "vigorous": 0, "peak": 0 }, "kcal": 264, "device": "Pixel Watch 3" }
  ]
}
```

- `days` keeps 120 days and `sessions` 60. A missing value is absent, never 0.
- A day belongs to the sleep's wake date. Days use the dashboard's logical day (it starts at 4am).

## Cardio, counted honestly

- **Cardio minutes** are Active Zone Minutes **outside strength sessions**. Lifting raises the heart
  rate but isn't the cardio the report asks for. A strength session is a watch `STRENGTH_TRAINING`
  session or a Hevy workout window.
- **Hevy workouts appear in Google Health** as `STRENGTH_TRAINING` with no device. They are matched to
  Hevy by start time (within 10 minutes) and never counted twice.
- The **Cardio target becomes 150 minutes a week.** Its progress comes from `cardioMin`.
- Hevy's cardio logs (`hevy-cardio-*`) stop counting toward it from the first day `health.json` has
  data. They stay in history.
- To keep the day score, history and Claude working as they do, the **planner** reads `health.json` each
  run and writes one amount log per day, `watch-cardio-<day>`, against the Cardio target, following
  later changes the way it follows Hevy edits.

## What George sees

- **The sky** gains last night's line: "Slept 7 h 32 · HRV 46 · resting 61".
- A **verdict** comes from the coach's fixed rules (Build 4). Until then, the plain numbers show.
- **Body:** cardio this week against 150, from the watch.
- **Body's big view:** 90 days of sleep, HRV and resting heart rate, each against a 14-day median band,
  plus the sessions list.
- **Staleness:** if `status.lastOk` is more than 3 hours old, the sky's cloud chip says "Watch data
  3 h old". On a token problem it says "The watch link needs you: run authorize in Dashboard health".

## Claude

- `health [days]` (default 14): the days, sessions and status, with every raw number.
- `catchup` gains one line: sleep, HRV and resting heart rate against their medians, cardio minutes
  against 150, and anything stale.
- The app reads `health.json` with the devices' existing GitHub key. Claude's skill reads it with its own.

## Files and tests

- **Files:** `planner/health.js` (the run), `js/health.js` (pure: parse API pages into days and
  sessions, cardio outside strength, Hevy matching, medians), `planner/apps-script/Health.gs` (the
  loader, `saveClient` and `authorize`), the planner's `watch-cardio` reconcile, `js/sync.js` (read
  `health.json` beside `data.json`), and `claude/read.js`.
- **Tests:** parsing recorded API pages (from the spike's shapes), wake-date days, cardio exclusion,
  Hevy matching, a missing value staying absent, reconcile idempotence, and the stale chip. All run
  against fakes; no test calls Google.

---

# Build 3: Food

## The flow (phone first; works on the laptop too)

1. **Snap.** "Snap a meal" (the Fuel tile, a meal marker, or the phone's big button) opens the camera
   (`<input type="file" accept="image/*" capture="environment">`).
   - Before or after the photo, an optional line, typed or spoken ("chicken wrap, a big one, and
     crisps").
   - **Usual meals** sit as chips above the shutter: one tap logs them exactly, no photo.
   - "No photo" allows a line alone.
2. **Estimate.** The photo is shrunk on the device (longest side 768 px for Gemini; a 480 px JPEG of
   about 40 KB is kept). Gemini Flash, on the free tier with the device's key, gets the photo, the line
   and the time. It returns JSON: the items, each with protein and kcal, and totals as low / mid / high.
   The request is checked against a schema and retried once.
   - George can close the sheet; it finishes in the background.
   - Offline, or when Gemini fails, the meal is kept as **pending** with its photo queued in IndexedDB.
     It is estimated when the device is next online, and the Fuel tile shows "1 meal waiting".
3. **Check and save.** The name, the protein range (the hero number), the kcal range and the item lines.
   - **Portion:** *lighter*, *about right* or *bigger*, scaling the mid value by 0.75, 1 or 1.3.
   - "Save as a usual meal" makes it a one-tap chip next time.
   - The button says the day's new total: "Save · 88 of 180 g today".

## Data

A new map `meals` in `data.json` (added to `MAPS`, merged like the others):

```json
{
  "id": "meal:…",
  "kind": "meal",
  "day": "2026-10-20",
  "at": "…",
  "slot": "lunch",
  "text": "chicken wrap, a big one, and crisps",
  "photo": "photos/2026/10/meal-….jpg",
  "status": "estimated",
  "estimate": {
    "name": "Chicken wrap and crisps",
    "items": [{ "name": "Large chicken wrap", "protein": 40, "kcal": 560 }],
    "protein": { "low": 38, "mid": 46, "high": 54 },
    "kcal": { "low": 650, "mid": 780, "high": 900 },
    "model": "gemini-…"
  },
  "portion": "right",
  "final": { "protein": 46, "kcal": 780 },
  "correction": null,
  "usualId": null,
  "source": "me"
}
```

- `status` is one of `pending`, `estimated` or `failed`.
- `correction` is `{ by: 'claude', protein, kcal, why, at }` and, when present, overrides `final` in
  every total.
- A **usual meal** is `{ kind: 'usual', name, protein, kcal, uses }`.
- **Fuel's settings** are one record, `fuel:settings`: `{ kind: 'settings', protein: 180,
  maintenanceKcal: null }`. Claude sets `maintenanceKcal` once a fortnight of meals exists. Until then
  the tile shows the weekly average with no verdict.
- Meals are never deleted; they are archived, like everything else.
- The `slot` comes from the time: breakfast before 11:00, lunch 11:00–15:00, dinner 17:00–21:30, a
  snack otherwise.
- **Photos** are uploaded by the device to `dashboard-sync/photos/YYYY/MM/<id>.jpg` through the GitHub
  contents API, with the devices' key, separately from `data.json` (about 60 MB a year). Claude reads
  them with its own key.

## Fuel tile and big view

- **Tile:** today's protein as a filling plate against 180 g, the meals so far with thumbnails,
  "Snap a meal", and one line: the week's average kcal a day ("about maintenance" when it is within
  ±10% of `maintenanceKcal`).
- **Big view:** 14 days of protein against 180 and kcal against maintenance, every meal with its photo,
  and Claude's corrections marked.
- **No daily calorie target and no red numbers.** He is maintaining.

## Claude

- `food [days]` (default 7) lists every meal with its estimate, portion, final value, photo path and
  any correction, plus daily protein and the weekly kcal average.
- `meal` op: correct one (`{ id, protein, kcal, why }`), add a usual meal, or set Fuel's settings
  (protein target, maintenance kcal).
- **The weekly planning chat includes a meal check:** Claude looks at the photos of outliers and
  corrects big misses.
- `catchup` gains one line: protein days on target, the kcal average, and meals waiting.

## Privacy

A meal sends Gemini the photo, the line and the time, nothing else. On the free tier Google may use
them to improve its products. ⚙ → Gemini says so, as it does for check-ins.

## Files and tests

- **Files:** `js/food.js` (pure: shrink parameters, the prompt and schema, parsing and validating
  replies, portion scaling, slots, totals and averages, usual meals), `js/photos.js` (the IndexedDB
  queue and upload), `js/ui/snap.js`, `js/ui/tiles/fuel.js`, `claude/` reads and ops.
- **Fake Gemini** gains meal modes (`?fakegemini=meal`, `meal-slow`, `meal-nonsense`, plus the existing
  `quota`, `down` and `offline`).
- **Tests:** reply parsing (good, partial, nonsense), portion maths, totals with corrections, offline
  queue order, the upload path, and merge of `meals` from two devices.

---

# Build 4: Coach

## Who does what

- **Claude (in a chat):** "plan my training" reads Hevy history, the watch, back mornings, meals and the
  calendar, then writes the coming days' sessions, following the report's rules and George's
  progression. The skill gains a `reference health` playbook carrying those rules, the gym/bodyweight
  modes (Salzburg from 7 Nov: bodyweight only) and when to say "see the GP".
- **The planner:** pushes each session into Hevy as a routine and keeps the calendar block's
  description in step.
- **The app:** shows the session, runs three fixed rules, and asks one back question each morning.

## A session

A session is a dated task (area Health), titled "Gym · Lower A", with `details.session`:

```json
{
  "name": "Lower A",
  "note": "First session in 13 days, so loads start near 90%.",
  "exercises": [
    { "name": "Squat (Barbell)", "sets": 3, "reps": 5, "kg": 95 },
    { "name": "Trap Bar Deadlift", "sets": 3, "reps": 6, "rpe": 7 },
    { "name": "Bulgarian Split Squat", "sets": 3, "reps": 8, "kg": 16, "each": true }
  ],
  "cardio": { "kind": "bike", "minutes": 25, "hr": [118, 138] }
}
```

- Exercise names must match Hevy templates (the `gym` map's templates). The `session` op checks them
  and refuses an unknown name, listing the closest matches.
- The planner books the task as it books any task. The event's **description lists the exercises**, so
  they show in Google Calendar and on the watch.
- Each run, the planner creates or updates a **Hevy routine** for each session task in the coming 7 days,
  in a Hevy folder called "Dashboard" (`POST/PUT /v1/routines`, with the `HEVY_KEY` it already holds;
  Hevy Pro). It keeps `routine:<taskId>` in the `gym` map and deletes the routine when the task is
  archived or its day passes unticked.
- **Ticking:** a Hevy workout whose `routine_id` matches a session's routine ticks that task ("via Hevy",
  moving its block, as Gym's habit is ticked today). Any workout still ticks the Gym habit as now.
- Hevy writing is new: until now the planner only read. Build 4's plan starts by confirming the routine
  endpoints and payload against Hevy's API docs, and the README says plainly that the planner now writes
  routines to Hevy, and only routines.

## The morning back question

- From the day's start until 11:00, the timeline's first row asks "How's your back this morning?" with
  **fine / stiff / sore / bad** (0–3).
- One tap writes a journal record `back:<day>` (`{ kind: 'back', day, score, at }`), and the row turns
  into "Back this morning: fine".
- Unanswered by 11:00, it goes; a missing morning is just missing.
- Body shows the last 7 mornings, and its big view 90.

## Fixed rules (no AI; `js/coach.js`, pure)

1. **Recovery verdict** (in the sky), from last night against the 14-day medians:
   - **Recovered:** HRV ≥ 90% of median, resting HR ≤ median + 3, and sleep ≥ 6 h 30.
   - **Take it easier:** HRV < 80% of median, resting HR ≥ median + 5, or sleep < 5 h 30. If a session is
     on, the sky adds "Heavy day planned: an easy bike session instead is fine." Nothing moves by itself.
   - **Normal:** anything else.
   - Fewer than 7 days of data: no verdict.
2. **Back flag:** a morning score of 2 or 3 on a day with a hinge (deadlift variants) or heavy squat in
   the session adds a note to that row: "Back's sore: swap the deadlift for back extensions, or drop the
   load." Two sore mornings in a row also go to Claude as a flag (*For Claude*) for the next plan.
3. **Ready to add weight:** after a session, each exercise where every prescribed set hit its reps (at
   or under the RPE, where Hevy has one) is marked ready. Claude reads the marks when planning; the
   Body big view shows them.

## Claude

- `session` op: set, change or clear a session on a dated task (checked against templates).
- `gym` read gains the planned sessions, the routine sync status and the ready marks.
- `back [days]` read.
- `catchup` gains one line: back mornings and sessions done against planned.

## Files and tests

- **Files:** `js/coach.js` (verdict, back flag, ready marks), `planner/routines.js` (the Hevy routine
  payload and sync), the planner's tick-by-routine, `js/ui/timeline.js`'s back row and session row,
  and the Claude ops, reads and playbook.
- **Tests:** verdict boundaries, back flag triggers, ready marks against recorded workouts, the routine
  payload, idempotent sync (create, update, delete), the routine tick, and the `session` op's template
  check, all against a fake Hevy.

---

# Keeping it running

| Piece | Runs | Writes | When it fails |
|---|---|---|---|
| The app (GitHub Pages, offline service worker) | on each device | `data.json` through sync; photos | Works offline; sync catches up |
| Dashboard planner (Apps Script) | every 10 min | `data.json`, Google Calendar, Hevy routines (Build 4) | Header warning after 30 min; each part fails alone with a sentence |
| Dashboard health (Apps Script, Build 2) | every 30 min | `health.json` only | Cloud chip in the sky after 3 h; ⚙ shows its last run |
| Gemini (free tier, device key) | on demand | check-in summaries, meal estimates | Words or the meal kept; estimated later |
| Claude skill (`dash.mjs`) | in chats | `data.json` | Unchanged |

- ⚙ → Claude → *Background jobs* lists each job with its last good run and its last error.
- Every external call keeps the house pattern: a timeout, a sentence for George, and never a crash.
- New pure modules are fully tested against fakes. The browser smoke test covers the Daylight screen,
  the snap flow (with fake Gemini) and offline.

# Not doing

- No in-app chat or AI planning. No calorie targets, deficits or red numbers. No barcode scanning yet
  (Open Food Facts is the later option if packaged food matters).
- No Android app or Health Connect. Nothing written to Google Health. Watch data never goes to Gemini.
- No VO2 max or weight panels until the watch or George provides data.

# Risks

- **The Google Health refresh token** surviving Google's 7-day mark (gate: Mon 26 Oct).
- **Hevy routine writing:** the endpoints are confirmed at the start of Build 4.
- **Gemini free-tier vision quotas:** a failure leaves the meal pending, never lost.
- **Photo storage:** about 60 MB a year in `dashboard-sync`. If it ever matters, photos older than a year
  can be pruned to a separate repo.
