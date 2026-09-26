# Check-ins replace the Coach (26 Sep 2026)

George's flag #b3c30ad0: the Coach "doesn't have the access or intelligence to do anything useful or
plan things well". Claude, in a chat, is the one interface for planning, the calendar and goals. Gemini
stops pretending to be a second planner and does the one job only a background process can do: catch
what George says about a piece of work at the moment it happens, so Claude can pick it up later.

## What goes

- The Coach: its conversation panel and phone sheet, the journal library, openers, the evening
  check-in, the weekly digest, proposals, its tools, and the "Coach" widget.
- The Mind: the planner's senses, reflexes and openers, `mind.json`, Claude's deep-run routine and its
  `claude/` branch merging, the `mind` read and `--mind` ops, the `guide` op, the `talk` read.
- Nothing in the synced data is deleted. Old conversations, entries and digests stay in `journal`;
  nothing reads them any more.

## What stays

Flags (Claude's inbox), Claude's brief, goal reviews and area sorting in the planner (their own Gemini
use), Web Push and ⚙ → Notifications, the day lock (now only at 11:00).

## Check-ins

One journal record per task per day, `reflect:<day>:<itemId>`:
`{ kind: 'reflect', day, itemId, title, why: 'done' | 'missed', said, summary, answeredAt, pushedAt }`.

- **A tick.** When George ticks a task himself in the app, a check-in is written: *How did "X" go?*
  Unticking takes an unanswered one away. Habits and targets don't ask.
- **A missed block.** Each planner run, a task whose calendar block ended more than 30 minutes ago
  still unticked gets one: *"X" isn't ticked — what happened?* It pings George's devices (at most 4 a
  day, none 22:30–07:00). Ticking it later turns the question into *how did it go*.
- **Answering.** The waiting check-ins sit at the top of Today, one at a time: a box, a mic, Save and
  Skip. Save keeps his words (`said`) at once, then Gemini (the device's key, Flash-Lite) tidies them
  into two or three sentences in his voice (`summary`). No key, offline or a failure: the words alone
  are kept, and that's fine — Claude reads both.
- **Expiry.** A check-in shows only on its own day. Unanswered ones stay in the record as unanswered.

## Claude

- `checkins [days]`: the last 14 days of check-ins, answered and not.
- `catchup`: everything since the last catch-up: ticks and misses day by day, check-in answers, new
  flags, workouts, calendar edits George made, planner notes, what needs attention. It then records
  the catch-up, so the next one starts there. `catchup <days>` looks further back.
- The skill gains two flows: **catch up** at the start of a planning chat, and **debrief** after a
  practice session (read the task's check-ins and notes, ask what's missing, write the lesson where the
  next session will see it).
