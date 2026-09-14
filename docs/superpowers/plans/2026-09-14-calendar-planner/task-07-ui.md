# Task 7: The dashboard shows the plan

**Files:**
- Modify: `index.html`, `js/app.js`, `js/ui/today.js`, `js/ui/edit.js`, `js/ui/settings.js`, `styles.css`,
  `dev/seed.html`
- Test: `tests/today-list.test.js` (append)

**Interfaces:**
- Consumes: `todaySlots`, `timedOrder`, `clockLabel`, `plannerNotes`, `visibleNotes`, `staleSince`,
  `plannerSummary`, `dayRecordId` (Task 1); `splitTaskInput`, `parseLength`, `formatAmount` (Task 1 /
  `js/parse.js`); `h` (`js/ui/dom.js`).
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing test** — append to `tests/today-list.test.js`:

```js
test("the list shows today's times in the day's order; lengths and times in the add box and the edit panel", () => {
  const today = read('js/ui/today.js');
  assert.match(today, /timedOrder\(main, slots\)/);
  assert.match(today, /splitTaskInput\(/);
  assert.match(today, /if \(!row\.suggested && !slot\) enableDrag/);
  assert.match(read('styles.css'), /\.row \.time \{[^}]*font-variant-numeric: tabular-nums;/);
  const edit = read('js/ui/edit.js');
  assert.ok(edit.includes("field('Length (optional)'"), 'Length field');
  assert.ok(edit.includes("field('Time (optional)'"), 'Time field');
  const html = read('index.html');
  assert.match(html, /<span id="planner-warning" class="warning" hidden><\/span>/);
  assert.match(html, /<div id="planner-notes" class="planner-notes" hidden><\/div>/);
  assert.match(read('js/ui/settings.js'), /group\('Calendar planner', planner\.summary/);
  assert.match(read('js/app.js'), /visibleNotes\(plannerNotes\(store\.doc\(\), today\), hiddenNotes\(\), today\)/);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/today-list.test.js`
Expected: FAIL on the new test.

- [ ] **Step 3: `index.html`** — in `.top-actions`, right after the `save-warning` span:

```html
      <span id="planner-warning" class="warning" hidden></span>
```

and right after `</header>`:

```html
  <div id="planner-notes" class="planner-notes" hidden></div>
```

Change the add box's placeholder to `placeholder="Add a task… (end with 2h or 14:00 to book time)"`.

- [ ] **Step 4: `js/ui/today.js`**

Imports — add `splitTaskInput` to the `../parse.js` import, and a new line:

```js
import { todaySlots, timedOrder, clockLabel } from '../calendar.js';
```

`renderRow(row, ctx)` becomes `renderRow(row, ctx, slot = null)`, and its title cell becomes:

```js
    h('span', { class: 'title-cell' },
      slot ? h('span', { class: 'time', title: `${clockLabel(slot.start)}–${clockLabel(slot.end)} in your calendar` }, clockLabel(slot.start)) : null,
      titleEl(item, () => ctx.openEditor({ map: 'items', id: item.id })),
      row.carriedFrom ? h('span', { class: 'carry' }, carryLabel(row.carriedFrom, store.today())) : null),
```

In `renderToday`, after `const { main, week } = splitRows(rows);`:

```js
  const slots = todaySlots(ctx.store.doc(), ctx.store.today());
```

and the `add` helper and the main loop become:

```js
  const add = (row) => {
    const slot = row.suggested ? null : slots.get(row.item.id) ?? null;
    const li = renderRow(row, ctx, slot);
    // A row with a time follows the day's order, so only the others can be dragged.
    if (!row.suggested && !slot) enableDrag(li, row, ctx);
    els.push(li);
    if (row.kind === 'quota' && ctx.ui.entriesFor === row.item.id) els.push(entriesList(row, ctx));
  };
  timedOrder(main, slots).forEach(add);
```

In `initAddBox`'s `add()`, replace the `addItem` line with:

```js
    const { title: name, minutes, time } = splitTaskInput(text);
    ctx.store.addItem({ type: 'task', title: name, date: day, ...(minutes ? { minutes } : {}), ...(time ? { time } : {}) });
```

- [ ] **Step 5: `js/ui/edit.js`**

Add the import:

```js
import { parseLength, formatAmount } from '../parse.js';
```

In `defaultDraft`, the item draft gains `minutesText: '', time: ''`. After `draft.repeat ??= { kind: 'daily' };` add:

```js
  draft.minutesText ??= draft.minutes ? formatAmount(draft.minutes, 'minutes') : '';
  draft.time ??= '';
```

Above `typeFields`, add:

```js
  const lengthField = () => field('Length (optional)', input('minutesText', draft.minutesText, { placeholder: '45m, 2h, 1h30' }));
```

In `typeFields`, the task line becomes:

```js
    if (draft.type === 'task') {
      return [
        field('Date', input('date', draft.date, { type: 'date' })),
        field('Time (optional)', input('time', draft.time, { type: 'time' })),
        lengthField(),
      ];
    }
```

and in the habit branch, `rows.push(lengthField());` goes just before `return rows;`.

In `itemFields(title)`, before `return fields;`:

```js
    if (draft.type === 'task' || draft.type === 'habit') {
      const text = String(draft.minutesText ?? '').trim();
      const minutes = text ? parseLength(text) : null;
      if (text && minutes == null) throw new Error('Length: try 45m, 2h or 1h30 (5 minutes to 12 hours).');
      fields.minutes = minutes;
    }
    if (draft.type === 'task') fields.time = draft.time || null;
```

- [ ] **Step 6: `js/ui/settings.js`**

Add the import:

```js
import { plannerSummary } from '../calendar.js';
```

In `openSettings`, before `dialog.replaceChildren(`:

```js
  const planner = plannerSummary(store.doc(), new Date());
```

and after the `Claude's changes` group:

```js
    group('Calendar planner', planner.summary, false,
      ...planner.lines.map((line) => h('p', { class: 'note' }, line))),
```

Update the file's first comment to list "the calendar planner" among the groups.

- [ ] **Step 7: `js/app.js`** — the planner's notes and its health in the header.

Imports:

```js
import { h } from './ui/dom.js';
import { plannerNotes, staleSince, visibleNotes } from './calendar.js';
```

Above `function renderHeader()`:

```js
// The planner's notes under the date (js/calendar.js), each hidden with × on this device until the
// next day. Kept as "<day>|<note>"; only today's are kept.
const NOTES_HIDDEN_KEY = 'dash_notes_hidden';

function hiddenNotes() {
  try { return JSON.parse(localStorage.getItem(NOTES_HIDDEN_KEY)) ?? []; } catch { return []; }
}

function hideNote(day, text) {
  const keep = hiddenNotes().filter((k) => k.startsWith(`${day}|`));
  try { localStorage.setItem(NOTES_HIDDEN_KEY, JSON.stringify([...keep, `${day}|${text}`])); } catch { /* best effort */ }
  renderHeader();
}
```

In `renderHeader`, after the `update-ready` line:

```js
  const notes = visibleNotes(plannerNotes(store.doc(), today), hiddenNotes(), today);
  const notesEl = document.getElementById('planner-notes');
  notesEl.hidden = !notes.length;
  notesEl.replaceChildren(...notes.map((text) => h('p', {},
    h('span', {}, text),
    h('button', { class: 'link', type: 'button', title: 'Hide this note', 'aria-label': `Hide: ${text}`, onclick: () => hideNote(today, text) }, '×'))));
  const stale = staleSince(store.doc(), new Date());
  const plannerWarning = document.getElementById('planner-warning');
  plannerWarning.hidden = !stale;
  plannerWarning.textContent = stale ? `calendar planner hasn't run since ${stale}` : '';
```

- [ ] **Step 8: `styles.css`** — after the `.row .carry, .row .for` rule (line ~107):

```css
.row .time { flex: none; margin-right: .5rem; font-size: .8rem; color: var(--muted); font-variant-numeric: tabular-nums; }
```

and after `.warning`:

```css
.planner-notes { margin: -.35rem 0 .6rem; font-size: .85rem; color: var(--muted); }
.planner-notes p { margin: .1rem 0; display: flex; gap: .5rem; align-items: baseline; }
.planner-notes .link { font-size: 1rem; line-height: 1; padding: 0 .2rem; }
```

Match `.planner-notes`'s side padding to the header's: read `.top`'s padding (styles.css line ~62) and
give `.planner-notes` the same left and right padding and max width, so the notes line up under the date.

- [ ] **Step 9: `dev/seed.html`** — so the browser check shows times and a note.

Import `dayRecordId` next to the other imports:

```js
  import { dayRecordId } from '../js/calendar.js';
```

Capture two of today's tasks: `const dentist = rec('items', { … 'Book dentist' … });` and
`const natcen = rec('items', { … 'Finish NatCen supporting statement' … });` (the same fields as now).
Before `localStorage.setItem('dash_data', …)`:

```js
    // The calendar planner's record for today, so the list shows times and a note.
    const hm = (hh, mm) => new Date(`${today}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).toISOString();
    rec('calendar', { id: dayRecordId(today), source: 'planner', day: today, skipped: [], missed: [],
      notes: ['Moved Job search to 15:30 (Signify)'],
      blocks: [
        { key: `${today}||0`, eventId: 'seed-1', calendarId: 'seed', calendar: 'Tasks', title: 'Book dentist', start: hm(10, 30), end: hm(11, 0), state: 'exact', items: [dentist.id] },
        { key: `${today}|job|0`, eventId: 'seed-2', calendarId: 'seed', calendar: 'Application', title: 'Finish NatCen supporting statement', start: hm(15, 30), end: hm(17, 0), state: 'exact', items: [natcen.id] },
      ] });
    rec('calendar', { id: 'status', source: 'planner', lastRun: stamp, lastError: null, version: 'seed', paused: false });
```

- [ ] **Step 10: Run the tests** — `node --test tests/today-list.test.js` → PASS; `npm test` → PASS.

- [ ] **Step 11: Check it in the browser**

`preview_start` `dashboard`; open `http://localhost:8080/dev/seed.html?replace`, then
`http://localhost:8080/`, reload twice (the offline cache). Check, with `read_page` and a screenshot:

- *Book dentist* shows `10:30`, *Finish NatCen…* shows `15:30`, and those two sit first among the
  undone rows, earliest first; other rows keep their order; a timed row can't be dragged.
- The note *Moved Job search to 15:30 (Signify)* sits under the date; × hides it, and it stays hidden
  after a reload.
- ⚙ → *Calendar planner · last ran HH:MM* with its lines.
- Add *Draft cover letter 2h* and *Call NatCen 14:00*: the edit panel shows Length `2h` and Time `14:00`;
  saving `45m` in Length keeps it; `ages` is refused with the Length message.
- Set `status.lastRun` two hours back (javascript_tool on `localStorage`, then reload): the header warns
  *calendar planner hasn't run since …*.
- Phone width (`resize_window` mobile): the time sits before the title; nothing overflows. Then
  `preset: 'desktop'`.

- [ ] **Step 12: Commit**

```bash
git add index.html js/app.js js/ui/today.js js/ui/edit.js js/ui/settings.js styles.css dev/seed.html tests/today-list.test.js
git commit -m "Show today's times in the day's order, the planner's notes and health; lengths and times in the add box and edit panel

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
