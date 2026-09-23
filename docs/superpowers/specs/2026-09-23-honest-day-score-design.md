# An honest day score

Designed 23 September 2026, with George.

## The problem

> I don't want to just be able to remove things and make it look like the day was a total success,
> the coach should push me on it. I've not been on that morning walk, that should read as a "fail",
> but the gym being a rest day, that's not a fail.

The day's score was ticked ÷ what is on the list *now*. So:

- moving a task to tomorrow, or deleting its calendar block (which now removes the task), took it out
  of the day, and the day scored better for it;
- a times-a-week habit (Gym, 5 a week) counted on every day it wasn't yet met, so a planned rest day
  read as a miss exactly like a skipped daily walk;
- the Coach saw only what was left, never what had come off.

## Decisions (George)

- **The day locks after the morning check-in**: once George has answered the Coach's morning
  message and it has replied, or at 11:00 if he hasn't. Before that he can reshuffle freely.
- **After the lock, moving a task is "pushed"** — amber, not a fail, but the Coach asks why, and a task
  pushed on two days counts as a miss the second time. **Deleting it is a miss** unless he tells the
  Coach it's no longer needed. Work the planner moves because the day was overbooked doesn't count
  against him.
- **A times-a-week habit counts only on days he needs it** to stay on pace (as many still to do as days
  left in the week). Otherwise it's optional: doing it counts, skipping it is a rest day.

## Design

### The commitment (`js/commit.js`)

`commit:<day>` in `doc.calendar`: `{ day, at, tasks: [ids] }` — the tasks on that day's list at the
lock. Written once, by whichever comes first: the app (as soon as the morning exchange completes) or
the planner's ten-minute run (from 11:00). Never rewritten.

### The score (`dayScore`, `js/schedule.js`)

From the day's current rows and its commitment:

| | counts as |
| --- | --- |
| a row ticked | done |
| a row not ticked | not done (a miss once the day is over) |
| a times-a-week habit, not needed that day, not ticked | optional: left out |
| a committed task now dated later, first time | pushed: left out, shown amber |
| a committed task pushed on a second day | missed |
| a committed task archived, not released | dropped: missed |
| a committed task archived and released through the Coach | left out |
| a task still dated that day but booked later by the planner | left out |

`dayCompletion` returns `{ done, total }` from it as before, plus the lists, so the header, the history
and Claude's reads all use it. The header reads *2 of 6 done · 1 pushed*.

Days before a commitment existed score from their rows alone, with the habit rule applied.

### The Coach

Its context gains the lock time, what was pushed (and to when), dropped, missed so far and optional, and
the score. Its instructions: hold George to what he committed to; in the evening raise pushed, dropped
and missed items by name and ask what happened, without lecturing; never call a day a success while
any remain; an optional habit left undone is a rest day. A new tool, `release_task`, records that a
dropped task was genuinely no longer needed, so it stops counting.
