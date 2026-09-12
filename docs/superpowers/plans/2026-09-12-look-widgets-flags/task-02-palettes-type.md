# Task 2: Palettes and type

Part of [the look, widgets and flags plan](../2026-09-12-look-widgets-flags.md) — read its Global Constraints first.

**Files:**
- Create: `tests/palette.test.js`
- Modify: `styles.css` (replaced in full), `js/ui/today.js` (three exact edits), `js/ui/side.js` (two
  exact edits), `js/dates.js` (one comment line)

**Interfaces:**
- Consumes: `THEME_COLORS` from `js/look.js` (Task 1); `data-theme` on `<html>`, set by Task 1's inline
  script and `applyLook()`.
- Produces (see the plan's Shared interfaces):
  - The design's token names, and only those: `--bg --panel --ink --muted --border --accent
    --accent-soft --gold --warn --bad --lvl1 --lvl2 --lvl3 --lvl4`, with Paper on
    `:root, :root[data-theme="paper"]` (so a page with no attribute is Paper) and Night on
    `:root[data-theme="night"]`. Shared, look-independent tokens on a bare `:root`: `--radius`,
    `--radius-sm`, `--font`, `--display`. The `prefers-color-scheme` block is gone.
  - Gold for "you did this", and nothing else: class `streak` on a streak (`6-day streak`), class
    `met` on a quota's count on Today once its target is met, on a perWeek habit's `3 of 3 this week`,
    and on a met target's figures in This week; `bar met` on a met target's bar (gold fill). Amber
    (`--warn`) is the carry marker (`.carry`).
  - Type: `html { font-size: 15px }`, `17px` at `min-width: 1100px`; `body` is `1rem`; every other
    fixed size is in `rem`. The date heading (`.top h1`) is in `var(--display)` —
    `Georgia, "Times New Roman", serif`.
  - Unchanged here (Task 5 owns them): `.top` / `.layout` page width and the grid columns, still
    `max-width: 1100px` and `minmax(0, 1fr) 300px`.

**The renames** (the old name → the design's): `--surface` → `--panel`, `--text` → `--ink`,
`--line` → `--border`, `--carry` → `--warn`, `--danger` → `--bad`. No JavaScript uses a CSS variable
today (`grep -rn "var(--" js` finds nothing), so the renames are all inside `styles.css`.
`tests/palette.test.js` checks the old names are gone from `styles.css` and `js/`, and that every
`var(--…)` used is defined — so a missed or mistyped rename fails the suite rather than silently
falling back to the browser's default colour.

**px → rem.** `html` sets the base; `rem` scales with it. Borders, outlines and shadows stay in `px`
(hairlines should stay hairlines), as do media queries (a `rem` in a media query means the browser's
default size, not ours) and the layout widths Task 5 replaces. Everything else that was `px` —
radii, the bar's height, the history grid's gap, the edit panel's and ⚙'s widths — moves to `rem`
at about the same size at 15px.

- [ ] **Step 1: Write the failing tests**

Create `tests/palette.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { THEME_COLORS } from '../js/look.js';

const CSS = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// Every .js file under js/, as text.
function jsSources(dir = new URL('../js/', import.meta.url)) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? jsSources(new URL(`${e.name}/`, dir))
    : e.name.endsWith('.js') ? [readFileSync(new URL(e.name, dir), 'utf8')] : []));
}

// The design's table, verbatim.
const PAPER = {
  '--bg': '#f5f0e7', '--panel': '#fffdf8', '--ink': '#22303c', '--muted': '#6b7a88', '--border': '#e4ded1',
  '--accent': '#0d6e6e', '--accent-soft': '#e3f0ee', '--gold': '#b3803a', '--warn': '#c07a2e', '--bad': '#b3453a',
  '--lvl1': '#e3f0ee', '--lvl2': '#b8d9d4', '--lvl3': '#6fb0a7', '--lvl4': '#0d6e6e',
};
const NIGHT = {
  '--bg': '#1c232b', '--panel': '#252e38', '--ink': '#eef1ed', '--muted': '#a8b3be', '--border': '#36424e',
  '--accent': '#4fb8ac', '--accent-soft': '#20413f', '--gold': '#e0ae62', '--warn': '#eb9a52', '--bad': '#f0806f',
  '--lvl1': '#20413f', '--lvl2': '#2d6660', '--lvl3': '#3f958b', '--lvl4': '#4fb8ac',
};

// The body of the first rule whose selector matches `selector` (a regex source), as text.
function blockText(selector) {
  const m = CSS.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `no rule for ${selector}`);
  return m[1];
}
const vars = (text) => Object.fromEntries([...text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
const PAPER_SEL = ':root,\\s*:root\\[data-theme="paper"\\]';
const NIGHT_SEL = ':root\\[data-theme="night"\\]';
const SHARED_SEL = '(?:^|\\n):root';

// Every simple rule (no nested braces) as [selector, body], comments removed; rules inside @media
// come out too.
const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = () => [...BARE.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => [sel.trim().replace(/\s+/g, ' '), body]);

test("Paper and Night carry the design's palette exactly", () => {
  assert.deepEqual(vars(blockText(PAPER_SEL)), PAPER);
  assert.deepEqual(vars(blockText(NIGHT_SEL)), NIGHT);
});

test('a page with no data-theme is Paper, and each look sets its color-scheme', () => {
  assert.match(CSS, /(?:^|\n):root,\s*:root\[data-theme="paper"\]\s*\{/);
  assert.match(blockText(PAPER_SEL), /color-scheme:\s*light;/);
  assert.match(blockText(NIGHT_SEL), /color-scheme:\s*dark;/);
});

test("the title-bar colours are each look's --bg", () => {
  assert.equal(THEME_COLORS.paper, PAPER['--bg']);
  assert.equal(THEME_COLORS.night, NIGHT['--bg']);
});

test('the look no longer follows the operating system', () => {
  assert.doesNotMatch(CSS, /prefers-color-scheme/);
});

test('one vocabulary: the old token names are gone, and every var() used is defined', () => {
  const sources = [CSS, ...jsSources()];
  for (const src of sources) assert.doesNotMatch(src, /--(?:surface|text|line|carry|danger)\b/);
  const defined = new Set([...Object.keys(vars(blockText(PAPER_SEL))), ...Object.keys(vars(blockText(SHARED_SEL)))]);
  assert.deepEqual(Object.keys(vars(blockText(NIGHT_SEL))).sort(), Object.keys(PAPER).sort());
  for (const name of ['--radius', '--radius-sm', '--font', '--display']) assert.ok(defined.has(name), name);
  for (const src of sources) {
    for (const [, name] of src.matchAll(/var\((--[\w-]+)/g)) assert.ok(defined.has(name), `${name} is not defined`);
  }
});

test('type: 15px, 17px from 1100px wide; the date heading in Georgia', () => {
  assert.match(CSS, /(?:^|\n)html\s*\{\s*font-size:\s*15px;\s*\}/);
  assert.match(CSS, /@media \(min-width: 1100px\)\s*\{\s*html\s*\{\s*font-size:\s*17px;\s*\}\s*\}/);
  assert.equal(vars(blockText(SHARED_SEL))['--display'], 'Georgia, "Times New Roman", serif');
  const body = rules().find(([sel]) => sel === 'body');
  assert.match(body[1], /font:\s*1rem\/1\.45 var\(--font\)/);
  const h1 = rules().find(([sel]) => sel === '.top h1');
  assert.match(h1[1], /font-family:\s*var\(--display\)/);
});

test('fixed sizes are in rem (borders, outlines, shadows, media queries and page widths aside)', () => {
  const sized = /^(?:font-size|font|border-radius|gap|row-gap|column-gap|height|width|min-height|padding(?:-\w+)?|margin(?:-\w+)?|letter-spacing|line-height)$/;
  for (const [sel, body] of rules()) {
    if (sel === 'html') continue;
    for (const decl of body.split(';')) {
      const [prop, ...rest] = decl.split(':');
      if (!sized.test(prop.trim())) continue;
      const value = rest.join(':').replace(/(?:min|max|clamp)\([^)]*\)/g, '');
      assert.doesNotMatch(value, /\d+px/, `${sel} { ${decl.trim()} }`);
    }
  }
});

test('gold means "you did this" and is used for nothing else', () => {
  const gold = rules().filter(([, body]) => body.includes('var(--gold)')).map(([sel]) => sel).sort();
  assert.deepEqual(gold, ['.bar.met > span', '.met', '.streak']);
  const amber = rules().filter(([, body]) => body.includes('var(--warn)')).map(([sel]) => sel).sort();
  assert.deepEqual(amber, ['.carry', '.coach h2 .fake']);
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `npm test`
Expected: FAIL — seven of the eight tests in `tests/palette.test.js` (only `the title-bar colours are
each look's --bg` passes, as it reads only Task 1's `THEME_COLORS`):
- `Paper and Night carry the design's palette exactly` — `no rule for :root,\s*:root\[data-theme="paper"\]`
- `a page with no data-theme is Paper, and each look sets its color-scheme` — the pattern doesn't match
- `the look no longer follows the operating system` — `styles.css` still has `prefers-color-scheme`
- `one vocabulary: …` — `--surface` is still there
- `type: …` — no `html { font-size: 15px; }`
- `fixed sizes are in rem …` — `body { font: 15px/1.45 var(--font) }` (the first of several)
- `gold means "you did this" …` — no rule uses `var(--gold)` yet

- [ ] **Step 3: Replace `styles.css`**

The whole file, in the same order as today: the two palettes and the shared tokens, base type, then
each section with its colours renamed and its fixed sizes in `rem`. The layout rules (`.top`,
`.layout`) are unchanged apart from colour; Task 5 rewrites them.

```css
/* Paper & Ink by day, Night in the evening: the Hebrew app's palette. Teal is something you can
   act on; gold is "you did this" (streaks, a target met, a finished weekly habit) and nothing else;
   amber is carried over. js/look.js picks the look and index.html sets it before the first paint. */

:root,
:root[data-theme="paper"] {
  --bg: #f5f0e7;
  --panel: #fffdf8;
  --ink: #22303c;
  --muted: #6b7a88;
  --border: #e4ded1;
  --accent: #0d6e6e;
  --accent-soft: #e3f0ee;
  --gold: #b3803a;
  --warn: #c07a2e;
  --bad: #b3453a;
  --lvl1: #e3f0ee;
  --lvl2: #b8d9d4;
  --lvl3: #6fb0a7;
  --lvl4: #0d6e6e;
  color-scheme: light;
}

:root[data-theme="night"] {
  --bg: #1c232b;
  --panel: #252e38;
  --ink: #eef1ed;
  --muted: #a8b3be;
  --border: #36424e;
  --accent: #4fb8ac;
  --accent-soft: #20413f;
  --gold: #e0ae62;
  --warn: #eb9a52;
  --bad: #f0806f;
  --lvl1: #20413f;
  --lvl2: #2d6660;
  --lvl3: #3f958b;
  --lvl4: #4fb8ac;
  color-scheme: dark;
}

:root {
  --radius: .5rem;
  --radius-sm: .4rem;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --display: Georgia, "Times New Roman", serif;
}

/* Base type: 15px, and 17px on big windows. Fixed sizes below are in rem, so they scale with it. */
html { font-size: 15px; }
@media (min-width: 1100px) {
  html { font-size: 17px; }
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 1rem/1.45 var(--font); }
button, input, select, textarea { font: inherit; color: inherit; }
[hidden] { display: none !important; }
.muted { color: var(--muted); }

/* Header */
.top {
  display: flex; justify-content: space-between; align-items: baseline; gap: 1rem;
  max-width: 1100px; margin: 0 auto; padding: 1.5rem 1.5rem .75rem;
}
.top h1 { display: inline; font-family: var(--display); font-size: 1.65rem; font-weight: 400; margin: 0 .75rem 0 0; }
.top-actions { display: flex; gap: .75rem; align-items: center; }
.warning { color: var(--bad); font-size: .85rem; }
button.link { background: none; border: 0; padding: 0; color: var(--muted); cursor: pointer; font-size: .85rem; }
button.link:hover { color: var(--ink); text-decoration: underline; }
button.icon { background: none; border: 0; padding: .25rem; font-size: 1.1rem; color: var(--muted); cursor: pointer; }
.sync-failing { color: var(--bad) !important; }

/* Layout: list on the left, a narrow column on the right; stacked below 760px */
.layout {
  display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 2rem; align-items: start;
  max-width: 1100px; margin: 0 auto; padding: 0 1.5rem 3rem;
}
@media (max-width: 759px) {
  .layout { grid-template-columns: 1fr; }
  .top { flex-wrap: wrap; }
}

/* The list */
.list { list-style: none; margin: 0; padding: 0; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); }
.row { display: flex; align-items: center; gap: .75rem; min-height: 2.75rem; padding: .6rem .9rem; border-top: 1px solid var(--border); }
.row:first-child { border-top: 0; }
.row.done { opacity: .7; }
.row.done .title { color: var(--muted); text-decoration: line-through; }
.row.suggested { opacity: .65; border-left: 3px dashed var(--accent); }
.row.dragging { opacity: .4; }
.row.drop-before { box-shadow: inset 0 2px 0 var(--accent); }
.row input[type=checkbox] { flex: none; width: 1.1rem; height: 1.1rem; margin: 0; accent-color: var(--accent); cursor: pointer; }
.row .spacer { flex: none; width: 1.1rem; }
.row .title { flex: 1; min-width: 0; overflow-wrap: anywhere; cursor: pointer; }
.row .meta { flex: none; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .5rem; align-items: center; font-size: .8rem; color: var(--muted); }
.tag { background: var(--accent-soft); color: var(--accent); border-radius: 999rem; padding: .05rem .5rem; font-size: .75rem; }
.carry { color: var(--warn); font-weight: 500; }
.streak { color: var(--gold); }
.met { color: var(--gold); font-weight: 500; }
.by { font-style: italic; }
.count { font-variant-numeric: tabular-nums; cursor: pointer; }
.plus, .accept, .dismiss {
  width: 1.8rem; height: 1.8rem; line-height: 1; cursor: pointer;
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-sm);
}
.plus:hover, .accept:hover { border-color: var(--accent); color: var(--accent); }
.dismiss:hover { border-color: var(--bad); color: var(--bad); }
.amount-input { width: 5.5rem; padding: .2rem .4rem; background: var(--panel); border: 1px solid var(--accent); border-radius: var(--radius-sm); }
.amount-input.invalid { border-color: var(--bad); }
.entries-row { padding: 0 .9rem .4rem; }
.entries { list-style: none; margin: 0 0 0 1.85rem; padding: 0; font-size: .85rem; color: var(--muted); }
.entries li { display: flex; gap: .5rem; align-items: center; padding: .1rem 0; }
.empty { padding: 1rem .9rem; color: var(--muted); }

@media (max-width: 759px) {
  .row { flex-wrap: wrap; row-gap: .25rem; }
  .row .title { flex: 1 1 0; }
  .row .meta { flex-basis: 100%; justify-content: flex-start; padding-left: 1.85rem; }
}

/* Add box */
.add { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-top: .75rem; }
.add input[type=text] { flex: 1; min-width: 12rem; padding: .55rem .75rem; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); }
.add select, .add input[type=date] { padding: .5rem; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); }
.add input:focus, .add select:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); }

/* Side column */
.side { display: flex; flex-direction: column; gap: 1.5rem; }
.panel h2 {
  display: flex; justify-content: space-between; align-items: center; margin: 0 0 .5rem;
  font-size: .8rem; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted);
}
.bar-row { margin-bottom: .6rem; font-size: .9rem; }
.bar-label { display: flex; justify-content: space-between; gap: .5rem; }
.bar { height: .4rem; margin-top: .2rem; background: var(--border); border-radius: .2rem; overflow: hidden; }
.bar > span { display: block; height: 100%; background: var(--accent); }
.bar.met > span { background: var(--gold); }
.goal { margin-bottom: .5rem; padding: .6rem .75rem; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); }
.goal.suggested { opacity: .65; border-style: dashed; }
.goal-head { display: flex; justify-content: space-between; gap: .5rem; cursor: pointer; }
.goal-body { margin-top: .5rem; font-size: .9rem; }
.goal-body ul { list-style: none; margin: .25rem 0; padding: 0; }
.goal-body li { display: flex; gap: .5rem; align-items: center; padding: .15rem 0; }
.goal-body input[type=text] { width: 100%; padding: .3rem .5rem; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); }
.grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: .25rem; }
.grid .dow { font-size: .7rem; color: var(--muted); text-align: center; }
.cell {
  display: flex; align-items: center; justify-content: center; aspect-ratio: 1; padding: 0;
  font-size: .65rem; font-variant-numeric: tabular-nums; color: var(--ink);
  background: var(--border); border: 0; border-radius: .25rem; cursor: pointer;
}
.cell.lvl1 { background: var(--lvl1); }
.cell.lvl2 { background: var(--lvl2); }
.cell.lvl3 { background: var(--lvl3); }
.cell.lvl4 { background: var(--lvl4); color: var(--panel); }
.cell.future { background: transparent; border: 1px dashed var(--border); cursor: default; }
.cell.today { outline: 2px solid var(--ink); outline-offset: 1px; }
.cell.selected { outline: 2px solid var(--accent); outline-offset: 1px; }
.day-detail { margin-top: .6rem; padding: .5rem .75rem; font-size: .85rem; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); }
.day-detail ul { list-style: none; margin: .25rem 0 0; padding: 0; }
.day-detail .miss { color: var(--muted); }

/* Edit panel */
.editor {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 10; width: min(25rem, 100vw); padding: 1.25rem; overflow: auto;
  background: var(--panel); border-left: 1px solid var(--border); box-shadow: -8px 0 24px rgb(0 0 0 / .08);
}
.editor h2 { margin: 0 0 1rem; font-size: 1.1rem; }
.field { display: flex; flex-direction: column; gap: .25rem; margin-bottom: .9rem; font-size: .9rem; }
.field > span { font-size: .8rem; color: var(--muted); }
.field input, .field select { padding: .45rem .6rem; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); }
.days { display: flex; flex-wrap: wrap; gap: .35rem; }
.days label { display: flex; align-items: center; gap: .2rem; font-size: .85rem; }
.error { min-height: 1.2em; font-size: .85rem; color: var(--bad); }
.buttons { display: flex; gap: .5rem; margin-top: 1rem; }
.btn { padding: .45rem .9rem; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; }
.btn.primary { background: var(--accent); color: var(--panel); border-color: var(--accent); }
.btn.danger { margin-left: auto; color: var(--bad); }

/* Settings */
.settings { width: min(30rem, 92vw); padding: 1.25rem; color: var(--ink); background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); }
.settings::backdrop { background: rgb(0 0 0 / .3); }
.settings h2 { margin: 0 0 1rem; font-size: 1.1rem; }
.settings .note { margin: -.4rem 0 .9rem; font-size: .8rem; color: var(--muted); }
.settings hr { margin: 1rem 0; border: 0; border-top: 1px solid var(--border); }

.goal-body input.invalid { border-color: var(--bad); }

/* Coach panel */
.coach h2 .fake { font-weight: 400; letter-spacing: 0; text-transform: none; color: var(--warn); }
.coach p { margin: 0 0 .5rem; font-size: .9rem; }
.coach .error { min-height: 0; margin: .4rem 0 0; }
.checkin .question { display: flex; flex-direction: column; gap: .25rem; margin-bottom: .6rem; font-size: .9rem; }
.coach textarea {
  width: 100%; padding: .35rem .5rem; resize: vertical;
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-sm);
}
.coach textarea:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); }
.checkin .buttons { align-items: center; margin-top: .25rem; }
.coach details {
  margin-bottom: .5rem; padding: .5rem .75rem; font-size: .9rem;
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
}
.coach summary { cursor: pointer; font-weight: 500; }
.coach details p { margin: .5rem 0 0; }
.coach .feedback-text { white-space: pre-line; }

/* Shape with AI, and the suggested goal it makes */
.panel-links { display: flex; gap: .75rem; }
.shape { margin-bottom: .75rem; }
.shape textarea {
  width: 100%; padding: .35rem .5rem; resize: vertical;
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-sm);
}
.shape textarea:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); }
.shape .buttons { align-items: center; margin-top: .4rem; }
.shape .error { min-height: 0; margin: .4rem 0 0; }
.goal.suggested.plan { opacity: .85; }
.goal .why { margin: .35rem 0 0; font-size: .85rem; }
.proposal { margin: .35rem 0 0; padding-left: 1.2rem; font-size: .85rem; }
.proposal li { padding: .05rem 0; }
.goal .plan-note { margin-top: .35rem; font-size: .8rem; }
.row .for { color: var(--accent); font-weight: 500; }

/* Last week's digest */
.coach .digest-summary { white-space: pre-line; }
.coach .digest strong { font-weight: 600; }
.coach .digest-write { margin-top: .5rem; }
```

- [ ] **Step 4: Gold on Today, in `js/ui/today.js`**

4a. A quota's count, once this week's target is met (`row.done` is `total >= target`) — replace:

```js
  const count = h('span', {
    class: 'count', title: "Show this week's entries",
```

with:

```js
  const count = h('span', {
    class: row.done ? 'count met' : 'count', title: "Show this week's entries",
```

4b. A streak — replace:

```js
    if (text) meta.append(h('span', { title: `Best: ${s.best}` }, text));
```

with:

```js
    if (text) meta.append(h('span', { class: 'streak', title: `Best: ${s.best}` }, text));
```

4c. A finished perWeek habit (`3 of 3 this week`) — replace:

```js
    meta.append(h('span', {}, `${ticks} of ${item.repeat.n} this week`));
```

with:

```js
    meta.append(h('span', { class: ticks >= item.repeat.n ? 'met' : null }, `${ticks} of ${item.repeat.n} this week`));
```

(`h()` skips a `null` attribute, so an unfinished one has no class at all, as before.)

- [ ] **Step 5: Gold on a met target in This week, in `js/ui/side.js`**

5a. The bar takes a `met` flag — replace:

```js
function bar(pct, label) {
  return h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': label },
    h('span', { style: `width:${pct}%` }));
}
```

with:

```js
// A progress bar; `met` fills it gold ("you did this") instead of teal.
function bar(pct, label, met = false) {
  return h('div', { class: met ? 'bar met' : 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': label },
    h('span', { style: `width:${pct}%` }));
}
```

5b. In `renderWeek` — replace:

```js
      return h('div', { class: 'bar-row' },
        h('div', { class: 'bar-label' }, h('span', {}, q.title), h('span', { class: 'muted' }, formatProgress(total, q.target, q.unit))),
        bar(pct, q.title));
```

with:

```js
      const met = total >= q.target;
      return h('div', { class: 'bar-row' },
        h('div', { class: 'bar-label' }, h('span', {}, q.title), h('span', { class: met ? 'met' : 'muted' }, formatProgress(total, q.target, q.unit))),
        bar(pct, q.title, met));
```

Goal bars keep calling `bar(progress.pct, goal.title)` — teal, as the design lists gold only for
streaks, targets met and finished weekly habits.

- [ ] **Step 6: The carry marker's comment in `js/dates.js`**

Replace:

```js
// The orange marker on a carried-over task.
```

with:

```js
// The amber marker on a carried-over task.
```

- [ ] **Step 7: Run the tests and check the syntax**

Run: `npm test`
Expected: PASS — 208 tests (200 after Task 1, plus 8 in `tests/palette.test.js`).

Run: `node --check js/ui/today.js && node --check js/ui/side.js && node --check js/dates.js`
Expected: no output.

- [ ] **Step 8: Check it in the browser** (controller)

Serve with `preview_start` `dashboard`, open `http://localhost:8080/dev/seed.html?replace`, then
`http://localhost:8080/?fakegemini`; reload twice (the offline cache).

1. **Paper** (⚙ → Look → *Paper* → Save): `getComputedStyle(document.body).backgroundColor` is
   `rgb(245, 240, 231)`; the list is `rgb(255, 253, 248)`; text `rgb(34, 48, 60)`. The date heading is in
   Georgia (`getComputedStyle(document.querySelector('.top h1')).fontFamily` starts with `Georgia`).
2. **Night** (*Night* → Save): the body is `rgb(28, 35, 43)`, the list `rgb(37, 46, 56)`, text
   `rgb(238, 241, 237)`; `meta[name=theme-color]` is `#1c232b`. Native controls (the selects, the
   date box, scrollbars) are dark too (`color-scheme: dark`).
3. **Gold, in both looks:** a streak of 2 or more (the seed's daily habit) reads in gold
   (`rgb(179, 128, 58)` on Paper, `rgb(224, 174, 98)` on Night); log a quota up to its target → its
   count on Today and its figures and bar in This week turn gold; a perWeek habit ticked `n` times
   this week reads `3 of 3 this week` in gold. Anything not yet met stays grey / teal.
4. **Amber:** a carried-over task's *from Tue* marker is `rgb(192, 122, 46)` (Paper) /
   `rgb(235, 154, 82)` (Night).
5. **Type:** at a 1200px-wide window `getComputedStyle(document.documentElement).fontSize` is `17px`,
   at 1000px `15px`; rows, buttons, the history grid and the bars scale with it.
6. The operating system's dark mode no longer changes anything (`resize_window` `colorScheme: 'dark'`
   with Look on *Paper* still shows Paper).
7. No console errors apart from the Browser pane's service-worker refusal.

- [ ] **Step 9: Commit**

```bash
git add styles.css tests/palette.test.js js/ui/today.js js/ui/side.js js/dates.js
git commit -m "Paper and Night palettes, gold for done things, type in rem" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
