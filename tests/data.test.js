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
