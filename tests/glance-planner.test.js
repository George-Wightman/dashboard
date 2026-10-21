import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handleGlance, GLANCE_FILE } from '../planner/glance.js';
import { fixture } from './helpers.js';

process.env.TZ = 'Europe/London';
const KEY = 'g'.repeat(43);
const sha256Hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');

function github({ glance = JSON.stringify({ sha256: sha256Hex(KEY) }), data = JSON.stringify(fixture({ items: [{ id: 't', type: 'task', title: 'Email the NCA', date: '2026-10-21', order: 1 }] })) } = {}) {
  const seen = [];
  const request = (url, init) => {
    seen.push({ url, method: init.method, accept: init.headers.Accept });
    if (url.endsWith(`/contents/${GLANCE_FILE}`)) return glance == null ? { status: 404, text: '{}' } : { status: 200, text: JSON.stringify({ content: b64(glance) }) };
    if (url.endsWith('/contents/data.json')) return { status: 200, text: data };
    return { status: 404, text: '{}' };
  };
  return { request, seen };
}
const ask = (gh, req) => JSON.parse(handleGlance({ req, repo: 'o/r', token: 'T', request: gh.request, sha256Hex, now: new Date(2026, 9, 21, 8, 0) }));

test('with the right key the widgets get the summary, and the data is only ever read', () => {
  const gh = github();
  const g = ask(gh, { glance: KEY });
  assert.equal(g.day, '2026-10-21');
  assert.match(g.tiles.day.lines.join('\n'), /1 any time today/);
  assert.ok(gh.seen.every((r) => r.method === 'GET'));
  assert.equal(gh.seen.at(-1).accept, 'application/vnd.github.raw+json', 'the raw file, whatever its size');
});

test('a wrong or missing key, or the widgets switched off, gets a refusal and never the data', () => {
  const gh = github();
  assert.match(ask(gh, { glance: 'w'.repeat(43) }).error, /refused the widget key/);
  assert.match(ask(gh, { glance: 'short' }).error, /key is missing/);
  assert.ok(!gh.seen.some((r) => r.url.endsWith('data.json')));
  assert.match(ask(github({ glance: null }), { glance: KEY }).error, /switched off/);
});

test('the planner\'s doPost answers the widgets from Apps Script, and still relays everything else', async () => {
  const { createPlanner } = await import('../planner/gas.js');
  const { FakeRepo, appsScript } = await import('./planner-apps.js');
  const { FakeCalendar } = await import('./planner-fakes.js');
  const repo = new FakeRepo(fixture({ items: [{ id: 't', type: 'task', title: 'Email the NCA', date: '2026-10-21', order: 1 }] }));
  repo.others.set(GLANCE_FILE, { text: JSON.stringify({ sha256: sha256Hex(KEY) }), sha: 'g1' });
  const env = appsScript({ cal: new FakeCalendar(), repo, props: { GITHUB_TOKEN: 'ghp_dummy_token_1234567890', SYNC_REPO: 'o/r' } });
  const ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (text) => { const o = { text, setMimeType: (m) => { o.mime = m; return o; } }; return o; } };
  const planner = createPlanner({ ...env, ContentService, now: () => new Date(2026, 9, 21, 8, 0) });
  const out = planner.relay({ postData: { contents: JSON.stringify({ glance: KEY }) } });
  assert.equal(out.mime, 'json');
  const g = JSON.parse(out.text);
  assert.equal(g.day, '2026-10-21', out.text.slice(0, 200));
  assert.ok(g.tiles.fuel);
  const relayed = JSON.parse(planner.relay({ postData: { contents: JSON.stringify({ key: 'z'.repeat(43), path: '/repos/o/r/contents/data.json' }) } }).text);
  assert.match(relayed.error, /relay/);
});
