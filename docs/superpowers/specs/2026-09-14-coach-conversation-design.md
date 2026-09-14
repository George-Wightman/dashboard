# The Coach as a conversation — design

2026-09-14. Approved in brainstorming, question by question and in two parts. Replaces the evening
check-in form; keeps Shape a goal and the weekly digest. Uses the gym data from the Hevy design
(`2026-09-14-hevy-design.md`), which is built first.

## Where this came from

George's flag (#342e141b): *"I would like to make the coach more useful, something I can talk back
and forth with … I don't want to give the Gemini API the same type of access, but a more gated /
limited way of doing similar things. Plus a more conversational interface, so I can speak to it,
give it pointers about the day and it can shape the plan … it would also be good if it could store
that information for Claude … an impromptu journal, it can ask me questions, what I'm feeling or
thinking at different points, then that information can feed into future approaches / ideas for
Claude to plan the future."*

Decisions:

- **The gate** (option B) — the Coach changes today and tomorrow directly; anything bigger goes to
  Claude as a handoff. Plus (agreed in part 1) it may block out hours today or tomorrow.
- **Typing** (option A) — a text box; the phone's own dictation works in it.
- **When it opens a conversation** — morning, afternoon (only when something slipped) and evening
  (replacing the check-in). Not after training.
- **What's kept** — a journal entry per conversation, **saved by default**, which George can edit or
  remove; the full conversation for 30 days.
- **The engine** — Gemini on George's devices with the key they already have, using Gemini's own tool
  use (George has 500 lite calls a day: *"we won't run out realistically"*).

## 1. The engine

`js/gemini.js` gains `talkGemini({ keys, system, messages, tools, run })`: the same key and model
walk as `askGemini` (lite on every key, then Flash), the same plain-English errors, and the key only
ever in the URL. It sends the conversation with `tools: [{ functionDeclarations }]`; when a reply
holds `functionCall` parts it runs each through `run(name, args)`, sends the results back as
`functionResponse` parts, and asks again — at most **6 steps** a message, after which it asks for a
reply with no tools. It returns the reply's text and the calls made.

A failure (no key, offline, free limit used, key refused) is one line in the thread; what George
typed stays in the box to send again.

## 2. The tools

Every tool is declared to Gemini with a one-line description and its parameters. Days are
`YYYY-MM-DD`; "today" and "tomorrow" mean George's logical days (`dayStartHour`).

**Looking things up** (no gate):

| Tool | Gives |
|---|---|
| `get_day(day)` | the list, calendar blocks, time off, gym and notes for a day from 30 days back to 7 ahead |
| `get_gym(lift?)` | recent sessions, or one key lift's history, pace and projection |
| `find(words)` | tasks, habits, targets and goals whose title or notes match |
| `get_journal(days?)` | saved journal entries, newest first (default 7 days, at most 30) |

**Changing things** (the gate — refused with a reason unless the day is today or tomorrow):

| Tool | Does |
|---|---|
| `add_task(title, day, minutes?, time?, area?, notes?)` | a new task |
| `move_task(id, day)` | a task between today and tomorrow |
| `skip(id, reason)` | a task: moved to tomorrow; a habit: excused today (streak safe, like time off) |
| `set_task(id, minutes?, time?, notes?)` | a task's length, time or notes |
| `tick(id)`, `untick(id)` | today only |
| `block_hours(day, start, end, reason)` | time off for a stretch of hours (`source: 'coach'`); whole days stay Claude's |
| `hand_to_claude(text)` | a handoff: anything the gate won't do, or anything for Claude to know |
| `finish(feeling, text, pointers)` | ends the conversation with its journal entry |

Each change runs through the store like Claude's do, is logged as a change with `source: 'coach'`
(⚙ → Claude → Changes shows *"Coach"* on it, with Undo), and appears in the thread as a small line —
*"Moved 'Email NatCen' to tomorrow · Undo"*.

A skipped habit is a `skip` log for that item and day; `excused()` honours it as it does time off.

## 3. When it talks

| Moment | When | Only if |
|---|---|---|
| Morning | 07:00–12:00, the first time the app is open | — |
| Afternoon | 14:00–17:00 | something slipped: a block today that has ended with its work unticked, or a task timed before now and unticked |
| Evening | from the check-in hour (⚙, default 18:00) until the day ends | — |

One opener per moment a day, and none if George has already talked in that window. The opener is
written by one Gemini call when the moment arrives with the app open (a sync first, so two devices
don't both write one); if Gemini can't be reached it's a plain line (*"Morning — what's today
looking like?"*). It waits at the top of Today, under the brief, with **Reply**. George can start a
conversation himself at any time from the Coach panel.

The evening conversation replaces the check-in: it asks about the day and shapes tomorrow — tasks
now land directly, not as suggestions. Old check-ins stay readable (the digest, Claude's journal read).

## 4. What it's told

Every conversation starts with the context block (grown from today's `coachContext`, still capped):
today's and tomorrow's lists with areas, lengths, times and notes; today's calendar blocks and any
slips; time off; today's gym and the week's training; Claude's brief for today; **Claude's guide**
for the week; the last 3 saved journal entries; weekly targets and goals. The system text sets the
voice (direct, warm, specific, British English, no emojis, short replies), the gate, and the rule
that sessions at the gym are George's own — the Coach can talk about them but never plans them.

## 5. The journal and handoffs

When a conversation wraps up — the Coach calls `finish`, George closes it, or the next moment
begins — its entry is written and **saved straight away** (a journal record, kind `entry`): the
moment, `feeling` (a short phrase), `text` (at most 600 characters), `pointers` (at most 5 short
lines) and `forClaude` (the handoffs). It shows as a card at the end of the thread with **Edit** and
**Remove**.

Each handoff becomes a flag from the Coach (`source: 'coach'`) in the same place George's flags go,
so Claude picks it up as he already does. Editing an entry updates its flags (a handoff taken out is
archived); removing the entry archives it and its flags.

The conversation itself is a journal record, kind `talk`: its messages (who, text, time, the changes
it made). After 30 days its messages are dropped; the entry stays.

Ids: `talk:<day>:<slot>` and `entry:<day>:<slot>`, where the slot is `morning`, `afternoon`,
`evening`, or `own-1`, `own-2` … for conversations George starts. `saveJournal` learns the slot.

## 6. Claude and the Coach

- **The guide** — in *plan my week*, Claude writes a short guide for the Coach for that week (op
  `guide`, `{ "text": "…" }`, a journal record kind `guide` under that week's Monday, at most 600
  characters). The Coach is given it every time; ⚙ → Claude shows it.
- **Reading** — Claude's `journal` read shows the last 14 days' saved entries (and still the digest
  and old check-ins); a new `talk <day>` read shows that day's conversations in full. Removed
  entries are never shown.
- **Handoffs** — flags from the Coach, which Claude reads, acts on and marks addressed like any flag.
  The `flags` read shows each flag's full text (it cut at 200 characters).
- **The skill** — read the journal in *plan my week* and when George asks how things are; write the
  week's guide; treat Coach handoffs as George's words.

## 7. The panel

The Coach panel becomes the conversation: today's threads (the latest open), each message as a
bubble — George's on the right, the Coach's on the left in the app's ink — change lines beneath the
message that made them, the entry card at the end, and the box. **Talk** starts a new conversation.
On a phone, **Reply** on Today opens the conversation as a sheet over the page. Shape a goal (under
Goals) and the digest (in the panel) are unchanged.

## 8. Testing

- `talkGemini` — tool calls and results round-tripped, the 6-step cap, errors, the key never shown.
- The gate — every change tool allowed for today and tomorrow and refused otherwise; changes logged
  as the Coach's and undoable; a skipped habit excused.
- The moments — morning, afternoon only after a slip, evening from the check-in hour; one opener per
  moment; none after George has talked; the plain line when Gemini fails.
- The journal — the entry saved on `finish`, on close and at the next moment; edit and remove, with
  their flags; 30-day trimming.
- Claude's `guide` op, `journal` and `talk` reads, the full-text `flags` read.
- The panel, the opener on Today and the phone sheet — rendered with a fake Gemini
  (`dev/fake-gemini.js` learns tool calls).
