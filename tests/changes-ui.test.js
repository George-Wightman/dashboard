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
  // replaceChildren prints a null as the text "null": the Show more slot is filtered out when empty.
  assert.match(src, /box\.replaceChildren\(\.\.\.\[[^\]]*more\]\.filter\(Boolean\)\)/);
});

test('⚙ has a folded Claude group — its count line, and the changes inside it — before Backups', () => {
  const settings = read('js/ui/settings.js');
  assert.match(settings, /import \{ claudePanel, claudeSummary \} from '\.\/claude\.js';/);
  assert.match(settings, /group\('Claude', claudeSummary\(store\.doc\(\), store\.today\(\), new Date\(\)\), false,[\s\S]*?claudePanel\(ctx\)\),\s*group\('Backups'/);
  const panel = read('js/ui/claude.js');
  assert.match(panel, /import \{ changesPanel \} from '\.\/changes\.js';/);
  assert.match(panel, /import \{ changeCountLine \} from '\.\.\/changes\.js';/);
  assert.match(panel, /section\('Changes', changesPanel\(ctx\)\)/);
});

test('styles.css styles the change list', () => {
  const css = read('styles.css');
  for (const selector of ['.change-list', '.change.undone', '.change-edits']) assert.ok(css.includes(selector), selector);
});

test('the README explains the skill, the change log and the key', () => {
  const readme = read('README.md');
  for (const phrase of ['## Claude', '**⚙ → Claude**', 'every change Claude makes', 'npm run build-skill', '~/.dashboard-skill',
    '3. **Claude skill** — built', '`js/changes.js`', '`claude/`']) {
    assert.ok(readme.includes(phrase), phrase);
  }
});
