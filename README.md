# Today — a personal dashboard

Open the laptop, it's already on screen: what have I got today, tick things off as I go.
One screen: today's list (tasks, habits, weekly targets), this week's bars, goals, and the last
three weeks. Works offline and syncs between the laptop and the phone through a private GitHub
repo.

Pieces 1, 3 and 5 of 6: the core hub, the Claude skill and the Gemini coach. The designs are in
[`docs/superpowers/specs/`](docs/superpowers/specs/), and the build plans are in
[`docs/superpowers/plans/`](docs/superpowers/plans/).

## Using it

- **Add a task:** type in the box under the list and press Enter. Pick *Tomorrow* or a date if
  it isn't for today.
- **Habits, weekly targets and goals:** *New habit, quota or goal…* under the list, or *+ goal*
  in the Goals panel. Click any row's title to edit it. Archive instead of deleting — history is kept.
- **Weekly targets:** **+** adds 1 (shift-click to type an amount). For time targets, **+** asks
  for an amount: `45m`, `1.5h`, `1h30`. Click the count to see or remove this week's entries.
  They sit at the foot of the list under *This week*; a habit done a number of times a week shows
  a dot for each time.
- **Unfinished tasks carry over** with an amber *from Tue* marker until they're done.
- **The day starts at 4am**, so a late night still counts as the day before (change it in ⚙).
- **Suggestions** from Claude or Gemini show dimmed at the top: ✓ to take one on, ✕ to dismiss it.
  Things Claude added because you asked carry a small Claude logo (Gemini's star for the coach's);
  hover it for who added it.
- **⚙ settings** open with the version at the top. Everything else (GitHub sync, the day, the
  coach, the look, Claude's changes, backups) is folded away on one line each, showing what it's set to. Click a
  line to change it.

## The look

Paper & Ink by day, a darker Night version from the evening check-in hour until the day starts —
the same palette as the Hebrew app. ⚙ → **Look** picks *Follow the day* (the default), *Paper*, or
*Night*. The installed app's title bar changes to match, and it never flickers the wrong one on
load — the theme is set before the page even paints.

## Arranging the widgets

Today's list always stays in the first column; the Coach, This week, Goals and Last 3 weeks are
widgets you can move around the columns beside it — one column from 760px wide, two from 1500px.
This week starts hidden, since its targets are at the foot of the list; bring it back from Arrange.
Click **Arrange** in the header:

- **Drag** a widget's grip (⋮⋮) onto another to put it there, or onto a column's *Drop here* to
  send it to the end. On a touch screen, or whenever the window only shows one widget column, ↑ ↓
  buttons replace the grip.
- **Hide** takes a widget out of the columns; it waits as a chip under *Add a widget* until you
  bring it back.
- **Done** (or Escape) leaves Arrange mode. The arrangement is saved as you go, kept separately on
  each device (the laptop and the phone can have their own).

## The coach (Gemini)

The first panel on the right is a coach that runs on Google's Gemini.

- **Shape a goal.** Click *Shape with AI* in the Goals panel, say what you want to achieve in plain
  words, and press **Shape**. Gemini proposes a goal with milestones, plus up to two habits and two
  weekly targets. It all arrives as a suggestion, and the goal card shows what's proposed. ✓ on the
  card takes on the goal and its milestones. The habits and targets wait at the top of Today, to be
  accepted one by one. ✕ turns the whole plan down.
- **Evening check-in.** From 6pm (change the hour in ⚙), the panel offers *Start today's
  check-in*. Gemini asks two or three questions about today, built from what actually happened.
  Answer each in a line or two and press **Send** (or Ctrl+Enter). It replies with short feedback
  and at most two suggested tasks for tomorrow. Those show at the top of the list, marked *for Sat*
  and so on. The questions are saved as soon as they arrive, so they survive a reload or a switch of
  device. Typed answers stay on the page until you send them.
- **Weekly digest.** Once a new week starts, Gemini writes a short digest of last week: what went
  well, what slipped, and one focus for this week. It shows as *Last week* in the panel. It's saved
  in the synced document (`journal`), so Claude can read it later without the raw data. If it
  can't be written in the background, the panel offers *Write last week's digest*.

Nothing is ever a dialog. Problems show as one line in the panel: no key, offline, "Gemini's free
limit is used up for today — try tomorrow", or "Gemini didn't answer — try again".

**The key.** There's nothing to set up if the Hebrew app has a Gemini key saved on the same device.
Both apps are served from `george-wightman.github.io`, so the dashboard can use that key as it is.
Otherwise paste a key into ⚙ → *Gemini API key*. ⚙ also says whether a Hebrew-app key was found.
Keys stay on the device and are never synced.

**What it costs.** It asks `gemini-flash-lite-latest` first (about 500 free requests a day), and
only falls back to `gemini-flash-latest` (about 20 a day). That leaves the scarce Flash allowance
to the Hebrew app, which shares the key. A check-in is 2 requests, shaping a goal is 1, and the
digest is 1 a week.

**Privacy.** Check-ins and goal shaping send a summary of your list to Google. On Google's free tier
they may use it to improve their products.

**Trying it locally without a key.** On localhost, add `?fakegemini` to the address:
http://localhost:8080/?fakegemini. Canned replies stand in for Google, no key is read, and the panel
heading says *fake · ok*. To see a failure, pick a mode: `?fakegemini=slow` (5-second replies),
`nokey`, `quota`, `down`, `offline`, `badkey` or `nonsense`.

## Optional task controls and goal reviews

Tasks and goals have a folded **More options** section in the editor. Add success criteria,
availability dates, an advisory deadline, context, location or energy level without crowding the
daily list. Claude can also configure tags, checklists, custom values and dependencies on existing
one-off tasks. Waiting tasks stay visible but do not count in the day's completion total or receive
new calendar bookings. Existing area, duration, time and priority controls still steer the planner.

**AI goal reviews** are off by default. Expand a goal and choose **Review progress with AI** for
one review, or set a review interval in its editor (0 disables future scheduling). The existing
Apps Script planner needs `GEMINI_KEY` in its Script Properties; a key saved only in the browser
does not configure the planner. Reviews use bounded evidence from the goal, its linked work and
recent outcomes to assess direction. Their proposed tasks remain suggestions until accepted.
There can be at most three unaccepted suggestions for a goal; reviews also avoid exact repeats of
declined tasks. Completed goals stop generating scheduled review requests.

Each goal can have one review request per logical day. The runner makes at most two goal-review
API calls per run and six per day across goals. Other existing AI features have separate limits.
A failed or interrupted call is not retried automatically; pending and failed states are visible.
Reviews and rule processing follow the planner's ten-minute schedule and pause when it is paused.
No live AI calls are made by tests.

**Simple follow-ups**, when useful: Claude can attach a small outcome form to a task and a rule
that creates a follow-up, reschedules an unfinished task, logs a reported amount, adds an attention
note or requests a goal review. The completion checkbox then asks for the relevant answers. Rules
use reported facts, have bounded actions, and cannot recursively generate more reports. Each
rule/report pair runs once, and a failed action rolls back that rule. **Settings → Claude →
Follow-up rules** lets you pause a rule. Open-ended practice planning stays in Claude.

Claude discovers these controls with `capabilities`, reads one record with `inspect`, and can use
`preview` to validate changes without saving. The focused `workflows` and `reviews` playbooks
explain the boundaries. Plans now retain task durations, areas and advanced details, and their
tasks link to the proposed goal. See [the implementation and expansion notes](docs/ai-controls-2026-09-17.md).

## Flags

⚑ in the header notes something to change — a bug, a rough edge, an idea — from inside the app,
along with what it was doing at that moment. It's grey most of the time, and turns teal only once
sync is set up and something hasn't reached GitHub yet.

- Click ⚑, check the **About** line (a one-line summary of the moment — the look, today's
  progress, the coach, sync), write a sentence, and press **Save** (or Ctrl+Enter). It's saved at
  once and a sync is asked for straight away.
- The open flags list newest first, with **More details** (the captured context: window size, the
  arrangement, the coach and sync state — never a key or token, only whether one is set) and
  **Mark addressed**, which archives it — nothing is ever deleted.
- The panel's foot line says whether every flag has reached GitHub yet, with **Sync now** when one
  hasn't.

Flags ride the same sync as everything else, into `dashboard-sync/data.json`, ready for Claude to
read and act on later.

## Claude

Claude can read the dashboard and change anything in it from any claude.ai chat — on the web, in the
desktop app or on the phone. Say `/dashboard`, or just "add that to the dashboard", "what's on
today?", "log 45m of Hebrew", "tick off the CV task".

- **What you ask for goes straight on**, marked with Claude's logo. **What Claude notices** — a to-do
  that comes up in a chat — arrives as a suggestion for ✓ or ✕, and a bigger job (an application,
  interview prep) as a suggested goal with its stages and first tasks.
- **Claude directs.** You tick things off and rename them; Claude runs the rest, with controls you
  don't need yourself: **time off** (days or hours, for everything or some areas — nothing gets booked,
  streaks are safe, dated tasks move on), **notes** under a task's title (the ≡ mark opens them),
  **a brief** at the top of your list, **priorities** (booked first, ★), **area colours** in your
  calendar, and hours for particular days.
- **⚙ → Claude** shows all of it: today's brief and earlier ones, time off, priorities and colours,
  the calendar planner, what needs attention, what Claude can do, and **every change Claude makes**,
  newest first, with *Details* (what changed, field by field) and **Undo**. Undo never overwrites
  something you've changed since — it says so instead. Details are kept for 30 days; the one-line
  summaries for good.
- **Planning your week.** Say "plan my week" and Claude spreads the week's work over the days, with
  lengths and areas; the calendar planner (below) books it.

**How it works.** The skill (`claude/skill/`) clones this public repo into Claude's sandbox and runs
`claude/dash.mjs`, a small command-line tool built on the app's own modules: it reads `data.json`
from `dashboard-sync`, makes the change through the same store and merge, logs it, and writes it
back — to the laptop and the phone, Claude is just a third device. Changes appear at their next sync.
Visible, idle devices check for changes periodically, with longer waits after failures. Sync
requests time out rather than leaving the app permanently stuck on “syncing”.

**Setting it up (once).**

1. Make Claude its own key on GitHub: a fine-grained token, *Only select repositories →
   `dashboard-sync`*, *Contents → Read and write*. Keep it separate from the devices' key, so it can be
   revoked on its own.
2. Put it in `~/.dashboard-skill/config.json` (copy `claude/skill/config.example.json` there). It lives
   outside this folder on purpose: this folder syncs to Google Drive, and the key shouldn't.
3. `npm run build-skill` → `~/.dashboard-skill/dashboard-skill.zip`.
4. Upload it at claude.ai → Settings → Capabilities → Skills, with code execution on.

A new key (or a change to `SKILL.md` or `reference.md`) means building and uploading again. A change
to the tool itself doesn't: the skill always runs the version on GitHub.

## The calendar planner

Your dashboard, booked into your Google Calendar. A small script in your own Google account (the
*Dashboard planner*) runs every 10 minutes, and whenever one of your calendars changes:

- **Every task gets time.** A day's tasks and habits are grouped by area into one block — *Job
  search ×2* — around your fixed events, between 9:00 and 19:00, 15 minutes clear of anything else. A
  task's length is its own (*Draft cover letter 2h* in the add box, or Length in the edit panel),
  otherwise 30 minutes; *Call NatCen 14:00* makes it a fixed event at 14:00. A weekly time target
  (*Assessment centre prep 5h*) adds its share to each day.
- **Today and tomorrow are exact; later days are rough** — `~` and a paler colour — and at 20:00 each
  evening the day after tomorrow turns exact.
- **Blocks go on the calendar for their area** (Job search and Assessment centre on Application,
  Health on Gym), so they take your colours. Hebrew and Gym are your own events: moved off a clash,
  never copied.
- **When things change:** a shift on top of a block moves it, and a note under the date says so. Move
  a block yourself and it stays where you put it. Delete one and it isn't booked again that day.
- **When you tick:** during its block, the block ends at the tick; before it or later that day, it
  moves to end at the tick; part done, it says *1 of 2 done* and the rest gets a new slot; missed, it
  goes and the task gets a new slot.
- **On the list,** today's tasks show their time and follow the day's order. ⚙ → *Calendar planner*
  says when it last ran; the header warns if it stops.

Claude does the thinking: say **"plan my week"** and it spreads the week's work over the days, with
lengths and areas, and the calendar follows. Its settings (planning hours, calendars, linked habits)
change by asking Claude.

**Setting it up (once, about 10 minutes):**

1. GitHub → Settings → Developer settings → Fine-grained tokens → *Generate new token*: name it
   *Calendar planner*, *Only select repositories* → `dashboard-sync`, *Contents: Read and write*.
2. Go to [script.google.com](https://script.google.com) → *New project*, and name it *Dashboard
   planner*. In ⚙ Project Settings tick *Show "appsscript.json" manifest file in editor*. Replace the
   contents of `appsscript.json` and `Code.gs` with the two files in `planner/apps-script/`.
3. ⚙ Project Settings → *Script properties*: `GITHUB_TOKEN` (the token), `SYNC_REPO`
   (`George-Wightman/dashboard-sync`), and `GEMINI_KEY` if you'd like untagged tasks sorted into areas.
4. Back in the editor, choose `install` and press *Run*. Google asks for permission; *Google hasn't
   verified this app* is expected for a script of your own → *Advanced* → *Go to Dashboard planner* →
   *Allow*. Within 10 minutes your next 7 days fill in.

`pause`, `resume` and `removeAll` (every future block it made, then pause) run the same way. Updates
arrive by themselves: the script loads the planner from this site each time it runs.

## Hevy

The same script reads your Hevy workouts (Hevy Pro's API) every 10 minutes. It only ever reads:
nothing is written to Hevy, and your sessions stay yours to plan.

- **A workout ticks Gym**, and the Gym block in your calendar moves to when you actually trained.
  Its cardio minutes count towards your Cardio target (Claude links it). Untick it and it stays
  unticked; edit or delete the workout in Hevy and the dashboard follows.
- **The Gym panel** (a widget — Arrange moves or hides it): the week, the Cardio target, and a card for
  each key lift (Squat and Bench Press to start) — estimated 1RM, PRs in gold, the trend with its
  projection towards a target, pace in kg a week — and today's session. Today's Gym row says *via
  Hevy* and when; a day in *Last 3 weeks* lists its workouts.
- **The Coach and Claude see it too**: the Coach is told the day's training and the week's, the digest
  gets a Training line, and Claude reads everything with `gym`. Everything from before the week you
  connect only feeds the trends.

**Setting it up:** get your key at [hevy.com/settings?developer](https://hevy.com/settings?developer),
then in the *Dashboard planner* script → ⚙ Project Settings → *Script properties* → add `HEVY_KEY`
with the key as its value. That's all: the first runs copy your history, a few hundred workouts at a
time. ⚙ → Claude → *Gym* says how it's going.

## Updates

A push reaches every device on its own, with no version number to bump:

Before publishing source changes, run `npm run build` and `npm test`, and include the generated
`planner/planner.js` and `release.json` in the same release. The manifest contains hashes of every
offline asset; a missing or mismatched file prevents that release from replacing the working copy.

- **The header says so.** The app checks the site when it opens, whenever you come back to it,
  and every ten minutes while it's on screen. When a newer version is published it downloads all
  of it in the background, then shows **Update ready · reload** in the header. Nothing reloads by
  itself, so nothing half-typed is ever lost. Click it when you're ready.
- **⚙ → Version** says which build this device is running (by when it was published), and whether
  it's the newest. If it isn't, **Reload to update** is there too. *Recent changes* lists the last
  few commits, marking any that aren't on this device yet. For a minute or so after a push,
  GitHub Pages is still publishing it, and ⚙ says so.

It works from the date GitHub Pages stamps on every file when it publishes, compared with the
date on the copy this device is running (`js/version.js`). The GitHub key is never used for this;
the commit list comes from the public `dashboard` repo.
Open pages keep using their original complete release until navigation. Cache cleanup is limited
to dashboard caches, so other apps on the same origin keep their offline files.

## Morning steps (one-off setup, about 10 minutes)

1. **Publish the app.** The overnight build lives on the `core-hub` branch; merge it into `main`
   first. On GitHub, create a **public** repo called `dashboard` (no README). Then, in this
   folder:
   ```
   git checkout main
   git merge core-hub
   git remote add origin https://github.com/George-Wightman/dashboard.git
   git push -u origin main
   ```
   In the repo: *Settings → Pages → Deploy from a branch → `main` / `(root)` → Save*. After a
   minute it's live at **https://george-wightman.github.io/dashboard/**.
2. **Create the sync store.** Create a **private** repo called `dashboard-sync`. Tick "Add a
   README" so it isn't empty.
3. **Make an access key.** *GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token.* Repository access: *Only select repositories →
   `dashboard-sync`*. Permissions: *Contents → Read and write*. Copy the token.
4. **Connect the laptop.** Open the site, then ⚙ → *GitHub sync* → Sync repo
   `George-Wightman/dashboard-sync`, and paste the key → Save. The header should change to *synced HH:MM*.
5. **Install it and start it on sign-in.** In Chrome, use the install icon at the right of the
   address bar (or ⋮ → *Cast, save and share → Install page as app*). Then press Win+R and type
   `shell:startup`. In the Start menu, right-click *Today* → *Open file location*, and copy that
   shortcut into the Startup folder.
6. **Phone.** Open the same address in Chrome → ⋮ → *Add to home screen*. Enter the same repo and
   key in ⚙.

Anything typed into a local test copy (`localhost`) doesn't carry over to the published site on
its own. Use ⚙ → *Export backup* there and *Import backup…* on the site.

## Running it locally

```
npm run build
python -m http.server 8080
```

Then open http://localhost:8080/. For sample data, open http://localhost:8080/dev/seed.html?replace
(this only works on localhost).

While editing locally, select **Application → Service workers → Bypass for network** in Chrome
or Edge DevTools, then reload after changes. This avoids serving a previously installed release.
Rebuild before testing offline behaviour; `npm run test:browser` uses a fresh browser profile for
that. The normal update offer only notices a change to `index.html` locally, because Python dates
each file separately; GitHub Pages redates every file on deployment.

## Tests

```
npm test
```

Node 24's built-in test runner. There are no dependencies to install. Every pure module (dates,
parsing, scheduling, streaks, history, merge) and the sync flow is covered, including two
simulated devices converging. So are the Gemini client and the coach's context, prompts and reply
checks. They run against a fake `fetch`, so no test ever calls Google. The look's inline `<head>`
script is checked against `resolveLook` for every hour and a spread of settings; the palette check
keeps every colour name in one vocabulary; the widget arrangement (`js/layout.js`) and the flag
context and cap (`js/flags.js`) are fully covered too. The Claude tool is tested end to end against a
fake GitHub: every read and op, all-or-nothing batches, London time on a UTC machine, Undo's rules,
and the key never appearing in its output.

Reliability tests also cover independent concurrent edits, conversation merging, malformed data,
request timeouts, interrupted calendar changes, Script Property limits, and complete offline
releases. CI runs `npm test` on pushes and pull requests, including generated-file freshness checks.

For browser checks, make Playwright available (or set `PLAYWRIGHT_MODULE` to its installed package
directory), then run `npm run test:browser`. Set `BROWSER_CHANNEL=msedge` to use installed Edge;
otherwise it uses Playwright's Chromium. This creates an isolated local server and browser profile,
blocks external requests, and checks editing, cross-tab updates, offline saves and recovery.

## How it's built

Plain HTML, CSS and JavaScript modules, with no framework or runtime dependencies. A small build
script bundles the Apps Script planner and generates the offline release manifest.

| File | Job |
|---|---|
| `js/dates.js` | Day arithmetic, the 4am boundary, labels |
| `js/parse.js` | `45m` / `1.5h` parsing and display |
| `js/doc.js`, `js/data.js` | The document and the store (`localStorage`) |
| `js/schedule.js` | What's on a day, carry-over, streaks, weekly totals, history, goal progress |
| `js/merge.js`, `js/record.js` | Merging copies with per-field versions and conversation-message tombstones |
| `js/sync.js` | GitHub read/merge/write with retry, and the sync timer |
| `js/gemini.js` | The Gemini client: lite model first, fallbacks and retries, plain-English errors |
| `js/coach.js` | What the coach tells Gemini, a week's numbers, the prompts, and the reply checks |
| `js/workflow.js`, `js/goal-review.js`, `planner/reviews.js` | Optional task controls, conditional follow-ups, and bounded goal reviews |
| `js/look.js` | Which look (Paper or Night) applies at a given moment |
| `js/layout.js` | The widget arrangement: normalise, move, nudge, hide, show |
| `js/flags.js` | A flag's captured context, its 4 KB cap, and the panel's readers |
| `js/version.js` | Which build this is, whether a newer one is live, and taking the update |
| `js/changes.js` | Claude's change log: what a change did, and the readers ⚙ uses |
| `js/calendar.js` | The calendar planner's records: its settings, today's times, its notes and health |
| `claude/` | The command-line tool and the skill Claude runs (`npm run build-skill` zips the skill) |
| `planner/` | The calendar planner: a pure planning core (`plan.js` and its parts), the Apps Script side (`gas.js`), bundled by `npm run build-planner` into `planner/planner.js`, which the loader in `planner/apps-script/` fetches |
| `js/ui/*.js`, `js/app.js` | The screen |
| `sw.js`, `release.json`, `manifest.webmanifest` | Complete, hash-checked offline releases and install |

Data lives in one JSON document: `items`, `goals`, `milestones`, `logs`, `journal` (the coach's
check-ins and weekly digests), `flags` (notes of something to change), `changes` (what Claude
has changed, for ⚙ and Undo) and `calendar` (the calendar planner's settings, its day-by-day
bookings and its notes). `rules`, `outcomes`, `workflowRuns` and `reviews` hold optional controls,
reported facts and execution receipts. Nothing is ever
hard-deleted. Records are archived or tombstoned, so a sync can't bring back something removed on
another device. Settings (repo, access key, day start, Gemini key, check-in hour, look) stay on
each device and are never synced, and so do the widget arrangement (`dash_layout`) and the last
successful sync time (`dash_last_synced`).

Edits to different top-level fields merge independently. Concurrent edits to the same field use
timestamp order with a deterministic tie-break; nested objects and most arrays are one field.
Conversations merge individual messages and retain deletion markers until pruning. Reload all
devices after upgrading: older writers still use whole-record timestamps.

Imports and remote documents are validated before application. If local data is damaged, the
store recovers valid records, also consults `dash_data_previous`, and attempts to preserve the
original under `dash_data_corrupt`; a visible warning reports recovery. The previous-copy backup
is best effort and yields space to the main document when storage is full. Exported backups
remain useful for recovering earlier history.

## Roadmap

1. **Core hub** — built
2. Hebrew auto-tick — practice minutes from the Hebrew app's sync file
3. **Claude skill** — built
4. Job search + Notion — application counts and deadlines from the Job Tracker
5. **Gemini coach** — goal shaping, evening check-in, weekly digest — built
6. **Google Calendar** — the planner books the dashboard into your calendar — built
