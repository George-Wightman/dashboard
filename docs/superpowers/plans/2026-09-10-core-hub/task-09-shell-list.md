# Task 9: Page shell, header and the list

Part of [the core hub plan](../2026-09-10-core-hub.md) — read its Global Constraints first.

**Files:**
- Create: `index.html`, `styles.css`, `js/ui/dom.js`, `js/ui/today.js`, `js/app.js`, `dev/seed.html`

**Interfaces:**
- Consumes: `createStore` (`js/data.js`); `todayRows`, `streak`, `doneBetween`,
  `dayCompletion` (`js/schedule.js`); `longDate`, `carryLabel`, `addDays`, `weekStart`,
  `weekday`, `logicalDay` (`js/dates.js`); `formatProgress` (`js/parse.js`); `emptyDoc`
  (`js/doc.js`).
- Produces:
  - `h(tag, attrs, ...children)` in `js/ui/dom.js`. `on*` attrs become listeners, `class` sets
    `className`, `true` sets an empty attribute, `null`/`false`/`undefined` skip. Children may be
    nodes, strings, numbers, arrays, or `null`/`false` (skipped).
  - `renderToday(ctx)` and `initAddBox(ctx)` in `js/ui/today.js`.
  - `ctx` (built in `js/app.js`, passed to every UI module):
    `{ store, ui, render(), openEditor({ map, id?, type? }), openSettings() }`.
    `ui` is the view state that survives re-renders:
    `{ entriesFor, amountFor, expandedGoals: Set, historyDay, editorDirty }`.
    `openEditor` and `openSettings` are no-op stubs until Tasks 12 and 13.
  - Element ids used by later tasks: `#date`, `#count`, `#save-warning`, `#sync-status`,
    `#settings-button`, `#list`, `#add`, `#add-title`, `#add-when`, `#add-date`, `#add-more`,
    `#side`, `#editor`, `#settings`.
  - The whole stylesheet, including classes later tasks use (`.panel`, `.bar`, `.goal`,
    `.grid`, `.cell`, `.editor`, `.field`, `.btn`, `.settings`, ...). Later tasks don't edit CSS
    unless something is visibly broken.
- The add box lives in `index.html`, outside the re-rendered list, so a re-render (for example a
  sync landing) never wipes what's being typed.

There is no unit test for DOM code. Checking is done in the browser (Step 8).

- [ ] **Step 1: `index.html`**

```html
<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Today</title>
  <meta name="theme-color" content="#f7f7f5">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" href="icons/icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="top">
    <div class="top-date">
      <h1 id="date"></h1>
      <span id="count" class="muted"></span>
    </div>
    <div class="top-actions">
      <span id="save-warning" class="warning" hidden></span>
      <button id="sync-status" class="link" type="button"></button>
      <button id="settings-button" class="icon" type="button" aria-label="Settings">⚙</button>
    </div>
  </header>

  <main class="layout">
    <section class="today" aria-label="Today">
      <ul id="list" class="list"></ul>
      <form id="add" class="add" autocomplete="off">
        <input id="add-title" type="text" placeholder="Add a task…" aria-label="New task">
        <select id="add-when" aria-label="When">
          <option value="today">Today</option>
          <option value="tomorrow">Tomorrow</option>
          <option value="date">On a date…</option>
        </select>
        <input id="add-date" type="date" hidden aria-label="Date">
        <button id="add-more" type="button" class="link">New habit, quota or goal…</button>
      </form>
    </section>
    <aside id="side" class="side" aria-label="Week, goals and history"></aside>
  </main>

  <aside id="editor" class="editor" hidden aria-label="Edit"></aside>
  <dialog id="settings" class="settings"></dialog>

  <script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: `styles.css`**

```css
/* Plain and quiet: system font, neutral greys, one accent. Orange only for carry-over markers. */

:root {
  --bg: #f7f7f5;
  --surface: #ffffff;
  --text: #1f2328;
  --muted: #6e7781;
  --line: #e4e4e0;
  --accent: #2f6f5e;
  --accent-soft: #e3efeb;
  --carry: #c2570c;
  --danger: #b42318;
  --lvl1: #e3efeb;
  --lvl2: #b9d8cd;
  --lvl3: #7fb5a3;
  --lvl4: #2f6f5e;
  --radius: 8px;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #151718;
    --surface: #1d2022;
    --text: #e6e6e3;
    --muted: #9aa0a6;
    --line: #2c3033;
    --accent: #6fc3a8;
    --accent-soft: #1f3a33;
    --carry: #f0883e;
    --danger: #f97066;
    --lvl1: #1f3a33;
    --lvl2: #2c5a4c;
    --lvl3: #3f8a72;
    --lvl4: #6fc3a8;
  }
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.45 var(--font); }
button, input, select, textarea { font: inherit; color: inherit; }
[hidden] { display: none !important; }
.muted { color: var(--muted); }

/* Header */
.top {
  display: flex; justify-content: space-between; align-items: baseline; gap: 1rem;
  max-width: 1100px; margin: 0 auto; padding: 1.5rem 1.5rem .75rem;
}
.top h1 { display: inline; font-size: 1.5rem; font-weight: 600; margin: 0 .75rem 0 0; }
.top-actions { display: flex; gap: .75rem; align-items: center; }
.warning { color: var(--danger); font-size: .85rem; }
button.link { background: none; border: 0; padding: 0; color: var(--muted); cursor: pointer; font-size: .85rem; }
button.link:hover { color: var(--text); text-decoration: underline; }
button.icon { background: none; border: 0; padding: .25rem; font-size: 1.1rem; color: var(--muted); cursor: pointer; }
.sync-failing { color: var(--danger) !important; }

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
.list { list-style: none; margin: 0; padding: 0; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }
.row { display: flex; align-items: center; gap: .75rem; min-height: 2.75rem; padding: .6rem .9rem; border-top: 1px solid var(--line); }
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
.tag { background: var(--accent-soft); color: var(--accent); border-radius: 999px; padding: .05rem .5rem; font-size: .75rem; }
.carry { color: var(--carry); font-weight: 500; }
.by { font-style: italic; }
.count { font-variant-numeric: tabular-nums; cursor: pointer; }
.plus, .accept, .dismiss {
  width: 1.8rem; height: 1.8rem; line-height: 1; cursor: pointer;
  background: var(--surface); border: 1px solid var(--line); border-radius: 6px;
}
.plus:hover, .accept:hover { border-color: var(--accent); color: var(--accent); }
.dismiss:hover { border-color: var(--danger); color: var(--danger); }
.amount-input { width: 5.5rem; padding: .2rem .4rem; background: var(--surface); border: 1px solid var(--accent); border-radius: 6px; }
.amount-input.invalid { border-color: var(--danger); }
.entries-row { padding: 0 .9rem .4rem; }
.entries { list-style: none; margin: 0 0 0 1.85rem; padding: 0; font-size: .85rem; color: var(--muted); }
.entries li { display: flex; gap: .5rem; align-items: center; padding: .1rem 0; }
.empty { padding: 1rem .9rem; color: var(--muted); }

/* Add box */
.add { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-top: .75rem; }
.add input[type=text] { flex: 1; min-width: 12rem; padding: .55rem .75rem; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }
.add select, .add input[type=date] { padding: .5rem; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }
.add input:focus, .add select:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); }

/* Side column */
.side { display: flex; flex-direction: column; gap: 1.5rem; }
.panel h2 {
  display: flex; justify-content: space-between; align-items: center; margin: 0 0 .5rem;
  font-size: .8rem; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted);
}
.bar-row { margin-bottom: .6rem; font-size: .9rem; }
.bar-label { display: flex; justify-content: space-between; gap: .5rem; }
.bar { height: 6px; margin-top: .2rem; background: var(--line); border-radius: 3px; overflow: hidden; }
.bar > span { display: block; height: 100%; background: var(--accent); }
.goal { margin-bottom: .5rem; padding: .6rem .75rem; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }
.goal.suggested { opacity: .65; border-style: dashed; }
.goal-head { display: flex; justify-content: space-between; gap: .5rem; cursor: pointer; }
.goal-body { margin-top: .5rem; font-size: .9rem; }
.goal-body ul { list-style: none; margin: .25rem 0; padding: 0; }
.goal-body li { display: flex; gap: .5rem; align-items: center; padding: .15rem 0; }
.goal-body input[type=text] { width: 100%; padding: .3rem .5rem; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; }
.grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.grid .dow { font-size: .7rem; color: var(--muted); text-align: center; }
.cell {
  display: flex; align-items: center; justify-content: center; aspect-ratio: 1; padding: 0;
  font-size: .65rem; font-variant-numeric: tabular-nums; color: var(--text);
  background: var(--line); border: 0; border-radius: 4px; cursor: pointer;
}
.cell.lvl1 { background: var(--lvl1); }
.cell.lvl2 { background: var(--lvl2); }
.cell.lvl3 { background: var(--lvl3); }
.cell.lvl4 { background: var(--lvl4); color: var(--surface); }
.cell.future { background: transparent; border: 1px dashed var(--line); cursor: default; }
.cell.today { outline: 2px solid var(--text); outline-offset: 1px; }
.cell.selected { outline: 2px solid var(--accent); outline-offset: 1px; }
.day-detail { margin-top: .6rem; padding: .5rem .75rem; font-size: .85rem; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }
.day-detail ul { list-style: none; margin: .25rem 0 0; padding: 0; }
.day-detail .miss { color: var(--muted); }

/* Edit panel */
.editor {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 10; width: min(380px, 100vw); padding: 1.25rem; overflow: auto;
  background: var(--surface); border-left: 1px solid var(--line); box-shadow: -8px 0 24px rgb(0 0 0 / .08);
}
.editor h2 { margin: 0 0 1rem; font-size: 1.1rem; }
.field { display: flex; flex-direction: column; gap: .25rem; margin-bottom: .9rem; font-size: .9rem; }
.field > span { font-size: .8rem; color: var(--muted); }
.field input, .field select { padding: .45rem .6rem; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; }
.days { display: flex; flex-wrap: wrap; gap: .35rem; }
.days label { display: flex; align-items: center; gap: .2rem; font-size: .85rem; }
.error { min-height: 1.2em; font-size: .85rem; color: var(--danger); }
.buttons { display: flex; gap: .5rem; margin-top: 1rem; }
.btn { padding: .45rem .9rem; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; cursor: pointer; }
.btn.primary { background: var(--accent); color: var(--surface); border-color: var(--accent); }
.btn.danger { margin-left: auto; color: var(--danger); }

/* Settings */
.settings { width: min(460px, 92vw); padding: 1.25rem; color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }
.settings::backdrop { background: rgb(0 0 0 / .3); }
.settings h2 { margin: 0 0 1rem; font-size: 1.1rem; }
.settings .note { margin: -.4rem 0 .9rem; font-size: .8rem; color: var(--muted); }
.settings hr { margin: 1rem 0; border: 0; border-top: 1px solid var(--line); }
```

- [ ] **Step 3: `js/ui/dom.js`**

```js
// A tiny element builder: h('button', { class: 'plus', onclick }, '+').

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}
```

- [ ] **Step 4: `js/ui/today.js`**

```js
// The list: everything on today, one row each, and the add box beneath it.

import { h } from './dom.js';
import { todayRows, streak, doneBetween } from '../schedule.js';
import { carryLabel, addDays, weekStart } from '../dates.js';
import { formatProgress } from '../parse.js';

export const SOURCE_NAMES = { claude: 'Claude', gemini: 'Gemini', hebrew: 'Hebrew app', notion: 'Notion' };

function streakText(item, s) {
  if (s.current < 2) return null;
  if (item.type === 'quota' || item.repeat?.kind === 'perWeek') return `${s.current}-week streak`;
  if (item.repeat?.kind === 'daily') return `${s.current}-day streak`;
  return `${s.current} in a row`;
}

function quotaLabel(row) {
  const { item } = row;
  const unit = item.unit === 'count' && item.unitLabel ? ` ${item.unitLabel}` : '';
  return `${formatProgress(row.total, item.target, item.unit)}${unit} this week`;
}

// Replaced in Task 10 with the + button and the amount input.
function quotaControls(row) {
  return [h('span', { class: 'count' }, quotaLabel(row))];
}

function renderMeta(row, ctx) {
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const { item } = row;
  const meta = h('span', { class: 'meta' });
  if (row.carriedFrom) meta.append(h('span', { class: 'carry' }, carryLabel(row.carriedFrom, today)));
  if (SOURCE_NAMES[item.source]) meta.append(h('span', { class: 'by' }, `added by ${SOURCE_NAMES[item.source]}`));
  if (item.area) meta.append(h('span', { class: 'tag' }, item.area));
  if (item.type !== 'task') {
    const s = streak(doc, item, today);
    const text = streakText(item, s);
    if (text) meta.append(h('span', { title: `Best: ${s.best}` }, text));
  }
  if (item.repeat?.kind === 'perWeek') {
    const ticks = doneBetween(doc, item.id, weekStart(today), addDays(today, 1));
    meta.append(h('span', {}, `${ticks} of ${item.repeat.n} this week`));
  }
  if (row.kind === 'quota') meta.append(...quotaControls(row, ctx));
  return meta;
}

function renderSuggestion(row, ctx) {
  const { store } = ctx;
  const { item } = row;
  return h('li', { class: 'row suggested', 'data-id': item.id },
    h('button', { class: 'accept', type: 'button', title: 'Add it', 'aria-label': `Accept ${item.title}`,
      onclick: () => store.acceptSuggestion('items', item.id) }, '✓'),
    h('span', { class: 'title' }, item.title),
    h('span', { class: 'meta' }, h('span', { class: 'by' }, `suggested by ${SOURCE_NAMES[item.source] ?? item.source}`)),
    h('button', { class: 'dismiss', type: 'button', title: 'Not for me', 'aria-label': `Dismiss ${item.title}`,
      onclick: () => store.dismissSuggestion('items', item.id) }, '✕'));
}

function renderRow(row, ctx) {
  if (row.suggested) return renderSuggestion(row, ctx);
  const { store } = ctx;
  const { item } = row;
  const li = h('li', { class: row.done ? 'row done' : 'row', 'data-id': item.id });
  li.append(row.kind === 'quota'
    ? h('span', { class: 'spacer' })
    : h('input', { type: 'checkbox', checked: row.done, 'aria-label': `Done: ${item.title}`,
      onchange: () => store.toggleDone(item.id, store.today()) }));
  li.append(h('span', { class: 'title', onclick: () => ctx.openEditor({ map: 'items', id: item.id }) }, item.title));
  li.append(renderMeta(row, ctx));
  return li;
}

export function renderToday(ctx) {
  const list = document.getElementById('list');
  const rows = todayRows(ctx.store.doc(), ctx.store.today());
  if (!rows.length) {
    list.replaceChildren(h('li', { class: 'empty' }, 'Nothing on today. Add a task below, or set up a habit.'));
    return;
  }
  list.replaceChildren(...rows.map((row) => renderRow(row, ctx)));
}

export function initAddBox(ctx) {
  const title = document.getElementById('add-title');
  const when = document.getElementById('add-when');
  const date = document.getElementById('add-date');

  when.addEventListener('change', () => {
    date.hidden = when.value !== 'date';
    if (!date.hidden && !date.value) date.value = addDays(ctx.store.today(), 1);
  });

  function add() {
    const text = title.value.trim();
    if (!text) return;
    const today = ctx.store.today();
    let day = today;
    if (when.value === 'tomorrow') day = addDays(today, 1);
    if (when.value === 'date' && date.value) day = date.value;
    ctx.store.addItem({ type: 'task', title: text, date: day });
    title.value = '';
    title.focus();
  }

  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  });
  document.getElementById('add').addEventListener('submit', (e) => { e.preventDefault(); add(); });
  document.getElementById('add-more').addEventListener('click', () => ctx.openEditor({ map: 'items', type: 'habit' }));
}
```

- [ ] **Step 5: `js/app.js`**

```js
// Boot: one store, one render loop, and the header.

import { createStore } from './data.js';
import { longDate } from './dates.js';
import { dayCompletion } from './schedule.js';
import { renderToday, initAddBox } from './ui/today.js';

const store = createStore({ storage: localStorage });
const ui = { entriesFor: null, amountFor: null, expandedGoals: new Set(), historyDay: null, editorDirty: false };
const ctx = {
  store,
  ui,
  render,
  openEditor: () => {},   // Task 12
  openSettings: () => {}, // Task 13
};

let shownDay = store.today();

function renderHeader() {
  const today = store.today();
  document.getElementById('date').textContent = longDate(today);
  const { done, total } = dayCompletion(store.doc(), today);
  document.getElementById('count').textContent = total ? `${done} of ${total} done` : '';
  document.title = total ? `Today · ${done}/${total}` : 'Today';
  const warning = document.getElementById('save-warning');
  const problem = store.saveError() ? "Couldn't save on this device — export a backup from settings" : store.loadError();
  warning.hidden = !problem;
  warning.textContent = problem ?? '';
  document.getElementById('sync-status').textContent = 'on this device';
}

function render() {
  renderHeader();
  renderToday(ctx);
}

// The app sits open all day: when the logical day changes, rebuild.
function checkRollover() {
  const day = store.today();
  if (day !== shownDay) {
    shownDay = day;
    ui.historyDay = null;
    render();
  }
}

store.subscribe(() => render());
initAddBox(ctx);
document.getElementById('settings-button').addEventListener('click', () => ctx.openSettings());
window.addEventListener('focus', checkRollover);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkRollover(); });
setInterval(checkRollover, 60000);
render();
```

- [ ] **Step 6: `dev/seed.html`** (sample data for checking the screen; refuses to run anywhere but localhost)

```html
<!doctype html>
<meta charset="utf-8">
<title>Seed sample data</title>
<p id="msg">Seeding…</p>
<script type="module">
  import { logicalDay, addDays, weekday } from '../js/dates.js';
  import { emptyDoc } from '../js/doc.js';

  const msg = document.getElementById('msg');
  const replace = new URLSearchParams(location.search).has('replace');

  if (!['localhost', '127.0.0.1'].includes(location.hostname)) {
    msg.textContent = 'Sample data is only for local testing. Nothing was changed.';
  } else if (localStorage.getItem('dash_data') && !replace) {
    msg.textContent = 'This browser already has data. Open seed.html?replace to overwrite it with sample data.';
  } else {
    const today = logicalDay(new Date());
    const ago = (n) => addDays(today, -n);
    const stamp = new Date().toISOString();
    const doc = emptyDoc();
    let n = 0;
    const rec = (map, fields) => {
      const id = fields.id ?? `seed${++n}`;
      doc[map][id] = { source: 'me', status: 'active', created: ago(20), archivedOn: null, updated: stamp, ...fields, id };
      return doc[map][id];
    };
    const tick = (itemId, day) => rec('logs', { itemId, goalId: null, kind: 'done', day, at: `${day}T10:00:00.000Z`, note: '' });
    const log = (itemId, day, amount, note = '') => rec('logs', { itemId, goalId: null, kind: 'amount', amount, day, at: `${day}T11:00:00.000Z`, note });

    const goal = rec('goals', { title: 'Land an analyst role', targetDate: addDays(today, 60), target: null, unit: 'count', unitLabel: '', order: 1 });
    rec('goals', { title: 'Hold a 10-minute conversation in Hebrew', targetDate: null, target: null, unit: 'count', unitLabel: '', order: 2, status: 'suggested', source: 'gemini' });
    ['Tailor CV for data roles', 'Five applications sent', 'First interview']
      .forEach((title, i) => rec('milestones', { goalId: goal.id, title, done: i === 0, order: i + 1 }));

    const hebrew = rec('items', { type: 'habit', title: 'Hebrew practice', area: 'Hebrew', repeat: { kind: 'daily' }, goalId: null, order: 1 });
    const gym = rec('items', { type: 'habit', title: 'Gym', area: 'Health', repeat: { kind: 'perWeek', n: 3 }, goalId: null, order: 2 });
    const review = rec('items', { type: 'habit', title: 'Weekly review', area: '', repeat: { kind: 'weekly', day: 7 }, goalId: null, order: 3 });
    const jobs = rec('items', { type: 'quota', title: 'Job search', area: 'Job', target: 360, unit: 'minutes', unitLabel: '', goalId: goal.id, order: 4 });
    const apps = rec('items', { type: 'quota', title: 'Applications', area: 'Job', target: 5, unit: 'count', unitLabel: 'applications', goalId: goal.id, order: 5 });
    rec('items', { type: 'task', title: 'Email Sarah about the reference', area: 'Job', date: ago(2), created: ago(2), goalId: null, order: 6 });
    rec('items', { type: 'task', title: 'Book dentist', area: '', date: today, created: today, goalId: null, order: 7 });
    rec('items', { type: 'task', title: 'Finish NatCen supporting statement', area: 'Job', date: today, created: today, goalId: goal.id, source: 'claude', order: 8 });
    rec('items', { type: 'task', title: 'Read one policy brief a day this week', area: '', date: today, created: today, goalId: null, status: 'suggested', source: 'gemini', order: 9 });

    for (let i = 20; i >= 1; i--) if (i % 6 !== 0) tick(hebrew.id, ago(i));
    for (let i = 20; i >= 1; i -= 2) tick(gym.id, ago(i));
    for (let i = 20; i >= 1; i--) if (weekday(ago(i)) === 7) tick(review.id, ago(i));
    for (const i of [1, 2, 3, 5, 8, 9, 12]) log(jobs.id, ago(i), 60, 'Applications');
    log(apps.id, ago(1), 1, 'NatCen');
    log(apps.id, ago(2), 2);
    for (let i = 14; i >= 1; i -= 3) {
      const t = rec('items', { type: 'task', title: `Past task ${i}`, area: '', date: ago(i), created: ago(i), goalId: null, order: 20 + i });
      if (i % 2) tick(t.id, ago(i));
    }

    localStorage.setItem('dash_data', JSON.stringify(doc));
    location.href = '../';
  }
</script>
```

- [ ] **Step 7: Run the unit tests (nothing should have changed)**

Run: `npm test`
Expected: PASS — all suites.

- [ ] **Step 8: Check it in the browser** (controller, or the implementer if it has the Browser tools)

Start the server with `preview_start` using the `dashboard` configuration from
`.claude/launch.json` (or `python -m http.server 8080`). Open
`http://localhost:8080/dev/seed.html?replace`. It redirects to the dashboard. Check:
- Header: long date, "X of Y done", "on this device", ⚙.
- The Gemini suggestion is at the top, dimmed, with ✓ and ✕. ✓ turns it into a normal row, ✕ removes it.
- "Email Sarah…" shows the orange *from <weekday>* marker.
- "Finish NatCen…" shows *added by Claude*. "Hebrew practice" shows a streak. "Gym" shows "n of 3 this week".
- Job search reads like "3 / 6h this week" (the number depends on the weekday). Applications
  reads like "3 / 5 applications this week".
- Ticking a checkbox fades the row, moves it to the bottom, and updates the header count. Unticking reverses it.
- Typing in the add box plus Enter adds a task. "Tomorrow" doesn't show it today.
- No console errors (`read_console_messages` with `onlyErrors`).
- At 375px width (`resize_window` preset `mobile`) the list is usable. Reset to desktop after.

- [ ] **Step 9: Commit**

```bash
git add index.html styles.css js/ui/dom.js js/ui/today.js js/app.js dev/seed.html
git commit -m "Add the page shell, header and today's list"
```

(End the commit message with the co-author line from the Global Constraints.)
