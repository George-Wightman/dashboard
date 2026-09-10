# Task 10: Quota quick-add and drag reorder

Part of [the core hub plan](../2026-09-10-core-hub.md) — read its Global Constraints first.

**Files:**
- Modify: `js/ui/today.js`

**Interfaces:**
- Consumes: `store.logAmount`, `store.removeLog`, `store.reorder` (`js/data.js`); `parseAmount`,
  `formatAmount`, `formatProgress` (`js/parse.js`); `shortWeekday`, `weekStart`, `addDays`
  (`js/dates.js`); `ctx.ui.amountFor`, `ctx.ui.entriesFor`, `ctx.render()` (Task 9).
- Produces the behaviour from the spec's *Quick-add on quotas*:
  - **Count quota:** click **+** logs +1. Shift-click, or a long press on touch, opens the amount
    input.
  - **Minutes quota:** **+** always opens the amount input, which takes `45m`, `1.5h`, `1h30`, or
    a bare number of minutes.
  - Amount input: Enter logs it. Bad input turns the border red with a hint in `title` and keeps
    the input open. Escape or clicking away closes it.
  - **Click the count** to toggle this week's entries under the row. Each entry has *remove*
    (which tombstones the log).
  - **Drag a row** onto another to put it before that row. Suggestions aren't draggable.
- `ui.amountFor` is the id of the quota whose input is open (or `null`). `ui.entriesFor` is the
  id whose entries are shown. Task 13 pauses sync while `ui.amountFor` is set, so a sync landing
  never wipes a half-typed amount.

- [ ] **Step 1: Extend the imports in `js/ui/today.js`**

Replace the import block at the top with:

```js
import { h } from './dom.js';
import { todayRows, streak, doneBetween } from '../schedule.js';
import { carryLabel, addDays, weekStart, shortWeekday } from '../dates.js';
import { formatProgress, formatAmount, parseAmount } from '../parse.js';
```

- [ ] **Step 2: Replace `quotaControls` with the full version, plus the amount input**

Replace the whole `quotaControls` function (including its "Replaced in Task 10" comment) with:

```js
function amountInput(item, ctx) {
  const { store, ui } = ctx;
  const minutes = item.unit === 'minutes';
  const input = h('input', {
    class: 'amount-input', type: 'text', inputmode: minutes ? 'text' : 'decimal',
    placeholder: minutes ? '45m · 1.5h' : 'amount', 'aria-label': `Amount for ${item.title}`,
  });
  const close = () => { ui.amountFor = null; ctx.render(); };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const value = parseAmount(input.value, item.unit);
    if (value == null) {
      input.classList.add('invalid');
      input.title = minutes ? 'Try 45m, 1.5h or 1h30' : 'Type a number above 0';
      return;
    }
    ui.amountFor = null;
    store.logAmount({ itemId: item.id, amount: value });
  });
  input.addEventListener('blur', () => { if (ui.amountFor === item.id) close(); });
  queueMicrotask(() => input.focus());
  return input;
}

function quotaControls(row, ctx) {
  const { store, ui } = ctx;
  const { item } = row;
  const count = h('span', {
    class: 'count', title: "Show this week's entries",
    onclick: () => { ui.entriesFor = ui.entriesFor === item.id ? null : item.id; ctx.render(); },
  }, quotaLabel(row));
  if (ui.amountFor === item.id) return [count, amountInput(item, ctx)];

  const openInput = () => { ui.amountFor = item.id; ctx.render(); };
  const plus = h('button', {
    class: 'plus', type: 'button', 'aria-label': `Add to ${item.title}`,
    title: item.unit === 'minutes' ? 'Log time' : 'Click for +1 · Shift-click to type an amount',
  }, '+');
  plus.addEventListener('click', (e) => {
    if (item.unit === 'minutes' || e.shiftKey) openInput();
    else store.logAmount({ itemId: item.id, amount: 1 });
  });
  let pressTimer = null;
  plus.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && item.unit === 'count') pressTimer = setTimeout(openInput, 500);
  });
  const cancelPress = () => clearTimeout(pressTimer);
  plus.addEventListener('pointerup', cancelPress);
  plus.addEventListener('pointerleave', cancelPress);
  return [count, plus];
}

function entriesList(row, ctx) {
  const { store } = ctx;
  const doc = store.doc();
  const start = weekStart(store.today());
  const end = addDays(start, 6);
  const logs = Object.values(doc.logs)
    .filter((l) => l.status === 'active' && l.kind === 'amount' && l.itemId === row.item.id && l.day >= start && l.day <= end)
    .sort((a, b) => ((a.at ?? '') < (b.at ?? '') ? -1 : 1));
  const items = logs.length
    ? logs.map((l) => h('li', {},
      h('span', {}, [
        `${shortWeekday(l.day)} · ${formatAmount(l.amount, row.item.unit)}`,
        l.note ? ` · ${l.note}` : '',
        SOURCE_NAMES[l.source] ? ` · ${SOURCE_NAMES[l.source]}` : '',
      ].join('')),
      h('button', { class: 'link', type: 'button', 'aria-label': 'Remove this entry', onclick: () => store.removeLog(l.id) }, 'remove')))
    : [h('li', {}, 'Nothing logged this week yet.')];
  return h('li', { class: 'entries-row' }, h('ul', { class: 'entries' }, items));
}
```

- [ ] **Step 3: Add drag reorder**

Add this function above `renderToday`:

```js
function enableDrag(li, row, ctx) {
  li.draggable = true;
  li.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', row.item.id);
    e.dataTransfer.effectAllowed = 'move';
    li.classList.add('dragging');
  });
  li.addEventListener('dragend', () => li.classList.remove('dragging'));
  li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('drop-before'); });
  li.addEventListener('dragleave', () => li.classList.remove('drop-before'));
  li.addEventListener('drop', (e) => {
    e.preventDefault();
    li.classList.remove('drop-before');
    const dragged = e.dataTransfer.getData('text/plain');
    if (!dragged || dragged === row.item.id) return;
    const ids = [...document.querySelectorAll('#list li.row[draggable="true"]')]
      .map((el) => el.dataset.id)
      .filter((id) => id !== dragged);
    ids.splice(ids.indexOf(row.item.id), 0, dragged);
    ctx.store.reorder(ids);
  });
}
```

- [ ] **Step 4: Replace `renderToday`**

```js
export function renderToday(ctx) {
  const list = document.getElementById('list');
  const rows = todayRows(ctx.store.doc(), ctx.store.today());
  if (!rows.length) {
    list.replaceChildren(h('li', { class: 'empty' }, 'Nothing on today. Add a task below, or set up a habit.'));
    return;
  }
  const els = [];
  for (const row of rows) {
    const li = renderRow(row, ctx);
    if (!row.suggested) enableDrag(li, row, ctx);
    els.push(li);
    if (row.kind === 'quota' && ctx.ui.entriesFor === row.item.id) els.push(entriesList(row, ctx));
  }
  list.replaceChildren(...els);
}
```

- [ ] **Step 5: Run the unit tests**

Run: `npm test`
Expected: PASS — all suites (nothing pure changed).

- [ ] **Step 6: Check it in the browser**

With the seeded data (`http://localhost:8080/dev/seed.html?replace`):
- Applications **+** → the count goes up by 1. Shift-click **+** → the input opens. `2` then Enter →
  up by 2. `abc` then Enter → red border, still open. Escape → closes.
- Job search **+** → the input opens. `45m` then Enter → the hours rise by 0.8. `1h30` works too.
- Click Job search's count → this week's entries appear under it. *remove* on one → the total drops.
- Drag "Book dentist" above "Hebrew practice" → the order changes and survives a reload.
- No console errors.

- [ ] **Step 7: Commit**

```bash
git add js/ui/today.js
git commit -m "Add quota quick-add, weekly entries and drag reorder"
```

(End the commit message with the co-author line from the Global Constraints.)
