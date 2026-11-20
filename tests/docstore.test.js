// The dashboard's document in IndexedDB (js/docstore.js), with a fake IndexedDB, localStorage and
// BroadcastChannel. The document must never be lost: these are mostly about the ways it could be.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocStore, UNSAVED_KEY } from '../js/docstore.js';
import { createStore, DATA_KEY } from '../js/data.js';

// localStorage: a Map, with an optional quota in characters.
function fakeLegacy(init = {}, quota = Infinity) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      const size = [...m.entries()].filter(([key]) => key !== k).reduce((s, [, x]) => s + x.length, 0) + String(v).length;
      if (size > quota) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, String(v));
    },
    removeItem: (k) => { m.delete(k); },
  };
}
// IndexedDB: async, with switches for failing and for holding writes until let go.
function fakeIdb(init = {}) {
  const m = new Map(Object.entries(init));
  const held = [];
  const b = {
    m, puts: 0, failGet: false, failPut: false, hold: false, lieOnRead: false,
    get: async (k) => { if (b.failGet) throw new Error('no IndexedDB'); return b.lieOnRead ? 'x' : (m.has(k) ? m.get(k) : undefined); },
    put: (k, v) => new Promise((resolve, reject) => {
      const go = () => { if (b.failPut) { reject(new Error('disk full')); return; } b.puts++; m.set(k, v); resolve(); };
      if (b.hold) held.push(go); else Promise.resolve().then(go);
    }),
    del: async (k) => { m.delete(k); },
    release: () => { while (held.length) held.shift()(); },
  };
  return b;
}
const doc = (n) => JSON.stringify({ schema: 1, n });

test('moves the document across, and only takes it out of localStorage once IndexedDB has it', async () => {
  const legacy = fakeLegacy({ dash_data: doc(1), dash_settings: '{"token":"t"}' });
  const idb = fakeIdb();
  const s = createDocStore({ backend: idb, legacy });
  await s.ready();
  assert.equal(s.mode, 'idb');
  assert.equal(idb.m.get('dash_data'), doc(1));
  assert.equal(legacy.getItem('dash_data'), null, 'the shared allowance is freed');
  assert.equal(s.getItem('dash_data'), doc(1));
  assert.equal(s.getItem('dash_settings'), '{"token":"t"}', 'everything else stays in localStorage');
  s.setItem('dash_settings', '{"token":"u"}');
  assert.equal(legacy.getItem('dash_settings'), '{"token":"u"}');
});

test('if IndexedDB can\'t be used, or reads back wrong, the document stays in localStorage as before', async () => {
  for (const breakIt of [(b) => { b.failGet = true; }, (b) => { b.failPut = true; }, (b) => { b.lieOnRead = true; }]) {
    const legacy = fakeLegacy({ dash_data: doc(1) });
    const idb = fakeIdb();
    breakIt(idb);
    const errors = [];
    const s = createDocStore({ backend: idb, legacy, onError: (m) => errors.push(m) });
    await s.ready();
    assert.equal(s.mode, 'legacy');
    assert.equal(legacy.getItem('dash_data'), doc(1), 'never removed');
    assert.equal(s.getItem('dash_data'), doc(1));
    s.setItem('dash_data', doc(2));
    assert.equal(legacy.getItem('dash_data'), doc(2), 'and saved there');
    assert.equal(errors.length, 1);
  }
});

test('a failure half way through moving leaves localStorage as it was', async () => {
  const legacy = fakeLegacy({ dash_data: doc(1), dash_data_corrupt: 'old' });
  const idb = fakeIdb();
  let n = 0;
  const put = idb.put;
  idb.put = (k, v) => (++n === 2 ? Promise.reject(new Error('disk full')) : put(k, v));
  const s = createDocStore({ backend: idb, legacy });
  await s.ready();
  assert.equal(s.mode, 'legacy');
  assert.equal(legacy.getItem('dash_data'), doc(1));
  assert.equal(legacy.getItem('dash_data_corrupt'), 'old');
});

test('a burst of saves is written once or twice, always ending on the newest', async () => {
  const idb = fakeIdb({ dash_data: doc(0) });
  const s = createDocStore({ backend: idb, legacy: fakeLegacy() });
  await s.ready();
  idb.puts = 0;
  for (let i = 1; i <= 20; i++) s.setItem('dash_data', doc(i));
  assert.equal(s.getItem('dash_data'), doc(20), 'reads are the newest at once');
  await s.settled();
  assert.ok(idb.puts <= 2, `${idb.puts} writes`);
  assert.equal(idb.m.get('dash_data'), doc(20));
});

test('closing mid-write leaves the newest copy in localStorage, and the next load prefers it and clears it', async () => {
  const legacy = fakeLegacy();
  const idb = fakeIdb({ dash_data: doc(1) });
  const s = createDocStore({ backend: idb, legacy });
  await s.ready();
  idb.hold = true;
  s.setItem('dash_data', doc(2));
  assert.equal(s.guard(), true);
  assert.equal(legacy.getItem(UNSAVED_KEY), doc(2));
  // The page is gone before the write lands: a new page loads.
  const next = createDocStore({ backend: fakeIdb({ dash_data: doc(1) }), legacy });
  await next.ready();
  assert.equal(next.getItem('dash_data'), doc(2));
  assert.equal(legacy.getItem(UNSAVED_KEY), null);
  // And when the write does land, the safety copy goes.
  const s2 = createDocStore({ backend: idb, legacy });
  idb.hold = false; idb.release();
  await s2.ready();
  legacy.setItem(UNSAVED_KEY, doc(3));
  s2.setItem('dash_data', doc(4));
  await s2.settled();
  assert.equal(legacy.getItem(UNSAVED_KEY), null);
  assert.equal(s2.guard(), false, 'nothing outstanding, nothing to guard');
});

test('a failed write keeps the copy in localStorage when it fits, and says so', async () => {
  const legacy = fakeLegacy();
  const idb = fakeIdb({ dash_data: doc(1) });
  const errors = [];
  const s = createDocStore({ backend: idb, legacy, onError: (m) => errors.push(m) });
  await s.ready();
  idb.failPut = true;
  s.setItem('dash_data', doc(2));
  await s.settled();
  assert.equal(legacy.getItem(UNSAVED_KEY), doc(2));
  assert.match(errors[0], /Couldn't save on this device: disk full/);
});

test('another window hears each save through the channel', async () => {
  const listeners = [];
  const bus = () => { const ch = { onmessage: null, postMessage: (data) => listeners.filter((l) => l !== ch).forEach((l) => l.onmessage?.({ data })) }; listeners.push(ch); return ch; };
  const idb = fakeIdb({ dash_data: doc(1) });
  const a = createDocStore({ backend: idb, legacy: fakeLegacy(), channel: bus() });
  const b = createDocStore({ backend: idb, legacy: fakeLegacy(), channel: bus() });
  await a.ready(); await b.ready();
  const heard = [];
  b.onRemote((key, value) => heard.push([key, value]));
  a.setItem('dash_data', doc(2));
  await a.settled();
  assert.deepEqual(heard, [['dash_data', doc(2)]]);
  assert.equal(b.getItem('dash_data'), doc(2));
});

test('the store itself works unchanged on top of it, and its document never touches localStorage', async () => {
  const legacy = fakeLegacy({}, 2000);
  const idb = fakeIdb();
  const s = createDocStore({ backend: idb, legacy });
  await s.ready();
  const store = createStore({ storage: s, now: () => new Date('2026-11-20T10:00:00Z'), newId: (() => { let i = 0; return () => `id${++i}`; })() });
  for (let i = 0; i < 40; i++) store.addItem({ type: 'task', title: `A task with a long enough title to fill a small allowance ${i}`, date: '2026-11-20' });
  await s.settled();
  assert.equal(store.saveError?.() ?? null, null);
  assert.equal(legacy.getItem(DATA_KEY), null);
  assert.equal(Object.keys(JSON.parse(idb.m.get(DATA_KEY)).items).length, 40, 'far past what localStorage would have held here');
});
