# Task 7: Merge

Part of [the core hub plan](../2026-09-10-core-hub.md) — read its Global Constraints first.

**Files:**
- Create: `js/merge.js`
- Modify: `js/data.js` (add `importJson`)
- Test: `tests/merge.test.js`

**Interfaces:**
- Consumes: `MAPS`, `emptyDoc`, `stableStringify` from `js/doc.js`; `createStore` from
  `js/data.js`; `makeStore`, `clock` from `tests/helpers.js`.
- Produces:
  - `pickWinner(a, b)` — the later `updated` wins; on a tie, the record whose
    `stableStringify` is greater. Whichever order the arguments come in, the same record wins.
  - `mergeDocs(a, b)` — either side may be `null`. Unions all four maps and picks a winner per
    id. Output ids are inserted in sorted order. Records keep fields the hub doesn't know about.
    Unknown top-level keys are dropped. Additive schema changes belong on records, not in new
    top-level maps. **Commutative, idempotent, and never drops an id.**
  - `sameDoc(a, b)` — equal once normalised through `mergeDocs(x, null)`.
  - Store gains `importJson(text)`: parses, checks that it looks like a backup (an object with an
    `items` object), merges it into the current document, and notifies `'local'` (so it syncs).
    Throws a readable `Error` for bad input. An older backup can't overwrite newer work.

- [ ] **Step 1: Write the failing test**

`tests/merge.test.js`:

```js
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `js/merge.js`.

- [ ] **Step 3: Implement `js/merge.js`**

```js
// Merging two copies of the document. Pure and deterministic: whichever device runs it, in
// whichever order, and however many times, the result is the same. Every quick-add is its own
// record and nothing is hard-deleted, so "later updated wins, per record" is the only rule.

import { MAPS, emptyDoc, stableStringify } from './doc.js';

export function pickWinner(a, b) {
  if (a.updated !== b.updated) return (a.updated ?? '') > (b.updated ?? '') ? a : b;
  return stableStringify(a) >= stableStringify(b) ? a : b;
}

export function mergeDocs(a, b) {
  const out = emptyDoc();
  out.schema = Math.max(a?.schema ?? 1, b?.schema ?? 1);
  for (const map of MAPS) {
    const left = a?.[map] ?? {};
    const right = b?.[map] ?? {};
    const ids = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const id of ids) {
      const x = left[id];
      const y = right[id];
      out[map][id] = x && y ? pickWinner(x, y) : (x ?? y);
    }
  }
  return out;
}

export function sameDoc(a, b) {
  return stableStringify(mergeDocs(a, null)) === stableStringify(mergeDocs(b, null));
}
```

- [ ] **Step 4: Add `importJson` to the store**

In `js/data.js`, add the import at the top:

```js
import { mergeDocs } from './merge.js';
```

Inside `createStore`, after `replaceDoc`, add:

```js
  function importJson(text) {
    let incoming;
    try {
      incoming = JSON.parse(text);
    } catch {
      throw new Error("That file isn't valid JSON");
    }
    if (!incoming || typeof incoming !== 'object' || !incoming.items || typeof incoming.items !== 'object') {
      throw new Error("That file isn't a dashboard backup");
    }
    replaceDoc(mergeDocs(doc, incoming), 'local');
  }
```

And add `importJson,` to the returned object, next to `exportJson`.

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — all suites so far.

- [ ] **Step 6: Commit**

```bash
git add js/merge.js js/data.js tests/merge.test.js
git commit -m "Add document merge and backup import"
```

(End the commit message with the co-author line from the Global Constraints.)
