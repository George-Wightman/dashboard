import { createStore } from '../js/data.js';
import { emptyDoc } from '../js/doc.js';
import { ConflictError } from '../js/sync.js';

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

// A sync file on GitHub, in memory: get/put with a sha, and a 409 when the sha is stale.
export class FakeGitHub {
  constructor() { this.file = null; this.n = 0; this.puts = 0; this.gets = 0; }
  async get() {
    this.gets++;
    return this.file ? { doc: structuredClone(this.file.doc), sha: this.file.sha } : null;
  }
  async put(doc, sha) {
    if ((this.file && sha !== this.file.sha) || (!this.file && sha)) throw new ConflictError('GitHub 409');
    this.puts++;
    this.file = { doc: structuredClone(doc), sha: `sha${++this.n}` };
    return this.file.sha;
  }
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

// A GitHub Contents API in memory: paths to text, a sha per path, and a directory listing for any
// prefix that has files directly under it — the shapes the store actually depends on.
export function fakeApi(initial = {}) {
  const files = new Map(Object.entries(initial));
  let n = 0;
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  const api = async (url, opts = {}) => {
    const path = decodeURIComponent(String(url).split('/contents/')[1].split('?')[0]);
    const method = opts.method ?? 'GET';
    if (method === 'GET') {
      if (files.has(path)) {
        return { ok: true, status: 200, json: async () => ({ content: b64(files.get(path)), sha: `sha-${path}`, encoding: 'base64' }) };
      }
      const under = [...files.keys()].filter((p) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/'));
      if (under.length) {
        return {
          ok: true,
          status: 200,
          json: async () => under.map((p) => ({ name: p.split('/').pop(), path: p, size: files.get(p).length, type: 'file' })),
        };
      }
      return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
    }
    if (method === 'PUT') {
      const body = JSON.parse(opts.body);
      files.set(path, Buffer.from(body.content, 'base64').toString('utf8'));
      return { ok: true, status: 200, json: async () => ({ content: { sha: `sha${++n}` } }) };
    }
    if (method === 'DELETE') {
      files.delete(path);
      return { ok: true, status: 200, json: async () => ({}) };
    }
    throw new Error(`unexpected ${method}`);
  };
  api.files = files;
  return api;
}
