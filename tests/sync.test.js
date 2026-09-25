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

test('client.get falls back to the blobs API for files over 1MB (F7)', async () => {
  const doc = { schema: 1, items: {}, goals: {}, milestones: {}, logs: {} };
  const fetch = async (url) => {
    if (url === 'https://api.github.com/repos/o/r/contents/data.json') {
      return jsonResponse(200, { content: '', encoding: 'none', sha: 's1' });
    }
    if (url === 'https://api.github.com/repos/o/r/git/blobs/s1') {
      return jsonResponse(200, { content: encodeBase64(JSON.stringify(doc)), encoding: 'base64' });
    }
    throw new Error(`unexpected url ${url}`);
  };
  const client = createGitHubClient({ token: 't', repo: 'o/r', fetch });
  assert.deepEqual(await client.get(), { doc, sha: 's1' });
});

test('client.get: 404 means no file yet; other errors throw', async () => {
  const missing = createGitHubClient({ token: 't', repo: 'o/r', fetch: async () => jsonResponse(404, { message: 'Not Found' }) });
  assert.equal(await missing.get(), null);
  const broken = createGitHubClient({ token: 't', repo: 'o/r', fetch: async () => jsonResponse(500, { message: 'oops' }) });
  await assert.rejects(broken.get(), /GitHub 500: oops/);
});

test('client.get: 401 or 403 explain the access key, naming the repo', async () => {
  const unauthorized = createGitHubClient({ token: 't', repo: 'o/r', fetch: async () => jsonResponse(401, { message: 'Bad credentials' }) });
  await assert.rejects(unauthorized.get(), /refused the access key/);
  await assert.rejects(unauthorized.get(), /o\/r/);
  const forbidden = createGitHubClient({ token: 't', repo: 'o/r', fetch: async () => jsonResponse(403, { message: 'Forbidden' }) });
  await assert.rejects(forbidden.get(), /refused the access key/);
  // GitHub's (or a gateway's) own words go on the end, so a refused write isn't mistaken for a bad key.
  const gateway = createGitHubClient({ token: 't', repo: 'o/r', fetch: async () => jsonResponse(403, { message: 'Resource not accessible by integration' }) });
  await assert.rejects(gateway.put({}, 'x'), /It said \(HTTP 403\): Resource not accessible by integration$/);
});

test('client.get with a ref reads that branch', async () => {
  const urls = [];
  const c = createGitHubClient({ token: 't', repo: 'o/r', ref: 'claude/modest-pascal', fetch: async (url) => { urls.push(url); return jsonResponse(404, {}); } });
  assert.equal(await c.get(), null);
  assert.equal(urls[0], 'https://api.github.com/repos/o/r/contents/data.json?ref=claude%2Fmodest-pascal');
});

test('client: a sandbox proxy blocking the repo is not blamed on the key', async () => {
  const message = 'GitHub access to this repository is not enabled for this session. Use add_repo to request access.';
  const blocked = createGitHubClient({ token: 't', repo: 'o/r', fetch: async () => jsonResponse(403, { message }) });
  await assert.rejects(blocked.get(), (e) => /network this chat runs in is blocking o\/r/.test(e.message)
    && !/refused the access key/.test(e.message) && e.message.includes(message));
  await assert.rejects(blocked.put({}, 'x'), /blocking o\/r/);
});

test('client.put: 401 or 403 explain the access key; 404 explains the repo is not visible', async () => {
  const forbidden = createGitHubClient({ token: 't', repo: 'o/r', fetch: async () => jsonResponse(403, { message: 'Forbidden' }) });
  await assert.rejects(forbidden.put({}, 'x'), /refused the access key/);
  const notFound = createGitHubClient({ token: 't', repo: 'o/r', fetch: async () => jsonResponse(404, { message: 'Not Found' }) });
  await assert.rejects(notFound.put({}, 'x'), /can't see o\/r with this key/);
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

test('client.put: a 422 about the sha is a conflict; any other 422 is a real error', async () => {
  const doc = { schema: 1, items: {}, goals: {}, milestones: {}, logs: {} };
  const shaMissing = createGitHubClient({ token: 't', repo: 'o/r', fetch: async () => jsonResponse(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }) });
  await assert.rejects(shaMissing.put(doc), ConflictError);
  const badContent = createGitHubClient({ token: 't', repo: 'o/r', fetch: async () => jsonResponse(422, { message: 'content is not valid Base64' }) });
  await assert.rejects(badContent.put(doc, 'x'), (e) => !(e instanceof ConflictError) && /GitHub 422: content is not valid Base64/.test(e.message));
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

test('a non-conflict error is reported at once, without retrying', async () => {
  let gets = 0;
  const client = createGitHubClient({
    token: 't', repo: 'o/r',
    fetch: async (url, init) => {
      if (!init.method) { gets++; return jsonResponse(404, { message: 'Not Found' }); }
      return jsonResponse(422, { message: 'content is not valid Base64' });
    },
  });
  const store = makeStore();
  store.addItem({ type: 'task', title: 'A' });
  const result = await syncOnce({ store, client });
  assert.deepEqual(result, { ok: false, error: 'GitHub 422: content is not valid Base64' });
  assert.equal(gets, 1);
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

test('a remote file that is not a dashboard document is refused, whatever shape it is in (F6)', async () => {
  const store = makeStore();
  store.addItem({ type: 'task', title: 'A' });
  const before = JSON.stringify(store.doc());
  let puts = 0;
  const client = {
    async get() { return { doc: { days: {} }, sha: 's' }; },
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

test('flush() runs a pending debounce immediately, and does nothing when idle', async () => {
  const timers = fakeTimers();
  let runs = 0;
  const s = createSyncScheduler({ run: async () => { runs++; }, timers });
  s.changed();
  assert.equal(timers.count, 1);
  await s.flush();
  assert.equal(runs, 1);
  assert.equal(timers.count, 0);
  await s.flush();
  assert.equal(runs, 1);
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

// ---- the journal (Gemini coach) ---------------------------------------------------------------

test('a sync file written before the journal existed is not rewritten just to add it', async () => {
  const gh = new FakeGitHub();
  gh.file = { doc: { schema: 1, items: {}, goals: {}, milestones: {}, logs: {} }, sha: 'old' };
  const store = makeStore();
  assert.deepEqual(await syncOnce({ store, client: gh }), { ok: true, pushed: false });
  assert.deepEqual(store.doc().journal, {});
  assert.equal(gh.puts, 0);
});

test('a check-in saved on one device reaches the other', async () => {
  const gh = new FakeGitHub();
  const now = clock(new Date(2026, 8, 10, 19, 0));
  const laptop = makeStore({ prefix: 'L', now });
  const phone = makeStore({ prefix: 'P', now });
  laptop.saveJournal({ kind: 'checkin', day: '2026-09-10', questions: ['How did the CV go?'], model: 'gemini-flash-lite-latest' });
  await syncOnce({ store: laptop, client: gh });
  await syncOnce({ store: phone, client: gh });
  assert.deepEqual(phone.doc().journal['checkin:2026-09-10'].questions, ['How did the CV go?']);
});

// ---- flags -------------------------------------------------------------------------------------

test('a sync file written before flags existed is not rewritten just to add them', async () => {
  const gh = new FakeGitHub();
  gh.file = { doc: { schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {} }, sha: 'old' };
  const store = makeStore();
  assert.deepEqual(await syncOnce({ store, client: gh }), { ok: true, pushed: false });
  assert.deepEqual(store.doc().flags, {});
  assert.equal(gh.puts, 0);
});

test('a flag written on one device and addressed on the other comes back addressed', async () => {
  const gh = new FakeGitHub();
  const now = clock(new Date(2026, 8, 12, 18, 4));
  const laptop = makeStore({ prefix: 'L', now });
  const phone = makeStore({ prefix: 'P', now });
  const flag = laptop.addFlag('The coach button is too small', { look: 'night' });
  await syncOnce({ store: laptop, client: gh });
  await syncOnce({ store: phone, client: gh });
  assert.equal(phone.doc().flags[flag.id].text, 'The coach button is too small');
  assert.deepEqual(gh.file.doc.flags[flag.id].ctx, { look: 'night' });
  now.advance(60000);
  phone.addressFlag(flag.id);
  await syncOnce({ store: phone, client: gh });
  await syncOnce({ store: laptop, client: gh });
  assert.equal(laptop.doc().flags[flag.id].status, 'archived');
  assert.ok(sameDoc(laptop.doc(), phone.doc()));
});
