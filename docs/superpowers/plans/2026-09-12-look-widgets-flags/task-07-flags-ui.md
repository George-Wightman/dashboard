# Task 7: The ⚑ flag

Part of [the look, widgets and flags plan](../2026-09-12-look-widgets-flags.md) — read its Global Constraints first.

**Files:**
- Create: `js/ui/flags.js`, `tests/flags-ui.test.js`
- Modify: `index.html` (two exact edits), `styles.css` (one block appended), `js/app.js` (eight
  exact edits)

**Interfaces:**
- Consumes: `flagContext`, `flagAbout`, `openFlags`, `addressedCount`, `waitingFlags`,
  `flagSyncLine`, `readLastSynced`, `writeLastSynced`, `APP_VERSION` from `js/flags.js` (Task 4);
  `store.addFlag` / `store.addressFlag` (Task 4); `hebrewKeys` (already used by `js/ui/settings.js`)
  from `js/gemini.js`; `h` from `js/ui/dom.js`; in `js/app.js` the existing `sync` object,
  `runSync()`, `ctx.columnCount()` / `ctx.layout()` (Task 5), `ui.arranging` (Task 6), `store.doc()`
  / `store.subscribe()`, `checkinNow` and `dayCompletion`, already imported.
- Produces (see the plan's Shared interfaces):
  - `js/app.js`: `ctx.syncOn()`, `ctx.lastSynced()`, `ctx.flagState()` (exactly the `FlagState`
    shape the plan's Shared interfaces list); `runSync()` records when a sync started and, on
    success, writes it with `writeLastSynced`; `renderHeader()` toggles `#flag-button`'s `waiting`
    class; a click on `#flag-button` opens the panel.
  - `js/ui/flags.js`: `openFlagPanel(ctx)` — captures `flagContext(ctx.flagState())` once, fills
    `<dialog id="flags">` (the About line, the textarea and Save/Ctrl+Enter, the open flags newest
    first with More details and Mark addressed, the addressed count, and the sync line with Sync
    now), and repaints the list and the sync line on every store change while it's open.
  - `index.html`: `#flag-button` between `#sync-status` and `#arrange-button`; `<dialog id="flags">`
    after `<dialog id="settings">`.
  - `styles.css`: `#flag-button`'s grey/teal states (steady — no animation), and the panel's about
    line, textarea, list and sync line, all from Task 2's tokens, all in `rem` except borders.

**Why `flagState()` lives on `ctx`, not inside `js/ui/flags.js`.** Everything it reads —
`store.settings()`, `document.documentElement.dataset.theme`, `innerWidth`/`innerHeight`,
`ui.arranging`, `sync.state`, `navigator.userAgent` — is page state `js/app.js` already owns;
`js/ui/flags.js` never touches the DOM or `window` directly except to build and show the dialog, so
it stays as easy to reason about as `js/ui/settings.js`. `flagContext` (pure, Task 4) does the
actual scrubbing and shaping; `flagState()` only assembles its raw input.

**Captured once, not live.** `openFlagPanel` calls `flagContext(ctx.flagState())` a single time,
before building the dialog's contents, and closes over the result (`captured`) for both the About
line and `store.addFlag(text, captured)`. Typing in the textarea, another tab syncing, or the check-in
landing while the panel is open must not change what a saved flag says the app was doing — only
opening the panel again captures a fresh moment. The list and the sync line, by contrast, do
repaint live (`store.subscribe`), because they show the *current* flags, not a captured moment.

**`dash_last_synced` is written the moment a sync starts succeeding, not when the panel asks for
one.** `runSync()` (used for every sync — on open, on focus, after a change, and from the panel's
own *Sync now*) is the one place that already knows a sync just went through; recording `started`
(taken **before** the request) rather than "now" means a flag saved while that same sync is still
in flight is correctly still "waiting" — its `updated` is later than `started`.

**Opening the panel never touches the page underneath.** `openFlagPanel` never calls `ctx.render()`;
`repaint()` only replaces the dialog's own `list`, `addressedLine` and `syncLine` elements. The
dialog's `close` event (fired by **Close**, Escape, or `dialog.close()`) unsubscribes from the
store, so a closed, unreferenced panel is never repainted again.

- [ ] **Step 1: Write the failing tests**

Create `tests/flags-ui.test.js`. Like `tests/arrange.test.js`, these check the panel's shape and
wiring against the source (`js/ui/flags.js` builds real `<dialog>` content with `document`, which
plain Node doesn't have; the controller check below drives it for real):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the ⚑ button sits after sync status and before Arrange, and the dialog is after Settings', () => {
  const html = read('index.html');
  assert.match(html, /<button id="sync-status"[^>]*><\/button>\s*<button id="flag-button" class="icon flag-button" type="button" title="Note something to change" aria-label="Note something to change">⚑<\/button>\s*<button id="arrange-button"/);
  assert.match(html, /<dialog id="settings" class="settings"><\/dialog>\s*<dialog id="flags" class="settings flags" aria-label="Flags"><\/dialog>/);
});

test('styles.css gives the ⚑ its grey/teal states, steady, and styles the panel', () => {
  const css = read('styles.css');
  assert.match(css, /#flag-button\.waiting \{ color: var\(--accent\); \}/);
  assert.doesNotMatch(css, /flag-button[\s\S]{0,120}(animation|@keyframes)/);
  for (const selector of ['.flags .about', '.flags textarea', '.flag-list', '.flag-item', '.flag-sync']) {
    assert.ok(css.includes(selector), selector);
  }
});

test('js/ui/flags.js builds the panel from the plan: About, Save/Ctrl+Enter, the list, and the sync line', () => {
  const src = read('js/ui/flags.js');
  assert.match(src, /export function openFlagPanel\(ctx\)/);
  assert.match(src, /flagContext\(ctx\.flagState\(\)\)/);
  assert.match(src, /flagAbout\(captured\)/);
  assert.match(src, /store\.addFlag\(text, captured\)/);
  assert.match(src, /'Write something first\.'/);
  assert.match(src, /status\.textContent = 'Saved\.'/);
  assert.match(src, /e\.key === 'Enter' && \(e\.ctrlKey \|\| e\.metaKey\)/);
  assert.match(src, /openFlags\(doc\)/);
  assert.match(src, /addressFlag\(f\.id\)/);
  assert.match(src, /'Mark addressed'/);
  assert.match(src, /addressedCount\(doc\)/);
  assert.match(src, /flagSyncLine\(syncOn, waiting\)/);
  assert.match(src, /waitingFlags\(doc, ctx\.lastSynced\(\)\)/);
  assert.match(src, /'Sync now'/);
  assert.match(src, /store\.subscribe\(repaint\)/);
  assert.match(src, /dialog\.addEventListener\('close', \(\) => unsubscribe\(\), \{ once: true \}\)/);
  assert.match(src, /dialog\.showModal\(\)/);
  assert.doesNotMatch(src, /ctx\.render\(\)/);
});

test("js/app.js wires ⚑'s state, the last-synced time, and the flag state ctx.flagState() captures", () => {
  const src = read('js/app.js');
  assert.match(src, /import \{ askGemini, geminiKeys, hebrewKeys \} from '\.\/gemini\.js';/);
  assert.match(src, /import \{ readLastSynced, writeLastSynced, waitingFlags, APP_VERSION \} from '\.\/flags\.js';/);
  assert.match(src, /import \{ openFlagPanel \} from '\.\/ui\/flags\.js';/);
  assert.match(src, /syncOn: \(\) => !FAKE && !!store\.settings\(\)\.token && !!store\.settings\(\)\.repo,/);
  assert.match(src, /lastSynced: \(\) => readLastSynced\(localStorage\),/);
  assert.match(src, /flagState: \(\) => \(\{/);
  assert.match(src, /hebrewKey: hebrewKeys\(localStorage\)\.length > 0,/);
  assert.match(src, /version: APP_VERSION,/);
  assert.match(src, /const started = new Date\(\)\.toISOString\(\);/);
  assert.match(src, /if \(result\.ok\) writeLastSynced\(localStorage, started\);/);
  assert.match(src, /getElementById\('flag-button'\)\.classList\.toggle\(\s*'waiting', ctx\.syncOn\(\) && waitingFlags\(store\.doc\(\), ctx\.lastSynced\(\)\)\.length > 0\)/);
  assert.match(src, /getElementById\('flag-button'\)\.addEventListener\('click', \(\) => openFlagPanel\(ctx\)\)/);
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `npm test`
Expected: FAIL — every test in `tests/flags-ui.test.js`: `index.html` has no `#flag-button` or
`#flags` dialog yet; `styles.css` has no `#flag-button.waiting` rule; `js/ui/flags.js` doesn't
exist (`ENOENT`); `js/app.js` has none of the new imports or wiring.

- [ ] **Step 3: `index.html`**

3a. Between `#sync-status` and `#arrange-button` — replace:

```html
      <button id="sync-status" class="link" type="button"></button>
      <button id="arrange-button" class="link" type="button" aria-pressed="false">Arrange</button>
```

with:

```html
      <button id="sync-status" class="link" type="button"></button>
      <button id="flag-button" class="icon flag-button" type="button" title="Note something to change" aria-label="Note something to change">⚑</button>
      <button id="arrange-button" class="link" type="button" aria-pressed="false">Arrange</button>
```

3b. After the Settings dialog — replace:

```html
  <dialog id="settings" class="settings"></dialog>
```

with:

```html
  <dialog id="settings" class="settings"></dialog>
  <dialog id="flags" class="settings flags" aria-label="Flags"></dialog>
```

- [ ] **Step 4: Append the flags block to `styles.css`**

```css

/* Flags (js/ui/flags.js): note something to change, carried to GitHub by the sync. Grey normally;
   teal only while sync is set up and something hasn't reached GitHub yet — steady, never pulsing. */
#flag-button.waiting { color: var(--accent); }
.flags .about { margin: -.4rem 0 .9rem; font-size: .85rem; color: var(--muted); }
.flags textarea {
  width: 100%; padding: .35rem .5rem; resize: vertical;
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-sm);
}
.flags textarea:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); }
.flag-list { list-style: none; margin: 1rem 0 0; padding: 0; max-height: 40vh; overflow: auto; }
.flag-item { margin-bottom: .6rem; padding: .5rem .75rem; font-size: .9rem; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); }
.flag-item .flag-text { margin: 0 0 .25rem; }
.flag-item .flag-meta { margin: 0 0 .25rem; font-size: .8rem; }
.flag-item details { margin-top: .25rem; font-size: .85rem; }
.flag-item pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: .8rem; }
.flag-sync { margin-top: .75rem; font-size: .85rem; color: var(--muted); }
```

(`#flag-button` already gets its grey from the existing `button.icon` rule; this adds only the
teal `waiting` state. `max-height: 40vh` isn't one of `tests/palette.test.js`'s checked properties,
so the viewport unit needs no exception.)

- [ ] **Step 5: Create `js/ui/flags.js`**

```js
// The ⚑ panel: George's notes of something to change, with the About line, the open flags, and
// whether they have reached GitHub. Everything it reads comes from ctx.flagState() (js/app.js),
// captured once when the panel opens (js/flags.js's flagContext), so the note always describes
// the moment he pressed ⚑, not whatever the page has moved on to while he types.

import { h } from './dom.js';
import { flagContext, flagAbout, openFlags, addressedCount, waitingFlags, flagSyncLine } from '../flags.js';

const when = (iso) => new Date(iso).toLocaleString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

// One open flag: his sentence, when, its captured context behind "More details", and a way to
// mark it addressed. Nothing is ever deleted — addressing just archives it (js/data.js).
function flagItem(ctx, f, repaint) {
  return h('li', { class: 'flag-item' },
    h('p', { class: 'flag-text' }, f.text),
    h('p', { class: 'muted flag-meta' }, when(f.updated)),
    h('details', {}, h('summary', {}, 'More details'), h('pre', {}, JSON.stringify(f.ctx, null, 2))),
    h('button', {
      class: 'link', type: 'button',
      onclick: () => { ctx.store.addressFlag(f.id); repaint(); },
    }, 'Mark addressed'));
}

export function openFlagPanel(ctx) {
  const { store } = ctx;
  const dialog = document.getElementById('flags');
  // Captured once, at the moment the panel opens — not re-captured as George types or the page
  // changes underneath the dialog.
  const captured = flagContext(ctx.flagState());

  const textarea = h('textarea', {
    rows: 4, maxlength: 1000, placeholder: 'What would you change about this?',
    'aria-label': 'What would you change about this?',
  });
  const status = h('p', { class: 'error', role: 'status' });
  const list = h('ul', { class: 'flag-list' });
  const addressedLine = h('p', { class: 'muted' }, '');
  const syncLine = h('p', { class: 'flag-sync' });

  function repaint() {
    const doc = store.doc();
    list.replaceChildren(...openFlags(doc).map((f) => flagItem(ctx, f, repaint)));
    const addressed = addressedCount(doc);
    addressedLine.hidden = !addressed;
    addressedLine.textContent = addressed ? `${addressed} addressed` : '';
    const syncOn = ctx.syncOn();
    const waiting = waitingFlags(doc, ctx.lastSynced()).length;
    syncLine.replaceChildren(flagSyncLine(syncOn, waiting));
    if (syncOn && waiting) {
      syncLine.append(' · ', h('button', {
        class: 'link', type: 'button',
        onclick: () => { ctx.syncNow().then(repaint); },
      }, 'Sync now'));
    }
  }

  function save(e) {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text) { status.textContent = 'Write something first.'; return; }
    store.addFlag(text, captured);
    textarea.value = '';
    textarea.focus();
    status.textContent = 'Saved.';
    repaint();
    ctx.syncNow().then(repaint);
  }
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(e); }
  });

  // Repainted on every store change while the panel is open (a sync landing, another window's
  // save, addressing a flag from here); stopped when the dialog closes.
  const unsubscribe = store.subscribe(repaint);
  dialog.addEventListener('close', () => unsubscribe(), { once: true });

  dialog.replaceChildren(
    h('h2', {}, 'Note something to change'),
    h('p', { class: 'about' }, h('strong', {}, 'About: '), flagAbout(captured)),
    h('form', { onsubmit: save },
      textarea,
      status,
      h('div', { class: 'buttons' },
        h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
        h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Close'))),
    list,
    addressedLine,
    syncLine);
  repaint();
  dialog.showModal();
  textarea.focus();
}
```

- [ ] **Step 6: `js/app.js`**

6a. The Hebrew-key check, already used by ⚙ — replace:

```js
import { askGemini, geminiKeys } from './gemini.js';
```

with:

```js
import { askGemini, geminiKeys, hebrewKeys } from './gemini.js';
```

6b. The flags imports, after Task 5's layout import — replace:

```js
import { LAYOUT_KEY, loadLayout, saveLayout, normalizeLayout } from './layout.js';
```

with:

```js
import { LAYOUT_KEY, loadLayout, saveLayout, normalizeLayout } from './layout.js';
import { readLastSynced, writeLastSynced, waitingFlags, APP_VERSION } from './flags.js';
import { openFlagPanel } from './ui/flags.js';
```

6c. `ctx.syncOn`, `ctx.lastSynced` and `ctx.flagState` — replace:

```js
  syncNow: () => scheduler.now(),
  syncProblem: () => (sync.state === 'failing' ? sync.error : ''),
  whenIdle,
```

with:

```js
  syncNow: () => scheduler.now(),
  syncProblem: () => (sync.state === 'failing' ? sync.error : ''),
  // Whether sync is actually set up (never true in fake mode, which never syncs), and when it
  // last succeeded (js/flags.js): together these decide the ⚑'s teal "waiting" state.
  syncOn: () => !FAKE && !!store.settings().token && !!store.settings().repo,
  lastSynced: () => readLastSynced(localStorage),
  // What the app was doing right now, for the ⚑ panel (js/ui/flags.js) to capture the instant it
  // opens (js/flags.js's flagContext reads exactly this shape).
  flagState: () => ({
    now: new Date(),
    today: store.today(),
    settings: store.settings(),
    look: document.documentElement.dataset.theme,
    window: { width: innerWidth, height: innerHeight },
    columns: ctx.columnCount(),
    layout: ctx.layout(),
    arranging: ui.arranging,
    day: dayCompletion(store.doc(), store.today()),
    expandedGoals: ui.expandedGoals.size,
    historyDay: ui.historyDay,
    coach: {
      checkin: checkinNow(ctx), busy: ui.coach.busy, shapeBusy: ui.coach.shapeBusy, digestBusy: ui.coach.digestBusy,
      error: ui.coach.error, shapeError: ui.coach.shapeError, digestError: ui.coach.digestError,
    },
    sync: { state: sync.state, error: sync.error, lastSynced: readLastSynced(localStorage) },
    hebrewKey: hebrewKeys(localStorage).length > 0,
    version: APP_VERSION,
    userAgent: navigator.userAgent,
  }),
  whenIdle,
```

6d. `runSync()` records when it started, and writes it on success — replace:

```js
  sync.state = 'syncing';
  renderHeader();
  try {
    const result = await syncOnce({ store, client: createGitHubClient({ token, repo }) });
    Object.assign(sync, result.ok
      ? { state: 'ok', at: new Date(), error: null }
      : { state: 'failing', error: result.error });
  } catch (e) {
```

with:

```js
  sync.state = 'syncing';
  renderHeader();
  try {
    // Recorded before the request, so a flag saved while this sync is still in flight still
    // counts as "waiting" (js/flags.js's waitingFlags).
    const started = new Date().toISOString();
    const result = await syncOnce({ store, client: createGitHubClient({ token, repo }) });
    Object.assign(sync, result.ok
      ? { state: 'ok', at: new Date(), error: null }
      : { state: 'failing', error: result.error });
    if (result.ok) writeLastSynced(localStorage, started);
  } catch (e) {
```

6e. `renderHeader()`, the ⚑'s waiting state — replace:

```js
  status.classList.toggle('sync-failing', sync.state === 'failing');

  const arrangeButton = document.getElementById('arrange-button');
```

with:

```js
  status.classList.toggle('sync-failing', sync.state === 'failing');

  document.getElementById('flag-button').classList.toggle(
    'waiting', ctx.syncOn() && waitingFlags(store.doc(), ctx.lastSynced()).length > 0);

  const arrangeButton = document.getElementById('arrange-button');
```

6f. The click handler, alongside sync-status and Arrange's — replace:

```js
document.getElementById('sync-status').addEventListener('click', () => (sync.state === 'failing' ? ctx.openSettings() : scheduler.now()));
document.getElementById('arrange-button').addEventListener('click', () => setArranging(ctx, !ui.arranging));
```

with:

```js
document.getElementById('sync-status').addEventListener('click', () => (sync.state === 'failing' ? ctx.openSettings() : scheduler.now()));
document.getElementById('flag-button').addEventListener('click', () => openFlagPanel(ctx));
document.getElementById('arrange-button').addEventListener('click', () => setArranging(ctx, !ui.arranging));
```

- [ ] **Step 7: Run the tests and check the syntax**

Run: `npm test`
Expected: PASS — 263 tests (259 after Task 6, plus 4 in `tests/flags-ui.test.js`).

Run: `node --check js/ui/flags.js && node --check js/app.js`
Expected: no output.

- [ ] **Step 8: Check it in the browser** (controller; never type a real key or token — the dummy
  values below only, and only with `?fakegemini` in the address)

Serve with `preview_start` `dashboard`. Open `http://localhost:8080/dev/seed.html?replace`, then
`http://localhost:8080/?fakegemini`. Clear the service worker and caches first, then reload twice:

```js
await Promise.all((await navigator.serviceWorker.getRegistrations()).map((r) => r.unregister()));
await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
location.reload();
```

Check both looks at least once (⚙ → Look).

1. **The button starts grey.** `getComputedStyle(document.getElementById('flag-button')).color`
   matches `.muted` (no sync repo set yet in this profile — if one is, skip to item 4 instead of
   setting a dummy repo over it). ⚑'s title and `aria-label` both read "Note something to change".
2. **Save, and the About line.** Click ⚑: the dialog shows "Note something to change", then
   "**About:** " followed by a line like "Today · Night look · 3 of 8 done · Coach: check-in
   waiting" (or whatever the seed's actual state is — it should read sensibly, never blank, never a
   raw object). The textarea is focused. Type "The streak text is hard to read" and press
   **Save**: the box clears (still focused), "Saved." appears, and the sentence appears at the top
   of the list below, with a "More details" toggle and "Mark addressed". Press Ctrl+Enter after
   typing a second note instead of clicking Save — same result, and it lands above the first (newest
   first).
3. **More details.** Open it on either flag: a formatted JSON block with `set: { repo: false,
   token: false, geminiKey: false, hebrewKey: <boolean> }` (or `true` for whichever keys this
   profile actually has) and no `token`/`geminiKey`/`repo` string values anywhere in it. Set a dummy
   Gemini key first (`localStorage.setItem('hvr_geminikey', 'dummy-hebrew-key-xxxxxxxx')` if neither
   Hebrew key is already set — remove it afterwards), write a third flag, and confirm
   `!document.documentElement.outerHTML.includes('dummy-hebrew-key-xxxxxxxx')` → `true` even though
   its `More details` is open in the DOM.
4. **Mark addressed.** Click it on one flag: it disappears from the open list and "1 addressed"
   appears at the foot, above the sync line. Reopen the panel (close and click ⚑ again): the
   addressed one stays gone from the open list and the count is still there.
5. **The three sync lines, and the ⚑ turning teal.** With no repo/token set: the foot line reads
   "Sync is off — flags stay on this device until you add the sync repo in ⚙", ⚑ stays grey however
   many flags are open. Point ⚙ at a dummy repo and token (`George-Wightman/dummy-repo` /
   `dummy-token-for-test`, never a real one, and leave `?fakegemini` in the address so nothing
   really syncs) and reopen the panel: since nothing has ever synced,
   `localStorage.getItem('dash_last_synced')` is still `null`, so the line reads "N flags haven't
   reached GitHub yet · Sync now" and ⚑ is teal
   (`getComputedStyle(document.getElementById('flag-button')).color` now matches `.accent`). Run
   `localStorage.setItem('dash_last_synced', new Date().toISOString())` and reopen the panel: "All
   flags have reached GitHub", no "Sync now" link, and ⚑ is grey again. Write one more flag and
   reopen: back to "1 flag hasn't reached GitHub yet · Sync now" and ⚑ teal. Afterwards, clear the
   dummy repo/token from ⚙ and `localStorage.removeItem('dash_last_synced')`.
6. **Opening the panel changes nothing underneath.** Note `document.getElementById('side').outerHTML`
   before opening ⚑, open it, close it (Close, then Escape, then clicking the backdrop — all three
   close it) — the side column's markup is byte-for-byte the same each time.
7. No console errors apart from the Browser pane's service-worker refusal.

- [ ] **Step 9: Commit**

```bash
git add js/ui/flags.js tests/flags-ui.test.js index.html styles.css js/app.js
git commit -m "Add the flag panel: About, save, address, and the three sync lines" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
