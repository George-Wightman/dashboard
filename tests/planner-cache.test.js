// Fewer web calls (planner/cache.js): on 24 Nov 2026 the planner ran out of Google's 20,000 a day, the
// phone's Hebrew widget asking every few minutes at about ten calls an answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { textCache, cachedRequest, addFetches } from '../planner/cache.js';
import { GLANCE_FILE } from '../planner/glance.js';
import { fixture } from './helpers.js';

process.env.TZ = 'Europe/London';
const KEY = 'g'.repeat(43);
const sha256Hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// Apps Script's script cache, in memory, with its 100 KB an entry.
export function fakeCache() {
  const map = new Map();
  return {
    map,
    get: (k) => (map.has(k) ? map.get(k) : null),
    getAll: (keys) => Object.fromEntries(keys.filter((k) => map.has(k)).map((k) => [k, map.get(k)])),
    put: (k, v) => { if (Buffer.byteLength(v) > 100 * 1024) throw new Error('too big'); map.set(k, v); },
    putAll: (o) => { for (const [k, v] of Object.entries(o)) { if (Buffer.byteLength(v) > 100 * 1024) throw new Error('too big'); map.set(k, v); } },
  };
}

test('text bigger than one cache entry is kept in parts, and a missing part reads as nothing', () => {
  const raw = fakeCache();
  const c = textCache(raw, sha256Hex);
  const big = 'ש✓'.repeat(60000);
  c.put('code', big, 600);
  assert.equal(c.get('code'), big);
  assert.equal(c.get('other'), null);
  raw.map.delete([...raw.map.keys()].find((k) => k.endsWith('#1')));
  assert.equal(c.get('code'), null);
  assert.equal(textCache(null).get('code'), null);
});

test('slow files are answered from the cache; everything else, and anything not a 200, goes through', () => {
  const c = textCache(fakeCache(), sha256Hex);
  const seen = [];
  const request = (url) => { seen.push(url); return url.includes('missing') ? { status: 404, text: '' } : { status: 200, text: `got ${url}` }; };
  const r = cachedRequest(request, c, (url) => (url.includes('map/') ? 3600 : 0));
  assert.equal(r('https://x/map/a.json').text, 'got https://x/map/a.json');
  assert.equal(r('https://x/map/a.json').text, 'got https://x/map/a.json');
  r('https://x/data.json'); r('https://x/data.json');
  r('https://x/map/missing.json'); r('https://x/map/missing.json');
  r('https://x/map/a.json', { method: 'PUT' });
  assert.deepEqual(seen, ['https://x/map/a.json', 'https://x/data.json', 'https://x/data.json', 'https://x/map/missing.json', 'https://x/map/missing.json', 'https://x/map/a.json']);
});

test('the day\'s web calls add up by where they came from, and a new day starts again', () => {
  let f = addFetches(null, '2026-11-24', 'widget', 9);
  f = addFetches(f, '2026-11-24', 'timer', 12);
  f = addFetches(f, '2026-11-24', 'widget', 0);
  assert.deepEqual(f, { day: '2026-11-24', total: 21, by: { widget: 9, timer: 12 } });
  assert.deepEqual(addFetches(f, '2026-11-25', 'timer', 3), { day: '2026-11-25', total: 3, by: { timer: 3 } });
});

test('a widget asking again within five minutes costs no web calls, and every execution is counted', async () => {
  const { createPlanner } = await import('../planner/gas.js');
  const { FakeRepo, appsScript } = await import('./planner-apps.js');
  const { FakeCalendar } = await import('./planner-fakes.js');
  const repo = new FakeRepo(fixture({ items: [{ id: 't', type: 'task', title: 'Email the NCA', date: '2026-10-21', order: 1 }] }));
  repo.others.set(GLANCE_FILE, { text: JSON.stringify({ sha256: sha256Hex(KEY) }), sha: 'g1' });
  const env = appsScript({ cal: new FakeCalendar(), repo, props: { GITHUB_TOKEN: 'ghp_dummy_token_1234567890', SYNC_REPO: 'o/r' } });
  const cache = fakeCache();
  let n = 0;
  const counting = { fetch: (...a) => { n += 1; return env.UrlFetchApp.fetch(...a); }, fetchAll: (r) => { n += r.length; return env.UrlFetchApp.fetchAll(r); } };
  const planner = createPlanner({ ...env, UrlFetchApp: counting, CacheService: { getScriptCache: () => cache }, fetchCount: () => n, loadFetches: 1, now: () => new Date(2026, 9, 21, 8, 0) });
  const ask = () => planner.relay({ postData: { contents: JSON.stringify({ glance: KEY }) } });
  const first = JSON.parse(ask());
  assert.equal(first.day, '2026-10-21');
  const made = n;
  assert.ok(made > 0);
  assert.deepEqual(JSON.parse(ask()), first);
  assert.equal(n, made, 'the second answer came from the cache');
  // A wrong key never gets the kept answer.
  assert.match(JSON.parse(planner.relay({ postData: { contents: JSON.stringify({ glance: 'w'.repeat(43) }) } })).error, /refused/);
  const counted = JSON.parse(env.props.get('FETCHES'));
  assert.equal(counted.day, '2026-10-21');
  assert.equal(counted.by.widget, counted.total);
  assert.ok(counted.total >= made + 3, 'each execution counts its own calls plus the loader\'s');
});
