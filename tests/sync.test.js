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
