# Gemini Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build piece 5 of the dashboard — a Gemini coach that shapes a big goal into suggested milestones, habits and weekly targets, runs an evening check-in (questions, then short feedback and at most two suggested tasks for tomorrow), and writes a weekly digest that is stored in the synced document.

**Architecture:** Two new pure modules, both unit-tested under Node: `js/gemini.js` (the HTTP client, with model fallback, retries, timeout and plain-English errors; fetch and timers are injected) and `js/coach.js` (the context block, week stats, the four prompt builders, the four reply parsers, and small readers for the panel). The store gains a `journal` map and four methods. A thin browser layer (`js/ui/coach.js`) draws the Coach panel and the "Shape with AI" box. `dev/fake-gemini.js` stands in for Google on localhost so every panel state can be checked without a key.

**Tech Stack:** HTML, CSS, JavaScript ES modules. Node 24's built-in `node:test`. No npm dependencies, no build step, no framework. `python -m http.server 8080` to serve locally.

**Spec:** [`docs/superpowers/specs/2026-09-11-gemini-coach-design.md`](../specs/2026-09-11-gemini-coach-design.md) — read it before starting any task. The core hub plan ([`2026-09-10-core-hub.md`](2026-09-10-core-hub.md)) describes the code this builds on.

## Global Constraints

Standing project rules:

- No build step, no framework, **no npm dependencies** (not even dev ones).
- Test command, from the repo root: `npm test` (runs `node --test tests/*.test.js`). Every task ends with the whole suite passing.
- Nothing is ever hard-deleted — archive, dismiss, or tombstone. Suggestions are `status: 'suggested'`; ✕ makes them `'dismissed'`.
- Work on the branch **`gemini-coach`**. Commit after every task. Every commit message ends with a blank line and then `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Never** `git push`. Never create or modify GitHub repos.
- **Never use George's real Gemini key or spend his quota.** Unit tests use a fake fetch and fake timers only. Browser checks use `dev/fake-gemini.js` (`http://localhost:8080/?fakegemini`). Never read, print or log the values of `dash_settings.geminiKey`, `hvr_geminikey` or `hvr_geminikey2`.
- `js/gemini.js` never puts the key in an error message, a log line, or anything it throws. The key appears only in the request URL.
- Nothing is written to the document until a Gemini reply has been validated by its parser.
- Never blocks, never a dialog: every failure is shown inline, in the Coach panel or the shaping box.

Binding values from the design (copied verbatim; do not change them):

- **Models and order:** "`gemini-flash-lite-latest` first (≈500 requests/day), then `gemini-flash-latest` (≈20/day). Lite-first is deliberate: the Hebrew app shares the same key and depends on the scarce Flash pool; the dashboard should not eat it. Always the `-latest` aliases."
- **Endpoint:** "`POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}` with `systemInstruction`, `contents`, and `generationConfig: { responseMimeType: 'application/json', temperature: 0.6 }`. **No thinking config**."
- **400:** "HTTP 400 → retry the same model once with a plain body (system text prepended to the prompt, no generationConfig)".
- **429:** "HTTP 429 with "retry in Ns" where N ≤ 20 → wait N s and retry the same model once. Any other 429 → next model. All models refused with 429 → "Gemini's free limit is used up for today"."
- **5xx / network / timeout:** "5xx, network error, or 30 s timeout → next model."
- **Reply:** "`candidates[0].content.parts[*].text` joined; strip ```json fences; `JSON.parse`."
- **Key lookup order** (all device-local, never synced): "1. `dash_settings.geminiKey` … 2. `localStorage.hvr_geminikey`, then `hvr_geminikey2` — the Hebrew app's keys."
- **Settings:** "Settings gain `geminiKey` (default `''`) and `checkinHour` (default 18, 12–23)."
- **Journal:** "A new top-level map **`journal`**, added to `MAPS`". Records carry the common fields plus:

  | Field | Check-in | Digest |
  |---|---|---|
  | `id` | `checkin:<day>` | `digest:<Monday of that week>` |
  | `kind` | `'checkin'` | `'digest'` |
  | `day` | the logical day | the week's Monday |
  | content | `questions[]`, `answers[]`, `feedback`, `tomorrowIds[]` | `summary`, `wins[]`, `slipped[]`, `focus` |
  | `model` | which model answered | same |

- **Goal shaping writes:** "a goal (`suggested`, `source: 'gemini'`), its milestones (`suggested`), and habits/targets as items (`suggested`, `source: 'gemini'`, `goalId` = the new goal). Tomorrow's tasks: task items dated tomorrow, `suggested`, `source: 'gemini'`."
- **Validation:** "strings trimmed; titles capped at 80 characters, feedback 900, summary 1200; arrays capped at the stated counts; unknown fields dropped; a repeat that isn't one of the three allowed kinds becomes `daily`; `targetDate` kept only if it's a valid `YYYY-MM-DD` on or after today; `target` must be a positive number (minutes for time targets — the prompt asks for minutes)." Stated counts: questions 3, tomorrow 2, milestones 6, habits 2, targets 2, wins 3, slipped 3.
- **Messages** (inline): "no key; offline; "Gemini's free limit is used up for today — try tomorrow"; "Gemini didn't answer — try again"; "Gemini's reply didn't make sense — try again"." No-key line: "The coach needs a Gemini key. Add one in ⚙, or save one in the Hebrew app on this device."
- **Privacy line in ⚙:** "Check-ins and goal shaping send a summary of your list to Google. On Google's free tier they may use it to improve their products."
- **Fake:** "`dev/fake-gemini.js` | Canned replies for local testing, used only on localhost with `?fakegemini`."
- **Cost per day:** "a check-in is 2 requests, shaping a goal 1, the digest 1 a week."

## Decisions this plan makes (where the design was silent or ambiguous)

- `askGemini` resolves `{ data, model }`, not bare JSON, so journal records can store `model`.
- Several keys: lite is tried on every key before Flash on any key (model-major, as the Hebrew app does), so lite-first holds across keys.
- A key Google refuses outright (401, 403, or 400 "API key not valid") is skipped from then on, with no plain retry. If every key is refused: "Gemini refused the key — check it in ⚙".
- If every attempt failed with a network error: "Can't reach Gemini — check you're online and try again". Mixed failures (including timeouts): "Gemini didn't answer — try again".
- A 200 whose text isn't JSON fails at once with "didn't make sense" — no fallback, since the quota was already spent.
- The 429 wait is `Math.ceil(N × 1000)` ms, through the injected timers.
- Journal records have `source: 'gemini'`. `saveJournal` derives the id from `kind` + `day`, and on an existing record overwrites only the content fields it is given, so saving answers keeps the questions.
- `addPlan` also takes tomorrow's `tasks`. Finishing a check-in is `addPlan({ tasks })` and then `saveJournal({ …, tomorrowIds })`, which makes two commits.
- A shaped goal keeps Gemini's `why` sentence on the goal record (`why`), for the preview card.
- "Recent check-ins (last 3 days)" means the three days before today. Today's answers go in job B's Q/A block.
- The context block is capped at 4000 characters: at most 25 rows, 10 targets and 8 goals, with titles clipped.
- Caps the design doesn't give: questions 300 characters, `why` and `focus` 300, `unitLabel` 40. A `weekdays` repeat keeps only days 1–7 (none left → daily). A `perWeek` `n` is clamped to 1–7. A target whose unit isn't `count` or `minutes` is dropped; a missing unit means `count`.
- The shaping prompt adds three lines before the verbatim job text: today's ISO date, the titles already tracked, and "Days of the week are numbered 1 (Monday) to 7 (Sunday). Time targets are in minutes."
- Hours before the day starts count as late evening: at 01:00 the check-in is still due for the logical day.
- **Digest trigger.** The design's test ("the current week's Monday is after the Monday of the most recent digest") would stay true once last week's digest exists. The plan reads it as "no digest yet for last week's Monday, and last week wasn't empty" (`digestDue`). The trigger runs after each sync pass (on open and on focus), so a digest another device already wrote is pulled first. It runs at most once per session. A page left open across Monday counts as a new session for this: `digestTried` is cleared when the logical day rolls into a new week, because the laptop keeps the page open for days.
- Fake modes: `?fakegemini=<mode>` picks a failure to show. In fake mode the real keys are never used. Any unknown mode behaves like `ok`. The panel heading shows `fake · <mode>`, so a fake page can't be mistaken for the real thing.
- `dismissGoalPlan` leaves any item already accepted from the plan alone (it keeps its `goalId`).
- ✓ / ✕ on *every* suggested goal card use `acceptGoalPlan` / `dismissGoalPlan`, not only on Gemini's. On a goal with no plan behind it they do exactly what `acceptSuggestion` / `dismissSuggestion` did.
- Re-renders while typing: the render loop replaces `#side` wholesale. Typed text lives in `ui.coach`, and `renderSide` puts focus and the caret back into the box marked `data-focus` it was in. The existing `canRun()` / `typing()` hold-back already covers the new textareas, since they are in `#side`.
- A new logical day clears the check-in's page state (`answers`, `notNow`, `error`, and `feedbackOpen` back to true), so yesterday's typing can't prefill today's questions.
- The ⚙ Gemini key field gets its value through the input's `value` property, never an attribute, so the key is never in the page's markup. The note says only whether a Hebrew-app key exists.
- Check-in hour: the number field's `min`/`max`/`step` stop 11, 24 and 12.5 with the browser's own bubble first (as for the day start); the plan's message covers what gets past that (an empty box).
- The Browser pane refuses service-worker registration ("An unknown error occurred when fetching the script"), so browser checks treat that console error as expected. Task 8 checks `sw.js`'s list with a Node one-liner as well.

## File map

| File | Responsibility | Task |
|---|---|---|
| `js/doc.js` | `journal` in `MAPS`, `emptyDoc`, `isDoc`; `journalId` | 1 |
| `js/data.js` | The new settings defaults; `build`/`create` split; `saveJournal`, `addPlan`, `acceptGoalPlan`, `dismissGoalPlan` | 1 |
| `js/merge.js` | Comment only (known maps now come from `MAPS`) | 1 |
| `tests/helpers.js` | `fixture()` takes `journal` records | 1 |
| `tests/journal.test.js` | Store, settings and doc tests for the journal and plans | 1 |
| `tests/data.test.js`, `tests/merge.test.js`, `tests/sync.test.js` | Key list updated; journal merge and sync tests added | 1 |
| `js/gemini.js`, `tests/gemini.test.js` | The Gemini client and key lookup | 2 |
| `js/coach.js`, `tests/coach-context.test.js` | Context block, week stats, panel readers | 3 |
| `js/coach.js`, `tests/coach-prompts.test.js` | Prompt builders and reply parsers | 4 |
| `js/ui/coach.js` | The Coach panel, check-in flow | 5 |
| `dev/fake-gemini.js`, `tests/fake-gemini.test.js` | Canned Gemini for localhost `?fakegemini`; a Node test that every canned reply passes its parser | 5 |
| `js/app.js` | `ui.coach`, `ctx.coach`, the fake switch, the check-in-hour repaint, the rollover reset | 5 |
| `js/ui/side.js` | Coach panel first in the right column; focus kept across re-renders | 5 |
| `js/dates.js`, `tests/dates.test.js` | `hourLabel` (Task 5), `forLabel` (Task 6) | 5, 6 |
| `styles.css` | Coach panel, shaping box, plan card and digest styles | 5, 6, 7 |
| `index.html` | The side column's label | 5 |
| `js/coach.js`, `tests/coach-proposals.test.js` | `proposalLine` for the suggested-goal card | 6 |
| `js/ui/coach.js`, `js/ui/side.js` | "Shape with AI" box; suggested-goal preview; plan accept and dismiss | 6 |
| `js/ui/today.js` | "for Sat" on suggestions dated after today | 6 |
| `js/ui/coach.js`, `js/app.js` | Digest display, "Write last week's digest", background trigger | 7 |
| `js/ui/settings.js` | Gemini key field (with Hebrew-app key detection), check-in hour, privacy note | 8 |
| `sw.js` | New files in the offline shell; cache version bump | 8 |
| `README.md` | "The coach" section; build table; data line; roadmap | 8 |

## Tasks

Each task lives in its own file under [`2026-09-11-gemini-coach/`](2026-09-11-gemini-coach/). Tick here when a task is committed.

- [x] [Task 1: Journal map, settings and store methods](2026-09-11-gemini-coach/task-01-journal-store.md) — the `journal` map, `geminiKey` `''` and `checkinHour` 18 in settings, and the store methods `saveJournal(record)`, `addPlan(plan)`, `acceptGoalPlan(goalId)`, `dismissGoalPlan(goalId)`
- [x] [Task 2: Gemini client](2026-09-11-gemini-coach/task-02-gemini-client.md) — `js/gemini.js`: `askGemini(...)`, following every rule in the design, plus key lookup
- [x] [Task 3: Coach context and week stats](2026-09-11-gemini-coach/task-03-coach-context.md) — `js/coach.js`: `coachContext(doc, today)`, `weekStats(doc, monday)` and the panel readers
- [x] [Task 4: Prompts and reply parsers](2026-09-11-gemini-coach/task-04-prompts-parsers.md) — the prompt builders for jobs A–D and the four reply parsers, in `js/coach.js`
- [x] [Task 5: Coach panel and evening check-in](2026-09-11-gemini-coach/task-05-coach-panel.md) — the Coach panel's check-in states, `dev/fake-gemini.js`, and the wiring in `app.js` and `side.js`
- [x] [Task 6: Shape a goal](2026-09-11-gemini-coach/task-06-shape-goal.md) — the "Shape with AI" box, the suggested-goal preview, plan accept and dismiss, and the "for Sat" marker
- [x] [Task 7: Weekly digest](2026-09-11-gemini-coach/task-07-weekly-digest.md) — the digest trigger and how the digest is shown
- [x] [Task 8: Settings, offline shell, README](2026-09-11-gemini-coach/task-08-settings-sw-readme.md) — the ⚙ key field (with Hebrew-app key detection), the check-in hour, the privacy note, the `sw.js` SHELL update, and the README section

Tasks 1–4 are pure and run in order (4 builds on 3, 3 on 1). Tasks 5–8 are browser work. After each of them the controller checks it in the Browser pane: serve with `python -m http.server 8080`, open `http://localhost:8080/dev/seed.html?replace`, then `http://localhost:8080/?fakegemini` (and the other fake modes).

## Shared interfaces (the contract between tasks)

Tasks 5–8 are written from this section. Everything listed under Tasks 1–4 exists exactly as shown once those tasks are committed.

```js
// ---- js/doc.js (Task 1) ------------------------------------------------------------------------
MAPS = ['items', 'goals', 'milestones', 'logs', 'journal']
emptyDoc(): { schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {} }
isDoc(value): boolean          // journal may be absent (a document from before the coach); if present it must be a plain object
journalId(kind: 'checkin'|'digest', day: string): string    // 'checkin:2026-09-11' · 'digest:2026-09-07'

// ---- js/data.js (Task 1) -----------------------------------------------------------------------
DEFAULT_SETTINGS = { token: '', repo: '', dayStartHour: 4, geminiKey: '', checkinHour: 18 }
Store gains:
  saveJournal(record): JournalRecord
    // record = { kind: 'checkin'|'digest', day, ...content }. The id is journalId(kind, day); a given
    // `id` must match it. Creates the record (source 'gemini', empty content filled in) or overwrites
    // only the content fields given on the existing one. Content is deep-copied. Unknown fields are
    // dropped. One commit ('local'). Throws on an unknown kind, a day that isn't a real YYYY-MM-DD,
    // or a digest day that isn't a Monday.
  addPlan({ goal?, milestones?, habits?, targets?, tasks? }): { goal: Goal|null, milestones: Milestone[], items: Item[] }
    // goal:       { title, targetDate?: day|null, why?: string }  → goal, status 'suggested', source 'gemini', target null
    // milestones: string[] (titles; need a goal)                   → status 'suggested', source 'gemini', goalId = the new goal
    // habits:     { title, repeat }[]                              → habit items, 'suggested', 'gemini', goalId = the new goal (or null)
    // targets:    { title, target, unit, unitLabel }[]             → quota items, 'suggested', 'gemini', goalId = the new goal (or null)
    // tasks:      { title, date }[]                                → task items on `date`, 'suggested', 'gemini', goalId null
    // Everything is validated before anything is written (throws with the store's usual messages);
    // one commit. An empty plan writes nothing and returns { goal: null, milestones: [], items: [] }.
    // Feed it parseShape's output as { goal: { title, targetDate, why }, milestones, habits, targets }.
  acceptGoalPlan(goalId): Goal   // goal + its still-'suggested' milestones → 'active', created today; linked items untouched. One commit.
  dismissGoalPlan(goalId): void  // goal + its still-'suggested' milestones + still-'suggested' items with that goalId → 'dismissed'. One commit.
  // both throw `No goals record <id>` for an unknown id
JournalRecord = common fields (id, source 'gemini', status 'active', created, archivedOn null, updated)
              + { kind, day, model: string }
              + checkin: { questions: string[], answers: string[], feedback: string, tomorrowIds: string[] }
              | digest:  { summary: string, wins: string[], slipped: string[], focus: string }

// ---- js/gemini.js (Task 2) ---------------------------------------------------------------------
MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest']
ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
TIMEOUT_MS = 30000; MAX_WAIT_S = 20; HEBREW_KEY_NAMES = ['hvr_geminikey', 'hvr_geminikey2']
MESSAGES = {
  nokey:    'The coach needs a Gemini key. Add one in ⚙, or save one in the Hebrew app on this device.',
  offline:  "Can't reach Gemini — check you're online and try again",
  quota:    "Gemini's free limit is used up for today — try tomorrow",
  badkey:   'Gemini refused the key — check it in ⚙',
  failed:   "Gemini didn't answer — try again",
  nonsense: "Gemini's reply didn't make sense — try again",
}
class GeminiError extends Error { code: keyof MESSAGES }   // new GeminiError(code); message = MESSAGES[code]; unknown code → 'failed'
askGemini({ keys, system, prompt, fetch?, timers?, models = MODELS, timeoutMs = 30000 }): Promise<{ data, model }>
  // keys: string[] (blank and repeated ones ignored; none → GeminiError 'nokey', no request made).
  // fetch defaults to globalThis.fetch; timers ({ setTimeout, clearTimeout }) default to globalThis.
  // Tries model-major: models[0] on each key, then models[1] on each key. Per attempt: 200 → parse and
  // return; key refused (401/403/400 "API key not valid") → skip that key from then on; 400 → once more
  // with the plain body; 429 "retry in N s", N ≤ 20 → wait, once more; other 429, 5xx, other status,
  // network error, timeout → next attempt. A 200 that isn't JSON → GeminiError 'nonsense' at once.
  // All failed → GeminiError: all refused 'badkey'; else (ignoring refusals) all 429 'quota', all
  // network 'offline', otherwise 'failed'. `data` is whatever JSON the reply held — run it through a parser.
readReply(bodyText): any                 // the JSON in a 200 body; throws GeminiError 'nonsense'
retryAfterSeconds(text): number | null   // from "retry in 12.5s"
hebrewKeys(storage): string[]            // trimmed, non-empty values of hvr_geminikey, hvr_geminikey2
geminiKeys(settings, storage): string[]  // [settings.geminiKey, ...hebrewKeys(storage)], trimmed, deduped

// ---- js/coach.js (Task 3) ----------------------------------------------------------------------
CONTEXT_CAP = 4000
clip(text, n): string                    // one line, whitespace collapsed, ≤ n chars, '…' where cut
coachContext(doc, today): string         // the context block (≤ CONTEXT_CAP), e.g.
  // Today: Friday 11 September 2026
  // Today's list:
  // ✓ Hebrew practice [Hebrew] — 6-day streak
  // ✗ Email Sarah [Job] — carried from Wed
  // This week's targets:
  // Job search: 3.5h of 6h
  // Applications: 3 of 5
  // Last 7 days: Fri 1/2 · Thu 1/2 · Wed 1/2 · Tue 1/1 · Mon 1/1 · Sun 1/1 · Sat 0/1
  // Goals:
  // Land an analyst role — 33%, target 10 Nov; next: Five applications sent, First interview
  // Recent check-ins (his answers):
  // Thu: Sent two applications / Start earlier
weekStats(doc, monday): {                // any day of the week works; it is normalised to its Monday
  monday, sunday,                        // 'YYYY-MM-DD'
  days: { day, done, total }[7],         // counted rows per day, Monday first
  habits: { id, title, done, scheduled }[],   // due days and ticks; perWeek habits: ticks of n
  tasks: { done, total },                // distinct tasks on the list that week; done = ticked that week
  targets: { id, title, total, target, unit, unitLabel }[],   // quotas counted that week
  goals: { id, title, pct, done, total, numeric, unit, week }[],  // active goals; week = amounts logged to it that week
  amounts: number,                       // active amount logs in the week
  empty: boolean,                        // no counted rows on any day and no amounts
}
checkinOf(doc, day): JournalRecord | null       // the active check-in for that day
digestOf(doc, monday): JournalRecord | null     // the active digest for that day's week
digestDue(doc, today): string | null            // last week's Monday if it has no digest and wasn't empty
checkinState({ doc, today, now: Date, dayStartHour = 4, checkinHour = 18, hasKey }):
  'done' | 'nokey' | 'questions' | 'due' | 'early'   // in that precedence; hours < dayStartHour count as 24+
proposedItems(doc, goalId): Item[]              // items linked to the goal that are still 'suggested', by order

// ---- js/coach.js (Task 4) ----------------------------------------------------------------------
SYSTEM: string                           // the design's system instruction, verbatim
JOBS = { questions, feedback, shape, digest }   // the design's four job texts, verbatim
questionsPrompt(doc, today): { system, prompt }                       // job A
feedbackPrompt(doc, today, questions, answers): { system, prompt }    // job B; blank answer → '(no answer)'
shapePrompt(doc, today, text): { system, prompt }                     // job C
digestPrompt(doc, monday): { system, prompt }                         // job D
parseQuestions(data): { questions: string[] }                         // 1–3, each ≤ 300
parseFeedback(data): { feedback: string, tomorrow: { title }[] }      // ≤ 900; 0–2 titles ≤ 80
parseShape(data, today): { title, targetDate: day|null, milestones: string[], habits: { title, repeat }[],
                          targets: { title, target, unit: 'count'|'minutes', unitLabel }[], why: string }
parseDigest(data): { summary, wins: string[], slipped: string[], focus }
// every parser throws GeminiError('nonsense') for anything unusable

// ---- js/coach.js (Task 6) ----------------------------------------------------------------------
proposalLine(item): string               // 'Habit: Stretch · Mon, Wed, Fri' · 'Habit: Walk · 3 times a week' ·
                                         // 'Habit: Read · every day' · 'Weekly target: Running · 1.5h' · 'Weekly target: Parkruns · 2 runs'

// ---- js/dates.js (Tasks 5 and 6) ---------------------------------------------------------------
hourLabel(hour: 0..23): string           // Task 5: 18 → '6pm', 12 → '12pm', 23 → '11pm', 0 → '12am', 9 → '9am'
forLabel(day, today): string             // Task 6: 'for Sat' when day is 1–6 days after today, else 'for 3 Oct'

// ---- js/app.js (Task 5) ------------------------------------------------------------------------
// The fake switch, worked out once at boot:
FAKE = (['localhost', '127.0.0.1'].includes(location.hostname) && params.has('fakegemini'))
  ? (params.get('fakegemini') || 'ok') : null        // params = new URLSearchParams(location.search)
ctx.coach = {
  fake: FAKE,                                        // null in real use
  keys(): string[],   // FAKE ? (FAKE === 'nokey' ? [] : ['fake-key']) : geminiKeys(store.settings(), localStorage)
  ask({ system, prompt }): Promise<{ data, model }>,
    // askGemini({ keys: keys(), system, prompt, fetch }), where fetch is
    // (await import('../dev/fake-gemini.js')).fakeGeminiFetch(FAKE) in fake mode, else left to its default.
    // The fake module is only ever imported in fake mode.
}
ui.coach = {        // page-only state; Task 5 adds the whole object to the `ui` literal
  busy: '',          // '' | 'questions' | 'feedback' — a check-in request in flight            (Task 5)
  error: '',         // the check-in's last error message                                       (Task 5)
  answers: [],       // typed answers by question index; kept here so a re-render never loses them (Task 5)
  notNow: '',        // the day "Not now" was pressed; that day the questions fold to one line  (Task 5)
  feedbackOpen: true,                                   // today's feedback <details> is open    (Task 5)
  shapeOpen: false, shapeText: '', shapeBusy: false, shapeError: '',                             // (Task 6)
  digestOpen: false, digestBusy: false, digestError: '', digestTried: false,                     // (Task 7)
}
// Once a minute (the existing interval), after checkRollover(): if checkinNow(ctx) differs from the
// last one rendered and typing() is false, render() — so the button appears at the check-in hour.
// checkRollover() on a new day also resets ui.coach's answers, notNow, error and feedbackOpen (Task 5),
// and on a new week digestTried, digestError and digestOpen (Task 7).

// ---- js/ui/side.js (Task 5) --------------------------------------------------------------------
// renderSide: [renderCoach, renderWeek, renderGoals, renderHistory]. Before replacing #side it notes
// the focused element's data-focus key and caret; afterwards it focuses the new element with that key
// and restores the caret. The check-in answers ('coach-answer-<i>') and the shaping box ('coach-shape')
// carry data-focus.

// ---- js/ui/coach.js (Tasks 5–7) ----------------------------------------------------------------
renderCoach(ctx): HTMLElement            // <section class="panel coach"><h2>Coach</h2>…; first child of #side (Task 5)
checkinNow(ctx): string                  // Task 5: checkinState(...) for now, from store settings and ctx.coach.keys()
startCheckin(ctx): Promise<void>         // Task 5
sendCheckin(ctx): Promise<void>          // Task 5
renderShapeBox(ctx): HTMLElement | null  // Task 6; null unless ui.coach.shapeOpen
shapeGoal(ctx, text): Promise<void>      // Task 6
writeDigest(ctx, { quiet = false } = {}): Promise<void>   // Task 7
// Every flow: no keys → show MESSAGES.nokey; navigator.onLine === false → show MESSAGES.offline;
// otherwise ask, parse, then write. Any error → show e instanceof GeminiError ? e.message : MESSAGES.failed
// (a store error shows its own message). Messages are inline text, never alert().

// ---- dev/fake-gemini.js (Task 5) ---------------------------------------------------------------
FAKE_MODES = ['ok', 'slow', 'nokey', 'quota', 'down', 'offline', 'badkey', 'nonsense']
fakeGeminiFetch(mode = 'ok', { delayMs = mode === 'slow' ? 5000 : 800 } = {}): (url, init) => Promise<{ status, ok, text() }>
  // Waits delayMs (a real setTimeout — dev only; delayMs 0 means no timer at all, which the Node test
  // uses), then, by mode (an unknown mode behaves like ok):
  //   ok, slow → 200 { candidates: [{ content: { parts: [{ text: JSON }] } }] } with a canned reply
  //              for the job whose JOBS text appears in the request's contents text; each reply passes
  //              its parser (questions: 3; feedback + 1 task for tomorrow; shape: a title from
  //              "George wrote: …", 4 milestones, 1 weekdays habit, 1 minutes target, why; digest: summary,
  //              2 wins, 1 slipped, focus)
  //   quota    → 429 'Resource has been exhausted (e.g. check quota).' (no retry hint)
  //   down     → 503 'The model is overloaded.'
  //   offline  → rejects TypeError('Failed to fetch')
  //   badkey   → 400 'API key not valid. Please pass a valid API key.'
  //   nonsense → 200 whose candidate text is 'Happy to help!' (not JSON)
  //   nokey    → never called (ctx.coach.keys() is empty)
```

The flows Tasks 5–7 implement (each captures `today = store.today()` once at the start):

- **Check-in questions** (`startCheckin`): `ui.coach.busy = 'questions'` → `ask(questionsPrompt(doc, today))` → `parseQuestions(data)` → `store.saveJournal({ kind: 'checkin', day: today, questions, answers: [], feedback: '', tomorrowIds: [], model })` → clear `answers`, `notNow` and `error`. Finally `busy = ''` and `render()`.
- **Feedback** (`sendCheckin`): answers = `checkinOf(doc, today).questions.map((_, i) => (ui.coach.answers[i] ?? '').trim())`. If none is filled in, show "Answer at least one question first." Otherwise: `busy = 'feedback'` → `ask(feedbackPrompt(doc, today, questions, answers))` → `parseFeedback(data)` → `const { items } = store.addPlan({ tasks: tomorrow.map((t) => ({ title: t.title, date: addDays(today, 1) })) })` → `store.saveJournal({ kind: 'checkin', day: today, answers, feedback, tomorrowIds: items.map((i) => i.id), model })` → `answers = []`, `feedbackOpen = true`.
- **Shape** (`shapeGoal`): text must not be blank ("Say what you want to achieve first."). `shapeBusy = true` → `ask(shapePrompt(doc, today, text))` → `plan = parseShape(data, today)` → `store.addPlan({ goal: { title: plan.title, targetDate: plan.targetDate, why: plan.why }, milestones: plan.milestones, habits: plan.habits, targets: plan.targets })` → close the box and clear `shapeText`.
- **Digest** (`writeDigest`): `monday = addDays(weekStart(today), -7)` → `digestBusy = true` → `ask(digestPrompt(doc, monday))` → `parseDigest(data)` → `store.saveJournal({ kind: 'digest', day: monday, ...digest, model })`. With `quiet`, a missing key or being offline returns without a word, and a failure is swallowed (the "Write last week's digest" link stays).
- **Digest trigger** (`app.js`): `maybeWriteDigest()` — return if `ui.coach.digestTried`, if `ctx.coach.keys()` is empty, if `navigator.onLine === false`, or if `digestDue(store.doc(), store.today())` is null. Otherwise set `digestTried = true` and call `writeDigest(ctx, { quiet: true })`. The sync scheduler's `run` becomes `async () => { await runSync(); maybeWriteDigest(); }`, so it fires on open and on focus, after the pull. `checkRollover()` clears `digestTried` when the logical day moves into a new week.
- **Panel states** (`renderCoach`): while `busy` → "Thinking…". Otherwise by `checkinState({ doc, today, now: new Date(), dayStartHour, checkinHour, hasKey: ctx.coach.keys().length > 0 })`:
  - `nokey` → the no-key line.
  - `early` → "Evening check-in from {hourLabel(checkinHour)} · " plus a *check in now* link.
  - `due` → a primary button, "Start today's check-in".
  - `questions` → each question with a two-row textarea, then **Send** and *Not now*. When `notNow === today`, this folds to "Today's check-in is waiting · answer now".
  - `done` → `<details>` "Today's check-in", open unless `feedbackOpen` is false, holding the feedback, and "A task for tomorrow waits at the top of the list." (or "2 tasks …") while any of `tomorrowIds` is still a suggestion.
  - Under any state: `error`. Then (Task 7) the "Last week" `<details>` if `digestOf(doc, lastMonday)` exists; otherwise, when there are keys and `digestDue` is set, the *Write last week's digest* link ("Writing last week's digest…" while busy) and `digestError`.
  - The "Last week" body (Task 7): the summary; "Went well: " + wins joined by " · "; "Slipped: " + slipped joined by " · " (each line only if the list isn't empty); "This week: " + focus. `digestOpen` remembers whether it is open.
- **Goals heading and shape box** (Task 6, `side.js` + `js/ui/coach.js`): a *Shape with AI* link sits before *+ goal* and toggles `ui.coach.shapeOpen`. `renderShapeBox(ctx)` goes straight under the heading: a textarea (placeholder "What do you want to achieve?", value `ui.coach.shapeText`, updated on input), a **Shape** button ("Shaping…" and disabled while `shapeBusy`), a *Cancel* link (closes the box and keeps the text), and the `shapeError` line.
- **Suggested-goal card** (Task 6, `side.js`, `renderSuggestedGoal`, called from the `goal.status === 'suggested'` branch of `renderGoal`): the title, then ✓ → `store.acceptGoalPlan(goal.id)` and ✕ → `store.dismissGoalPlan(goal.id)`. Below that, "suggested by Gemini", the `why` sentence, and "Target: 10 Nov" when there's a target date. Then the proposed milestones (`milestonesOf(doc, goal.id)` still `'suggested'`) as a numbered list, and `proposedItems(doc, goal.id)` through `proposalLine`: "Habit: Stretch · Mon, Wed, Fri" / "Habit: Walk · 3 times a week" / "Habit: Read · every day" / "Weekly target: Running · 1.5h" (`formatAmount(target, unit)`, plus ` ${unitLabel}` for count). If there are any, add the note "Habits and targets also wait at the top of Today."
- **"for Sat"** (Task 6, `today.js`): `renderSuggestion` adds `h('span', { class: 'for' }, forLabel(item.date, today))` to its meta when `item.type === 'task' && item.date > today`.
- **Settings** (Task 8, `settings.js`). After the day-start note come:
  - a "Gemini API key (optional)" password input (`name: 'geminiKey'`, `autocomplete: 'off'`, `spellcheck: 'false'`), whose `value` *property* is set to `s.geminiKey` (never an attribute, so the key is not in the markup);
  - the note "Leave blank to use the Hebrew app's key on this device.", followed by " One was found here." when `hebrewKeys(localStorage).length` and " None was found here." otherwise — never the key itself;
  - an "Evening check-in from (hour, 12–23)" number input (`name: 'checkinHour'`, min 12, max 23, step 1);
  - the privacy line, verbatim.

  Save checks the hour ("The check-in hour must be a whole hour from 12 to 23.") and adds `geminiKey: geminiKey.value.trim(), checkinHour` to `updateSettings`.
- **Offline shell** (Task 8, `sw.js`): `CACHE = 'dash-v2'`; `SHELL` gains `'js/gemini.js', 'js/coach.js', 'js/ui/coach.js'`. `dev/fake-gemini.js` stays out.
- **README** (Task 8): a "## The coach (Gemini)" section covering:
  - what it does: shape a goal, the evening check-in, the weekly digest;
  - where the key comes from: the Hebrew app's key on the same device, or ⚙;
  - lite first and what a day costs;
  - the privacy line;
  - local testing with `?fakegemini` and its modes.

  Also add `js/gemini.js` and `js/coach.js` to the "How it's built" table, add `journal` to the data line, and mark roadmap item 5 as built.
