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

test('pickWinner treats a non-string updated as unset, not as a comparable value (H3)', () => {
  const numeric = { id: 'a', title: 'numeric', updated: 12345 };
  const stamped = { id: 'a', title: 'stamped', updated: '2026-09-10T09:00:00.000Z' };
  assert.equal(pickWinner(numeric, stamped), stamped);
  assert.equal(pickWinner(stamped, numeric), stamped);
});

test('pickWinner is commutative and associative across numeric, null, missing and string updated (H3)', () => {
  const recs = [
    { id: 'a', title: 'numeric', updated: 42 },
    { id: 'a', title: 'null', updated: null },
    { id: 'a', title: 'missing' },
    { id: 'a', title: 'stamped', updated: '2026-09-10T09:00:00.000Z' },
  ];
  for (const x of recs) {
    for (const y of recs) {
      assert.equal(pickWinner(x, y), pickWinner(y, x), `${x.title}/${y.title}`);
    }
  }
  for (const x of recs) {
    for (const y of recs) {
      for (const z of recs) {
        const left = pickWinner(pickWinner(x, y), z);
        const right = pickWinner(x, pickWinner(y, z));
        assert.equal(S(left), S(right), `${x.title}/${y.title}/${z.title}`);
      }
    }
  }
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

test('null beats absent in an unknown map, in both merge orders (H4)', () => {
  const a = { ...emptyDoc(), prefs: { showDone: null } };
  const b = { ...emptyDoc(), prefs: {} };
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

test('merge repairs a record with a non-string updated, without throwing (G4)', () => {
  const rec = { id: 'q', type: 'quota', status: 'active', updated: 12345 };
  const m = mergeDocs({ ...emptyDoc(), items: { q: rec } }, null);
  assert.equal(m.items.q.created, '1970-01-01');
});

test('merge repairs a record whose created is null, not just missing (G4)', () => {
  const rec = { id: 'i', status: 'active', created: null, updated: '2026-09-05T09:00:00.000Z' };
  const m = mergeDocs({ ...emptyDoc(), items: { i: rec } }, null);
  assert.equal(m.items.i.created, '2026-09-05');
});

test('merge leaves an archived log\'s archivedOn: null as is (G4)', () => {
  const rec = { id: 'l', kind: 'done', status: 'archived', archivedOn: null, updated: '2026-09-05T09:00:00.000Z' };
  const m = mergeDocs({ ...emptyDoc(), logs: { l: rec } }, null);
  assert.equal(m.logs.l.archivedOn, null);
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

// ---- the journal (Gemini coach) ---------------------------------------------------------------

const checkin = (fields) => ({
  id: 'checkin:2026-09-10', kind: 'checkin', day: '2026-09-10', questions: ['How did it go?'], answers: [],
  feedback: '', tomorrowIds: [], model: 'gemini-flash-lite-latest', source: 'gemini', status: 'active',
  created: '2026-09-10', archivedOn: null, updated: '2026-09-10T18:00:00.000Z', ...fields,
});

test('journal records merge like any other record: one per id, later updated wins', () => {
  const asked = checkin();
  const answered = checkin({ answers: ['Well'], feedback: 'Good.', updated: '2026-09-10T18:05:00.000Z' });
  const a = { ...emptyDoc(), journal: { [asked.id]: asked } };
  const b = { ...emptyDoc(), journal: { [answered.id]: answered } };
  assert.equal(mergeDocs(a, b).journal[asked.id].feedback, 'Good.');
  assert.equal(S(mergeDocs(a, b)), S(mergeDocs(b, a)));
  assert.deepEqual(Object.keys(mergeDocs(a, b).journal), [asked.id]);
});

test('a document from before the journal merges cleanly with one that has it', () => {
  const old = { schema: 1, items: {}, goals: {}, milestones: {}, logs: {} };
  const rec = checkin({ feedback: 'Kept.' });
  assert.deepEqual(mergeDocs(old, null).journal, {});
  assert.equal(mergeDocs(old, { ...emptyDoc(), journal: { [rec.id]: rec } }).journal[rec.id].feedback, 'Kept.');
  assert.equal(sameDoc(old, emptyDoc()), true);
});

test('old changes and old usage weeks leave in every merge, measured from the newest', async () => {
  const { CHANGE_DROP_DAYS, USAGE_DROP_WEEKS } = await import('../js/merge.js');
  assert.equal(CHANGE_DROP_DAYS, 21);
  assert.equal(USAGE_DROP_WEEKS, 16);
  const change = (id, at) => ({ id, at, updated: at, created: at.slice(0, 10), status: 'active', summary: id });
  const a = { schema: 1, changes: { old: change('old', '2026-09-01T10:00:00.000Z'), mid: change('mid', '2026-10-30T10:00:00.000Z') },
    calendar: { 'usage:lap1:2026-06-01': { id: 'usage:lap1:2026-06-01', updated: '2026-06-02T00:00:00.000Z', days: {} }, status: { id: 'status', updated: '2026-06-02T00:00:00.000Z' } } };
  const b = { schema: 1, changes: { now: change('now', '2026-11-11T10:00:00.000Z') },
    calendar: { 'usage:lap1:2026-11-09': { id: 'usage:lap1:2026-11-09', updated: '2026-11-11T00:00:00.000Z', days: {} } } };
  const merged = mergeDocs(a, b);
  assert.deepEqual(Object.keys(merged.changes).sort(), ['mid', 'now']);
  assert.deepEqual(Object.keys(merged.calendar).sort(), ['status', 'usage:lap1:2026-11-09']);
  // A copy that still has the old ones can't bring them back, in either order.
  assert.deepEqual(Object.keys(mergeDocs(merged, a).changes).sort(), ['mid', 'now']);
  assert.deepEqual(Object.keys(mergeDocs(a, merged).changes).sort(), ['mid', 'now']);
  // On its own, a document measures from its own newest change (old is 59 days behind mid).
  assert.deepEqual(Object.keys(mergeDocs(a, null).changes).sort(), ['mid']);
  assert.deepEqual(Object.keys(mergeDocs({ schema: 1, changes: { old: a.changes.old } }, null).changes), ['old']);
});

test('a record untouched for a month loses its per-field stamps, every copy the same, and still merges right', async () => {
  const { SYNC_COLD_DAYS } = await import('../js/merge.js');
  const { reviseRecord } = await import('../js/record.js');
  assert.equal(SYNC_COLD_DAYS, 30);
  const base = { id: 't1', type: 'task', title: 'Shelf', status: 'active', created: '2026-09-01', archivedOn: null, source: 'me' };
  // Edited twice in September: per-field stamps.
  const sept = reviseRecord(reviseRecord(null, base, '2026-09-01T10:00:00.000Z'), { ...base, title: 'Fix the shelf' }, '2026-09-02T10:00:00.000Z');
  assert.ok(sept._sync);
  // Stamps start at a record's first edit.
  const fresh = reviseRecord(reviseRecord(null, { ...base, id: 't2', title: 'New' }, '2026-11-19T10:00:00.000Z'), { ...base, id: 't2', title: 'Newer' }, '2026-11-20T10:00:00.000Z');
  const talk = { id: 'j1', kind: 'talk', status: 'active', created: '2026-09-01', updated: '2026-09-01T10:00:00.000Z', messages: [], _sync: { version: '2026-09-01T10:00:00.000Z', fields: {}, messages: {} } };
  const doc = { schema: 1, items: { t1: sept, t2: fresh }, journal: { j1: talk } };
  const out = mergeDocs(doc, null);
  assert.equal(out.items.t1._sync, undefined, 'cold: stamps gone');
  assert.equal(out.items.t1.title, 'Fix the shelf', 'content untouched');
  assert.ok(out.items.t2._sync, 'warm: kept');
  assert.ok(out.journal.j1._sync, "a talk keeps its messages' versions");
  // A copy that still has the stamps: the same record either way, in either order, and settled.
  assert.deepEqual(mergeDocs(out, doc).items.t1, out.items.t1);
  assert.deepEqual(mergeDocs(doc, out).items.t1, out.items.t1);
  assert.deepEqual(mergeDocs(mergeDocs(out, doc), doc), mergeDocs(out, doc));
  // A newer edit on another device still wins the field it changed, and the record is warm again.
  const edited = reviseRecord(sept, { ...sept, title: 'Shelf, done properly' }, '2026-11-19T10:00:00.000Z');
  const merged = mergeDocs(out, { schema: 1, items: { t1: edited } });
  assert.equal(merged.items.t1.title, 'Shelf, done properly');
  assert.equal(merged.items.t1.status, 'active');
  assert.ok(merged.items.t1._sync);
  assert.deepEqual(mergeDocs({ schema: 1, items: { t1: edited } }, out).items.t1, merged.items.t1, 'in either order');
});

// ---- the archive's pieces (docs/superpowers/specs/2026-11-20-archive-design.md) ----------------

test('expire strips sync stamps from change snapshots, the same in either order', async () => {
  const { mergeDocs: merge } = await import('../js/merge.js');
  const t = '2026-09-02T09:00:00.000Z';
  const stamped = { id: 'a', title: 'A', updated: t, _sync: { version: t, fields: { title: t } } };
  const change = (after) => ({ id: 'c1', status: 'active', source: 'claude', at: t, updated: t, created: '2026-09-02',
    summary: 'x', edits: [{ map: 'items', id: 'a', before: null, after }], undoneAt: null, undoneBy: null, pruned: false });
  const a = { ...emptyDoc(), changes: { c1: change(stamped) } };
  const { _sync, ...plain } = stamped;
  const b = { ...emptyDoc(), changes: { c1: change(plain) } };
  assert.equal(merge(a, null).changes.c1.edits[0].after._sync, undefined);
  assert.equal(merge(a, null).changes.c1.edits[0].after.title, 'A');
  assert.equal(S(merge(a, b)), S(merge(b, a)));
  assert.equal(merge(a, b).changes.c1.edits[0].after._sync, undefined);
});

test('mergeOne merges one record as mergeDocs does', async () => {
  const { mergeOne } = await import('../js/merge.js');
  const t1 = '2026-09-02T09:00:00.000Z';
  const t2 = '2026-09-03T09:00:00.000Z';
  const pairs = [
    ['items', { id: 'x', title: 'A', note: 'n', updated: t1, _sync: { version: t1, fields: { title: t1, note: t1 } } },
      { id: 'x', title: 'B', note: 'n', updated: t2, _sync: { version: t2, fields: { title: t2, note: t1 } } }],
    ['items', { id: 'x', title: 'A', status: 'archived', updated: t1 }, { id: 'x', title: 'B', updated: t2 }],
    ['logs', { id: 'x', kind: 'done', day: '2026-09-02', status: 'archived', archivedOn: null, updated: t2 },
      { id: 'x', kind: 'done', day: '2026-09-02', status: 'active', archivedOn: null, updated: t1 }],
  ];
  for (const [map, a, b] of pairs) {
    const viaDocs = mergeDocs({ schema: 1, [map]: { x: a } }, { schema: 1, [map]: { x: b } })[map].x;
    assert.deepEqual(mergeOne(map, a, b), viaDocs, map);
    assert.deepEqual(mergeOne(map, b, a), viaDocs, `${map} reversed`);
  }
});
