# Task 8: Offline shell and README

Part of [the look, widgets and flags plan](../2026-09-12-look-widgets-flags.md) — read its Global Constraints first.

**Files:**
- Create: `tests/sw.test.js`
- Modify: `sw.js` (one exact edit), `README.md` (seven exact edits)

**Interfaces:**
- Consumes: `APP_VERSION` from `js/flags.js` (Task 4) — the two must always agree, so a flag's
  recorded version always matches the cache it was written under.
- Produces (see the plan's Shared interfaces):
  - `sw.js`: `CACHE = 'dash-v3'`; `SHELL` gains `js/look.js`, `js/layout.js`, `js/flags.js` (with
    the other `js/*.js` files) and `js/ui/widgets.js`, `js/ui/flags.js` (with the other
    `js/ui/*.js` files) — 28 entries in total (23 before this task, plus the 5 new modules).
    `dev/fake-gemini.js` stays out, as before.
  - `tests/sw.test.js`: `CACHE === APP_VERSION`; every `SHELL` entry except `'./'` exists on disk;
    every `.js` file under `js/` (recursively) is listed in `SHELL`; nothing under `dev/` is.
  - `README.md`: carry markers are *amber*, not orange; new sections on the look, arranging the
    widgets, and flags; `js/look.js`, `js/layout.js` and `js/flags.js` in the build table; `flags`
    and the new device-local items in the data line; the tests paragraph mentions the look's
    inline-script check, the palette check, the arrangement and the flag context.

**Why `CACHE` doubles as the flag's app version.** A flag's `ctx.version` (Task 4's `flagContext`)
is meant to answer "which build of the app wrote this" when George — or, later, Claude — reads it
back. The service worker's cache name is already exactly that (it changes whenever the offline
shell changes), so `js/flags.js` reuses it as `APP_VERSION` rather than inventing a second version
string that could drift from the first. `tests/sw.test.js` is what keeps the two honest: it reads
`sw.js` as plain text (the same approach `tests/look.test.js` and `tests/palette.test.js` already
use for `index.html` and `styles.css`) and checks the literal `CACHE` value against the constant.

- [ ] **Step 1: Write the failing tests**

Create `tests/sw.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { APP_VERSION } from '../js/flags.js';

const SW = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

// Every .js file under js/, as a SHELL-style relative path ('js/app.js', 'js/ui/dom.js', ...).
function jsFiles(dir = new URL('../js/', import.meta.url), prefix = 'js/') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? jsFiles(new URL(`${e.name}/`, dir), `${prefix}${e.name}/`)
    : e.name.endsWith('.js') ? [`${prefix}${e.name}`] : []));
}

function shellEntries() {
  const body = SW.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('CACHE is the app version a flag records (js/flags.js), so the two can never drift', () => {
  assert.equal(SW.match(/const CACHE = '([^']+)';/)?.[1], APP_VERSION);
});

test('every SHELL entry exists, apart from "./" (the page itself)', () => {
  for (const entry of shellEntries()) {
    if (entry === './') continue;
    assert.ok(existsSync(new URL(`../${entry}`, import.meta.url)), entry);
  }
});

test('every js/ file is offline-shelled; nothing under dev/ is', () => {
  const shell = shellEntries();
  for (const file of jsFiles()) assert.ok(shell.includes(file), `${file} missing from SHELL`);
  assert.ok(!shell.some((entry) => entry.startsWith('dev/')), 'dev/ is for local testing only');
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `npm test`
Expected: FAIL — all three tests in `tests/sw.test.js`:
- `CACHE is the app version …` — `sw.js` still has `CACHE = 'dash-v2'`, not `'dash-v3'`
- `every SHELL entry exists …` — passes already (nothing removed), so no failure here
- `every js/ file is offline-shelled …` — `js/look.js`, `js/layout.js`, `js/flags.js`,
  `js/ui/widgets.js` and `js/ui/flags.js` are missing from `SHELL`

- [ ] **Step 3: `sw.js`**

Replace:

```js
// Bump CACHE whenever SHELL changes, so activate drops the old cache. dev/fake-gemini.js is left
// out on purpose: it is only for local testing.
const CACHE = 'dash-v2';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/data.js', 'js/doc.js', 'js/dates.js', 'js/parse.js', 'js/schedule.js',
  'js/merge.js', 'js/sync.js', 'js/gemini.js', 'js/coach.js',
  'js/ui/dom.js', 'js/ui/today.js', 'js/ui/side.js', 'js/ui/edit.js', 'js/ui/settings.js', 'js/ui/coach.js',
];
```

with:

```js
// Bump CACHE whenever SHELL changes, so activate drops the old cache. dev/fake-gemini.js is left
// out on purpose: it is only for local testing. CACHE doubles as the app version a flag records
// (js/flags.js's APP_VERSION; tests/sw.test.js checks the two match).
const CACHE = 'dash-v3';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/data.js', 'js/doc.js', 'js/dates.js', 'js/parse.js', 'js/schedule.js',
  'js/merge.js', 'js/sync.js', 'js/gemini.js', 'js/coach.js', 'js/look.js', 'js/layout.js', 'js/flags.js',
  'js/ui/dom.js', 'js/ui/today.js', 'js/ui/side.js', 'js/ui/edit.js', 'js/ui/settings.js', 'js/ui/coach.js',
  'js/ui/widgets.js', 'js/ui/flags.js',
];
```

- [ ] **Step 4: `README.md`**

4a. The carry marker's colour — replace:

```markdown
- **Unfinished tasks carry over** with an orange *from Tue* marker until they're done.
```

with:

```markdown
- **Unfinished tasks carry over** with an amber *from Tue* marker until they're done.
```

4b. The look and Arrange sections, before the coach section — replace:

```markdown
- **Suggestions** from Claude or Gemini show dimmed at the top: ✓ to take one on, ✕ to dismiss it.

## The coach (Gemini)
```

with:

````markdown
- **Suggestions** from Claude or Gemini show dimmed at the top: ✓ to take one on, ✕ to dismiss it.

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
````

4c. The flags section, after the coach section's "Trying it locally" note — replace:

```markdown
http://localhost:8080/?fakegemini. Canned replies stand in for Google, no key is read, and the panel
heading says *fake · ok*. To see a failure, pick a mode: `?fakegemini=slow` (5-second replies),
`nokey`, `quota`, `down`, `offline`, `badkey` or `nonsense`.

## Morning steps (one-off setup, about 10 minutes)
```

with:

```markdown
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

## Morning steps (one-off setup, about 10 minutes)
```

4d. The tests paragraph — replace:

```markdown
Node 24's built-in test runner. There are no dependencies to install. Every pure module (dates,
parsing, scheduling, streaks, history, merge) and the sync flow is covered, including two
simulated devices converging. So are the Gemini client and the coach's context, prompts and reply
checks. They run against a fake `fetch`, so no test ever calls Google.
```

with:

```markdown
Node 24's built-in test runner. There are no dependencies to install. Every pure module (dates,
parsing, scheduling, streaks, history, merge) and the sync flow is covered, including two
simulated devices converging. So are the Gemini client and the coach's context, prompts and reply
checks. They run against a fake `fetch`, so no test ever calls Google. The look's inline `<head>`
script is checked against `resolveLook` for every hour and a spread of settings; the palette check
keeps every colour name in one vocabulary; the widget arrangement (`js/layout.js`) and the flag
context and cap (`js/flags.js`) are fully covered too.
```

4e. The build table — replace:

```markdown
| `js/gemini.js` | The Gemini client: lite model first, fallbacks and retries, plain-English errors |
| `js/coach.js` | What the coach tells Gemini, a week's numbers, the prompts, and the reply checks |
| `js/ui/*.js`, `js/app.js` | The screen |
```

with:

```markdown
| `js/gemini.js` | The Gemini client: lite model first, fallbacks and retries, plain-English errors |
| `js/coach.js` | What the coach tells Gemini, a week's numbers, the prompts, and the reply checks |
| `js/look.js` | Which look (Paper or Night) applies at a given moment |
| `js/layout.js` | The widget arrangement: normalise, move, nudge, hide, show |
| `js/flags.js` | A flag's captured context, its 4 KB cap, and the panel's readers |
| `js/ui/*.js`, `js/app.js` | The screen |
```

4f. The data line — replace:

```markdown
Data lives in one JSON document: `items`, `goals`, `milestones`, `logs`, and `journal` (the
coach's check-ins and weekly digests). Nothing is ever hard-deleted. Records are archived or
tombstoned, so a sync can't bring back something removed on another device. Settings (repo, access
key, day start, Gemini key, check-in hour) stay on each device and are never synced.
```

with:

```markdown
Data lives in one JSON document: `items`, `goals`, `milestones`, `logs`, `journal` (the coach's
check-ins and weekly digests) and `flags` (notes of something to change). Nothing is ever
hard-deleted. Records are archived or tombstoned, so a sync can't bring back something removed on
another device. Settings (repo, access key, day start, Gemini key, check-in hour, look) stay on
each device and are never synced, and so do the widget arrangement (`dash_layout`) and the last
successful sync time (`dash_last_synced`).
```

- [ ] **Step 5: Run the tests and check the syntax**

Run: `npm test`
Expected: PASS — 266 tests (263 after Task 7, plus 3 in `tests/sw.test.js`).

Run: `node --check sw.js`
Expected: no output.

- [ ] **Step 6: Check it in the browser** (controller)

Serve with `preview_start` `dashboard`, open `http://localhost:8080/dev/seed.html?replace`, then
`http://localhost:8080/?fakegemini`. Clear the service worker and caches first, then reload twice:

```js
await Promise.all((await navigator.serviceWorker.getRegistrations()).map((r) => r.unregister()));
await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
location.reload();
```

1. **Offline shell.** The Browser pane normally refuses to register a service worker ("An unknown
   error occurred when fetching the script"), so `navigator.serviceWorker.controller` stays `null`
   there whatever `sw.js` says — that refusal is expected and isn't from this task. If the pane
   *does* run it: `await caches.keys()` includes `'dash-v3'` and not `'dash-v2'`, and
   `await (await caches.open('dash-v3')).match('js/flags.js')`,
   `…match('js/layout.js')`, `…match('js/look.js')`, `…match('js/ui/widgets.js')` and
   `…match('js/ui/flags.js')` are all non-null. Either way, check the list itself from the repo
   root:
   ```bash
   node -e "const fs = require('fs'); const t = fs.readFileSync('sw.js', 'utf8'); const shell = [...t.match(/SHELL = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]); console.log(t.match(/CACHE = '([^']+)'/)[1], shell.length, shell.filter((f) => f !== './' && !fs.existsSync(f)), shell.includes('dev/fake-gemini.js'))"
   ```
   Expected output: `dash-v3 28 [] false` — the new cache name, 28 entries, none missing, and no
   fake module.
2. **README reads cleanly.** The look and Arrange sections sit between "Using it" and "The coach
   (Gemini)"; the Flags section sits between the coach section and "Morning steps"; the build table
   lists `js/look.js`, `js/layout.js` and `js/flags.js`; the data line mentions `flags` and the
   look/arrangement/last-sync-time as device-local; the carry-over bullet says *amber*, not orange.
3. No console errors apart from the Browser pane's service-worker refusal.

- [ ] **Step 7: Commit**

```bash
git add sw.js tests/sw.test.js README.md
git commit -m "Cache the look, layout and flags modules; document the look, Arrange mode and flags" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
