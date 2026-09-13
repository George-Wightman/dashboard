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
- **Unfinished tasks carry over** with an amber *from Tue* marker until they're done.
- **The day starts at 4am**, so a late night still counts as the day before (change it in ⚙).
- **Suggestions** from Claude or Gemini show dimmed at the top: ✓ to take one on, ✕ to dismiss it.
  Things Claude added because you asked show *added by Claude*.
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

- **What you ask for goes straight on**, marked *added by Claude*. **What Claude notices** — a to-do
  that comes up in a chat — arrives as a suggestion for ✓ or ✕, and a bigger job (an application,
  interview prep) as a suggested goal with its stages and first tasks.
- **Every change Claude makes is listed** in ⚙ → **Claude's changes**, newest first, with *Details*
  (what changed, field by field) and **Undo**. Undo never overwrites something you've changed since —
  it says so instead. Details are kept for 30 days; the one-line summaries for good.
- **Planning with the calendar.** Where the Google Calendar connector is on, Claude checks the
  calendar before picking a day, and offers to book time for bigger tasks.

**How it works.** The skill (`claude/skill/`) clones this public repo into Claude's sandbox and runs
`claude/dash.mjs`, a small command-line tool built on the app's own modules: it reads `data.json`
from `dashboard-sync`, makes the change through the same store and merge, logs it, and writes it
back — to the laptop and the phone, Claude is just a third device. Changes appear at their next sync.

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

## Updates

A push reaches every device on its own, with no version number to bump:

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
python -m http.server 8080
```

Then open http://localhost:8080/. For sample data, open http://localhost:8080/dev/seed.html?replace
(this only works on localhost).

After changing code, reload **twice** — the offline cache serves the old copy once while it
fetches the new one. (The update offer only notices a change to `index.html` locally, because
`python -m http.server` dates each file separately; on GitHub Pages every push redates them all.)

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

## How it's built

Plain HTML, CSS and JavaScript modules. No build step, no framework, no dependencies.

| File | Job |
|---|---|
| `js/dates.js` | Day arithmetic, the 4am boundary, labels |
| `js/parse.js` | `45m` / `1.5h` parsing and display |
| `js/doc.js`, `js/data.js` | The document and the store (`localStorage`) |
| `js/schedule.js` | What's on a day, carry-over, streaks, weekly totals, history, goal progress |
| `js/merge.js` | Merging two copies — commutative, idempotent, never loses anything |
| `js/sync.js` | GitHub read/merge/write with retry, and the sync timer |
| `js/gemini.js` | The Gemini client: lite model first, fallbacks and retries, plain-English errors |
| `js/coach.js` | What the coach tells Gemini, a week's numbers, the prompts, and the reply checks |
| `js/look.js` | Which look (Paper or Night) applies at a given moment |
| `js/layout.js` | The widget arrangement: normalise, move, nudge, hide, show |
| `js/flags.js` | A flag's captured context, its 4 KB cap, and the panel's readers |
| `js/version.js` | Which build this is, whether a newer one is live, and taking the update |
| `js/changes.js` | Claude's change log: what a change did, and the readers ⚙ uses |
| `claude/` | The command-line tool and the skill Claude runs (`npm run build-skill` zips the skill) |
| `js/ui/*.js`, `js/app.js` | The screen |
| `sw.js`, `manifest.webmanifest` | Offline and install |

Data lives in one JSON document: `items`, `goals`, `milestones`, `logs`, `journal` (the coach's
check-ins and weekly digests), `flags` (notes of something to change) and `changes` (what Claude
has changed, for ⚙ and Undo). Nothing is ever
hard-deleted. Records are archived or tombstoned, so a sync can't bring back something removed on
another device. Settings (repo, access key, day start, Gemini key, check-in hour, look) stay on
each device and are never synced, and so do the widget arrangement (`dash_layout`) and the last
successful sync time (`dash_last_synced`).

## Roadmap

1. **Core hub** — built
2. Hebrew auto-tick — practice minutes from the Hebrew app's sync file
3. **Claude skill** — built
4. Job search + Notion — application counts and deadlines from the Job Tracker
5. **Gemini coach** — goal shaping, evening check-in, weekly digest — built
6. Google Calendar — today's events beside the list
