# Task 3: The tool's plumbing

**Files:**
- Create: `claude/config.js`, `claude/session.js`, `claude/github.js`
- Modify: `tests/helpers.js` (export `FakeGitHub`; import `ConflictError` from `../js/sync.js`)
- Test: `tests/claude-core.test.js`

**Interfaces:**
- Consumes: `createStore, DATA_KEY, SETTINGS_KEY` (`js/data.js`); `emptyDoc, isDoc, stableStringify`
  (`js/doc.js`); `syncOnce, createGitHubClient, ConflictError` (`js/sync.js`); `diffDocs` (`js/changes.js`);
  the store's `addChange` and `pruneChanges` (Task 2).
- Produces: `readConfig(text)`, `DEFAULT_ZONE`; `openSession({ client, dayStartHour, now, newId })` →
  `{ store, record(fn, { log }), changed(), push() }`; `makeClient({ token, repo, fetch? })` → `{ get, put }`;
  `FakeGitHub` in the test helpers. Task 6's command line uses all four.

**How the sandbox reaches GitHub.** The first spike (13 Sep) showed claude.ai's sandbox runs Node 22,
clones from github.com, and reaches api.github.com, where key-less requests got 403 from curl and Node
alike, so the curl fallback the plan first had adds nothing and is dropped. A second spike with
Claude's own key settles whether keyed API calls get through. `claude/github.js` is the one place that
knows how the tool reaches the repo: the app's own Contents-API client. If the API turns out to be
filtered, only that file changes (to git over https, which the clone proves works); everything else
talks to `{ get, put }`.

- [ ] **Step 1: Write the failing tests** — `tests/claude-core.test.js` (as committed): `readConfig`
  defaults and every refusal (bad JSON, not an object, no token, bad repo, bad hour, unknown zone, a
  non-string zone), none of which mention the key; `openSession` loading the remote document with the
  configured day start, starting empty without a file, refusing a non-dashboard file; `record` logging a
  step's edits as one change with the ` · #id` tail stripped; a step that changes nothing logs and
  pushes nothing; an unlogged step still pushes; a throwing step throws; `push` merging with a device
  that wrote in between; `makeClient` hitting
  `https://api.github.com/repos/<repo>/contents/data.json` with `Bearer <token>`.

- [ ] **Step 2: Add `FakeGitHub` to `tests/helpers.js`**, above `fixture`, and
  `import { ConflictError } from '../js/sync.js';` at the top:

```js
// A sync file on GitHub, in memory: get/put with a sha, and a 409 when the sha is stale.
export class FakeGitHub {
  constructor() { this.file = null; this.n = 0; this.puts = 0; this.gets = 0; }
  async get() {
    this.gets++;
    return this.file ? { doc: structuredClone(this.file.doc), sha: this.file.sha } : null;
  }
  async put(doc, sha) {
    if ((this.file && sha !== this.file.sha) || (!this.file && sha)) throw new ConflictError('GitHub 409');
    this.puts++;
    this.file = { doc: structuredClone(doc), sha: `sha${++this.n}` };
    return this.file.sha;
  }
}
```

- [ ] **Step 3: Run it to see it fail** — `node --test tests/claude-core.test.js` → `Cannot find module
  '.../claude/config.js'`.

- [ ] **Step 4: Create `claude/config.js`**

```js
// The skill's config.json: Claude's own GitHub key, the sync repo, and the day as George's devices
// count it. Checked here so a mistake reads as a sentence, not a stack trace. The key is never part
// of any message.

export const DEFAULT_ZONE = 'Europe/London';

export function readConfig(text) {
  let c;
  try {
    c = JSON.parse(text);
  } catch {
    throw new Error("The skill's config.json isn't valid JSON");
  }
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error("The skill's config.json should be an object");
  const token = typeof c.token === 'string' ? c.token.trim() : '';
  if (!token) throw new Error("The skill's config.json has no token");
  const repo = typeof c.repo === 'string' ? c.repo.trim() : '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("The skill's config.json repo should look like owner/name");
  const dayStartHour = c.dayStartHour ?? 4;
  if (!(Number.isInteger(dayStartHour) && dayStartHour >= 0 && dayStartHour <= 12)) {
    throw new Error("The skill's config.json dayStartHour should be a whole hour from 0 to 12");
  }
  const timeZone = c.timeZone ?? DEFAULT_ZONE;
  try {
    if (typeof timeZone !== 'string') throw new Error();
    new Intl.DateTimeFormat('en-GB', { timeZone });
  } catch {
    throw new Error(`The skill's config.json timeZone ${JSON.stringify(timeZone)} isn't a time zone Node knows`);
  }
  return { token, repo, dayStartHour, timeZone };
}
```

- [ ] **Step 5: Create `claude/session.js`**

```js
// One run of the tool: the sync file loaded into a store built by the app's own createStore (over
// memory, not localStorage), steps applied to it and logged as Claude's changes, then pushed with
// the app's own syncOnce. To the laptop and the phone, Claude is just another device.

import { randomUUID } from 'node:crypto';
import { createStore, DATA_KEY, SETTINGS_KEY } from '../js/data.js';
import { emptyDoc, isDoc, stableStringify } from '../js/doc.js';
import { syncOnce } from '../js/sync.js';
import { diffDocs } from '../js/changes.js';

export class MemoryStorage {
  constructor(initial = {}) { this.map = new Map(Object.entries(initial)); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

export async function openSession({ client, dayStartHour = 4, now = () => new Date(), newId = randomUUID }) {
  const remote = await client.get();
  if (remote && !isDoc(remote.doc)) throw new Error("The sync file isn't a dashboard document — nothing was changed");
  const storage = new MemoryStorage({
    [DATA_KEY]: JSON.stringify(remote?.doc ?? emptyDoc()),
    [SETTINGS_KEY]: JSON.stringify({ dayStartHour }),
  });
  const store = createStore({ storage, now, newId });
  let changed = false;

  return {
    store,

    // Runs one step against the store. Whatever it changed is logged as one of Claude's changes,
    // with the summary the step returns less the ' · #id' tail meant for Claude. Throws whatever
    // the step throws (the caller then pushes nothing).
    record(fn, { log = true } = {}) {
      const before = structuredClone(store.doc());
      const summary = fn(store);
      const edits = diffDocs(before, store.doc());
      if (log && edits.length) store.addChange({ summary: String(summary).replace(/ · #\S+$/, ''), edits });
      if (stableStringify(before) !== stableStringify(store.doc())) changed = true;
      return { summary, edits };
    },

    changed: () => changed,

    // Old snapshots are pruned, then the document goes up through the app's own sync: GET, merge,
    // PUT with the sha, round again on a conflict.
    async push() {
      if (!changed) return { ok: true, pushed: false };
      store.pruneChanges();
      return syncOnce({ store, client });
    },
  };
}
```

- [ ] **Step 6: Create `claude/github.js`**

```js
// How the tool reaches the sync repo: the app's own GitHub client (js/sync.js), with Claude's key.
// The one place that knows the route — everything else talks to { get, put } — so if claude.ai's
// sandbox ever blocks the API, only this file changes.

import { createGitHubClient } from '../js/sync.js';

export function makeClient({ token, repo, fetch }) {
  return createGitHubClient({ token, repo, ...(fetch ? { fetch } : {}) });
}
```

- [ ] **Step 7: Run the tests** — `node --test tests/claude-core.test.js` → PASS (8 tests); `npm test` → PASS.

- [ ] **Step 8: Commit**

```bash
git add claude/config.js claude/session.js claude/github.js tests/helpers.js tests/claude-core.test.js
git commit -m "Add the tool's plumbing: config checks, one run's pull-change-push, the GitHub route

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
