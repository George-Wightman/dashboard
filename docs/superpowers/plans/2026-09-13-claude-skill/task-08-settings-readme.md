# Task 8: Claude's changes in ⚙, and the README

**Files:**
- Create: `js/ui/changes.js`
- Modify: `js/ui/settings.js` (a new folded group), `styles.css` (the list), `sw.js` (SHELL gains
  `js/ui/changes.js`; CACHE stays `dash-v5` from Task 1), `README.md`
- Test: `tests/changes-ui.test.js`

**Interfaces:**
- Consumes: `changeList, changeCountLine, editLines, canUndo, undoLine` (`js/changes.js`, Task 1);
  `store.undoChange(id, 'me')` (Task 2); `h` (`js/ui/dom.js`); `group(name, now, open, …body)` inside
  `js/ui/settings.js`.
- Produces: `changesPanel(ctx)` → HTMLElement; ⚙ → **Claude's changes**.

- [ ] **Step 1: Write the failing tests** — create `tests/changes-ui.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test("js/ui/changes.js lists Claude's changes with Details, Undo and Show more", () => {
  const src = read('js/ui/changes.js');
  assert.match(src, /export function changesPanel\(ctx\)/);
  assert.match(src, /const PAGE = 20;/);
  assert.match(src, /changeList\(store\.doc\(\)\)/);
  assert.match(src, /editLines\(/);
  assert.match(src, /canUndo\(c\)/);
  assert.match(src, /store\.undoChange\(c\.id, 'me'\)/);
  assert.match(src, /undoLine\(/);
  assert.match(src, /'Show more'/);
  assert.match(src, /' · undone'/);
  assert.doesNotMatch(src, /ctx\.render\(\)/);
});

test("⚙ has a folded Claude's changes group with its count line, before Backups", () => {
  const src = read('js/ui/settings.js');
  assert.match(src, /import \{ changesPanel \} from '\.\/changes\.js';/);
  assert.match(src, /import \{ changeCountLine \} from '\.\.\/changes\.js';/);
  assert.match(src, /group\("Claude's changes", changeCountLine\(store\.doc\(\), new Date\(\)\), false,\s*changesPanel\(ctx\)\),\s*group\('Backups'/);
});

test('styles.css styles the change list', () => {
  const css = read('styles.css');
  for (const selector of ['.change-list', '.change.undone', '.change-edits']) assert.ok(css.includes(selector), selector);
});

test('the README explains the skill, the change log and the key', () => {
  const readme = read('README.md');
  for (const phrase of ['## Claude', "⚙ → **Claude's changes**", 'npm run build-skill', '~/.dashboard-skill',
    '3. **Claude skill** — built', '`js/changes.js`', '`claude/`']) {
    assert.ok(readme.includes(phrase), phrase);
  }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/changes-ui.test.js`
Expected: FAIL — `ENOENT … js/ui/changes.js`.

- [ ] **Step 3: Create `js/ui/changes.js`**

```js
// ⚙ → Claude's changes: what Claude has changed from a chat, newest first, 20 at a time, each with
// its Details (field by field) and Undo (js/changes.js, store.undoChange). Undo never overwrites
// something changed since; the row says what happened.

import { h } from './dom.js';
import { changeList, editLines, canUndo, undoLine } from '../changes.js';

const PAGE = 20;

const when = (at) => new Date(at).toLocaleString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

export function changesPanel(ctx) {
  const { store } = ctx;
  const box = h('div', { class: 'claude-changes' });
  const notes = new Map(); // change id → what its Undo did, shown under the row
  let shown = PAGE;

  function undo(c) {
    notes.set(c.id, undoLine(store.undoChange(c.id, 'me')));
    paint();
  }

  function row(c) {
    const lines = c.pruned ? [] : c.edits.flatMap((e) => editLines(e));
    return h('li', { class: c.undoneAt ? 'change undone' : 'change' },
      h('div', { class: 'change-line' },
        h('span', { class: 'muted' }, `${when(c.at)} · `),
        h('span', { class: 'change-summary' }, c.summary),
        c.undoneAt ? h('span', { class: 'muted' }, ' · undone') : null),
      lines.length
        ? h('details', {}, h('summary', {}, 'Details'), h('ul', { class: 'change-edits' }, lines.map((line) => h('li', {}, line))))
        : null,
      canUndo(c) ? h('button', { class: 'link', type: 'button', onclick: () => undo(c) }, 'Undo') : null,
      notes.has(c.id) ? h('p', { class: 'muted', role: 'status' }, notes.get(c.id)) : null);
  }

  function paint() {
    const list = changeList(store.doc());
    if (!list.length) {
      box.replaceChildren(h('p', { class: 'note' }, 'Nothing yet. Anything Claude changes from a chat shows here, with Undo.'));
      return;
    }
    box.replaceChildren(
      h('ul', { class: 'change-list' }, list.slice(0, shown).map(row)),
      list.length > shown
        ? h('button', { class: 'link', type: 'button', onclick: () => { shown += PAGE; paint(); } }, 'Show more')
        : null);
  }

  paint();
  return box;
}
```

- [ ] **Step 4: Add the group to ⚙** — in `js/ui/settings.js`:

Add to the imports (after the `version.js` import):

```js
import { changesPanel } from './changes.js';
import { changeCountLine } from '../changes.js';
```

Update the file's first comment line to: "// Settings: which version this is at the top, then sync, the day,
the coach, the look, Claude's changes and backups,".

In `dialog.replaceChildren(...)`, insert the group between the `Look` group and the `Backups` group:

```js
    group('Look', lookName, false,
      h('label', { class: 'field' }, h('span', {}, 'Look'), look)),
    group("Claude's changes", changeCountLine(store.doc(), new Date()), false,
      changesPanel(ctx)),
    group('Backups', 'export, or merge one in', false,
```

- [ ] **Step 5: Style it** — append to `styles.css` (only defined tokens, no `px` sizes — the palette
test checks both):

```css
/* ⚙ → Claude's changes */
.change-list { list-style: none; margin: .25rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .75rem; }
.change .change-line { line-height: 1.4; }
.change.undone .change-summary { text-decoration: line-through; color: var(--muted); }
.change details { margin-top: .2rem; }
.change-edits { margin: .25rem 0 .25rem 1rem; padding: 0; font-size: .85rem; color: var(--muted); }
.claude-changes .link { margin-right: .75rem; }
```

- [ ] **Step 6: Put the panel in the offline shell** — in `sw.js`, SHELL's `js/ui/` line gains
`'js/ui/changes.js'` after `'js/ui/flags.js'`:

```js
  'js/ui/widgets.js', 'js/ui/flags.js', 'js/ui/changes.js',
```

`CACHE` stays `'dash-v5'` (bumped in Task 1; both land in the same push).

- [ ] **Step 7: The README** — in `README.md`:

Replace line 8's "Pieces 1 and 5 of 6: the core hub and the Gemini coach." with "Pieces 1, 3 and 5 of
6: the core hub, the Claude skill and the Gemini coach."

In *Using it*, change the Suggestions bullet to: "**Suggestions** from Claude or Gemini show dimmed at
the top: ✓ to take one on, ✕ to dismiss it. Things Claude added because you asked show *added by
Claude*."

Add a section after *Flags* (before *Updates*):

```markdown
## Claude

Claude can read the dashboard and change anything in it from any claude.ai chat — on the web, in the
desktop app or on the phone. Say `/dashboard`, or just "add that to the dashboard", "what's on
today?", "log 45m of Hebrew", "tick off the CV task".

- **What you ask for goes straight on**, marked *added by Claude*. **What Claude notices** — a to-do
  that comes up in a chat — arrives as a suggestion for ✓ or ✕, and a bigger job (an application,
  interview prep) as a suggested goal with its stages and first tasks.
- **Every change Claude makes is listed** in ⚙ → **Claude's changes**, newest first, with *Details*
  (what changed, field by field) and **Undo**. Undo never overwrites something you've changed since — it
  says so instead. Details are kept for 30 days; the one-line summaries for good.
- **Planning with the calendar.** Where the Google Calendar connector is on, Claude checks the
  calendar before picking a day, and offers to book time for bigger tasks.

**How it works.** The skill (`claude/skill/`) clones this public repo into Claude's sandbox and runs
`claude/dash.mjs`, a small command-line tool built on the app's own modules: it reads `data.json`
from `dashboard-sync`, makes the change through the same store and merge, logs it, and writes it
back — to the laptop and the phone, Claude is just a third device. Changes appear at their next sync.

**Setting it up (once).**

1. Make Claude its own key on GitHub: a fine-grained token, *Only select repositories →
   `dashboard-sync`*, *Contents → Read and write*. Keep it separate from the devices' key, so it can be
   revoked on its own.
2. Put it in `~/.dashboard-skill/config.json` (copy `claude/skill/config.example.json` there). It lives
   outside this folder on purpose: this folder syncs to Google Drive, and the key shouldn't.
3. `npm run build-skill` → `~/.dashboard-skill/dashboard-skill.zip`.
4. Upload it at claude.ai → Settings → Capabilities → Skills, with code execution on.

A new key (or a change to `SKILL.md` or `reference.md`) means building and uploading again. A change
to the tool itself doesn't: the skill always runs the version on GitHub.
```

In *How it's built*, add two table rows after `js/version.js`:

```markdown
| `js/changes.js` | Claude's change log: what a change did, and the readers ⚙ uses |
| `claude/` | The command-line tool and the skill Claude runs (`npm run build-skill` zips the skill) |
```

In the data paragraph, the list of maps becomes "`items`, `goals`, `milestones`, `logs`, `journal`
(the coach's check-ins and weekly digests), `flags` (notes of something to change) and `changes`
(what Claude has changed, for ⚙ and Undo)."

In *Tests*, add a sentence at the end: "The Claude tool is tested end to end against a fake GitHub:
every read and op, all-or-nothing batches, London time on a UTC machine, Undo's rules, and the key never
appearing in its output."

In *Roadmap*, item 3 becomes: `3. **Claude skill** — built`.

- [ ] **Step 8: Run the tests**

Run: `npm test` → PASS (the palette and sw tests included).

- [ ] **Step 9: Browser check (controller)**

Serve with `preview_start` `dashboard`, open `http://localhost:8080/dev/seed.html?replace`, then
`http://localhost:8080/?fakegemini`, reload twice. Then, in the console, add a change by hand:

```js
const d = JSON.parse(localStorage.dash_data);
const id = Object.keys(d.items)[0]; const it = d.items[id]; const t = new Date().toISOString();
d.changes = d.changes || {};
d.changes.c1 = { id: 'c1', source: 'claude', status: 'active', created: it.created, archivedOn: null, updated: t, at: t,
  summary: `Edited task "${it.title}": title`, edits: [{ map: 'items', id, before: { ...it, title: 'Before Claude' }, after: it }],
  undoneAt: null, undoneBy: null, pruned: false };
localStorage.dash_data = JSON.stringify(d); location.reload();
```

Check: ⚙ shows *Claude's changes · 1 in the last week*; opening it shows the row; *Details* reads
`task "…": title "Before Claude" → "…"`; **Undo** turns the item's title into *Before Claude* on the
page underneath, the row says *Undone.* and *· undone*, and the Undo button is gone. Reopen ⚙: the
group reads *1 in the last week* and the row is still marked *undone*. Screenshot for the report.

- [ ] **Step 10: Commit**

```bash
git add js/ui/changes.js js/ui/settings.js styles.css sw.js README.md tests/changes-ui.test.js
git commit -m "Show Claude's changes in settings with Details and Undo; document the skill

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
