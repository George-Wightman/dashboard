# Calendar planner — design

2026-09-14. Approved in brainstorming, question by question and in two parts. Piece 6 of the
roadmap, reshaped: not "today's events beside the list" but the calendar planning itself from the
dashboard. The app shows today; Google Calendar shows the week.

## Where this came from

George asked whether this should be an app integration or a Claude skill that builds the calendar
from what's in the app, and how to make it *"responsive, useful but also flexible around things I
have set in calendar"*. Answers that shaped it:

- **Automatic, but not rigid.** Keep the calendar in step without asking (option B), plus the part
  of full automation where *"applications and job searches can change if I set for instance a
  shift in that time"*. Gym is *"hard as sometimes I set it specifically where most of the time
  it's dynamic"*.
- **Finishing never deletes history.** *"When I finish a task (in the past) I don't want the block
  to disappear, but if I finish it early / have more time allocated then it shifts to when I
  finished and future clears up."*
- **Every task gets a slot, intelligently.** Similar tasks grouped; Hebrew and Gym *"are already
  there, they just need moving around"*. *"Being able to rely on the auto adding and ordering would
  be good"*, with a weekly check done in Claude.
- **Rough, then exact.** The calendar shows the week *"in rough, as things get clarified and more
  specific closer to the time"* — outlines further out, with Gym and Hebrew kept separate even
  then, and colours that follow Google Calendar's.
- Calendars: Work is fixed; University timetable, MiM Committee, Family and PhD are irrelevant now;
  Challenger is changeable.

What his calendar showed (14 Sep): Learn Hebrew daily 9:30–10:15 on the main calendar, moved by
hand some days (today to 11:45, Sunday to 12:00); Gym daily 11–1 on its own calendar; Signify shifts
on Work at irregular times; review slots, interview-prep blocks and an interview on Application; no
event linked to a dashboard task yet. The dashboard holds 21 dated tasks from Claude's plans (areas
*Job search* and *Assessment centre*), habits (Hebrew daily, Gym 5× a week, Sweep the boards Mon /
Wed / Fri, one outreach action 2× a week, Friday review) and weekly targets (3 applications, 6
roles, Assessment centre prep 5h, Hebrew 4h).

## Approach

Three parts, each doing what it's good at:

- **The planner** — a Google Apps Script running in George's own Google account. Every 10 minutes,
  and when a watched calendar changes, it reads the dashboard and the calendars and keeps the next
  7 days of blocks in step, by fixed rules. Rules, because a planner George relies on must do the
  same thing every time.
- **Claude** — the judgement, in the weekly check ("plan my week"): which day each task goes on,
  how long things take, which area they belong to. The rules then work from that.
- **The dashboard** — today's list, with each task's time from the planner, in the day's order.

Considered and set aside: Gemini re-planning on every run (an AI re-deciding the week every 10
minutes reshuffles for no visible reason); a GitHub Actions timer running the app's code (needs a
Google Cloud project and sign-in keys that expire weekly unless the app is verified; the timer
runs late and can't react to a calendar change); signing into Google from inside the dashboard
page (Cloud project, an unverified-app warning, re-signing on the phone).

## 1. What goes in the calendar

The planner looks at **today and the next 6 days**.

- **Blocks by area.** A day's active tasks and habits are grouped by `area` into one block per
  area per day: *Job search ×2*. A block of one task takes the task's title. Tasks with no area
  group as *Tasks*. A block longer than **2½ hours** splits into two. Carried-over tasks join
  today's blocks. Suggested items are never planned.
- **Length.** The item's own length (`minutes`, new, section 6) if set, otherwise **30 minutes**.
- **Weekly time targets add time.** A weekly target measured in minutes (*Assessment centre prep
  5h*) spreads what's left of the week — target minus logged — over the remaining days: that area's
  block on each day is at least its share (rounded up to 15 minutes), and a day with no tasks in
  the area gets a block of its own. Next week's days in the window take an even share of the full
  target. A target whose area is covered by a calendar habit (Hebrew) adds nothing — its events are
  the time. Count targets (applications, roles) add no time.
- **Habits.** A habit linked to calendar events (section 5) is never booked — its events are moved,
  never copied or deleted. Other habits join their area's block on the days they're due. A
  *N× a week* habit is spread evenly over the week's remaining days (outreach 2×: two days, not
  every day).
- **Tasks with a time** (`time`, new, section 6) become a fixed event at that time, for their
  length: *ASSESSMENT CENTRE* 09:30 for 6½ hours on 5 Oct.
- **Which calendar.** By area, so blocks take George's colours: Job search and Assessment centre →
  *Application*; Health → *Gym*; Challenger → *Challenger*; anything else → the main calendar.
- **Rough and exact.** Today and tomorrow are **exact**. Days 3–7 are **rough**: the same kind of
  timed block, titled with a leading `~ ` and painted the paler partner of the calendar's colour.
  Google's event colours come in light and dark pairs (Sage/Basil, Lavender/Blueberry,
  Flamingo/Tomato, Banana/Tangerine); the planner finds the event colour nearest the calendar's
  colour and uses its light partner. Exact blocks use the calendar's own colour. **At 20:00 each
  evening** the day after tomorrow turns exact where it stands (drop the `~`, full colour), so
  George always wakes up to two exact days. Google's outlined look belongs to unanswered
  invitations; getting it would mean inviting himself to every rough block, which puts copies on
  his main calendar and sends notifications, so the pale colour carries "rough".
- **Titles and descriptions.** Exact: *Job search ×2*. Rough: *~ Job search ×2*. Done:
  *✓ Job search ×2*. Part-done: *Job search · 1 of 2 done*. The description lists each task with a
  `dashboard:<id>` line (the existing convention) and one line: *Planned from your dashboard. Move
  it and it stays where you put it.*

## 2. Where blocks go

- **Planning hours: 9:00–19:00, every day.** A block keeps **15 minutes** clear of fixed events.
- **What blocks time:** every timed event on a watched calendar, unless it's marked *free*. All-day
  events don't block. Ignored calendars (University timetable, MiM Committee, Family, PhD, UK
  holidays) are never read.
- **Order**, per day: fixed events → anything George placed himself → linked habit events at their
  current times → exact planner blocks that can stay → everything else, carried-over first, then
  biggest first, each into the **earliest** free stretch that fits.
- **Today** starts from now, rounded up to the next quarter hour. Nothing that has started is ever
  moved.
- **Doesn't fit** → the next day in the window; beyond the window, it waits. Either way the
  dashboard gets a note (section 7).
- **Linked habit events** move only when something fixed or pinned now overlaps them, to the
  nearest free stretch of their length on the same day; if there's none, they stay and a note says
  so.

## 3. Staying put

- **An exact block moves only if it has to:** a fixed or pinned event now overlaps it, it no longer
  fits within planning hours, or its tasks changed and it no longer fits where it is (a longer
  block first tries to grow in place). Never for neatness.
- **Rough blocks** are recomputed every run. The placement is deterministic, so they move only when
  their inputs change.
- **Anything George moves sticks.** The planner remembers, on each event it places (private event
  properties), where it put it. If the start or end now differs, George moved it: it is **pinned**
  — never moved again, and planned around. A linked habit instance whose start differs from its
  series time with no planner record of moving it was moved by George, and is pinned too. So
  today's Hebrew at 11:45 is pinned, and the default Gym at 11–1 under it is the one that yields.
- **Deleted by George** → that task isn't booked again that day. It can be booked on a later day as
  it carries over.

## 4. When George ticks things off

The planner reads the tick's time from the log entry's `at`.

- **Ticked during its block** → the block ends at the tick (for a group, at the last tick). The
  rest of the slot is free; nothing is pulled forward into it.
- **Ticked before its block, or later the same day** → the block moves to end at the tick, keeping
  its length, but never starting before the previous event that day ends (at least 15 minutes
  long). Its planned slot clears.
- **Part of a group done when the block ends** → the title shows *1 of 2 done*; the rest gets a new
  slot.
- **Block ends with nothing ticked** → the block is removed and its tasks get a new slot (later
  today if there's room, otherwise as they carry over). The calendar shows what really happened.
- **Linked habit events** follow the first two rules. They are never removed.
- A block that has ended is history and is never moved again.

## 5. What's already in the calendar

- **The planner moves only blocks it made, and linked habit events.** Everything else is fixed:
  things George added, things Claude booked in a chat, the job-tracker skill's review slots,
  interviews, shifts.
- **An event carrying `dashboard:<id>`** that the planner didn't make (booked by Claude in a chat)
  is adopted as that task's block, pinned, and never booked twice.
- **Linked habits:** *Learn Hebrew* on the main calendar ↔ the Hebrew habit; *Gym* on the Gym
  calendar ↔ the Gym habit. Links are in the planner's settings (section 6).

## 6. Data

### Items

Two optional fields:

| Field | On | Meaning |
|---|---|---|
| `minutes` | tasks, habits | Length, a whole number of minutes, 5 to 720 |
| `time` | tasks | `HH:MM` — a fixed start time on the task's date |

`schema` stays 1: additive, and older copies ignore fields they don't know.

### The `calendar` map

A new synced map, added to `MAPS`, written by the planner (`source: 'planner'`) except `config`.
Older copies of the app pass it through the merge untouched.

| Record id | Holds |
|---|---|
| `config` | The planner's settings (below). Written by Claude or George; seeded by the planner if absent. |
| `status` | `lastRun` (ISO), `lastError` (text or null), `version` (the planner's build) |
| `slot:<itemId>:<day>` | `itemId`, `day`, `start`, `end` (ISO), `state` (`rough` · `exact` · `done` · `missed` · `skipped`), `calendar` (name), `eventId` |
| `note:<ISO time>` | `day`, `text` — *Moved Job search to 15:30 (Signify)*. Archived after 7 days. |

`config`, with its defaults:

```json
{
  "hours": ["09:00", "19:00"], "gapMinutes": 15, "defaultMinutes": 30, "maxBlockMinutes": 150,
  "days": 7, "exactDays": 2, "firmUpHour": 20,
  "ignore": ["University of York", "MiM Committee Meetings", "Family", "PhD", "Holidays in United Kingdom"],
  "areaCalendars": { "Job search": "Application", "Assessment centre": "Application",
                     "Health": "Gym", "Challenger": "Challenger" },
  "defaultCalendar": "main",
  "habitEvents": [{ "habit": "Hebrew", "calendar": "main", "title": "Learn Hebrew" },
                  { "habit": "Gym", "calendar": "Gym", "title": "Gym" }]
}
```

A `habitEvents` entry names its habit by id or, as in the defaults, by the start of its title
(*Hebrew* matches *Hebrew - app plus Duolingo*); an entry matching no active habit, or more than
one, is skipped with a note.

Calendars are named as George sees them, matched ignoring case and surrounding spaces (his
*Gym* and *Application* calendars end in a space); `main` is his primary calendar. An `ignore`
entry matches a calendar whose name starts with it.

**Writes.** The planner pushes to `data.json` only when a `calendar` record changed, plus a
`status` heartbeat at most once an hour — not every 10 minutes, so the sync repo doesn't gain 144
commits a day.

## 7. The planner script

**Code.** Lives in the repo under `planner/`. The pure core, `planner/core.js`, takes the document,
the calendars' events, the settings and the time, and returns the calendar changes to make and the
`calendar` records to write. It uses the app's own modules (`schedule.js` for what's due on a day,
`dates.js`, `parse.js`), so it follows the app's rules exactly. `planner/gas.js` is the Apps Script
side: reading and writing calendars through the Calendar advanced service, the GitHub client, the
lock, the triggers. A build (`npm run build-planner`) bundles both and the app modules they use into
one file, `planner/planner.js`, committed so GitHub Pages serves it. A test fails if it's out of
date.

**Apps Script has no ES modules and no browser globals.** The bundle is one script defining a
global `Planner`. Stand-ins, installed only where the global is missing: `fetch` over `UrlFetchApp`,
`TextEncoder` / `TextDecoder` and `btoa` / `atob` over `Utilities`, `structuredClone` as a JSON
round-trip, `crypto.randomUUID` as `Utilities.getUuid`. The time zone comes from the project's
manifest (`Europe/London`).

**George's project** holds two small files he pastes once:

- `appsscript.json` — the time zone, the V8 runtime, the Calendar advanced service, and the three
  permissions (calendars, outside requests, triggers).
- `Code.gs` — a loader of about 20 lines: `run`, `install`, `pause`, `resume` and `removeAll`, each
  fetching `https://george-wightman.github.io/dashboard/planner/planner.js` and calling into it. Every
  update pushed to the repo reaches the planner on its next run, as with the Claude skill. It runs
  code from George's own public repo with his calendar and his planner key — the same trust the
  app on Pages already has with his sync key.

**Script properties:** `GITHUB_TOKEN` (the planner's own fine-grained key: Contents read/write on
`dashboard-sync` only), `SYNC_REPO`, and optionally `GEMINI_KEY`.

**Triggers,** made by `install`: every 10 minutes, and on event changes in each watched calendar.
A calendar-triggered run within 2 minutes of the planner's own last write is skipped: that's its
own echo, and the 10-minute run catches anything missed.

**One run:**

1. Take the script lock; if another run holds it, stop. If paused, stop.
2. Fetch `data.json` into an in-memory store (`createStore`, as the Claude tool does).
3. Tag new untagged tasks (below).
4. Read the calendar list; read the watched calendars' events from today to the end of the window
   (single instances, including deleted ones, so a planner block George deleted is noticed).
5. `core.plan(...)` → calendar changes and `calendar` records.
6. Apply the calendar changes one by one.
7. Write the records into the store and push with `syncOnce`, if changed or the heartbeat is due.

Each run redoes the whole job from the calendar as it really is, so a run cut short is finished by
the next.

**Tagging.** A task in the window with no area gets one Gemini call choosing among the dashboard's
existing areas, or none. The answer is remembered by item id in script properties, so no task is
asked about twice. At most 5 per run; skipped when there's no `GEMINI_KEY`. The planner writes the
area onto the task.

**`removeAll`** deletes every future event the planner made, and pauses it. **`pause` / `resume`**
set a script property.

## 8. The dashboard

- **Length and time on tasks.** The add box reads a trailing length or time: *Draft cover letter
  2h* (`2h`, `90m`, `1h30`, `1.5h`) and *Call NatCen 14:00*. The edit panel gets *Length* (tasks and
  habits) and *Time* (tasks).
- **Today's rows show their time** from today's exact `slot` (*14:00*), and the list follows the
  day's order: undone rows with a time first, by time; then undone rows without one, in manual
  order; done rows last, as now. Suggestions stay at the top and weekly targets at the foot.
  Dragging reorders only rows without a time.
- **Planner notes** — today's notes as one line each under the header (at most two, newest first),
  each with × to hide it on that device.
- **Planner health.** ⚙ gets a folded *Calendar planner* group: last ran, paused or not, the
  planning hours. Once the planner has ever run, the header warns *calendar planner hasn't run
  since 12:00* when `lastRun` is over 70 minutes old.
- `sw.js` cache and `APP_VERSION` → `dash-v7`.

## 9. Claude

- **Claude stops booking blocks.** It sets lengths, times and areas; the planner books. The
  `SKILL.md` calendar section is rewritten accordingly.
- **The weekly check — "plan my week".** Claude reads the dashboard and the calendar, spreads the
  week's tasks and the next goal stage across the days (with dates), sets lengths on anything
  bigger than half an hour, and gives untagged tasks an area. The calendar follows within 10
  minutes.
- **The tool.** `task` and `habit` take `minutes` (`"2h"`, `"90m"`); `task` takes `time`
  (`"14:00"`); `edit` accepts both. `week` shows each day's blocks from the `slot` records, with
  times and rough/exact. A new read, `planner`, shows the settings, the last run and recent notes. A
  new op, `planner`, changes settings: `{"op": "planner", "hours": ["08:30", "18:00"]}`.
- **Tidy-ups when it goes live** (done through the tool, so they show in ⚙ → Claude's changes, with
  Undo): *ASSESSMENT CENTRE* gets `time` 09:30 and 6½ hours; the bigger existing tasks get realistic
  lengths.

## 10. Failures

- **GitHub or Pages unreachable, key refused** → the run stops before touching the calendar, and
  `lastError` is written on the next run that can reach GitHub. The header's *hasn't run since*
  warning covers the gap.
- **A calendar write fails** → that change is skipped; the next run retries it from the calendar as
  it then is.
- **A watched calendar was renamed or removed** → a note: *Can't find the "Application" calendar —
  blocks for Job search went to your main calendar*.
- **Bad settings** (a bad time, unknown calendar) → the defaults for that field, and a note.
- **Limits.** A consumer Google account gives scripts 90 minutes of trigger time a day; a run takes
  seconds. The lock stops runs overlapping.
- **The keys never show.** They're read from script properties and scrubbed from any error text
  (`scrubText`).

## Testing

- **Core, in Node, against fake calendars and a fake GitHub client:** grouping by area; the 30-minute
  default and the 2½-hour split; weekly-target shares; *N× a week* spreading; linked habits moved,
  never copied; tasks with a time as fixed events; placement order and the 15-minute gap; today
  starting from now; overflow to the next day; each tick rule; missed blocks; part-done titles;
  pinning (a moved block, a moved habit instance); a deleted block not rebooked; adoption of a
  `dashboard:<id>` event; rough → exact at 20:00; rough colours; **running twice changes nothing**;
  the clocks going back on 25 Oct inside the window; the window crossing into next week.
- **The bundle:** it evaluates in a bare `vm` context with none of the browser globals, and the
  committed `planner/planner.js` matches a fresh build.
- **Dashboard:** the add box's length and time; the edit fields; row times and time order; notes and
  hiding them; the stale warning; `calendar` in `MAPS`.
- **Tool:** `minutes` and `time` on `task`, `habit` and `edit`; the `week` blocks; the `planner`
  read and op.
- **Live, once installed:** Claude reads the calendar through its connector to check the first
  run's blocks against the dashboard.

## George's one-off setup

1. A fine-grained GitHub key named *Calendar planner*: Contents read/write on `dashboard-sync`
   only.
2. script.google.com → New project, named *Dashboard planner*. Paste `appsscript.json` and `Code.gs`
   (Project Settings → *Show "appsscript.json"*). Project Settings → Script properties:
   `GITHUB_TOKEN`, `SYNC_REPO`, and `GEMINI_KEY` if he wants tagging.
3. Run `install`, and allow it: *Google hasn't verified this app* is expected for his own script →
   Advanced → Go to Dashboard planner → Allow.
4. Upload the rebuilt Claude skill zip at claude.ai → Settings → Capabilities → Skills.

## Out of scope

Showing calendar events inside the dashboard; planning beyond 7 days; booking time for count
targets; Gemini doing placement; editing the planner's settings in ⚙ (Claude or the `planner` op
does it); Notion and Hebrew imports (pieces 2 and 4).
