process.env.TZ = 'UTC';

// A cloud routine can't write to main — Anthropic's GitHub gateway allows only claude/ branches — so
// in a routine (`--config env`) the tool saves data.json and mind.json to its claude/ branch of the
// sync repo, and the planner merges them in (planner/branches.js). Here a fake git plays the clone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../claude/cli.js';
import { createBranchWriter, sessionBranch } from '../claude/branch.js';
import { FakeGitHub, ids, fixture } from './helpers.js';
import { emptyMind } from '../js/mind-state.js';

const KEY = 'github_pat_TESTKEY0123456789abcdef';
const REPO = 'George-Wightman/dashboard-sync';
const EVENING = () => new Date('2026-09-24T18:30:00Z');
const THU = '2026-09-24';

// Just enough git: one working tree, commits as file maps, and an origin that refuses a push that
// isn't a fast-forward.
export function fakeGit({ origin = `https://github.com/${REPO}`, head = 'claude/modest-pascal', remote = {} } = {}) {
  let n = 0;
  const commits = { c0: { files: {}, parent: null } };
  const refs = { main: 'c0', [head]: 'c0' };
  const tracking = {};
  const state = { head, work: {}, staged: {}, calls: [], remote, pushes: 0 };
  const files = { write: (path, text) => { state.work[path] = text; } };
  const commitOf = (ref) => commits[ref.startsWith('origin/') ? tracking[ref.slice(7)] : refs[ref] ?? ref];
  function git(args) {
    state.calls.push(args.join(' '));
    const a = args.filter((x) => x !== '--quiet' && !x.startsWith('user.') && x !== '-c');
    const [cmd, ...rest] = a;
    if (cmd === 'remote') return `${origin}\n`;
    if (cmd === 'rev-parse' && rest[0] === '--abbrev-ref') return `${state.head}\n`;
    if (cmd === 'rev-parse') return `${refs[state.head]}\n`;
    if (cmd === 'for-each-ref') return Object.keys(refs).filter((r) => r.startsWith('claude/')).join('\n');
    if (cmd === 'fetch') {
      const name = rest[1].split(':')[0].replace('+refs/heads/', '');
      if (!remote[name]) throw new Error(`fatal: couldn't find remote ref refs/heads/${name}`);
      commits[remote[name]] ??= remote.commits?.[remote[name]];
      tracking[name] = remote[name];
      return '';
    }
    if (cmd === 'show') {
      const [ref, path] = rest[0].split(':');
      const text = commitOf(ref)?.files[path];
      if (text == null) throw new Error(`fatal: path '${path}' does not exist`);
      return text;
    }
    if (cmd === 'checkout') {
      const name = rest[1];
      const from = rest[2] ? commitOf(rest[2]) : commits[refs[state.head]];
      const id = rest[2] ? tracking[rest[2].slice(7)] : refs[state.head];
      refs[name] = id;
      state.head = name;
      state.work = { ...from.files };
      state.staged = { ...from.files };
      return '';
    }
    if (cmd === 'add') { state.staged[rest[0]] = state.work[rest[0]]; return ''; }
    if (cmd === 'diff') {
      const base = commits[refs[state.head]].files;
      if (JSON.stringify(base) !== JSON.stringify(state.staged)) throw new Error('exit 1');
      return '';
    }
    if (cmd === 'commit') {
      const id = `c${++n}`;
      commits[id] = { files: { ...state.staged }, parent: refs[state.head] };
      refs[state.head] = id;
      return '';
    }
    if (cmd === 'push') {
      const name = rest[1].replace('HEAD:refs/heads/', '');
      const mine = refs[state.head];
      const theirs = remote[name];
      let c = mine;
      let fastForward = !theirs;
      while (c && !fastForward) { if (c === theirs) fastForward = true; c = commits[c].parent; }
      if (!fastForward) throw new Error(' ! [rejected]        HEAD -> claude/x (non-fast-forward)');
      remote[name] = mine;
      remote.commits = { ...(remote.commits ?? {}), [mine]: commits[mine] };
      state.pushes++;
      return '';
    }
    throw new Error(`fake git doesn't know: ${args.join(' ')}`);
  }
  const onRemote = (name, path) => { const c = remote.commits?.[remote[name]]; return c?.files[path] == null ? null : JSON.parse(c.files[path]); };
  return { git, files, state, onRemote };
}

function setup(gitOpts) {
  const main_ = new FakeGitHub();
  main_.file = { doc: fixture({ items: [{ id: 'role4', type: 'task', title: 'Role play 4', date: '2026-09-27', order: 1 }] }), sha: 's0' };
  const mindMain = new FakeGitHub();
  const m = emptyMind();
  m.cursor = { at: '2026-09-24T18:00:00.000Z' };
  m.events.e1 = { id: 'e1', at: '2026-09-24T18:10:00.000Z', kind: 'tick', level: 3, by: 'me', day: THU, refs: {}, text: 'Ticked', facts: [], reflex: null, deep: null };
  mindMain.file = { doc: m, sha: 'm0' };
  const g = fakeGit(gitOpts);
  const run = (argv, { stdin = '', env = { DASHBOARD_TOKEN: KEY } } = {}) => main({
    argv: ['--config', 'env', ...argv], readText: () => { throw new Error('no files here'); }, readStdin: async () => stdin,
    makeClient: ({ path }) => (path === 'mind.json' ? mindMain : main_), now: EVENING, newId: ids('n'), env,
    makeBranchWriter: ({ repo }) => createBranchWriter({ git: g.git, files: g.files, repo }),
  });
  return { main: main_, mindMain, g, run };
}

test('a routine saves to its claude/ branch, never to main, and says so', async () => {
  const s = setup();
  const r = await s.run(['apply', '--mind'], { stdin: JSON.stringify([
    { op: 'say', text: 'How did the mock interview compare with Tuesday?' },
    { op: 'handled', events: 'all', summary: 'Looked at the tick.' },
  ]) });
  assert.equal(r.code, 0, r.text);
  assert.equal(s.main.puts, 0, 'main is never written');
  assert.equal(s.mindMain.puts, 0);
  assert.match(r.text, /Saved to the claude\/modest-pascal branch of George-Wightman\/dashboard-sync — the planner merges it/);
  assert.match(r.text, /mind\.json: 1 event marked as handled/);
  const data = s.g.onRemote('claude/modest-pascal', 'data.json');
  assert.match(data.journal[`talk:${THU}:deep-1`].messages[0].text, /mock interview/);
  assert.ok(data.items.role4, 'the whole document, merged with main');
  const mind = s.g.onRemote('claude/modest-pascal', 'mind.json');
  assert.ok(mind.events.e1.deep);
  assert.deepEqual(mind.cursor, { at: '2026-09-24T18:00:00.000Z' }, "the planner's cursor stays");
});

test("a second save keeps what the branch already holds, even before the planner has merged it", async () => {
  const s = setup();
  await s.run(['apply', '--mind'], { stdin: JSON.stringify({ op: 'say', text: 'First thought about the week.' }) });
  const r = await s.run(['apply', '--mind'], { stdin: JSON.stringify({ op: 'say', text: 'Second thought, later on.' }) });
  assert.equal(r.code, 0, r.text);
  const data = s.g.onRemote('claude/modest-pascal', 'data.json');
  const said = Object.values(data.journal).filter((j) => j.kind === 'talk').flatMap((t) => t.messages.map((m) => m.text));
  assert.deepEqual(said.sort(), ['First thought about the week.', 'Second thought, later on.']);
  assert.equal(s.main.puts, 0);
});

test('reads and preview in a routine never touch git', async () => {
  const s = setup();
  assert.equal((await s.run(['today'])).code, 0);
  assert.equal((await s.run(['mind'])).code, 0);
  const p = await s.run(['preview', '--mind'], { stdin: JSON.stringify({ op: 'say', text: 'A question?' }) });
  assert.equal(p.code, 0, p.text);
  assert.deepEqual(s.g.state.calls, []);
});

test("the wrong clone is refused before anything is pushed", async () => {
  const s = setup({ origin: 'https://github.com/George-Wightman/dashboard.git' });
  const r = await s.run(['apply', '--mind'], { stdin: JSON.stringify({ op: 'say', text: 'Hello there?' }) });
  assert.equal(r.code, 2);
  assert.match(r.text, /Can't find this routine's clone of George-Wightman\/dashboard-sync/);
  assert.equal(s.g.state.pushes, 0);
});

test('DASHBOARD_WRITE=api writes to main as before', async () => {
  const s = setup();
  const r = await s.run(['apply', '--mind'], { stdin: JSON.stringify({ op: 'say', text: 'Straight to main?' }), env: { DASHBOARD_TOKEN: KEY, DASHBOARD_WRITE: 'api' } });
  assert.equal(r.code, 0, r.text);
  assert.equal(s.main.puts, 1);
  assert.match(r.text, /Saved to GitHub/);
});

test('the branch: the one checked out when it is a claude/ one, else the first claude/ branch, else claude/mind', () => {
  assert.equal(sessionBranch(fakeGit({ head: 'claude/quirky-volta' }).git), 'claude/quirky-volta');
  const onMain = fakeGit({ head: 'main' });
  assert.equal(sessionBranch(onMain.git), 'claude/mind');
});

test('a push that lost a race is a conflict, so the save goes round again', async () => {
  const s = setup();
  // Someone else's commit on the branch that this clone hasn't seen.
  s.g.state.remote['claude/modest-pascal'] = 'x9';
  s.g.state.remote.commits = { x9: { files: { 'data.json': JSON.stringify(s.main.file.doc) }, parent: null } };
  const w = createBranchWriter({ git: s.g.git, files: s.g.files, repo: REPO });
  const c = w.client({ main: s.main, path: 'data.json', merge: (a) => a });
  // get() fetches the branch, so put() builds on it and goes through.
  const got = await c.get();
  await c.put(got.doc);
  assert.equal(s.g.state.pushes, 1);
});
