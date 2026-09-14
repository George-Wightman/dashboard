import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WIDGETS, WIDGET_IDS } from '../js/ui/widgets.js';
import { DEFAULT_LAYOUT, normalizeLayout, visibleColumns } from '../js/layout.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the widgets: Coach, This week, Goals, Last 3 weeks', () => {
  assert.deepEqual(WIDGETS.map((w) => [w.id, w.title]), [
    ['coach', 'Coach'], ['week', 'This week'], ['goals', 'Goals'], ['history', 'Last 3 weeks'],
  ]);
  assert.deepEqual(WIDGET_IDS, ['coach', 'week', 'goals', 'history']);
  for (const w of WIDGETS) assert.equal(typeof w.render, 'function', w.id);
});

test('the default arrangement places every widget, and only widgets; This week starts hidden', () => {
  assert.deepEqual(normalizeLayout(DEFAULT_LAYOUT, WIDGET_IDS), DEFAULT_LAYOUT);
  assert.deepEqual([...DEFAULT_LAYOUT.columns.flat(), ...DEFAULT_LAYOUT.hidden].sort(), [...WIDGET_IDS].sort());
  assert.deepEqual(DEFAULT_LAYOUT.hidden, ['week']);
  assert.deepEqual(visibleColumns(DEFAULT_LAYOUT, 1), [['coach', 'goals', 'history']]);
});

test('styles.css and js/app.js agree on the page width and the columns', () => {
  const css = read('styles.css');
  assert.doesNotMatch(css, /max-width: 1100px/);
  assert.match(css, /\.top \{[^}]*width: min\(88vw, 1500px\);[^}]*padding: 1\.5rem 0 \.75rem;/);
  assert.match(css, /\.layout \{[^}]*grid-template-columns: minmax\(0, 1fr\) 340px;[^}]*width: min\(88vw, 1500px\);/);
  assert.match(css, /@media \(min-width: 1500px\) \{\s*\.layout \{ grid-template-columns: minmax\(0, 1\.8fr\) minmax\(0, 1fr\) minmax\(0, 1fr\); \}\s*\.side \{[^}]*grid-column: 2 \/ 4;[^}]*grid-template-columns: subgrid;/);
  assert.match(css, /@media \(max-width: 759px\) \{\s*\.layout \{ grid-template-columns: 1fr; \}/);
  assert.match(read('js/app.js'), /matchMedia\('\(min-width: 1500px\)'\)/);
});

test('the widget area keeps its id, so typing protection and focus restore still find it', () => {
  assert.match(read('index.html'), /<aside id="side" class="side" aria-label="Widgets"><\/aside>/);
  assert.match(read('js/app.js'), /closest\('#list, #side'\)/);
  assert.match(read('js/ui/side.js'), /#side \[data-focus="coach-shape"\]/);
  assert.match(read('js/ui/widgets.js'), /keptFocus\(side\)[\s\S]*restoreFocus\(side, kept\)/);
});
