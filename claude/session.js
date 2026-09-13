// One run of the tool: the sync file loaded into a store built by the app's own createStore (over
// memory, not localStorage), steps applied to it and logged as Claude's changes, then pushed with
// the app's own syncOnce. To the laptop and the phone, Claude is just another device.

import { randomUUID } from 'node:crypto';
import { createStore, DATA_KEY, SETTINGS_KEY } from '../js/data.js';
import { emptyDoc, isDoc, stableStringify } from '../js/doc.js';
import { syncOnce } from '../js/sync.js';
import { diffDocs } from '../js/changes.js';

export class MemoryStorage {
  constructor(initial = {}) { this.map = new Map(Object.entries(initial)); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

export async function openSession({ client, dayStartHour = 4, now = () => new Date(), newId = randomUUID }) {
  const remote = await client.get();
  if (remote && !isDoc(remote.doc)) throw new Error("The sync file isn't a dashboard document — nothing was changed");
  const storage = new MemoryStorage({
    [DATA_KEY]: JSON.stringify(remote?.doc ?? emptyDoc()),
    [SETTINGS_KEY]: JSON.stringify({ dayStartHour }),
  });
  const store = createStore({ storage, now, newId });
  let changed = false;

  return {
    store,

    // Runs one step against the store. Whatever it changed is logged as one of Claude's changes,
    // with the summary the step returns less the ' · #id' tail meant for Claude. Throws whatever
    // the step throws (the caller then pushes nothing).
    record(fn, { log = true } = {}) {
      const before = structuredClone(store.doc());
      const summary = fn(store);
      const edits = diffDocs(before, store.doc());
      if (log && edits.length) store.addChange({ summary: String(summary).replace(/ · #\S+$/, ''), edits });
      if (stableStringify(before) !== stableStringify(store.doc())) changed = true;
      return { summary, edits };
    },

    changed: () => changed,

    // Old snapshots are pruned, then the document goes up through the app's own sync: GET, merge,
    // PUT with the sha, round again on a conflict.
    async push() {
      if (!changed) return { ok: true, pushed: false };
      store.pruneChanges();
      return syncOnce({ store, client });
    },
  };
}
