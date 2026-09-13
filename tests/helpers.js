import { createStore } from '../js/data.js';
import { emptyDoc } from '../js/doc.js';

export class MemoryStorage {
  constructor(initial = {}) { this.map = new Map(Object.entries(initial)); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

export class FullStorage extends MemoryStorage {
  setItem() { throw new Error('QuotaExceededError'); }
}

// A controllable clock. Starts Thursday 10 Sep 2026, 09:00 local.
export function clock(start = new Date(2026, 8, 10, 9, 0)) {
  let t = start.getTime();
  const now = () => new Date(t);
  now.advance = (ms) => { t += ms; };
  now.set = (date) => { t = date.getTime(); };
  return now;
}

export function ids(prefix = 'id') {
  let n = 0;
  return () => `${prefix}${++n}`;
}

export function makeStore({ storage = new MemoryStorage(), now = clock(), prefix = 'id' } = {}) {
  return createStore({ storage, now, newId: ids(prefix) });
}

// Build a document by hand for the pure schedule tests.
export function fixture({ items = [], logs = [], goals = [], milestones = [], journal = [], flags = [], changes = [] } = {}) {
  const doc = emptyDoc();
  const base = {
    source: 'me', status: 'active', created: '2026-09-01', archivedOn: null,
    updated: '2026-09-01T09:00:00.000Z',
  };
  for (const [map, list] of Object.entries({ items, logs, goals, milestones, journal, flags, changes })) {
    for (const r of list) doc[map][r.id] = { ...base, ...r };
  }
  return doc;
}

export const done = (itemId, day, extra = {}) => ({
  id: `done-${itemId}-${day}`, itemId, goalId: null, kind: 'done', day, ...extra,
});

export const amount = (id, itemId, day, value, extra = {}) => ({
  id, itemId, goalId: null, kind: 'amount', amount: value, day, ...extra,
});
