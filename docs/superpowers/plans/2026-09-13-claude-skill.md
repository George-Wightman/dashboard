# Claude Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude, in any claude.ai chat (web, desktop app, phone), read George's dashboard and change anything in it — through a `dashboard` skill that runs a small command-line tool built on the app's own modules — with every change Claude makes logged in a synced change log that ⚙ shows with Undo.

**Architecture:** The synced document gains a `changes` map (`js/changes.js` holds the pure diff and readers; the store gains `addChange`, `undoChange`, `pruneChanges`). A Node tool in `claude/` loads `data.json` from the sync repo into an in-memory store built by the app's own `createStore`, runs read commands or JSON "ops" through the store's methods, logs each op as a change, and pushes with the app's own `syncOnce`. The skill (`claude/skill/`: `SKILL.md`, `reference.md`, `run.sh`) clones the public repo into claude.ai's sandbox and runs the tool with a `config.json` (kept in `~/.dashboard-skill/`, outside the repo) holding Claude's own GitHub key; `npm run build-skill` zips it for upload. ⚙ gains a *Claude's changes* group.

**Tech Stack:** HTML, CSS, JavaScript ES modules; Node's built-in `node:test`, `node:zlib`, `node:child_process`. No npm dependencies, no build step for the app. Bash for `run.sh`.

**Spec:** [`docs/superpowers/specs/2026-09-13-claude-skill-design.md`](../specs/2026-09-13-claude-skill-design.md) — read it before starting any task. The earlier plans describe the code this builds on.

## Global Constraints

Standing project rules:

- No framework, **no npm dependencies** (not even dev ones). The app has no build step; the only
  build is `npm run build-skill`, which zips the skill.
- Test command, from the repo root: `npm test` (runs `node --test tests/*.test.js`; **280 tests before
  this plan**). Every task ends with the whole suite passing.
- Nothing is ever hard-deleted — archive, dismiss, or tombstone.
- Work on the branch **`claude-skill`**. Commit after every task. Every commit message ends with a
  blank line and then `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Never** `git push`. Never create or modify GitHub repos or tokens.
- Never read, print or log a real key: `dash_settings.token`, `dash_settings.geminiKey`,
  `hvr_geminikey`, `hvr_geminikey2`, or the `token` in `~/.dashboard-skill/config.json`. Tests use
  dummy keys only. The key and the built zip live in `~/.dashboard-skill/`, outside the repo (which
  sits in Google Drive); `claude/skill/config.json` is gitignored in case one is ever copied there.
- Everything under `claude/` except `build-skill.mjs` and `zip.js` must run on **Node 18**: no
  `globalThis.crypto` (use `randomUUID` from `node:crypto`), no `zlib.crc32`, no `node:test` imports.
- The tool prints short plain text, never raw JSON documents. Every line it prints goes through
  `scrubText(text, [config.token])` from `js/flags.js`.
- British English in every string George or Claude reads.

Binding values from the design (copied verbatim; do not change them):

- **Skill name:** "Named `dashboard`, so `/dashboard` invokes it; it also triggers on plain wording ("add … to the dashboard", "put it on my list", "what's on today?", "how did last week go?", "log …", "tick off …")."
- **Skill files:** "`SKILL.md` — Triggers, how to run the tool, and the behaviour rules. Kept short." "`reference.md` — Every command and its options. Read only when Claude needs an unusual one." "`run.sh` — Clones the public repo into `/tmp/dashboard` (or fast-forwards it), checks Node, runs the tool with the skill's config." "`config.json` — `token`, `repo`, `dayStartHour`, `timeZone`. Only in the uploaded skill."
- **Build:** "A build command (`npm run build-skill`) zips the skill's files with that config into `~/.dashboard-skill/dashboard-skill.zip` for George to upload to claude.ai."
- **Time:** "sets `process.env.TZ` to the configured zone **before any date is made** (the sandbox runs on UTC …) and uses the configured day-start hour."
- **Behaviour rules:** "**Asked for → active.** … written `active`, `source: 'claude'`, and shows the existing *added by Claude* marker." "**Noticed → suggested, liberally.** … For a bigger job (an application, interview prep), Claude suggests a plan: goal, stages as milestones, first tasks." "**Act, then report.** No "shall I?", including for edits and archiving. One line per change: *Added "Email Sarah" for Fri 18 Sep.*" "**Ask only when it genuinely can't tell** which item … or which day." "**Look before changing.** Read or `find` first, and act on ids — never on a guessed title." "**Never claim a change that didn't land.**" "**Calendar-aware planning.** When the Google Calendar connector is available and Claude is choosing a day for something, it checks the calendar first. When a task needs real time, Claude offers to book a block; an event booked for a dashboard task carries `dashboard:<itemId>` in its description."
- **Change record:** "`id`, `source: 'claude'`, `status`, `created`, `updated` · `at` · `summary` · `edits` — `[{ map, id, before, after }]` … `before` is `null` for a new one · `undoneAt`, `undoneBy` — Set when undone (`'me'` or `'claude'`); `null` otherwise · `pruned` — `true` once the snapshots are dropped."
- **Pruning:** "any change older than 30 days has its `before`/`after` snapshots dropped and `pruned: true` set; the summary stays for ever. A pruned change can't be undone."
- **Undo:** "**Claude created it** (`before` is `null`) → set `status: 'dismissed'` … (A log is set `archived`, its existing tombstone.) **Claude changed it** → restore `before`, with a fresh `updated` … **Changed since** — the current record no longer serialises the same as `after` → leave it alone." "The result says which edits were undone and which were skipped (*changed since — not undone*). Undoing an undone or pruned change does nothing."
- **⚙:** "A new folded group, **Claude's changes**, whose summary line reads *N in the last week* (or *none yet*). Open: newest first, 20 at a time with *Show more*. Each row: when, the summary, *Details* (per record, the fields that changed, before → after), and **Undo** (hidden once undone or pruned; an undone row is marked *undone*)."
- **Failures:** "A bad date, unknown id or empty title stops the command before any write; the document is never half-changed." "**Sandbox can't reach GitHub, or no Node:** `run.sh` says so plainly; Claude tells George to check claude.ai → Settings → Capabilities (code execution and network access)."
- **The key:** "A fine-grained GitHub token … Contents read/write on `dashboard-sync` only … It exists in `~/.dashboard-skill/config.json` on the laptop (outside the repo and Google Drive) and in the uploaded skill, nowhere else."

## Decisions this plan makes (where the design was silent or ambiguous)

- **Ops are JSON on stdin.** Changes go through `run.sh apply` with a JSON op (or a list) on a quoted
  heredoc (`<<'EOF'`), so apostrophes, quotes and `$` in titles never meet the shell. Reads are plain
  arguments (`run.sh today`, `run.sh find cv`).
- **One `apply` is all or nothing.** Every op runs against the in-memory store first; if any throws,
  nothing is pushed ("Nothing was changed. Op 2 of 3 (task) failed: …"). Each op that changed something
  gets its own change record, so Undo is per op; the whole batch is one push.
- **Ids.** The tool shows `#` plus the first 8 characters of a random id (a readable id such as
  `checkin:2026-09-13` in full) and accepts any unique prefix of at least 4 characters, with or without
  the `#`.
- **Dates** in ops and `day` are `YYYY-MM-DD`, `today`, `tomorrow` or `yesterday` — no weekday names
  (ambiguous). Every read starts with "Today is Sunday 13 September (2026-09-13) · 3 of 7 done", so
  Claude works other dates out from it.
- **Summaries.** Each op returns one line (e.g. `Added task "Email Sarah" for Fri 18 Sep · #a1b2c3d4`).
  The tool prints it; the change record stores it without the trailing ` · #id`.
- **`undo` is not logged as a change of its own**: it marks the change it undoes (`undoneAt`,
  `undoneBy: 'claude'`). If nothing could be undone (all changed since), the change is not marked and
  stays undoable.
- **Sources.** Claude's records are `source: 'claude'` everywhere: items, goals, milestones, ticks,
  logged amounts, flags. The store's `addMilestone`, `toggleDone`, `logAmount` and `addFlag` gain an
  optional source (default `'me'`); `addPlan` gains one (default `'gemini'`).
- **What Claude can edit** (`edit` op): items `title, date (tasks), area, goalId, repeat (habits),
  target and unitLabel (weekly targets), order`; goals `title, targetDate, target, unitLabel, why,
  order`; milestones `title, done, goalId, order`. Status changes go through `archive`, `accept`,
  `dismiss`; a weekly target's unit can't change (archive it and add a new one). Anything else is
  refused by name.
- **GitHub from the sandbox.** Spike 1 (13 Sep): claude.ai's sandbox runs Node 22, clones from
  github.com, and reaches api.github.com, where key-less calls got 403 from curl and Node alike — so
  no curl fallback. `claude/github.js` is the one place that knows the route (the app's own
  Contents-API client); spike 2, with Claude's key, settles whether that stands or the file switches to
  git over https. `run.sh` sets `NODE_USE_ENV_PROXY=1`, harmless where there is no proxy.
- **Exit codes:** 0 done; 1 bad command, bad config or a refused op; 2 GitHub couldn't be read or
  written; 3 (from `run.sh`) no Node or no GitHub.
- **The app version** becomes `dash-v5` (`sw.js` `CACHE` and `js/flags.js` `APP_VERSION`) in Task 1,
  where `js/changes.js` joins the offline shell; Task 8 adds `js/ui/changes.js` to the same version.

## File map

| File | Responsibility | Task |
|---|---|---|
| `js/doc.js`, `js/changes.js`, `tests/changes.test.js` | `changes` in `MAPS`; the diff, field changes, readers, undo line | 1 |
| `js/data.js`, `tests/changes-store.test.js` | `source` options (1); `addChange`, `undoChange`, `pruneChanges` (2) | 1, 2 |
| `tests/flags.test.js` | Its `MAPS` / `emptyDoc` lines gain `changes` | 1 |
| `sw.js`, `js/flags.js` | `dash-v5`; `js/changes.js` (1) and `js/ui/changes.js` (8) in SHELL | 1, 8 |
| `claude/config.js`, `claude/session.js`, `claude/github.js`, `tests/helpers.js`, `tests/claude-core.test.js` | Config checks; one run's pull → apply → push; the route to GitHub; `FakeGitHub` | 3 |
| `claude/ids.js`, `claude/text.js`, `claude/read.js`, `tests/claude-read.test.js` | Short ids and finding records; wording helpers; the read commands | 4 |
| `claude/ops.js`, `tests/claude-ops.test.js` | Every op | 5 |
| `claude/cli.js`, `claude/dash.mjs`, `tests/claude-cli.test.js` | Arguments in, text out; the time zone; all-or-nothing; the key scrubbed | 6 |
| `claude/skill/*`, `claude/zip.js`, `claude/build-skill.mjs`, `.gitignore`, `package.json`, `tests/claude-skill.test.js` | The skill's files and the zip build | 7 |
| `js/ui/changes.js`, `js/ui/settings.js`, `styles.css`, `tests/changes-ui.test.js`, `README.md` | ⚙ → Claude's changes; the README | 8 |

## Tasks

Each task lives in its own file under [`2026-09-13-claude-skill/`](2026-09-13-claude-skill/). Tick here when a task is committed.

- [x] [Task 1: The change log in the document](2026-09-13-claude-skill/task-01-change-log-data.md) — `changes` in `MAPS`, `js/changes.js`, `source` options on the store, `dash-v5`
- [x] [Task 2: Undo and pruning in the store](2026-09-13-claude-skill/task-02-undo-prune.md) — `addChange`, `undoChange`, `pruneChanges`
- [x] [Task 3: The tool's plumbing](2026-09-13-claude-skill/task-03-tool-core.md) — `claude/config.js`, `claude/session.js`, `claude/github.js`
- [x] [Task 4: Reading the dashboard](2026-09-13-claude-skill/task-04-reads.md) — `claude/ids.js`, `claude/text.js`, `claude/read.js`
- [x] [Task 5: Changing the dashboard](2026-09-13-claude-skill/task-05-ops.md) — `claude/ops.js`
- [x] [Task 6: The command line](2026-09-13-claude-skill/task-06-cli.md) — `claude/cli.js`, `claude/dash.mjs`
- [x] [Task 7: The skill and its build](2026-09-13-claude-skill/task-07-skill-build.md) — `SKILL.md`, `reference.md`, `run.sh`, the zip
- [x] [Task 8: Claude's changes in ⚙, and the README](2026-09-13-claude-skill/task-08-settings-readme.md)

Tasks 1, 2, 4, 5 and 8 don't touch GitHub and ran first, while spike 2 was pending; Task 3, then 6
and 7, follow. Task 8 is browser work, checked by the
controller in the Browser pane: serve with `preview_start` `dashboard`, open
`http://localhost:8080/dev/seed.html?replace`, then `http://localhost:8080/?fakegemini`, reload twice
(the offline cache).

## Shared interfaces (the contract between tasks)

```js
// ---- js/doc.js (Task 1) ------------------------------------------------------------------------
MAPS = ['items', 'goals', 'milestones', 'logs', 'journal', 'flags', 'changes']
emptyDoc(): { schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {}, flags: {}, changes: {} }

// ---- js/changes.js (Task 1) — pure, imports only ./doc.js ---------------------------------------
CHANGE_KEEP_DAYS = 30
Edit = { map: string, id: string, before: object | null, after: object | null }
ChangeRecord = { id, source: 'claude', status: 'active', created: day, archivedOn: null, updated: ISO,
                 at: ISO, summary: string, edits: Edit[], undoneAt: ISO | null,
                 undoneBy: 'me' | 'claude' | null, pruned: boolean }
diffDocs(before, after): Edit[]        // every record (all MAPS but 'changes') whose stableStringify differs;
                                       // copies; sorted by MAPS order then id; before null for a new record
fieldChanges(before, after): { field, from, to }[]   // keys (not 'updated') whose values differ, sorted
recordTitle(rec): string               // title ?? text ?? summary ?? 'on <day>' ?? ''
editLines(edit): string[]              // ['New task "A"'] · ['task "A": title "A" → "B"', …] · [] when pruned
changeList(doc): ChangeRecord[]        // status 'active', newest `at` first
changeCountLine(doc, now: Date): string   // 'none yet' · '1 in the last week' · '3 in the last week'
canUndo(change): boolean               // !undoneAt && !pruned
undoLine({ undone, skipped, already }): string
  // 'Already undone, or too old to undo.' · 'Changed since — not undone.' · 'Undone.' ·
  // 'Undone, except "A", "B" — changed since, not undone.'

// ---- js/data.js (Tasks 1 and 2) ----------------------------------------------------------------
store.addMilestone(goalId, title, { source = 'me', status = 'active' } = {}): MilestoneRecord
store.toggleDone(itemId, day = today(), source = 'me'): LogRecord | undefined
store.logAmount({ itemId = null, goalId = null, amount, day = today(), note = '', source = 'me' }): LogRecord
store.addFlag(text, ctx = null, source = 'me'): FlagRecord
store.addPlan({ goal, milestones, habits, targets, tasks, source = 'gemini' }): { goal, milestones, items }
store.addChange({ summary, edits }): ChangeRecord          // Task 2; throws on blank summary / no edits
store.undoChange(changeId, by = 'me'): { undone: Edit[], skipped: Edit[], already: boolean }   // Task 2
store.pruneChanges(): number                               // Task 2; commits only when it prunes

// ---- claude/config.js (Task 3) -----------------------------------------------------------------
DEFAULT_ZONE = 'Europe/London'
readConfig(text: string): { token, repo, dayStartHour, timeZone }   // throws plain-English errors

// ---- claude/github.js (Task 3) -----------------------------------------------------------------
makeClient({ token, repo, fetch? }): { get(): Promise<{ doc, sha } | null>, put(doc, sha): Promise<sha> }
  // the app's createGitHubClient today; the only file that changes if the sandbox needs git instead

// ---- claude/session.js (Task 3) ----------------------------------------------------------------
class MemoryStorage { getItem, setItem, removeItem }
openSession({ client, dayStartHour = 4, now = () => new Date(), newId }): Promise<Session>
Session = {
  store,                                            // a createStore over MemoryStorage with the remote doc
  record(fn: (store) => string, { log = true } = {}): { summary: string, edits: Edit[] },
                                                    // runs fn; logs its edits as one change (summary without ' · #id')
  changed(): boolean,
  push(): Promise<{ ok: true, pushed: boolean } | { ok: false, error: string }>,   // prune, then syncOnce
}

// ---- claude/ids.js, claude/text.js, claude/read.js (Task 4) -------------------------------------
shortId(id): string                                 // first 8 of a random id, else the id
resolveId(doc, ref, maps = MAPS): { map, id, rec }  // exact or unique prefix ≥ 4 chars; '#' ignored
q(text, n = 70): string                             // '"text"', clipped with …
dayName(day, today): string                         // 'today' · 'Fri 18 Sep'
when(iso): string                                   // 'Sun 13 Sep, 14:02' in the process time zone
toDay(value, today): string                         // 'today'|'tomorrow'|'yesterday'|YYYY-MM-DD → day; else throws
TYPE_NAMES = { task: 'task', habit: 'habit', quota: 'weekly target' }
repeatText(repeat): string                          // 'every day' · 'on Mon, Wed' · '3× a week' · 'every Fri' · 'monthly on the 1st'
amountText(value, unit, label = ''): string         // '45m' · '1.5h' · '5 applications'
header(doc, today): string                          // 'Today is Sunday 13 September (2026-09-13) · 1 of 4 done'
READS = { today, week, goals, list, find, day, history, journal, flags, changes }   // (doc, today, arg) => string

// ---- claude/ops.js (Task 5) --------------------------------------------------------------------
OPS = { task, habit, target, goal, milestone, plan, done, undone, log, edit, archive, accept, dismiss, flag, undo }
UNLOGGED = new Set(['undo'])
runOp(store, op: object): string                    // the summary line; throws, touching nothing, on bad input

// ---- claude/cli.js, claude/dash.mjs (Task 6) ---------------------------------------------------
USAGE: string
main({ argv, readText, readStdin, makeClient?, now?, newId?, env? }): Promise<{ code: 0 | 1 | 2, text: string }>

// ---- claude/zip.js, claude/build-skill.mjs (Task 7) --------------------------------------------
zipFiles(files: { name, data, mode? }[], when?: Date): Buffer
PLACEHOLDER = 'PASTE-THE-CLAUDE-SKILL-KEY-HERE'
SKILL_FILES = ['SKILL.md', 'reference.md', 'run.sh']
buildSkill({ configText, read }): Buffer            // throws on a bad or placeholder config

// ---- js/ui/changes.js (Task 8) -----------------------------------------------------------------
changesPanel(ctx): HTMLElement
```
