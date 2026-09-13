# Task 7: The skill and its build

**Files:**
- Create: `claude/skill/SKILL.md`, `claude/skill/reference.md`, `claude/skill/run.sh`,
  `claude/skill/config.example.json`
- Create: `claude/zip.js`, `claude/build-skill.mjs`
- Modify: `.gitignore` (add `claude/skill/config.json`), `package.json` (`build-skill` script)
- Test: `tests/claude-skill.test.js`

**Interfaces:**
- Consumes: `readConfig` (Task 3); `READS` (Task 4); `OPS` (Task 5) — `reference.md` must document every
  key of both, and a test holds it to that.
- Produces: `zipFiles(files, when?)` → Buffer; `PLACEHOLDER`, `SKILL_FILES`, `buildSkill({ configText,
  read? })` → Buffer; `npm run build-skill` writes `~/.dashboard-skill/dashboard-skill.zip` (or
  `$DASH_SKILL_DIR/dashboard-skill.zip`) from `~/.dashboard-skill/config.json`.

**Where the key lives.** The repo sits in a Google Drive folder, so the key does not: `config.json` and
the built zip are in `~/.dashboard-skill/` (override with `DASH_SKILL_DIR`). `claude/skill/config.json`
is still gitignored in case one is ever copied there.

- [ ] **Step 1: Write the failing tests** — create `tests/claude-skill.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { zipFiles } from '../claude/zip.js';
import { buildSkill, PLACEHOLDER, SKILL_FILES } from '../claude/build-skill.mjs';
import { OPS } from '../claude/ops.js';
import { READS } from '../claude/read.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Reads a zip back through its central directory: [{ name, mode, data }].
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const mode = (buf.readUInt32LE(at + 38) >>> 16) & 0o777;
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    out.push({ name, mode, data: inflateRawSync(buf.subarray(dataAt, dataAt + size)) });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const CONFIG = JSON.stringify({ token: 'github_pat_TESTKEY0123456789abcdef', repo: 'George-Wightman/dashboard-sync', dayStartHour: 4, timeZone: 'Europe/London' });

test('zipFiles writes a zip that reads back, names, modes and all', () => {
  const zip = zipFiles([{ name: 'd/a.txt', data: 'hello' }, { name: 'd/run.sh', data: Buffer.from('#!/bin/sh\n'), mode: 0o755 }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.deepEqual(unzip(zip).map((f) => [f.name, f.mode, f.data.toString()]),
    [['d/a.txt', 0o644, 'hello'], ['d/run.sh', 0o755, '#!/bin/sh\n']]);
});

test('buildSkill puts the three skill files and the config under dashboard/', () => {
  const files = unzip(buildSkill({ configText: CONFIG }));
  assert.deepEqual(files.map((f) => f.name), ['dashboard/SKILL.md', 'dashboard/reference.md', 'dashboard/run.sh', 'dashboard/config.json']);
  assert.equal(files[2].mode, 0o755);
  assert.equal(files[3].mode, 0o600);
  assert.equal(files[3].data.toString(), CONFIG);
  assert.equal(files[0].data.toString(), read('claude/skill/SKILL.md'));
  assert.deepEqual(SKILL_FILES, ['SKILL.md', 'reference.md', 'run.sh']);
});

test('buildSkill refuses a config without a real key', () => {
  assert.ok(read('claude/skill/config.example.json').includes(PLACEHOLDER));
  assert.throws(() => buildSkill({ configText: read('claude/skill/config.example.json') }), /Paste the Claude skill key/);
  assert.throws(() => buildSkill({ configText: '{"repo":"a/b"}' }), /has no token/);
});

test('SKILL.md: named dashboard, a description Claude can trigger on, and the rules from the design', () => {
  const skill = read('claude/skill/SKILL.md');
  const front = /^---\nname: dashboard\ndescription: (.+)\n---\n/.exec(skill);
  assert.ok(front, 'frontmatter with name and a one-line description');
  assert.ok(front[1].length <= 1024, 'description at most 1024 characters');
  for (const phrase of ['/dashboard', 'add', "what's on today", 'suggestion']) {
    assert.ok(front[1].toLowerCase().includes(phrase.toLowerCase()), phrase);
  }
  for (const phrase of ["run.sh apply <<'EOF'", '"suggest": true', '"op": "plan"', 'dashboard:<id>',
    'reference.md', 'Settings → Capabilities', 'never on a guessed title', 'config.json']) {
    assert.ok(skill.includes(phrase), phrase);
  }
});

test('reference.md documents every read and every op', () => {
  const ref = read('claude/skill/reference.md');
  for (const name of Object.keys(READS)) assert.match(ref, new RegExp(`^### \`${name}`, 'm'), name);
  for (const name of Object.keys(OPS)) assert.match(ref, new RegExp(`^### \`${name}\``, 'm'), name);
});

test("run.sh fetches the public app, checks Node, and runs the tool with the skill's config", () => {
  const sh = read('claude/skill/run.sh');
  assert.match(sh, /^#!\/usr\/bin\/env bash\n/);
  assert.ok(sh.includes('URL=https://github.com/George-Wightman/dashboard.git'));
  assert.ok(sh.includes('APP=/tmp/dashboard'));
  assert.ok(sh.includes('NODE_USE_ENV_PROXY=1 exec node "$APP/claude/dash.mjs" --config "$HERE/config.json" "$@"'));
  assert.ok(sh.includes('Settings → Capabilities'));
  assert.doesNotMatch(sh, /\r/);
  assert.doesNotMatch(sh, /github_pat_|ghp_/);
});

test('the key never enters the repo; the build has a script', () => {
  assert.match(read('.gitignore'), /^claude\/skill\/config\.json$/m);
  assert.match(read('package.json'), /"build-skill": "node claude\/build-skill\.mjs"/);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/claude-skill.test.js`
Expected: FAIL — `Cannot find module '.../claude/zip.js'`.

- [ ] **Step 3: Create `claude/zip.js`** (laptop only: uses `zlib.crc32`, Node 20.15+)

```js
// A minimal zip writer for the skill build: deflated files with Unix modes and UTF-8 names. No
// dependencies. Runs on the laptop only (zlib.crc32 needs Node 20.15 or newer).

import { deflateRawSync, crc32 } from 'node:zlib';

const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;

export function zipFiles(files, when = new Date(2026, 0, 1)) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data, mode = 0o644 } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.from(data);
    const packed = deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime(when), 10);
    local.writeUInt16LE(dosDate(when), 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4); // made by Unix, so the mode below counts
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(dosTime(when), 12);
    entry.writeUInt16LE(dosDate(when), 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38); // a regular file with this mode
    entry.writeUInt32LE(offset, 42);

    parts.push(local, nameBuf, packed);
    central.push(entry, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}
```

- [ ] **Step 4: Create `claude/build-skill.mjs`**

```js
// Builds the dashboard skill for upload to claude.ai: SKILL.md, reference.md and run.sh from
// claude/skill/, plus the key's config.json, zipped under a dashboard/ folder. The config and the
// zip both live outside the repo (which sits in Google Drive): in ~/.dashboard-skill, or wherever
// DASH_SKILL_DIR points. Run with: npm run build-skill

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readConfig } from './config.js';
import { zipFiles } from './zip.js';

export const PLACEHOLDER = 'PASTE-THE-CLAUDE-SKILL-KEY-HERE';
export const SKILL_FILES = ['SKILL.md', 'reference.md', 'run.sh'];

const SKILL_DIR = fileURLToPath(new URL('./skill/', import.meta.url));

export function buildSkill({ configText, read = (name) => readFileSync(join(SKILL_DIR, name)) }) {
  if (configText.includes(PLACEHOLDER)) {
    throw new Error(`Paste the Claude skill key into config.json first, in place of ${PLACEHOLDER}.`);
  }
  readConfig(configText);
  return zipFiles([
    ...SKILL_FILES.map((name) => ({ name: `dashboard/${name}`, data: read(name), mode: name.endsWith('.sh') ? 0o755 : 0o644 })),
    { name: 'dashboard/config.json', data: Buffer.from(configText), mode: 0o600 },
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.env.DASH_SKILL_DIR || join(homedir(), '.dashboard-skill');
  const configPath = join(dir, 'config.json');
  try {
    const zip = buildSkill({ configText: readFileSync(configPath, 'utf8') });
    const target = join(dir, 'dashboard-skill.zip');
    writeFileSync(target, zip);
    console.log(`Built ${target} (${zip.length} bytes). Upload it at claude.ai → Settings → Capabilities → Skills.`);
  } catch (e) {
    console.error(e.code === 'ENOENT'
      ? `No config at ${configPath}. Copy claude/skill/config.example.json there and paste the key in.`
      : e.message);
    process.exitCode = 1;
  }
}
```

- [ ] **Step 5: Create `claude/skill/config.example.json`**

```json
{
  "token": "PASTE-THE-CLAUDE-SKILL-KEY-HERE",
  "repo": "George-Wightman/dashboard-sync",
  "dayStartHour": 4,
  "timeZone": "Europe/London"
}
```

- [ ] **Step 6: Create `claude/skill/run.sh`** (LF line endings; `.gitattributes` is `* -text`, so git
keeps them as written)

```bash
#!/usr/bin/env bash
# Runs the dashboard tool for the Claude skill. Brings the public app code into /tmp/dashboard
# (cloning it the first time in a chat, updating it after), checks Node, then runs
# claude/dash.mjs with this skill's config.json.
#   bash run.sh <command> [argument]
#   bash run.sh apply <<'EOF'
#   [{"op": "task", "title": "…"}]
#   EOF
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP=/tmp/dashboard
URL=https://github.com/George-Wightman/dashboard.git

if ! command -v node >/dev/null 2>&1; then
  echo "Node isn't available in this sandbox, so the dashboard can't be reached from here."
  exit 3
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "This sandbox's Node is too old for the dashboard tool (it needs 18 or newer)."
  exit 3
fi

if [ -d "$APP/.git" ]; then
  if ! { git -C "$APP" fetch --quiet --depth 1 origin main && git -C "$APP" reset --quiet --hard origin/main; } 2>/dev/null; then
    echo "(Couldn't update the dashboard code; using the copy from earlier in this chat.)"
  fi
else
  rm -rf "$APP"
  if ! git clone --quiet --depth 1 "$URL" "$APP" 2>/dev/null; then
    echo "Can't reach GitHub from this sandbox. Check claude.ai → Settings → Capabilities: code execution on, and network access allowed."
    exit 3
  fi
fi

NODE_USE_ENV_PROXY=1 exec node "$APP/claude/dash.mjs" --config "$HERE/config.json" "$@"
```

- [ ] **Step 7: Create `claude/skill/SKILL.md`**

````markdown
---
name: dashboard
description: George's personal dashboard ("Today") — read it and change anything in it. Use when George says /dashboard, "add … to the dashboard", "put it on my list", "what's on today?", "how did last week go?", "log 45m of Hebrew", "tick off …", or asks about his tasks, habits, weekly targets or goals. Also use it unprompted to add a suggestion when a chat turns up something that sounds like a to-do, or to suggest a plan of stages for a bigger job such as an application or interview prep.
---

# George's dashboard

The dashboard is George's daily hub: today's list (tasks, habits, weekly targets), goals with
milestones, the last three weeks, and a Gemini coach that writes check-ins and a weekly digest. It
syncs between his laptop and phone through a private GitHub repo. You are his administrator here:
you may change anything, and every change you make is logged in the app (⚙ → Claude's changes),
where he can see it and undo it.

## Running the tool

Everything goes through `run.sh` in this skill's folder (the folder this SKILL.md is in):

    bash <skill folder>/run.sh today

**Reads:** `today`, `week`, `goals`, `list`, `find <words>`, `day <YYYY-MM-DD>`, `history`,
`journal`, `flags`, `changes`. Each starts with today's date — work other dates out from it.

**Changes** go in one `apply`, as JSON on a quoted heredoc, so apostrophes, quotes and `$` in titles
are safe. Several ops in one `apply` are one sync:

    bash <skill folder>/run.sh apply <<'EOF'
    [{"op": "task", "title": "Email Sarah about the form", "date": "2026-09-18"},
     {"op": "log", "id": "a1b2c3d4", "amount": "45m"}]
    EOF

Ops: `task`, `habit`, `target`, `goal`, `milestone`, `plan`, `done`, `undone`, `log`, `edit`,
`archive`, `accept`, `dismiss`, `flag`, `undo`. Every field is in `reference.md` in this folder —
read it before using anything beyond a plain task, tick or log.

Ids show as `#a1b2c3d4`; pass them without the `#`. Dates are `YYYY-MM-DD`, `today`, `tomorrow` or
`yesterday`. If `apply` fails, **nothing** was changed: fix the op it names and send the whole batch
again.

## How to behave

- **Asked for → do it now, as live.** No "shall I?" — not for edits or archiving either. Then report
  in one line per change, using the tool's own lines: *Added task "Email Sarah" for Fri 18 Sep.*
- **Noticed → suggest, liberally.** When the chat turns up something that sounds like a to-do George
  didn't ask to add, add it with `"suggest": true` and mention it in a line. It waits dimmed at the
  top of Today for his ✓ or ✕.
- **Bigger jobs → a plan.** For an application, interview prep, or anything with stages, use
  `"op": "plan"`: a goal, its stages as milestones, and the first few concrete tasks (a habit or
  weekly target only if it genuinely helps). All of it arrives as suggestions.
- **Look before changing.** Read `today`, `list` or `find` first and act on ids —
  never on a guessed title.
- **Ask only when you genuinely can't tell** which item or which day George means (two tasks match
  "the CV one").
- **Never claim a change that didn't land.** If the tool reports a failure, say so in one line, with
  its reason.
- Don't read the dashboard on every message — when it's relevant, or before a change.
- The look, the widget layout, settings and keys stay on each device; they aren't in the data.

## The calendar

If the Google Calendar connector is available and you're choosing a day or time for something, check
the calendar first. When a task needs real time (more than about half an hour of focused work),
offer to book a block. An event booked for a dashboard task gets `dashboard:<id>` (the id as the tool
shows it) on its own line in the description.

## If something goes wrong

- "Can't reach GitHub from this sandbox" → George should check claude.ai → Settings → Capabilities:
  code execution on, and network access allowed.
- "GitHub refused the access key" → the skill's key has expired or been revoked. George makes a new
  one, puts it in `~/.dashboard-skill/config.json` on his laptop, runs `npm run build-skill`, and
  uploads the new zip.
- Never open, print or quote `config.json`: it holds the key.
````

- [ ] **Step 8: Create `claude/skill/reference.md`**

````markdown
# Dashboard tool reference

Run from this skill's folder: `bash run.sh <read> [argument]`, or `bash run.sh apply` with JSON on a
quoted heredoc (`<<'EOF'` … `EOF`). Ids are what the tool shows after `#` (any unique start of at
least 4 characters works). Dates: `YYYY-MM-DD`, `today`, `tomorrow`, `yesterday`.

## Reads

### `today`
Today's list: suggestions waiting for ✓/✕, then to do, then done. Tasks carried over from earlier
days say *from Tue*; habits show their streak; weekly targets show this week's total.

### `week`
This week's weekly targets and times-a-week habits against their numbers.

### `goals`
Live and suggested goals, with progress, their milestones (`[x]` done, `?` suggested) and the items
linked to them.

### `list`
Everything live beyond today: upcoming tasks by date, every habit and how it repeats, every weekly
target.

### `find <words>`
Items, goals, milestones and flags whose title contains the words, archived ones included (so they
can be found again).

### `day <date>`
One day: what was on it, what was ticked, and any amounts logged.

### `history`
The last three weeks, day by day, as done/total.

### `journal`
The Gemini coach's latest weekly digest and last three evening check-ins.

### `flags`
Open flags — notes George made about something to change in the app.

### `changes [n]`
Your own last n changes (10 by default), with their ids for `undo`.

## Ops

Every op is an object with `"op"`. Add `"suggest": true` to `task`, `habit`, `target`, `goal` or
`milestone` to make it a suggestion instead of live.

### `task`
`{"op": "task", "title": "…", "date": "2026-09-18", "area": "Job", "goal": "<goal id>"}` — only
`title` is required; `date` defaults to today.

### `habit`
`{"op": "habit", "title": "…", "repeat": {…}}` — `repeat` defaults to every day. Shapes:
`{"kind": "daily"}` · `{"kind": "weekdays", "days": [1, 3, 5]}` (1 = Mon … 7 = Sun) ·
`{"kind": "perWeek", "n": 3}` · `{"kind": "weekly", "day": 5}` · `{"kind": "monthly", "date": 1}`.
Also `area`, `goal`.

### `target`
A weekly target. `{"op": "target", "title": "Applications", "target": 5, "unitLabel": "applications"}`
for a count, or `{"op": "target", "title": "Hebrew", "target": "5h", "unit": "minutes"}` for time
(`"90m"`, `"1h30"`, `"1.5h"`). Also `area`, `goal`.

### `goal`
`{"op": "goal", "title": "…", "targetDate": "2026-12-01", "why": "…", "milestones": ["…", "…"]}` —
progress is by milestones ticked.

### `milestone`
`{"op": "milestone", "goal": "<goal id>", "title": "…"}`.

### `plan`
A bigger job broken down, all as suggestions:
`{"op": "plan", "goal": {"title": "…", "targetDate": "…", "why": "…"}, "milestones": ["…"],
"tasks": [{"title": "…", "date": "…"}], "habits": [{"title": "…", "repeat": {…}}],
"targets": [{"title": "…", "target": 3, "unitLabel": "…"}]}` — every part is optional, but it needs a
goal or at least one habit, target or task. Milestones need the goal.

### `done`
Tick a task or habit (`"day"` defaults to today), or a milestone: `{"op": "done", "id": "…"}`.
Weekly targets take `log` instead.

### `undone`
Untick: `{"op": "undone", "id": "…", "day": "yesterday"}`.

### `log`
An amount on a weekly target, or on a goal measured by a number:
`{"op": "log", "id": "…", "amount": "45m", "day": "today", "note": "…"}`. Time targets take `"45m"`,
`"1.5h"`, `"1h30"`; counts take a number.

### `edit`
`{"op": "edit", "id": "…", "set": {"title": "…", "date": "…"}}`. Editable — tasks: `title, date,
area, goalId, order`; habits: `title, area, goalId, repeat, order`; weekly targets: `title, area,
goalId, target, unitLabel, order`; goals: `title, targetDate, target, unitLabel, why, order`
(`target: null` measures by milestones); milestones: `title, done, goalId, order`. A weekly target's
unit can't change — archive it and add a new one.

### `archive`
`{"op": "archive", "id": "…"}` — archives an item, goal or milestone (history is kept), removes a
logged amount or tick, or marks a flag addressed. Use `dismiss` for a suggestion.

### `accept`
Take on a suggestion: `{"op": "accept", "id": "…"}`. On a suggested goal it takes on the goal and its
milestones; its habits, targets and tasks stay suggestions to accept one by one.

### `dismiss`
Turn a suggestion down: `{"op": "dismiss", "id": "…"}`. On a suggested goal it also dismisses
everything proposed with it.

### `flag`
Note something to change in the app itself: `{"op": "flag", "text": "…"}`.

### `undo`
Undo one of your own changes, by the id `changes` shows: `{"op": "undo", "change": "…"}`. Anything
George has changed since is left alone, and the tool says so.
````

- [ ] **Step 9: Ignore the key, add the build script** — `.gitignore` gains a line:

```
claude/skill/config.json
```

and `package.json` becomes:

```json
{
  "name": "dashboard",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.js",
    "build-skill": "node claude/build-skill.mjs"
  }
}
```

- [ ] **Step 10: Run the tests**

Run: `node --test tests/claude-skill.test.js` → PASS (7 tests). Then `npm test` → PASS.

- [ ] **Step 11: Commit**

```bash
git add claude/skill claude/zip.js claude/build-skill.mjs .gitignore package.json tests/claude-skill.test.js
git commit -m "Add the dashboard skill: SKILL.md, reference.md, run.sh, and the zip build

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Check `git status` shows no `config.json` anywhere under `claude/` before committing.
