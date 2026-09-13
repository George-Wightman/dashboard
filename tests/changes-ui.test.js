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
