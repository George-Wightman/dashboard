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
