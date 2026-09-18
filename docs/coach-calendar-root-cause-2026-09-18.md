# Coach and calendar: investigation and proposed direction

Investigated 18 September 2026. Scope: feature flag `31a62219`, calendar bug `bc821d86`, and Coach incident `f0e4a4c2`. This is a diagnosis and design proposal, not an implemented fix. The flags remain open.

The intended experience is conversational capture through the Coach, a clear view of upcoming work in Google Calendar, and consistent changes whichever interface George uses. The current implementation splits those responsibilities across systems with different meanings of a day, a task, and a completed action.

## What the incident actually records

The September 17 conversation and change snapshots provide stronger evidence than the Coach's retrospective explanation. Times below are London time.

- At 22:26:42 the Coach moved three application administration tasks from September 18 to September 17.
- At 22:26:45 it moved the same three tasks back to September 18, within the same response. The response displayed six separate action receipts and said “Done.”
- At 22:27 the three changes that moved the tasks back to September 18 were undone with `undoneBy: me`. Reversing those particular changes restored September 17. Each receipt has its own Undo button; there is no turn-level undo.
- At 22:29 the Coach moved five tasks to September 18, including the three administration tasks and two additional tasks. That was another set of edits, not a verified restoration of the pre-incident state.

The stored records do not support treating the Coach's later account of exactly which tasks it originally moved as reliable. Its initial mutations were the three administration tasks, not the two IDADP IDs named in its handoff. Nor do the records prove why the model chose those operations internally.

George's original message did invite changes to make tomorrow's work more relevant. It did not specify those three tasks or ask to bring them into a day that was already ending. The system needed to turn that request into a grounded, understandable proposal.

## Causes in the implementation

### The Coach can act faster than it can establish what is meant

`js/coach-tools.js` exposes immediate mutations and permits dates today and tomorrow. It does not require an expected original date, the calendar booking being discussed, or a closed-day check. `js/ui/coach.js:155` applies each tool call immediately; a failed later call or failed model response leaves earlier changes in place. The model can perform several rounds of such calls.

The system prompt says to act when George asks or “clearly means it”, but does not define how to handle an open-ended review of a calendar. A prompt improvement would help, but cannot provide atomicity, concurrency checks, or reliable undo.

### Action history is shown to George but omitted from subsequent model context

The application saves action receipts and change IDs in each message's `did` field. `js/talk.js:226` sends only message text back to the model on the next turn. For the incident, the model receives “Done.” without the six actual moves that appeared beneath it. It also receives no structured notification that George subsequently clicked Undo.

There is an existing conflict-aware `undoChange` function in `js/data.js:471`, but no Coach undo tool. The Coach therefore improvises forward edits when asked to revert. Its prose can claim success without any matching operation.

### “Tomorrow's list” is not a schedule for tomorrow

`js/schedule.js:62` includes unfinished tasks whenever their task date is at or before the requested day. An unfinished Friday task therefore appears in both Friday's and Saturday's lists. That is sensible for carry-over, but misleading when both are presented to the Coach as distinct daily plans.

`js/talk.js:167` supplies those overlapping lists and only today's planner calendar by default. Its calendar summaries omit item-to-event mappings, and the context does not explain the planner's relationship to Google Calendar. The model can request other days, but still gets a limited summary. Its claim that Google Calendar is simply a separate view it cannot explain is not an accurate account of the integration.

The planner can move a booking to a later day without changing the underlying task date. `planner/gas.js` writes calendar records, while `planner/plan.js:478` carries bookings forward. The task list and calendar consequently answer different questions while appearing to represent the same plan.

### Calendar grouping hides both task identity and usable capacity

`planner/demand.js:57` packs an area's tasks into blocks before looking for free time. Multiple tasks become names such as “Job search ×4”. Weekly target time can pad those blocks and even replace a single task's name with its area.

Descriptions contain IDs and notes, but only tasks with notes receive human-readable titles in a multi-task description (`planner/plan.js:125`). Opening an event does not guarantee a complete list of what it contains.

Reproduction: two 60-minute tasks in one area and two separate 90-minute free windows on Friday. Each task fits separately, including the configured gap. The planner combines them into a 120-minute block and moves both to Saturday. This confirms a general mechanism; it does not establish the precise free windows on the incident day.

The live planner snapshot also reports Assessment centre and Job search blocks overflowing from Friday into the weekend. That explains a present disagreement between the list and the planner's calendar record. We have not retrieved a historical raw Google Calendar snapshot from the time of the incident.

### Calendar interaction is only partially bidirectional

The planner detects a moved event and preserves it, and treats some disappeared events as skipped bookings. Those behaviours are not equivalent to updating the linked task's date, title, duration, or completion state. Calendar events are currently identified largely as dated area blocks, so editing a block cannot unambiguously edit one constituent task.

### Conversations are organised around slots rather than continuity

Morning, afternoon, evening and user-started conversations are separate records. New automatic openers do close older unanswered conversations, so the problem is not simply that all prompts remain active forever. However, old slot tabs remain visible, waiting-opener checks have no independent expiry, and automatic openers wrap up conversations George has participated in.

Each new conversation gets only its own full transcript plus limited journal summaries. A user-started conversation does not itself close all unanswered prompts. The afternoon prompt explicitly directs the model to name something that slipped and ask whether to move things, making rescheduling a recurring agenda rather than an optional response to George's needs.

The weekend capture failure is deterministic: the Coach can add tasks only today or tomorrow and cannot create goals. The skill hands those requests to Claude even though the application already has creation and goal-shaping machinery.

## Recommended experience

### One conversation, with prompts that expire

Keep a persistent Coach thread with day separators and optional history. Morning and evening should influence relevance and tone, not create separate obligations. An unanswered invitation expires when its useful window passes or George starts a new subject. Keep at most one current invitation; old unanswered prompts should not occupy active tabs or generate inferred journal answers.

“I'm going to bed” should set a visible, temporary day-closed state. Later messages can capture tomorrow's ideas without reopening today's work. George can explicitly reopen the day. Silence alone must not close work or change tasks.

Make the Coach composer the primary capture entry point. Explicit tasks on any valid future date can be added directly with a concrete receipt. Goals can be drafted within the same conversation using the existing plan machinery. When a date materially matters, ask one natural question; flexible language such as “over the weekend” can be represented as an allowed window and resolved visibly.

### Separate understanding from committing changes

Read a common schedule view first, including task identity, requested date, actual booking, calendar name, booking freshness, and why an item is unplaced or carried over.

For an explicit instruction such as “move this task to Saturday”, execute directly and show the result. For “tomorrow looks wrong; make it more relevant”, produce a compact editable proposal naming the affected tasks and before/after dates. One Apply action is appropriate for accepting an inferred reshuffle; routine capture should not acquire repetitive confirmation prompts.

Run proposed mutations on a draft, collapse contradictory changes to their net result, validate expected records and dates against the current document, then commit once with a turn ID and one undo record. A Friday-to-Thursday-to-Friday sequence should produce no effective date change. Give the Coach a real undo tool and send action/undo receipts into subsequent context. Preserve unrelated later edits when reverting, and report conflicts explicitly.

Add deterministic constraints: no inferred moves into a closed day; no silently ignoring a failed operation in a batch; stable creation IDs to prevent duplicate capture on retries; and structured success messages based on committed changes. These constraints supplement model reasoning rather than pretending to prove natural-language intent.

### One task identity and one schedule across interfaces

Use individually named calendar events for concrete tasks. Preserve area grouping through colours and adjacent placement. Keep any remaining weekly target time in clearly labelled optional practice blocks, separate from concrete tasks. A long task can have explicitly numbered sessions.

Separate requested day/window, deadline, actual scheduled start/end, and whether George has fixed that placement. All views should consume the same resolved schedule. If Friday cannot accommodate a task, show where it went and why, or show it as unplaced. Do not silently convert a deadline into a new date.

Use stable task/session identities in event metadata. Ingest Calendar edits before generating outbound changes. Read changes and deletions through Google's supported synchronization process, preserve baselines for fields, and expose conflicts when both sides change the same field. Do not infer deletion merely because an event moved outside a fetched time window.

Proposed interaction rules:

| Action | Result |
| --- | --- |
| Drag a task event | Update its scheduled day/time everywhere and preserve George's placement. |
| Resize it | Update the session duration; for a single-session task, update its estimate consistently. |
| Rename it | Update the linked task title for a single-task event. |
| Delete it | Remove that booking and expose the task as unscheduled; do not silently complete or destroy the task. |
| Complete in the Dashboard or Coach | Update the linked calendar event to show completion. |
| Complete from Calendar | Open the linked task's small completion view, or deliberately add Google Tasks integration if native checkbox interaction is essential. |

Google Tasks supports completion status but its public API does not expose due time. It is therefore not a straightforward replacement for timed task events. See [Tasks resource documentation](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks). Calendar change ingestion should follow [Google's incremental synchronization guidance](https://developers.google.com/workspace/calendar/api/guides/sync).

An Upcoming view should provide a compact agenda and unscheduled queue, including tasks outside the booking horizon. It should also let the Coach explain “why is this here?” from saved placement reasons rather than inventing an explanation.

## Delivery order and verification

1. Fix action integrity: persistent receipts, grouped changes, real undo, freshness checks and closed-day protection. Replay the September 17 scenario against a fake model and calendar.
2. Introduce the common schedule representation and improve Coach context. Verify a carried task appears once in the agenda and overflow is visible everywhere.
3. Introduce task-level events and inbound edits together. Migrate future generated area blocks carefully, preserving manually moved events, external appointments and history. Verify reruns cannot duplicate migrated events.
4. Replace the conversation tabs with a continuous flow and enable broader capture through the validated action layer.

Acceptance cases include: a missed afternoon question disappears by evening; a weekend task is captured in chat; an ambiguous calendar review does not immediately reshuffle unrelated work; undo restores the net pre-turn state; a calendar drag appears in the app and Coach; rename and resize agree across views; deletion produces an unscheduled task; partial API failure cannot be reported as complete; simultaneous device edits are reconciled; and fragmented free time is used for individually fitting tasks.

Validation performed for this investigation: 48 existing Coach and planner tests passed. Two focused synthetic checks reproduced overlapping daily lists and avoidable overflow from area grouping. Incident change snapshots confirmed the move/correction/undo sequence. No application behaviour or live personal data was changed.

## Implemented delivery

The investigation above describes the pre-change incident. The shared schedule, continuous Coach,
future capture, goal drafting, isolated turn commits, proposals, recorded undo, closed days, Upcoming,
individual events and inbound Calendar reconciliation are now implemented. The runner checks missing
known event IDs through Calendar.Events.get before treating them as deleted; this reuses existing
triggers without requiring a new incremental-sync deployment. Calendar conflicts remain explicit.

The original requested date remains distinct from confirmed placement. Flexible date windows were
not added as a new data type: the Coach resolves a concrete date with the user. Long-task session
movement is preserved without rewriting the overall estimate. Deleting a session unschedules the
whole task so remaining sessions cannot quietly reappear. Existing manually moved legacy groups
stay intact; future unpinned groups migrate with deletion prerequisites to prevent duplicates.

Verification includes the production runner with fake Calendar/repository services, incident replay,
conflicting edits, missing-event failures, split sessions, invalid all-day conversions and real browser
flows for proposals, undo, closed days, future capture and explicit linked completion.
