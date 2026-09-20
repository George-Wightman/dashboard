# The Coach's day: intent and reconciliation

Designed 20 September 2026, from flag `a8ed3f3a`. Supersedes the brief's role described in
`2026-09-14-coach-conversation-design.md`.

## The bug

On Sunday 20 September the Coach opened the morning with "How are you feeling about getting into
the groundwork today?". No groundwork was scheduled for that day.

The records:

| Time (London) | Event |
| --- | --- |
| Sat 19th, 12:40 | Claude wrote the brief for Sunday: "Groundwork day: reread the applications, draft Motivational Fit, pick the four STARs." |
| Sun, 07:45 | The planner ran. It could not fit any of the three, and booked all of them on Monday. |
| Sun, 08:39 | The Coach wrote the opener quoted above. |
| Sun, 08:41 | George flagged it. |

The Coach spoke 54 minutes after the work had moved.

## Root cause

`talkContext` (`js/talk.js`) is rebuilt from the document on every turn, and it was correct: today's
list held no groundwork tasks, and tomorrow's held all three tagged
`Requested 2026-09-20; placed 2026-09-21`. The Coach was not short of data.

`briefFor` (`js/calendar.js:234`) is a bare string lookup by date. The brief names specific tasks,
carries Claude's name, and has no relationship to the schedule. Nothing re-checks it and nothing
expires it when the tasks it names leave the day. Presented beside the lists as
`Claude's brief for today`, it reads as a description of the day rather than as intent, and it won.

The original flag proposed generating the day's prompts from the day's tasks each morning. That
would not have fixed this: the opener is already generated from live context. The stale layer is the
brief.

Two consequences follow. The fix belongs in how intent and schedule are presented, not in adding a
generation step. And because the brief is stored prose, the same brief keeps misfiring all day.

## Design

### Two layers

**Intent** — `guide` (weekly) and `brief` (daily), both written by Claude. They say why today matters
and how to approach it. They do not state what is scheduled, so the planner cannot falsify them.
They are relabelled in the prompt to make that status explicit.

**Today's actual shape** — computed from `scheduleView` on every turn. Nothing stored, nothing
cached, so it is correct after a mid-afternoon calendar change and not only at the moment an opener
was written.

### `dayShape(doc, today)`

A pure function in `js/talk.js`, built on `scheduleView`, which already carries `requestedDay`,
`scheduledDay` and `reason`. It returns:

- `bookedToday` — tasks with a confirmed booking today, whenever they were requested
- `movedOff` — requested today, booked on a later day, with the day they went to
- `unscheduled` — requested today, no confirmed booking
- `arrived` — requested before today, booked today
- `significant` — see below

It sits in `js/talk.js` rather than beside `scheduleView` in `js/plan-state.js` for a deployment
reason that outweighs the tidier grouping: `plan-state.js` is bundled into the Apps Script planner,
so putting a Coach-only helper there would force George to redeploy the planner for every change to
it. `js/talk.js` is not bundled. Only the Coach's prompt reads `dayShape`; if another view ever
needs it, move it then.

### Significance

Significance is a property of what is *left*, not of what moved. Three tasks leaving a day that is
still full is a non-event; three leaving a day that is now empty is worth a sentence.

    significant = movedOff.length > 0
                  && (bookedToday.length === 0 || bookedMinutes * 2 < requestedMinutes)

`requestedMinutes` totals every task requested for today, wherever it ended up. `bookedMinutes`
totals every task booked today, including ones that arrived from earlier days — so a day backfilled
with other real work does not score as significant. A task without `minutes` counts as 30, matching
the planner's `defaultMinutes`.

The halving threshold is one constant, `LIGHT_DAY_RATIO`, intended to be tuned once observed.

### What the Coach is told

The brief line becomes:

    Today's intent (Claude — why today matters, not what is scheduled): <text>

and the reconciliation adds only the lines the existing lists do not already carry:

    Requested for today, now booked later: "Reread every application MI5 holds" → Mon 21 Sep · …
    Requested for today, no booking yet: …
    Booked today though requested earlier: …

Today's list and tomorrow's list already cover what is booked. The missing line was the one
explaining that work *left* this day: those tasks currently vanish from today's context and
reappear under tomorrow with no trace that they were ever meant for today.

**The facts are present on every turn, unconditionally.** That is what stops the Coach being
wrong-footed. Significance governs only whether it may raise the subject.

### Raising it

When `significant`, the context carries one marker line, and only on the Coach's first message of a
conversation — an automatic opener, or its first reply in a conversation George started. On every
later turn the marker is omitted, so there is nothing to repeat. The facts remain.

This is structural rather than a request to the model: the information that licenses the mention is
absent after the first message.

Resulting behaviour:

| Situation | Coach |
| --- | --- |
| Significant change | One mention, in its first message. Afterwards it is context, not agenda. |
| Minor change, day still full | Says nothing about it, and is still accurate about where work is. |
| George asks directly | Answers in full from the facts, on any turn. |

### System prompt

Two lines in `TALK_SYSTEM`:

- Precedence: Claude's intent lines say why today matters; they never state what is scheduled. The
  lists and bookings are the only source of what is happening, and where they disagree with the
  intent, the lists are right.
- Restraint: talk about the day as it actually is; do not volunteer that work has moved or slipped
  unless it is marked significant or George raises it.

The precedence line is what makes this robust. Even a future brief that names tasks cannot
wrong-foot the Coach, because the reconciliation states where those tasks actually are.

### Convention

Briefs stop naming dated tasks; documented in the skill reference. This is belt-and-braces. The
precedence rule and the reconciliation carry the weight, and neither depends on the convention
being kept.

## Testing

- `dayShape` units: booked today, moved off, arrived from an earlier day, unscheduled.
- Significance: a stripped day scores significant; a day backfilled with arrivals does not.
- Regression reproducing 20 September — a brief naming three tasks, all booked tomorrow — asserting
  the context states where they went and marks the day significant. This fails on current code.
- The marker appears on a first message and is absent on the next turn.
- Existing Coach and planner suites stay green.

`js/talk.js` and `js/ui/coach.js` are both in the service worker `SHELL`, so `npm run
build-release` must run before pushing or the offline update breaks. `js/plan-state.js` is
deliberately left untouched, so `planner/planner.js` does not need rebuilding and the Apps Script
does not need redeploying.

## Out of scope

The planner's last run reads 07:45 against a ten-minute cadence, so it appears about an hour stale.
Separate cause, separate fix.
