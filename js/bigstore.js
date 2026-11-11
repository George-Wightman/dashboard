// Big files this device can download again (the map's painted cities, js/map/files.js), kept in
// IndexedDB instead of localStorage.
//
// Why: localStorage's allowance (about 5 million characters) belongs to the web address, not the
// app, and the Hebrew app is served from the same address. The maps are up to a megabyte a city,
// and saving them filled the allowance; the Hebrew app's next save then failed mid-practice
// (11 Nov 2026). IndexedDB has its own, far larger allowance.
//
// It looks like localStorage to its callers (getItem, setItem, removeItem, all synchronous), so
// loadCachedMaps and refreshMaps use it unchanged. Reads come from a copy in memory, filled once by
// ready(); writes update the copy and go to IndexedDB behind it. Every call fails soft: with no
// IndexedDB (a private window) the files are kept for this visit only.

const DB = 'dash_files';
const STORE = 'files';

// The real backend. `idb` is passed in so a page without IndexedDB gets one that keeps nothing.
export function idbBackend(idb = globalThis.indexedDB) {
  const open = () => new Promise((resolve, reject) => {
    if (!idb) { reject(new Error('no IndexedDB')); return; }
    const req = idb.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(out?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    get: (key) => tx('readonly', (s) => s.get(key)),
    put: (key, value) => tx('readwrite', (s) => s.put(value, key)),
    del: (key) => tx('readwrite', (s) => s.delete(key)),
  };
}

// `keys` are the names this store holds. `legacy` is the localStorage they used to live in: ready()
// moves each one across and always removes it from there, even when the move fails, because freeing
// the shared allowance matters more than a copy that downloads again.
export function createBigStore({ backend, legacy = null, keys = [] }) {
  const mem = new Map();
  const keep = (key, value) => { Promise.resolve().then(() => backend.put(key, value)).catch(() => { /* this visit only */ }); };
  let loading = null;

  async function load() {
    for (const key of keys) {
      let old = null;
      try { old = legacy?.getItem(key) ?? null; } catch { /* unreadable: nothing to move */ }
      if (old !== null) {
        try { legacy.removeItem(key); } catch { /* it stays; the next open tries again */ }
        if (!mem.has(key)) { mem.set(key, old); keep(key, old); }
        continue;
      }
      // Something saved while this was loading is newer than what IndexedDB holds.
      if (mem.has(key)) continue;
      try {
        const value = await backend.get(key);
        if (typeof value === 'string' && !mem.has(key)) mem.set(key, value);
      } catch { /* nothing kept */ }
    }
  }

  return {
    ready() { return (loading ??= load()); },
    getItem(key) { return mem.has(key) ? mem.get(key) : null; },
    setItem(key, value) { mem.set(key, String(value)); keep(key, String(value)); },
    removeItem(key) { mem.delete(key); Promise.resolve().then(() => backend.del(key)).catch(() => { /* best effort */ }); },
  };
}
