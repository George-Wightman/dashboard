# Claude skill — design

2026-09-13. Approved in brainstorming. Piece 3 of the roadmap: Claude, in any claude.ai chat (web,
desktop app or phone), can see the dashboard and change anything in it. George says `/dashboard`,
or just "add that to the dashboard", "what's on today?", "log 45m of Hebrew", and it's done.

## Where this came from

George wants to be mid-conversation in Claude and say "add to the dashboard" and have it happen.
He chats in the Claude app and on his phone, not in Claude Code. On scope: *"Claude is my
administrator, he can do as he pleases … Claude should be able to do anything in the app and be the
partner for me (Gemini doesn't get the same access)"*, with a log of changes in settings *"so if
something changes and I'm not sure I can check"*. Claude should add suggestions liberally, and for
bigger jobs (an application, interview prep) do the groundwork of breaking them into stages. The
calendar came up too; it was split: Claude uses the Calendar connector it already has while
planning (this piece), and the calendar filling itself from tasks is piece 6, designed separately.

## Approach

A claude.ai **skill** plus a small **command-line tool** in the dashboard repo. No server.

- claude.ai's code sandbox can reach `github.com` and `api.github.com` (GitHub is on the default
  "package managers" egress list), so the skill can talk to the sync repo directly.
- The tool, `claude/dash.mjs`, runs the app's own modules (`js/data.js`, `merge.js`, `sync.js`,
  `schedule.js`, …) in Node. They have no browser dependencies and already take their storage and
  `fetch` as parameters. Claude therefore follows exactly the app's rules: the same merge, the same
  "what's on today", the same checks on a new record.
- To the laptop and the phone, Claude is simply a third device writing to `dashboard-sync`.

A custom MCP connector (a Cloudflare Worker holding the key) was considered and set aside: it
needs a server and an auth answer (claude.ai connectors offer only OAuth or no auth). The tool's
commands could later be served by one without redoing anything.

## 1. The tool — `claude/dash.mjs`

Lives in the public repo and holds no secrets. Every run:

1. Reads its config (below), sets `process.env.TZ` to the configured zone **before any date is
   made** (the sandbox runs on UTC; without this a late-night "tomorrow" lands on the wrong day),
   and uses the configured day-start hour.
2. GETs `data.json` from the sync repo and loads it into a store built by `createStore` over an
   in-memory storage seeded with the document and settings.
3. Runs one command through the store's own methods.
4. For a write: diffs the document before and after, adds a change record (section 3), and pushes
   with `syncOnce` (merge, PUT with the sha, retry on conflict). Reads never push.
5. Prints compact plain text for Claude to read — a day's list in about 20 lines, not JSON.

**GitHub access.** The tool uses the app's `createGitHubClient`, behind one small module
(`claude/github.js`) that is the only place knowing the route. Spike 1 (13 Sep) showed the sandbox runs
Node 22, clones from github.com and reaches api.github.com, where key-less calls got 403; spike 2, with
Claude's key, settles whether the API stands or that module switches to git over https, which the
clone proves works.

### What Claude can do

- **Read:** today's list (with carry-overs, suggestions and weekly-target totals), this week, goals
  with milestones and progress, the last three weeks, any one day, the coach's check-ins and weekly
  digest, open flags, and Claude's own change log. A `find` looks items and goals up by title so
  Claude can act by id.
- **Add:** tasks (today or any date), habits (any repeat kind), weekly targets, goals, milestones on
  a goal, flags — each either **active** or **suggested**.
- **Suggest a plan:** a goal with its stages as milestones, plus habits, weekly targets and
  first-step tasks, all as suggestions, through the same `addPlan` Gemini uses (see section 4).
- **Change:** tick or untick, log an amount (`45m`, `1.5h`, `3`), edit any field on any record,
  archive, accept or dismiss a suggestion, mark a flag addressed, and undo one of Claude's changes.

Out of reach, because they never sync: the widget arrangement, the look, and each device's settings
and keys.

## 2. The skill

Named `dashboard`, so `/dashboard` invokes it; it also triggers on plain wording ("add … to the
dashboard", "put it on my list", "what's on today?", "how did last week go?", "log …", "tick off …").

| File | Job |
|---|---|
| `SKILL.md` | Triggers, how to run the tool, and the behaviour rules. Kept short. |
| `reference.md` | Every command and its options. Read only when Claude needs an unusual one. |
| `run.sh` | Clones the public repo into `/tmp/dashboard` (or fast-forwards it), checks Node, runs the tool with the skill's config. |
| `config.json` | `token`, `repo`, `dayStartHour`, `timeZone`. Only in the uploaded skill. |

The skill's source lives in `claude/skill/` in the repo. Its `config.json` lives in
`~/.dashboard-skill/` on the laptop, outside the repo, because the repo sits in a Google Drive folder
and the key shouldn't. A build command (`npm run build-skill`) zips the skill's files with that config
into `~/.dashboard-skill/dashboard-skill.zip` for George to upload to claude.ai. The clone is
Claude's job; George never sees it except as a step in Claude's working.

### Behaviour rules (in `SKILL.md`)

- **Asked for → active.** Anything George explicitly asks for is written `active`, `source:
  'claude'`, and shows the existing *added by Claude* marker.
- **Noticed → suggested, liberally.** When a chat turns up something that sounds like a to-do and
  George didn't ask for it, Claude adds it as a suggestion and says so in a line. For a bigger job
  (an application, interview prep), Claude suggests a plan: goal, stages as milestones, first tasks.
- **Act, then report.** No "shall I?", including for edits and archiving. One line per change:
  *Added "Email Sarah" for Fri 18 Sep.* The change log is the safety net.
- **Ask only when it genuinely can't tell** which item ("the CV one" matches two) or which day.
- **Look before changing.** Read or `find` first, and act on ids — never on a guessed title.
- **Never claim a change that didn't land.** If the tool reports a failure, say so in one line.
- **Calendar-aware planning.** When the Google Calendar connector is available and Claude is
  choosing a day for something, it checks the calendar first. When a task needs real time, Claude
  offers to book a block; an event booked for a dashboard task carries `dashboard:<itemId>` in its
  description, so piece 6 can recognise it later instead of booking it twice.
- British English, as the rest of the app.

Gemini is unchanged: it can only write suggestions.

## 3. The change log and Undo

### The record

A new synced map, `changes`, joins `MAPS`. One record per Claude command that wrote something:

| Field | |
|---|---|
| `id`, `source: 'claude'`, `status`, `created`, `updated` | As every record |
| `at` | ISO time of the change |
| `summary` | One line: *Added task "Email Sarah" for Fri 18 Sep* |
| `edits` | `[{ map, id, before, after }]` — every record the command touched; `before` is `null` for a new one |
| `undoneAt`, `undoneBy` | Set when undone (`'me'` or `'claude'`); `null` otherwise |
| `pruned` | `true` once the snapshots are dropped |

`edits` comes from diffing the document before and after the command (records whose serialised
form changed), so a many-record command such as a suggested plan is captured without each command
having to say what it touched.

**Pruning.** When the tool writes, any change older than 30 days has its `before`/`after`
snapshots dropped and `pruned: true` set; the summary stays for ever. A pruned change can't be
undone.

Older copies of the app pass an unknown map through the merge untouched, so nothing breaks while
devices update.

### Undo

One store method, `undoChange(changeId, by)`, used by both the ⚙ button and the tool. Per edit:

- **Claude created it** (`before` is `null`) → set `status: 'dismissed'`. A dismissed record never
  counts in the list, history, streaks or totals, and is never deleted. (A log is set `archived`,
  its existing tombstone.)
- **Claude changed it** → restore `before`, with a fresh `updated`, so it wins the merge everywhere.
- **Changed since** — the current record no longer serialises the same as `after` → leave it alone.

The change record gets `undoneAt`/`undoneBy`. The result says which edits were undone and which
were skipped (*changed since — not undone*). Undoing an undone or pruned change does nothing.

### In ⚙

A new folded group, **Claude's changes**, whose summary line reads *N in the last week* (or *none
yet*). Open: newest first, 20 at a time with *Show more*. Each row: when, the summary, *Details*
(per record, the fields that changed, before → after), and **Undo** (hidden once undone or pruned;
an undone row is marked *undone*).

## 4. Other app changes

- `addPlan` takes a `source` (default `'gemini'`), so Claude's plans show *suggested by Claude*.
- `changes` added to `MAPS` and `emptyDoc`; `isDoc` accepts it as it does the others.
- Nothing else on the main screen changes; the *added by* / *suggested by* markers already exist.

## 5. Failures

- **Everything checked before anything is written.** A bad date, unknown id or empty title stops
  the command before any write; the document is never half-changed.
- **GitHub refusal** (expired key, no access, offline, not a dashboard document): the tool prints
  the app's own plain-English message and exits non-zero. Conflicts retry, as in the app.
- **Sandbox can't reach GitHub, or no Node:** `run.sh` says so plainly; Claude tells George to
  check claude.ai → Settings → Capabilities (code execution and network access).
- **The key never shows.** It is read from `config.json`, never passed on the command line, and
  scrubbed from any error text (`scrubText` in `js/flags.js`).

## 6. The key

A fine-grained GitHub token, named e.g. *Claude skill*: Contents read/write on `dashboard-sync`
only. Separate from the laptop's and phone's key, so it can be revoked on its own. It exists in
`~/.dashboard-skill/config.json` on the laptop (outside the repo and Google Drive) and in the uploaded
skill, nowhere else.

## Testing

- **Spike first, before any building.** A throwaway skill run on claude.ai from the web and from
  the phone: Node version, the time zone, cloning the public repo, importing its modules, and
  reaching `api.github.com` with curl and with Node's `fetch` (with and without
  `NODE_USE_ENV_PROXY`).
- **Unit tests** in `npm test`, against a fake GitHub client: every command; the day boundary in
  London time on a UTC machine; the before/after diff; each Undo rule (clean, changed since, partly
  undone, pruned); pruning at 30 days; plans marked *Claude*; the ⚙ log; and the key never
  appearing in output or errors.
- **By hand:** from the phone, "what's on today?", add a task, see it on the laptop marked *added by
  Claude*, undo it from ⚙.

## George's one-off setup

1. Make the token (section 6).
2. Paste it into `~/.dashboard-skill/config.json`.
3. Run `npm run build-skill` → `~/.dashboard-skill/dashboard-skill.zip`.
4. Upload it at claude.ai → Settings → Capabilities → Skills; check code execution is on.
5. From the phone: "what's on today?"

## Out of scope

The calendar filling itself from tasks (piece 6); a hosted connector; device-only settings and the
widget arrangement; Hebrew and Notion imports (pieces 2 and 4).
