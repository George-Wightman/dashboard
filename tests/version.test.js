import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REPO, HISTORY_URL, runningBuild, lastModifiedOf, buildStamp, commitSubject, parseCommits, recentChanges,
  versionStatus, createUpdater,
} from '../js/version.js';

const local = (...parts) => new Date(...parts);
const ms = (d) => d.getTime();

test('the running build is the served Last-Modified, unless it is really just the load time', () => {
  const loadedAt = ms(local(2026, 8, 13, 9, 0, 0));
  // document.lastModified's own format: MM/DD/YYYY hh:mm:ss, local time.
  assert.deepEqual(runningBuild('09/13/2026 08:08:07', loadedAt), local(2026, 8, 13, 8, 8, 7));
  assert.equal(runningBuild('09/13/2026 09:00:02', loadedAt), null);
  assert.equal(runningBuild('', loadedAt), null);
  assert.equal(runningBuild(undefined, loadedAt), null);
});

test('an HTTP Last-Modified header parses, and anything else is null', () => {
  assert.equal(ms(lastModifiedOf('Sun, 13 Sep 2026 07:08:07 GMT')), Date.UTC(2026, 8, 13, 7, 8, 7));
  assert.equal(lastModifiedOf(null), null);
  assert.equal(lastModifiedOf('soon'), null);
});

test('a build stamp is the day, the month and the time', () => {
  assert.equal(buildStamp(local(2026, 8, 13, 8, 8)), '13 Sep, 08:08');
  assert.equal(buildStamp(local(2026, 0, 2, 23, 5)), '2 Jan, 23:05');
});

test("a commit's title is its first line, and GitHub's list becomes { date, title }", () => {
  assert.equal(commitSubject('Fix the thing\n\nA long note.'), 'Fix the thing');
  assert.equal(commitSubject(undefined), '');
  const list = [{ commit: { message: 'Add versions\n\nWhy.', committer: { date: '2026-09-13T08:00:00Z' }, author: { date: '2026-09-12T08:00:00Z' } } }];
  assert.deepEqual(parseCommits(list), [{ date: new Date('2026-09-13T08:00:00Z'), title: 'Add versions' }]);
  assert.throws(() => parseCommits({ message: 'rate limited' }), /unexpected reply/);
});

test('recent changes come from the public repo, never with a key, and a failure throws', async () => {
  let seen;
  const fetch = async (url, init) => {
    seen = { url, init };
    return { ok: true, json: async () => [{ commit: { message: 'One', committer: { date: '2026-09-13T08:00:00Z' } } }] };
  };
  assert.deepEqual(await recentChanges({ fetch, count: 3 }), [{ date: new Date('2026-09-13T08:00:00Z'), title: 'One' }]);
  assert.equal(seen.url, `https://api.github.com/repos/${REPO}/commits?per_page=3`);
  assert.deepEqual(Object.keys(seen.init.headers), ['Accept']);
  await assert.rejects(recentChanges({ fetch: async () => ({ ok: false, status: 403 }) }), /GitHub 403/);
  assert.equal(HISTORY_URL, 'https://github.com/George-Wightman/dashboard/commits/main');
});

test('the status line: unknown, offline, update, up to date, and still publishing', () => {
  const running = local(2026, 8, 12, 23, 0);
  const live = local(2026, 8, 13, 8, 8);
  assert.equal(versionStatus({ running: null, live }).kind, 'unknown');
  assert.deepEqual(versionStatus({ running, live: null, online: false }),
    { kind: 'unknown', text: "Running the 12 Sep, 23:00 build. Offline, so can't check for a newer one." });
  assert.match(versionStatus({ running, live: null, online: true }).text, /Couldn't reach the site/);
  assert.deepEqual(versionStatus({ running, live }),
    { kind: 'update', text: 'Update ready: this device has the 12 Sep, 23:00 build, and the newest is 13 Sep, 08:08.' });
  assert.deepEqual(versionStatus({ running: live, live, newest: local(2026, 8, 13, 7, 0) }),
    { kind: 'current', text: 'Up to date: running the 13 Sep, 08:08 build, the newest published.' });
  const publishing = versionStatus({ running: live, live, newest: local(2026, 8, 13, 8, 20) });
  assert.equal(publishing.kind, 'publishing');
  assert.match(publishing.text, /A change from 13 Sep, 08:20 is still being published\./);
});

// A fake site answering HEAD with a Last-Modified, and a fake service worker that answers
// 'refresh' the way sw.js does.
function site(lastModified) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (site.down) throw new TypeError('Failed to fetch');
    return { ok: true, headers: new Map([['last-modified', lastModified()]]) };
  };
  return { fetch, calls };
}

function worker(ok = true) {
  const messages = [];
  return {
    messages,
    controller: { postMessage(message, [port]) { messages.push(message); port.postMessage({ ok }); } },
  };
}

test('a newer build live is cached whole, then offered once', async () => {
  let lm = 'Sat, 12 Sep 2026 22:00:00 GMT';
  const { fetch, calls } = site(() => lm);
  const sw = worker();
  let offers = 0;
  let t = 0;
  const updater = createUpdater({
    running: lastModifiedOf('Sat, 12 Sep 2026 22:00:00 GMT'), fetch, worker: sw, now: () => t, onReady: () => { offers++; },
  });

  assert.equal((await updater.check()).ready, false);
  assert.equal(calls[0].url, './');
  assert.equal(calls[0].init.method, 'HEAD');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(sw.messages.length, 0);

  lm = 'Sun, 13 Sep 2026 07:08:07 GMT';
  t = 30 * 1000;
  await updater.check(); // inside the gap: not asked
  assert.equal(calls.length, 1);
  t = 61 * 1000;
  const state = await updater.check();
  assert.equal(state.ready, true);
  assert.equal(ms(state.live), Date.UTC(2026, 8, 13, 7, 8, 7));
  assert.deepEqual(sw.messages, [{ type: 'refresh' }]);
  assert.equal(offers, 1);

  t = 200 * 1000;
  await updater.check();
  assert.equal(sw.messages.length, 1);
  assert.equal(offers, 1);

  // Another deploy before the reload: cached again, so the reload opens the newest.
  lm = 'Sun, 13 Sep 2026 07:30:00 GMT';
  t = 300 * 1000;
  assert.equal((await updater.check()).ready, true);
  assert.equal(sw.messages.length, 2);
  assert.equal(offers, 2);
  let reloaded = 0;
  await updater.apply(() => { reloaded++; });
  assert.equal(sw.messages.length, 2, 'already cached: apply reloads straight away');
  assert.equal(reloaded, 1);
});

test('a failed refresh is not offered, and the next check tries again', async () => {
  const { fetch } = site(() => 'Sun, 13 Sep 2026 07:08:07 GMT');
  const sw = worker(false);
  let offers = 0;
  const updater = createUpdater({
    running: lastModifiedOf('Sat, 12 Sep 2026 22:00:00 GMT'), fetch, worker: sw, onReady: () => { offers++; },
  });
  assert.equal((await updater.check({ gap: 0 })).ready, false);
  assert.equal((await updater.check({ gap: 0 })).ready, false);
  assert.equal(sw.messages.length, 2);
  assert.equal(offers, 0);
});

test("the same build, an unknown running build, or an unreachable site never offers anything", async () => {
  const same = 'Sun, 13 Sep 2026 07:08:07 GMT';
  const sw = worker();
  const offers = [];
  for (const [running, fetch] of [
    [lastModifiedOf(same), site(() => same).fetch],
    [null, site(() => same).fetch],
    [lastModifiedOf('Sat, 12 Sep 2026 22:00:00 GMT'), async () => { throw new TypeError('offline'); }],
  ]) {
    const state = await createUpdater({ running, fetch, worker: sw, onReady: () => offers.push(1) }).check();
    assert.equal(state.ready, false);
  }
  assert.equal(sw.messages.length, 0);
  assert.equal(offers.length, 0);
});

test('overlapping checks share one request, and { gap: 0 } always asks', async () => {
  const { fetch, calls } = site(() => 'Sun, 13 Sep 2026 07:08:07 GMT');
  const updater = createUpdater({ running: lastModifiedOf('Sun, 13 Sep 2026 07:08:07 GMT'), fetch, now: () => 0 });
  await Promise.all([updater.check(), updater.check(), updater.check()]);
  assert.equal(calls.length, 1);
  await updater.check({ gap: 0 });
  assert.equal(calls.length, 2);
});

test('apply caches the new version first if it is not already, then reloads', async () => {
  const sw = worker();
  const order = [];
  sw.controller.postMessage = (message, [port]) => { order.push('refresh'); port.postMessage({ ok: true }); };
  const updater = createUpdater({ running: null, fetch: site(() => null).fetch, worker: sw });
  await updater.apply(() => order.push('reload'));
  assert.deepEqual(order, ['refresh', 'reload']);
  // With no service worker in charge, a reload goes to the site anyway.
  const bare = [];
  await createUpdater({ running: null, fetch: site(() => null).fetch }).apply(() => bare.push('reload'));
  assert.deepEqual(bare, ['reload']);
});

test('a failed complete update preserves the open page and can be retried', async () => {
  const sw = worker();
  let downloaded = false, reloaded = false;
  sw.controller.postMessage = (_, [port]) => port.postMessage({ ok: downloaded });
  const updater = createUpdater({ running: null, worker: sw });
  assert.equal(await updater.apply(() => { reloaded = true; }), false);
  assert.equal(reloaded, false);
  assert.match(updater.state().error, /complete update/);
  downloaded = true;
  assert.equal(await updater.apply(() => { reloaded = true; }), true);
  assert.equal(reloaded, true);
  assert.equal(updater.state().error, undefined);
});
