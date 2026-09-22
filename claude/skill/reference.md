# Dashboard tool reference

Run from this skill's folder: `bash run.sh <read> [argument]`, or `bash run.sh apply` with JSON on a
quoted heredoc (`<<'EOF'` … `EOF`). Ids are what the tool shows after `#` (any unique start of at
least 4 characters works). Dates: `YYYY-MM-DD`, `today`, `tomorrow`, `yesterday`.

## To do this → run this

Pick the row, not the whole file. The detail for each command is below.

| You want to | Read | Then change with |
| --- | --- | --- |
| See what's on today | `today` | `done`, `log` |
| Find something by name | `find <words>` | — |
| See everything coming up | `list` | `task`, `edit` |
| Give a task a length or a set time | `list` | `edit` with `minutes` / `time` |
| Put the detail behind a short title | `list` | `edit` with `notes` |
| Mark a day, or some hours, off | `planner` | `off` |
| Write the line at the top of George's day | `today` | `brief` |
| Break a big job into stages | `goals` | `plan` |
| See what needs you | `attention` | `edit`, `off`, `brief` |
| Check his training | `gym` | `gym` settings, the Gym habit's `notes` |
| See how he's been | `journal`, `talk <day>` | `guide` |
| Change how the calendar books | `planner` | `planner` |
| Tell the app's developer something | `handoffs` | `handoff` |
| Leave a note George will read | `flags` | `flag` |
| Discover supported controls without reading everything | `capabilities [topic|op]` | — |
| Inspect one record's full controls | `inspect <id>` | `details`, `edit` |
| Add readiness, checklist or success criteria | `capabilities details` | `details` |
| Make a simple conditional follow-up | `reference workflows`, `workflows` | `rule`, `report` |
| Review goal direction and suggest next steps | `reference reviews`, `inspect <goal-id>` | `review` |
| Check a batch without writing | `preview` with the same JSON as apply | `apply` after checking the result |

Three jobs have a playbook of their own, and they are the three that go wrong most. Read the playbook
**first**, before any of the reads above:

    bash run.sh reference calendar    # anything touching his Google Calendar
    bash run.sh reference planning    # "plan my week", or any reshuffle
    bash run.sh reference gym         # his training

If a command the tool mentions isn't in this file, this copy is older than the tool: run
`bash run.sh reference` for the current one.

## Reads

### `capabilities [topic|op]`
A compact, current capability index. Topics: `details`, `workflows`, `reviews`; an op name lists
its accepted top-level fields. No dashboard or API request is needed for discovery.

### `inspect <id>`
One record, excluding merge metadata, plus its blockers and linked rules. Use this before changing
advanced controls. Unlike the compact list, it shows the actual saved details.

### `workflows`
Enabled/paused rules, the ten most recent outcomes and rule runs, and ten recent goal reviews.
Inspect a shown ID for the complete record. Queued is not completed; a review requires the
existing Apps Script planner and its `GEMINI_KEY`.

### `today`
Today's list: suggestions waiting for ✓/✕, then to do, then done. Tasks carried over from earlier
days say *from Tue*; habits show their streak; weekly targets show this week's total.

### `week`
This week's weekly targets and times-a-week habits against their numbers.

### `goals`
Live and suggested goals, with progress, their milestones (`[x]` done, `?` suggested) and the items
linked to them.

### `list`
Everything live beyond today: upcoming tasks by date, every habit and how it repeats, every weekly
target.

### `find <words>`
Items, goals, milestones and flags whose title contains the words, archived ones included (so they
can be found again).

### `day <date>`
One day: what was on it, what was ticked, and any amounts logged.

### `history`
The last three weeks, day by day, as done/total.

### `journal`
Your guide for the Coach this week; the last 14 days' journal entries from George's conversations
with the Coach (how he was feeling, what was on his mind, pointers, anything handed to you); the
latest weekly digest; and the last three evening check-ins from before the Coach talked.

### `talk <day>`
A day's conversations with the Coach in full (`today`, `yesterday` or a date): who said what, what
the Coach changed, what it handed to you, and the entry each left. Messages go after 30 days; entries
stay.

### `flags [feature|bug|claude|note]`
Open flags, grouped by what they're for, each saying who wrote it (George, the Coach, Claude or a
follow-up rule). **Feature** and **Bug** are George's requests for changes to the app. **For Claude**
is something to act on or keep in mind: George's own notes for later and the Coach's handoffs from
his conversations — treat both as George's words. **Note** is something left for George to read. Give
a kind to see one group, e.g. `flags claude`. Flags written before kinds existed are grouped by who
wrote them. George can change a flag's kind in the ⚑ panel.

### `handoffs`
Handoffs still open — what you or an earlier chat told whoever maintains the app, and nobody has
dealt with yet. Read this before writing one, so the same fault isn't reported three chats running.

### `handoff <name>`
One handoff in full, by any unique start of the name `handoffs` shows.

### `changes [n]`
Your own last n changes (10 by default), with their ids for `undo`.

### `planner`
The calendar planner: when it last ran (and any problem), its settings, anything it couldn't use, and
its notes today (*Moved Job search ×2 on Wed to 15:15 (Signify)*), priority areas, area colours, day
hours, and the colours George's calendars already take. `week` also lists coming time off and what the
planner booked for the next seven days (`~` marks a rough time).

### `attention`
What needs you: tasks with no length, tasks carried over 3 days or more, weekly targets behind pace,
and what the planner couldn't fit or use. Fix what you can; tell George the rest.

### `reference [topic]`
With no topic: this file, from the live tool rather than the copy in this folder. Read it whenever the
tool mentions an op or a read you don't recognise, and whenever run.sh says these docs are older than
the tool.

With a topic — `calendar`, `planning` or `gym` — a short playbook for that job: which read to run
first, what to change, and what never to touch. **Read the playbook before you start**, not after
something has gone wrong. Each is a page, and each exists because a session got that job badly wrong
without it.

### `gym`
Training from Hevy: whether it's connected (and any problem), each key lift (estimated 1RM, last top
set, last PR, pace in kg a week over 8 weeks, its target and roughly when it'll be reached), cardio
against the linked weekly target and by week, the last 14 days' sessions in a line each, and the
settings.

## Ops

Every op is an object with `"op"`. Add `"suggest": true` to `task`, `habit`, `target`, `goal` or
`milestone` to make it a suggestion instead of live.

An op handed a field it doesn't have says so and carries on without it. **Read those notes** — they
mean something you asked for didn't happen, and George won't know unless you tell him or send it
again properly. Use `preview` to reject ignored fields before writing. Plan entries retain area,
notes and details; tasks and habits also retain minutes, time and priority, and link to the plan's goal.

### `task`
`{"op": "task", "title": "…", "date": "2026-09-18", "area": "Job", "goal": "<goal id>"}` — only
`title` is required; `date` defaults to today. For the calendar: `"minutes": "2h"` — its length, 5
minutes to 12 hours (`"45m"`, `"1h30"`, or a number of minutes) — and `"time": "14:00"` for a fixed
start, which makes it a fixed event in the calendar. `"notes": "…"` — the detail behind a short title
(up to 1000 characters; shown under it, and at the top of its calendar block); `"priority": true` —
booked first, starred. `"series": "Role plays"` — work that only makes sense in order: the planner
books a series by `order` and never puts a later one before an earlier one (`reference planning`).
`null` clears it on an edit. A date or time that breaks the order comes back with a `Note:`.

### `habit`
`{"op": "habit", "title": "…", "repeat": {…}}` — `repeat` defaults to every day. Shapes:
`{"kind": "daily"}` · `{"kind": "weekdays", "days": [1, 3, 5]}` (1 = Mon … 7 = Sun) ·
`{"kind": "perWeek", "n": 3}` · `{"kind": "weekly", "day": 5}` · `{"kind": "monthly", "date": 1}`.
Also `area`, `goal`, `minutes` (its length, as for a task), `notes` and `priority`, and `"time":
"09:30"` — a set time of day, which books it at that time on every day it's due rather than letting
the planner slot it in. A habit linked to its own calendar events (`habitEvents` in the planner's
settings) ignores `time`: those events are already its sessions.

### `target`
A weekly target. `{"op": "target", "title": "Applications", "target": 5, "unitLabel": "applications"}`
for a count, or `{"op": "target", "title": "Hebrew", "target": "5h", "unit": "minutes"}` for time
(`"90m"`, `"1h30"`, `"1.5h"`). Also `area`, `goal`, `notes`.

### `goal`
`{"op": "goal", "title": "…", "targetDate": "2026-12-01", "why": "…", "milestones": ["…", "…"]}` —
progress is by milestones ticked. Also `notes`.

### `milestone`
`{"op": "milestone", "goal": "<goal id>", "title": "…"}`.

### `plan`
A bigger job broken down, all as suggestions:
`{"op": "plan", "goal": {"title": "…", "targetDate": "…", "why": "…"}, "milestones": ["…"],
"tasks": [{"title": "…", "date": "…"}], "habits": [{"title": "…", "repeat": {…}}],
"targets": [{"title": "…", "target": 3, "unitLabel": "…"}]}` — every part is optional, but it needs a
goal or at least one habit, target or task. Milestones need the goal.

### `done`
Tick a task or habit (`"day"` defaults to today), or a milestone: `{"op": "done", "id": "…"}`.
Weekly targets take `log` instead.

### `undone`
Untick: `{"op": "undone", "id": "…", "day": "yesterday"}`.

### `log`
An amount on a weekly target, or on a goal measured by a number:
`{"op": "log", "id": "…", "amount": "45m", "day": "today", "note": "…"}`. Time targets take `"45m"`,
`"1.5h"`, `"1h30"`; counts take a number.

### `edit`
`{"op": "edit", "id": "…", "set": {"title": "…", "date": "…"}}`. Editable — tasks: `title, date,
area, goalId, order, minutes, time, notes, priority, series`; habits: `title, area, goalId, repeat, order,
minutes, time, notes, priority` (`null` clears a length or time); weekly targets: `title, area,
goalId, target, unitLabel, order, notes`; goals: `title, targetDate, target, unitLabel, why, order, notes`
(`target: null` measures by milestones); milestones: `title, done, goalId, order`. A weekly target's
unit can't change — archive it and add a new one.

### `archive`
`{"op": "archive", "id": "…"}` — archives an item, goal or milestone (history is kept), removes a
logged amount or tick, or marks a flag addressed. Use `dismiss` for a suggestion.

### `accept`
Take on a suggestion: `{"op": "accept", "id": "…"}`. On a suggested goal it takes on the goal and its
milestones; its habits, targets and tasks stay suggestions to accept one by one.

### `dismiss`
Turn a suggestion down: `{"op": "dismiss", "id": "…"}`. On a suggested goal it also dismisses
everything proposed with it.

### `flag`
Leave a note George himself will read: `{"op": "flag", "text": "…"}`. It is filed as a **Note**;
`"kind"` (`note`, `feature`, `bug` or `claude`) files it elsewhere — only use another kind when
George asks you to log a feature request or bug for him. At most 1000 characters, and it
is refused rather than cut if it's longer. Anything meant for whoever maintains the app — and
anything that needs more room than that — is a `handoff`.

### `handoff`
Tell whoever maintains the app something about the app itself:
`{"op": "handoff", "title": "Stale docs", "text": "…"}`. **There is no length limit on `text`** — put
the whole thing in: what you were trying to do, the exact JSON you sent, what the tool said back,
what you expected instead, and what you had to do in the end. It becomes its own file in the sync
repo, so nothing is clipped and none of it reaches George's list.

Use this rather than `flag` for anything aimed at the app's developer. `flag` is for notes George
himself will read, and it's capped at 1000 characters. Check `handoffs` first: if it's already there,
don't write it again.

### `undo`
Undo one of your own changes, by the id `changes` shows: `{"op": "undo", "change": "…"}`. Anything
George has changed since is left alone, and the tool says so.

### `planner`
Change the calendar planner's settings; every other setting is kept.
`{"op": "planner", "hours": ["08:30", "18:00"]}`. Settings: `hours` (two times, the planning hours),
`gapMinutes` (0–60, clear time around events), `defaultMinutes` (5–240, a task with no length),
`maxBlockMinutes` (30–480, the longest block), `days` (1–14, how far ahead), `exactDays` (1–7, days
with exact times), `firmUpHour` (12–23, when the next day turns exact), `ignore` (calendar names, by
their start), `areaCalendars` (`{"Job search": "Application"}`), `defaultCalendar` (`"main"` or a
name), `habitEvents` (`[{"habit": "Gym", "calendar": "Gym", "title": "Gym"}]` — a habit by id or the
start of its title, and the events that are its sessions), `priorityAreas` (areas booked first and
starred), `areaColors` (`{"Assessment centre": "Grape"}` — Google's colour names: Lavender, Sage, Grape,
Flamingo, Banana, Tangerine, Peacock, Graphite, Blueberry, Basil, Tomato; not one George's calendars
take, nor two areas alike), `dayHours` (`{"2026-09-18": ["09:00", "13:00"]}`). `areaCalendars`,
`areaColors` and `dayHours` change one key at a time; `null` removes a key.

### `off`
Time off. `{"op": "off", "start": "2026-09-16", "end": "2026-09-17", "areas": ["Job search"], "reason": "…"}`
— whole days (dates, `today` or `tomorrow`; `end` defaults to `start`), or a stretch of hours
(`"2026-09-18T13:00"` to `"2026-09-18T19:00"`). `areas` left out covers everything. Whole days excuse
what they cover — nothing is booked, streaks are safe, dated tasks move on — while hours only keep the
planner out. Cancel: `{"op": "off", "cancel": "off:2026-09-16"}`.

### `brief`
The line at the top of George's list: `{"op": "brief", "text": "…", "day": "tomorrow"}` (`day`
defaults to today; up to 500 characters). Writing one for a day replaces it.

It is intent, not a schedule: say why the day matters and how to approach it, and don't name the
tasks on it. The planner rebooks work between days, and the Coach is told to trust the lists over a
brief that disagrees with them, so a brief naming tasks simply goes stale.

### `guide`
The Coach's guide for a week: `{"op": "guide", "text": "…"}` (up to 600 characters; `"week":
"2026-09-21"` or any day in it for another week — it's filed under that week's Monday). What to focus
on and ask about; the Coach is given it every time. Writing one again replaces it.

### `gym`
Hevy's settings on the dashboard (nothing is ever sent to Hevy). `{"op": "gym", "cardioQuota":
"Cardio"}` — the weekly target (in minutes, by title or id) that workouts' cardio minutes count
towards; `null` unlinks it. `{"op": "gym", "liftTargets": {"Squat (Barbell)": 120}}` — an estimated
1RM target in kg, one lift per op, `null` removes it. `{"op": "gym", "keyLifts": ["Squat (Barbell)",
"Bench Press (Barbell)", "Deadlift (Barbell)"]}` — the lifts followed closely (Hevy's exercise names).
`{"op": "gym", "habit": "Gym"}` — the habit a workout ticks (by id or the start of its title).

## Optional advanced controls

### `details`
`{"op":"details","id":"<item-or-goal-id>","set":{"successCriteria":"Finish one timed exercise and record the score","tags":["assessment"]}}`.
This merges the named detail fields. Arrays and nested objects replace that field as a unit.
Fields: `tags` (up to 12), `context`, `location`, `energy` (`low|medium|high|""`), `successCriteria`,
`notBefore`, `deadline`, `dependsOn` (up to 20 existing one-off task IDs), `checklist`
(`[{"label":"Read instructions","done":false}]`, up to 20), `requireChecklist` (boolean),
`outcomeForm` (see workflows playbook), `custom` (up to 20 lower_case keys with scalar values), and
`reviewEveryDays` (goals only; 0 off, 1–90 days). Dates may be relative in this op.
Only readiness and dependencies gate calendar booking. Deadline is advisory; context, location,
energy, tags and custom fields inform planning, not hidden scheduler rules. Use an empty array/object
to clear a collection, an empty string to clear text, or null to clear a date.
Standalone `task`, `habit`, `target` and `goal` creation also accept a `details` object (absolute dates).
Plan entries now retain area, notes and details; tasks/habits also retain minutes, time and priority.
Tasks in a plan link to its goal, so progress reviews can see them.

### `rule`
`{"op":"rule","title":"Review after practice","enabled":true,"definition":{"sourceId":"<task-id>","match":"all","conditions":[{"field":"score","op":"lt","value":60}],"actions":[{"type":"review","goalId":"<goal-id>"}]}}`.
Read `reference workflows`. Source must have the named outcome questions. New rules default to
paused. To pause: `{"op":"rule","id":"<rule-id>","enabled":false}`. Edits and re-enabling apply
to subsequent reports only; they do not replay earlier reports. Unknown fields are refused.

### `report`
`{"op":"report","id":"<task-id>","answers":{"score":55},"reported":true,"complete":true,"reportId":"<unique-request-id>"}`.
Only report facts George supplied. Answers are checked against the configured form; no guesses.
`complete` defaults false; true completes a task/habit after checking its dependencies/checklist.
`day` defaults today. `reportId` is optional, but reuse the same ID if retrying an uncertain save:
identical submissions are idempotent; a different answer with the same ID is refused.
Reports do not call an API from the CLI; the planner evaluates enabled rules at its next run.

### `review`
`{"op":"review","id":"<goal-id>"}` queues a progress/direction review (at most one request per
goal per logical day). Read `reference reviews`. It returns queued/completed status, not a claim
that an API call already happened. For recurring review, use details.reviewEveryDays on the goal.

### `preview`
The same JSON input as apply, validated in memory, with human-readable intended changes. Does
not save data, handoffs, diagnostic trails or issue AI calls. Unknown ignored fields fail preview.
It does not simulate future conditional actions. Inspect the affected records after applying.
