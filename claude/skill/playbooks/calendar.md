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

Beyond seven days the planner still books, roughly, but keeps no record — so an empty `week` past
that means "no record", not "nothing booked".

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

## The one thing he may need to do by hand

An event he created himself can be linked to a dashboard item by putting `dashboard:<id>` on its own
line in the description — the id as this tool shows it. The planner then treats that event as the
item's time and won't book a second one. Tell George how to do it rather than doing it for him.
