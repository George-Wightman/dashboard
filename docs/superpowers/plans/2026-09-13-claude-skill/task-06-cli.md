# Task 6: The command line

**Files:**
- Create: `claude/cli.js`, `claude/dash.mjs`
- Test: `tests/claude-cli.test.js`

**Interfaces:**
- Consumes: `readConfig` (Task 3, `claude/config.js`); `makeClient({ token, repo })` (Task 3,
  `claude/github.js`) → `{ get, put }`; `openSession` (Task 3); `READS` (Task 4); `OPS, UNLOGGED, runOp`
  (Task 5); `scrubText` (`js/flags.js`); `FakeGitHub`, `ids`, `fixture` (`tests/helpers.js`).
- Produces: `USAGE`, `main({ argv, readText, readStdin, makeClient?, now?, newId?, env? })` →
  `{ code: 0 | 1 | 2, text }`; `claude/dash.mjs`, which `run.sh` (Task 7) runs as
  `node claude/dash.mjs --config <path> <command> [argument]` or `… apply` with JSON on stdin.

- [ ] **Step 1: Write the failing tests** — create `tests/claude-cli.test.js`:

```js
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
  assert.match(USAGE, /Ops: task · habit · target · goal · milestone · plan · done · undone · log · edit · archive · accept · dismiss · flag · undo/);
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/claude-cli.test.js`
Expected: FAIL — `Cannot find module '.../claude/cli.js'`.

- [ ] **Step 3: Create `claude/cli.js`**

```js
// The tool's front door: arguments in, text out. dash.mjs runs main() for real; the tests run it
// with a fake GitHub. Reads print the dashboard; `apply` runs ops from stdin, all or nothing, and
// pushes once. Every line printed goes through scrubText, so the key can never be shown.

import { readConfig } from './config.js';
import { openSession } from './session.js';
import { makeClient as githubClient } from './github.js';
import { READS } from './read.js';
import { OPS, UNLOGGED, runOp } from './ops.js';
import { scrubText } from '../js/flags.js';

export const USAGE = [
  'Usage: bash run.sh <command> [argument]',
  'Reads: today · week · goals · list · find <words> · day <YYYY-MM-DD|today|yesterday> · history · journal · flags · changes [n]',
  "Changes: bash run.sh apply <<'EOF' … EOF, with one op or a list of ops as JSON (see reference.md)",
  `Ops: ${Object.keys(OPS).join(' · ')}`,
].join('\n');

function parseOps(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('apply needs JSON on stdin: one op object, or a list of them');
  }
  const ops = Array.isArray(data) ? data : [data];
  if (!ops.length) throw new Error('apply got an empty list — nothing to do');
  return ops;
}

export async function main({
  argv, readText, readStdin, makeClient = githubClient, now = () => new Date(), newId, env = process.env,
}) {
  const out = [];
  let secrets = [];
  const say = (text) => out.push(scrubText(String(text), secrets));
  const finish = (code) => ({ code, text: out.join('\n') });

  try {
    const args = [...argv];
    const at = args.indexOf('--config');
    if (at === -1 || !args[at + 1]) {
      say('Missing --config <path to config.json>.');
      say(USAGE);
      return finish(1);
    }
    const [, configPath] = args.splice(at, 2);
    const [command, ...rest] = args;
    if (!command || command === 'help') {
      say(USAGE);
      return finish(command ? 0 : 1);
    }

    let text;
    try {
      text = readText(configPath);
    } catch {
      say(`Can't read the skill's config.json (${configPath})`);
      return finish(1);
    }
    let config;
    try {
      config = readConfig(text);
    } catch (e) {
      say(e.message);
      return finish(1);
    }
    secrets = [config.token];
    // Before any date is made: the sandbox runs on UTC, George's devices on London time.
    env.TZ = config.timeZone;

    if (command !== 'apply' && !Object.hasOwn(READS, command)) {
      say(`Unknown command "${command}".`);
      say(USAGE);
      return finish(1);
    }
    let ops = null;
    if (command === 'apply') {
      try {
        ops = parseOps(await readStdin());
      } catch (e) {
        say(e.message);
        return finish(1);
      }
    }

    let session;
    try {
      session = await openSession({
        client: makeClient({ token: config.token, repo: config.repo }),
        dayStartHour: config.dayStartHour, now, newId,
      });
    } catch (e) {
      say(`Couldn't read the dashboard: ${e.message}`);
      return finish(2);
    }
    const { store } = session;

    if (command !== 'apply') {
      try {
        say(READS[command](store.doc(), store.today(), rest.join(' ')));
        return finish(0);
      } catch (e) {
        say(e.message);
        return finish(1);
      }
    }

    // Every op runs in memory first; one failure and nothing is pushed.
    const lines = [];
    for (const [i, op] of ops.entries()) {
      try {
        lines.push(session.record((s) => runOp(s, op), { log: !UNLOGGED.has(op?.op) }).summary);
      } catch (e) {
        say(`Nothing was changed. Op ${i + 1} of ${ops.length} (${op?.op ?? '?'}) failed: ${e.message}`);
        return finish(1);
      }
    }
    const result = await session.push();
    if (!result.ok) {
      say(`Nothing was saved: ${result.error}`);
      return finish(2);
    }
    lines.forEach(say);
    say(result.pushed ? 'Saved to GitHub — the laptop and phone pick it up at their next sync.' : 'Nothing needed changing.');
    return finish(0);
  } catch (e) {
    say(`Something went wrong in the dashboard tool: ${e?.message ?? e}`);
    return finish(2);
  }
}
```

- [ ] **Step 4: Create `claude/dash.mjs`**

```js
#!/usr/bin/env node
// The dashboard from the command line — what the Claude skill's run.sh runs. See claude/cli.js.

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { main } from './cli.js';

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

const { code, text } = await main({
  argv: process.argv.slice(2),
  readText: (path) => readFileSync(path, 'utf8'),
  readStdin,
  newId: randomUUID,
});
if (text) process.stdout.write(`${text}\n`);
process.exitCode = code;
```

- [ ] **Step 5: Run the tests**

Run: `node --test tests/claude-cli.test.js` → PASS (9 tests). Then `npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add claude/cli.js claude/dash.mjs tests/claude-cli.test.js
git commit -m "Add the tool's command line: reads, all-or-nothing apply, London time, the key scrubbed

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
