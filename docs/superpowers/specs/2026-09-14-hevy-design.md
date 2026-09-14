# Hevy — design

2026-09-14. Approved in brainstorming, question by question and in two parts. Builds on the calendar
planner (piece 6) and Claude as director. The Coach redesign (its own spec) uses what this adds.

## Where this came from

George has Hevy Pro and is about to train more: *"I want to do more cardio but still keep making
progress with my weight training, specifically squats and bench press."* He wants Claude to use the
data and present it *"in a visually appealing, useful and on theme way"*.

Decisions:

- **Source** — Hevy only. Cardio counts when it's logged in Hevy (a walk at the end of a session as a
  Walking exercise, runs logged there too). Strava and the watch are left out; they could be added
  later without redoing this.
- **Read only** — *"I know what I'm doing when it comes to planning my sessions … I don't want him
  making sessions for me."* Nothing writes to Hevy. Claude predicts and guides; *"his suggestions can
  live in the tasks / planner"*.
- **Hevy ticks things** (option A) — a workout ticks Gym; cardio minutes count towards a weekly
  Cardio target; the Gym block moves to when he actually trained.
- **Where it runs** — the Google Apps Script planner (approach 1), so the key is in one place and the
  dashboard stays current without a chat.
- **The day's data for the app and the Coach** — *"so it can see what I have achieved in that day"*.

## 1. The connection

The planner's `run` gains one step before tagging and planning: **sync Hevy**. The key is the script
property `HEVY_KEY` (George pastes it; nothing prints it — `clean()` scrubs it with the others). No
new permission: `script.external_request` is already granted. With no `HEVY_KEY` the step is skipped
and the dashboard says Hevy isn't connected.

Requests go to `https://api.hevyapp.com` with the `api-key` header:

- **First run (backfill)** — `GET /v1/workouts?page=n&pageSize=10`, at most 20 pages a run (Apps
  Script's time limit), remembering the next page in the status record until done.
- **After that** — `GET /v1/workouts/events?since=<last sync − 5 min>&pageSize=10`, every page.
  `updated` replaces the workout; `deleted` archives it.
- **Exercise templates** — `GET /v1/exercise_templates?pageSize=100`, fetched on the first run, then
  again when a workout names a template id it doesn't know. Only title, type and primary muscle
  group are kept.

A failure (401/403 → *"Hevy refused the key — check HEVY_KEY in the script's properties"*; anything
else → *"Couldn't reach Hevy"*) is written to the gym status and never stops the planner. The next
run tries again. Hevy's API is "use at your own risk" and may change: a reply that isn't the shape
expected is a failure like any other.

## 2. The `gym` map

A new map in the document (`MAPS` gains `'gym'`), merged per record like the others; nothing is
hard-deleted.

| Id | Written by | Content |
|---|---|---|
| `w:<hevy id>` | the script | one workout (below) |
| `templates` | the script | `{ <template id>: [title, type, muscle] }` |
| `status` | the script | `lastSync`, `lastError`, `since`, `backfillPage` (null when done), `startedOn`, `count` |
| `config` | Claude | `keyLifts`, `liftTargets`, `cardioQuota`, `habit` |

A workout record: `hevyId`, `title`, `day` (the logical day of its start, using `dayStartHour`),
`start`, `end` (ISO), `minutes`, and `exercises`, each `{ name, tpl, kind, sets, best, e1rm, volume,
minutes, km }`:

- `kind` — `cardio` when the template's type is `duration`, `distance_duration` or its primary muscle
  is `cardio`; `lift` when it has weights and reps; otherwise `other`.
- `sets` — the working sets (warm-ups left out) as `[kg, reps, rpe]`, kept for key lifts only; other
  exercises keep just the count. After 400 days a workout keeps its summary and drops `sets`.
- `best` — the set with the highest estimated 1RM, as `[kg, reps]`; `e1rm` its estimate.

`config` defaults: `keyLifts: ['Squat (Barbell)', 'Bench Press (Barbell)']` (Hevy's titles),
`liftTargets: {}` (kg per lift), `cardioQuota: null` (a weekly target with unit minutes), `habit:
'Gym'` (by id or the start of its title, as `habitEvents` matches).

## 3. The numbers (`js/gym.js`, pure)

- **Estimated 1RM** — Epley, `kg × (1 + reps / 30)`, from working sets of 1–12 reps; rounded to
  0.5 kg for display.
- **A session's best** for a lift — its highest estimated 1RM that session.
- **PR** — a session best above every earlier one. A heavier weight than ever for the same reps is also
  a PR (*"80 × 6 — +1 rep"* compares to the last time at that weight).
- **Pace** — a straight-line fit through the session bests of the last 8 weeks, in kg per week; shown
  only with 4 or more sessions in that window.
- **Projection** — with a target and a positive pace, the week the line reaches it (*"120 by ~late
  Oct"*); otherwise none.
- **Cardio** — minutes and km per workout and per week, against the Cardio target.
- **The day** — a day's workouts as one line each: title, minutes, key-lift top sets with PRs,
  cardio.

## 4. Ticks, cardio minutes and the calendar

Only workouts from the Monday of the week the connection starts (`startedOn`) tick anything; older
history feeds the trends only.

- **Gym** — each workout gives the Gym habit a done log for its day (`source: 'hevy'`, `ref:
  'hevy:<id>'`, `at` = the workout's end, `from` = its start), unless that day is already ticked.
- **Cardio** — a workout with cardio gives the Cardio target an amount log (`source: 'hevy'`, the same
  `ref`, whole minutes). Edited in Hevy, the amount follows; deleted, its logs are archived.
- **George wins** — a Hevy log is made once per workout. If George unticks it, it stays unticked; his
  own ticks and amounts are never touched.
- **The calendar** — the planner treats a tick with `from` as the real span: the Gym block moves to
  `from`–`at`, the same run.

## 5. The Gym panel

A new widget, `gym`, in `WIDGETS` (Arrange can move or hide it; it shows nothing until there's gym
data). From the top:

- **Header** — *Gym* and *"3 sessions this week"*.
- **The week** — Monday to Sunday cells: teal where he lifted, a lighter-teal line along the bottom
  for cardio minutes, dashed for days to come.
- **Cardio** — the app's progress bar, *"95 / 150 min"*, gold when met.
- **Key lifts** — a card each (two across, stacked on a phone): estimated 1RM in the display serif, PR
  in gold, a sparkline of the last 12 session bests with the projection dashed on, the target a faint
  line, *"+1.1 kg/wk · 120 by ~late Oct"*, *"Last: 100 × 5 · Fri"*.
- **Today** — the day's session line, when he's trained.

Gold only for PRs and targets met (the palette rule). Elsewhere:

- **Today's list** — the Gym row, when Hevy ticked it: *"via Hevy · 17:40–18:38"* and the session line
  beneath; Claude's guidance behind its ≡ as now.
- **The day detail** (a history cell) — that day's workouts.
- **⚙ → Claude** — a Gym line: connected or not, last sync, workouts, any error.

## 6. The Coach and Claude

- **The Coach** — the context Gemini is given gains *"Gym today"* (the day's lines) and *"Training this
  week"* (sessions, cardio against target, key-lift bests and PRs); the digest gains a *Training*
  section. Facts only — the numbers are worked out in `js/gym.js`.
- **Claude's `gym` read** — the last 14 days' sessions; per key lift: estimated 1RM, last top set, PR,
  pace, projection; cardio against target by week; connection status.
- **Claude's `gym` op** — sets `keyLifts`, `liftTargets` (one lift per op, `null` removes),
  `cardioQuota` (a weekly target's id or title, with unit minutes) and `habit`.
- **The skill** — George plans his own sessions: Claude never writes sessions, and never touches Hevy.
  He predicts and guides — in the Gym habit's notes (on the Gym calendar block, so it's in front of
  George in the gym), the brief, or a task. He sets up the Cardio target with George.

## 7. Setting it up

George: paste the Hevy key into the Apps Script project's Script properties as `HEVY_KEY`. The
planner loads the new code itself. Then, in a chat, Claude sets the Cardio target and any lift
targets with him.

## 8. Testing

- `js/gym.js` — 1RM, PRs, pace, projection, cardio, the day's lines, 400-day trimming.
- The sync — against a fake Hevy: backfill across runs, events (update, delete), unknown templates, a
  401, a bad reply, no key; ticks and amounts made once, following edits, archived on delete, never
  re-made after George unticks.
- The planner — a Hevy tick moves the Gym block to the workout's span.
- The panel, the Today row and the day detail — rendered from fixtures.
- The Coach's context and digest; Claude's `gym` read and op.
