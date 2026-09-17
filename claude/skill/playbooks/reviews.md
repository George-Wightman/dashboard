# Playbook: goal direction reviews

Use Claude for open-ended planning and conversation. The app's background API review answers a
smaller question: does the recorded work still support this goal, and what are the next few useful
steps? It must not turn into a second coaching chat or an automatic task factory.

1. `find <goal words>`, `inspect <goal-id>`, then `goals` or `attention` as needed.
2. Ensure tasks and trackers have the right goalId. Add a concrete successCriteria and targetDate
   where George has supplied them. Activity alone is not evidence of achieving the goal.
3. For one requested background review: preview/apply `{"op":"review","id":"<goal-id>"}`.
4. For requested ongoing review: preview/apply
   `{"op":"details","id":"<goal-id>","set":{"reviewEveryDays":7}}`. Set 0 to stop future scheduling.
   Do not enable recurring reviews merely because the tool supports them.
5. `workflows` shows status; `inspect <review-id>` shows the result. A queued review needs the
   existing Apps Script planner running with GEMINI_KEY in its private Script Properties. Never
   put a key in a goal, custom field, rule or outcome. The browser's Gemini key is not the runner's key.

Evidence is limited to this goal, its linked items, milestones, recent numeric/completion logs and
up to five recent reports from the last fourteen days. Keys, unrelated tasks and chat transcripts
are not sent. Long text and lists are bounded. Results distinguish on_track, at_risk and
insufficient_evidence and explain the reasoning. This is an AI assessment, not a verified score.

Output is a short review plus zero to three suggested tasks, linked to the goal. Tasks remain
suggestions until George accepts them; they are not booked automatically. Exact duplicate live
or declined titles are skipped, and a goal can have at most three unaccepted suggestions.
Avoid asking for another review when the first one is pending, and do not
automatically accept or expand its suggestions. If it lacks evidence, collect the smallest useful
fact or review the issue with George in this conversation.

There is at most one request per goal per day, two calls per planner run, six calls per day across
goals. These limits apply to goal reviews, separately from existing Coach and tagging calls.
Reviews are off by default; completed goals stop creating scheduled requests. The runner saves a claim before calling Gemini and retains a
validated response across a failed sync. An interrupted or failed call is not automatically
charged again; status is visible. A new manual review can be requested on a later day. Disabling
cadence cancels queued scheduled requests; already queued manual requests remain explicit work.

To trigger a review from a known condition, read `reference workflows` and use a review action.
Do not build an elaborate conditional practice generator for something better discussed here.
