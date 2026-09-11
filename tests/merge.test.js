import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickWinner, mergeDocs, sameDoc } from '../js/merge.js';
import { emptyDoc, stableStringify, MAPS } from '../js/doc.js';
import { makeStore, clock } from './helpers.js';

const S = stableStringify;

// Deterministic pseudo-random documents with overlapping ids and frequent timestamp ties.
function makeDoc(seed, n = 14) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; // Park–Miller: exact in doubles
  const doc = emptyDoc();
  for (let i = 0; i < n; i++) {
    const id = `r${Math.floor(rnd() * 20)}`;
    const map = MAPS[Math.floor(rnd() * 4)];
    doc[map][id] = {
      id,
      title: `t${Math.floor(rnd() * 3)}`,
      status: rnd() > 0.8 ? 'archived' : 'active',
      updated: `2026-09-10T09:0${Math.floor(rnd() * 3)}:00.000Z`,
    };
  }
  return doc;
}

test('pickWinner: later updated wins, ties are order-independent', () => {
  const old = { id: 'a', title: 'old', updated: '2026-09-10T09:00:00.000Z' };
  const neu = { id: 'a', title: 'new', updated: '2026-09-10T09:05:00.000Z' };
  assert.equal(pickWinner(old, neu), neu);
  assert.equal(pickWinner(neu, old), neu);
  const x = { id: 'a', title: 'x', updated: '2026-09-10T09:00:00.000Z' };
  const y = { id: 'a', title: 'y', updated: '2026-09-10T09:00:00.000Z' };
  assert.equal(pickWinner(x, y), pickWinner(y, x));
});

test('mergeDocs is commutative', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const a = makeDoc(seed);
    const b = makeDoc(seed + 1000);
    assert.equal(S(mergeDocs(a, b)), S(mergeDocs(b, a)), `seed ${seed}`);
  }
});

test('mergeDocs is idempotent', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const a = makeDoc(seed);
    const b = makeDoc(seed + 1000);
    const ab = mergeDocs(a, b);
    assert.equal(S(mergeDocs(ab, b)), S(ab), `seed ${seed}`);
    assert.equal(S(mergeDocs(ab, ab)), S(ab), `seed ${seed}`);
  }
});

test('three devices converge whatever the order', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const [a, b, c] = [makeDoc(seed), makeDoc(seed + 1000), makeDoc(seed + 2000)];
    assert.equal(S(mergeDocs(mergeDocs(a, b), c)), S(mergeDocs(a, mergeDocs(b, c))), `seed ${seed}`);
  }
});

test('mergeDocs never drops a record', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const a = makeDoc(seed);
    const b = makeDoc(seed + 1000);
    const m = mergeDocs(a, b);
    for (const map of MAPS) {
      for (const id of [...Object.keys(a[map]), ...Object.keys(b[map])]) assert.ok(m[map][id], `${map}/${id}`);
    }
  }
});

test('a later tombstone beats an earlier tick, and vice versa', () => {
  const tick = { id: 'l', kind: 'done', status: 'active', updated: '2026-09-10T09:00:00.000Z' };
  const untick = { ...tick, status: 'archived', updated: '2026-09-10T09:01:00.000Z' };
  const a = { ...emptyDoc(), logs: { l: tick } };
  const b = { ...emptyDoc(), logs: { l: untick } };
  assert.equal(mergeDocs(a, b).logs.l.status, 'archived');
  const retick = { ...tick, status: 'active', updated: '2026-09-10T09:02:00.000Z' };
  assert.equal(mergeDocs({ ...emptyDoc(), logs: { l: retick } }, b).logs.l.status, 'active');
});

test('null sides, schema and unknown record fields', () => {
  assert.equal(S(mergeDocs(null, null)), S(emptyDoc()));
  const b = { ...emptyDoc(), schema: 2, items: { i: { id: 'i', updated: 'x', futureField: 42 } } };
  const m = mergeDocs(null, b);
  assert.equal(m.schema, 2);
  assert.equal(m.items.i.futureField, 42);
});

test('sameDoc ignores key order', () => {
  const a = { schema: 1, items: { x: { id: 'x', b: 1, a: 2 } }, goals: {}, milestones: {}, logs: {} };
  const b = { logs: {}, milestones: {}, goals: {}, items: { x: { a: 2, id: 'x', b: 1 } }, schema: 1 };
  assert.equal(sameDoc(a, b), true);
  assert.equal(sameDoc(a, emptyDoc()), false);
});

test('moveBefore only touches the dragged row, so it cannot undo a concurrent archive (F4)', () => {
  const now = clock();
  const laptop = makeStore({ prefix: 'L', now });
  const x = laptop.addItem({ type: 'task', title: 'X' });
  const y = laptop.addItem({ type: 'task', title: 'Y' });
  const z = laptop.addItem({ type: 'task', title: 'Z' });
  const snapshot = JSON.parse(JSON.stringify(laptop.doc()));

  now.advance(60000);
  // Phone archives Y concurrently, with a later `updated` stamp than laptop currently has for Y.
  const phoneDoc = JSON.parse(JSON.stringify(snapshot));
  phoneDoc.items[y.id] = { ...phoneDoc.items[y.id], status: 'archived', archivedOn: '2026-09-10', updated: now().toISOString() };

  now.advance(60000);
  // Laptop drags X before Z; only X's record should change.
  laptop.moveBefore(x.id, z.id, [x.id, y.id, z.id]);
  assert.equal(laptop.doc().items[y.id].updated, snapshot.items[y.id].updated);

  const merged = mergeDocs(laptop.doc(), phoneDoc);
  assert.equal(merged.items[y.id].status, 'archived');
});

test('importJson merges a backup and cannot roll back newer work', () => {
  const now = clock();
  const store = makeStore({ now });
  const a = store.addItem({ type: 'task', title: 'Original' });
  const backup = JSON.parse(store.exportJson());
  now.advance(60000);
  store.updateItem(a.id, { title: 'Renamed later' });
  backup.items.fromBackup = { ...backup.items[a.id], id: 'fromBackup', title: 'Only in backup' };
  const reasons = [];
  store.subscribe((r) => reasons.push(r));
  store.importJson(JSON.stringify(backup));
  assert.equal(store.doc().items[a.id].title, 'Renamed later');
  assert.equal(store.doc().items.fromBackup.title, 'Only in backup');
  assert.deepEqual(reasons, ['local']);
  assert.throws(() => store.importJson('not json'), /valid JSON/);
  assert.throws(() => store.importJson('{"hello": 1}'), /backup/);
});
