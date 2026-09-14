process.env.TZ = 'UTC'; // the sandbox's zone; the tool must count days in London time itself

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main, USAGE } from '../claude/cli.js';
import { FakeGitHub, ids, fixture } from './helpers.js';

const KEY = 'github_pat_TESTKEY0123456789abcdef';
const CONFIG = JSON.stringify({ token: KEY, repo: 'George-Wightman/dashboard-sync', dayStartHour: 4, timeZone: 'Europe/London' });
const MORNING = () => new Date('2026-09-13T08:00:00Z'); // Sunday, 09:00 in London

function run(argv, { remote = new FakeGitHub(), stdin = '', now = MORNING, config = CONFIG, env = {} } = {}) {
  return main({
    argv: ['--config', 'config.json', ...argv], readText: () => config, readStdin: async () => stdin,
    makeClient: () => remote, now, newId: ids('n'), env,
  });
}

test('usage: no config, help, and an unknown command', async () => {
  const none = await main({ argv: ['today'], readText: () => CONFIG, readStdin: async () => '' });
  assert.equal(none.code, 1);
  assert.match(none.text, /^Missing --config/);
  assert.deepEqual(await run(['help']), { code: 0, text: USAGE });
  const unknown = await run(['fly']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.text, /^Unknown command "fly"\./);
  assert.match(USAGE, /Ops: task · habit · target · goal · milestone · plan · done · undone · log · edit · archive · accept · dismiss · flag · undo · planner · off · brief/);
});

test('a bad config is a sentence, not a stack trace', async () => {
  const r = await run(['today'], { config: '{"repo":"a/b"}' });
  assert.deepEqual(r, { code: 1, text: "The skill's config.json has no token" });
  const missing = await main({ argv: ['--config', 'x.json', 'today'], readText: () => { throw new Error('ENOENT'); }, readStdin: async () => '' });
  assert.equal(missing.code, 1);
  assert.match(missing.text, /^Can't read the skill's config\.json/);
});

test('a read reads and never pushes', async () => {
  const remote = new FakeGitHub();
  const r = await run(['today'], { remote });
  assert.equal(r.code, 0);
  assert.match(r.text, /^Today is Sunday 13 September \(2026-09-13\) · 0 of 0 done\nNothing on today\.$/);
  assert.equal(remote.puts, 0);
});

test('apply runs every op, logs each as a change, pushes once, and prints what landed', async () => {
  const remote = new FakeGitHub();
  const r = await run(['apply'], {
    remote,
    stdin: JSON.stringify([{ op: 'task', title: 'Email Sarah', date: 'tomorrow' }, { op: 'habit', title: 'Read' }]),
  });
  assert.equal(r.code, 0);
  assert.equal(r.text, [
    'Added task "Email Sarah" for Mon 14 Sep · #n1',
    'Added habit "Read" (every day) · #n3',
    'Saved to GitHub — the laptop and phone pick it up at their next sync.',
  ].join('\n'));
  assert.equal(remote.puts, 1);
  const doc = remote.file.doc;
  assert.equal(doc.items.n1.source, 'claude');
  const summaries = Object.values(doc.changes).map((c) => c.summary).sort();
  assert.deepEqual(summaries, ['Added habit "Read" (every day)', 'Added task "Email Sarah" for Mon 14 Sep']);
});

test('one bad op and nothing is changed', async () => {
  const remote = new FakeGitHub();
  const r = await run(['apply'], { remote, stdin: JSON.stringify([{ op: 'task', title: 'A' }, { op: 'task' }]) });
  assert.equal(r.code, 1);
  assert.equal(r.text, 'Nothing was changed. Op 2 of 2 (task) failed: A task needs a title');
  assert.equal(remote.puts, 0);
  const bad = await run(['apply'], { remote, stdin: 'add a task please' });
  assert.deepEqual(bad, { code: 1, text: 'apply needs JSON on stdin: one op object, or a list of them' });
});

test('nothing to change means nothing pushed', async () => {
  const remote = new FakeGitHub();
  remote.file = { doc: fixture({ items: [{ id: 'task1', type: 'task', title: 'A', date: '2026-09-13' }] }), sha: 's0' };
  const r = await run(['apply'], { remote, stdin: '{"op":"undone","id":"task1"}' });
  assert.deepEqual(r, { code: 0, text: '"A" was already unticked for today\nNothing needed changing.' });
  assert.equal(remote.puts, 0);
});

test('the day is counted in London time, whatever the sandbox says', async () => {
  // 03:30 UTC is 04:30 in London (BST): already Sunday there, still Saturday by UTC's clock.
  const r = await run(['today'], { now: () => new Date('2026-09-13T03:30:00Z'), env: process.env });
  assert.match(r.text, /\(2026-09-13\)/);
  process.env.TZ = 'UTC';
});

test('GitHub failures are reported, and the key never shows', async () => {
  const refusing = { get: async () => { throw new Error(`GitHub 401: Bad credentials ${KEY}`); }, put: async () => 'x' };
  const r = await run(['today'], { remote: refusing });
  assert.equal(r.code, 2);
  assert.match(r.text, /^Couldn't read the dashboard: GitHub 401: Bad credentials \[hidden\]$/);
  assert.ok(!r.text.includes(KEY));
  const failingPut = new FakeGitHub();
  failingPut.put = async () => { throw new Error('GitHub 500'); };
  const p = await run(['apply'], { remote: failingPut, stdin: '{"op":"task","title":"A"}' });
  assert.deepEqual(p, { code: 2, text: 'Nothing was saved: GitHub 500' });
});

test('dash.mjs runs main and exits with its code', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const r = spawnSync(process.execPath, ['claude/dash.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^Missing --config/);
});
