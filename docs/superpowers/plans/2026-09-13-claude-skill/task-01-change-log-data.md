# Task 1: The change log in the document

**Files:**
- Modify: `js/doc.js` (MAPS, emptyDoc)
- Create: `js/changes.js`
- Modify: `js/data.js` (`addMilestone`, `toggleDone`, `logAmount`, `addFlag`, `addPlan` take a source)
- Modify: `sw.js` (CACHE `dash-v5`, SHELL gains `js/changes.js`), `js/flags.js` (`APP_VERSION = 'dash-v5'`)
- Modify: `tests/flags.test.js:17-18`, `tests/helpers.js` (`fixture` accepts `changes`)
- Test: `tests/changes.test.js`

**Interfaces:**
- Consumes: `MAPS`, `stableStringify` from `js/doc.js`; the store from `js/data.js`.
- Produces: `MAPS` with `'changes'`; `js/changes.js` exports `CHANGE_KEEP_DAYS, diffDocs, fieldChanges,
  recordTitle, editLines, changeList, changeCountLine, canUndo, undoLine` (shapes in the plan's Shared
  interfaces); store methods with their new `source` options.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b claude-skill
```

- [ ] **Step 2: Write the failing tests** — create `tests/changes.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, emptyDoc, isDoc } from '../js/doc.js';
import { mergeDocs } from '../js/merge.js';
import {
  CHANGE_KEEP_DAYS, diffDocs, fieldChanges, recordTitle, editLines, changeList, changeCountLine, canUndo, undoLine,
} from '../js/changes.js';
import { makeStore, fixture } from './helpers.js';

test('the change log is a synced map like the others', () => {
  assert.ok(MAPS.includes('changes'));
  assert.deepEqual(emptyDoc().changes, {});
  assert.equal(isDoc({ schema: 1, items: {} }), true);
  assert.equal(isDoc({ schema: 1, items: {}, changes: [] }), false);
  const rec = { id: 'c1', updated: '2026-09-13T10:00:00.000Z', created: '2026-09-13', summary: 'x' };
  assert.equal(mergeDocs({ schema: 1, items: {} }, { schema: 1, items: {}, changes: { c1: rec } }).changes.c1.summary, 'x');
  assert.equal(CHANGE_KEEP_DAYS, 30);
});

test('diffDocs lists every record that changed, as copies, and leaves the change log out', () => {
  const store = makeStore();
  const a = store.addItem({ type: 'task', title: 'A' });
  const before = structuredClone(store.doc());
  const b = store.addItem({ type: 'task', title: 'B' });
  store.updateItem(a.id, { title: 'A2' });
  store.doc().changes.x = { id: 'x' };
  const edits = diffDocs(before, store.doc());
  assert.deepEqual(edits.map((e) => [e.map, e.id, e.before?.title ?? null, e.after.title]),
    [['items', a.id, 'A', 'A2'], ['items', b.id, null, 'B']]);
  edits[0].after.title = 'changed by the caller';
  assert.equal(store.doc().items[a.id].title, 'A2');
  assert.deepEqual(diffDocs(store.doc(), store.doc()), []);
});

test('fieldChanges ignores updated; editLines says what happened in words', () => {
  const before = { id: 'i', type: 'task', title: 'A', date: '2026-09-13', updated: '1' };
  const after = { ...before, title: 'B', updated: '2' };
  assert.deepEqual(fieldChanges(before, after), [{ field: 'title', from: 'A', to: 'B' }]);
  assert.deepEqual(editLines({ map: 'items', id: 'i', before, after }), ['task "A": title "A" → "B"']);
  assert.deepEqual(editLines({ map: 'items', id: 'i', before: null, after }), ['New task "B"']);
  assert.deepEqual(editLines({ map: 'goals', id: 'g', before: null, after: { title: 'G' } }), ['New goal "G"']);
  assert.deepEqual(editLines({ map: 'logs', id: 'l', before: null, after: { kind: 'amount', day: '2026-09-13' } }),
    ['New logged amount "on 2026-09-13"']);
  assert.deepEqual(editLines({ map: 'items', id: 'i', before: null, after: null }), []);
  assert.equal(recordTitle({ text: 'a flag' }), 'a flag');
});

test('changeList is newest first and only active; changeCountLine counts the last seven days', () => {
  const doc = fixture({
    changes: [
      { id: 'c1', at: '2026-09-01T10:00:00.000Z', summary: 'old' },
      { id: 'c2', at: '2026-09-12T10:00:00.000Z', summary: 'new' },
      { id: 'c3', at: '2026-09-12T11:00:00.000Z', summary: 'newest' },
      { id: 'c4', at: '2026-09-12T12:00:00.000Z', summary: 'gone', status: 'archived' },
    ],
  });
  assert.deepEqual(changeList(doc).map((c) => c.id), ['c3', 'c2', 'c1']);
  assert.equal(changeCountLine(doc, new Date('2026-09-13T12:00:00Z')), '2 in the last week');
  assert.equal(changeCountLine(doc, new Date('2026-09-18T12:00:00Z')), '2 in the last week');
  assert.equal(changeCountLine(doc, new Date('2026-09-19T12:00:00Z')), '0 in the last week');
  assert.equal(changeCountLine(fixture(), new Date()), 'none yet');
  const one = fixture({ changes: [{ id: 'c1', at: '2026-09-12T10:00:00.000Z', summary: 'x' }] });
  assert.equal(changeCountLine(one, new Date('2026-09-13T12:00:00Z')), '1 in the last week');
});

test('canUndo and undoLine', () => {
  assert.equal(canUndo({ undoneAt: null, pruned: false }), true);
  assert.equal(canUndo({ undoneAt: '2026-09-13T10:00:00.000Z', pruned: false }), false);
  assert.equal(canUndo({ undoneAt: null, pruned: true }), false);
  const a = { map: 'items', id: 'a', before: null, after: { title: 'A' } };
  const b = { map: 'items', id: 'b', before: null, after: { title: 'B' } };
  assert.equal(undoLine({ undone: [], skipped: [], already: true }), 'Already undone, or too old to undo.');
  assert.equal(undoLine({ undone: [], skipped: [a], already: false }), 'Changed since — not undone.');
  assert.equal(undoLine({ undone: [a], skipped: [], already: false }), 'Undone.');
  assert.equal(undoLine({ undone: [a], skipped: [b], already: false }), 'Undone, except "B" — changed since, not undone.');
});

test('the store takes a source for plans, milestones, ticks, amounts and flags', () => {
  const store = makeStore();
  const plan = store.addPlan({ goal: { title: 'G' }, milestones: ['m'], tasks: [{ title: 't' }], source: 'claude' });
  assert.equal(plan.goal.source, 'claude');
  assert.equal(plan.milestones[0].source, 'claude');
  assert.equal(plan.items[0].source, 'claude');
  assert.equal(store.addPlan({ tasks: [{ title: 'u' }] }).items[0].source, 'gemini');
  const goal = store.addGoal({ title: 'G2' });
  const m = store.addMilestone(goal.id, 'm2', { source: 'claude', status: 'suggested' });
  assert.equal(m.source, 'claude');
  assert.equal(m.status, 'suggested');
  assert.equal(store.addMilestone(goal.id, 'm3').source, 'me');
  const task = store.addItem({ type: 'task', title: 'x' });
  assert.equal(store.toggleDone(task.id, undefined, 'claude').source, 'claude');
  assert.equal(store.toggleDone(task.id), undefined); // unticks
  assert.equal(store.toggleDone(task.id).source, 'me');
  const quota = store.addItem({ type: 'quota', title: 'q', target: 3 });
  assert.equal(store.logAmount({ itemId: quota.id, amount: 1, source: 'claude' }).source, 'claude');
  assert.equal(store.logAmount({ itemId: quota.id, amount: 1 }).source, 'me');
  assert.equal(store.addFlag('f', null, 'claude').source, 'claude');
  assert.equal(store.addFlag('g').source, 'me');
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `node --test tests/changes.test.js`
Expected: FAIL — `Cannot find module '.../js/changes.js'`.

- [ ] **Step 4: Add `changes` to the document** — in `js/doc.js`, replace lines 3–7 with:

```js
export const MAPS = ['items', 'goals', 'milestones', 'logs', 'journal', 'flags', 'changes'];

export function emptyDoc() {
  return { schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {}, flags: {}, changes: {} };
}
```

And in the comment above `isDoc` (line 18–20), change "A document saved before the journal or the
flags existed has neither" to "A document saved before the journal, the flags or the change log
existed has none of them".

- [ ] **Step 5: Create `js/changes.js`**

```js
// Claude's change log: what one of Claude's commands changed, as plain data, and the readers ⚙ and
// the tool use. Pure. The store writes and undoes changes (js/data.js); this only describes them.

import { MAPS, stableStringify } from './doc.js';

export const CHANGE_KEEP_DAYS = 30; // days a change keeps its before/after snapshots

const LOGGED = MAPS.filter((m) => m !== 'changes');
const DAY_MS = 86400000;

// Every record whose serialised form differs between two documents, as { map, id, before, after }
// (before is null for a new record). Copies, never the documents' own objects, in MAPS order then
// id order. The change log itself is left out.
export function diffDocs(before, after) {
  const edits = [];
  for (const map of LOGGED) {
    const a = before?.[map] ?? {};
    const b = after?.[map] ?? {};
    for (const id of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (stableStringify(a[id] ?? null) === stableStringify(b[id] ?? null)) continue;
      edits.push({
        map, id,
        before: a[id] ? structuredClone(a[id]) : null,
        after: b[id] ? structuredClone(b[id]) : null,
      });
    }
  }
  return edits;
}

// The fields that differ between two versions of a record, `updated` aside.
export function fieldChanges(before, after) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
    .filter((k) => k !== 'updated').sort();
  return keys
    .filter((k) => stableStringify(before?.[k] ?? null) !== stableStringify(after?.[k] ?? null))
    .map((k) => ({ field: k, from: before?.[k] ?? null, to: after?.[k] ?? null }));
}

export function recordTitle(rec) {
  return String(rec?.title ?? rec?.text ?? rec?.summary ?? (rec?.day ? `on ${rec.day}` : ''));
}

const ITEM_NOUNS = { task: 'task', habit: 'habit', quota: 'weekly target' };
const NOUNS = { goals: 'goal', milestones: 'milestone', journal: 'journal entry', flags: 'flag' };

function noun(map, rec) {
  if (map === 'items') return ITEM_NOUNS[rec?.type] ?? 'item';
  if (map === 'logs') return rec?.kind === 'done' ? 'tick' : 'logged amount';
  return NOUNS[map] ?? map;
}

const show = (value) => {
  const s = JSON.stringify(value) ?? 'null';
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
};

// What one edit did, for ⚙'s Details: a new record in one line, a changed one field by field,
// named as Claude found it (so a rename reads 'task "A": title "A" → "B"'). A pruned edit (no
// snapshots) has nothing to show.
export function editLines(edit) {
  if (!edit.before && !edit.after) return [];
  const rec = edit.before ?? edit.after;
  const name = `${noun(edit.map, rec)} "${recordTitle(rec)}"`;
  if (!edit.before) return [`New ${name}`];
  if (!edit.after) return [`Removed ${name}`];
  const fields = fieldChanges(edit.before, edit.after);
  return fields.length
    ? fields.map((f) => `${name}: ${f.field} ${show(f.from)} → ${show(f.to)}`)
    : [`${name}: no visible change`];
}

// Claude's changes, newest first.
export function changeList(doc) {
  return Object.values(doc?.changes ?? {})
    .filter((c) => c.status === 'active')
    .sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
}

// ⚙'s summary line for the group: how many changes in the seven days up to `now`.
export function changeCountLine(doc, now) {
  const list = changeList(doc);
  if (!list.length) return 'none yet';
  const since = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const n = list.filter((c) => c.at >= since).length;
  return `${n} in the last week`;
}

export const canUndo = (change) => !change.undoneAt && !change.pruned;

// One line saying what an undo did (the result of store.undoChange).
export function undoLine({ undone = [], skipped = [], already = false } = {}) {
  if (already) return 'Already undone, or too old to undo.';
  if (!undone.length) return 'Changed since — not undone.';
  if (!skipped.length) return 'Undone.';
  const names = skipped.map((e) => `"${recordTitle(e.after ?? e.before)}"`).join(', ');
  return `Undone, except ${names} — changed since, not undone.`;
}
```

Note the test expects `'1 in the last week'` from the same template (`${n} in the last week` gives
`1 in the last week`), so no special case is needed.

- [ ] **Step 6: Give the store's writers a source** — in `js/data.js`:

Replace `toggleDone` (lines 136–146) with:

```js
  function toggleDone(itemId, day = today(), source = 'me') {
    const existing = Object.values(doc.logs).filter((l) =>
      l.itemId === itemId && l.kind === 'done' && l.day === day && l.status === 'active');
    if (existing.length) {
      const t = stamp();
      for (const rec of existing) doc.logs[rec.id] = { ...rec, status: 'archived', updated: t };
      commit('local');
      return;
    }
    return create('logs', { itemId, goalId: null, kind: 'done', day, at: stamp(), note: '', source });
  }
```

Replace `logAmount` (lines 148–152) with:

```js
  function logAmount({ itemId = null, goalId = null, amount, day = today(), note = '', source = 'me' }) {
    if (!(amount > 0)) throw new Error('An amount must be above 0');
    if (!itemId && !goalId) throw new Error('logAmount needs an itemId or a goalId');
    return create('logs', { itemId, goalId, kind: 'amount', amount, day, at: stamp(), note, source });
  }
```

Replace `addMilestone` (lines 165–169) with:

```js
  function addMilestone(goalId, title, { source = 'me', status = 'active' } = {}) {
    return create('milestones', {
      goalId, title: requireTitle(title, 'A milestone'), done: false, order: nextOrder('milestones'), source, status,
    });
  }
```

In `addPlan`, change the signature line and the `suggested` line to:

```js
  function addPlan({ goal = null, milestones = [], habits = [], targets = [], tasks = [], source = 'gemini' } = {}) {
    if (milestones.length && !goal) throw new Error('Milestones need a goal');
    const suggested = { status: 'suggested', source };
```

and update its comment's first line to "Everything one Gemini reply (or a plan from Claude) proposes,
written as suggestions in one commit:".

Replace `addFlag`'s signature and `return` (lines 263–267) with:

```js
  function addFlag(text, ctx = null, source = 'me') {
    const clean = Array.from(String(text ?? '').trim()).slice(0, FLAG_TEXT_MAX).join('').trim();
    if (!clean) throw new Error('A flag needs some text');
    return create('flags', { text: clean, ctx: capContext(ctx), source });
  }
```

- [ ] **Step 7: Update the tests that pin the map list** — in `tests/flags.test.js`, lines 17–18 become:

```js
  assert.deepEqual(MAPS, ['items', 'goals', 'milestones', 'logs', 'journal', 'flags', 'changes']);
  assert.deepEqual(emptyDoc(), { schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {}, flags: {}, changes: {} });
```

In `tests/data.test.js` line 9 ("a new store is empty"), the sorted key list gains `'changes'` first:
`['changes', 'flags', 'goals', 'items', 'journal', 'logs', 'milestones', 'schema']`.

In `tests/helpers.js`, `fixture` gains `changes`:

```js
export function fixture({ items = [], logs = [], goals = [], milestones = [], journal = [], flags = [], changes = [] } = {}) {
  const doc = emptyDoc();
  const base = {
    source: 'me', status: 'active', created: '2026-09-01', archivedOn: null,
    updated: '2026-09-01T09:00:00.000Z',
  };
  for (const [map, list] of Object.entries({ items, logs, goals, milestones, journal, flags, changes })) {
    for (const r of list) doc[map][r.id] = { ...base, ...r };
  }
  return doc;
}
```

- [ ] **Step 8: Put `js/changes.js` in the offline shell** — in `sw.js`, `CACHE` becomes `'dash-v5'`
and SHELL's js line gains `'js/changes.js'` after `'js/flags.js'`:

```js
const CACHE = 'dash-v5';
```
```js
  'js/merge.js', 'js/sync.js', 'js/gemini.js', 'js/coach.js', 'js/look.js', 'js/layout.js', 'js/flags.js', 'js/changes.js',
```

In `js/flags.js` line 11: `export const APP_VERSION = 'dash-v5';`. Then search the tests for any
other literal `dash-v4` (`grep -rn "dash-v4" tests`) and change it to `dash-v5`.

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: PASS, 286 tests (280 + 6).

- [ ] **Step 10: Commit**

```bash
git add js/doc.js js/changes.js js/data.js js/flags.js sw.js tests/changes.test.js tests/flags.test.js tests/helpers.js
git commit -m "Add the change log map and give the store's writers a source

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
