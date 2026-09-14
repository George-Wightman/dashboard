import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceLabel, LOGOS, SOURCE_NAMES } from '../js/ui/sources.js';
import { splitRows, pipState, compactProgress } from '../js/ui/today.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('sourceLabel: the words behind a row\'s logo', () => {
  assert.equal(sourceLabel('claude'), 'added by Claude');
  assert.equal(sourceLabel('gemini', 'suggested'), 'suggested by Gemini');
  assert.equal(sourceLabel('hebrew'), 'added by Hebrew app');
  assert.equal(sourceLabel('me'), null);
  assert.equal(sourceLabel(undefined), null);
  assert.equal(sourceLabel('someone'), null);
  // a suggestion always says who it's from
  assert.equal(sourceLabel('someone', 'suggested'), 'suggested by someone');
  assert.deepEqual(Object.keys(SOURCE_NAMES), ['claude', 'gemini', 'hebrew', 'notion']);
});

test('the logos are drawn in the app\'s own colour, never the companies\'', () => {
  assert.deepEqual(Object.keys(LOGOS), ['claude', 'gemini']);
  for (const svg of Object.values(LOGOS)) {
    assert.match(svg, /^<svg viewBox="0 0 24 24" aria-hidden="true"/);
    assert.match(svg, /currentColor/);
    assert.doesNotMatch(svg, /#[0-9a-f]{3,6}\b|rgb\(/i);
  }
});

test('splitRows: weekly targets go to the foot, in order; suggestions stay on top', () => {
  const r = (id, kind, extra = {}) => ({ item: { id }, kind, suggested: false, done: false, ...extra });
  const rows = [
    r('s1', 'quota', { suggested: true }), r('t1', 'task'), r('q1', 'quota'), r('h1', 'habit'),
    r('t2', 'task', { done: true }), r('q2', 'quota', { done: true }),
  ];
  const { main, week } = splitRows(rows);
  assert.deepEqual(main.map((x) => x.item.id), ['s1', 't1', 'h1', 't2']);
  assert.deepEqual(week.map((x) => x.item.id), ['q1', 'q2']);
  assert.deepEqual(splitRows([]), { main: [], week: [] });
});

test('pipState: one dot per time a week, filled for each tick, never more dots than times', () => {
  assert.deepEqual(pipState(0, 3), [false, false, false]);
  assert.deepEqual(pipState(2, 5), [true, true, false, false, false]);
  assert.deepEqual(pipState(7, 5), [true, true, true, true, true]);
});

test('compactProgress: the count a weekly target shows in its row', () => {
  assert.equal(compactProgress(0, 3, 'count'), '0/3');
  assert.equal(compactProgress(4, 3, 'count'), '4/3');
  assert.equal(compactProgress(0, 300, 'minutes'), '0/5h');
});

test('the list lines up: a grid of six columns, each row a subgrid, one-line titles', () => {
  const css = read('styles.css');
  assert.match(css, /\.list \{[^}]*display: grid; grid-template-columns: 1\.4rem minmax\(0, 1fr\) repeat\(4, auto\);/);
  assert.match(css, /\.row \{[^}]*grid-template-columns: subgrid;/);
  assert.match(css, /\.row \.meta \{ display: contents;/);
  assert.match(css, /\.row \.title \{[^}]*text-overflow: ellipsis; white-space: nowrap;/);
  assert.doesNotMatch(read('js/ui/today.js'), /added by \$\{/);
});

test("the list shows today's times in the day's order; lengths and times in the add box and the edit panel", () => {
  const today = read('js/ui/today.js');
  assert.match(today, /timedOrder\(main, slots\)/);
  assert.match(today, /splitTaskInput\(/);
  assert.match(today, /if \(!row\.suggested && !slot\) enableDrag/);
  assert.match(read('styles.css'), /\.row \.time \{[^}]*font-variant-numeric: tabular-nums;/);
  const edit = read('js/ui/edit.js');
  assert.ok(edit.includes("field('Length (optional)'"), 'Length field');
  assert.ok(edit.includes("field('Time (optional)'"), 'Time field');
  const html = read('index.html');
  assert.match(html, /<span id="planner-warning" class="warning" hidden><\/span>/);
  assert.match(html, /<div id="planner-notes" class="planner-notes" hidden><\/div>/);
  assert.match(read('js/ui/claude.js'), /section\('Calendar planner', \.\.\.plannerSummary\(doc, new Date\(\)\)\.lines/);
  assert.match(read('js/app.js'), /visibleNotes\(plannerNotes\(store\.doc\(\), today\), hiddenNotes\(\), today\)/);
});

test("Claude's controls on the page: ★, the notes mark, the brief and time off, off days, Notes, ⚙ → Claude", () => {
  const today = read('js/ui/today.js');
  assert.match(today, /isPriority\(doc, row\.item, config\)/);
  assert.match(today, /item\.notes \? noteMark\(item, ctx\) : null/);
  assert.match(today, /h\('li', \{ class: 'note-row' \}, row\.item\.notes\)/);
  const app = read('js/app.js');
  assert.match(app, /shown\(brief\) \? line\('brief', brief, mark\('claude', 'From Claude'\)\) : null/);
  assert.match(app, /waiting && shown\(waiting\.text\) \? line\('coach-line', waiting\.text, mark\('gemini', 'From the Coach'\), reply\) : null/);
  assert.match(app, /shown\(off\) \? line\('off', off\) : null/);
  assert.match(read('js/ui/side.js'), /\}, 'off'\);/);
  assert.equal((read('js/ui/edit.js').match(/notesField\(\),/g) ?? []).length, 2, 'Notes on items and goals');
  const css = read('styles.css');
  for (const rule of ['.row .star', '.row .note-mark', '.note-row', '.planner-notes .brief', '.cell.off', '.claude-panel h4']) assert.ok(css.includes(`${rule} {`), rule);
});

test('offText and what Claude can do', async () => {
  const { offText, CLAUDE_CAN } = await import('../js/ui/claude.js');
  assert.equal(offText({ start: '2026-09-16', end: '2026-09-17', areas: ['Job search'], reason: 'Maya leaves for Austria' }),
    'Wed 16 Sep – Thu 17 Sep — Maya leaves for Austria · Job search');
  assert.equal(offText({ start: '2026-09-18T13:00', end: '2026-09-18T19:00', areas: [], reason: '' }), 'Fri 18 Sep, 13:00–19:00 — Time off · everything');
  assert.equal(CLAUDE_CAN.length, 10);
});
