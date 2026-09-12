# Task 6: Arrange mode

Part of [the look, widgets and flags plan](../2026-09-12-look-widgets-flags.md) — read its Global Constraints first.

**Files:**
- Create: `tests/arrange.test.js`
- Modify: `index.html` (two exact edits), `styles.css` (one block appended), `js/ui/widgets.js`
  (replaced in full), `js/app.js` (six exact edits)

**Interfaces:**
- Consumes: `moveWidget`, `nudgeWidget`, `hideWidget`, `showWidget`, `visibleColumns` from
  `js/layout.js` (Task 3); `h` from `js/ui/dom.js`; the drag-and-drop pattern already used for
  Today's rows in `js/ui/today.js` (`enableDrag`: `dragstart`/`dragover`/`dragleave`/`drop`,
  `dataTransfer`); in `js/app.js` the existing `renderHeader()`, `ui`, `ctx.layout()` /
  `ctx.setLayout()` / `ctx.columnCount()` from Task 5, and the `.today` / `#list` / `#add` elements
  `typing()` already treats as the whole editable area.
- Produces (see the plan's Shared interfaces):
  - `js/ui/widgets.js` gains `setArranging(ctx, on)` and draws every visible widget in a dashed
    `.widget-frame` while `ctx.ui.arranging` is true, with a grip (`.grip`, draggable) or, on a
    touch device or whenever only one widget column shows, `↑ ↓` buttons (`.nudge`); a **Hide**
    link; a placeholder when the widget has nothing to show; a trailing `.drop-zone` in each
    two-column view column; a `.column-break` divider in the one-column view; and an `.add-widget`
    row of `+ Title` chips for hidden widgets.
  - `js/app.js`: `ui.arranging` (new field, default `false`); the `#arrange-button` click toggles
    it via `setArranging`; `renderHeader()` sets the button's label (**Arrange** / **Done**) and
    `aria-pressed`, toggles `.arranging` on `.today`, and shows/hides `#arrange-note`; `Escape`
    leaves Arrange mode unless a `<dialog>` is open or the edit panel is showing.
  - `index.html`: `#arrange-button` in `.top-actions`, just before `#settings-button`; `#arrange-note`
    as the first child of `<section class="today">`.
  - `styles.css`: the dashed frames, the grip and nudge buttons, the drop targets, the divider, the
    chips, and dimming `#list` / `#add` while arranging — all from Task 2's tokens, all in `rem`
    except borders (`tests/palette.test.js` already checks this for every file).

**Why `ui.arranging` isn't added until now.** The plan's file map lists it as part of `js/app.js`'s
work, but nothing in Task 5 reads or writes it — only Arrange mode does — so it is added here,
alongside the button and the CSS class that use it, rather than sitting unused for a task.

**Reusing the list's drag and drop.** `js/ui/today.js`'s `enableDrag` is the model: a
`dragstart` puts the id in `dataTransfer` (a different MIME type, `text/x-widget`, so a widget
can never be dropped as if it were a task row, or vice versa); `dragover` calls
`preventDefault()` only when that type is present and adds `.drop-before`; `dragleave` removes it;
`drop` reads the id back and calls the layout function. `js/ui/widgets.js`'s `enableDropBefore`
does exactly this for a widget frame or a drop zone, parameterised by which column and which
`beforeId` (`null` for a drop zone, meaning "the end").

**Why the one-column view has no drop zones.** `useNudge` — `ctx.columnCount() === 1` or
`(pointer: coarse)` — is exactly when the grip is replaced by `↑ ↓`, so whenever there is no grip
there is nothing to drag, and no drop target is drawn either. The one-column view still draws
both of `visibleColumns(layout, 2)`'s columns, in order, with the `.column-break` divider between
them (design decision, plan overview): this is the only way `nudgeWidget`'s crossing step — down
from the bottom of column 0 to the top of column 1 — is visible when the page can only show one
list, since the widget's on-screen position in that combined list doesn't otherwise change on that
press.

**Widget content is inert while arranging.** `.widget-frame > :not(.widget-bar) { pointer-events:
none; }` stops a click inside a dashed widget (a goal, a bar, the Coach's buttons) from doing
anything while its frame can be dragged or hidden; only the bar (grip/nudge, title, Hide) responds.
Today's list and add box are dimmed the same way (`.today.arranging .list, .today.arranging .add`).

**`matchMedia` is read lazily.** `js/ui/widgets.js` is imported directly by
`tests/widgets.test.js` and `tests/arrange.test.js` under plain Node, which has no `matchMedia`.
`isCoarsePointer()` calls it only when `useNudge` is actually asked (in a real page render), never
at module load, so importing the module in a test never throws.

- [ ] **Step 1: Write the failing tests**

Create `tests/arrange.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setArranging } from '../js/ui/widgets.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('setArranging flips ui.arranging on ctx and re-renders', () => {
  const calls = [];
  const ctx = { ui: { arranging: false }, render: () => calls.push(ctx.ui.arranging) };
  setArranging(ctx, true);
  assert.equal(ctx.ui.arranging, true);
  setArranging(ctx, false);
  assert.equal(ctx.ui.arranging, false);
  assert.deepEqual(calls, [true, false]);
});

test('the Arrange link sits before ⚙, and the dimmed note is the first thing in Today', () => {
  const html = read('index.html');
  assert.match(html, /<button id="arrange-button" class="link" type="button" aria-pressed="false">Arrange<\/button>\s*<button id="settings-button"/);
  assert.match(html, /<section class="today" aria-label="Today">\s*<p id="arrange-note" class="arrange-note" hidden>Today's list stays here<\/p>\s*<ul id="list"/);
});

test('js/ui/widgets.js builds a frame with a grip or ↑ ↓, Hide, a placeholder, drop zones and the divider', () => {
  const src = read('js/ui/widgets.js');
  assert.match(src, /export function setArranging\(ctx, on\)/);
  assert.match(src, /class: 'widget-frame', 'data-widget': id/);
  assert.match(src, /class: 'grip', draggable: 'true', title: 'Drag to move'/);
  assert.match(src, /class: 'nudge'/);
  assert.match(src, /nudgeWidget\(ctx\.layout\(\), id, -1\)/);
  assert.match(src, /nudgeWidget\(ctx\.layout\(\), id, 1\)/);
  assert.match(src, /'Hide'/);
  assert.match(src, /hideWidget\(ctx\.layout\(\), id\)/);
  assert.match(src, /showWidget\(ctx\.layout\(\), id\)/);
  assert.match(src, /moveWidget\(ctx\.layout\(\), dragged, col, beforeId\)/);
  assert.match(src, /'Nothing to show yet'/);
  assert.match(src, /class: 'drop-zone'/);
  assert.match(src, /'Second column on wide windows'/);
  assert.match(src, /class: 'add-widget'/);
  assert.match(src, /\+ \$\{titleOf\(id\)\}/);
  assert.match(src, /pointer: coarse/);
  assert.match(src, /useNudge = \(ctx\) => ctx\.columnCount\(\) === 1 \|\| isCoarsePointer\(\)/);
});

test('styles.css styles the frames, the drop targets and dims the list while arranging', () => {
  const css = read('styles.css');
  for (const selector of [
    '.arrange-note', '.widget-frame', '.widget-bar', '.grip', '.nudge', '.placeholder',
    '.drop-zone', '.column-break', '.add-widget', '.chip',
  ]) {
    assert.ok(css.includes(selector), selector);
  }
  assert.match(css, /\.today\.arranging \.list, \.today\.arranging \.add \{ opacity: \.5; pointer-events: none; \}/);
  assert.match(css, /\.widget-frame > :not\(\.widget-bar\) \{ pointer-events: none; \}/);
});

test("js/app.js wires the Arrange button, the header's Arrange/Done label, and Escape", () => {
  const src = read('js/app.js');
  assert.match(src, /import \{ renderSide, WIDGET_IDS, setArranging \} from '\.\/ui\/widgets\.js';/);
  assert.match(src, /arranging: false,/);
  assert.match(src, /getElementById\('arrange-button'\)\.addEventListener\('click', \(\) => setArranging\(ctx, !ui\.arranging\)\)/);
  assert.match(src, /arrangeButton\.textContent = ui\.arranging \? 'Done' : 'Arrange';/);
  assert.match(src, /arrangeButton\.setAttribute\('aria-pressed', String\(ui\.arranging\)\);/);
  assert.match(src, /classList\.toggle\('arranging', ui\.arranging\)/);
  assert.match(src, /getElementById\('arrange-note'\)\.hidden = !ui\.arranging;/);
  assert.match(src, /key !== 'Escape' \|\| !ui\.arranging/);
  assert.match(src, /querySelector\('dialog\[open\]'\)/);
  assert.match(src, /getElementById\('editor'\)\.hidden/);
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `npm test`
Expected: FAIL — every test in `tests/arrange.test.js`:
- `setArranging flips ui.arranging …` — `SyntaxError: The requested module '../js/ui/widgets.js' does not provide an export named 'setArranging'`
- the rest — the patterns aren't in `index.html` / `js/ui/widgets.js` / `styles.css` / `js/app.js` yet

- [ ] **Step 3: `index.html`**

3a. In `.top-actions`, just before `#settings-button` — replace:

```html
      <button id="settings-button" class="icon" type="button" aria-label="Settings">⚙</button>
```

with:

```html
      <button id="arrange-button" class="link" type="button" aria-pressed="false">Arrange</button>
      <button id="settings-button" class="icon" type="button" aria-label="Settings">⚙</button>
```

3b. The first child of `<section class="today">` — replace:

```html
    <section class="today" aria-label="Today">
      <ul id="list" class="list"></ul>
```

with:

```html
    <section class="today" aria-label="Today">
      <p id="arrange-note" class="arrange-note" hidden>Today's list stays here</p>
      <ul id="list" class="list"></ul>
```

- [ ] **Step 4: Append the Arrange-mode block to `styles.css`**

```css

/* Arrange mode (js/ui/widgets.js): today's list stays put and dims, each widget gets a dashed
   frame with a grip (or ↑ ↓ on touch and in the one-column view), and hidden widgets wait below
   as chips. */
.arrange-note {
  margin: 0 0 .75rem; padding: .5rem .75rem; font-size: .85rem; color: var(--muted);
  background: var(--panel); border: 1px dashed var(--border); border-radius: var(--radius);
}
.today.arranging .list, .today.arranging .add { opacity: .5; pointer-events: none; }
.widget-frame { padding: .5rem; border: 1px dashed var(--border); border-radius: var(--radius); }
.widget-frame.drop-before { box-shadow: inset 0 2px 0 var(--accent); }
.widget-frame > :not(.widget-bar) { pointer-events: none; }
.widget-bar { display: flex; align-items: center; gap: .5rem; margin-bottom: .5rem; font-size: .8rem; color: var(--muted); }
.widget-bar .widget-title { flex: 1; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; font-size: .75rem; }
.grip { cursor: grab; letter-spacing: -.1em; }
.nudge { width: 1.6rem; height: 1.6rem; line-height: 1; cursor: pointer; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-sm); }
.placeholder { padding: .25rem 0; }
.drop-zone { padding: .6rem; font-size: .8rem; color: var(--muted); text-align: center; border: 1px dashed var(--border); border-radius: var(--radius); }
.drop-zone.drop-before { box-shadow: inset 0 2px 0 var(--accent); }
.column-break {
  padding: .4rem 0; font-size: .75rem; color: var(--muted); text-align: center;
  border-top: 1px dashed var(--border); border-bottom: 1px dashed var(--border);
}
.add-widget { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
.chip { padding: .3rem .7rem; font-size: .8rem; color: var(--accent); background: var(--accent-soft); border: 0; border-radius: 999rem; cursor: pointer; }
@media (min-width: 1500px) {
  .add-widget { grid-column: 1 / -1; }
}
```

(All new sizes are `rem` except the dashed/solid borders — `tests/palette.test.js` already checks
every file for this. No new custom property is introduced or needed: the frame, grip, nudge, drop
zone, divider and chip all read from Task 2's tokens.)

- [ ] **Step 5: Replace `js/ui/widgets.js` in full**

```js
// The widgets: the panels beside Today's list, drawn into the columns George arranges. The
// arrangement is device-local (js/layout.js, localStorage['dash_layout']); ctx.layout() is the
// current one and ctx.columnCount() says whether the window shows two widget columns or one.
// Today's list is not a widget: it always stays in the first column.
//
// Arrange mode (ctx.ui.arranging, toggled by setArranging): every visible widget gets a dashed
// frame with a grip (or ↑ ↓ on touch and in the one-column view) and Hide; hidden ones wait below
// as "+ Title" chips. Dragging follows js/ui/today.js's row drag and drop.

import { h } from './dom.js';
import { renderCoach } from './coach.js';
import { renderWeek, renderGoals, renderHistory, keptFocus, restoreFocus } from './side.js';
import { visibleColumns, moveWidget, nudgeWidget, hideWidget, showWidget } from '../layout.js';

// The registry. A widget's render(ctx) returns its element, or null when it has nothing to show
// (This week with no weekly targets), and is then left out (outside Arrange mode, which shows a
// placeholder instead so an empty widget can still be moved). A new widget is one more line here:
// normalizeLayout puts an id it hasn't seen before at the end of the first column.
export const WIDGETS = [
  { id: 'coach', title: 'Coach', render: renderCoach },
  { id: 'week', title: 'This week', render: renderWeek },
  { id: 'goals', title: 'Goals', render: renderGoals },
  { id: 'history', title: 'Last 3 weeks', render: renderHistory },
];
export const WIDGET_IDS = WIDGETS.map((w) => w.id);
const BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));
const titleOf = (id) => BY_ID.get(id)?.title ?? id;

// One widget's element, marked with its id; null when it has nothing to show.
function widgetEl(ctx, id) {
  const el = BY_ID.get(id)?.render(ctx) ?? null;
  if (el) el.dataset.widget = id;
  return el;
}

// Turns Arrange mode on or off (the header's Arrange/Done link, and Escape).
export function setArranging(ctx, on) {
  ctx.ui.arranging = on;
  ctx.render();
}

// ---- Arrange mode -------------------------------------------------------------------------------

// ↑ ↓ replace the grip on a touch device, and whenever only one widget column shows — a window
// under 1500px, where dragging between "columns" would have nothing to land on. matchMedia is
// read lazily (not every environment that imports this module has one, e.g. the Node tests).
const isCoarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const useNudge = (ctx) => ctx.columnCount() === 1 || isCoarsePointer();

// A frame is a drop target: dragover accepts a widget being dragged (and only that), drop moves
// it to just before this frame in `col`. Mirrors js/ui/today.js's row drag and drop.
function enableDropBefore(el, ctx, col, beforeId) {
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/x-widget')) return;
    e.preventDefault();
    el.classList.add('drop-before');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-before'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drop-before');
    const dragged = e.dataTransfer.getData('text/x-widget');
    if (dragged) ctx.setLayout(moveWidget(ctx.layout(), dragged, col, beforeId));
  });
}

// One widget while arranging: a dashed frame with a grip or ↑ ↓, its title and Hide, and its
// content — or a placeholder when it has nothing to show, so it can still be moved.
function widgetFrame(ctx, id, col) {
  const title = titleOf(id);
  const bar = h('div', { class: 'widget-bar' });
  if (useNudge(ctx)) {
    bar.append(
      h('button', {
        class: 'nudge', type: 'button', 'aria-label': `Move ${title} up`,
        onclick: () => ctx.setLayout(nudgeWidget(ctx.layout(), id, -1)),
      }, '↑'),
      h('button', {
        class: 'nudge', type: 'button', 'aria-label': `Move ${title} down`,
        onclick: () => ctx.setLayout(nudgeWidget(ctx.layout(), id, 1)),
      }, '↓'));
  } else {
    const grip = h('span', { class: 'grip', draggable: 'true', title: 'Drag to move' }, '⋮⋮');
    grip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-widget', id);
      e.dataTransfer.effectAllowed = 'move';
    });
    bar.append(grip);
  }
  bar.append(
    h('span', { class: 'widget-title' }, title),
    h('button', { class: 'link', type: 'button', onclick: () => ctx.setLayout(hideWidget(ctx.layout(), id)) }, 'Hide'));
  const content = widgetEl(ctx, id) ?? h('p', { class: 'muted placeholder' }, 'Nothing to show yet');
  const frame = h('div', { class: 'widget-frame', 'data-widget': id }, bar, content);
  enableDropBefore(frame, ctx, col, id);
  return frame;
}

// A column's empty drop zone: dropping here puts the widget at the end of `col`.
function dropZone(ctx, col) {
  const zone = h('div', { class: 'drop-zone', 'data-col': col }, 'Drop here');
  enableDropBefore(zone, ctx, col, null);
  return zone;
}

// Hidden widgets, as "+ Title" chips that bring one back at the end of column 0. null when none
// are hidden.
function addWidgetRow(ctx) {
  const hidden = ctx.layout().hidden;
  if (!hidden.length) return null;
  return h('div', { class: 'add-widget' },
    h('span', { class: 'muted' }, 'Add a widget:'),
    hidden.map((id) => h('button', {
      class: 'chip', type: 'button', onclick: () => ctx.setLayout(showWidget(ctx.layout(), id)),
    }, `+ ${titleOf(id)}`)));
}

// Two widget columns, each with a trailing drop zone.
function twoColumnFrames(ctx, layout) {
  return visibleColumns(layout, 2).map((ids, col) => h('div', { class: 'widget-col', 'data-col': col },
    ids.map((id) => widgetFrame(ctx, id, col)), dropZone(ctx, col)));
}

// One column: column 0's frames, a divider showing where the second column would start on a wide
// window, then column 1's — always both, so a nudge across the boundary is visible even when a
// side is empty. No drag here (↑ ↓ only), so no drop zones.
function oneColumnFrames(ctx, layout) {
  const [first, second] = visibleColumns(layout, 2);
  return [h('div', { class: 'widget-col', 'data-col': 0 },
    first.map((id) => widgetFrame(ctx, id, 0)),
    h('div', { class: 'column-break', role: 'separator' }, 'Second column on wide windows'),
    second.map((id) => widgetFrame(ctx, id, 1)))];
}

function renderArranging(ctx, side, count) {
  const columns = count >= 2 ? twoColumnFrames(ctx, ctx.layout()) : oneColumnFrames(ctx, ctx.layout());
  const addRow = addWidgetRow(ctx);
  side.replaceChildren(...columns, ...(addRow ? [addRow] : []));
}

// ---- Normal mode and the shared entry point ------------------------------------------------------

// Redraws the whole widget area (#side) from the arrangement. A text box marked data-focus gets
// its focus and caret back afterwards (its text comes back from ctx.ui), so typing carries on.
export function renderSide(ctx) {
  const side = document.getElementById('side');
  const kept = keptFocus(side);
  const count = ctx.columnCount();
  side.dataset.columns = String(count);
  if (ctx.ui.arranging) {
    renderArranging(ctx, side, count);
  } else {
    side.replaceChildren(...visibleColumns(ctx.layout(), count).map((ids, i) =>
      h('div', { class: 'widget-col', 'data-col': i }, ids.map((id) => widgetEl(ctx, id)))));
  }
  restoreFocus(side, kept);
}
```

- [ ] **Step 6: `js/app.js`**

6a. The import — replace:

```js
import { renderSide, WIDGET_IDS } from './ui/widgets.js';
```

with:

```js
import { renderSide, WIDGET_IDS, setArranging } from './ui/widgets.js';
```

6b. `ui.arranging` — replace:

```js
  entriesFor: null, amountFor: null, expandedGoals: new Set(), historyDay: null, editorDirty: false, closeEditor: null,
  // The Coach panel's page-only state (js/ui/coach.js). Typed text lives here, not only in the
```

with:

```js
  entriesFor: null, amountFor: null, expandedGoals: new Set(), historyDay: null, editorDirty: false, closeEditor: null,
  // Arrange mode (js/ui/widgets.js): toggled by #arrange-button, Escape, or Done.
  arranging: false,
  // The Coach panel's page-only state (js/ui/coach.js). Typed text lives here, not only in the
```

6c. `renderHeader()`, at the end — replace:

```js
  const status = document.getElementById('sync-status');
  const [text, title] = syncLabel();
  status.textContent = text;
  status.title = title;
  status.classList.toggle('sync-failing', sync.state === 'failing');
}
```

with:

```js
  const status = document.getElementById('sync-status');
  const [text, title] = syncLabel();
  status.textContent = text;
  status.title = title;
  status.classList.toggle('sync-failing', sync.state === 'failing');

  const arrangeButton = document.getElementById('arrange-button');
  arrangeButton.textContent = ui.arranging ? 'Done' : 'Arrange';
  arrangeButton.setAttribute('aria-pressed', String(ui.arranging));
  document.querySelector('.today').classList.toggle('arranging', ui.arranging);
  document.getElementById('arrange-note').hidden = !ui.arranging;
}
```

6d. The click handler and Escape, right after the sync-status wiring — replace:

```js
document.getElementById('sync-status').addEventListener('click', () => (sync.state === 'failing' ? ctx.openSettings() : scheduler.now()));
window.addEventListener('focus', wake);
```

with:

```js
document.getElementById('sync-status').addEventListener('click', () => (sync.state === 'failing' ? ctx.openSettings() : scheduler.now()));
document.getElementById('arrange-button').addEventListener('click', () => setArranging(ctx, !ui.arranging));
// Escape leaves Arrange mode, unless a dialog or the edit panel is using it for something else.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !ui.arranging) return;
  if (document.querySelector('dialog[open]')) return;
  if (!document.getElementById('editor').hidden) return;
  setArranging(ctx, false);
});
window.addEventListener('focus', wake);
```

- [ ] **Step 7: Run the tests and check the syntax**

Run: `npm test`
Expected: PASS — 259 tests (254 after Task 5, plus 5 in `tests/arrange.test.js`).

Run: `node --check js/ui/widgets.js && node --check js/app.js`
Expected: no output.

- [ ] **Step 8: Check it in the browser** (controller)

Serve with `preview_start` `dashboard`. Open `http://localhost:8080/dev/seed.html?replace`, then
`http://localhost:8080/?fakegemini`. Clear the service worker and caches first, so the offline
cache can't serve the old files, then reload twice:

```js
await Promise.all((await navigator.serviceWorker.getRegistrations()).map((r) => r.unregister()));
await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
location.reload();
```

Set each window size with `resize_window` (`desktop` preset when done). Check both looks at least
once (⚙ → Look).

1. **1900 × 1000 — drag.** Click **Arrange**: it reads **Done**, `aria-pressed="true"`; the list
   dims and shows "Today's list stays here"; every widget is a dashed frame with `⋮⋮`, its title
   and **Hide**; each column ends with a **Drop here** box. Drag Goals' grip onto History: Goals
   lands just above History in the same column. Drag History onto the first column's **Drop here**:
   it lands at the end of that column. Ticking a task or clicking inside a dragged-onto widget does
   nothing while arranging (`pointer-events: none` on its content).
2. **Hide and add back (1900px).** Click **Hide** on This week: it disappears from its column and
   an **Add a widget: + This week** chip appears below the columns. Click the chip: This week
   reappears at the end of the first column, and the chip is gone (no more hidden widgets, so the
   row itself disappears).
3. **1200 × 900 — nudge.** Click **Arrange**: one widget column, each frame showing `↑ ↓` instead
   of a grip (no drop zones). Press `↓` on Coach (top of column 0) repeatedly: it moves down past
   This week, then across the "Second column on wide windows" divider to the top of the second
   column's frames (Goals, Last 3 weeks) — confirmed by `[...document.querySelectorAll('#side [data-widget]')].map((e) => e.dataset.widget)`
   changing order and by `document.querySelector('.column-break')` staying between the two groups
   throughout. Press `↑` on Coach to bring it back to the very top.
4. **375 × 812 (the `mobile` preset).** `(pointer: coarse)` is emulated: even a wide window here
   would show `↑ ↓`, but the window is under 1500px anyway, so this doesn't add a new case — check
   the frames still show `↑ ↓` and the page never scrolls sideways
   (`document.documentElement.scrollWidth <= innerWidth` → `true`).
5. **Done, Escape and persistence.** At 1900px, drag Goals to the top of the first column, then
   click **Done**: `aria-pressed="false"`, the list undims, the widgets lose their frames and read
   normally. Reload: the same order is there
   (`localStorage.getItem('dash_layout')` shows Goals first in column 0). Click **Arrange** again,
   then press `Escape`: it leaves Arrange mode the same way **Done** does. Open ⚙ while arranging
   and press `Escape`: the dialog closes and Arrange mode is untouched (still arranging) — Escape
   only leaves Arrange mode when nothing else is using it, so open ⚙ again, close it, then press
   `Escape` a second time to leave.
6. **This week's placeholder.** Pick a seed/state with no active weekly quotas (or hide/re-log
   until none are active): outside Arrange mode This week doesn't appear at all; in Arrange mode
   its frame shows "Nothing to show yet" and can still be dragged and hidden.
7. No console errors apart from the Browser pane's service-worker refusal.

- [ ] **Step 9: Commit**

```bash
git add tests/arrange.test.js index.html styles.css js/ui/widgets.js js/app.js
git commit -m "Add Arrange mode: drag, nudge, hide and add widgets back" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
