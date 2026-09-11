# Today — a personal dashboard

Open the laptop, it's already on screen: what have I got today, tick things off as I go.
One screen: today's list (tasks, habits, weekly targets), this week's bars, goals, and the last
three weeks. Works offline and syncs between the laptop and the phone through a private GitHub
repo.

Piece 1 of 6. The design is in [`docs/superpowers/specs/`](docs/superpowers/specs/), and the
build plan is in [`docs/superpowers/plans/`](docs/superpowers/plans/).

## Using it

- **Add a task:** type in the box under the list and press Enter. Pick *Tomorrow* or a date if
  it isn't for today.
- **Habits, weekly targets and goals:** *New habit, quota or goal…* under the list, or *+ goal*
  in the Goals panel. Click any row's title to edit it. Archive instead of deleting — history is kept.
- **Weekly targets:** **+** adds 1 (shift-click to type an amount). For time targets, **+** asks
  for an amount: `45m`, `1.5h`, `1h30`. Click the count to see or remove this week's entries.
- **Unfinished tasks carry over** with an orange *from Tue* marker until they're done.
- **The day starts at 4am**, so a late night still counts as the day before (change it in ⚙).
- **Suggestions** from Claude or Gemini show dimmed at the top: ✓ to take one on, ✕ to dismiss it.

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
4. **Connect the laptop.** Open the site, then ⚙ → Sync repo `George-Wightman/dashboard-sync`,
   and paste the key → Save. The header should change to *synced HH:MM*.
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
fetches the new one.

## Tests

```
npm test
```

Node 24's built-in test runner. There are no dependencies to install. Every pure module (dates,
parsing, scheduling, streaks, history, merge) and the sync flow is covered, including two
simulated devices converging.

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
| `js/ui/*.js`, `js/app.js` | The screen |
| `sw.js`, `manifest.webmanifest` | Offline and install |

Data lives in one JSON document: `items`, `goals`, `milestones`, `logs`. Nothing is ever
hard-deleted. Records are archived or tombstoned, so a sync can't bring back something removed on
another device. Settings (repo, key, day start) stay on each device and are never synced.

## Roadmap

1. **Core hub** — this
2. Hebrew auto-tick — practice minutes from the Hebrew app's sync file
3. Claude connector + skill — Claude can see the dashboard and add to it from any chat
4. Job search + Notion — application counts and deadlines from the Job Tracker
5. Gemini coach — goal shaping, evening check-in, weekly digest
6. Google Calendar — today's events beside the list
