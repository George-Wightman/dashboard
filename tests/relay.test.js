import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handleRelay, relayPath, RELAY_FILE } from '../planner/relay.js';
import { relayingFetch } from '../claude/relay.js';
import { readConfig } from '../claude/config.js';
import { createFileStore } from '../claude/files.js';
import { createGitHubClient } from '../js/sync.js';

const KEY = 'k'.repeat(43);
const sha256Hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const URL = 'https://script.google.com/macros/s/AKfy-test_1/exec';

// GitHub as the planner sees it, blocking like UrlFetchApp: request(url, init) → { status, text }.
function github(initial = {}) {
  const files = new Map(Object.entries({ [RELAY_FILE]: JSON.stringify({ sha256: sha256Hex(KEY) }), ...initial }));
  const seen = [];
  let n = 0;
  const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
  const request = (url, init = {}) => {
    const method = init.method ?? 'GET';
    seen.push({ url, method, auth: init.headers?.Authorization });
    const path = decodeURIComponent(String(url).split('/contents/')[1].split('?')[0]);
    if (method === 'GET') {
      return files.has(path)
        ? { status: 200, text: JSON.stringify({ content: b64(files.get(path)), sha: `sha-${path}`, encoding: 'base64' }) }
        : { status: 404, text: '{"message":"Not Found"}' };
    }
    if (method === 'PUT') {
      files.set(path, Buffer.from(JSON.parse(init.body).content, 'base64').toString('utf8'));
      return { status: 200, text: JSON.stringify({ content: { sha: `sha${++n}` } }) };
    }
    files.delete(path);
    return { status: 200, text: '{}' };
  };
  // The same GitHub reached directly, as a fetch.
  const fetch = async (url, init = {}) => { const r = request(url, init); return new Response(r.text, { status: r.status }); };
  return { request, fetch, files, seen };
}

const ask = (gh, req) => JSON.parse(handleRelay({ raw: JSON.stringify(req), repo: 'o/r', token: 'PLANNER_TOKEN', request: gh.request, sha256Hex }));

test('relayPath only lets the sync repo\'s files through', () => {
  assert.equal(relayPath('/repos/o/r/contents/data.json', 'o/r'), '/repos/o/r/contents/data.json');
  assert.equal(relayPath('/repos/o/r/contents/handoffs/2026-10-20-a.md', 'o/r'), '/repos/o/r/contents/handoffs/2026-10-20-a.md');
  assert.equal(relayPath('/repos/o/r/contents/data.json?ref=main', 'o/r'), '/repos/o/r/contents/data.json?ref=main');
  assert.equal(relayPath(`/repos/o/r/git/blobs/${'a'.repeat(40)}`, 'o/r'), `/repos/o/r/git/blobs/${'a'.repeat(40)}`);
  for (const bad of ['/repos/o/other/contents/data.json', '/repos/o/r/contents/../../x', '/repos/o/r/collaborators', '/user', '/repos/o/r/contents/a?per_page=1&x=2', '/repos/o/r/hooks']) {
    assert.equal(relayPath(bad, 'o/r'), null, bad);
  }
});

test('the relay forwards a request with the planner\'s own key', async () => {
  const gh = github({ 'data.json': '{"a":1}' });
  const reply = await ask(gh, { key: KEY, method: 'GET', path: '/repos/o/r/contents/data.json' });
  assert.equal(reply.status, 200);
  assert.equal(Buffer.from(JSON.parse(reply.body).content, 'base64').toString(), '{"a":1}');
  assert.equal(gh.seen.at(-1).auth, 'Bearer PLANNER_TOKEN');
});

test('the relay refuses a wrong key, a missing relay.json, another repo and other methods, without reaching them', async () => {
  const gh = github({ 'data.json': '{}' });
  assert.match((await ask(gh, { key: 'x'.repeat(43), path: '/repos/o/r/contents/data.json' })).error, /refused the key/);
  assert.match((await ask(gh, { path: '/repos/o/r/contents/data.json' })).error, /key is missing/);
  assert.match((await ask(gh, { key: KEY, method: 'POST', path: '/repos/o/r/contents/data.json' })).error, /doesn't forward POST/);
  assert.match((await ask(gh, { key: KEY, path: '/repos/o/x/contents/data.json' })).error, /only reaches/);
  assert.ok(gh.seen.every((s) => s.url.endsWith(`/contents/${RELAY_FILE}`)), 'nothing but relay.json was read');
  gh.files.delete(RELAY_FILE);
  assert.match((await ask(gh, { key: KEY, path: '/repos/o/r/contents/data.json' })).error, /switched off/);
  assert.match(await handleRelay({ raw: 'nope', repo: 'o/r', token: 't', request: gh.request, sha256Hex }), /needs JSON/);
});

// The tool's side, end to end: a proxy that refuses GitHub, the relay answering instead.
function sandbox({ block = 403 } = {}) {
  const gh = github({ 'data.json': '{"items":{}}' });
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push(String(url));
    if (url === URL) {
      const text = handleRelay({ raw: opts.body, repo: 'o/r', token: 'PLANNER_TOKEN', request: gh.request, sha256Hex });
      return new Response(text, { status: 200 });
    }
    if (block === 'network') throw new TypeError('fetch failed');
    if (block) return new Response(JSON.stringify({ message: 'Write access to this GitHub API path is not permitted through this proxy' }), { status: block });
    return gh.fetch(url, opts);
  };
  return { gh, calls, fetch };
}

test('when the proxy refuses GitHub, reads and writes go through the relay and land', async () => {
  const sb = sandbox();
  let switched = 0;
  const fetch = relayingFetch({ relayUrl: URL, relayKey: KEY, fetch: sb.fetch, onSwitch: () => switched++ });
  const files = createFileStore({ token: 'CLAUDE', repo: 'o/r', fetch });
  await files.write('handoffs/a.md', 'hello', 'add');
  assert.equal(sb.gh.files.get('handoffs/a.md'), 'hello');
  const client = createGitHubClient({ token: 'CLAUDE', repo: 'o/r', fetch });
  const got = await client.get();
  assert.deepEqual(got.doc, { items: {} });
  await client.put({ items: { a: 1 } }, got.sha);
  assert.equal(sb.gh.files.get('data.json'), '{"items":{"a":1}}');
  assert.equal(switched, 1);
  assert.equal(sb.calls.filter((u) => u.startsWith('https://api.github.com')).length, 1, 'GitHub is tried once, then left alone');
});

test('an unreachable GitHub switches to the relay too; a working one never does', async () => {
  const off = sandbox({ block: 'network' });
  const viaRelay = relayingFetch({ relayUrl: URL, relayKey: KEY, fetch: off.fetch });
  assert.equal((await createFileStore({ token: 'C', repo: 'o/r', fetch: viaRelay }).read('data.json')).text, '{"items":{}}');

  const on = sandbox({ block: null });
  const direct = relayingFetch({ relayUrl: URL, relayKey: KEY, fetch: on.fetch });
  await createFileStore({ token: 'C', repo: 'o/r', fetch: direct }).read('data.json');
  assert.ok(!on.calls.includes(URL));
});

test('a relay refusal reads as its own sentence', async () => {
  const sb = sandbox();
  const fetch = relayingFetch({ relayUrl: URL, relayKey: 'w'.repeat(43), fetch: sb.fetch, force: true });
  await assert.rejects(createFileStore({ token: 'C', repo: 'o/r', fetch }).read('data.json'), /refused the key/);
});

test('config takes the relay address and key together, or neither', () => {
  const base = { token: 'github_pat_x', repo: 'o/r' };
  assert.equal(readConfig(JSON.stringify(base)).relayUrl, null);
  const c = readConfig(JSON.stringify({ ...base, relayUrl: URL, relayKey: KEY }));
  assert.equal(c.relayUrl, URL);
  assert.equal(c.relayKey, KEY);
  assert.throws(() => readConfig(JSON.stringify({ ...base, relayUrl: URL })), /together/);
  assert.throws(() => readConfig(JSON.stringify({ ...base, relayUrl: 'https://evil.example/exec', relayKey: KEY })), /web app address/);
});

test('the planner\'s doPost answers a relay request with its own key, from Apps Script', async () => {
  const { createPlanner } = await import('../planner/gas.js');
  const { FakeRepo, appsScript } = await import('./planner-apps.js');
  const { FakeCalendar } = await import('./planner-fakes.js');
  const repo = new FakeRepo({ schema: 1, items: {} });
  repo.others.set(RELAY_FILE, { text: JSON.stringify({ sha256: sha256Hex(KEY) }), sha: 'r1' });
  const env = appsScript({ cal: new FakeCalendar(), repo, props: { GITHUB_TOKEN: 'ghp_dummy_token_1234567890', SYNC_REPO: 'o/r' } });
  const made = [];
  const ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (text) => { const o = { text, setMimeType: (m) => { o.mime = m; return o; } }; made.push(o); return o; } };
  const planner = createPlanner({ ...env, ContentService });
  const out = planner.relay({ postData: { contents: JSON.stringify({ key: KEY, method: 'GET', path: '/repos/o/r/contents/data.json' }) } });
  assert.equal(out.mime, 'json');
  const reply = JSON.parse(out.text);
  assert.equal(reply.status, 200);
  assert.deepEqual(JSON.parse(Buffer.from(JSON.parse(reply.body).content, 'base64').toString()), { schema: 1, items: {} });
  const refused = JSON.parse(planner.relay({ postData: { contents: JSON.stringify({ key: 'z'.repeat(43), path: '/repos/o/r/contents/data.json' }) } }).text);
  assert.match(refused.error, /refused the key/);
});
