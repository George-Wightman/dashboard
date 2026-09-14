# Dashboard tool reference

Run from this skill's folder: `bash run.sh <read> [argument]`, or `bash run.sh apply` with JSON on a
quoted heredoc (`<<'EOF'` … `EOF`). Ids are what the tool shows after `#` (any unique start of at
least 4 characters works). Dates: `YYYY-MM-DD`, `today`, `tomorrow`, `yesterday`.

## Reads

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
The Gemini coach's latest weekly digest and last three evening check-ins.

### `flags`
Open flags — notes George made about something to change in the app.

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

## Ops

Every op is an object with `"op"`. Add `"suggest": true` to `task`, `habit`, `target`, `goal` or
`milestone` to make it a suggestion instead of live.

### `task`
`{"op": "task", "title": "…", "date": "2026-09-18", "area": "Job", "goal": "<goal id>"}` — only
`title` is required; `date` defaults to today. For the calendar: `"minutes": "2h"` — its length, 5
minutes to 12 hours (`"45m"`, `"1h30"`, or a number of minutes) — and `"time": "14:00"` for a fixed
start, which makes it a fixed event in the calendar. `"notes": "…"` — the detail behind a short title
(up to 1000 characters; shown under it, and at the top of its calendar block); `"priority": true` —
booked first, starred.

### `habit`
`{"op": "habit", "title": "…", "repeat": {…}}` — `repeat` defaults to every day. Shapes:
`{"kind": "daily"}` · `{"kind": "weekdays", "days": [1, 3, 5]}` (1 = Mon … 7 = Sun) ·
`{"kind": "perWeek", "n": 3}` · `{"kind": "weekly", "day": 5}` · `{"kind": "monthly", "date": 1}`.
Also `area`, `goal`, `minutes` (its length, as for a task), `notes` and `priority`.

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
area, goalId, order, minutes, time, notes, priority`; habits: `title, area, goalId, repeat, order,
minutes, notes, priority` (`null` clears a length or time); weekly targets: `title, area,
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
Note something to change in the app itself: `{"op": "flag", "text": "…"}`.

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
