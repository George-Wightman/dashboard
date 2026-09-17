import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, DATA_KEY, SETTINGS_KEY, CORRUPT_KEY } from '../js/data.js';
import { stableStringify } from '../js/doc.js';
import { MemoryStorage, FullStorage, clock, ids, makeStore } from './helpers.js';

test('a new store is empty, with default settings', () => {
  const store = makeStore();
  assert.deepEqual(Object.keys(store.doc()).sort(), ['calendar', 'changes', 'flags', 'goals', 'gym', 'items', 'journal', 'logs', 'milestones', 'outcomes', 'reviews', 'rules', 'schema', 'workflowRuns']);
  assert.equal(store.settings().dayStartHour, 4);
  assert.equal(store.today(), '2026-09-10');
  assert.equal(store.loadError(), null);
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

test('unreadable saved data is kept aside and reported, not silently lost', () => {
  const storage = new MemoryStorage({ dash_data: '{not json' });
  const store = makeStore({ storage });
  assert.deepEqual(store.doc().items, {});
  assert.equal(storage.getItem(CORRUPT_KEY), '{not json');
  assert.match(store.loadError(), /couldn't be read/);
  store.addItem({ type: 'task', title: 'After' });
  assert.match(store.loadError(), /couldn't be read/); // survives later saves
  assert.equal(store.saveError(), null);
  assert.equal(storage.getItem(CORRUPT_KEY), '{not json');
});

test('saved data of the wrong shape, or a failed read, is reported too', () => {
  const arrayStorage = new MemoryStorage({ dash_data: '[1,2]' });
  const a = makeStore({ storage: arrayStorage });
  assert.match(a.loadError(), /couldn't be read/);
  assert.equal(arrayStorage.getItem(CORRUPT_KEY), '[1,2]');

  class DeniedRead extends MemoryStorage {
    getItem(key) { if (key === 'dash_data') throw new Error('denied'); return super.getItem(key); }
  }
  const b = makeStore({ storage: new DeniedRead() });
  assert.match(b.loadError(), /couldn't be read/);
  assert.deepEqual(b.doc().items, {});
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

test('toggleDone unticks every active tick for the day, not just one', () => {
  const store = makeStore();
  const item = store.addItem({ type: 'habit', title: 'Gym' });
  const day = store.today();
  const doc = JSON.parse(JSON.stringify(store.doc()));
  const dup = (id) => ({
    id, itemId: item.id, goalId: null, kind: 'done', day, note: '', at: '2026-09-10T09:00:00.000Z',
    source: 'me', status: 'active', created: day, archivedOn: null, updated: '2026-09-10T09:00:00.000Z',
  });
  doc.logs.dup1 = dup('dup1');
  doc.logs.dup2 = dup('dup2');
  store.replaceDoc(doc);
  const activeFor = () => Object.values(store.doc().logs)
    .filter((l) => l.itemId === item.id && l.kind === 'done' && l.status === 'active');
  assert.equal(activeFor().length, 2);
  store.toggleDone(item.id, day);
  assert.equal(activeFor().length, 0);
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

test('moveBefore patches only the moved row', () => {
  const now = clock();
  const store = makeStore({ now });
  const a = store.addItem({ type: 'task', title: 'A' }); // order 1
  const b = store.addItem({ type: 'task', title: 'B' }); // order 2
  const c = store.addItem({ type: 'task', title: 'C' }); // order 3
  now.advance(1000);
  store.moveBefore(c.id, a.id, [a.id, b.id, c.id]);
  let items = store.doc().items;
  assert.equal(items[c.id].order, 0);
  assert.equal(items[c.id].updated > c.updated, true);
  assert.equal(items[a.id].updated, a.updated);
  assert.equal(items[b.id].updated, b.updated);

  now.advance(1000);
  store.moveBefore(c.id, b.id, [a.id, b.id, c.id]);
  items = store.doc().items;
  assert.equal(items[c.id].order, 1.5);
});

test('moveBefore reorders within the dragged row\'s own group (G1)', () => {
  const now = clock();
  const store = makeStore({ now });
  const a = store.addItem({ type: 'task', title: 'A', order: 1 });
  const b = store.addItem({ type: 'task', title: 'B', order: 2 });
  const c = store.addItem({ type: 'task', title: 'C', order: 3 });
  const d = store.addItem({ type: 'task', title: 'D', order: 4 });

  now.advance(1000);
  store.moveBefore(d.id, c.id, [c.id, d.id]);
  const items = store.doc().items;
  assert.equal(items[d.id].order, 2);
  assert.ok(items[d.id].order < items[c.id].order); // D then C
  assert.equal(items[a.id].updated, a.updated);
  assert.equal(items[b.id].updated, b.updated);
});

test('moveBefore moves to the end of its own group when dropped on a row from the other group (G1)', () => {
  const store = makeStore();
  const a = store.addItem({ type: 'task', title: 'A', order: 1 });
  store.addItem({ type: 'task', title: 'B', order: 2 });
  const c = store.addItem({ type: 'task', title: 'C', order: 3 });
  const d = store.addItem({ type: 'task', title: 'D', order: 4 });
  store.moveBefore(c.id, a.id, [c.id, d.id]);
  assert.equal(store.doc().items[c.id].order, 5); // after D
});

test('moveBefore renumbers a tied group when dropped mid-tie (G1)', () => {
  const now = clock();
  const store = makeStore({ now });
  const a = store.addItem({ type: 'task', title: 'A', order: 5 });
  const b = store.addItem({ type: 'task', title: 'B', order: 5 });
  const c = store.addItem({ type: 'task', title: 'C', order: 5 });
  const aUpdated = a.updated;

  now.advance(1000);
  store.moveBefore(c.id, b.id, [a.id, b.id, c.id]);
  const items = store.doc().items;
  const sorted = [a.id, b.id, c.id].sort((x, y) => items[x].order - items[y].order);
  assert.deepEqual(sorted, [a.id, c.id, b.id]);
  assert.equal(items[a.id].updated, aUpdated);
});

test('moveBefore renumbers when the midpoint gap is exhausted by float precision (H6)', () => {
  const store = makeStore();
  // Adjacent orders this close have no double-precision value strictly between them: the naive
  // midpoint rounds to one of the two ends, so the drop must renumber instead of colliding.
  const a = store.addItem({ type: 'task', title: 'A', order: 1 });
  const c = store.addItem({ type: 'task', title: 'C', order: 5 });
  const b = store.addItem({ type: 'task', title: 'B', order: 1 + Number.EPSILON });
  store.moveBefore(c.id, b.id, [a.id, c.id, b.id]);
  const items = store.doc().items;
  assert.ok(items[a.id].order < items[c.id].order);
  assert.ok(items[c.id].order < items[b.id].order);
});

test('moveBefore is a no-op when the dragged row is dropped on itself', () => {
  const store = makeStore();
  const a = store.addItem({ type: 'task', title: 'A' });
  const before = store.doc().items[a.id];
  store.moveBefore(a.id, a.id, [a.id]);
  assert.equal(store.doc().items[a.id], before);
});

test('listeners get a reason; identical replaceDoc is silent', () => {
  const store = makeStore();
  const reasons = [];
  const off = store.subscribe((r) => reasons.push(r));
  store.addItem({ type: 'task', title: 'A' });
  const copy = JSON.parse(JSON.stringify(store.doc()));
  store.replaceDoc(copy);
  copy.items.extra = { id: 'extra', type: 'task', title: 'From sync', status: 'active', date: store.today() };
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

test('absorbStored merges in a save from another window sharing the same storage (F9)', () => {
  const storage = new MemoryStorage();
  const now = clock();
  const a = makeStore({ storage, now, prefix: 'a' });
  const b = makeStore({ storage, now, prefix: 'b' }); // both start from the same empty storage
  a.addItem({ type: 'task', title: 'from A' });
  now.advance(1000);
  b.addItem({ type: 'task', title: 'from B' }); // b's in-memory doc never saw A's write, so this overwrites storage
  assert.deepEqual(Object.values(JSON.parse(storage.getItem(DATA_KEY)).items).map((i) => i.title), ['from B']);

  a.absorbStored(storage.getItem(DATA_KEY));
  const titles = Object.values(a.doc().items).map((i) => i.title).sort();
  assert.deepEqual(titles, ['from A', 'from B']);

  const before = JSON.stringify(a.doc());
  a.absorbStored('not json');
  a.absorbStored('{"x":1}');
  assert.equal(JSON.stringify(a.doc()), before);
});

test('importJson rejects a file whose record maps are not real maps (F6)', () => {
  const store = makeStore();
  assert.throws(() => store.importJson('{"schema":1,"items":{},"logs":[1]}'), /backup/);
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
