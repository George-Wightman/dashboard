import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, clock } from './helpers.js';
import { diffDocs } from '../js/changes.js';
import { todayRows } from '../js/schedule.js';

const DAY = 86400000;

// Runs fn against the store the way the tool does: diff before and after, log it as one change.
function asClaude(store, summary, fn) {
  const before = structuredClone(store.doc());
  fn();
  return store.addChange({ summary, edits: diffDocs(before, store.doc()) });
}

test('addChange writes one record, from Claude, with copies of the edits', () => {
  const now = clock();
  const store = makeStore({ now });
  const c = asClaude(store, 'Added task "A"', () => store.addItem({ type: 'task', title: 'A', source: 'claude' }));
  assert.equal(c.source, 'claude');
  assert.equal(c.status, 'active');
  assert.equal(c.summary, 'Added task "A"');
  assert.equal(c.at, now().toISOString());
  assert.equal(c.edits.length, 1);
  assert.equal(c.edits[0].before, null);
  assert.equal(c.undoneAt, null);
  assert.equal(c.undoneBy, null);
  assert.equal(c.pruned, false);
  assert.equal(store.doc().changes[c.id].summary, 'Added task "A"');
  assert.throws(() => store.addChange({ summary: '  ', edits: c.edits }), /A change needs a summary/);
  assert.throws(() => store.addChange({ summary: 'x', edits: [] }), /A change needs at least one edit/);
});

test('undoing an addition dismisses the record, so it leaves Today and never counts', () => {
  const now = clock();
  const store = makeStore({ now });
  let id;
  const c = asClaude(store, 'add', () => { id = store.addItem({ type: 'task', title: 'A' }).id; });
  now.advance(60000);
  const r = store.undoChange(c.id);
  assert.deepEqual(r.undone.map((e) => e.id), [id]);
  assert.deepEqual(r.skipped, []);
  assert.equal(r.already, false);
  assert.equal(store.doc().items[id].status, 'dismissed');
  assert.equal(store.doc().items[id].updated, now().toISOString());
  assert.equal(todayRows(store.doc(), store.today()).length, 0);
  assert.equal(store.doc().changes[c.id].undoneBy, 'me');
  assert.equal(store.doc().changes[c.id].undoneAt, now().toISOString());
});

test('undoing an edit restores the earlier record with a later stamp', () => {
  const now = clock();
  const store = makeStore({ now });
  const a = store.addItem({ type: 'task', title: 'A' });
  now.advance(60000);
  const c = asClaude(store, 'edit', () => store.updateItem(a.id, { title: 'B' }));
  now.advance(60000);
  store.undoChange(c.id, 'claude');
  const rec = store.doc().items[a.id];
  assert.equal(rec.title, 'A');
  assert.equal(rec.updated, now().toISOString());
  assert.equal(store.doc().changes[c.id].undoneBy, 'claude');
});

test('a record changed since is left alone; the rest of the change is still undone', () => {
  const now = clock();
  const store = makeStore({ now });
  let a;
  let b;
  const c = asClaude(store, 'two', () => {
    a = store.addItem({ type: 'task', title: 'A' });
    b = store.addItem({ type: 'task', title: 'B' });
  });
  now.advance(60000);
  store.updateItem(a.id, { title: 'A mine' });
  const r = store.undoChange(c.id);
  assert.deepEqual(r.undone.map((e) => e.id), [b.id]);
  assert.deepEqual(r.skipped.map((e) => e.id), [a.id]);
  assert.equal(store.doc().items[a.id].title, 'A mine');
  assert.equal(store.doc().items[a.id].status, 'active');
  assert.equal(store.doc().items[b.id].status, 'dismissed');
  assert.ok(store.doc().changes[c.id].undoneAt);
});

test('when every record has changed since, nothing is undone and the change stays undoable', () => {
  const now = clock();
  const store = makeStore({ now });
  let a;
  const c = asClaude(store, 'one', () => { a = store.addItem({ type: 'task', title: 'A' }); });
  now.advance(60000);
  store.updateItem(a.id, { title: 'A mine' });
  const before = JSON.stringify(store.doc());
  const r = store.undoChange(c.id);
  assert.deepEqual(r.undone, []);
  assert.deepEqual(r.skipped.map((e) => e.id), [a.id]);
  assert.equal(r.already, false);
  assert.equal(store.doc().changes[c.id].undoneAt, null);
  assert.equal(JSON.stringify(store.doc()), before);
});

test('an added log is archived, its tombstone', () => {
  const store = makeStore();
  const quota = store.addItem({ type: 'quota', title: 'Q', target: 3 });
  let log;
  const c = asClaude(store, 'log', () => { log = store.logAmount({ itemId: quota.id, amount: 1 }); });
  store.undoChange(c.id);
  assert.equal(store.doc().logs[log.id].status, 'archived');
});

test('undoing twice changes nothing; an unknown change throws', () => {
  const store = makeStore();
  const c = asClaude(store, 'add', () => store.addItem({ type: 'task', title: 'A' }));
  store.undoChange(c.id);
  const before = JSON.stringify(store.doc());
  assert.deepEqual(store.undoChange(c.id), { undone: [], skipped: [], already: true });
  assert.equal(JSON.stringify(store.doc()), before);
  assert.throws(() => store.undoChange('nope'), /No changes record nope/);
});

test('pruneChanges drops snapshots after 30 days and keeps the summary', () => {
  const now = clock();
  const store = makeStore({ now });
  const old = asClaude(store, 'old', () => store.addItem({ type: 'task', title: 'A' }));
  now.advance(29 * DAY);
  const recent = asClaude(store, 'recent', () => store.addItem({ type: 'task', title: 'B' }));
  assert.equal(store.pruneChanges(), 0);
  now.advance(2 * DAY); // old is 31 days old, recent 2
  assert.equal(store.pruneChanges(), 1);
  const c = store.doc().changes[old.id];
  assert.equal(c.pruned, true);
  assert.equal(c.summary, 'old');
  assert.deepEqual(c.edits, [{ map: 'items', id: old.edits[0].id, before: null, after: null }]);
  assert.equal(store.doc().changes[recent.id].pruned, false);
  assert.equal(store.undoChange(old.id).already, true);
  assert.equal(store.pruneChanges(), 0);
});
