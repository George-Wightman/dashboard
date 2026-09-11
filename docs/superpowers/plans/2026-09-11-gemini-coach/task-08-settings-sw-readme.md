# Task 8: Settings, offline shell, README

Part of [the Gemini coach plan](../2026-09-11-gemini-coach.md) — read its Global Constraints first.

**Files:**
- Modify: `js/ui/settings.js` (replaced in full), `sw.js` (one exact edit), `README.md` (six exact edits)

**Interfaces:**
- Consumes: `hebrewKeys` from `js/gemini.js` (Task 2); `DEFAULT_SETTINGS.geminiKey` / `checkinHour`
  and `updateSettings` on the store (Task 1). The `'settings'` notification already re-renders the
  whole page, so the Coach panel picks up a new key or check-in hour at once.
- Produces:
  - In ⚙, after the day-start note:
    - a **Gemini API key (optional)** password field;
    - the note "Leave blank to use the Hebrew app's key on this device." followed by " One was found
      here." or " None was found here.";
    - an **Evening check-in from (hour, 12–23)** number field;
    - the privacy line, verbatim.
  - **Save** refuses a check-in hour that isn't a whole number from 12 to 23, with "The check-in hour
    must be a whole hour from 12 to 23.", and stores `geminiKey` (trimmed) and `checkinHour` along
    with the rest.
  - `sw.js`: `CACHE = 'dash-v2'`, and `SHELL` gains `js/gemini.js`, `js/coach.js` and `js/ui/coach.js`.
    `dev/fake-gemini.js` stays out of it.
  - `README.md`: a "The coach (Gemini)" section; the build table, data line, settings line, tests
    paragraph, opening line and roadmap brought up to date.

**The key on screen:** it never appears in the page. The field is a password field, so it shows as
dots, and its value is set as the input's `value` **property**, not an attribute, so it isn't in the
page's markup either. The note says only whether a Hebrew-app key exists, never what it is. Nothing
in this task logs or prints a key.

- [ ] **Step 1: Replace `js/ui/settings.js`**

```js
// Settings: sync, the day boundary, the coach, and backups. Settings are device-local and never
// synced.

import { h } from './dom.js';
import { hebrewKeys } from '../gemini.js';

export function openSettings(ctx) {
  const { store } = ctx;
  const dialog = document.getElementById('settings');
  const s = store.settings();

  const repo = h('input', { type: 'text', name: 'repo', value: s.repo, placeholder: 'George-Wightman/dashboard-sync', spellcheck: 'false' });
  const token = h('input', { type: 'password', name: 'token', value: s.token, autocomplete: 'off', spellcheck: 'false' });
  const dayStart = h('input', { type: 'number', name: 'dayStartHour', min: 0, max: 12, step: 1, value: s.dayStartHour });
  // The Gemini key goes in as the field's live value, never as an attribute, so it can't end up in
  // the page's markup; as a password field it never shows on screen either.
  const geminiKey = h('input', { type: 'password', name: 'geminiKey', autocomplete: 'off', spellcheck: 'false' });
  geminiKey.value = s.geminiKey ?? '';
  const checkinHour = h('input', { type: 'number', name: 'checkinHour', min: 12, max: 23, step: 1, value: s.checkinHour });
  // Whether the Hebrew app has saved a key on this device (same origin, same localStorage). Only
  // the fact is shown, never the key.
  const hebrewFound = hebrewKeys(localStorage).length > 0;
  const status = h('div', { class: 'error', role: 'status' });
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const problem = ctx.syncProblem();
  const syncStatus = problem ? h('p', { class: 'error' }, `Last sync failed: ${problem}`) : null;

  file.addEventListener('change', async () => {
    const chosen = file.files[0];
    if (!chosen) return;
    try {
      store.importJson(await chosen.text());
      status.textContent = 'Backup merged in.';
    } catch (e) {
      status.textContent = e.message;
    }
    file.value = '';
  });

  function save(e) {
    e.preventDefault();
    const hour = Number(dayStart.value);
    if (!(Number.isInteger(hour) && hour >= 0 && hour <= 12)) {
      status.textContent = 'The day start must be a whole hour from 0 to 12.';
      return;
    }
    const checkin = Number(checkinHour.value); // an empty box is 0, so it fails too
    if (!(Number.isInteger(checkin) && checkin >= 12 && checkin <= 23)) {
      status.textContent = 'The check-in hour must be a whole hour from 12 to 23.';
      return;
    }
    const repoValue = repo.value.trim();
    if (repoValue && !/^[\w.-]+\/[\w.-]+$/.test(repoValue)) {
      status.textContent = 'The repo should look like owner/name.';
      return;
    }
    store.updateSettings({
      repo: repoValue, token: token.value.trim(), dayStartHour: hour,
      geminiKey: geminiKey.value.trim(), checkinHour: checkin,
    });
    dialog.close();
  }

  function exportBackup() {
    const url = URL.createObjectURL(new Blob([store.exportJson()], { type: 'application/json' }));
    const link = h('a', { href: url, download: `dashboard-backup-${store.today()}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  dialog.replaceChildren(h('form', { onsubmit: save },
    h('h2', {}, 'Settings'),
    syncStatus,
    h('label', { class: 'field' }, h('span', {}, 'Sync repo'), repo),
    h('label', { class: 'field' }, h('span', {}, 'GitHub access key'), token),
    h('p', { class: 'note' }, 'A fine-grained token with Contents read and write on the sync repo only. It stays on this device and is never synced.'),
    h('label', { class: 'field' }, h('span', {}, 'The day starts at (hour, 0–12)'), dayStart),
    h('p', { class: 'note' }, 'Anything done before this hour counts as the day before.'),
    h('label', { class: 'field' }, h('span', {}, 'Gemini API key (optional)'), geminiKey),
    h('p', { class: 'note' }, `Leave blank to use the Hebrew app's key on this device.${hebrewFound ? ' One was found here.' : ' None was found here.'}`),
    h('label', { class: 'field' }, h('span', {}, 'Evening check-in from (hour, 12–23)'), checkinHour),
    h('p', { class: 'note' }, "Check-ins and goal shaping send a summary of your list to Google. On Google's free tier they may use it to improve their products."),
    status,
    h('div', { class: 'buttons' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancel')),
    h('hr'),
    h('div', { class: 'buttons' },
      h('button', { class: 'btn', type: 'button', onclick: () => { ctx.syncNow(); dialog.close(); } }, 'Sync now'),
      h('button', { class: 'btn', type: 'button', onclick: exportBackup }, 'Export backup'),
      h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, 'Import backup…'),
      file)));
  dialog.showModal();
}
```

- [ ] **Step 2: The offline shell in `sw.js`**

Replace:

```js
const CACHE = 'dash-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/data.js', 'js/doc.js', 'js/dates.js', 'js/parse.js', 'js/schedule.js',
  'js/merge.js', 'js/sync.js',
  'js/ui/dom.js', 'js/ui/today.js', 'js/ui/side.js', 'js/ui/edit.js', 'js/ui/settings.js',
];
```

with:

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

(Requests to Google are cross-origin POSTs, which the fetch handler already leaves alone.)

- [ ] **Step 3: `README.md`**

3a. The opening — replace:

```markdown
Piece 1 of 6. The design is in [`docs/superpowers/specs/`](docs/superpowers/specs/), and the
build plan is in [`docs/superpowers/plans/`](docs/superpowers/plans/).
```

with:

```markdown
Pieces 1 and 5 of 6: the core hub and the Gemini coach. The designs are in
[`docs/superpowers/specs/`](docs/superpowers/specs/), and the build plans are in
[`docs/superpowers/plans/`](docs/superpowers/plans/).
```

3b. The coach section, after "Using it" — replace:

```markdown
- **Suggestions** from Claude or Gemini show dimmed at the top: ✓ to take one on, ✕ to dismiss it.

## Morning steps (one-off setup, about 10 minutes)
```

with:

````markdown
- **Suggestions** from Claude or Gemini show dimmed at the top: ✓ to take one on, ✕ to dismiss it.

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

## Morning steps (one-off setup, about 10 minutes)
````

3c. Tests — replace:

```markdown
Node 24's built-in test runner. There are no dependencies to install. Every pure module (dates,
parsing, scheduling, streaks, history, merge) and the sync flow is covered, including two
simulated devices converging.
```

with:

```markdown
Node 24's built-in test runner. There are no dependencies to install. Every pure module (dates,
parsing, scheduling, streaks, history, merge) and the sync flow is covered, including two
simulated devices converging. So are the Gemini client and the coach's context, prompts and reply
checks. They run against a fake `fetch`, so no test ever calls Google.
```

3d. The build table — replace:

```markdown
| `js/sync.js` | GitHub read/merge/write with retry, and the sync timer |
```

with:

```markdown
| `js/sync.js` | GitHub read/merge/write with retry, and the sync timer |
| `js/gemini.js` | The Gemini client: lite model first, fallbacks and retries, plain-English errors |
| `js/coach.js` | What the coach tells Gemini, a week's numbers, the prompts, and the reply checks |
```

3e. The data and settings lines — replace:

```markdown
Data lives in one JSON document: `items`, `goals`, `milestones`, `logs`. Nothing is ever
hard-deleted. Records are archived or tombstoned, so a sync can't bring back something removed on
another device. Settings (repo, key, day start) stay on each device and are never synced.
```

with:

```markdown
Data lives in one JSON document: `items`, `goals`, `milestones`, `logs`, and `journal` (the
coach's check-ins and weekly digests). Nothing is ever hard-deleted. Records are archived or
tombstoned, so a sync can't bring back something removed on another device. Settings (repo, access
key, day start, Gemini key, check-in hour) stay on each device and are never synced.
```

3f. The roadmap — replace:

```markdown
1. **Core hub** — this
```

with:

```markdown
1. **Core hub** — built
```

and replace:

```markdown
5. Gemini coach — goal shaping, evening check-in, weekly digest
```

with:

```markdown
5. **Gemini coach** — goal shaping, evening check-in, weekly digest — built
```

- [ ] **Step 4: Run the tests and check the syntax**

Run: `npm test`
Expected: PASS — 176 tests.

Run: `node --check js/ui/settings.js && node --check sw.js`
Expected: no output.

- [ ] **Step 5: Check it in the browser** (controller; **never** type or paste a real key — only
  the dummy values below, and only with `?fakegemini` in the address, so no request can reach Google)

Serve with `preview_start` `dashboard`, open `http://localhost:8080/dev/seed.html?replace`, then
`http://localhost:8080/?fakegemini`. Reload **twice**, because of the offline cache (see item 6).

1. **The fields** — ⚙ shows, after "Anything done before this hour counts as the day before.":
   *Gemini API key (optional)* (a password field), then "Leave blank to use the Hebrew app's key on
   this device. None was found here." (or "One was found here." if this browser happens to have one
   on localhost). Then *Evening check-in from (hour, 12–23)* showing 18, and the privacy line:
   "Check-ins and goal shaping send a summary of your list to Google. On Google's free tier they
   may use it to improve their products."
2. **The hour is checked** — empty the check-in hour box and press **Save**: "The check-in hour
   must be a whole hour from 12 to 23.", and the dialog stays open. Try 11, 24 and 12.5 too. The
   browser's own number check (`min`, `max`, `step`) stops each of these first with its own
   bubble, as it already does for the day start. The dialog stays open and nothing is saved.
3. **The hour moves the panel** (with no check-in yet today):
   - Set the hour to 12 and **Save**. At any time except 04:00–11:59, the panel shows **Start
     today's check-in** straight away (a `'settings'` re-render).
   - Set it to 23 and **Save**. Before 23:00, it shows "Evening check-in from 11pm · check in now".
     (Skip this after 23:00, or between midnight and 04:00, when 23 has already passed.)
   - Set it back to 18. It reads "from 6pm" before 18:00 and shows the button after.
4. **The key never appears in the page** — type `dummy-key-for-test` into the Gemini key field and
   **Save**. Then:
   - `JSON.parse(localStorage.getItem('dash_settings')).geminiKey === 'dummy-key-for-test'` → `true`
     (a comparison only).
   - `!localStorage.getItem('dash_data').includes('dummy-key-for-test')` → `true` (settings never
     go into the synced document).
   - Reopen ⚙. The field shows dots. `document.documentElement.outerHTML.includes('dummy-key-for-test')` → `false`.
   - The panel in fake mode is unchanged (the fake ignores keys).
   - Clear the field, **Save**, and confirm `JSON.parse(localStorage.getItem('dash_settings')).geminiKey === ''` → `true`.
5. **Hebrew-key detection** — only if
   `localStorage.getItem('hvr_geminikey') === null && localStorage.getItem('hvr_geminikey2') === null`
   is `true` (so nothing real is touched): run `localStorage.setItem('hvr_geminikey', 'dummy-hebrew-key')`,
   reopen ⚙ → "… One was found here.". Then run `localStorage.removeItem('hvr_geminikey')` (the dummy
   just set), reopen ⚙ → "… None was found here.". If either was already set, skip this and don't
   touch them.
6. **Offline shell** — the Browser pane refuses to register service workers: `register` fails with
   "An unknown error occurred when fetching the script", and the server log shows no `GET /sw.js`.
   So `navigator.serviceWorker.controller` is null there, whatever `sw.js` says. If the pane *does*
   run it: `await caches.keys()` includes `'dash-v2'` and no longer `'dash-v1'`, and each of
   `await (await caches.open('dash-v2')).match('js/gemini.js')`, `…match('js/coach.js')` and
   `…match('js/ui/coach.js')` is non-null. Either way, check the list itself from the repo root:
   ```bash
   node -e "const fs = require('fs'); const t = fs.readFileSync('sw.js', 'utf8'); const shell = [...t.match(/SHELL = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]); console.log(t.match(/CACHE = '([^']+)'/)[1], shell.length, shell.filter((f) => f !== './' && !fs.existsSync(f)), shell.includes('dev/fake-gemini.js'))"
   ```
   Expected output: `dash-v2 23 [] false` — the new cache name, 23 entries, none missing, and no fake.
7. **README** — the new "The coach (Gemini)" section reads cleanly. The build table lists
   `js/gemini.js` and `js/coach.js`, and the roadmap marks 1 and 5 as built.
8. No console errors apart from the Browser pane's service-worker refusal ("An unknown error
   occurred when fetching the script"), which shows on every load and isn't from this task.

- [ ] **Step 6: Commit**

```bash
git add js/ui/settings.js sw.js README.md
git commit -m "Add the Gemini key and check-in hour to settings; cache the coach; document it" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
