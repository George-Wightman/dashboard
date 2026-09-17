process.env.TZ = 'UTC'; // the sandbox's zone; the tool must count days in London time itself

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main, USAGE } from '../claude/cli.js';
import { createFileStore } from '../claude/files.js';
import { FakeGitHub, ids, fixture, fakeApi } from './helpers.js';

const KEY = 'github_pat_TESTKEY0123456789abcdef';
const CONFIG = JSON.stringify({ token: KEY, repo: 'George-Wightman/dashboard-sync', dayStartHour: 4, timeZone: 'Europe/London' });
const MORNING = () => new Date('2026-09-13T08:00:00Z'); // Sunday, 09:00 in London

// The sync repo's other files, in memory, so the handoffs and the trail can be read back.
function repoFiles(initial = {}) {
  const api = fakeApi(initial);
  const store = createFileStore({ token: 'x', repo: 'o/r', fetch: api });
  store.raw = api.files;
  return store;
}

function run(argv, { remote = new FakeGitHub(), stdin = '', now = MORNING, config = CONFIG, env = {}, files = repoFiles() } = {}) {
  return main({
    argv: ['--config', 'config.json', ...argv], readText: () => config, readStdin: async () => stdin,
    makeClient: () => remote, makeFiles: () => files, now, newId: ids('n'), env,
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
  assert.match(USAGE, /Ops: task · habit · target · goal · milestone · plan · done · undone · log · edit · archive · accept · dismiss · flag · handoff · undo · planner · off · brief/);
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

test('reference prints the current reference, from wherever run.sh says it is', async () => {
  const REF = '# Dashboard tool reference\n\nthe live one\n';
  const r = await main({
    argv: ['--config', 'config.json', '--reference', 'live/reference.md', 'reference'],
    readText: (path) => (path === 'live/reference.md' ? REF : CONFIG),
    readStdin: async () => '', makeClient: () => new FakeGitHub(), now: MORNING, newId: ids('n'), env: {},
  });
  assert.equal(r.code, 0);
  assert.equal(r.text, REF);
});

test("reference says so plainly when it can't be read", async () => {
  const r = await main({
    argv: ['--config', 'config.json', '--reference', 'gone.md', 'reference'],
    readText: (path) => { if (path === 'gone.md') throw new Error('ENOENT'); return CONFIG; },
    readStdin: async () => '', makeClient: () => new FakeGitHub(), now: MORNING, newId: ids('n'), env: {},
  });
  assert.equal(r.code, 1);
  assert.match(r.text, /^Can't read the current reference/);
});

test('reference without run.sh to point the way says what is missing', async () => {
  const r = await run(['reference']);
  assert.equal(r.code, 1);
  assert.match(r.text, /wasn't told where the current reference is/);
});

test('--build is taken and changes nothing else about a read', async () => {
  const r = await run(['today', '--build', 'abc1234']);
  assert.equal(r.code, 0);
  assert.match(r.text, /^Today is Sunday 13 September/);
});

test('a handoff of 5000 characters is written whole, and nothing is cut', async () => {
  const files = repoFiles();
  const text = `${'y'.repeat(5000)}
and a line after it`;
  const r = await run(['apply', '--build', 'abc1234'], {
    files, stdin: JSON.stringify({ op: 'handoff', title: 'Stale docs', text }),
  });
  assert.equal(r.code, 0);
  assert.match(r.text, /Written to handoffs\/2026-09-13-0800-stale-docs\.md/);
  assert.match(r.text, new RegExp(`${text.length} characters, none of them cut`));
  const written = files.raw.get('handoffs/2026-09-13-0800-stale-docs.md');
  assert.ok(written.endsWith(`${text}\n`), 'the text is there in full');
  assert.match(written, /\ntool: abc1234\n/);
});

test('a handoff changes nothing in the document, so nothing is pushed', async () => {
  const remote = new FakeGitHub();
  await run(['apply'], { remote, stdin: JSON.stringify({ op: 'handoff', title: 'A note', text: 'body' }) });
  assert.equal(remote.puts, 0);
});

test('a handoff needs a title and text, and says which is missing', async () => {
  const bad = await run(['apply'], { stdin: JSON.stringify({ op: 'handoff', text: 'body' }) });
  assert.equal(bad.code, 1);
  assert.match(bad.text, /A handoff needs a title/);
  const empty = await run(['apply'], { stdin: JSON.stringify({ op: 'handoff', title: 'x' }) });
  assert.match(empty.text, /no length limit/);
});

test('handoffs lists what is open, and says plainly when there is nothing', async () => {
  assert.match((await run(['handoffs'])).text, /No open handoffs/);
  const files = repoFiles({ 'handoffs/2026-09-16-0814-stale-docs.md': 'body', 'handoffs/trail.md': 'a line' });
  const listed = await run(['handoffs'], { files });
  assert.match(listed.text, /2026-09-16-0814-stale-docs\.md/);
  assert.doesNotMatch(listed.text, /trail/);
});

test('handoff prints one in full, and says when the name matches nothing', async () => {
  const files = repoFiles({ 'handoffs/2026-09-16-0814-stale-docs.md': 'the whole story' });
  assert.match((await run(['handoff', '2026-09-16'], { files })).text, /the whole story/);
  const missing = await run(['handoff', 'nope'], { files });
  assert.equal(missing.code, 2);
  assert.match(missing.text, /No handoff starts with/);
});

test('a failed op is recorded in the trail, and still nothing is saved', async () => {
  const files = repoFiles();
  const remote = new FakeGitHub();
  const r = await run(['apply', '--build', 'abc1234'], { files, remote, stdin: JSON.stringify({ op: 'dayOff', date: 'today' }) });
  assert.equal(r.code, 1);
  assert.match(r.text, /Unknown op "dayOff"/);
  assert.equal(remote.puts, 0, 'apply is still all-or-nothing');
  const trail = files.raw.get('handoffs/trail.md');
  assert.match(trail, /dayOff/);
  assert.match(trail, /abc1234/);
});

test('an unknown command is recorded too', async () => {
  const files = repoFiles();
  await run(['fly'], { files });
  assert.match(files.raw.get('handoffs/trail.md'), /Unknown command "fly"/);
});

test('a clean op and a read leave the trail alone', async () => {
  const files = repoFiles();
  await run(['apply'], { files, stdin: JSON.stringify({ op: 'task', title: 'Email Sarah' }) });
  await run(['today'], { files });
  assert.equal(files.raw.has('handoffs/trail.md'), false);
});

test('the key never reaches the trail, not even inside a rejected op', async () => {
  const files = repoFiles();
  await run(['apply'], { files, stdin: JSON.stringify({ op: 'nope', text: KEY }) });
  const trail = files.raw.get('handoffs/trail.md');
  assert.ok(trail.includes('[hidden]'));
  assert.ok(!trail.includes(KEY));
});

test('a trail that will not write leaves the original error exactly as it was', async () => {
  const broken = repoFiles();
  broken.read = async () => { throw new Error('GitHub 500'); };
  const r = await run(['apply'], { files: broken, stdin: JSON.stringify({ op: 'dayOff' }) });
  assert.equal(r.code, 1);
  assert.equal(r.text, 'Nothing was changed. Op 1 of 1 (dayOff) failed: Unknown op "dayOff" — ops: task, habit, target, goal, milestone, plan, done, undone, log, edit, archive, accept, dismiss, flag, handoff, undo, planner, off, brief, gym, guide, details, rule, report, review');
  assert.doesNotMatch(r.text, /trail/i);
});

test('the trail keeps its last 200 lines and no more', async () => {
  const files = repoFiles({ 'handoffs/trail.md': Array.from({ length: 250 }, (_, i) => `old ${i}`).join('\n') });
  await run(['fly'], { files });
  const lines = files.raw.get('handoffs/trail.md').split('\n').filter(Boolean);
  assert.equal(lines.length, 200);
  assert.match(lines.at(-1), /Unknown command "fly"/);
});

test('help points at the index and at the live reference', async () => {
  const { text } = await run(['help']);
  assert.match(text, /what you want to do to the command that does it/);
  assert.match(text, /bash run\.sh reference/);
});

test('an unknown field is said out loud, the op still lands, and the note reaches the trail', async () => {
  const files = repoFiles();
  const remote = new FakeGitHub();
  const r = await run(['apply'], { files, remote, stdin: JSON.stringify({ op: 'task', title: 'Gym', length: '2h' }) });
  assert.equal(r.code, 0);
  assert.match(r.text, /Added task "Gym"/);
  assert.match(r.text, /"length" isn't a field on task/);
  assert.equal(remote.puts, 1, 'the op still landed');
  assert.match(files.raw.get('handoffs/trail.md'), /isn't a field on task/);
});

test("a plan's task retains its length, area and link to the goal", async () => {
  const remote = new FakeGitHub();
  const r = await run(['apply'], {
    remote, stdin: JSON.stringify({ op: 'plan', goal: { title: 'Interview readiness' }, tasks: [{ title: 'Read the pack', date: 'today', minutes: '2h', area: 'Job search' }] }),
  });
  assert.equal(r.code, 0);
  assert.match(r.text, /Suggested plan/);
  assert.doesNotMatch(r.text, /isn't a field/);
  const doc = (await remote.get()).doc;
  const task = Object.values(doc.items)[0];
  assert.equal(task.minutes, 120);
  assert.equal(task.area, 'Job search');
  assert.equal(task.goalId, Object.keys(doc.goals)[0]);
});

test('an op with only fields it reads says nothing extra', async () => {
  const r = await run(['apply'], { stdin: JSON.stringify({ op: 'task', title: 'Gym', minutes: '2h' }) });
  assert.equal(r.text, 'Added task "Gym" for today (2h) · #n1\nSaved to GitHub — the laptop and phone pick it up at their next sync.');
});

test('reference with a topic prints that playbook, from beside the live reference', async () => {
  const r = await main({
    argv: ['--config', 'config.json', '--reference', 'live/claude/skill/reference.md', 'reference', 'calendar'],
    readText: (path) => (path === 'live/claude/skill/playbooks/calendar.md' ? '# Playbook: calendar\nread planner first\n' : CONFIG),
    readStdin: async () => '', makeClient: () => new FakeGitHub(), now: MORNING, newId: ids('n'), env: {},
  });
  assert.equal(r.code, 0);
  assert.match(r.text, /read planner first/);
});

test('an unknown topic names the ones there are', async () => {
  const r = await main({
    argv: ['--config', 'config.json', '--reference', 'live/reference.md', 'reference', 'hebrew'],
    readText: () => CONFIG, readStdin: async () => '', makeClient: () => new FakeGitHub(), now: MORNING, newId: ids('n'), env: {},
  });
  assert.equal(r.code, 1);
  assert.match(r.text, /no playbook for "hebrew"/);
  assert.match(r.text, /calendar, planning, gym/);
});

test('help says to read the playbook before the calendar, the week, or training', async () => {
  const { text } = await run(['help']);
  assert.match(text, /reference <calendar\|planning\|gym>/);
});
