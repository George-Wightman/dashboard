# Task 8: GitHub sync

Part of [the core hub plan](../2026-09-10-core-hub.md) — read its Global Constraints first.

**Files:**
- Create: `js/sync.js`
- Test: `tests/sync.test.js`

**Interfaces:**
- Consumes: `mergeDocs`, `sameDoc` from `js/merge.js`; `MAPS` from `js/doc.js`;
  `store.doc()`, `store.replaceDoc(doc)` from `js/data.js`; `makeStore`, `clock` from
  `tests/helpers.js`; `weekTotal` from `js/schedule.js` (in the test).
- Produces:
  - `ConflictError` — thrown by `put` when GitHub answers 409 or 422 (the `sha` moved on).
  - `encodeBase64(text)` / `decodeBase64(b64)` — UTF-8 safe. GitHub wraps base64 in newlines,
    so decode strips whitespace.
  - `createGitHubClient({ token, repo, path = 'data.json', fetch })` → `{ get, put }`.
    `get()` → `{ doc, sha }`, or `null` on 404. `put(doc, sha?)` → the new sha. Any other non-OK
    response throws `Error('GitHub <status>: <message>')`. `repo` is `'owner/name'`.
  - `syncOnce({ store, client, maxAttempts = 3 })` → `{ ok: true, pushed }` or
    `{ ok: false, error }`. It never throws. It pushes nothing when the remote already equals the
    merge. A remote file that isn't a dashboard document is an error, and local data is left alone.
  - `createSyncScheduler({ run, canRun = () => true, debounceMs = 5000, timers = globalThis })`
    → `{ now(), changed() }`. `changed()` (re)starts the debounce. `now()` runs immediately. It
    never runs two at once: a request made mid-run queues exactly one more. When `canRun()` is
    false it checks again after `debounceMs`.

- [ ] **Step 1: Write the failing test**

`tests/sync.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConflictError, encodeBase64, decodeBase64, createGitHubClient, syncOnce, createSyncScheduler,
} from '../js/sync.js';
import { sameDoc } from '../js/merge.js';
import { weekTotal } from '../js/schedule.js';
import { makeStore, clock } from './helpers.js';

// ---- fakes -------------------------------------------------------------------------------------

function jsonResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) };
}

// An in-memory stand-in for the one file in the sync repo.
class FakeGitHub {
  constructor() { this.file = null; this.n = 0; this.puts = 0; this.gets = 0; this.beforePut = null; }
  async get() {
    this.gets++;
    return this.file ? { doc: structuredClone(this.file.doc), sha: this.file.sha } : null;
  }
  async put(doc, sha) {
    if (this.beforePut) { const hook = this.beforePut; this.beforePut = null; await hook(); }
    if ((this.file && sha !== this.file.sha) || (!this.file && sha)) throw new ConflictError('GitHub 409');
    this.puts++;
    this.file = { doc: structuredClone(doc), sha: `sha${++this.n}` };
    return this.file.sha;
  }
}

function fakeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    setTimeout(fn) { const id = next++; pending.set(id, fn); return id; },
    clearTimeout(id) { pending.delete(id); },
    async flush() { const fns = [...pending.values()]; pending.clear(); for (const fn of fns) await fn(); },
    get count() { return pending.size; },
  };
}

// ---- base64 and the client ---------------------------------------------------------------------

test('base64 round-trips UTF-8 and tolerates GitHub line breaks', () => {
  const text = JSON.stringify({ title: 'שלום 👋 café' });
  const b64 = encodeBase64(text);
  const wrapped = b64.replace(/(.{20})/g, '$1\n');
  assert.equal(decodeBase64(wrapped), text);
});

test('client.get reads the file with auth and no caching', async () => {
  const calls = [];
  const doc = { schema: 1, items: {}, goals: {}, milestones: {}, logs: {} };
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(200, { content: encodeBase64(JSON.stringify(doc)), sha: 'abc' });
  };
  const client = createGitHubClient({ token: 'tok', repo: 'George-Wightman/dashboard-sync', fetch });
  assert.deepEqual(await client.get(), { doc, sha: 'abc' });
  assert.equal(calls[0].url, 'https://api.github.com/repos/George-Wightman/dashboard-sync/contents/data.json');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.equal(calls[0].init.cache, 'no-store');
});

test('client.get: 404 means no file yet; other errors throw', async () => {
  const missing = createGitHubClient({ token: 't', repo: 'o/r', fetch: async () => jsonResponse(404, { message: 'Not Found' }) });
  assert.equal(await missing.get(), null);
  const broken = createGitHubClient({ token: 't', repo: 'o/r', fetch: async () => jsonResponse(401, { message: 'Bad credentials' }) });
  await assert.rejects(broken.get(), /GitHub 401: Bad credentials/);
});

test('client.put sends content and sha; 409 is a ConflictError', async () => {
  let sent;
  const ok = createGitHubClient({
    token: 't', repo: 'o/r',
    fetch: async (url, init) => { sent = init; return jsonResponse(200, { content: { sha: 'new' } }); },
  });
  const doc = { schema: 1, items: { a: { id: 'a' } }, goals: {}, milestones: {}, logs: {} };
  assert.equal(await ok.put(doc, 'old'), 'new');
  assert.equal(sent.method, 'PUT');
  const body = JSON.parse(sent.body);
  assert.equal(body.sha, 'old');
  assert.deepEqual(JSON.parse(decodeBase64(body.content)), doc);
  const first = createGitHubClient({ token: 't', repo: 'o/r', fetch: async (u, init) => { sent = init; return jsonResponse(201, { content: { sha: 's1' } }); } });
  await first.put(doc);
  assert.equal('sha' in JSON.parse(sent.body), false);
  const conflict = createGitHubClient({ token: 't', repo: 'o/r', fetch: async () => jsonResponse(409, {}) });
  await assert.rejects(conflict.put(doc, 'x'), ConflictError);
  const down = createGitHubClient({ token: 't', repo: 'o/r', fetch: async () => jsonResponse(500, { message: 'oops' }) });
  await assert.rejects(down.put(doc, 'x'), /GitHub 500: oops/);
});

// ---- syncOnce ----------------------------------------------------------------------------------

test('first sync pushes local data to an empty repo', async () => {
  const gh = new FakeGitHub();
  const store = makeStore();
  store.addItem({ type: 'task', title: 'Email Sarah' });
  assert.deepEqual(await syncOnce({ store, client: gh }), { ok: true, pushed: true });
  assert.ok(sameDoc(gh.file.doc, store.doc()));
});

test('a sync with nothing new pulls and pushes nothing', async () => {
  const gh = new FakeGitHub();
  const laptop = makeStore({ prefix: 'L' });
  laptop.addItem({ type: 'task', title: 'From laptop' });
  await syncOnce({ store: laptop, client: gh });
  const phone = makeStore({ prefix: 'P' });
  assert.deepEqual(await syncOnce({ store: phone, client: gh }), { ok: true, pushed: false });
  assert.ok(sameDoc(phone.doc(), laptop.doc()));
  assert.equal(gh.puts, 1);
});

test('two devices converge and their amounts add up', async () => {
  const gh = new FakeGitHub();
  const now = clock();
  const laptop = makeStore({ prefix: 'L', now });
  const phone = makeStore({ prefix: 'P', now });
  const quota = laptop.addItem({ type: 'quota', title: 'Job search', target: 360, unit: 'minutes' });
  await syncOnce({ store: laptop, client: gh });
  await syncOnce({ store: phone, client: gh });
  now.advance(1000);
  laptop.logAmount({ itemId: quota.id, amount: 30 });
  phone.logAmount({ itemId: quota.id, amount: 20 });
  await syncOnce({ store: laptop, client: gh });
  await syncOnce({ store: phone, client: gh });
  await syncOnce({ store: laptop, client: gh });
  assert.ok(sameDoc(laptop.doc(), phone.doc()));
  assert.equal(weekTotal(laptop.doc(), quota.id, laptop.today()), 50);
});

test('a conflict mid-sync is retried and keeps both sides', async () => {
  const gh = new FakeGitHub();
  const laptop = makeStore({ prefix: 'L' });
  const phone = makeStore({ prefix: 'P' });
  laptop.addItem({ type: 'task', title: 'Laptop task' });
  await syncOnce({ store: laptop, client: gh });
  phone.addItem({ type: 'task', title: 'Phone task' });
  laptop.addItem({ type: 'task', title: 'Second laptop task' });
  gh.beforePut = () => syncOnce({ store: phone, client: gh }); // the phone sneaks in first
  const result = await syncOnce({ store: laptop, client: gh });
  assert.deepEqual(result, { ok: true, pushed: true });
  const titles = Object.values(gh.file.doc.items).map((i) => i.title).sort();
  assert.deepEqual(titles, ['Laptop task', 'Phone task', 'Second laptop task']);
});

test('gives up quietly after three conflicts', async () => {
  let gets = 0;
  const client = {
    async get() { gets++; return null; },
    async put() { throw new ConflictError('GitHub 409'); },
  };
  const store = makeStore();
  store.addItem({ type: 'task', title: 'A' });
  const result = await syncOnce({ store, client });
  assert.equal(result.ok, false);
  assert.match(result.error, /retry/);
  assert.equal(gets, 3);
});

test('a failed read leaves local data alone', async () => {
  const store = makeStore();
  store.addItem({ type: 'task', title: 'A' });
  const before = JSON.stringify(store.doc());
  const result = await syncOnce({ store, client: { async get() { throw new Error('offline'); }, async put() { throw new Error('no'); } } });
  assert.deepEqual(result, { ok: false, error: 'offline' });
  assert.equal(JSON.stringify(store.doc()), before);
});

test('a remote file that is not a dashboard document is refused', async () => {
  const store = makeStore();
  store.addItem({ type: 'task', title: 'A' });
  const before = JSON.stringify(store.doc());
  let puts = 0;
  const client = {
    async get() { return { doc: { items: 'garbage' }, sha: 's' }; },
    async put() { puts++; return 's2'; },
  };
  const result = await syncOnce({ store, client });
  assert.equal(result.ok, false);
  assert.match(result.error, /isn't a dashboard document/);
  assert.equal(JSON.stringify(store.doc()), before);
  assert.equal(puts, 0);
});

// ---- scheduler ---------------------------------------------------------------------------------

test('changed() debounces into one run', async () => {
  const timers = fakeTimers();
  let runs = 0;
  const s = createSyncScheduler({ run: async () => { runs++; }, timers });
  s.changed(); s.changed(); s.changed();
  assert.equal(timers.count, 1);
  await timers.flush();
  assert.equal(runs, 1);
});

test('now() during a run queues exactly one more', async () => {
  const timers = fakeTimers();
  let runs = 0;
  let release;
  const s = createSyncScheduler({
    run: () => { runs++; return runs === 1 ? new Promise((r) => { release = r; }) : Promise.resolve(); },
    timers,
  });
  const first = s.now();
  s.now();
  s.now();
  release();
  await first;
  assert.equal(runs, 2);
});

test('canRun false defers until it is true', async () => {
  const timers = fakeTimers();
  let runs = 0;
  let allowed = false;
  const s = createSyncScheduler({ run: async () => { runs++; }, canRun: () => allowed, timers });
  await s.now();
  assert.equal(runs, 0);
  assert.equal(timers.count, 1);
  allowed = true;
  await timers.flush();
  assert.equal(runs, 1);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `js/sync.js`.

- [ ] **Step 3: Implement**

`js/sync.js`:

```js
// Sync with one JSON file in a private GitHub repo: GET → merge → apply locally → PUT with the
// sha. A 409 means another device wrote in between, so go round again. Never throws, never
// blocks: every failure comes back as { ok: false, error } for the header to show.

import { mergeDocs, sameDoc } from './merge.js';
import { MAPS } from './doc.js';

export class ConflictError extends Error {}

const API = 'https://api.github.com';

export function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function decodeBase64(b64) {
  const binary = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export function createGitHubClient({ token, repo, path = 'data.json', fetch = (...args) => globalThis.fetch(...args) }) {
  const url = `${API}/repos/${repo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  async function failure(res) {
    let message = '';
    try { message = (await res.json())?.message ?? ''; } catch { /* no body */ }
    return new Error(`GitHub ${res.status}${message ? `: ${message}` : ''}`);
  }

  return {
    async get() {
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) throw await failure(res);
      const body = await res.json();
      return { doc: JSON.parse(decodeBase64(body.content)), sha: body.sha };
    },

    async put(doc, sha) {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'sync', content: encodeBase64(JSON.stringify(doc)), ...(sha ? { sha } : {}) }),
      });
      if (res.status === 409 || res.status === 422) throw new ConflictError(`GitHub ${res.status}`);
      if (!res.ok) throw await failure(res);
      return (await res.json()).content.sha;
    },
  };
}

const looksLikeDoc = (d) => d && typeof d === 'object' && !Array.isArray(d)
  && MAPS.every((m) => d[m] === undefined || (d[m] && typeof d[m] === 'object' && !Array.isArray(d[m])));

export async function syncOnce({ store, client, maxAttempts = 3 }) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let remote;
    try {
      remote = await client.get();
    } catch (e) {
      return { ok: false, error: e.message };
    }
    if (remote && !looksLikeDoc(remote.doc)) {
      return { ok: false, error: "The sync file isn't a dashboard document — nothing was changed" };
    }

    let merged;
    try {
      merged = mergeDocs(store.doc(), remote?.doc ?? null);
    } catch (e) {
      return { ok: false, error: `Merge failed: ${e.message}` };
    }
    store.replaceDoc(merged);
    if (remote && sameDoc(merged, remote.doc)) return { ok: true, pushed: false };

    try {
      await client.put(merged, remote?.sha);
      return { ok: true, pushed: true };
    } catch (e) {
      if (!(e instanceof ConflictError)) return { ok: false, error: e.message };
    }
  }
  return { ok: false, error: 'Another device kept writing at the same moment — will retry next time' };
}

export function createSyncScheduler({ run, canRun = () => true, debounceMs = 5000, timers = globalThis }) {
  let timer = null;
  let running = false;
  let again = false;

  function schedule() {
    if (timer) timers.clearTimeout(timer);
    timer = timers.setTimeout(now, debounceMs);
  }

  async function now() {
    if (timer) { timers.clearTimeout(timer); timer = null; }
    if (!canRun()) { schedule(); return; }
    if (running) { again = true; return; }
    running = true;
    try {
      await run();
    } finally {
      running = false;
      if (again) { again = false; now(); }
    }
  }

  return { now, changed: schedule };
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — all suites so far.

- [ ] **Step 5: Commit**

```bash
git add js/sync.js tests/sync.test.js
git commit -m "Add GitHub sync with retry and a debounced scheduler"
```

(End the commit message with the co-author line from the Global Constraints.)
