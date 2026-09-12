# Task 5: Columns and widgets

Part of [the look, widgets and flags plan](../2026-09-12-look-widgets-flags.md) — read its Global Constraints first.

**Files:**
- Create: `js/ui/widgets.js`, `tests/widgets.test.js`
- Modify: `styles.css` (three exact edits), `index.html` (one line), `js/ui/side.js` (six exact edits),
  `js/app.js` (six exact edits)

**Interfaces:**
- Consumes: `LAYOUT_KEY`, `DEFAULT_LAYOUT`, `loadLayout`, `saveLayout`, `normalizeLayout`,
  `visibleColumns` from `js/layout.js` (Task 3); `renderCoach` from `js/ui/coach.js`; `renderWeek`,
  `renderGoals`, `renderHistory`, `keptFocus`, `restoreFocus` from `js/ui/side.js` (exported here);
  `h` from `js/ui/dom.js`; in `js/app.js` the existing `render()`, `whenIdle()`, `typing()` /
  `canRun()` and the `'storage'` listener. Styles use only Task 2's tokens.
- Produces (see the plan's Shared interfaces — Task 6 builds Arrange mode on exactly these):
  - `js/ui/widgets.js`: `WIDGETS` (`{ id, title, render }` for `coach`, `week`, `goals`, `history`),
    `WIDGET_IDS`, `renderSide(ctx)` — the widget area drawn from `ctx.layout()` in
    `ctx.columnCount()` columns, each a `<div class="widget-col" data-col="i">`, each widget's
    element marked `data-widget="<id>"`; `#side` gets `data-columns="1" | "2"`.
  - `js/ui/side.js` exports `renderWeek`, `renderGoals`, `renderHistory`, `keptFocus`, `restoreFocus`
    (bodies unchanged) and no longer has `renderSide`.
  - `js/app.js`: `ctx.layout()`, `ctx.columnCount()` (2 when `matchMedia('(min-width: 1500px)')`
    matches, else 1), `ctx.setLayout(next)` (normalise, save to `dash_layout`, render). A window
    crossing 1500px, or another window saving `dash_layout`, redraws once nothing is being typed.
  - `styles.css`: the page and the header are `min(88vw, 1500px)` wide, centred, with `2.5rem` above
    the header; `1fr 340px` from 760px; `1.35fr 1fr 1fr` from 1500px (`#side` spans the second and
    third tracks as a `subgrid`); one column below 760px, the list first.
  - `index.html`: `<aside id="side" class="side" aria-label="Widgets">`.

**What stays exactly as it was.** `#side` keeps its id and stays an `<aside>`, so the three things
that look for it still find the whole widget area: `typing()` (`el.closest('#list, #side')`) and so
`canRun()` / `whenIdle()`, which hold a sync, another window's save and a Gemini reply back while
something is half-typed there; `keptFocus` / `restoreFocus`, now called by `renderSide` in
`widgets.js`, which put the caret back in a `data-focus` box after every redraw; and `renderGoals`'
`'#side [data-focus="coach-shape"]'`, which focuses the shaping box. The panel renderers are moved
into the registry, not rewritten; `renderSide` moves from `side.js` to `widgets.js` so the registry
can import the renderers without an import cycle (`side.js` never imports `widgets.js`).

**A resize while typing.** Crossing 1500px changes the number of widget columns, which needs a
redraw. The redraw waits for `whenIdle()` — the same hold-back a sync uses — so a half-typed goal
amount or milestone (boxes with no `data-focus`) is never wiped by dragging the window's edge. Until
then the old columns are still on screen and still readable: one widget column sits in the second
track of a wide page, or two stack in the narrow one, in the same order.

- [ ] **Step 1: Write the failing tests**

Create `tests/widgets.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WIDGETS, WIDGET_IDS } from '../js/ui/widgets.js';
import { DEFAULT_LAYOUT, normalizeLayout, visibleColumns } from '../js/layout.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the widgets: Coach, This week, Goals, Last 3 weeks', () => {
  assert.deepEqual(WIDGETS.map((w) => [w.id, w.title]), [
    ['coach', 'Coach'], ['week', 'This week'], ['goals', 'Goals'], ['history', 'Last 3 weeks'],
  ]);
  assert.deepEqual(WIDGET_IDS, ['coach', 'week', 'goals', 'history']);
  for (const w of WIDGETS) assert.equal(typeof w.render, 'function', w.id);
});

test('the default arrangement places every widget, and only widgets', () => {
  assert.deepEqual(normalizeLayout(DEFAULT_LAYOUT, WIDGET_IDS), DEFAULT_LAYOUT);
  assert.deepEqual(DEFAULT_LAYOUT.columns.flat().sort(), [...WIDGET_IDS].sort());
  assert.deepEqual(visibleColumns(DEFAULT_LAYOUT, 1), [['coach', 'week', 'goals', 'history']]);
});

test('styles.css and js/app.js agree on the page width and the columns', () => {
  const css = read('styles.css');
  assert.doesNotMatch(css, /max-width: 1100px/);
  assert.match(css, /\.top \{[^}]*width: min\(88vw, 1500px\);[^}]*padding: 2\.5rem 0 \.75rem;/);
  assert.match(css, /\.layout \{[^}]*grid-template-columns: minmax\(0, 1fr\) 340px;[^}]*width: min\(88vw, 1500px\);/);
  assert.match(css, /@media \(min-width: 1500px\) \{\s*\.layout \{ grid-template-columns: minmax\(0, 1\.35fr\) minmax\(0, 1fr\) minmax\(0, 1fr\); \}\s*\.side \{[^}]*grid-column: 2 \/ 4;[^}]*grid-template-columns: subgrid;/);
  assert.match(css, /@media \(max-width: 759px\) \{\s*\.layout \{ grid-template-columns: 1fr; \}/);
  assert.match(read('js/app.js'), /matchMedia\('\(min-width: 1500px\)'\)/);
});

test('the widget area keeps its id, so typing protection and focus restore still find it', () => {
  assert.match(read('index.html'), /<aside id="side" class="side" aria-label="Widgets"><\/aside>/);
  assert.match(read('js/app.js'), /closest\('#list, #side'\)/);
  assert.match(read('js/ui/side.js'), /#side \[data-focus="coach-shape"\]/);
  assert.match(read('js/ui/widgets.js'), /keptFocus\(side\)[\s\S]*restoreFocus\(side, kept\)/);
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `npm test`
Expected: FAIL — `tests/widgets.test.js` doesn't load:
`Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/js/ui/widgets.js'`. Everything else passes.

- [ ] **Step 3: The page width and the columns in `styles.css`**

3a. The header — replace:

```css
/* Header */
.top {
  display: flex; justify-content: space-between; align-items: baseline; gap: 1rem;
  max-width: 1100px; margin: 0 auto; padding: 1.5rem 1.5rem .75rem;
}
```

with:

```css
/* Header: as wide as the columns under it, with room above */
.top {
  display: flex; justify-content: space-between; align-items: baseline; gap: 1rem;
  width: min(88vw, 1500px); margin: 0 auto; padding: 2.5rem 0 .75rem;
}
```

3b. The page's grid — replace:

```css
/* Layout: list on the left, a narrow column on the right; stacked below 760px */
.layout {
  display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 2rem; align-items: start;
  max-width: 1100px; margin: 0 auto; padding: 0 1.5rem 3rem;
}
```

with:

```css
/* Layout: 88% of the window, at most 1500px, centred. Today's list, then the widget area (#side):
   one 340px widget column from 760px, two from 1500px (below), and under 760px one column — the
   list, then the widgets. */
.layout {
  display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 2rem; align-items: start;
  width: min(88vw, 1500px); margin: 0 auto; padding: 0 0 3rem;
}
```

(The `@media (max-width: 759px)` block after it stays as it is: one column, and the header wraps.)

3c. The widget area — replace:

```css
/* Side column */
.side { display: flex; flex-direction: column; gap: 1.5rem; }
```

with:

```css
/* The widget area (js/ui/widgets.js): its columns of widgets. From 1500px (js/app.js asks the same
   question) the page has three columns, 1.35fr 1fr 1fr: #side spans the second and third as a
   subgrid, one widget column in each. */
.side { display: flex; flex-direction: column; gap: 1.5rem; min-width: 0; }
.widget-col { display: flex; flex-direction: column; gap: 1.5rem; min-width: 0; }
@media (min-width: 1500px) {
  .layout { grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr) minmax(0, 1fr); }
  .side { grid-column: 2 / 4; display: grid; grid-template-columns: subgrid; gap: 1.5rem 2rem; align-items: start; }
}
```

(The wide rules come after the base `.layout` and `.side` rules, so they win. `gap: 1.5rem 2rem`
keeps the subgrid's column gap equal to the page's `2rem`, so the three tracks stay exactly
`1.35fr 1fr 1fr`. Widths stay in `px` only for the 340px column and inside `min()`, which
`tests/palette.test.js` allows.)

- [ ] **Step 4: The widget area's label in `index.html`**

Replace:

```html
    <aside id="side" class="side" aria-label="Coach, week, goals and history"></aside>
```

with:

```html
    <aside id="side" class="side" aria-label="Widgets"></aside>
```

- [ ] **Step 5: `js/ui/side.js` keeps the renderers and exports them**

5a. The opening comment — replace:

```js
// The right-hand column: this week's quotas, goals, and the last three weeks.
```

with:

```js
// The widgets' panels: this week's quotas, goals, and the last three weeks. js/ui/widgets.js
// arranges them (with the Coach, from js/ui/coach.js) and uses the focus helpers at the end.
```

5b. The Coach is imported by the registry now — replace:

```js
import { renderCoach, renderShapeBox } from './coach.js'; // js/ui/coach.js, the panel (js/coach.js is the pure half)
```

with:

```js
import { renderShapeBox } from './coach.js'; // js/ui/coach.js, the panel (js/coach.js is the pure half)
```

5c. Replace:

```js
function renderWeek(ctx) {
```

with:

```js
export function renderWeek(ctx) {
```

5d. Replace:

```js
function renderGoals(ctx) {
```

with:

```js
export function renderGoals(ctx) {
```

5e. Replace:

```js
function renderHistory(ctx) {
```

with:

```js
export function renderHistory(ctx) {
```

5f. The focus helpers are exported and `renderSide` goes (it moves to `js/ui/widgets.js`) — replace:

```js
// A re-render replaces the whole column. A text box marked data-focus gets its focus and caret
// back afterwards (its text comes back from ctx.ui), so typing carries on uninterrupted.
function keptFocus(root) {
  const el = document.activeElement;
  if (!el || !root.contains(el) || !el.dataset.focus) return null;
  return { key: el.dataset.focus, start: el.selectionStart, end: el.selectionEnd };
}

function restoreFocus(root, kept) {
  if (!kept) return;
  const el = [...root.querySelectorAll('[data-focus]')].find((x) => x.dataset.focus === kept.key);
  if (!el) return;
  el.focus();
  try {
    el.setSelectionRange(kept.start, kept.end);
  } catch {
    // not a text box
  }
}

export function renderSide(ctx) {
  const side = document.getElementById('side');
  const kept = keptFocus(side);
  side.replaceChildren(
    ...[renderCoach(ctx), renderWeek(ctx), renderGoals(ctx), renderHistory(ctx)].filter(Boolean));
  restoreFocus(side, kept);
}
```

with:

```js
// A re-render replaces the whole widget area. A text box marked data-focus gets its focus and
// caret back afterwards (its text comes back from ctx.ui), so typing carries on uninterrupted.
// js/ui/widgets.js's renderSide calls these two around every redraw.
export function keptFocus(root) {
  const el = document.activeElement;
  if (!el || !root.contains(el) || !el.dataset.focus) return null;
  return { key: el.dataset.focus, start: el.selectionStart, end: el.selectionEnd };
}

export function restoreFocus(root, kept) {
  if (!kept) return;
  const el = [...root.querySelectorAll('[data-focus]')].find((x) => x.dataset.focus === kept.key);
  if (!el) return;
  el.focus();
  try {
    el.setSelectionRange(kept.start, kept.end);
  } catch {
    // not a text box
  }
}
```

- [ ] **Step 6: Create `js/ui/widgets.js`**

```js
// The widgets: the panels beside Today's list, drawn into the columns George arranges. The
// arrangement is device-local (js/layout.js, localStorage['dash_layout']); ctx.layout() is the
// current one and ctx.columnCount() says whether the window shows two widget columns or one.
// Today's list is not a widget: it always stays in the first column.

import { h } from './dom.js';
import { renderCoach } from './coach.js';
import { renderWeek, renderGoals, renderHistory, keptFocus, restoreFocus } from './side.js';
import { visibleColumns } from '../layout.js';

// The registry. A widget's render(ctx) returns its element, or null when it has nothing to show
// (This week with no weekly targets), and is then left out. A new widget is one more line here:
// normalizeLayout puts an id it hasn't seen before at the end of the first column.
export const WIDGETS = [
  { id: 'coach', title: 'Coach', render: renderCoach },
  { id: 'week', title: 'This week', render: renderWeek },
  { id: 'goals', title: 'Goals', render: renderGoals },
  { id: 'history', title: 'Last 3 weeks', render: renderHistory },
];
export const WIDGET_IDS = WIDGETS.map((w) => w.id);
const BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));

// One widget's element, marked with its id; null when it has nothing to show.
function widgetEl(ctx, id) {
  const el = BY_ID.get(id)?.render(ctx) ?? null;
  if (el) el.dataset.widget = id;
  return el;
}

// Redraws the whole widget area (#side) from the arrangement. A text box marked data-focus gets
// its focus and caret back afterwards (its text comes back from ctx.ui), so typing carries on.
export function renderSide(ctx) {
  const side = document.getElementById('side');
  const kept = keptFocus(side);
  const count = ctx.columnCount();
  side.dataset.columns = String(count);
  side.replaceChildren(...visibleColumns(ctx.layout(), count).map((ids, i) =>
    h('div', { class: 'widget-col', 'data-col': i }, ids.map((id) => widgetEl(ctx, id)))));
  restoreFocus(side, kept);
}
```

- [ ] **Step 7: The arrangement and the column count in `js/app.js`**

7a. The imports — replace:

```js
import { renderSide } from './ui/side.js';
```

with:

```js
import { renderSide, WIDGET_IDS } from './ui/widgets.js';
```

and replace:

```js
import { resolveLook, THEME_COLORS } from './look.js';
```

with:

```js
import { resolveLook, THEME_COLORS } from './look.js';
import { LAYOUT_KEY, loadLayout, saveLayout, normalizeLayout } from './layout.js';
```

7b. The arrangement and the wide-window question, before `ctx` — replace:

```js
const sync = { state: 'off', at: null, error: null };
```

with:

```js
const sync = { state: 'off', at: null, error: null };

// The widget arrangement (js/layout.js): kept on this device, never synced. A window at least
// 1500px wide shows two widget columns (the same media query as styles.css), a smaller one one.
const WIDE = matchMedia('(min-width: 1500px)');
let layout = loadLayout(localStorage, WIDGET_IDS);
```

7c. On `ctx` — replace:

```js
  whenIdle,
  coach: {
```

with:

```js
  whenIdle,
  // The widget arrangement, how many widget columns show, and every change to it: normalised,
  // saved on this device, drawn (js/ui/widgets.js).
  layout: () => layout,
  columnCount: () => (WIDE.matches ? 2 : 1),
  setLayout(next) {
    layout = normalizeLayout(next, WIDGET_IDS);
    saveLayout(localStorage, layout);
    render();
  },
  coach: {
```

7d. Crossing 1500px — replace:

```js
window.addEventListener('online', () => scheduler.now());
```

with:

```js
window.addEventListener('online', () => scheduler.now());
// Crossing 1500px changes the number of widget columns: redrawn once nothing is being typed
// (until then the old columns stay on screen, every widget still showing, in the same order).
WIDE.addEventListener('change', () => { whenIdle().then(render); });
```

7e. Another window rearranging the widgets — replace:

```js
window.addEventListener('storage', (e) => {
  if (e.key !== DATA_KEY || !e.newValue) return;
```

with:

```js
window.addEventListener('storage', (e) => {
  // Another window on this device rearranged the widgets: follow it, once nothing is being typed.
  if (e.key === LAYOUT_KEY) {
    layout = loadLayout(localStorage, WIDGET_IDS);
    whenIdle().then(render);
    return;
  }
  if (e.key !== DATA_KEY || !e.newValue) return;
```

`typing()` and `canRun()` need no change: they already look for `'#list, #side'`, and `#side` is
still the whole widget area. `loadLayout` and `saveLayout` wrap every `localStorage` access in
try/catch (Task 3), so a full or blocked storage leaves the default arrangement on screen.

- [ ] **Step 8: Run the tests and check the syntax**

Run: `npm test`
Expected: PASS — 254 tests (250 after Task 4, plus 4 in `tests/widgets.test.js`).

Run: `node --check js/ui/widgets.js && node --check js/ui/side.js && node --check js/app.js`
Expected: no output.

- [ ] **Step 9: Check it in the browser** (controller)

Serve with `preview_start` `dashboard`. Open `http://localhost:8080/dev/seed.html?replace`, then
`http://localhost:8080/?fakegemini`. So that the offline cache can't serve the old files, run this
once in the page (`javascript_tool`), then reload twice:

```js
await Promise.all((await navigator.serviceWorker.getRegistrations()).map((r) => r.unregister()));
await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
location.reload();
```

Set each window size with `resize_window` (and put it back with the `desktop` preset at the end).

1. **1900 × 1000** (Paper: ⚙ → Look → *Paper* → Save):
   - `const r = document.querySelector('main.layout').getBoundingClientRect(); [Math.round(r.width), Math.round(r.left - (document.documentElement.clientWidth - r.right))]`
     → `[1500, 0]` (±1): capped at 1500px, centred. `document.querySelector('.top').getBoundingClientRect().width`
     is the same 1500, and `getComputedStyle(document.querySelector('.top')).paddingTop` is `'42.5px'`
     (2.5rem at 17px).
   - `document.getElementById('side').dataset.columns` → `'2'`, and
     `[...document.querySelectorAll('#side .widget-col')].map((c) => [...c.children].map((e) => e.dataset.widget))`
     → `[['coach', 'week'], ['goals', 'history']]`.
   - `[document.querySelector('.today'), ...document.querySelectorAll('#side .widget-col')].map((e) => Math.round(e.getBoundingClientRect().width))`
     → about `[577, 427, 427]`: `1.35fr 1fr 1fr` of the 1432px left after two 2rem gaps.
   - Screenshot for the report. Then ⚙ → *Night* → Save, screenshot again: the same columns, dark.
2. **1200 × 900**: `dataset.columns` → `'1'`; one `.widget-col` holding `coach`, `week`, `goals`,
   `history` in that order; `Math.round(document.getElementById('side').getBoundingClientRect().width)`
   → `340`; the page is `1056` wide (88vw).
3. **375 × 812** (the `mobile` preset, then reload): one column, the list first —
   `document.getElementById('side').getBoundingClientRect().top > document.querySelector('.today').getBoundingClientRect().bottom`
   → `true`; the widgets in the same four-widget order; nothing wider than the window
   (`document.documentElement.scrollWidth <= innerWidth` → `true`). The header wraps; ⚙ still shows.
4. **Typing survives a resize across 1500px.** At 1900: Goals → *Shape with AI*, type
   `run a 10k` in the box. `resize_window` to 1200: `document.activeElement.value` is still
   `'run a 10k'` and `dataset.columns` is still `'2'` (the redraw is waiting). Click on the page's
   background (the box loses focus): within a second `dataset.columns` is `'1'` and the shaping box
   still reads `run a 10k`. Click back into the box, type ` by May` — the caret carries on at the end.
   Back at 1900 (with the box empty and unfocused, *Cancel*): two columns again at once.
5. **The saved arrangement is followed.** Run
   `localStorage.setItem('dash_layout', JSON.stringify({ v: 1, columns: [['history'], ['coach', 'goals']], hidden: ['week'] }))`
   and reload: at 1900 the columns are `[['history'], ['coach', 'goals']]` and This week isn't
   there; at 1200 one column, `history`, `coach`, `goals`. Then
   `localStorage.setItem('dash_layout', '{not json')`, reload → the default four again. Then
   `localStorage.removeItem('dash_layout')`.
6. Ticking a task, opening a goal, clicking a history day and the Coach's *check in now* all work as
   before in both widths. No console errors apart from the Browser pane's service-worker refusal
   ("An unknown error occurred when fetching the script").

- [ ] **Step 10: Commit**

```bash
git add js/ui/widgets.js tests/widgets.test.js styles.css index.html js/ui/side.js js/app.js
git commit -m "Wider page and widget columns, drawn from the device's arrangement" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
