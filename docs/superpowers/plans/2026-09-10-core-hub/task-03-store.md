# Task 3: The store

Part of [the core hub plan](../2026-09-10-core-hub.md) — read its Global Constraints first.

**Files:**
- Create: `js/doc.js`, `js/data.js`, `tests/helpers.js`
- Test: `tests/data.test.js`

**Interfaces:**
- Consumes: `logicalDay` from `js/dates.js` (Task 1).
- Produces:
  - `js/doc.js`: `MAPS`, `emptyDoc()`, `stableStringify(value)`.
  - `js/data.js`: `DATA_KEY`, `SETTINGS_KEY`, `DEFAULT_SETTINGS`, `createStore({ storage, now?, newId? })`
    with the Store API listed in the plan's shared interfaces. `importJson` is **not** part of
    this task — Task 7 adds it once `mergeDocs` exists.
  - `tests/helpers.js`: `MemoryStorage`, `FullStorage`, `clock()`, `ids()`, `makeStore()`,
    `fixture()`, `done()`, `amount()` — reused by every later test file.
- `doc()` returns the live document. Callers must treat it as read-only and change it only
  through Store methods.
- Listeners receive a reason: `'local'` (a user edit — triggers sync later), `'sync'`
  (`replaceDoc`), `'settings'`.

- [ ] **Step 1: Write the shared test helpers**

`tests/helpers.js` (not a test file — `npm test` only runs `*.test.js`):

```js
import { createStore } from '../js/data.js';
import { emptyDoc } from '../js/doc.js';

export class MemoryStorage {
  constructor(initial = {}) { this.map = new Map(Object.entries(initial)); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

export class FullStorage extends MemoryStorage {
  setItem() { throw new Error('QuotaExceededError'); }
}

// A controllable clock. Starts Thursday 10 Sep 2026, 09:00 local.
export function clock(start = new Date(2026, 8, 10, 9, 0)) {
  let t = start.getTime();
  const now = () => new Date(t);
  now.advance = (ms) => { t += ms; };
  now.set = (date) => { t = date.getTime(); };
  return now;
}

export function ids(prefix = 'id') {
  let n = 0;
  return () => `${prefix}${++n}`;
}

export function makeStore({ storage = new MemoryStorage(), now = clock(), prefix = 'id' } = {}) {
  return createStore({ storage, now, newId: ids(prefix) });
}

// Build a document by hand for the pure schedule tests.
export function fixture({ items = [], logs = [], goals = [], milestones = [] } = {}) {
  const doc = emptyDoc();
  const base = {
    source: 'me', status: 'active', created: '2026-09-01', archivedOn: null,
    updated: '2026-09-01T09:00:00.000Z',
  };
  for (const [map, list] of Object.entries({ items, logs, goals, milestones })) {
    for (const r of list) doc[map][r.id] = { ...base, ...r };
  }
  return doc;
}

export const done = (itemId, day, extra = {}) => ({
  id: `done-${itemId}-${day}`, itemId, goalId: null, kind: 'done', day, ...extra,
});

export const amount = (id, itemId, day, value, extra = {}) => ({
  id, itemId, goalId: null, kind: 'amount', amount: value, day, ...extra,
});
```

- [ ] **Step 2: Write the failing test**

`tests/data.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, DATA_KEY, SETTINGS_KEY } from '../js/data.js';
import { stableStringify } from '../js/doc.js';
import { MemoryStorage, FullStorage, clock, ids, makeStore } from './helpers.js';

test('a new store is empty, with default settings', () => {
  const store = makeStore();
  assert.deepEqual(Object.keys(store.doc()).sort(), ['goals', 'items', 'logs', 'milestones', 'schema']);
  assert.equal(store.settings().dayStartHour, 4);
  assert.equal(store.today(), '2026-09-10');
});

test('addItem fills defaults and persists', () => {
  const storage = new MemoryStorage();
  const store = makeStore({ storage });
  const a = store.addItem({ type: 'task', title: '  Email Sarah ' });
  const b = store.addItem({ type: 'habit', title: 'Hebrew' });
  assert.equal(a.title, 'Email Sarah');
  assert.equal(a.date, '2026-09-10');
  assert.equal(a.status, 'active');
  assert.equal(a.source, 'me');
  assert.equal(a.created, '2026-09-10');
  assert.equal(a.archivedOn, null);
  assert.equal(a.order, 1);
  assert.equal(b.order, 2);
  assert.deepEqual(b.repeat, { kind: 'daily' });
  assert.ok(JSON.parse(storage.getItem(DATA_KEY)).items[a.id]);
});

test('addItem honours a given id (for importers)', () => {
  const store = makeStore();
  const item = store.addItem({ id: 'hebrew:habit', type: 'habit', title: 'Hebrew', source: 'hebrew' });
  assert.equal(item.id, 'hebrew:habit');
  assert.equal(store.doc().items['hebrew:habit'].source, 'hebrew');
});

test('addItem rejects bad input', () => {
  const store = makeStore();
  assert.throws(() => store.addItem({ type: 'chore', title: 'x' }));
  assert.throws(() => store.addItem({ type: 'task', title: '   ' }));
  assert.throws(() => store.addItem({ type: 'quota', title: 'Apps', target: 0 }));
});

test('a store reloads what it saved', () => {
  const storage = new MemoryStorage();
  const first = makeStore({ storage });
  const item = first.addItem({ type: 'task', title: 'Persist me' });
  const second = createStore({ storage, now: clock(), newId: ids('x') });
  assert.equal(second.doc().items[item.id].title, 'Persist me');
});

test('toggleDone ticks, tombstones, and ticks again', () => {
  const store = makeStore();
  const item = store.addItem({ type: 'habit', title: 'Gym' });
  store.toggleDone(item.id);
  let logs = Object.values(store.doc().logs);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].kind, 'done');
  assert.equal(logs[0].day, '2026-09-10');
  store.toggleDone(item.id);
  logs = Object.values(store.doc().logs);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, 'archived');
  store.toggleDone(item.id);
  logs = Object.values(store.doc().logs);
  assert.equal(logs.length, 2);
  assert.equal(logs.filter((l) => l.status === 'active').length, 1);
});

test('logAmount and removeLog', () => {
  const store = makeStore();
  const quota = store.addItem({ type: 'quota', title: 'Job search', target: 360, unit: 'minutes' });
  const log = store.logAmount({ itemId: quota.id, amount: 45, note: 'NatCen' });
  assert.equal(log.kind, 'amount');
  assert.equal(log.amount, 45);
  assert.equal(log.day, '2026-09-10');
  assert.throws(() => store.logAmount({ itemId: quota.id, amount: 0 }));
  assert.throws(() => store.logAmount({ amount: 5 }));
  store.removeLog(log.id);
  assert.equal(store.doc().logs[log.id].status, 'archived');
});

test('archiveItem keeps the record and stamps archivedOn', () => {
  const store = makeStore();
  const item = store.addItem({ type: 'task', title: 'Old' });
  store.archiveItem(item.id);
  const rec = store.doc().items[item.id];
  assert.equal(rec.status, 'archived');
  assert.equal(rec.archivedOn, '2026-09-10');
});

test('accepting a suggestion makes it active from today', () => {
  const store = makeStore();
  const s = store.addItem({ type: 'task', title: 'Idea', status: 'suggested', source: 'gemini', created: '2026-09-01' });
  store.acceptSuggestion('items', s.id);
  assert.equal(store.doc().items[s.id].status, 'active');
  assert.equal(store.doc().items[s.id].created, '2026-09-10');
  const t = store.addItem({ type: 'task', title: 'Nope', status: 'suggested' });
  store.dismissSuggestion('items', t.id);
  assert.equal(store.doc().items[t.id].status, 'dismissed');
});

test('goals and milestones', () => {
  const store = makeStore();
  const goal = store.addGoal({ title: 'Get a job' });
  assert.equal(goal.target, null);
  const m = store.addMilestone(goal.id, 'CV done');
  assert.equal(m.done, false);
  store.toggleMilestone(m.id);
  assert.equal(store.doc().milestones[m.id].done, true);
  store.updateMilestone(m.id, { title: 'CV finished' });
  assert.equal(store.doc().milestones[m.id].title, 'CV finished');
  store.archiveMilestone(m.id);
  assert.equal(store.doc().milestones[m.id].status, 'archived');
  store.updateGoal(goal.id, { targetDate: '2026-12-01' });
  store.archiveGoal(goal.id);
  assert.equal(store.doc().goals[goal.id].status, 'archived');
  assert.throws(() => store.addGoal({ title: '' }));
});

test('updates stamp a later updated time', () => {
  const now = clock();
  const store = makeStore({ now });
  const item = store.addItem({ type: 'task', title: 'A' });
  now.advance(60000);
  store.updateItem(item.id, { title: 'B' });
  assert.ok(store.doc().items[item.id].updated > item.updated);
  assert.throws(() => store.updateItem('missing', { title: 'x' }));
});

test('reorder rewrites order and only touches moved rows', () => {
  const now = clock();
  const store = makeStore({ now });
  const a = store.addItem({ type: 'task', title: 'A' });
  const b = store.addItem({ type: 'task', title: 'B' });
  const c = store.addItem({ type: 'task', title: 'C' });
  now.advance(1000);
  store.reorder([c.id, a.id, b.id]);
  const items = store.doc().items;
  assert.deepEqual([items[c.id].order, items[a.id].order, items[b.id].order], [1, 2, 3]);
  assert.equal(items[c.id].updated > c.updated, true);
});

test('listeners get a reason; identical replaceDoc is silent', () => {
  const store = makeStore();
  const reasons = [];
  const off = store.subscribe((r) => reasons.push(r));
  store.addItem({ type: 'task', title: 'A' });
  const copy = JSON.parse(JSON.stringify(store.doc()));
  store.replaceDoc(copy);
  copy.items.extra = { id: 'extra', type: 'task', title: 'From sync', status: 'active' };
  store.replaceDoc(copy);
  store.updateSettings({ repo: 'George-Wightman/dashboard-sync' });
  off();
  store.addItem({ type: 'task', title: 'B' });
  assert.deepEqual(reasons, ['local', 'sync', 'settings']);
  assert.equal(store.doc().items.extra.title, 'From sync');
});

test('settings are device-local and move the day boundary', () => {
  const storage = new MemoryStorage();
  const now = clock(new Date(2026, 8, 11, 3, 0));
  const store = makeStore({ storage, now });
  assert.equal(store.today(), '2026-09-10');
  store.updateSettings({ dayStartHour: 0, token: 'secret' });
  assert.equal(store.today(), '2026-09-11');
  assert.equal(JSON.parse(storage.getItem(SETTINGS_KEY)).token, 'secret');
  assert.ok(!storage.getItem(DATA_KEY)?.includes('secret'));
});

test('a failed save is reported, not thrown', () => {
  const store = makeStore({ storage: new FullStorage() });
  let heard = 0;
  store.subscribe(() => heard++);
  const item = store.addItem({ type: 'task', title: 'Still here' });
  assert.equal(store.doc().items[item.id].title, 'Still here');
  assert.match(store.saveError(), /Quota/);
  assert.equal(heard, 1);
});

test('stableStringify sorts keys at every depth', () => {
  assert.equal(stableStringify({ b: 1, a: { d: [2, { f: 1, e: 0 }], c: null } }),
    '{"a":{"c":null,"d":[2,{"e":0,"f":1}]},"b":1}');
});

test('exportJson is the whole document', () => {
  const store = makeStore();
  store.addItem({ type: 'task', title: 'A' });
  assert.deepEqual(JSON.parse(store.exportJson()), store.doc());
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `js/data.js`.

- [ ] **Step 4: Implement `js/doc.js`**

```js
// The shape of the synced document, shared by the store and the merge.

export const MAPS = ['items', 'goals', 'milestones', 'logs'];

export function emptyDoc() {
  return { schema: 1, items: {}, goals: {}, milestones: {}, logs: {} };
}

// JSON with object keys sorted at every depth, so two equal documents always serialise the same.
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
```

- [ ] **Step 5: Implement `js/data.js`**

```js
// The store: the whole state is one document in localStorage. Every change goes through here,
// stamps `updated`, saves, and tells listeners why it changed.

import { logicalDay } from './dates.js';
import { MAPS, emptyDoc, stableStringify } from './doc.js';

export const DATA_KEY = 'dash_data';
export const SETTINGS_KEY = 'dash_settings';
export const DEFAULT_SETTINGS = { token: '', repo: '', dayStartHour: 4 };

const ITEM_TYPES = ['task', 'habit', 'quota'];

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function withMaps(doc) {
  for (const map of MAPS) doc[map] ??= {};
  doc.schema ??= 1;
  return doc;
}

function requireTitle(title, what) {
  const t = String(title ?? '').trim();
  if (!t) throw new Error(`${what} needs a title`);
  return t;
}

export function createStore({ storage, now = () => new Date(), newId = () => crypto.randomUUID() }) {
  let doc = withMaps(readJson(storage, DATA_KEY) ?? emptyDoc());
  let settings = { ...DEFAULT_SETTINGS, ...(readJson(storage, SETTINGS_KEY) ?? {}) };
  let saveError = null;
  const listeners = new Set();

  const stamp = () => now().toISOString();
  const today = () => logicalDay(now(), settings.dayStartHour);
  const notify = (reason) => { for (const fn of listeners) fn(reason); };

  function save(key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      saveError = null;
    } catch (e) {
      saveError = e?.message || String(e);
    }
  }

  function commit(reason) {
    save(DATA_KEY, doc);
    notify(reason);
  }

  function create(map, fields) {
    const rec = {
      source: 'me', status: 'active', created: today(), archivedOn: null,
      ...fields,
      id: fields.id ?? newId(),
      updated: stamp(),
    };
    doc[map][rec.id] = rec;
    commit('local');
    return rec;
  }

  function patch(map, id, changes) {
    const rec = doc[map][id];
    if (!rec) throw new Error(`No ${map} record ${id}`);
    doc[map][id] = { ...rec, ...changes, id, updated: stamp() };
    commit('local');
    return doc[map][id];
  }

  const nextOrder = (map) => Math.max(0, ...Object.values(doc[map]).map((r) => r.order ?? 0)) + 1;

  function addItem(fields) {
    if (!ITEM_TYPES.includes(fields.type)) throw new Error(`Unknown item type ${fields.type}`);
    const title = requireTitle(fields.title, 'An item');
    if (fields.type === 'quota' && !(fields.target > 0)) throw new Error('A quota needs a target above 0');
    const defaults = { area: '', goalId: null, order: nextOrder('items') };
    if (fields.type === 'task') defaults.date = today();
    if (fields.type === 'habit') defaults.repeat = { kind: 'daily' };
    if (fields.type === 'quota') Object.assign(defaults, { unit: 'count', unitLabel: '' });
    return create('items', { ...defaults, ...fields, title });
  }

  function toggleDone(itemId, day = today()) {
    const existing = Object.values(doc.logs).find((l) =>
      l.itemId === itemId && l.kind === 'done' && l.day === day && l.status === 'active');
    if (existing) return patch('logs', existing.id, { status: 'archived' });
    return create('logs', { itemId, goalId: null, kind: 'done', day, at: stamp(), note: '' });
  }

  function logAmount({ itemId = null, goalId = null, amount, day = today(), note = '' }) {
    if (!(amount > 0)) throw new Error('An amount must be above 0');
    if (!itemId && !goalId) throw new Error('logAmount needs an itemId or a goalId');
    return create('logs', { itemId, goalId, kind: 'amount', amount, day, at: stamp(), note });
  }

  function addGoal(fields) {
    const title = requireTitle(fields.title, 'A goal');
    const defaults = { targetDate: null, target: null, unit: 'count', unitLabel: '', order: nextOrder('goals') };
    return create('goals', { ...defaults, ...fields, title });
  }

  function addMilestone(goalId, title) {
    return create('milestones', {
      goalId, title: requireTitle(title, 'A milestone'), done: false, order: nextOrder('milestones'),
    });
  }

  function reorder(idList) {
    const t = stamp();
    idList.forEach((id, i) => {
      const rec = doc.items[id];
      if (rec && rec.order !== i + 1) doc.items[id] = { ...rec, order: i + 1, updated: t };
    });
    commit('local');
  }

  function replaceDoc(next, reason = 'sync') {
    if (stableStringify(next) === stableStringify(doc)) return;
    doc = withMaps(next);
    commit(reason);
  }

  function updateSettings(changes) {
    settings = { ...settings, ...changes };
    save(SETTINGS_KEY, settings);
    notify('settings');
  }

  return {
    doc: () => doc,
    settings: () => settings,
    today,
    saveError: () => saveError,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    addItem,
    updateItem: (id, changes) => patch('items', id, changes),
    archiveItem: (id) => patch('items', id, { status: 'archived', archivedOn: today() }),
    reorder,
    acceptSuggestion: (map, id) => patch(map, id, { status: 'active', created: today() }),
    dismissSuggestion: (map, id) => patch(map, id, { status: 'dismissed' }),

    toggleDone,
    logAmount,
    removeLog: (id) => patch('logs', id, { status: 'archived' }),

    addGoal,
    updateGoal: (id, changes) => patch('goals', id, changes),
    archiveGoal: (id) => patch('goals', id, { status: 'archived', archivedOn: today() }),
    addMilestone,
    updateMilestone: (id, changes) => patch('milestones', id, changes),
    toggleMilestone: (id) => patch('milestones', id, { done: !doc.milestones[id]?.done }),
    archiveMilestone: (id) => patch('milestones', id, { status: 'archived', archivedOn: today() }),

    replaceDoc,
    updateSettings,
    exportJson: () => JSON.stringify(doc, null, 2),
  };
}
```

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — all suites so far.

- [ ] **Step 7: Commit**

```bash
git add js/doc.js js/data.js tests/helpers.js tests/data.test.js
git commit -m "Add the store and shared document helpers"
```

(End the commit message with the co-author line from the Global Constraints.)
