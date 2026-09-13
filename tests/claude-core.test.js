import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, DEFAULT_ZONE } from '../claude/config.js';
import { openSession } from '../claude/session.js';
import { makeClient } from '../claude/github.js';
import { emptyDoc } from '../js/doc.js';
import { FakeGitHub, fixture, clock, ids } from './helpers.js';

const good = { token: 'github_pat_TESTKEY0123456789abcdef', repo: 'George-Wightman/dashboard-sync' };

test('readConfig fills the defaults and explains every mistake, without the key', () => {
  assert.deepEqual(readConfig(JSON.stringify(good)), { ...good, dayStartHour: 4, timeZone: 'Europe/London' });
  assert.equal(DEFAULT_ZONE, 'Europe/London');
  assert.equal(readConfig(JSON.stringify({ ...good, dayStartHour: 5, timeZone: 'Asia/Jerusalem' })).timeZone, 'Asia/Jerusalem');
  assert.equal(readConfig(JSON.stringify({ ...good, token: `  ${good.token}\n` })).token, good.token);
  assert.throws(() => readConfig('{'), /isn't valid JSON/);
  assert.throws(() => readConfig('[]'), /should be an object/);
  assert.throws(() => readConfig(JSON.stringify({ repo: good.repo })), /has no token/);
  assert.throws(() => readConfig(JSON.stringify({ ...good, repo: 'nope' })), /owner\/name/);
  assert.throws(() => readConfig(JSON.stringify({ ...good, dayStartHour: 13 })), /whole hour from 0 to 12/);
  assert.throws(() => readConfig(JSON.stringify({ ...good, timeZone: 'Mars/Olympus' })), /isn't a time zone/);
  assert.throws(() => readConfig(JSON.stringify({ ...good, timeZone: 7 })), /isn't a time zone/);
  assert.throws(() => readConfig(JSON.stringify({ ...good, repo: 'x' })), (e) => !e.message.includes(good.token));
});

test('openSession loads the sync file into a store with the configured day start', async () => {
  const remote = new FakeGitHub();
  remote.file = { doc: fixture({ items: [{ id: 'task1', type: 'task', title: 'A', date: '2026-09-10' }] }), sha: 's0' };
  const now = clock(new Date(2026, 8, 10, 3, 30)); // 03:30
  const s = await openSession({ client: remote, dayStartHour: 3, now, newId: ids('n') });
  assert.equal(s.store.doc().items.task1.title, 'A');
  assert.equal(s.store.today(), '2026-09-10');
  const byDefault = await openSession({ client: remote, now });
  assert.equal(byDefault.store.today(), '2026-09-09'); // before 4am it's still the day before
  assert.equal(s.changed(), false);
});

test("openSession starts empty with no sync file, and refuses one that isn't a dashboard", async () => {
  const none = await openSession({ client: new FakeGitHub(), now: clock() });
  assert.deepEqual(none.store.doc(), emptyDoc());
  const odd = new FakeGitHub();
  odd.file = { doc: { hello: 'world' }, sha: 's0' };
  await assert.rejects(openSession({ client: odd, now: clock() }), /isn't a dashboard document/);
});

test('record logs what a step changed as one change, without the id tail; push writes once', async () => {
  const remote = new FakeGitHub();
  const s = await openSession({ client: remote, now: clock(), newId: ids('n') });
  const r = s.record((store) => {
    const t = store.addItem({ type: 'task', title: 'A', source: 'claude' });
    return `Added task "A" for today · #${t.id}`;
  });
  assert.equal(r.summary, 'Added task "A" for today · #n1');
  assert.equal(r.edits.length, 1);
  const change = Object.values(s.store.doc().changes)[0];
  assert.equal(change.summary, 'Added task "A" for today');
  assert.deepEqual(change.edits.map((e) => e.id), ['n1']);
  assert.equal(s.changed(), true);
  assert.deepEqual(await s.push(), { ok: true, pushed: true });
  assert.equal(remote.puts, 1);
  assert.equal(remote.file.doc.items.n1.title, 'A');
  assert.equal(Object.keys(remote.file.doc.changes).length, 1);
});

test('a step that changes nothing is not logged, and nothing is pushed', async () => {
  const remote = new FakeGitHub();
  const s = await openSession({ client: remote, now: clock() });
  assert.deepEqual(s.record(() => 'Nothing to do').edits, []);
  assert.deepEqual(s.store.doc().changes, {});
  assert.deepEqual(await s.push(), { ok: true, pushed: false });
  assert.equal(remote.puts, 0);
});

test('an unlogged step is still pushed; a failing step throws', async () => {
  const remote = new FakeGitHub();
  const s = await openSession({ client: remote, now: clock(), newId: ids('n') });
  s.record((store) => { store.addItem({ type: 'task', title: 'A' }); return 'x'; }, { log: false });
  assert.deepEqual(s.store.doc().changes, {});
  assert.throws(() => s.record(() => { throw new Error('bad op'); }), /bad op/);
  assert.deepEqual(await s.push(), { ok: true, pushed: true });
  assert.equal(remote.puts, 1);
});

test('push merges with a device that wrote in between', async () => {
  const remote = new FakeGitHub();
  const mine = { id: 'mine', type: 'task', title: 'Mine', date: '2026-09-10' };
  remote.file = { doc: fixture({ items: [mine] }), sha: 's0' };
  const s = await openSession({ client: remote, now: clock(), newId: ids('n') });
  s.record((store) => { store.addItem({ type: 'task', title: 'Claude' }); return 'x'; });
  // The laptop syncs between Claude's read and Claude's write.
  remote.file = { doc: fixture({ items: [mine, { id: 'laptop', type: 'task', title: 'Laptop', date: '2026-09-10' }] }), sha: 's1' };
  assert.equal((await s.push()).ok, true);
  assert.deepEqual(Object.values(remote.file.doc.items).map((i) => i.title).sort(), ['Claude', 'Laptop', 'Mine']);
});

test("makeClient is the app's GitHub client for the configured repo, with Claude's key", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    return { status: 404, ok: false, json: async () => ({}) };
  };
  const client = makeClient({ token: 'tok123456', repo: 'George-Wightman/dashboard-sync', fetch });
  assert.equal(await client.get(), null);
  assert.equal(calls[0].url, 'https://api.github.com/repos/George-Wightman/dashboard-sync/contents/data.json');
  assert.equal(calls[0].auth, 'Bearer tok123456');
});
