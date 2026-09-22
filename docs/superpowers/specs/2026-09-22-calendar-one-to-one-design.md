# Calendar and task list, one to one

Designed 22 September 2026, from flag `703d7d07`:

> I have added some tasks to the calendar (which is the natural place for me to add things) and they
> aren't on here, and I've removed things from the calendar that have stayed on here … if it's on the
> calendar it's on the tasks, and changes to one change the other.

## What already works

- A task added in the dashboard gets a block (the planner, every ten minutes).
- Moving, resizing or renaming a task's block changes the task (`planner/reconcile.js`).
- Archiving a task removes its block.

## What was missing

1. **An event George adds himself never becomes a task.** It is only busy time.
2. **Deleting a task's block kept the task.** Since 18 September a deleted block set `scheduleHold`:
   the task stayed on the list as "Removed from Calendar — choose a new day". On 22 September that
   quietly lost "STARs out loud" from the calendar while it sat on the list.

## Decisions (George, 22 September)

- **Events George adds on Application, Challenger, Hebrew and Gym become tasks.** Those are the
  calendars an area books into. His main calendar (named *Tasks*, being renamed *Stuff*) is where he
  keeps reminders like "Dinner with dad": its events stay busy time only. Work, the Challenger work
  account and the ignored calendars stay busy time too.
- **Deleting a task's block removes the task** (archived, so ⚙ → changes can undo it), and leaves a
  Note flag so Claude, and George, can see what happened.

## Design

### Adopting an event (`planner/adopt.js`)

Each run, after inbound edits are reconciled and before planning, the planner looks at events that are:

- on a calendar some area books into, other than the default (main) calendar;
- not the planner's own, not cancelled, and timed (all-day events are left alone);
- not an instance of a repeating event (those are routines, such as the Gym and Hebrew sessions);
- not a linked habit's event (`habitEvents`), and not already carrying a `dashboard:` link;
- on today or later, within the planning window.

Each becomes a task: its title, date, start time (so it's pinned where George put it), length, and the
area that books into that calendar (a priority area first, when two share one). Its description becomes
the task's notes. The task records `fromEvent: "<calendarId>|<eventId>"`, so the same event is never
adopted twice, even if adoption is interrupted, and an event whose task George has since archived is
not brought back.

The event is then treated as the task's own block: the planner writes its markers onto it in the same
run, and from then on it is an ordinary pinned block. Moving it moves the task, renaming it renames the
task, ticking the task marks it ✓, deleting it removes the task, and archiving the task deletes it.

All adoptions in a run are one change, *Added tasks from Google Calendar*.

### Deleting a block (`planner/reconcile.js`)

A deleted block that stood for one task, in one part, archives that task and adds a Note flag:
*Removed "Role play 2" from your list: its calendar block (Wed 23 Sep, 14:15) was deleted.* A block
for part of a task split over several (a long task) keeps the old behaviour and unschedules it, since
deleting one part says nothing clear about the rest. Deleting a habit's block still skips that day.

## Not in this change

- All-day events stay out: a task has to have a time to mirror a block.
- A task the planner cannot fit anywhere in the window still has no block; its list row says so.
