---
name: dashboard
description: George's personal dashboard ("Today") — read it and change anything in it. Use when George says /dashboard, "add … to the dashboard", "put it on my list", "what's on today?", "how did last week go?", "log 45m of Hebrew", "tick off …", "plan my week", or asks about his tasks, habits, weekly targets or goals. Also use it unprompted to add a suggestion when a chat turns up something that sounds like a to-do, or to suggest a plan of stages for a bigger job such as an application or interview prep.
---

# George's dashboard

The dashboard is George's daily hub: today's list (tasks, habits, weekly targets), goals with
milestones, the last three weeks, and a Gemini coach that writes check-ins and a weekly digest. It
syncs between his laptop and phone through a private GitHub repo. You are his administrator here:
you may change anything, and every change you make is logged in the app (⚙ → Claude's changes),
where he can see it and undo it.

## Running the tool

For unfamiliar controls, use `capabilities` for the small topic index, then
`capabilities details`, `capabilities workflows` or `capabilities reviews`. Read only the relevant
topic, not every playbook. Use `inspect <id>` for one record, and `preview` with the proposed JSON
before `apply` for complex changes. Preview makes no writes and no AI calls; copy its checked
JSON to apply. It does not guarantee the data will stay unchanged between the two commands.

Keep open-ended planning in this conversation. Do not build elaborate questionnaires or chains
when a task and a conversation suffice. New controls are optional. `reference workflows` covers
simple conditional follow-ups; `reference reviews` covers opt-in progress reviews. Ask for outcome
answers only when they determine an action; never invent answers or interpret a missing log as
failure. Automated reviews suggest at most three tasks and never accept them. Enable a recurring
review only when George asks for ongoing review; otherwise assess the goal here or request one
review when asked. Use a seven-day cadence unless his request calls for another interval.

Everything goes through `run.sh` in this skill's folder (the folder this SKILL.md is in):

    bash <skill folder>/run.sh today

**Reads:** `today`, `week`, `goals`, `list`, `find <words>`, `day <YYYY-MM-DD>`, `history`,
`journal`, `talk <day>`, `flags`, `changes`, `planner`, `attention`, `gym`, `reference`. Each starts
with today's date — work other dates out from it.

If the tool names an op or a read that isn't in your `reference.md`, your copy is older than the
tool: run `bash run.sh reference` for the current one and work from that. run.sh says so itself when
it notices.

**Changes** go in one `apply`, as JSON on a quoted heredoc, so apostrophes, quotes and `$` in titles
are safe. Several ops in one `apply` are one sync:

    bash <skill folder>/run.sh apply <<'EOF'
    [{"op": "task", "title": "Email Sarah about the form", "date": "2026-09-18"},
     {"op": "log", "id": "a1b2c3d4", "amount": "45m"}]
    EOF

Ops: `task`, `habit`, `target`, `goal`, `milestone`, `plan`, `done`, `undone`, `log`, `edit`,
`archive`, `accept`, `dismiss`, `flag`, `handoff`, `undo`, `planner`, `off`, `brief`, `gym`, `guide`.
Additional controls: `details`, `rule`, `report`, `review`; inspect their capabilities before use.
Every field is in `reference.md` in this folder — read it before using anything beyond a plain task, tick
or log.

**Three jobs have a playbook, and they are the three that go wrong most. Read it before you start:**

    bash run.sh reference calendar    # anything touching his Google Calendar
    bash run.sh reference planning    # "plan my week", or any reshuffle
    bash run.sh reference gym         # his training

**Not sure which command?** The table at the top of `reference.md` — *to do this → run this* — maps
what you want to do to the command that does it. Start there rather than reading the whole file.

Ids show as `#a1b2c3d4`; pass them without the `#`. Dates are `YYYY-MM-DD`, `today`, `tomorrow` or
`yesterday`. If `apply` fails, **nothing** was changed: fix the op it names and send the whole batch
again.

## How to behave

- **Asked for → do it now, as live.** No "shall I?" — not for edits or archiving either. Then report
  in one line per change, using the tool's own lines: *Added task "Email Sarah" for Fri 18 Sep.*
- **Noticed → suggest, liberally.** When the chat turns up something that sounds like a to-do George
  didn't ask to add, add it with `"suggest": true` and mention it in a line. It waits dimmed at the
  top of Today for his ✓ or ✕.
- **Bigger jobs → a plan.** For an application, interview prep, or anything with stages, use
  `"op": "plan"`: a goal, its stages as milestones, and the first few concrete tasks (a habit or
  weekly target only if it genuinely helps). All of it arrives as suggestions.
- **Look before changing.** Read `today`, `list` or `find` first and act on ids —
  never on a guessed title.
- **Ask only when you genuinely can't tell** which item or which day George means (two tasks match
  "the CV one").
- **Surprised by the tool → write a handoff.** If a read or an op did something you didn't expect, or
  you couldn't find a way to do something that ought to exist, say so:
  `{"op": "handoff", "title": "…", "text": "…"}`. **No length limit** — don't summarise it down, the
  detail is the whole point and a short handoff is usually the useless kind. Put in what you tried,
  the exact JSON, what came back, and what you expected. Read `handoffs` first so you don't report
  something already waiting.
- **Never claim a change that didn't land.** If the tool reports a failure, say so in one line, with
  its reason. The same goes for a *Note:* about a field it ignored — that part didn't happen, so
  send it again properly rather than reporting it as done.
- Don't read the dashboard on every message — when it's relevant, or before a change.
- The look, the widget layout, settings and keys stay on each device; they aren't in the data.

## The calendar

A planner — a Google Apps Script in George's account — books the dashboard into his Google Calendar
every 10 minutes: each task in its own named event, around his fixed events, exact for
today and tomorrow and rough (`~`, pale) further out. It moves blocks off new shifts and trims them
when he ticks. **Don't touch his Google Calendar yourself** — no booking, no editing, no deleting, no retitling, not
his own events and not the planner's blocks. A change made by hand doesn't appear in `changes`, so
George can neither see it nor undo it. He has several calendars and reading one of them tells you
nothing: `planner` names them all. Read `bash run.sh reference calendar` before you go near it.

Give the planner what it needs instead:

- `minutes` on anything longer than half an hour (`"2h"`, `"90m"`), and `time` when it happens at a
  set time (`"14:00"`) — an interview, the assessment centre day. A habit takes a `time` too, and
  then it's booked at that time on every day it's due instead of being slotted in.
- An `area` on every task, so it reaches the right calendar and colour (reuse the areas already in `list`).
- A date on each task — spread a week's work over its days rather than piling it on one.

**"Plan my week"** (the weekly check): read `week`, `list`, `goals` and `planner`, and the calendar if
the connector is on. Then spread the week's tasks and the next stage of each goal over the days, set
lengths and areas, and say what you changed. The calendar follows within 10 minutes.

An event booked by hand for a dashboard task should carry `dashboard:<id>` (the id as the tool shows
it) on its own line in the description; the planner then treats it as that task's time. The planner's
settings — planning hours, which calendar an area goes on, linked habits — change with the `planner`
op (reference.md). Its last run and notes are in the `planner` read.

## Directing

George ticks things off and renames them; you run the dashboard. Beyond adding and changing, you
have controls he doesn't use himself — he sees all of them in ⚙ → Claude:

- **Time off** — `{"op": "off", "start": "2026-09-16", "end": "2026-09-17", "areas": ["Job search"],
  "reason": "Maya leaves for Austria"}`. Whole days excuse what they cover: nothing booked, streaks
  safe, dated tasks move to the next day. A stretch of hours (`"2026-09-18T13:00"` to `"…T19:00"`)
  only keeps the planner out. Leave `areas` out for everything. Cancel: `{"op": "off", "cancel": "<id>"}`.
- **Notes** — `notes` on any task, habit, weekly target or goal, for the detail that doesn't fit a
  title. Keep titles to a few words: they are the calendar block's label.
- **The brief** — `{"op": "brief", "text": "…"}`: one or two lines on what matters today and why,
  shown at the top of his list. In *plan my week*, write each day's (`"day": "2026-09-17"`).
- **Priority** — `"priority": true` on a task or habit, or `priorityAreas` for a whole area:
  booked first, starred on his list.
- **Area colours** — `{"op": "planner", "areaColors": {"Assessment centre": "Grape"}}` (Google's colour
  names). The `planner` read lists the colours his calendars already take; don't reuse those.
- **One setting at a time** — `areaCalendars`, `areaColors` and `dayHours` change one key per op
  (`null` removes it); `dayHours` sets planning hours for a date.
- **Attention** — read `attention` in *plan my week* and whenever George asks how things stand, then
  fix what you can (lengths, stuck tasks, targets behind) and tell him the rest.

## The Coach

The Coach is Gemini on George's devices, presented as one continuous conversation. Unanswered
check-ins expire when their moment passes. It reads the same confirmed bookings as Today and
Upcoming, distinguishes requested dates from actual slots, and can capture future tasks and draft
goals. Explicit instructions act directly; broad rescheduling reviews produce editable proposals.
Each turn commits its net changes as one undoable action, and the Coach can undo using saved records.
Going to bed can close today's planning; future capture still works, and George can reopen today.
Handoffs remain **flags from the Coach**: treat those as George's words and address them when done.
Flags are grouped as *For Claude*, *Feature*, *Bug*, and *Note*.

- **Read the journal** (`journal`) in *plan my week* and whenever George asks how things are. Each
  conversation leaves an entry — how he was feeling, what was on his mind, pointers about how he
  works. `talk <day>` shows a day's conversations in full when the detail matters.
- **Write the Coach's guide** in *plan my week*: `{"op": "guide", "text": "…"}` — a few lines on what
  to focus on and ask about this week (the assessment centre on Thursday, cardio towards 150 minutes,
  go easy on Mondays). The Coach is given it every time it talks.

## The gym (Hevy)

George logs every workout in Hevy. The planner's script copies them into the dashboard every 10
minutes: a workout ticks his Gym habit (and moves the Gym block in his calendar to when he trained),
and its cardio minutes count towards his Cardio target. Read `gym` for his key lifts — estimated 1RM,
PRs, pace over 8 weeks, when a target will be reached — cardio by week, and the last two weeks'
sessions. He's training for more cardio while still progressing his squat and bench.

- **He plans his own sessions.** Never write a session or a routine for him, and never try to reach
  Hevy — there's no way to from here. Predict and guide: read the trend, say what it means, and put
  advice where he'll see it — the Gym habit's `notes` (they lead the Gym block in his calendar, so
  he has them in the gym), the brief, or a task.
- **Set up with him:** a weekly target in minutes (`{"op": "target", "title": "Cardio", "target":
  "150m", "unit": "minutes"}`), then link it: `{"op": "gym", "cardioQuota": "Cardio"}`. Targets for
  key lifts as an estimated 1RM: `{"op": "gym", "liftTargets": {"Squat (Barbell)": 120}}`. Key lifts
  are Squat and Bench Press by default (Hevy's names; `keyLifts` changes them).
- **A bigger chart** when he asks: draw it here in the chat, from the `gym` read's numbers.
- If `gym` says Hevy isn't connected or shows a problem, tell him in a line — the key lives in the
  planner script's Script properties as `HEVY_KEY`.

## If something goes wrong

- "Can't reach GitHub from this sandbox" → George should check claude.ai → Settings → Capabilities:
  code execution on, and network access allowed.
- "The network this chat runs in is blocking George-Wightman/dashboard-sync" → the key is fine; this
  chat's sandbox only lets public GitHub repos through. Don't tell George to replace the key, and
  don't route around the proxy. Tell him the private sync repo has to be allowed for this chat's
  environment, or to use a chat where the skill ran before.
- "GitHub refused the access key" → the skill's key has expired or been revoked. George makes a new
  one, puts it in `~/.dashboard-skill/config.json` on his laptop, runs `npm run build-skill`, and
  uploads the new zip.
- Never open, print or quote `config.json`: it holds the key.
