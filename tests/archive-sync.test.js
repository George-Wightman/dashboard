// The archive's readers (docs/superpowers/specs/2026-11-20-archive-design.md): the sync engine every
// device uses, Claude's session and the widgets. Invented records only: the repo is public.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGitHubClient, syncOnce, encodeBase64 } from '../js/sync.js';
import { ARCHIVE_ID, createArchiveLoader, yearDoc } from '../js/archive.js';
import { emptyDoc } from '../js/doc.js';
import { openSession } from '../claude/session.js';
import { handleGlance, GLANCE_FILE } from '../planner/glance.js';
import { FakeGitHub, makeStore, clock, ids } from './helpers.js';

process.env.TZ = 'Europe/London';

const SHA1 = 'a'.repeat(40);
const T = (day, time = '09:00') => `${day}T${time}:00.000Z`;
const rec = (id, day, extra = {}) => ({ id, status: 'active', source: 'me', created: day, archivedOn: null, updated: T(day), ...extra });
const amount = (id, day, n) => rec(id, day, { itemId: null, goalId: 'g1', kind: 'amount', amount: n, day });
const pointer = (files = { 2026: SHA1 }) => rec(ARCHIVE_ID, '2026-11-02', { source: 'planner', files, through: '2026-10-19', lastRun: T('2026-11-02'), lastError: null, moved: 1 });

const OLD = amount('old', '2026-09-01', 3);
const RECENT = amount('recent', '2026-11-03', 2);
const GOAL = rec('g1', '2026-08-01', { title: 'Read ten books', target: 10, order: 1 });
const ARCHIVE_TEXT = JSON.stringify(yearDoc({ logs: { old: OLD } }));
const doc = (logs, extra = {}) => ({ ...emptyDoc(), goals: { g1: GOAL }, logs: Object.fromEntries(logs.map((l) => [l.id, l])), calendar: { [ARCHIVE_ID]: pointer() }, ...extra });

// data.json and the archive's blobs, in memory.
class ArchiveGitHub extends FakeGitHub {
  constructor() { super(); this.blobs = new Map([[SHA1, ARCHIVE_TEXT]]); this.blobReads = 0; this.failBlob = false; }
  async blob(sha) {
    this.blobReads++;
    if (this.failBlob || !this.blobs.has(sha)) throw new Error('GitHub 404');
    return this.blobs.get(sha);
  }
}

// ---- the client --------------------------------------------------------------------------------

test('client.blob reads raw, and decodes GitHub\'s JSON when that is what comes back', async () => {
  const calls = [];
  const text = ARCHIVE_TEXT;
  const answer = { raw: true };
  const fetch = async (url, init) => {
    calls.push({ url, accept: init.headers.Accept });
    if (url.endsWith(`/git/blobs/${SHA1}`)) {
      const body = answer.raw ? text : JSON.stringify({ sha: SHA1, content: encodeBase64(text), encoding: 'base64' });
      return { status: 200, ok: true, text: async () => body, json: async () => JSON.parse(body) };
    }
    return { status: 500, ok: false, text: async () => '{}', json: async () => ({ message: 'boom' }) };
  };
  const client = createGitHubClient({ token: 't', repo: 'o/r', fetch });
  assert.equal(await client.blob(SHA1), text);
  assert.equal(calls[0].url, `https://api.github.com/repos/o/r/git/blobs/${SHA1}`);
  assert.equal(calls[0].accept, 'application/vnd.github.raw+json');
  answer.raw = false; // the relay always answers with GitHub's JSON
  assert.equal(await client.blob(SHA1), text);
  await assert.rejects(client.blob('b'.repeat(40)), /GitHub 500/);
});

// ---- syncOnce ----------------------------------------------------------------------------------

test('syncOnce with an archive pushes the slim document and keeps the whole one locally', async () => {
  const store = makeStore();
  store.replaceDoc(doc([OLD, RECENT]));
  const remote = new ArchiveGitHub();
  const r = await syncOnce({ store, client: remote, archive: createArchiveLoader() });
  assert.deepEqual(r, { ok: true, pushed: true });
  assert.deepEqual(Object.keys(remote.file.doc.logs), ['recent']);
  assert.deepEqual(Object.keys(store.doc().logs).sort(), ['old', 'recent']);
  assert.ok(remote.file.doc.calendar[ARCHIVE_ID]);
});

test('syncOnce merges a new archive in once, and reads it once', async () => {
  const remote = new ArchiveGitHub();
  remote.file = { doc: doc([RECENT]), sha: 'sha0' };
  const store = makeStore();
  const archive = createArchiveLoader();
  const r = await syncOnce({ store, client: remote, archive });
  assert.equal(r.ok, true);
  assert.equal(r.pushed, false, 'nothing new for data.json');
  assert.deepEqual(Object.keys(store.doc().logs).sort(), ['old', 'recent']);
  assert.equal(remote.blobReads, 1);
  const again = await syncOnce({ store, client: remote, archive });
  assert.deepEqual(again, { ok: true, pushed: false });
  assert.equal(remote.blobReads, 1);
  assert.equal(remote.puts, 0);
});

test('syncOnce does not push when the named archive can\'t be read, and still takes in what is new', async () => {
  const remote = new ArchiveGitHub();
  remote.file = { doc: doc([RECENT]), sha: 'sha0' };
  remote.failBlob = true;
  const store = makeStore();
  store.replaceDoc(doc([amount('mine', '2026-11-04', 1)]));
  const r = await syncOnce({ store, client: remote, archive: createArchiveLoader() });
  assert.equal(r.ok, false);
  assert.match(r.error, /archive/);
  assert.equal(remote.puts, 0);
  assert.ok(store.doc().logs.recent, 'the remote change is applied here');
  assert.ok(store.doc().logs.mine, 'and nothing of this device is lost');
});

test('an old app\'s full push is slimmed again by the next new client', async () => {
  const remote = new ArchiveGitHub();
  remote.file = { doc: doc([OLD, RECENT]), sha: 'sha0' };
  const store = makeStore();
  const r = await syncOnce({ store, client: remote, archive: createArchiveLoader() });
  assert.deepEqual(r, { ok: true, pushed: true });
  assert.deepEqual(Object.keys(remote.file.doc.logs), ['recent']);
  assert.deepEqual(Object.keys(store.doc().logs).sort(), ['old', 'recent']);
});

test('without an archive loader, syncOnce is as it was', async () => {
  const remote = new ArchiveGitHub();
  const store = makeStore();
  store.replaceDoc(doc([OLD, RECENT]));
  await syncOnce({ store, client: remote });
  assert.deepEqual(Object.keys(remote.file.doc.logs).sort(), ['old', 'recent']);
  assert.equal(remote.blobReads, 0);
});

// ---- Claude's session --------------------------------------------------------------------------

test('openSession sees archived records, and its push leaves them out of data.json', async () => {
  const remote = new ArchiveGitHub();
  remote.file = { doc: doc([RECENT]), sha: 'sha0' };
  const s = await openSession({ client: remote, now: clock(new Date(2026, 10, 5, 9, 0)), newId: ids('n') });
  assert.deepEqual(Object.keys(s.store.doc().logs).sort(), ['old', 'recent']);
  s.record((store) => { store.addItem({ type: 'task', title: 'Return the library books', date: '2026-11-05' }); return 'Added'; });
  const r = await s.push();
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(remote.file.doc.logs), ['recent']);
  assert.ok(Object.values(remote.file.doc.items).some((i) => i.title === 'Return the library books'));
  assert.equal(remote.blobReads, 1);
});

test('openSession stops when the archive can\'t be read', async () => {
  const remote = new ArchiveGitHub();
  remote.file = { doc: doc([RECENT]), sha: 'sha0' };
  remote.failBlob = true;
  await assert.rejects(openSession({ client: remote, now: clock() }), /archive/);
});

// ---- the widgets -------------------------------------------------------------------------------

const KEY = 'g'.repeat(43);
const sha256Hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

function widgetsGitHub({ failBlob = false } = {}) {
  const data = JSON.stringify(doc([RECENT]));
  const request = (url) => {
    if (url.endsWith(`/contents/${GLANCE_FILE}`)) return { status: 200, text: JSON.stringify({ content: Buffer.from(JSON.stringify({ sha256: sha256Hex(KEY) })).toString('base64') }) };
    if (url.endsWith('/contents/data.json')) return { status: 200, text: data };
    if (url.endsWith(`/git/blobs/${SHA1}`)) return failBlob ? { status: 502, text: '{}' } : { status: 200, text: ARCHIVE_TEXT };
    return { status: 404, text: '{}' };
  };
  return request;
}
const glance = (request) => JSON.parse(handleGlance({ req: { glance: KEY }, repo: 'o/r', token: 'T', request, sha256Hex, now: new Date(2026, 10, 5, 9, 0) }));

test('the widgets count archived logs in goal totals', () => {
  const g = glance(widgetsGitHub());
  assert.deepEqual(g.tiles.goals.lines, ['Read ten books: 50%']);
});

test('the widgets say so when the archive can\'t be read', () => {
  assert.match(glance(widgetsGitHub({ failBlob: true })).error, /archive \(GitHub 502\)/);
});
