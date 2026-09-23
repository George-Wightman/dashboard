# Playbook: planning his week

For "plan my week", "what should I be doing", or any reshuffle of more than a day or two.

## Read before you change anything, in this order

    bash run.sh week        # targets against their numbers, time off coming, what's booked
    bash run.sh attention   # what actually needs you
    bash run.sh goals       # the goals and which stage each is at
    bash run.sh list        # everything upcoming, with ids
    bash run.sh journal     # how he's been, and your guide for the week
    bash run.sh planner     # his calendars, the planning hours, the settings

`attention` is the one that earns its place: tasks with no length, tasks carried three days or more,
targets behind pace, anything the planner couldn't fit. Fix what you can from it and tell him the rest.

## Then spread the work

Put the week's tasks and the next stage of each goal across the days. Every task wants:

- a **date** — spread them, don't pile a week onto Monday;
- an **area**, reused from the ones already in `list`, so similar work shares a block;
- **minutes** on anything over half an hour;
- **time** only when it genuinely happens at a set time.

Do it in one `apply` with several `edit` ops. The calendar follows within ten minutes — never book
blocks yourself.

## Today locks after the morning check-in

Once George has answered the Coach's morning check-in (or at 11:00), today's list is what he committed
to. A task moved off today after that is **pushed** (a miss the second time), and one deleted is a
**miss** unless the Coach releases it as no longer needed. So reshuffling today after the lock isn't
free: do it when he asks, and say that it will show as pushed. `day <date>` shows the lock, and what
was pushed, deleted or optional. Times-a-week habits only count on days the week needs them.

## Work that has to happen in order is a series

Role play 1 before 2 before 3; mock interview 1 before 2. Give those tasks one `series` name
(`"series": "Role plays"`) and orders that run in sequence. The planner then never books a later one
before an earlier one has ended, and when an earlier one slips a day the later ones slip with it.
Unrelated work in the same goal stays out of the series, or one slipped scenario would hold back every
role play.

On 22 September a chat moved Role play 1 onto a Wednesday where Role plays 2 and 3 were already pinned.
It didn't fit, the planner carried it to Thursday, and it landed after both. So:

- **Before you pin a time or move a date**, look at the day (`day <date>`): what's pinned there, and
  whether what you're adding fits in the gaps.
- **Read every `Note:` that comes back.** A series warning means the dates are out of order; with a
  pin involved, the planner can't fix it for you.
- **After it runs** (ten minutes), read `planner`'s notes and the day again. "Couldn't fit … moved to …"
  means your plan isn't the calendar's.

## Watch out: `plan` drops most of what you give it

`{"op": "plan", …}` is for a goal with stages. Its nested parts read **much less** than the ops they
resemble:

- a plan's task reads `title` and `date` — **not** `area`, `minutes`, `notes` or `priority`;
- a plan's habit reads `title` and `repeat`;
- a plan's target reads `title`, `target`, `unit`, `unitLabel`.

So use `plan` for the shape, then `edit` each task afterwards to give it an area and a length. The
tool warns you when a field was ignored — read those notes, they mean something didn't happen.

## Finish the week properly

- **A brief** for each day: `{"op": "brief", "text": "…", "day": "2026-09-17"}` — one or two lines on
  what matters and why.
- **A guide for the Coach**: `{"op": "guide", "text": "…"}` — what to push on and ask about this week.
  The Coach is handed it every time it talks to him.
- **Time off** he's told you about: `{"op": "off", …}` rather than leaving him to block the calendar.

## Say what you did

One line per change, in the tool's own words. If a target is behind and you couldn't fix it by moving
work, say that too — an honest "Hebrew is 4h behind with two days left" is worth more than a tidy plan
that quietly drops it.
