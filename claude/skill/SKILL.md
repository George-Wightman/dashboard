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

Everything goes through `run.sh` in this skill's folder (the folder this SKILL.md is in):

    bash <skill folder>/run.sh today

**Reads:** `today`, `week`, `goals`, `list`, `find <words>`, `day <YYYY-MM-DD>`, `history`,
`journal`, `flags`, `changes`. Each starts with today's date — work other dates out from it.

**Changes** go in one `apply`, as JSON on a quoted heredoc, so apostrophes, quotes and `$` in titles
are safe. Several ops in one `apply` are one sync:

    bash <skill folder>/run.sh apply <<'EOF'
    [{"op": "task", "title": "Email Sarah about the form", "date": "2026-09-18"},
     {"op": "log", "id": "a1b2c3d4", "amount": "45m"}]
    EOF

Ops: `task`, `habit`, `target`, `goal`, `milestone`, `plan`, `done`, `undone`, `log`, `edit`,
`archive`, `accept`, `dismiss`, `flag`, `undo`. Every field is in `reference.md` in this folder —
read it before using anything beyond a plain task, tick or log.

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
- **Never claim a change that didn't land.** If the tool reports a failure, say so in one line, with
  its reason.
- Don't read the dashboard on every message — when it's relevant, or before a change.
- The look, the widget layout, settings and keys stay on each device; they aren't in the data.

## The calendar

A planner — a Google Apps Script in George's account — books the dashboard into his Google Calendar
every 10 minutes: each day's tasks grouped by area into blocks, around his fixed events, exact for
today and tomorrow and rough (`~`, pale) further out. It moves blocks off new shifts and trims them
when he ticks. **Don't book blocks for dashboard tasks yourself.** Give the planner what it needs:

- `minutes` on anything longer than half an hour (`"2h"`, `"90m"`), and `time` when it happens at a
  set time (`"14:00"`) — an interview, the assessment centre day.
- An `area` on every task, so similar ones share a block (reuse the areas already in `list`).
- A date on each task — spread a week's work over its days rather than piling it on one.

**"Plan my week"** (the weekly check): read `week`, `list`, `goals` and `planner`, and the calendar if
the connector is on. Then spread the week's tasks and the next stage of each goal over the days, set
lengths and areas, and say what you changed. The calendar follows within 10 minutes.

An event booked by hand for a dashboard task should carry `dashboard:<id>` (the id as the tool shows
it) on its own line in the description; the planner then treats it as that task's time. The planner's
settings — planning hours, which calendar an area goes on, linked habits — change with the `planner`
op (reference.md). Its last run and notes are in the `planner` read.

## If something goes wrong

- "Can't reach GitHub from this sandbox" → George should check claude.ai → Settings → Capabilities:
  code execution on, and network access allowed.
- "GitHub refused the access key" → the skill's key has expired or been revoked. George makes a new
  one, puts it in `~/.dashboard-skill/config.json` on his laptop, runs `npm run build-skill`, and
  uploads the new zip.
- Never open, print or quote `config.json`: it holds the key.
