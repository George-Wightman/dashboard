# Task 1: The look — Paper by day, Night in the evening

Part of [the look, widgets and flags plan](../2026-09-12-look-widgets-flags.md) — read its Global Constraints first.

**Files:**
- Create: `js/look.js`, `tests/look.test.js`
- Modify: `index.html` (one exact edit), `manifest.webmanifest` (one exact edit), `js/data.js` (one line),
  `js/app.js` (five exact edits), `js/ui/settings.js` (five exact edits), `tests/journal.test.js` (one line)

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS`, `SETTINGS_KEY`, `createStore` (via `makeStore`) from `js/data.js`;
  `store.settings()` / `store.updateSettings()`; `MemoryStorage`, `makeStore` from `tests/helpers.js`;
  in `js/app.js` the existing `wake()` (called on focus, on becoming visible, and on every
  `'settings'` notification), the one-minute `setInterval`, and the boot lines at the bottom.
- Produces (see the plan's Shared interfaces):
  - `js/look.js`: `LOOK_CHOICES`, `LOOKS`, `THEME_COLORS`, `resolveLook(now, { look, checkinHour, dayStartHour })`.
  - `DEFAULT_SETTINGS` gains `look: 'auto'` (device-local, never synced, like every setting).
  - `index.html`: `<meta name="theme-color" content="#f5f0e7">` followed by the inline `<head>` script
    that sets `data-theme` on `<html>` and the theme-color before the body paints.
  - `js/app.js`: `applyLook()` — sets `document.documentElement.dataset.theme` and the theme-color meta
    from `resolveLook(new Date(), store.settings())`; run at boot, on every minute tick, and from `wake()`
    (focus, visibility, settings changes).
  - ⚙ gains a **Look** select (`name="look"`) with the three choices; Save stores `look`.
  - `manifest.webmanifest`: `theme_color` and `background_color` are `#f5f0e7`.

**Why the rule lives in two places.** `js/app.js` is a module, so it runs after the first paint; a
Night evening would flash Paper for a moment. The inline script in `<head>` runs before the body is
parsed. It reads `localStorage['dash_settings']` the way the store does (defaults first, then whatever
keys were saved — `{ ...DEFAULT_SETTINGS, ...saved }`) and applies the same expression as
`resolveLook`. `tests/look.test.js` pulls the script out of `index.html`, runs it in a `vm` context with
a fake `localStorage`, `Date` and `document`, and checks it against `resolveLook` (fed the settings a
real store reads from the same storage) for every hour and a spread of saved settings — including
none, unreadable JSON, and settings saved before `look` existed. The two can't drift.

Nothing is styled by `data-theme` until Task 2, so after this task the page looks the same; the
attribute and the title-bar colour are already right.

- [ ] **Step 1: Write the failing tests**

Create `tests/look.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { resolveLook, THEME_COLORS, LOOKS, LOOK_CHOICES } from '../js/look.js';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../js/data.js';
import { MemoryStorage, makeStore } from './helpers.js';

const at = (hour, minute = 0) => new Date(2026, 8, 12, hour, minute);
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const nightHours = (settings) => HOURS.filter((h) => resolveLook(at(h, 30), settings) === 'night');

// ---- resolveLook -------------------------------------------------------------------------------

test('resolveLook with the defaults: Night from 18:00 until 04:00, Paper otherwise', () => {
  for (const hour of HOURS) {
    const expected = hour >= 18 || hour < 4 ? 'night' : 'paper';
    for (const minute of [0, 59]) {
      assert.equal(resolveLook(at(hour, minute), { look: 'auto', checkinHour: 18, dayStartHour: 4 }), expected, `${hour}:${minute}`);
    }
    assert.equal(resolveLook(at(hour)), expected, `${hour}:00 with no settings`);
    assert.equal(resolveLook(at(hour), DEFAULT_SETTINGS), expected, `${hour}:00 with DEFAULT_SETTINGS`);
  }
});

test('resolveLook follows custom check-in and day-start hours', () => {
  assert.deepEqual(nightHours({ look: 'auto', checkinHour: 21, dayStartHour: 6 }), [0, 1, 2, 3, 4, 5, 21, 22, 23]);
  assert.deepEqual(nightHours({ look: 'auto', checkinHour: 23, dayStartHour: 0 }), [23]);
  assert.deepEqual(nightHours({ look: 'auto', checkinHour: 12, dayStartHour: 0 }), HOURS.filter((h) => h >= 12));
  assert.deepEqual(nightHours({ look: 'auto', checkinHour: 20, dayStartHour: 12 }),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 20, 21, 22, 23]);
});

test('a fixed look ignores the clock', () => {
  for (const hour of HOURS) {
    assert.equal(resolveLook(at(hour), { look: 'paper', checkinHour: 18, dayStartHour: 4 }), 'paper');
    assert.equal(resolveLook(at(hour), { look: 'night', checkinHour: 18, dayStartHour: 4 }), 'night');
  }
});

test('when the two hours meet (both 12) it is always Night', () => {
  assert.deepEqual(nightHours({ look: 'auto', checkinHour: 12, dayStartHour: 12 }), HOURS);
});

test('an unknown or missing look setting follows the day', () => {
  for (const look of ['bogus', undefined, null, '']) {
    assert.deepEqual(nightHours({ look, checkinHour: 18, dayStartHour: 4 }), [0, 1, 2, 3, 18, 19, 20, 21, 22, 23], String(look));
  }
});

test('the ⚙ choices and the title-bar colours', () => {
  assert.deepEqual(LOOKS, ['auto', 'paper', 'night']);
  assert.deepEqual(LOOK_CHOICES, [
    ['auto', 'Follow the day (Paper, then Night from the check-in hour)'],
    ['paper', 'Paper'],
    ['night', 'Night'],
  ]);
  assert.deepEqual(THEME_COLORS, { paper: '#f5f0e7', night: '#1c232b' });
});

test('look is a device-local setting, auto by default; older saved settings pick it up', () => {
  assert.equal(DEFAULT_SETTINGS.look, 'auto');
  const storage = new MemoryStorage({ [SETTINGS_KEY]: JSON.stringify({ token: 't', repo: 'o/r', dayStartHour: 5, checkinHour: 20 }) });
  const store = makeStore({ storage });
  assert.equal(store.settings().look, 'auto');
  store.updateSettings({ look: 'night' });
  assert.equal(JSON.parse(storage.getItem(SETTINGS_KEY)).look, 'night');
  assert.equal('look' in store.doc(), false);
});

// ---- the inline <head> script and the title bar -------------------------------------------------

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Compiles index.html's one inline script once, and returns a function that runs it against a
// storage and a moment, in a vm context with a fake document, and reports what it set.
function inlineRunner() {
  const scripts = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1, 'index.html has exactly one inline script');
  const script = new vm.Script(scripts[0]);
  const root = { dataset: {} };
  const meta = { content: '' };
  const sandbox = {
    document: { documentElement: root, querySelector: (sel) => (sel === 'meta[name="theme-color"]' ? meta : null) },
  };
  const context = vm.createContext(sandbox);
  return (storage, when) => {
    sandbox.localStorage = storage;
    sandbox.Date = class extends Date {
      constructor(...args) { super(...(args.length ? args : [when.getTime()])); }
    };
    delete root.dataset.theme;
    meta.content = '';
    script.runInContext(context);
    return { theme: root.dataset.theme, color: meta.content };
  };
}

test('index.html sets the look in <head>, before the body paints, after the theme-color meta', () => {
  assert.match(HTML, /<meta name="theme-color" content="#f5f0e7">/);
  const script = HTML.indexOf('<script>');
  assert.ok(script > HTML.indexOf('<meta name="theme-color"'));
  assert.ok(script < HTML.indexOf('</head>'));
});

test('the inline script agrees with resolveLook for every hour and a spread of settings', () => {
  const run = inlineRunner();
  const saves = [null, '{not json', '[]', '"paper"', 'true', '{}', JSON.stringify({ token: 't', repo: 'o/r', dayStartHour: 5 })];
  for (const look of ['auto', 'paper', 'night', 'bogus']) {
    for (const [checkinHour, dayStartHour] of [[18, 4], [12, 12], [23, 0], [20, 6], [12, 0], [21, 12]]) {
      saves.push(JSON.stringify({ look, checkinHour, dayStartHour }));
    }
  }
  saves.push(JSON.stringify({ look: 'night' }), JSON.stringify({ checkinHour: 21 }), JSON.stringify({ dayStartHour: 7 }));
  for (const saved of saves) {
    const storage = new MemoryStorage(saved === null ? {} : { [SETTINGS_KEY]: saved });
    const settings = makeStore({ storage }).settings(); // what the page itself will read
    for (const hour of HOURS) {
      for (const minute of [0, 30]) {
        const when = at(hour, minute);
        const expected = resolveLook(when, settings);
        assert.deepEqual(run(storage, when), { theme: expected, color: THEME_COLORS[expected] }, `${saved} at ${hour}:${minute}`);
      }
    }
  }
});

test('the inline script falls back to the defaults when storage cannot be read', () => {
  const run = inlineRunner();
  const denied = { getItem() { throw new Error('denied'); } };
  assert.equal(run(denied, at(19)).theme, 'night');
  assert.equal(run(denied, at(3)).theme, 'night');
  assert.equal(run(denied, at(10)).theme, 'paper');
});

test('the installed app starts Paper: manifest colours match Paper\'s --bg', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.theme_color, THEME_COLORS.paper);
  assert.equal(manifest.background_color, THEME_COLORS.paper);
});
```

In `tests/journal.test.js`, in the test `settings gain geminiKey and checkinHour; older saved settings pick up the defaults`, replace:

```js
  assert.deepEqual(DEFAULT_SETTINGS, { token: '', repo: '', dayStartHour: 4, geminiKey: '', checkinHour: 18 });
```

with:

```js
  assert.deepEqual(DEFAULT_SETTINGS, { token: '', repo: '', dayStartHour: 4, geminiKey: '', checkinHour: 18, look: 'auto' });
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `npm test`
Expected: FAIL —
- `tests/look.test.js` doesn't load: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/js/look.js'`
- `settings gain geminiKey and checkinHour; older saved settings pick up the defaults` — `DEFAULT_SETTINGS` has no `look`

- [ ] **Step 3: Create `js/look.js`**

```js
// Which look the page wears: Paper & Ink by day, Night in the evening. Pure, so it can be tested.
// index.html carries a copy of the rule in <head> (so a Night evening never flashes Paper), and
// tests/look.test.js runs that copy against this one.

// The ⚙ choices, in order, with their labels.
export const LOOK_CHOICES = [
  ['auto', 'Follow the day (Paper, then Night from the check-in hour)'],
  ['paper', 'Paper'],
  ['night', 'Night'],
];
export const LOOKS = LOOK_CHOICES.map(([value]) => value);

// Each look's --bg (styles.css), for <meta name="theme-color">: the installed app's title bar.
export const THEME_COLORS = { paper: '#f5f0e7', night: '#1c232b' };

// 'paper' or 'night' for a moment. 'auto' (and anything unknown) is Night from the check-in hour
// until the day starts, Paper otherwise — it turns when the coach starts offering the check-in and
// back at the day rollover. With both hours at 12 that is always Night.
export function resolveLook(now, { look = 'auto', checkinHour = 18, dayStartHour = 4 } = {}) {
  if (look === 'paper' || look === 'night') return look;
  const hour = now.getHours();
  return hour >= checkinHour || hour < dayStartHour ? 'night' : 'paper';
}
```

- [ ] **Step 4: The setting's default in `js/data.js`**

Replace:

```js
export const DEFAULT_SETTINGS = { token: '', repo: '', dayStartHour: 4, geminiKey: '', checkinHour: 18 };
```

with:

```js
export const DEFAULT_SETTINGS = { token: '', repo: '', dayStartHour: 4, geminiKey: '', checkinHour: 18, look: 'auto' };
```

- [ ] **Step 5: The inline script in `index.html`**

Replace:

```html
  <meta name="theme-color" content="#f7f7f5">
```

with:

```html
  <meta name="theme-color" content="#f5f0e7">
  <script>
    // The look before the page paints, so a Night evening never flashes Paper. The same rule as
    // resolveLook in js/look.js; tests/look.test.js runs this script to keep the two in step.
    (function () {
      var s = { look: 'auto', checkinHour: 18, dayStartHour: 4 };
      try { var saved = JSON.parse(localStorage.getItem('dash_settings')); for (var k in s) if (saved && k in saved) s[k] = saved[k]; } catch (e) {}
      var h = new Date().getHours();
      var look = s.look === 'paper' || s.look === 'night' ? s.look : (h >= s.checkinHour || h < s.dayStartHour ? 'night' : 'paper');
      document.documentElement.dataset.theme = look;
      document.querySelector('meta[name="theme-color"]').content = look === 'night' ? '#1c232b' : '#f5f0e7';
    })();
  </script>
```

(It must come after the meta tag, which it sets, and stays in `<head>`. It is plain ES5 in an IIFE
so it leaves no globals behind.)

- [ ] **Step 6: The manifest's colours**

In `manifest.webmanifest`, replace:

```json
  "background_color": "#f7f7f5",
  "theme_color": "#f7f7f5",
```

with:

```json
  "background_color": "#f5f0e7",
  "theme_color": "#f5f0e7",
```

- [ ] **Step 7: Apply the look in `js/app.js`**

7a. The imports — replace:

```js
import { checkinNow, writeDigest } from './ui/coach.js';
```

with:

```js
import { checkinNow, writeDigest } from './ui/coach.js';
import { resolveLook, THEME_COLORS } from './look.js';
```

7b. `applyLook`, just above the check-in state — replace:

```js
// The check-in state the Coach panel last showed; the minute tick repaints when it changes.
let shownCheckin = null;
```

with:

```js
// The look (js/look.js): data-theme on <html>, and the title bar's colour. index.html's inline
// script has already set both before the first paint; this keeps them right as the hours pass,
// on focus, and whenever ⚙ changes. Only touches the page when something actually changes.
function applyLook() {
  const look = resolveLook(new Date(), store.settings());
  const root = document.documentElement;
  if (root.dataset.theme !== look) root.dataset.theme = look;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && meta.getAttribute('content') !== THEME_COLORS[look]) meta.setAttribute('content', THEME_COLORS[look]);
}

// The check-in state the Coach panel last showed; the minute tick repaints when it changes.
let shownCheckin = null;
```

7c. On focus, on becoming visible, and on every settings change (all three call `wake()`) — replace:

```js
function wake() {
  checkRollover();
  scheduler.now();
}
```

with:

```js
function wake() {
  applyLook();
  checkRollover();
  scheduler.now();
}
```

7d. On the minute tick — replace:

```js
setInterval(() => {
  checkRollover();
```

with:

```js
setInterval(() => {
  applyLook();
  checkRollover();
```

(Changing `data-theme` repaints colours only; it doesn't rebuild any element, so it never needs the
`typing()` hold-back.)

7e. At boot — replace:

```js
render();
scheduler.now();
```

with:

```js
applyLook();
render();
scheduler.now();
```

- [ ] **Step 8: The Look row in `js/ui/settings.js`**

8a. The opening comment — replace:

```js
// Settings: sync, the day boundary, the coach, and backups. Settings are device-local and never
// synced.
```

with:

```js
// Settings: sync, the day boundary, the coach, the look, and backups. Settings are device-local
// and never synced.
```

8b. The import — replace:

```js
import { hebrewKeys } from '../gemini.js';
```

with:

```js
import { hebrewKeys } from '../gemini.js';
import { LOOK_CHOICES, LOOKS } from '../look.js';
```

8c. The control — replace:

```js
  const checkinHour = h('input', { type: 'number', name: 'checkinHour', min: 12, max: 23, step: 1, value: s.checkinHour });
```

with:

```js
  const checkinHour = h('input', { type: 'number', name: 'checkinHour', min: 12, max: 23, step: 1, value: s.checkinHour });
  const look = h('select', { name: 'look' },
    LOOK_CHOICES.map(([value, label]) => h('option', { value, selected: s.look === value }, label)));
```

8d. Saving it — replace:

```js
      geminiKey: geminiKey.value.trim(), checkinHour: checkin,
    });
```

with:

```js
      geminiKey: geminiKey.value.trim(), checkinHour: checkin,
      look: LOOKS.includes(look.value) ? look.value : 'auto',
    });
```

8e. The row, after the privacy note — replace:

```js
    h('p', { class: 'note' }, "Check-ins and goal shaping send a summary of your list to Google. On Google's free tier they may use it to improve their products."),
```

with:

```js
    h('p', { class: 'note' }, "Check-ins and goal shaping send a summary of your list to Google. On Google's free tier they may use it to improve their products."),
    h('label', { class: 'field' }, h('span', {}, 'Look'), look),
```

Saving calls `updateSettings`, whose `'settings'` notification runs `wake()`, which runs `applyLook()`
— so the page turns the moment ⚙ is saved.

- [ ] **Step 9: Run the tests and check the syntax**

Run: `npm test`
Expected: PASS — 200 tests (189 before, plus 11 in `tests/look.test.js`).

Run: `node --check js/look.js && node --check js/app.js && node --check js/ui/settings.js && node -e "JSON.parse(require('fs').readFileSync('manifest.webmanifest','utf8'))"`
Expected: no output.

- [ ] **Step 10: Check it in the browser** (controller)

Serve with `preview_start` `dashboard`, open `http://localhost:8080/?fakegemini`, reload twice (the
offline cache). The page still looks as before (Task 2 styles the looks); check the attribute and
the title-bar colour:

1. `document.documentElement.dataset.theme` is `'night'` from 18:00 to 03:59 and `'paper'` otherwise;
   `document.querySelector('meta[name="theme-color"]').content` is `#1c232b` / `#f5f0e7` to match.
2. ⚙ shows a **Look** select after the privacy line, reading *Follow the day (Paper, then Night from
   the check-in hour)*. Choose *Night* → **Save** → `dataset.theme === 'night'` at once, meta
   `#1c232b`. Choose *Paper* → `'paper'`, `#f5f0e7`. Back to *Follow the day*.
3. Faking the clock through the settings: with *Follow the day*, set the check-in hour to an hour at
   or before now (e.g. 12 in the afternoon) → **Save** → `'night'`; set it to 23 (before 23:00) →
   `'paper'`.
4. No flash: set *Night* and reload. The inline script has set the attribute before any module
   runs: `document.documentElement.outerHTML.startsWith('<html lang="en-GB" data-theme="night">')`
   → `true`, and the page source shows the script in `<head>`, straight after the theme-color meta.
5. No console errors apart from the Browser pane's service-worker refusal.

- [ ] **Step 11: Commit**

```bash
git add js/look.js tests/look.test.js index.html manifest.webmanifest js/data.js js/app.js js/ui/settings.js tests/journal.test.js
git commit -m "Add the look setting: Paper by day, Night from the check-in hour" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
