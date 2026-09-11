import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickWinner, mergeDocs, sameDoc } from '../js/merge.js';
import { emptyDoc, stableStringify, MAPS } from '../js/doc.js';
import { streak, todayRows } from '../js/schedule.js';
import { makeStore, clock } from './helpers.js';

const S = stableStringify;

// An unknown top-level map, alongside the four known ones, to prove merging generalises.
const ALL_MAPS = [...MAPS, 'events'];

// Deterministic pseudo-random documents with overlapping ids and frequent timestamp ties.
function makeDoc(seed, n = 14) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; // Park–Miller: exact in doubles
  const doc = { ...emptyDoc(), events: {} };
  for (let i = 0; i < n; i++) {
    const id = `r${Math.floor(rnd() * 20)}`;
    const map = ALL_MAPS[Math.floor(rnd() * ALL_MAPS.length)];
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

test('mergeDocs never drops a record, known map or unknown', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const a = makeDoc(seed);
    const b = makeDoc(seed + 1000);
    const m = mergeDocs(a, b);
    for (const map of ALL_MAPS) {
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

test('unknown maps with falsy values merge symmetrically (G3)', () => {
  const a = { ...emptyDoc(), prefs: { showDone: false } };
  const b = { ...emptyDoc(), prefs: { showDone: true } };
  assert.equal(S(mergeDocs(a, b)), S(mergeDocs(b, a)));
});

test('an unknown top-level map merges per id, like the known maps (F5)', () => {
  const a = { ...emptyDoc(), events: { e1: { id: 'e1', title: 'A', updated: '2026-09-10T09:00:00.000Z' } } };
  const b = {
    ...emptyDoc(),
    events: {
      e1: { id: 'e1', title: 'B', updated: '2026-09-10T09:05:00.000Z' },
      e2: { id: 'e2', title: 'Only in b', updated: '2026-09-10T09:00:00.000Z' },
    },
  };
  const m = mergeDocs(a, b);
  assert.equal(m.events.e1.title, 'B'); // later updated wins, same as a known map
  assert.equal(m.events.e2.title, 'Only in b');
  assert.equal(mergeDocs(a, null).events.e1.title, 'A'); // present on one side only
  assert.equal(mergeDocs(null, b).events.e2.title, 'Only in b');
});

test('an unknown scalar top-level key passes through (F5)', () => {
  const a = { ...emptyDoc(), deviceName: 'laptop' };
  const b = { ...emptyDoc(), deviceName: 'phone' };
  assert.equal(mergeDocs(a, null).deviceName, 'laptop');
  assert.equal(mergeDocs(null, b).deviceName, 'phone');
  const merged = mergeDocs(a, b);
  assert.equal(merged.deviceName, S(a.deviceName) >= S(b.deviceName) ? 'laptop' : 'phone');
});

test('top-level keys come out sorted, after schema (F5)', () => {
  const a = { ...emptyDoc(), zeta: 1, alpha: 2 };
  const keys = Object.keys(mergeDocs(a, null));
  assert.equal(keys[0], 'schema');
  assert.deepEqual(keys.slice(1), [...keys.slice(1)].sort());
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

test('merge repairs a record missing created, deriving it from updated (F8)', () => {
  const rec = { id: 'q', type: 'quota', status: 'active', updated: '2026-09-10T09:00:00.000Z' };
  const m = mergeDocs({ ...emptyDoc(), items: { q: rec } }, null);
  assert.equal(m.items.q.created, '2026-09-10');
});

test('merge repairs an archived record missing archivedOn, using created (F8)', () => {
  const rec = { id: 'i', status: 'archived', created: '2026-09-01', updated: '2026-09-05T09:00:00.000Z' };
  const m = mergeDocs({ ...emptyDoc(), items: { i: rec } }, null);
  assert.equal(m.items.i.archivedOn, '2026-09-01');
});

test('merge normalisation is idempotent (F8)', () => {
  const rec = { id: 'i', status: 'archived', updated: '2026-09-05T09:00:00.000Z' };
  const once = mergeDocs({ ...emptyDoc(), items: { i: rec } }, null);
  const twice = mergeDocs(once, null);
  assert.deepEqual(twice, once);
});

test('streak and todayRows no longer throw on a merged record missing created (F8)', () => {
  const rec = { id: 'q', type: 'quota', status: 'active', target: 5, unit: 'count', updated: '2026-09-05T09:00:00.000Z' };
  const merged = mergeDocs({ ...emptyDoc(), items: { q: rec } }, null);
  assert.doesNotThrow(() => streak(merged, merged.items.q, '2026-09-10'));
  assert.doesNotThrow(() => todayRows(merged, '2026-09-10'));
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
