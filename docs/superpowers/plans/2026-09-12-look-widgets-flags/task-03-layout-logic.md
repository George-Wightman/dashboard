# Task 3: The widget arrangement (pure)

Part of [the look, widgets and flags plan](../2026-09-12-look-widgets-flags.md) — read its Global Constraints first.

**Files:**
- Create: `js/layout.js`, `tests/layout.test.js`

**Interfaces:**
- Consumes: `MemoryStorage`, `FullStorage` from `tests/helpers.js`. Nothing from the page: this task
  has no DOM and changes no existing file.
- Produces (see the plan's Shared interfaces — Tasks 5 and 6 build on exactly these):
  `LAYOUT_KEY`, `DEFAULT_LAYOUT`, `normalizeLayout(saved, knownIds)`, `visibleColumns(layout, count)`,
  `moveWidget(layout, id, toColumn, beforeId)`, `nudgeWidget(layout, id, dir)`, `hideWidget(layout, id)`,
  `showWidget(layout, id)`, `loadLayout(storage, knownIds)`, `saveLayout(storage, layout)`.

**The shape and its one rule.** A layout is `{ v: 1, columns: [[ids], [ids]], hidden: [ids] }`, kept
in `localStorage['dash_layout']` on each device and never synced. After `normalizeLayout` every known
widget id is in **exactly one place**: one of the two columns, or `hidden`. Every other function keeps
that true and returns a new layout, never changing the one it was given (the tests freeze their
inputs to prove it). So:

- `hideWidget` takes the widget out of its column and appends it to `hidden`; `showWidget` takes it out
  of `hidden` and appends it to the end of column 0 (the design: "shown again at the end of column 0").
- `normalizeLayout` reads `hidden` first, so an id that a hand-edited layout lists both in a column and
  in `hidden` stays hidden. It drops unknown ids, non-strings and repeats; merges any columns past the
  second into the second; pads to two columns; and appends any known id found nowhere (a new widget)
  to the end of column 0, in `knownIds` order. Saved data that isn't `{ v: 1, columns: [...] }` is
  unreadable and gives `DEFAULT_LAYOUT` (normalised against `knownIds`, so with today's four widgets
  it is exactly `DEFAULT_LAYOUT`).
- `visibleColumns` still filters out `hidden` ids, in case a layout reaches it un-normalised.
- `moveWidget` on a hidden widget places it (it becomes visible); on itself (`id === beforeId`), an
  unknown id, or a column other than 0 or 1, it returns an unchanged copy. A `beforeId` that isn't in
  the target column (after the move) means "the end".
- `nudgeWidget` follows the design literally: one step in the single-column order (column 0, then
  column 1), and "crossing the boundary moves it into the other column at the matching end" — down
  from the bottom of column 0 to the **top** of column 1; up from the top of column 1 to the **bottom**
  of column 0. That crossing is a step of its own: in the one-column view the widget's position in
  the list doesn't change on that press, only the column it will sit in on a wide window. (Task 6
  shows the boundary in the one-column Arrange view, so that press is visible.) At the very top and
  very bottom, and for an unknown id or a `dir` other than `-1` / `+1`, it returns an unchanged copy.

- [ ] **Step 1: Write the failing tests**

Create `tests/layout.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYOUT_KEY, DEFAULT_LAYOUT, normalizeLayout, visibleColumns, moveWidget, nudgeWidget, hideWidget, showWidget,
  loadLayout, saveLayout,
} from '../js/layout.js';
import { MemoryStorage, FullStorage } from './helpers.js';

const IDS = ['coach', 'week', 'goals', 'history'];
const L = (columns, hidden = []) => ({ v: 1, columns, hidden });

// Freezes a layout all the way down, so a function that changes its input throws.
function frozen(layout) {
  layout.columns.forEach(Object.freeze);
  Object.freeze(layout.columns);
  Object.freeze(layout.hidden);
  return Object.freeze(layout);
}

// Every known id exactly once, across the columns and hidden.
function assertEachOnce(layout, ids = IDS) {
  assert.deepEqual([...layout.columns.flat(), ...layout.hidden].sort(), [...ids].sort());
}

// ---- the default and normalizeLayout ------------------------------------------------------------

test('the default arrangement: Coach and This week, then Goals and Last 3 weeks', () => {
  assert.equal(LAYOUT_KEY, 'dash_layout');
  assert.deepEqual(DEFAULT_LAYOUT, { v: 1, columns: [['coach', 'week'], ['goals', 'history']], hidden: [] });
  assert.throws(() => DEFAULT_LAYOUT.columns[0].push('x'), TypeError);
  assert.throws(() => { DEFAULT_LAYOUT.hidden = ['coach']; }, TypeError);
});

test('normalizeLayout of the default is a fresh copy of it', () => {
  const out = normalizeLayout(DEFAULT_LAYOUT, IDS);
  assert.deepEqual(out, DEFAULT_LAYOUT);
  out.columns[0].push('extra');
  assert.deepEqual(DEFAULT_LAYOUT.columns[0], ['coach', 'week']);
});

test('unreadable saved data gives the default', () => {
  const unreadable = [null, undefined, 'x', 42, true, [], {}, { v: 2, columns: [['coach'], []], hidden: [] }, { v: 1 }, { v: 1, columns: 'coach' }];
  for (const saved of unreadable) assert.deepEqual(normalizeLayout(saved, IDS), DEFAULT_LAYOUT, JSON.stringify(saved));
});

test('normalizeLayout drops unknown ids, non-strings and repeats; hidden wins over placed', () => {
  const saved = L([['coach', 'weather', 'coach', 7, null], ['week', 'goals', 'coach']], ['goals', 'goals', 'nope']);
  assert.deepEqual(normalizeLayout(saved, IDS), L([['coach', 'history'], ['week']], ['goals']));
});

test('normalizeLayout always gives two columns', () => {
  assert.deepEqual(normalizeLayout(L([['week', 'coach', 'goals', 'history']]), IDS), L([['week', 'coach', 'goals', 'history'], []]));
  assert.deepEqual(normalizeLayout(L([]), IDS), L([['coach', 'week', 'goals', 'history'], []]));
  assert.deepEqual(normalizeLayout(L([['coach'], ['week'], ['goals'], 'junk']), IDS), L([['coach', 'history'], ['week', 'goals']]));
  assert.deepEqual(normalizeLayout({ v: 1, columns: ['junk', ['goals']], hidden: 'junk' }, IDS), L([['coach', 'week', 'history'], ['goals']]));
});

test('a new widget appears at the end of the first column; one that has gone disappears', () => {
  const saved = L([['week', 'coach'], ['history']], ['goals']);
  assert.deepEqual(normalizeLayout(saved, [...IDS, 'calendar']), L([['week', 'coach', 'calendar'], ['history']], ['goals']));
  assert.deepEqual(normalizeLayout(saved, ['coach', 'week', 'history']), L([['week', 'coach'], ['history']], []));
});

test('normalizeLayout never changes what it was given', () => {
  assert.doesNotThrow(() => normalizeLayout(frozen(L([['coach', 'coach'], ['week']], ['nope'])), IDS));
});

// ---- visibleColumns ----------------------------------------------------------------------------

test('visibleColumns: two columns side by side, or one list, never the hidden ones', () => {
  const layout = L([['coach', 'week'], ['goals']], ['history']);
  assert.deepEqual(visibleColumns(layout, 2), [['coach', 'week'], ['goals']]);
  assert.deepEqual(visibleColumns(layout, 1), [['coach', 'week', 'goals']]);
  assert.deepEqual(visibleColumns(DEFAULT_LAYOUT, 1), [['coach', 'week', 'goals', 'history']]);
  // hidden ids stay out even if a hand-edited layout still has them in a column
  assert.deepEqual(visibleColumns(L([['coach', 'history'], ['week']], ['history']), 2), [['coach'], ['week']]);
  const out = visibleColumns(DEFAULT_LAYOUT, 2);
  out[0].push('x');
  assert.deepEqual(DEFAULT_LAYOUT.columns[0], ['coach', 'week']);
});

// ---- moveWidget --------------------------------------------------------------------------------

test('moveWidget puts a widget before another, in either column', () => {
  const start = frozen(L([['coach', 'week'], ['goals', 'history']]));
  assert.deepEqual(moveWidget(start, 'week', 0, 'coach'), L([['week', 'coach'], ['goals', 'history']]));
  assert.deepEqual(moveWidget(start, 'coach', 1, 'history'), L([['week'], ['goals', 'coach', 'history']]));
  assert.deepEqual(moveWidget(start, 'history', 0, 'coach'), L([['history', 'coach', 'week'], ['goals']]));
  // a hidden widget that is moved is placed, and so shown
  assert.deepEqual(moveWidget(frozen(L([['coach'], ['goals']], ['week'])), 'week', 1, 'goals'), L([['coach'], ['week', 'goals']]));
});

test('moveWidget with no widget to go before puts it at the end of the column', () => {
  const start = frozen(L([['coach', 'week'], ['goals', 'history']]));
  assert.deepEqual(moveWidget(start, 'coach', 1, null), L([['week'], ['goals', 'history', 'coach']]));
  assert.deepEqual(moveWidget(start, 'coach', 0, null), L([['week', 'coach'], ['goals', 'history']]));
  assert.deepEqual(moveWidget(start, 'goals', 0, 'nope'), L([['coach', 'week', 'goals'], ['history']]));
  const empty = frozen(L([['coach', 'week', 'goals', 'history'], []]));
  assert.deepEqual(moveWidget(empty, 'week', 1, null), L([['coach', 'goals', 'history'], ['week']]));
});

test('moveWidget changes nothing for a drop on itself, an unknown widget or a bad column', () => {
  const start = frozen(L([['coach', 'week'], ['goals', 'history']]));
  assert.deepEqual(moveWidget(start, 'week', 0, 'week'), start);
  assert.deepEqual(moveWidget(start, 'weather', 0, 'coach'), start);
  assert.deepEqual(moveWidget(start, 'week', 2, null), start);
  assert.deepEqual(moveWidget(start, 'week', -1, null), start);
});

// ---- nudgeWidget -------------------------------------------------------------------------------

test('nudgeWidget moves one step up or down within a column', () => {
  const start = frozen(L([['coach', 'week'], ['goals', 'history']]));
  assert.deepEqual(nudgeWidget(start, 'week', -1), L([['week', 'coach'], ['goals', 'history']]));
  assert.deepEqual(nudgeWidget(start, 'coach', 1), L([['week', 'coach'], ['goals', 'history']]));
  assert.deepEqual(nudgeWidget(start, 'history', -1), L([['coach', 'week'], ['history', 'goals']]));
  assert.deepEqual(nudgeWidget(start, 'goals', 1), L([['coach', 'week'], ['history', 'goals']]));
});

test('nudgeWidget crosses into the other column at the matching end', () => {
  const start = frozen(L([['coach', 'week'], ['goals', 'history']]));
  // down from the bottom of the first column: to the top of the second
  assert.deepEqual(nudgeWidget(start, 'week', 1), L([['coach'], ['week', 'goals', 'history']]));
  // up from the top of the second column: to the bottom of the first
  assert.deepEqual(nudgeWidget(start, 'goals', -1), L([['coach', 'week', 'goals'], ['history']]));
  // into an empty column
  assert.deepEqual(nudgeWidget(frozen(L([['coach', 'week', 'goals', 'history'], []])), 'history', 1), L([['coach', 'week', 'goals'], ['history']]));
  assert.deepEqual(nudgeWidget(frozen(L([[], ['coach', 'week']])), 'coach', -1), L([['coach'], ['week']]));
});

test('nudgeWidget stops at the very top and bottom, and ignores unknown widgets and directions', () => {
  const start = frozen(L([['coach', 'week'], ['goals', 'history']]));
  assert.deepEqual(nudgeWidget(start, 'coach', -1), start);
  assert.deepEqual(nudgeWidget(start, 'history', 1), start);
  assert.deepEqual(nudgeWidget(start, 'weather', 1), start);
  assert.deepEqual(nudgeWidget(start, 'week', 2), start);
  assert.deepEqual(nudgeWidget(start, 'week', 0), start);
});

test('crossing between columns is its own step in the one-column order', () => {
  let layout = L([['coach', 'week'], ['goals', 'history']]);
  const down = [];
  for (let i = 0; i < 5; i++) {
    layout = nudgeWidget(layout, 'coach', 1);
    down.push([visibleColumns(layout, 1)[0].indexOf('coach'), layout.columns[0].includes('coach') ? 0 : 1]);
  }
  assert.deepEqual(down, [[1, 0], [1, 1], [2, 1], [3, 1], [3, 1]]);
  const up = [];
  for (let i = 0; i < 5; i++) {
    layout = nudgeWidget(layout, 'coach', -1);
    up.push([visibleColumns(layout, 1)[0].indexOf('coach'), layout.columns[0].includes('coach') ? 0 : 1]);
  }
  assert.deepEqual(up, [[2, 1], [1, 1], [1, 0], [0, 0], [0, 0]]);
});

// ---- hideWidget and showWidget -----------------------------------------------------------------

test('hideWidget moves a widget into hidden; showWidget brings it back at the end of the first column', () => {
  const start = frozen(L([['coach', 'week'], ['goals', 'history']]));
  const hidden = hideWidget(start, 'goals');
  assert.deepEqual(hidden, L([['coach', 'week'], ['history']], ['goals']));
  assert.deepEqual(visibleColumns(hidden, 2), [['coach', 'week'], ['history']]);
  assert.deepEqual(showWidget(frozen(hidden), 'goals'), L([['coach', 'week', 'goals'], ['history']]));
  const twoHidden = frozen(hideWidget(frozen(hideWidget(start, 'coach')), 'week'));
  assert.deepEqual(twoHidden, L([[], ['goals', 'history']], ['coach', 'week']));
  assert.deepEqual(showWidget(twoHidden, 'week'), L([['week'], ['goals', 'history']], ['coach']));
});

test('hiding a hidden or unknown widget, or showing a visible or unknown one, changes nothing', () => {
  const layout = frozen(L([['coach', 'week'], ['history']], ['goals']));
  assert.deepEqual(hideWidget(layout, 'goals'), layout);
  assert.deepEqual(hideWidget(layout, 'weather'), layout);
  assert.deepEqual(showWidget(layout, 'coach'), layout);
  assert.deepEqual(showWidget(layout, 'weather'), layout);
});

test('any run of changes keeps every widget in exactly one place, and stays normalised', () => {
  let s = 7;
  const rnd = (n) => { s = (s * 16807) % 2147483647; return s % n; };
  let layout = normalizeLayout(null, IDS);
  for (let i = 0; i < 500; i++) {
    const id = IDS[rnd(4)];
    const other = [...IDS, null][rnd(5)];
    switch (rnd(4)) {
      case 0: layout = moveWidget(frozen(layout), id, rnd(2), other); break;
      case 1: layout = nudgeWidget(frozen(layout), id, rnd(2) ? 1 : -1); break;
      case 2: layout = hideWidget(frozen(layout), id); break;
      default: layout = showWidget(frozen(layout), id);
    }
    assertEachOnce(layout);
    assert.deepEqual(normalizeLayout(layout, IDS), layout);
  }
});

// ---- loadLayout and saveLayout -----------------------------------------------------------------

test('loadLayout reads the saved arrangement, normalised; nothing saved or unreadable gives the default', () => {
  const layout = L([['history'], ['goals', 'coach']], ['week']);
  const storage = new MemoryStorage({ [LAYOUT_KEY]: JSON.stringify(layout) });
  assert.deepEqual(loadLayout(storage, IDS), layout);
  assert.deepEqual(loadLayout(new MemoryStorage(), IDS), DEFAULT_LAYOUT);
  assert.deepEqual(loadLayout(new MemoryStorage({ [LAYOUT_KEY]: '{not json' }), IDS), DEFAULT_LAYOUT);
  class DeniedRead extends MemoryStorage { getItem() { throw new Error('denied'); } }
  assert.deepEqual(loadLayout(new DeniedRead(), IDS), DEFAULT_LAYOUT);
  assert.deepEqual(loadLayout(storage, [...IDS, 'calendar']), L([['history', 'calendar'], ['goals', 'coach']], ['week']));
});

test('saveLayout writes only dash_layout, and a full storage is reported, not thrown', () => {
  const storage = new MemoryStorage();
  const layout = L([['week'], ['coach', 'goals', 'history']]);
  assert.equal(saveLayout(storage, layout), true);
  assert.deepEqual([...storage.map.keys()], ['dash_layout']);
  assert.deepEqual(JSON.parse(storage.getItem('dash_layout')), layout);
  assert.deepEqual(loadLayout(storage, IDS), layout);
  assert.equal(saveLayout(new FullStorage(), layout), false);
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `npm test`
Expected: FAIL — `tests/layout.test.js` doesn't load:
`Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/js/layout.js'`. Everything else passes.

- [ ] **Step 3: Create `js/layout.js`**

```js
// The widget arrangement: which widgets sit in which of the two columns, in what order, and which
// are hidden. Device-local (localStorage['dash_layout']) and never synced, so the laptop and the
// phone keep their own. Pure functions over { v: 1, columns: [[ids], [ids]], hidden: [ids] }:
// each returns a new layout and never changes the one it was given. After normalizeLayout every
// known widget id is in exactly one place — one of the columns, or hidden — and every other
// function keeps it that way.

export const LAYOUT_KEY = 'dash_layout';

export const DEFAULT_LAYOUT = Object.freeze({
  v: 1,
  columns: Object.freeze([Object.freeze(['coach', 'week']), Object.freeze(['goals', 'history'])]),
  hidden: Object.freeze([]),
});

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

function copy(layout) {
  return { v: 1, columns: [[...layout.columns[0]], [...layout.columns[1]]], hidden: [...layout.hidden] };
}

// A copy with `id` taken out of wherever it is.
function without(layout, id) {
  const out = copy(layout);
  out.columns = out.columns.map((c) => c.filter((x) => x !== id));
  out.hidden = out.hidden.filter((x) => x !== id);
  return out;
}

const inColumns = (layout, id) => layout.columns.some((c) => c.includes(id));

// A saved layout made safe to use: unknown ids, non-strings and repeats dropped (an id both placed
// and hidden stays hidden), exactly two columns, and any known id found nowhere — a new widget —
// added to the end of the first column. Anything that isn't { v: 1, columns: [...] } is unreadable
// and gives the default.
export function normalizeLayout(saved, knownIds) {
  const source = isPlainObject(saved) && saved.v === 1 && Array.isArray(saved.columns) ? saved : DEFAULT_LAYOUT;
  const known = new Set(knownIds);
  const seen = new Set();
  const keep = (ids) => list(ids).filter((id) => {
    if (typeof id !== 'string' || !known.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const hidden = keep(source.hidden); // first, so hidden wins over placed
  const columns = [keep(source.columns[0]), keep(source.columns.slice(1).flatMap(list))];
  for (const id of knownIds) {
    if (!seen.has(id)) {
      seen.add(id);
      columns[0].push(id);
    }
  }
  return { v: 1, columns, hidden };
}

// What to draw: for 2 columns, the two columns without the hidden ids; for 1, column 0 then
// column 1 as one list.
export function visibleColumns(layout, count) {
  const hidden = new Set(layout.hidden);
  const [first, second] = layout.columns.map((c) => c.filter((id) => !hidden.has(id)));
  return count >= 2 ? [first, second] : [[...first, ...second]];
}

// Drag and drop: `id` goes just before `beforeId` in column `toColumn`, or at its end when
// `beforeId` is null or isn't in that column. A hidden widget that is moved is shown.
export function moveWidget(layout, id, toColumn, beforeId = null) {
  const known = inColumns(layout, id) || layout.hidden.includes(id);
  if (id === beforeId || !known || (toColumn !== 0 && toColumn !== 1)) return copy(layout);
  const out = without(layout, id);
  const column = out.columns[toColumn];
  const at = beforeId == null ? -1 : column.indexOf(beforeId);
  if (at === -1) column.push(id);
  else column.splice(at, 0, id);
  return out;
}

// ↑ (-1) and ↓ (+1): one step in the one-column order (column 0, then column 1). Crossing the
// boundary moves it into the other column at the matching end: down from the bottom of column 0
// to the top of column 1, up from the top of column 1 to the bottom of column 0.
export function nudgeWidget(layout, id, dir) {
  const out = copy(layout);
  if (dir !== -1 && dir !== 1) return out;
  const [first, second] = out.columns;
  const swap = (column, a, b) => { [column[a], column[b]] = [column[b], column[a]]; };
  const i = first.indexOf(id);
  const j = second.indexOf(id);
  if (i !== -1) {
    if (dir === -1 && i > 0) swap(first, i, i - 1);
    else if (dir === 1 && i < first.length - 1) swap(first, i, i + 1);
    else if (dir === 1) {
      first.splice(i, 1);
      second.unshift(id);
    }
  } else if (j !== -1) {
    if (dir === 1 && j < second.length - 1) swap(second, j, j + 1);
    else if (dir === -1 && j > 0) swap(second, j, j - 1);
    else if (dir === -1) {
      second.splice(j, 1);
      first.push(id);
    }
  }
  return out;
}

// Hide: out of its column, onto the end of `hidden`.
export function hideWidget(layout, id) {
  if (!inColumns(layout, id)) return copy(layout);
  const out = without(layout, id);
  out.hidden.push(id);
  return out;
}

// Show: out of `hidden`, onto the end of column 0.
export function showWidget(layout, id) {
  if (!layout.hidden.includes(id)) return copy(layout);
  const out = without(layout, id);
  out.columns[0].push(id);
  return out;
}

// The saved arrangement, normalised against the widgets this version knows. Nothing saved, or
// storage that can't be read or parsed, gives the default.
export function loadLayout(storage, knownIds) {
  let saved = null;
  try {
    const raw = storage.getItem(LAYOUT_KEY);
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  return normalizeLayout(saved, knownIds);
}

// Saves the arrangement; false (never a throw) when storage is full or blocked.
export function saveLayout(storage, layout) {
  try {
    storage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — 228 tests (208 after Task 2, plus 20 in `tests/layout.test.js`).

Run: `node --check js/layout.js`
Expected: no output.

(No browser check: nothing on the page uses this module until Task 5.)

- [ ] **Step 5: Commit**

```bash
git add js/layout.js tests/layout.test.js
git commit -m "Add the widget arrangement: normalise, move, nudge, hide, show, load, save" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
