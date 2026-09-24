# The Coach's Mind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Coach that notices what happens — ticks, pushes, moved blocks, new calendar events, the
debriefs behind finished work — reacts through Gemini within minutes, thinks deeply twice a day (and
when needed) through a Claude routine, keeps a standing picture of George, proposes plan changes, and
reaches his phone and watch with Web Push.

**Architecture:** The Apps Script planner gains Senses (plain code over the document, the calendar
events it already fetches, and Drive), Reflex chains (Gemini, parallel via `UrlFetchApp.fetchAll`),
openers, a routine trigger and a Web Push sender (hand-written P-256 and AES-GCM, since Apps Script
has neither). Its memory is a new `mind.json` in `dashboard-sync`. The Claude tool gains a `mind`
context pack, a restricted `--mind` apply mode and a `--config env` for cloud routines. The page shows
Mind conversations, gains `think_deeper`, a Notifications line, and push handling in `sw.js`.

**Tech Stack:** Plain ES modules, Node 24 `node:test`, `node:crypto` (tests only), Google Apps Script
V8 (UrlFetchApp, DriveApp, Utilities), Gemini REST, Claude Code routines, Web Push (RFC 8291/8292).

**Spec:** [`docs/superpowers/specs/2026-09-25-coach-mind-design.md`](../specs/2026-09-25-coach-mind-design.md).

## Global Constraints

- No npm dependencies, not even dev ones. `npm test` = `node --test tests/*.test.js` (701 tests before
  this plan; 700 pass — `schedule-perf` "history + todayRows…" is timing-flaky under full-suite load
  and passes alone; that is the only accepted failure).
- Everything under `planner/` except `bundle.mjs`/`build.mjs` is bundled for Apps Script: named
  relative imports only, `export function|const|let|class` only, no `node:` imports, no top-level code
  touching Apps Script globals except `planner/entry.js`. Anything `planner/` imports from `js/`
  follows the same rules.
- Apps Script V8 has no `URL`, no `setTimeout`, no WebCrypto; `fetch` is the planner's shim.
- Nothing is hard-deleted from `data.json`; archive instead.
- No new journal *kind* and no new top-level map in `data.json` (old devices would reject the whole
  document). New records live in the `calendar` map or are `talk` records.
- Branch `coach-mind`. Commit after each task; messages end with a blank line and
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push without George's go-ahead.
- Any commit touching a file in `sw.js`'s `SHELL` runs `npm run build` first and commits
  `release.json` and `planner/planner.js` with it.
- Never print a real key or token. Tests use dummy keys. `scrubText` covers every new secret
  (`MIND_ROUTINE_TOKEN`, `VAPID_PRIVATE`).
- Every planner test file sets `process.env.TZ = 'Europe/London'` first.
- British English in everything George or Claude reads.

Values fixed by the spec (verbatim):

- Caps: "at most 6 pings and 8 unprompted Mind messages a day, a 45-minute gap between unprompted
  messages unless one is urgent … Gemini calls are capped at 120 a day … Claude: 2 scheduled runs plus
  at most 3 triggered a day".
- Config defaults: `{ enabled, morningAt: '07:00', checkinAt: '18:00', quietFrom: '22:30', quietUntil:
  '07:00', pingsPerDay: 6, messagesPerDay: 8, gapMinutes: 45, geminiPerDay: 120, deepPerDay: 3,
  models: { think, check } }` with `think = 'gemini-flash-latest'`, `check = 'gemini-flash-lite-latest'`,
  `enabled: false` until Claude switches it on.
- "The Mind … stops starting Gemini chains once the run has used 150 seconds".
- Picture "≤ 4,000 characters", given to the Voice "clipped to 3,000"; messages "at most 600
  characters"; artefacts "12,000 characters per event"; calendar descriptions "clipped to 600".
- mind.json: "Events and runs older than 14 days are dropped … events keep at most 300"; "a run with
  no cursor records a baseline and no events".
- Levels, delays, grouping: "level 3, and at level 2 once they are 20 minutes old … at most two chains
  per run".
- Openers: morning "first run at or after `morningAt` (07:00) and outside quiet hours"; evening "first
  run after `checkinAt` (18:00)"; the page's fallback when not `mindAlive` (enabled and
  `mind:status.lastRun` under 75 minutes old).
- Push: payload `{ title: 'Coach', body (≤ 140 chars), url: './?coach=<talkId>', tag: talkId }`,
  `aes128gcm`, ES256 JWT with a 12-hour expiry, `TTL: 43200`, `Urgency: normal`; 404/410 archive the
  subscription; other failures retried on the next two runs.
- Routine fire: `POST MIND_ROUTINE_URL` with `Authorization: Bearer MIND_ROUTINE_TOKEN`,
  `anthropic-beta: experimental-cc-routine-2026-04-01`, `anthropic-version: 2023-06-01`, body
  `{ "text": … }`; "never while a fire is outstanding (40 minutes, or until a deep run is recorded)".

## Decisions this plan makes

- **Event ids are deterministic** so re-sensing after a failed save produces the same ids:
  `tick:<logId>`, `untick:<logId>`, `pushed:<itemId>:<newDate>`, `dropped:<itemId>`,
  `moved:<itemId>:<date>|<time>`, `slip:<day>:<itemId>`, `overflow:<itemId>:<scheduledDay>`,
  `cal:<calendarId>|<eventId>:<fingerprint hash8>`, `ms:<milestoneId>`, `workout:<logId>`,
  `hebrew:<day>:<n logs>`, `reply:<talkId>:<georgeCount>`, `ask:<askId>`, `flag:<flagId>`,
  `risk:<goalId>:<day>`.
- **Attribution** of an item change: the newest `doc.changes` record with `at` after the cursor's `at`
  whose edits touch `items/<id>` gives its `source` (`calendar` → George in Google Calendar, `coach`,
  `claude`, `workflow`); none → `me` (the app). A log's own `source` attributes ticks.
- **Reflex eligibility:** only events under 3 hours old; older unhandled ones go to the deep run only
  (so switching the Mind on never floods).
- **Openers don't count** against `messagesPerDay` but do count as pings.
- **Mind talks** are written through `store.saveJournal({ kind: 'talk', slot })` with source `mind`
  (planner) or `claude` (tool). The slot regex in `js/data.js` becomes
  `/^(morning|afternoon|evening|own-\d{1,2}|mind-\d{1,3}|deep-\d{1,2})$/`.
- **The push ledger key** of a message is `<talkId>|<message.at>`.
- **VAPID subject** is `https://george-wightman.github.io/dashboard/` (no email address anywhere).
- **Randomness in Apps Script:** SHA-256 over `Utilities.getUuid()` + a counter, chained to the
  length needed.
- **Push send order:** after the planner's final `data.json` sync succeeds (so a pushed message is
  always one the devices can open); `mind.json` is saved only then too, so a failed save re-senses the
  same events next run.
- **The fire text** is `"<reason>: <event ids>"`; the routine reads everything from the repo.

## File map

| File | Responsibility |
| --- | --- |
| `js/mind.js` (new) | data.json Mind records: config, status, picture, asks, push subscriptions, Mind talks/messages, quiet hours, `mindAlive`, `checkMessage` |
| `js/mind-state.js` (new) | mind.json: `emptyMind`, `isMind`, `mergeMind`, `pruneMind`, budget helpers, `saveMind` over a `{get, put}` client |
| `planner/senses.js` (new) | `sense()`: cursor diff → events with attribution and levels; plan risk |
| `planner/drive.js` (new) | Drive paths in notes; artefacts from DriveApp |
| `planner/gemini-gas.js` (new) | Gemini over `UrlFetchApp.fetchAll`: parallel JSON calls, fallback, quota back-off, budget |
| `planner/reflex.js` (new) | grouping, prompts, the chain, openers |
| `planner/p256.js` (new) | P-256: points, ECDH, ECDSA, key generation |
| `planner/aes.js` (new) | AES-128 encryption and GCM |
| `planner/webpush.js` (new) | HKDF, RFC 8291 payload encryption, RFC 8292 VAPID header, request building |
| `planner/mind.js` (new) | the Mind's part of `run()`: load, sense, reflexes, openers, fire, status; `after()`: pushes, save |
| `planner/gas.js`, `planner/entry.js`, `planner/apps-script/appsscript.json` | wiring, secrets, DriveApp, scope |
| `claude/mind.js` (new) | `mindPack`, mind-mode ops (`picture`, `say`, `propose`, `handled`), the `mind` config op |
| `claude/cli.js`, `claude/config.js`, `claude/ops.js`, `claude/skill/reference.md`, `claude/skill/SKILL.md` | `--config env`, `--mind`, `mind` command, docs |
| `claude/mind/ROUTINE.md` (new) | the deep run's instructions |
| `js/data.js`, `js/talk.js`, `js/coach-tools.js`, `js/coach-session.js` | slots, Voice context, `think_deeper`, openers off while the Mind is alive |
| `js/ui/coach.js`, `js/ui/sources.js`, `js/app.js`, `js/ui/settings.js`, `js/ui/claude.js` | Mind talks and marks, `?coach=`, Notifications, Mind status line |
| `js/push-client.js` (new), `sw.js` | subscribe/unsubscribe; push and click handlers |
| `dev/replay-senses.mjs` (new) | replay Senses over two historical `data.json` versions (live check) |
| tests: `mind.test.js`, `mind-state.test.js`, `senses.test.js`, `drive.test.js`, `gemini-gas.test.js`, `reflex.test.js`, `crypto.test.js`, `webpush.test.js`, `planner-mind.test.js`, `claude-mind.test.js`, `coach-mind.test.js`, `push-client.test.js`, plus additions to `sw-runtime.test.js`, `planner-bundle.test.js` | |

---

### Task 1: Mind records and checks (`js/mind.js`, slot regex)

**Files:** Create `js/mind.js`, `tests/mind.test.js`. Modify `js/data.js` (SLOT).

**Interfaces — Produces:**
- `MIND_DEFAULTS` (frozen, values above).
- `mindConfig(doc) → config` — defaults overlaid with valid fields of `calendar['mind:config']`
  (clock fields `HH:MM`, counts positive integers ≤ 1000, `models.think/check` non-empty strings).
- `mindStatus(doc) → record|null`; `picture(doc) → { text, opener, at, by }|null`.
- `mindAlive(doc, now) → boolean` — `enabled` and `Date.parse(status.lastRun) > now − 75 min`.
- `isQuiet(doc, now, dayStartHour = 4) → boolean` — quiet window (crossing midnight), today closed
  (`dayClosed(doc, logicalDay(now))`), or time off with no `areas` covering `now` (hours) or today
  (whole days).
- `MIND_SLOT = /^(mind-\d{1,3}|deep-\d{1,2})$/`; `isMindTalk(t)`; `mindTalks(doc, day)`;
  `nextMindSlot(doc, day, prefix)` → `'mind-1'`…; `isMindMessage(m)` (`m.from === 'mind'`);
  `mindMessages(doc, fromDay) → [{ talkId, day, slot, m }]` sorted by `m.at`; `messageKey(talkId, m)`.
- `openAsks(doc) → records` (active `ask:*`), `nextAskId(doc, day) → 'ask:<day>:<n>'`.
- `pushSubscriptions(doc) → records` (active `push:*` with endpoint, p256dh, auth).
- `checkMessage(doc, { today, now, text, recent = [], georgeToday = [] }) → { ok, problems }`.

**Test cases (write first):**
1. `mindConfig` on an empty doc equals `MIND_DEFAULTS`; with `{ pingsPerDay: 2, quietFrom: '23:00',
   bogus: 1, gapMinutes: -5 }` keeps 2 and 23:00, ignores `bogus`, keeps default 45.
2. `mindAlive`: disabled → false; enabled, lastRun 74 min ago → true; 76 min → false.
3. `isQuiet` at 23:10 and 06:50 → true, 07:00 and 12:00 → false; with `closed:<today>` at 15:00 → true;
   with `off:` hours 07:30–12:00, no areas, at 09:00 → true; same with `areas: ['Job search']` → false;
   at 02:00 with dayStartHour 4 uses the previous logical day's closed flag.
4. `nextMindSlot` returns `mind-1`, then `mind-2` once `talk:<day>:mind-1` exists; `deep-1` separately.
5. `mindMessages` flattens two Mind talks in time order and skips ordinary talks.
6. `checkMessage`: (a) "Nice work finishing Role play 3" when `Role play 3` is on today's list unticked →
   problem naming it; ticked → ok. (b) "See you at 15:45" with no booking/event/George message at
   15:45 → problem; with a block starting 15:45 → ok; with George having written "15:45" → ok. (c) a
   times-a-week habit optional today (per `dayScore(...).optional`) called "missed" → problem.
   (d) 601 characters → problem; emoji → problem. (e) text sharing > 60% of words with a recent
   message → problem. (f) a plain specific question → ok.
7. `saveJournal({ kind: 'talk', slot: 'mind-3' … })` and `deep-2` succeed; `mind-x` throws.

**Steps:** write tests → run (fail) → implement → run `node --test tests/mind.test.js` → full suite →
commit "The Mind's records in the synced file, and the checks every message passes".

### Task 2: `mind.json` (`js/mind-state.js`)

**Files:** Create `js/mind-state.js`, `tests/mind-state.test.js`.

**Interfaces — Produces:**
- `emptyMind() → { schema: 1, cursor: null, events: {}, runs: {}, pushed: {}, fired: [], budget: { day: null, gemini: 0, messages: 0, pings: 0, deep: 0, lastSaid: null, geminiBlocked: false } }`.
- `isMind(v) → boolean` (schema 1, plain objects/arrays in the right places).
- `mergeMind(a, b) → mind` — events union (per id: later `reflex` and later `deep` stamp each, other
  fields from the record with more keys, else `a`); runs union; `pushed` union (earlier stamp);
  `fired` union by `at` sorted; budget: same `day` → field-wise max (and `lastSaid` later,
  `geminiBlocked` or), different days → the later day's; cursor: `a.cursor ?? b.cursor` when
  `a.cursor` is the planner's (callers pass the planner's copy first), and the tool passes
  `{ keepCursor: true }` to take the remote cursor. Signature: `mergeMind(local, remote, { cursorFrom = 'local' } = {})`.
- `pruneMind(m, now) → m` — drop events/runs older than 14 days, keep newest 300 events, clip each
  artefact list to 12,000 characters total, drop `pushed` entries older than 14 days, `fired` older than
  2 days.
- `budget(m, day) → budget` (a fresh one when `day` differs); `spend(m, day, field, n = 1)` mutates.
- `unhandled(m, engine) → events` (`engine` = `'reflex'|'deep'`), oldest first.
- `saveMind({ client, mind, cursorFrom, maxAttempts = 3 }) → { ok, mind, error }` — get, merge,
  skip the put when unchanged (`stableStringify`), put with sha, retry on `ConflictError`.
- `loadMind(client) → { mind, sha, problem }` — invalid or unreadable → `emptyMind()` with `problem`.

**Test cases:** merge takes later stamps and unions (both orders give the same result apart from the
cursor rule); budget max on same day and reset on a new day; prune drops a 15-day-old event and keeps a
13-day-old one, caps 305 events to 300 (newest kept), clips artefacts; `saveMind` retries once on a
409 and merges the other writer's event; unchanged → no put; `loadMind` on garbage → empty with a
problem; `isMind` rejects `{ schema: 2 }`.

**Commit:** "The Mind keeps its own file beside the dashboard's".

### Task 3: Senses (`planner/senses.js`)

**Files:** Create `planner/senses.js`, `tests/senses.test.js`. Uses `js/plan-state.js`,
`js/schedule.js`, `js/calendar.js`, `js/dates.js`, `js/commit.js`, `planner/events.js` (`P`),
`planner/drive.js` (`drivePaths`, Task 4 — do Task 4's `drivePaths` first or stub it in this task and
move it).

**Interfaces — Produces:**
- `sense({ doc, cursor, calEvents = [], now, dayStartHour = 4 }) → { cursor, events }` — `events` is
  an array of `{ id, at, kind, level, by, day, refs: { itemId?, goalId?, milestoneId?, talkId?, askId?,
  calendar? }, text, facts: [string], paths?: [string], reflex: null, deep: null }`.
- `cursorOf(doc, calEvents, now, dayStartHour) → cursor` (exported for tests).
- `planRisk(doc, events, today) → events` (the `risk` events to add).
- Level rules exactly as the spec's table; `text` is one English line
  (`'George ticked "Role play 3 - MILLRACE, timed" (Assessment centre) at 19:23 — via Claude'`);
  `facts` are short strings a prompt can cite (goal title, deadline, milestones done/total, booking
  times, commitment state).

**Test cases** (fixtures built with `tests/helpers.js`'s `fixture`):
1. No cursor → baseline cursor, zero events.
2. A done log for a task in a goal due in 11 days, source `claude` → one `tick`, level 3, `by: 'claude'`,
   `paths` from its notes (`Job Search/IDADP/Practice/RP3_MILLRACE/RP3_MILLRACE_pack.html`); the same
   log sensed again → no event.
3. A task in `commit:<today>` whose `date` moved to tomorrow with a `changes` record source `calendar` →
   `pushed`, level 3, `by: 'calendar'`; with no change record → `by: 'me'`.
4. A committed task archived → `dropped`, level 3.
5. A block that ended 40 minutes ago with an unticked item → `slip`, level 2; ended 10 minutes ago →
   nothing yet; sensed twice → one event.
6. External calendar event added tomorrow overlapping a booked block → `calendar`, level 3, with its
   description clipped to 600 characters and HTML stripped; the planner's own event (`dash=1`) → ignored;
   an external event whose start moved → a new `calendar` event with `text` saying from→to; one that
   disappears while still in the future → `calendar` "gone".
7. Hevy done log → `workout` level 1; Hebrew amount logs → one `hebrew` event per new log count.
8. A George message added to a talk that holds a Mind message → `reply`, level 1.
9. Three `overflow` events for one goal's tasks on one day → one `risk` event; a goal task scheduled
   after the goal's `targetDate` → `risk`.
10. A new active `ask:` record → `ask` event; a new flag → `flag` level 1; a milestone turning done →
    `ms` level 2.

**Commit:** "Senses: what changed since the last run, who did it, and how much it matters".

### Task 4: Drive artefacts (`planner/drive.js`)

**Files:** Create `planner/drive.js`, `tests/drive.test.js`.

**Interfaces — Produces:**
- `drivePaths(notes) → [string]` — path-like runs with ≥ 2 `/`, segments without `:`, trimmed, URLs
  excluded (`https://maps.app.goo.gl/x` → none; `Pack: Job Search/IDADP/Practice/RP2_HALYARD/RP2_HALYARD_pack.html.` →
  `['Job Search/IDADP/Practice/RP2_HALYARD/RP2_HALYARD_pack.html']`).
- `readArtefacts({ DriveApp, paths, now, days = 3, maxChars = 12000 }) → { files: [{ name, path, modified, text }], problem }`
  — resolves each path from `DriveApp.getRootFolder()` via `getFoldersByName`; a last segment with an
  extension is a file, so its folder is the parent; reads text files (`.md`, `.txt`, `.html`/`.htm`
  stripped to text) in that folder and its parent modified in the last `days`, newest first, each ≤
  6,000 characters, all ≤ `maxChars`, de-duplicated by file id. Any exception → `{ files: [],
  problem: message }` (e.g. Drive not authorised).
- `htmlText(html) → string` (scripts and styles removed, tags removed, entities `&amp; &lt; &gt; &quot; &#39; &nbsp;` decoded, whitespace collapsed).

**Test cases:** paths from real note shapes (the two role plays, the walk note with map links); a fake
DriveApp tree `Job Search/IDADP/Practice/{reflections.md, RP3_MILLRACE/{RP3_debrief.md, RP3_MILLRACE_pack.html, ASSESSOR_BRIEF.txt(old)}}`
returns the debrief, the pack as text and `reflections.md`, not the 10-day-old brief; caps; a missing
folder → empty with no throw; a throwing DriveApp → `problem`.

**Commit:** "Drive: read the debriefs behind a finished task".

### Task 5: Gemini in Apps Script (`planner/gemini-gas.js`)

**Files:** Create `planner/gemini-gas.js`, `tests/gemini-gas.test.js`. Uses `js/gemini.js`
(`ENDPOINT`, `readReply`).

**Interfaces — Produces:**
- `createGemini({ UrlFetchApp, key, models, budget: { left(), spend(n), block() }, log = () => {} })
  → { ask(requests) }`. `requests: [{ system, prompt, model: 'think'|'check' }]` → resolves (sync
  under Apps Script, a Promise-returning function for uniformity) to `[{ data, model } | { error }]`
  in request order. All requests go in one `UrlFetchApp.fetchAll`; failures with 429/5xx on `think`
  retry once on `check`'s model (one more `fetchAll`); a 429 on both marks `budget.block()` and
  returns `{ error: 'quota' }`; each HTTP request spends 1; with `budget.left() < requests.length`
  nothing is sent and every entry is `{ error: 'budget' }`. Body: `systemInstruction`, one user
  content, `generationConfig: { responseMimeType: 'application/json', temperature: 0.5 }`. The key
  appears only in the URL and never in `log`.

**Test cases:** three requests → one `fetchAll` of three, answers mapped in order; one 503 retried on
the check model, others not; 429 everywhere → `quota`, `block()` called; budget 2 with 3 requests →
three `budget` errors and no fetch; a 200 whose text isn't JSON → `{ error: 'nonsense' }`; the key never
in log lines.

**Commit:** "Gemini from the planner, several questions at once".

### Task 6: Reflex chains and openers (`planner/reflex.js`)

**Files:** Create `planner/reflex.js`, `tests/reflex.test.js`. Uses `js/talk.js` (`talkContext`,
`OPENERS`, `PLAIN_OPENERS`), `js/mind.js`, `js/mind-state.js`, `js/coach.js` (`clip`).

**Interfaces — Produces:**
- `MIND_SYSTEM` (string): British English; the background mind of George's Coach; specific, names
  items and numbers; 1–3 sentences, at most one question; never claims something done unless it is in
  "Ticked off today"; pushed, dropped and missed work is not a win — ask why, curious not lecturing; a
  times-a-week habit on pace is a rest day; his gym sessions are his own; don't repeat recent
  background messages; saying nothing is allowed; JSON only.
- `pickGroups(mind, now, max = 2) → [{ key, kind, level, events }]` — unhandled-by-reflex events of
  level ≥ 2 under 3 hours old, excluding `ask`, `risk`, `reply`; grouped by `refs.goalId ?? refs.itemId
  ?? refs.calendar ?? kind`; a group whose top level is 2 waits until its newest event is 20 minutes old;
  ordered by level then age.
- `anglesFor(group) → ['progress'|'pattern'|'plan']` — tick/ms: progress, pattern (+ plan when a
  goal is due within 7 days); pushed/dropped/moved/slip: plan, pattern; calendar: plan; hebrew: progress.
- `groupText(group, { forGemini = true }) → string` — event lines, facts, artefacts (each file name,
  modified, text), paths; with `forGemini` a `health.detail` is never included, only `health.label`.
- `readPrompt(angle, context, group)`, `draftPrompt(context, group, notes)`,
  `checkPrompt(context, facts, text)`, `openerPrompt(slot, context)` → `{ system, prompt }`.
  `context` is `talkContext(doc, today, now, { first: true })` plus the recent Mind messages.
- `runChain({ gemini, doc, group, now, recent }) → { say, text, notify, escalate, calls, problems }` —
  angles in one `gemini.ask`, then the draft, then `checkMessage` + the critic in one ask; if either
  objects, one revision (the critic's `text` if it gave one, re-checked by `checkMessage`); still
  failing → `say: false` with `problems`.
- `runReflexes({ gemini, store, mind, now, config, deadline, quiet }) → { said: [{ talkId, m }], escalate: [eventIds], runs }`
  — for each group while `Date.now() < deadline`: chain → if `say` and `canSay` (messages cap; the
  45-minute gap unless level 3) → write a `mind-<n>` talk with `{ who: 'coach', text, at, from: 'mind',
  by: 'gemini', notify: notify && level === 3 && !quiet, ref }`; stamp every event in the group
  `reflex`; add a run record.
- `backgroundOpenerDue({ doc, now, config, dayStartHour }) → 'morning'|'evening'|null` — morning at/after
  `morningAt`, before 12:00, not quiet, no `talk:<today>:morning`; evening at/after `checkinAt`, no
  evening talk; never on a closed day.
- `writeOpener({ gemini, store, slot, now, config, quiet }) → { talkId, m }|null` — morning uses the
  picture's opener for today when `checkMessage` passes; otherwise one draft (`openerPrompt`) and the
  check; Gemini unavailable → `PLAIN_OPENERS[slot]`. Saved as `talk:<today>:<slot>` with
  `from: 'mind', by, notify: !quiet`.

**Test cases** (fake `gemini.ask` returning scripted JSON per prompt, recording calls):
1. `pickGroups`: two ticks on one goal → one group; a level-2 slip 10 minutes old waits, 25 minutes
   old goes; a 4-hour-old level-3 event is skipped; `ask`/`risk` never picked; at most two groups.
2. `runChain` on an RP tick with artefacts: the first ask carries 2–3 prompts, one of which contains
   `RP3_debrief.md`'s text; the draft is saved; its message names the role play.
3. The critic rejects ("claims RP4 done") with a revision → the revision is used; a revision that
   still fails `checkMessage` → nothing said, `problems` recorded, events still stamped.
4. Privacy: a group with `health: { label: 'short night', detail: { sleepMinutes: 340 } }` → no prompt
   contains `340` or `sleepMinutes`; they do contain `short night`.
5. Caps: messages already at 8 → no message; a level-2 group 30 minutes after the last message → held
   (gap 45), a level-3 group → said; quiet → said with `notify: false`.
6. `backgroundOpenerDue` at 06:59/07:00/11:59/12:00; evening at 18:00 once; closed day → null.
7. `writeOpener` uses a valid picture opener verbatim, rejects one that claims an unticked task done
   and falls back to Gemini; Gemini failing → the plain line.
8. `escalate: true` from a draft → the group's event ids in `escalate`.

**Commit:** "Reflexes: Gemini reads what just happened, drafts, and checks itself before speaking".

### Task 7: P-256 and AES-GCM (`planner/p256.js`, `planner/aes.js`)

**Files:** Create `planner/p256.js`, `planner/aes.js`, `tests/crypto.test.js`.

**Interfaces — Produces:**
- `p256.js`: `bytesToBig(u8)`, `bigToBytes(n, len = 32)`, `pointFromBytes(u8_65)` (throws unless
  uncompressed and on the curve), `pointToBytes(P) → u8_65`, `publicKeyOf(d: bigint) → u8_65`,
  `ecdh(d: bigint, pub: u8_65) → u8_32` (x-coordinate), `ecdsaSign(hash: u8_32, d: bigint, randomBytes)
  → u8_64` (r‖s, retries on r or s = 0), `newPrivateKey(randomBytes) → bigint` (1 ≤ d < n). Jacobian
  coordinates, `a = −3` doubling, modular inverse by exponentiation.
- `aes.js`: `aesGcmEncrypt(key: u8_16, iv: u8_12, plaintext: u8, aad = new Uint8Array()) → u8`
  (ciphertext ‖ 16-byte tag). AES-128 key expansion and encryption; GCM with GHASH in BigInt.

**Test cases** (against `node:crypto`):
1. For 5 random private keys, `publicKeyOf` equals `createECDH('prime256v1')`'s public key.
2. `ecdh` equals Node's `computeSecret` for random pairs, both directions.
3. `ecdsaSign` of SHA-256(`"hello"`) verifies with `crypto.verify('sha256', …, { key: jwk, dsaEncoding: 'ieee-p1363' })` for 5 keys.
4. `pointFromBytes` rejects a point off the curve and a compressed point.
5. `aesGcmEncrypt` equals `createCipheriv('aes-128-gcm')` output+tag for lengths 0, 1, 15, 16, 17, 100,
   with and without AAD; NIST GCM test case 2 (`K = 0…0`, `P = 0…0` 16 bytes → `0388dace60b6a392f328c2b971b2fe78`
   and tag `ab6e47d42cec13bdf53a67b21257bddf`).

**Commit:** "The maths Web Push needs, since Apps Script has none of it".

### Task 8: Web Push messages (`planner/webpush.js`)

**Files:** Create `planner/webpush.js`, `tests/webpush.test.js`.

**Interfaces — Produces** (`hash = { sha256(u8) → u8, hmac(key: u8, data: u8) → u8 }`,
`randomBytes(n) → u8` injected):
- `b64url(u8) → string`, `fromB64url(s) → u8`.
- `hkdf(hash, salt, ikm, info, length) → u8` (RFC 5869, length ≤ 32).
- `encryptPayload({ hash, randomBytes, payload: u8, uaPublic: u8_65, authSecret: u8_16, salt?, asPrivate? }) → u8`
  — RFC 8291 `aes128gcm` body: `salt ‖ rs=4096 ‖ idlen=65 ‖ as_public ‖ AES-GCM(CEK, NONCE, payload ‖ 0x02)`.
- `vapidAuthorization({ hash, randomBytes, endpoint, privateKey: bigint, publicKey: u8_65, now, subject }) → string`
  — `vapid t=<ES256 JWT>, k=<b64url public key>`, `aud` = the endpoint's origin (regex, no `URL`),
  `exp` = now + 12 hours in seconds.
- `pushRequest({ …above, sub: { endpoint, p256dh, auth }, message: { title, body, url, tag } }) → { url, method: 'post', headers, payload: number[] (signed bytes), contentType, muteHttpExceptions: true }`
  with `TTL: '43200'`, `Urgency: 'normal'`, `Content-Encoding: 'aes128gcm'`.
- `makeVapidKeys(randomBytes) → { privateKey: string (b64url d), publicKey: string (b64url 65) }`.

**Test cases:**
1. `hkdf` equals `crypto.hkdfSync('sha256', …)` for three inputs.
2. RFC 8291 Appendix A: with its `as_private`, `salt`, `ua_public`, `auth_secret` and plaintext, the
   body equals the RFC's (values copied from the RFC during this task).
3. A Node-side decryptor (ECDH with the UA private key via `createECDH`, `hkdfSync`, `aes-128-gcm`
   decipher) recovers random payloads from `encryptPayload`.
4. The JWT in `vapidAuthorization` verifies with Node for its public key; `aud` is
   `https://fcm.googleapis.com` for an FCM endpoint; `exp` is 43,200 seconds after `now`.
5. `pushRequest` headers exactly as specified and a payload that the Node decryptor opens to the JSON
   message.

**Commit:** "Web Push: encrypt a notification and sign for it".

### Task 9: The Mind in the planner run (`planner/mind.js`, `gas.js`, `entry.js`, manifest)

**Files:** Create `planner/mind.js`, `tests/planner-mind.test.js`. Modify `planner/gas.js`,
`planner/entry.js`, `planner/apps-script/appsscript.json`, `tests/planner-apps.js` (serve any repo path,
`fetchAll`, `Utilities.computeDigest`/`computeHmacSha256Signature`/`DigestAlgorithm`, a fake DriveApp
hook), `tests/planner-bundle.test.js` (sandbox globals).

**Interfaces — Consumes:** everything above. **Produces:**
- `createMind({ UrlFetchApp, DriveApp, Utilities, props, log, fetch, now, token, repo, dayStartHour, started })
  → { think({ store, calEvents }) → Promise<void>, after({ store }) → Promise<void>, problem() }`.
- `think`: load `mind.json` (mind client = `createGitHubClient({ path: 'mind.json' })`); `sense`;
  attach artefacts (Task 4) to level ≥ 2 `tick` events with `paths`; turn `ask:` records into events and
  archive them; `planRisk`; append events; if `mindConfig.enabled` and `GEMINI_KEY`: `backgroundOpenerDue` →
  `writeOpener`, then `runReflexes` until `started + 150 s`; decide a fire (asks first, reserving one of
  `deepPerDay` for asks; then escalations and `risk`; never outstanding, never quiet except an ask) and
  POST it when `MIND_ROUTINE_URL`/`MIND_ROUTINE_TOKEN` are set (URL must start
  `https://api.anthropic.com/v1/claude_code/routines/`); write `mind:status` (heartbeat ≤ 55 min or on
  change: `lastRun`, `lastReflex`, `lastDeep` from runs, `lastError`, `today` counters, `runMs`).
- `after`: VAPID keys (make on first use: `VAPID_PRIVATE` property, `push-config` record); send each
  Mind message with `notify` not in `pushed` and under 6 hours old to every subscription (one
  `fetchAll`), unless quiet (ledger `quiet`); 201/200 → ledger; 404/410 → archive the subscription; other
  failures → retry count in the ledger, given up after 3; spend `pings` once per message; `pruneMind`;
  `saveMind`.
- `gas.js run()`: `started = now()` at the top; after the `agenda` write, `await mind.think(...)` in a
  try/catch that records `mind:status.lastError` and never throws; after the final sync — only when it
  succeeded or nothing needed pushing — `await mind.after(...)`, then (if `after` changed the store, e.g.
  an archived subscription) one more `syncOnce`. `clean()` scrubs `MIND_ROUTINE_TOKEN` and
  `VAPID_PRIVATE` too.
- `entry.js` passes `DriveApp` (when defined) and `Utilities`.
- Manifest adds `https://www.googleapis.com/auth/drive.readonly`.
- Run duration: `RUN_MS` script property `{ day, ms }` accumulated each run; shown in `mind:status.today.runMs`.

**Test cases** (full planner runs against the fakes):
1. First run with the Mind on and no `mind.json` → `mind.json` written with a cursor and no events; no
   Gemini call.
2. Tick a goal task with a Drive path (source `claude`) → next run: one `fetchAll` with the angles, a
   draft, a check; a `mind-1` talk in `data.json` with `from: 'mind'`, `by: 'gemini'`, `notify: true`;
   the event stamped; `mind:status.lastReflex` set.
3. With a push subscription (keys made in the test with Node) → the same run's `after` sends one
   request to the endpoint whose body the Node decryptor opens to `{ title: 'Coach', body, url:
   './?coach=talk:<day>:mind-1', tag }`; a second run doesn't resend; a 410 archives the subscription.
4. Mind disabled → senses run and `mind.json` fills, but no Gemini calls, no messages, no fires.
5. At 07:05 with the Mind on → a morning opener in `talk:<day>:morning` (picture opener when present);
   at 18:01 → evening; each once.
6. An `ask:` record → archived, `ask` event, one POST to the routine URL with the right headers and
   `text: 'ask: ask:…'`; another ask 10 minutes later → no second fire (outstanding).
7. Gemini returns 429 → `geminiBlocked`, no message, planning unaffected (calendar actions as without
   the Mind), `lastError` mentions the quota.
8. `mind.json` put conflict → merged and retried; the planner's cursor wins.
9. Mind throws inside `think` → planner result still `'ok'`, `mind:status.lastError` set, the key and
   routine token never in logs.
10. Bundle test: `planner/planner.js` runs in the sandbox with the new globals and `run()` returns `'ok'`.

**Commit:** "The planner senses, reacts, calls Claude in, and pings".

### Task 10: The deep mind's tool (`claude/mind.js`, `cli.js`, `config.js`, docs, ROUTINE.md)

**Files:** Create `claude/mind.js`, `claude/mind/ROUTINE.md`, `tests/claude-mind.test.js`. Modify
`claude/cli.js`, `claude/config.js`, `claude/ops.js`, `claude/skill/reference.md`,
`claude/skill/SKILL.md`, `claude/capabilities.js` (topic `mind`).

**Interfaces — Produces:**
- `configFromEnv(env) → { token, repo, dayStartHour, timeZone }` from `DASHBOARD_TOKEN`,
  `DASHBOARD_REPO` (default `George-Wightman/dashboard-sync`), `DASHBOARD_DAY_START`, `DASHBOARD_TZ`;
  `--config env` uses it.
- `mindPack(doc, mind, now, today) → string` — sections: *Now*; *Your picture of George* (full);
  *Config, budget and status*; *What happened since your last run* (events not stamped `deep`, oldest
  first, each with facts, artefacts in full, health in full); *Today* (`talkContext`); *The week as
  booked* (`week` read); *Goals* (`goals` read); *Attention*; *Conversations, last three days* (every
  message, Mind ones marked); *Journal* (`journal` read); *Open flags*; *How to answer* (the ops).
- Mind-mode ops (registered in `OPS` so `preview` works): `picture { text, opener? }`, `say { text,
  notify?, ref? }`, `propose { text, ops }` (inner ops `task`, `edit`, `archive` only, run on a copy;
  sparse before/after exactly like `js/coach-session.js`'s `finish`), `handled { events | 'all', summary }`
  (writes `mind:status.lastDeep` and records the run for `mind.json`).
- `mind` op (normal mode) `{ enabled?, morningAt?, checkinAt?, quietFrom?, quietUntil?, pingsPerDay?,
  messagesPerDay?, gapMinutes?, geminiPerDay?, deepPerDay?, models? }` — validated, merged into
  `mind:config`.
- `MIND_MODE_OPS = ['picture', 'say', 'propose', 'brief', 'guide', 'flag', 'handoff', 'handled']`, and
  per-apply limits: one `picture`, two `say`, one `propose`, one `handled`.
- `cli.js`: `mind` command (reads `data.json` and `mind.json`, prints `mindPack`); `apply --mind` /
  `preview --mind` enforce the list and limits before any op runs; after a successful push, a `handled`
  op's run record and stamps are saved with `saveMind` (`cursorFrom: 'remote'`).
- `ROUTINE.md`: the run in five steps (spec, *Deep mind*), what a good picture looks like, what is worth
  saying (specific, grounded in the events and artefacts, at most one question, holding him to the day),
  when to propose (the plan no longer fits a deadline; overbooked days), the rules (never touch Google
  Calendar; never apply without `--mind`; health numbers never go into the picture — labels only, since
  Gemini reads it; British English), and a closing `handled` with a summary.

**Test cases** (fake GitHub as in `tests/claude-cli.test.js`):
1. `--config env` reads the environment; missing `DASHBOARD_TOKEN` → a clear sentence, exit 1.
2. `mind` prints every section; events already stamped `deep` are absent; artefacts present.
3. `apply --mind` with `task` → refused before anything runs, nothing pushed; three `say` → refused.
4. `say` writes `deep-1` with `from: 'mind', by: 'claude'`; a second `say` in the same apply → `deep-2`;
   a message failing `checkMessage` → refused with the problem.
5. `propose` with an `edit` moving a task → a talk with `proposal` whose `netEdits` is that one change,
   and the task itself unchanged in `data.json`; `applyProposal` from `js/ui/coach.js` then applies it
   (reuse the proposal test harness in `tests/coach-proposals.test.js`).
6. `picture` > 4,000 characters → refused; valid → `mind:picture` replaced.
7. `handled 'all'` stamps every event that lacked `deep` in `mind.json`, adds a `deep` run with the
   summary, sets `mind:status.lastDeep`.
8. `mind` op (normal mode) merges config; invalid clock → refused.

**Commit:** "Claude's deep runs: a context pack, and a mode that can only talk and propose".

### Task 11: The Voice and the page

**Files:** Modify `js/talk.js`, `js/coach-tools.js`, `js/coach-session.js`, `js/ui/coach.js`,
`js/ui/sources.js`, `js/app.js`, `js/ui/settings.js`, `js/ui/claude.js`, `sw.js`, `styles.css` (the
mark in a bubble). Create `js/push-client.js`, `tests/coach-mind.test.js`, `tests/push-client.test.js`;
extend `tests/sw-runtime.test.js`.

**Interfaces — Produces:**
- `talk.js`: `openerDue` returns null when `mindAlive(doc, now)`; `waitingOpener` also considers
  today's unanswered Mind talks (newest, not done, newer than any talk George spoke in);
  `conversationContents` includes Mind talks; `talkContext` adds the picture (≤ 3,000 characters, with
  "written HH:MM ddd") and "Background messages he hasn't answered yet" (≤ 3); `CONTEXT_MAX` 18,000;
  `TALK_SYSTEM` adds the two rules (background messages are yours; `think_deeper` for real thinking).
- `coach-tools.js`: `think_deeper({ question })` → `ask:<day>:<n>` via `putCalendar(…, 'coach')`,
  returns `did: 'Asked for a deeper look: "…"'`; `coach-session.js` treats it as a write and
  `describeEdits` says `Asked for a deeper look: "…"`.
- `ui/coach.js`: the stream includes Mind talks (last two days); a Mind message's bubble carries
  `sourceMark(m.by === 'claude' ? 'claude' : 'gemini', m.by === 'claude' ? 'thought through' : 'noticed')`;
  `openAt(ctx, talkId)` sets the shown talk and opens the sheet.
- `app.js`: `?coach=<talkId>` on load → `openAt` then `history.replaceState` without it; a service
  worker message `{ type: 'open-coach', url }` → the same.
- `push-client.js`: `pushSupport(env)`, `deviceId(storage)`, `pushState(ctx) → 'unsupported'|'waiting'|'blocked'|'off'|'on'`,
  `turnOn(ctx)`, `turnOff(ctx)`, `b64urlToBytes`.
- `ui/settings.js`: a folded **Notifications** line with the state and *Turn on* / *Turn off*.
- `ui/claude.js`: "Coach's mind: reacted HH:MM · reviewed HH:MM" and `lastError` when set.
- `sw.js`: `push` → `showNotification(title, { body, tag, data: { url }, icon: 'icons/icon-192.png' })`;
  `notificationclick` → focus a window in scope and post `open-coach`, else `openWindow(url)`; SHELL gains
  `js/mind.js`, `js/push-client.js`; `CACHE` → `today-dashboard-v13`.

**Test cases:**
1. With the Mind alive, `openerDue` is null at 07:30; stale status (80 min) → the old behaviour.
2. `waitingOpener` returns an unanswered `mind-1` message; once George replies in `own-1` after it → null.
3. `talkContext` contains the picture text and an unanswered Mind message; clips a 5,000-character
   picture to 3,000.
4. `think_deeper` through a Coach turn (fake Gemini calling the tool) writes one `ask:` record, one
   change with Undo, and the reply text.
5. The panel renders a Mind talk that George never answered, with a `.src` mark titled
   "noticed by Gemini"; a reply sent while it's shown lands in that talk.
6. `?coach=talk:<day>:mind-1` opens the sheet on that talk and strips the parameter.
7. `push-client`: `turnOn` with a fake `PushManager` writes `push:<id>` with endpoint/p256dh/auth and
   label; `pushState` is `waiting` without `push-config`, `blocked` when permission is denied.
8. `sw-runtime`: a push event shows a notification with the payload's title/body/tag; a click with no
   window open calls `openWindow('…/?coach=…')`, with one open focuses it and posts `open-coach`.

**Commit:** "The Coach shows what its mind noticed, can ask Claude to think, and can ping".

### Task 12: Build, live checks, docs, release

**Files:** Create `dev/replay-senses.mjs`. Modify `README.md` (a *The Coach's mind* section and the
setup steps), `docs/superpowers/plans/2026-09-25-coach-mind.md` (tick the boxes).

- [ ] `npm run build` (planner bundle and release manifest); `npm test` (only the known timing flake
  may fail); `npm run build-skill` so the skill zip carries the new `reference.md`/`SKILL.md`.
- [ ] `dev/replay-senses.mjs`: with the skill's config (`~/.dashboard-skill/config.json`), list
  `dashboard-sync` commits touching `data.json`, fetch the versions nearest two given times, run `sense`
  from the first to the second (no calendar events), print the events. Run it for 24 Sep 17:00 → 19:30
  London and confirm two level-3 `tick` events for the role plays, by Claude, with their Drive paths.
- [ ] Run `node claude/dash.mjs --config ~/.dashboard-skill/config.json mind` against the live data
  (read-only) and read the pack; then act as the deep mind once with `preview --mind` (no writes) to
  check the ops read naturally.
- [ ] Browser check with the dev server: the Coach panel with a seeded Mind talk, the mark, the
  Notifications line (`?fakegemini`), a phone-width screenshot.
- [ ] Commit "Build the Mind's release, and say how to set it up".
- [ ] Ask George before pushing (it publishes to his devices and the planner loads the new code on its
  next run); after the push, his setup steps; then create the routine (`/schedule`), switch the Mind on
  with the `mind` op, and watch `mind:status` and `mind.json` through a day.

## Self-review

- Spec coverage: records (T1, T2), Senses and artefacts (T3, T4), Reflexes and openers (T5, T6), push
  (T7, T8, T9 `after`, T11), planner wiring and fire (T9), deep mind (T10), Voice (T11), limits and
  failure (T1 caps, T2 merge/prune, T5 quota, T9 errors), testing and live checks (every task, T12),
  setup (T12). Health and Hebrew are reserved (`health.label/detail` privacy test in T6).
- Names used across tasks: `mindConfig`, `mindAlive`, `isQuiet`, `checkMessage`, `nextMindSlot`,
  `mindMessages`, `messageKey`, `openAsks`, `pushSubscriptions` (T1); `emptyMind`, `mergeMind`,
  `pruneMind`, `budget`, `spend`, `unhandled`, `saveMind`, `loadMind` (T2); `sense`, `planRisk` (T3);
  `drivePaths`, `readArtefacts` (T4); `createGemini` (T5); `pickGroups`, `runChain`, `runReflexes`,
  `backgroundOpenerDue`, `writeOpener` (T6; named apart from `talk.js`'s `openerDue`, which the page uses); `publicKeyOf`, `ecdh`, `ecdsaSign`,
  `aesGcmEncrypt` (T7); `encryptPayload`, `vapidAuthorization`, `pushRequest`, `makeVapidKeys` (T8);
  `createMind` (T9); `mindPack`, `configFromEnv` (T10).
