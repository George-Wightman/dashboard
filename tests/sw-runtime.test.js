import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { releaseManifest } from '../dev/build-release.mjs';
import { APP_VERSION } from '../js/flags.js';

const ROOT = new URL('../', import.meta.url);
const SCOPE = 'https://example.test/dashboard/';
const hash = (v) => createHash('sha256').update(v).digest('hex');

class Cache {
  entries = new Map();
  key(request) { return typeof request === 'string' ? request : request.url; }
  async match(request) { return this.entries.get(this.key(request))?.clone(); }
  async put(request, response) { this.entries.set(this.key(request), response.clone()); }
  async delete(request) { return this.entries.delete(this.key(request)); }
  async keys() { return [...this.entries.keys()].map((url) => new Request(url)); }
}

function harness() {
  const stores = new Map(), calls = [], clients = [], shown = [], opened = [];
  const caches = {
    keys: async () => [...stores.keys()],
    open: async (key) => { if (!stores.has(key)) stores.set(key, new Cache()); return stores.get(key); },
    delete: async (key) => stores.delete(key),
  };
  let network, manifest, fail = null, handlers;
  function release(marker) {
    const paths = Object.keys(releaseManifest().files);
    network = new Map(paths.map((p) => [new URL(p, SCOPE).href, readFileSync(new URL(p === './' ? 'index.html' : p, ROOT))]));
    network.set(new URL('js/app.js', SCOPE).href, Buffer.from(marker));
    const files = Object.fromEntries(paths.map((p) => [p, hash(network.get(new URL(p, SCOPE).href))]));
    manifest = { files, id: hash(JSON.stringify(files)) };
    network.set(new URL('release.json', SCOPE).href, Buffer.from(JSON.stringify(manifest)));
  }
  function restart() {
    handlers = {};
    const self = { registration: { scope: SCOPE, showNotification: async (title, options) => { shown.push({ title, options }); } },
      location: { origin: 'https://example.test' },
      addEventListener: (n, fn) => { handlers[n] = fn; }, skipWaiting: async () => {},
      clients: { matchAll: async () => clients, claim: async () => {}, openWindow: async (url) => { opened.push(url); } } };
    const fetch = async (input, options) => {
      const url = typeof input === 'string' ? input : input.url;
      calls.push({ url, options });
      if (fail?.(url)) throw new Error('connection lost');
      return new Response(network.get(url) ?? '', { status: network.has(url) ? 200 : 404 });
    };
    vm.runInNewContext(readFileSync(new URL('sw.js', ROOT), 'utf8'), {
      self, caches, fetch, crypto: webcrypto, Request, Response, URL, AbortController, setTimeout, clearTimeout,
    });
  }
  async function event(name, input = {}) {
    let wait;
    handlers[name]({ ...input, waitUntil: (p) => { wait = p; } });
    await wait;
  }
  async function refresh() {
    let reply;
    await event('message', { data: { type: 'refresh' }, ports: [{ postMessage: (m) => { reply = m.ok; } }] });
    return reply;
  }
  async function request(path, clientId, resultingClientId = '') {
    let result;
    await event('fetch', { clientId, resultingClientId,
      request: { url: new URL(path, SCOPE).href, method: 'GET', mode: resultingClientId ? 'navigate' : 'cors' },
      respondWith: (p) => { result = p; } });
    return result ? await result : undefined;
  }
  release('release one'); restart();
  return { stores, caches, calls, clients, shown, opened, release, restart, event, refresh, request,
    fail: (fn) => { fail = fn; }, corrupt: (path, text) => network.set(new URL(path, SCOPE).href, text),
    name: () => `${APP_VERSION}-${manifest.id}` };
}

test('checked-in release manifest matches all current assets', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('release.json', ROOT), 'utf8')), releaseManifest(), 'run npm run build-release');
});

test('refresh caches the complete shell; ordinary reads never revalidate individual modules', async () => {
  const h = harness();
  assert.equal(await h.refresh(), true);
  const downloadCalls = h.calls.length;
  await h.request('./?fakegemini', '', 'tab');
  assert.equal(await (await h.request('js/app.js', 'tab')).text(), 'release one');
  assert.equal(h.calls.length, downloadCalls);
  assert.ok(h.calls.filter((c) => !c.url.endsWith('release.json')).every((c) => c.options.cache === 'reload'));
});

test('open pages remain on one release across refresh and worker suspension; navigation uses the new one', async () => {
  const h = harness();
  await h.refresh();
  await h.request('./', '', 'old');
  h.clients.push({ id: 'old', url: SCOPE });
  h.release('release two');
  await h.refresh();
  h.restart();
  assert.equal(await (await h.request('js/app.js', 'old')).text(), 'release one');
  await h.request('./', '', 'new');
  assert.equal(await (await h.request('js/app.js', 'new')).text(), 'release two');
});

test('partial downloads and hash mismatches do not publish a mixed release', async () => {
  const h = harness();
  await h.refresh();
  const first = h.name();
  h.release('release two');
  h.fail((url) => url.endsWith('/js/data.js'));
  assert.equal(await h.refresh(), false);
  await h.request('./', '', 'tab');
  assert.equal(await (await h.request('js/app.js', 'tab')).text(), 'release one');
  h.fail(null);
  h.corrupt('js/data.js', 'a file from yet another deployment');
  assert.equal(await h.refresh(), false);
  const meta = await h.caches.open('today-dashboard-meta');
  assert.equal(await (await meta.match(new URL('__cache/active', SCOPE).href)).text(), first);
});

test('activation deletes only obsolete dashboard caches, preserving neighbouring apps', async () => {
  const h = harness();
  await h.caches.open('hebrew-v1');
  await h.caches.open('dash-v8');
  await h.refresh();
  await h.event('activate');
  assert.equal(h.stores.has('hebrew-v1'), true);
  assert.equal(h.stores.has('dash-v8'), false);
  assert.equal(h.stores.has(h.name()), true);
});

test('a missing cached file fails closed instead of mixing in the current deployment', async () => {
  const h = harness();
  await h.refresh();
  const cache = await h.caches.open(h.name());
  await cache.delete(new URL('js/app.js', SCOPE).href);
  assert.equal((await h.request('js/app.js', 'tab')).status, 503);
  assert.equal(await h.request('https://other.test/js/app.js', 'tab'), undefined);
  assert.equal(await h.request('../hebrew/index.html', 'tab'), undefined);
});

// ---- Check-in pings ----------------------------------------------------------------------------

test('a ping shows as a notification carrying where it leads', async () => {
  const h = harness();
  const payload = { title: 'Check-in', body: '"MILLRACE" isn\'t ticked — what happened?', url: './?checkin=reflect%3A2026-09-24%3At1', tag: 'reflect:2026-09-24:t1' };
  await h.event('push', { data: { json: () => payload, text: () => JSON.stringify(payload) } });
  assert.equal(h.shown.length, 1);
  assert.equal(h.shown[0].title, 'Check-in');
  assert.equal(h.shown[0].options.body, payload.body);
  assert.equal(h.shown[0].options.tag, payload.tag);
  assert.deepEqual(JSON.parse(JSON.stringify(h.shown[0].options.data)), { url: payload.url }); // another realm's object
  await h.event('push', { data: { json: () => { throw new Error('not json'); }, text: () => 'plain words' } });
  assert.equal(h.shown[1].title, 'Today');
  assert.equal(h.shown[1].options.body, 'plain words');
});

test('a tap opens the app at the check-in, or brings the open one to it', async () => {
  const h = harness();
  let closed = false;
  const notification = { data: { url: './?checkin=reflect%3A2026-09-24%3At1' }, close: () => { closed = true; } };
  await h.event('notificationclick', { notification });
  assert.equal(closed, true);
  assert.deepEqual(h.opened, [`${SCOPE}?checkin=reflect%3A2026-09-24%3At1`]);
  const posted = [];
  let focused = false;
  h.clients.push({ id: 'tab', url: SCOPE, focus: async () => { focused = true; }, postMessage: (m) => posted.push(m) });
  await h.event('notificationclick', { notification });
  assert.equal(focused, true);
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [{ type: 'open-checkin', url: `${SCOPE}?checkin=reflect%3A2026-09-24%3At1` }]);
  assert.equal(h.opened.length, 1, 'no second window');
});
