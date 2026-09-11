# Gemini coach — design

2026-09-11. Piece 5 of the roadmap, built next at George's request ("build the api integration").
He was away while this was designed; every choice below is recorded so he can overrule it.

**Assumption:** "the API integration" means Gemini — his original framing was "integration with an
API (gemini seems cheapest) to give personalised feedback / ask me at the end of the day for
reflections", plus shaping larger goals. The Claude connector (piece 3) is separate and not built here.

## What it does

1. **Shape a goal.** He types a big goal in plain words; Gemini proposes a goal with milestones and
   up to two habits and two weekly targets. Everything lands as **suggestions** (✓ / ✕), never
   straight onto his list — the rule agreed in brainstorming for things the AI proposes unprompted.
2. **Evening check-in.** From 18:00 (a setting) the dashboard offers a check-in: Gemini asks 2–3
   questions about *today* — built from what actually happened — he answers in a line or two
   each, and Gemini replies with short, specific feedback and at most two suggested tasks for
   tomorrow.
3. **Weekly digest.** Once a new week starts, Gemini writes a short digest of last week — what
   went well, what slipped, one focus for this week. It is stored in the synced document so
   Claude (piece 3) can read it later without reading raw data.

## On screen

**Coach panel** — first panel in the right column.
- *No key:* one line — "The coach needs a Gemini key. Add one in ⚙, or save one in the Hebrew
  app on this device."
- *Before the check-in hour, no check-in yet:* "Evening check-in from 6pm · check in now" (link).
- *At or after the hour, no check-in yet:* a primary button "Start today's check-in".
- *Asking:* "Thinking…" while Gemini works.
- *Questions shown:* each question with a small textarea; **Send** and **Not now**. Questions
  are saved as soon as they arrive, so they survive a reload or a switch of device; typed
  answers live only in the page until sent.
- *Done:* today's feedback (collapsible, open by default on the day). Suggested tasks for
  tomorrow appear at the top of the list like any suggestion, marked "for Sat" etc.
- *Last week:* if a digest exists for last week, a collapsed "Last week" line that opens to the
  summary, wins, slipped and focus. If none exists and a key is set: "Write last week's digest".

**Goals panel** — next to "+ goal", a "Shape with AI" link opens an inline box: "What do you want
to achieve?" (textarea) + **Shape**. The result is a *suggested* goal card that now previews what
Gemini proposed (its milestones, and the habits/targets it wants to add). ✓ on that card accepts
the goal **and its proposed milestones**; ✕ dismisses the goal, its proposed milestones and any
still-suggested habits/targets linked to it. Proposed habits/targets also appear at the top of
Today as ordinary suggestions and can be accepted one by one.

## The Gemini key

Looked up in this order, all device-local, never synced:
1. `dash_settings.geminiKey` — a new optional field in ⚙ ("Gemini API key (optional)").
2. `localStorage.hvr_geminikey`, then `hvr_geminikey2` — the Hebrew app's keys. Both apps are
   served from `george-wightman.github.io`, the same origin, so the Hebrew app's key is readable
   here with no re-entry. The ⚙ field says "Leave blank to use the Hebrew app's key on this
   device" and shows whether one was found.

Privacy line in ⚙: "Check-ins and goal shaping send a summary of your list to Google. On Google's
free tier they may use it to improve their products."

## Models and quota

Lessons carried over from the Hebrew app (see its geminiSend):
- Order: `gemini-flash-lite-latest` first (≈500 requests/day), then `gemini-flash-latest`
  (≈20/day). Lite-first is deliberate: the Hebrew app shares the same key and depends on the
  scarce Flash pool; the dashboard should not eat it. Always the `-latest` aliases.
- `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}`
  with `systemInstruction`, `contents`, and `generationConfig: { responseMimeType:
  'application/json', temperature: 0.6 }`. **No thinking config** (the Hebrew app found Flash
  rejects some thinking settings).
- HTTP 400 → retry the same model once with a plain body (system text prepended to the prompt,
  no generationConfig) — models churn; slower-but-working beats broken.
- HTTP 429 with "retry in Ns" where N ≤ 20 → wait N s and retry the same model once. Any other
  429 → next model. All models refused with 429 → "Gemini's free limit is used up for today".
- 5xx, network error, or 30 s timeout → next model.
- Reply: `candidates[0].content.parts[*].text` joined; strip ```json fences; `JSON.parse`.

Cost per day: a check-in is 2 requests, shaping a goal 1, the digest 1 a week.

## Prompts

**System instruction (all jobs):**
> You are George's coach inside his personal daily dashboard. Be direct, warm and specific, in
> British English. Refer to the actual items, numbers and words in the data you are given; never
> give generic advice or motivational filler. No emojis. Stay within the length limits. Reply with
> JSON only, in exactly the shape asked for.

**Context block** — built by a pure function from the document, compact plain text:
- `Today: Friday 11 September 2026`
- Today's rows: `✓ Hebrew practice [Hebrew] — 6-day streak`, `✗ Email Sarah [Job] — carried from Wed`
- This week's targets: `Job search: 3.5h of 6h`, `Applications: 3 of 5`
- Last 7 days: `Fri 2/8 · Thu 4/6 · …`
- Goals: `Land an analyst role — 33%, target 10 Nov; next: Five applications sent, First interview`
- Recent check-ins (last 3 days, answers only, each capped at 300 characters)

**Job A — check-in questions.** Context, then:
> Ask George 2 or 3 short questions about today, each answerable in a sentence or two. At least
> one must name something specific from today — a miss, a win, or a number. The last question is
> about tomorrow. Shape: {"questions": ["…", "…"]}

**Job B — feedback.** Context, then the questions with his answers, then:
> Reply with feedback of at most 90 words. First one specific thing that went well, if anything
> did; then the single most useful change for tomorrow, grounded in his answers and the numbers.
> Don't moralise and don't repeat his answers back to him. Then suggest at most 2 concrete tasks
> for tomorrow, only if they follow from what he said. Shape: {"feedback": "…", "tomorrow":
> [{"title": "…"}]}

**Job C — shape a goal.** Context (including every goal and item title he already tracks), his
text, then:
> Turn this into a plan George can start this week. Don't duplicate anything he already tracks.
> Prefer small weekly targets he can actually hit. Shape: {"title": "short goal name",
> "targetDate": "YYYY-MM-DD" or null (only if he gave or implied a deadline), "milestones": ["3 to
> 6 concrete, checkable steps, in order"], "habits": [0 to 2 of {"title": "…", "repeat": {"kind":
> "daily"} or {"kind": "weekdays", "days": [1-7…]} or {"kind": "perWeek", "n": 1-7}}], "targets":
> [0 to 2 of {"title": "…", "target": number, "unit": "count" or "minutes", "unitLabel": "…"}],
> "why": "one sentence"}

**Job D — weekly digest.** Last week's numbers (per habit done/scheduled, per target total vs
target, tasks done, goal progress), and that week's check-in answers and feedback, then:
> Write last week's digest, for George and for Claude, who reads it later to help him. Shape:
> {"summary": "at most 120 words", "wins": [0 to 3 short phrases], "slipped": [0 to 3 short
> phrases], "focus": "one sentence for this week"}

**Validation** (pure, tested) — each reply goes through a parser that returns a clean object or
throws `Error("Gemini's reply didn't make sense — try again")`: strings trimmed; titles capped at
80 characters, feedback 900, summary 1200; arrays capped at the stated counts; unknown fields
dropped; a repeat that isn't one of the three allowed kinds becomes `daily`; `targetDate` kept
only if it's a valid `YYYY-MM-DD` on or after today; `target` must be a positive number (minutes
for time targets — the prompt asks for minutes).

## Data

A new top-level map **`journal`**, added to `MAPS` (older copies of the app keep it through merges
thanks to the unknown-map handling). Records carry the common fields plus:

| Field | Check-in | Digest |
|---|---|---|
| `id` | `checkin:<day>` | `digest:<Monday of that week>` |
| `kind` | `'checkin'` | `'digest'` |
| `day` | the logical day | the week's Monday |
| content | `questions[]`, `answers[]`, `feedback`, `tomorrowIds[]` | `summary`, `wins[]`, `slipped[]`, `focus` |
| `model` | which model answered | same |

Deterministic ids mean one check-in per day and one digest per week across devices; the merge keeps
the later one.

Goal shaping writes: a goal (`suggested`, `source: 'gemini'`), its milestones (`suggested`), and
habits/targets as items (`suggested`, `source: 'gemini'`, `goalId` = the new goal). Tomorrow's
tasks: task items dated tomorrow, `suggested`, `source: 'gemini'`.

New store methods: `saveJournal(record)` (create or replace by id), `addPlan(plan)` (the records
above, one commit), `acceptGoalPlan(goalId)`, `dismissGoalPlan(goalId)`.

Settings gain `geminiKey` (default `''`) and `checkinHour` (default 18, 12–23).

## Weekly digest trigger

On open and on focus: if the current week's Monday is after the Monday of the most recent digest
(or there is none), last week has any counted rows or amounts, a key is available and no attempt
has been made this session — generate last week's digest in the background. Failure is silent (the
panel keeps its "Write last week's digest" link).

## Failure handling

Never blocks, never a dialog. Inline, in the panel or the shaping box: no key; offline; "Gemini's
free limit is used up for today — try tomorrow"; "Gemini didn't answer — try again"; "Gemini's
reply didn't make sense — try again". Nothing is written to the document until a reply has been
validated.

## Code layout

| File | Job |
|---|---|
| `js/gemini.js` | The client: `askGemini({ keys, system, prompt, fetch, timers, models, timeoutMs })` → parsed JSON. Model fallback, 400 retry, 429 handling, fences, timeout. Injectable fetch and timers. |
| `js/coach.js` | Pure: `coachContext(doc, today)`, `weekStats(doc, monday)`, the four prompt builders, the four reply parsers. |
| `js/doc.js`, `js/data.js` | `journal` map; the new store methods; the two new settings. |
| `js/ui/coach.js` | The Coach panel and the "Shape with AI" box. |
| `js/ui/side.js` | Hosts the Coach panel first; suggested-goal preview; plan accept/dismiss. |
| `js/ui/today.js` | Suggestion rows show "for Sat" when dated after today. |
| `js/ui/settings.js`, `js/app.js` | The key and check-in-hour settings; the digest trigger; the local fake. |
| `dev/fake-gemini.js` | Canned replies for local testing, used only on localhost with `?fakegemini`. |

## Testing

- **Unit (Node):** the client against a fake fetch — lite first, fallback to flash, 400 → plain
  retry, 429 short wait vs next model vs "used up", timeout, fences, bad JSON; the context
  builder (contains real titles and numbers, stays under a size cap); every parser (sanitising,
  caps, rejects nonsense); `weekStats`; store `addPlan` / `acceptGoalPlan` / `dismissGoalPlan` /
  `saveJournal`; merge keeps `journal`.
- **Browser (controller):** every panel state, driven by `dev/fake-gemini.js` on localhost, so
  checking never spends George's quota or needs his key.

## Out of scope

The Claude connector (piece 3), the Hebrew auto-tick (piece 2), notifications, voice.
