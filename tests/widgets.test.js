import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WIDGETS, WIDGET_IDS } from '../js/ui/widgets.js';
import { DEFAULT_LAYOUT, normalizeLayout, visibleColumns } from '../js/layout.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the widgets: Upcoming, Countdown, This week, Goals, Last 3 weeks, Hebrew, Gym, Muscles, Cardio trend', () => {
  assert.deepEqual(WIDGETS.map((w) => [w.id, w.title]), [
    ['agenda', 'Upcoming'], ['countdown', 'Countdown'], ['week', 'This week'], ['goals', 'Goals'], ['history', 'Last 3 weeks'],
    ['hebrew', 'Hebrew'], ['gym', 'Gym'], ['muscles', 'Muscles'], ['cardio', 'Cardio trend'],
  ]);
  assert.deepEqual(WIDGET_IDS, ['agenda', 'countdown', 'week', 'goals', 'history', 'hebrew', 'gym', 'muscles', 'cardio']);
  for (const w of WIDGETS) assert.equal(typeof w.render, 'function', w.id);
});

test('the default arrangement places every widget, and only widgets; none starts hidden', () => {
  assert.deepEqual(normalizeLayout(DEFAULT_LAYOUT, WIDGET_IDS), DEFAULT_LAYOUT);
  assert.deepEqual([...DEFAULT_LAYOUT.under, ...DEFAULT_LAYOUT.columns.flat(), ...DEFAULT_LAYOUT.hidden].sort(), [...WIDGET_IDS].sort());
  assert.deepEqual(DEFAULT_LAYOUT.hidden, []);
  assert.deepEqual(visibleColumns(DEFAULT_LAYOUT, 1), [['countdown', 'week', 'muscles', 'cardio', 'history', 'hebrew', 'gym']]);
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
  assert.match(read('index.html'), /<ul id="list" class="list"><\/ul>\s*<div id="under" class="under" aria-label="Widgets under the list" hidden><\/div>/);
  assert.match(read('js/app.js'), /closest\('#list, #under, #side'\)/);
  assert.match(read('js/ui/checkin.js'), /'data-focus': `checkin-\$\{rec\.id\}`/);
  assert.match(read('js/ui/widgets.js'), /keptFocus\(side\) \?\? keptFocus\(under\)[\s\S]*restoreFocus\(side, kept\);\s*restoreFocus\(under, kept\);/);
});
