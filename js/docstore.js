// The dashboard's document in IndexedDB, not localStorage (2026-11-20).
//
// localStorage's allowance (about 5 million characters) belongs to the web address, and the Hebrew
// app is served from the same one. The document is 1.7 MB and growing; on 11 Nov it filled the
// allowance and the Hebrew app's save failed mid-practice. The map files moved to IndexedDB then
// (js/bigstore.js); this moves the document, so the Hebrew app has the small allowance to itself.
//
// To the store (js/data.js) it looks like localStorage: getItem, setItem and removeItem, all
// synchronous. The document's keys (DOC_KEYS) live in memory and are written to IndexedDB behind
// it; every other key (settings, the tiles, small caches) passes straight through to localStorage.
//
// THE DOCUMENT MUST NEVER BE LOST, so:
// - It moves across only once IndexedDB has it: the localStorage copy is removed after the write
//   succeeds and reads back the same, never before. If IndexedDB can't be opened or written, the
//   document simply stays in localStorage, as it always was (`mode` says which).
// - Writes are coalesced: a burst of saves is one write of the latest, in order, never an older
//   copy landing after a newer one.
// - IndexedDB writes finish a moment after setItem returns. If the page is hidden or closed while
//   one is outstanding, guard() puts the latest copy in localStorage (UNSAVED_KEY), and the next
//   load prefers it, writes it across and removes it.
// - Other windows on this device used to hear of a save through localStorage's `storage` event,
//   which IndexedDB doesn't have; a BroadcastChannel carries it instead (onRemote).

export const DOC_KEYS = ['dash_data', 'dash_data_corrupt'];
export const UNSAVED_KEY = 'dash_data_unsaved';
export const CHANNEL = 'dash_doc';

// IndexedDB as get/put/del promises, one connection kept open (a connection a write was a leak).
export function idbDocBackend(idb = globalThis.indexedDB, { db: name = 'dash_doc', store = 'doc' } = {}) {
  let conn = null;
  const open = () => (conn ??= new Promise((resolve, reject) => {
    if (!idb) { reject(new Error('no IndexedDB')); return; }
    const req = idb.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(store);
    req.onsuccess = () => {
      const db = req.result;
      // Another version of the page asking to upgrade, or the browser closing it: open afresh next time.
      db.onversionchange = () => { db.close(); conn = null; };
      db.onclose = () => { conn = null; };
      resolve(db);
    };
    req.onerror = () => { conn = null; reject(req.error); };
    req.onblocked = () => { conn = null; reject(new Error('IndexedDB blocked')); };
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => resolve(out?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('IndexedDB write aborted'));
    });
  };
  return {
    get: (key) => tx('readonly', (s) => s.get(key)),
    put: (key, value) => tx('readwrite', (s) => s.put(value, key)),
    del: (key) => tx('readwrite', (s) => s.delete(key)),
  };
}

// `legacy` is localStorage; `channel` a BroadcastChannel (or null); `onError(message)` hears a write
// that failed (the copy then stays in localStorage if it fits).
export function createDocStore({ backend, legacy, channel = null, keys = DOC_KEYS, onError = () => {} }) {
  const docKey = new Set(keys);
  const mem = new Map();
  let mode = 'loading';                  // 'idb' once moved; 'legacy' if IndexedDB can't be used
  let loading = null;
  const dirty = new Set();
  let writing = null;
  const remote = new Set();

  const legacyGet = (key) => { try { return legacy.getItem(key); } catch { return null; } };
  const legacyDel = (key) => { try { legacy.removeItem(key); } catch { /* it stays */ } };

  async function persist(key, value) {
    await backend.put(key, value);
    const back = await backend.get(key);
    if (back !== value) throw new Error('IndexedDB read back something else');
  }

  async function load() {
    try {
      const moved = [];
      for (const key of keys) {
        const unsaved = key === keys[0] ? legacyGet(UNSAVED_KEY) : null;
        const old = legacyGet(key);
        const stored = await backend.get(key);
        // Newest first: a copy left when the page closed mid-write, then one still in localStorage
        // (not moved yet), then IndexedDB's.
        const value = unsaved ?? old ?? (typeof stored === 'string' ? stored : null);
        if (value === null) continue;
        mem.set(key, value);
        if (value !== stored) await persist(key, value);
        if (old !== null) moved.push(key);
        if (unsaved !== null) moved.push(UNSAVED_KEY);
      }
      // Only once every key is safely across: a failure half way leaves localStorage as it was.
      moved.forEach(legacyDel);
      mode = 'idb';
    } catch (e) {
      // IndexedDB can't be used here (a private window, a full disk): the document stays in
      // localStorage, read from there as before.
      mode = 'legacy';
      mem.clear();
      onError(`Saving on this device uses the small store: ${e?.message ?? e}`);
    }
  }

  // One write at a time, always of the latest copy.
  function flush() {
    if (writing || mode !== 'idb') return writing;
    writing = (async () => {
      while (dirty.size) {
        const [key] = dirty;
        dirty.delete(key);
        const value = mem.get(key);
        try {
          if (value === undefined) await backend.del(key);
          else {
            await backend.put(key, value);
            if (key === keys[0]) { legacyDel(UNSAVED_KEY); if (channel) try { channel.postMessage({ key, value }); } catch { /* other windows catch up on sync */ } }
          }
        } catch (e) {
          // Kept where it can be: localStorage, as the copy the next load prefers.
          if (value !== undefined && key === keys[0]) { try { legacy.setItem(UNSAVED_KEY, value); } catch { /* too big */ } }
          onError(`Couldn't save on this device: ${e?.message ?? e}`);
        }
      }
    })().finally(() => { writing = null; if (dirty.size) flush(); });
    return writing;
  }

  if (channel) {
    channel.onmessage = (ev) => {
      const { key, value } = ev?.data ?? {};
      if (!docKey.has(key) || typeof value !== 'string' || mode !== 'idb') return;
      mem.set(key, value);
      for (const fn of remote) fn(key, value);
    };
  }

  return {
    ready() { return (loading ??= load()); },
    get mode() { return mode; },
    getItem(key) {
      if (docKey.has(key) && mode === 'idb') return mem.has(key) ? mem.get(key) : null;
      return legacyGet(key);
    },
    setItem(key, value) {
      if (docKey.has(key) && mode === 'idb') { mem.set(key, String(value)); dirty.add(key); flush(); return; }
      legacy.setItem(key, value);
    },
    removeItem(key) {
      if (docKey.has(key) && mode === 'idb') { mem.delete(key); dirty.add(key); flush(); return; }
      legacyDel(key);
    },
    // Hidden or closing: anything not written yet goes to localStorage, for the next load.
    guard() {
      if (mode !== 'idb' || (!writing && !dirty.size)) return false;
      const value = mem.get(keys[0]);
      if (value === undefined) return false;
      try { legacy.setItem(UNSAVED_KEY, value); return true; } catch { return false; }
    },
    // Resolves once every write so far has landed.
    settled() { return writing ?? Promise.resolve(); },
    onRemote(fn) { remote.add(fn); return () => remote.delete(fn); },
  };
}
