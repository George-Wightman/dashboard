# Expanded AI controls and goal reviews

Implemented locally on 17 September 2026. The design keeps open-ended planning in Claude and gives the dashboard precise, bounded operations that can be inspected and tested.

## What is implemented

| Capability | Behaviour |
|---|---|
| Structured details | Tags, context, location, energy, success criteria, availability date, advisory deadline, dependencies, checklists, typed outcome questions and bounded custom values. |
| Task readiness | Dependencies and availability agree across the daily list, completion checks and new calendar bookings. Dependency cycles are rejected when configured. |
| Better plan creation | Tasks keep their duration, area, time, priority and notes, and link to the plan's goal. Invalid dependency details roll back the whole plan. |
| Reported outcomes | Optional forms collect explicit user answers. Required answers and checklists can gate completion. Stable report IDs prevent duplicate submissions. |
| Conditional actions | A rule can create a task, reschedule a task, record an amount, flag an issue or request a goal review. Rules can be paused in Settings → Claude. |
| Goal reviews | Request a review from a goal or Claude, enable a cadence explicitly, or request one from a condition. Reviews assess direction using bounded goal-specific evidence. |
| Suggested next steps | Reviews create zero to three suggestions. Accepting them is a separate decision; they are not automatically booked. Exact duplicate/declined titles are suppressed, with at most three pending suggestions per goal. |
| Claude discovery | `capabilities`, focused playbooks, `inspect` and read-only `preview` let Claude discover relevant controls without loading every detail. |

Details are not all scheduling constraints: energy, tags, location and custom values are descriptive metadata. A deadline raises attention but does not introduce a new deadline optimiser. Calendar events manually moved by the user retain the existing planner's protection. Existing in-progress bookings are also preserved.

## Example: stay on course for an assessment

Claude links preparation tasks to the assessment goal and records the user's success criteria. A requested weekly review considers the linked tasks, milestones, recent recorded work and any explicit outcome reports. It can say that practice is progressing, flag missing evidence, or suggest a short timed exercise. The user decides whether to accept that suggestion.

An optional known condition, such as a user-reported score below a threshold, can queue that same review. An open-ended discussion about the assessment format and a bespoke practice plan stays in Claude. No form or rule is enabled merely because the feature exists.

## Execution and limits

- The existing Apps Script planner runs rules under its script lock. Up to 50 rules may be enabled; a pass executes at most 20 matched rule/report pairs. A rule has up to eight conditions and five actions.
- Each pair executes once after enablement. New or re-enabled rules do not consume older reports. All actions in a rule either succeed together or roll back with a failure receipt. Actions never generate new outcome reports, preventing recursive chains.
- Goal reviews use the planner's private `GEMINI_KEY` Script Property and its existing Gemini endpoint. No arbitrary webhook execution or external-service framework has been added.
- Reviews are opt-in: at most one request per goal per day, two API calls per planner run and six per day across goals. These are separate from existing Coach/tagging budgets. Completed goals stop generating scheduled requests.
- A durable claim precedes each paid request. Validated responses survive failed document sync; failed or interrupted attempts are not automatically charged again. Status is visible in the goal and Claude's workflow view.
- Evidence includes only the selected goal, up to 30 linked active items, 20 milestones, recent log aggregates and five outcome reports. Text is truncated; unrelated records, credentials and conversation transcripts are excluded. Missing evidence is described as unknown.
- Review summaries are AI assessments. Suggestions are validated, but duplicate prevention compares titles rather than meaning. Differently worded duplicates can still need user judgment.
- Undo affects recorded data changes; it does not reverse a paid API call or automatically unwind downstream actions. Nested `details` remains one merge field, so simultaneous edits to different nested keys can conflict.

## Rollout

Publish the application modules, generated offline release and generated planner together. The existing planner loader retrieves the published bundle. Reload devices so old writers do not discard new maps. Updated Claude skill sources and reference playbooks are included; rebuild/reinstall the skill package when distributing its revised entry guide. No credentials should be copied into these records or documentation.

Rules require the planner to run. Background reviews additionally need its private Gemini key; the browser's key is separate. Pausing the planner pauses processing. No recurring reviews have been enabled on the user's live goals by this implementation.

## Further extensions worth considering

These are design options, **not implemented features**:

1. Explicit preferred time windows and split-session policies, with an explanation when constraints cannot be met. Build on the current planner rather than adding a second scheduler.
2. Goal metrics that distinguish leading indicators (practice sessions) from outcomes (scores), with baselines and evidence dates. This would improve reviews more than increasing task volume.
3. Reusable small task templates, with schema versions and previewable expansion. Keep template selection deliberate and avoid automatic large plans.
4. Tracker aggregation modes such as latest value or rolling average, instead of treating every measurement as an additive amount. Each mode needs clear history and correction semantics.
5. Explicit failure routes and escalation after repeated missed work, with cooldowns and a single outstanding prompt. Avoid repetitive reminders and autonomous retry loops.
6. Workload-aware suggestions that use available capacity before proposing tasks. Review suggestions currently use evidence and fixed size limits, not a capacity solver.

Each addition should expose a focused capability, a bounded schema, a concrete preview and a small playbook before adding more autonomous behaviour.

## Verification

The automated suite covers validation, dependency readiness, transactional rollback, report/rule idempotence, opt-in scheduling, API budgets, recovery after lost sync, suggestion limits and planner integration. All API and GitHub calls in these tests use fakes.

The isolated Edge browser smoke test covers editing, cross-tab convergence, offline saves/recovery, mobile layout, reporting an outcome, unlocking a dependent task and queuing a goal review. It blocks external requests. Live Gemini quality and production deployment are not verified by these local tests.
