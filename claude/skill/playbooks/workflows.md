# Playbook: simple conditional follow-ups

Use a rule for a predictable action from a reported fact. Keep interpreting assessment formats,
designing practice programmes and other open-ended work in the Claude conversation. Prefer a
plain task or goal review when that is enough; do not turn every task into a form.

1. `find <words>`, then `inspect <id>`. Reuse real IDs and existing goals/areas.
2. `capabilities workflows` and `capabilities details`. Define only the questions needed.
3. Preview the details and rule JSON, then apply. Read `workflows` to verify enabled status.
4. George reports in the app when completing the task, or tells you the answers here. Use `report`
   with `reported:true` only for his actual answers. Missing answers never satisfy a condition.
5. The existing planner processes reports about every ten minutes, under its script lock. Look at
   `workflows` for applied/failed receipts. Do not claim a follow-up or review ran merely because
   the report was saved. A paused planner also pauses this processing.

An optional form is `details.outcomeForm`, up to eight questions. Each has `key` (unique lower_case),
`label`, `type` (`boolean|number|choice|text`) and optional `required`. Choice questions have 2–10
distinct `choices`; numbers can have `min` and `max`. Text answers are limited to 2000 characters.
Use one or two questions in normal use. Example:

```json
{"op":"details","id":"<practice-task-id>","set":{"outcomeForm":[
  {"key":"score","label":"What score did you achieve?","type":"number","min":0,"max":100,"required":true}
]}}
```

A rule has `sourceId`, `match` (`all|any`), up to eight conditions and 1–5 actions. Conditions are
`{"field":"score","op":"lt","value":60}`. Operators: eq, ne, gt, gte, lt, lte, contains.
Numeric comparisons require numeric questions; contains requires text. Empty conditions match
every new report for this source. Only active, enabled rules run.

Supported action shapes:

```json
[
  {"type":"task","title":"Practise one numerical exercise","offsetDays":1,"minutes":30,"area":"Job search","goalId":"<goal-id>","notes":"Repeat the weakest topic","priority":false},
  {"type":"reschedule","itemId":"<task-id>","offsetDays":2},
  {"type":"log","targetId":"<quota-or-numeric-goal-id>","answerField":"minutes_spent"},
  {"type":"flag","text":"The practice result needs a closer look"},
  {"type":"review","goalId":"<goal-id>"}
]
```

These are alternative examples, not a recommended five-action bundle. Task needs title and
offsetDays (0–365); its other fields are optional. Reschedule offsets are relative to the reported
day. Log takes a positive literal `amount` OR numeric `answerField`, never both. Reviews assess
current progress and only propose suggestions. No arbitrary HTTP endpoint, script or expression
is accepted; this keeps the API path focused on useful goal review rather than general automation.

Limits: 50 enabled rules, 20 matched rules per planner run. A rule/report pair runs once. Actions
do not emit reports, so they cannot recursively trigger a rule storm. A failed action rolls back
that rule's actions and leaves a failure receipt; it is not endlessly retried. Corrections and
undo do not retroactively reverse downstream work or undo an API charge. Inspect the affected
records and deliberately correct them. Two genuinely separate reports are two events; use a
stable reportId when retrying the same submission.

Dependencies reference existing one-off tasks and require a recorded completion on/before the
day being considered. Archiving a predecessor does not count as completing it. Cycles are refused
when configuring details. The app shows waiting tasks; they do not count as missed daily work or
get fresh calendar bookings. If a dependency was entered incorrectly, amend it rather than
fabricating a completion. Do not use dependencies to predict exactly when future work will finish.
