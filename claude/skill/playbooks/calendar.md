# Playbook: George's calendar

Read this before looking at his Google Calendar, or before concluding anything about what the
planner has or hasn't booked.

## He has several calendars. Looking at one tells you nothing.

Tasks (his main one), Application, Gym, Work, Challenger, Family, PhD and more. The planner books
different areas onto different calendars — job search and assessment centre work go to **Application**,
health to **Gym** — so a day that looks empty on one calendar is usually full on another.

**Always start here:**

    bash run.sh planner

That prints every calendar by the name Google knows it by, which is the main one, and which ones the
planner ignores. Only then go to the calendar connector, and query **all** of them.

A session once read the Tasks calendar alone, found no blocks, and told George the planner was
broken. It was working perfectly; the blocks were on Application.

## What the planner has booked

    bash run.sh week

That lists the next seven days as the planner recorded them, `~` marking a rough time. This is the
dashboard's own account and it needs no connector at all. Use it first.

The CLI week view remains seven days. The app's Upcoming view uses the full confirmed booking
horizon and also lists future tasks that have no slot yet.

## Never edit his calendar yourself

Not the blocks the planner made, not his own events, not recurring series. No deleting, no moving, no
retitling, no tagging. Every one of those is the planner's job or George's, and a change you make by
hand is invisible to `changes` — so he can't see it and can't undo it.

If something is wrong on the calendar, the fix is always in the dashboard:

| What's wrong | What to change |
| --- | --- |
| Booked on a day he isn't working | `off` |
| In the wrong place in the day | `planner` `hours`, or `dayHours` for one date |
| On the wrong calendar | `planner` `areaCalendars` for that area |
| Too long, too short, or no length | `edit` with `minutes` |
| Should happen at a set time | `edit` with `time` — on a task **or** a habit |
| Should be booked first | `priority`, or `priorityAreas` |

## Blocks he has moved

The planner leaves a block where George drags it, and never moves it again. That's deliberate — don't
try to put it back, and don't read a moved block as a mistake.

## Events George adds himself

An event he adds on **Application, Challenger, Hebrew or Gym** — any calendar an area books into —
becomes a task on its next run: its title, day, start time (pinned), length, the area that books into
that calendar, and its description as notes. The event becomes that task's block, so everything above
applies to it. His **main calendar** (Tasks, being renamed Stuff) is for reminders like "Dinner with
dad" and never becomes tasks; nor do Work, repeating events, linked habit sessions or all-day events.
So if George says "I put it in the calendar", look for the task before adding one.

## The one thing he may need to do by hand

An event he created himself can be linked to a dashboard item by putting `dashboard:<id>` on its own
line in the description — the id as this tool shows it. The planner then treats that event as the
item's time and won't book a second one. Tell George how to do it rather than doing it for him.

## Shared task events

Concrete tasks now have individually named events and stable task/session identities. Long tasks
use numbered sessions; spare weekly target time is separate unscheduled time, except the Hebrew
app's "Hebrew learning time", which is never booked (he books Hebrew himself; the 21:30 habit
stays). Don't book Hebrew to make up that target either. The planner imports
George's Calendar edits before exporting: a single-session drag or resize updates the task's day,
time and length; a rename updates its title. Conflicting concurrent edits wait for a visible choice
in Upcoming. Moving one numbered session preserves the others without rewriting the whole estimate.
Deleting a task's event removes the task (archived, so George can undo it in ⚙ → changes) and leaves
a Note flag from the calendar saying what went and when. Deleting one numbered session of a long task
only unschedules the task. Read those notes at a check-in: a task that vanished was deleted by George
on purpose, so don't add it back unless he asks. A task link in the event opens a completion
view; opening the link itself does not complete anything.

The planner verifies missing known events by their IDs, including events moved outside its window.
A failed lookup is an error, never evidence of deletion. Future unpinned legacy area blocks migrate
only after confirmed deletion; manually moved legacy groups and past history are preserved.
