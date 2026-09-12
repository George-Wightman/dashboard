import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setArranging } from '../js/ui/widgets.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('setArranging flips ui.arranging on ctx and re-renders', () => {
  const calls = [];
  const ctx = { ui: { arranging: false }, render: () => calls.push(ctx.ui.arranging) };
  setArranging(ctx, true);
  assert.equal(ctx.ui.arranging, true);
  setArranging(ctx, false);
  assert.equal(ctx.ui.arranging, false);
  assert.deepEqual(calls, [true, false]);
});

test('the Arrange link sits before ⚙, and the dimmed note is the first thing in Today', () => {
  const html = read('index.html');
  assert.match(html, /<button id="arrange-button" class="link" type="button" aria-pressed="false">Arrange<\/button>\s*<button id="settings-button"/);
  assert.match(html, /<section class="today" aria-label="Today">\s*<p id="arrange-note" class="arrange-note" hidden>Today's list stays here<\/p>\s*<ul id="list"/);
});

test('js/ui/widgets.js builds a frame with a grip or ↑ ↓, Hide, a placeholder, drop zones and the divider', () => {
  const src = read('js/ui/widgets.js');
  assert.match(src, /export function setArranging\(ctx, on\)/);
  assert.match(src, /class: 'widget-frame', 'data-widget': id/);
  assert.match(src, /class: 'grip', draggable: 'true', title: 'Drag to move'/);
  assert.match(src, /class: 'nudge'/);
  assert.match(src, /nudgeWidget\(ctx\.layout\(\), id, -1\)/);
  assert.match(src, /nudgeWidget\(ctx\.layout\(\), id, 1\)/);
  assert.match(src, /'Hide'/);
  assert.match(src, /hideWidget\(ctx\.layout\(\), id\)/);
  assert.match(src, /showWidget\(ctx\.layout\(\), id\)/);
  assert.match(src, /moveWidget\(ctx\.layout\(\), dragged, col, beforeId\)/);
  assert.match(src, /'Nothing to show yet'/);
  assert.match(src, /class: 'drop-zone'/);
  assert.match(src, /'Second column on wide windows'/);
  assert.match(src, /class: 'add-widget'/);
  assert.match(src, /\+ \$\{titleOf\(id\)\}/);
  assert.match(src, /pointer: coarse/);
  assert.match(src, /useNudge = \(ctx\) => ctx\.columnCount\(\) === 1 \|\| isCoarsePointer\(\)/);
  assert.match(src, /content\.inert = true;/);
});

test('styles.css styles the frames, the drop targets and dims the list while arranging', () => {
  const css = read('styles.css');
  for (const selector of [
    '.arrange-note', '.widget-frame', '.widget-bar', '.grip', '.nudge', '.placeholder',
    '.drop-zone', '.column-break', '.add-widget', '.chip',
  ]) {
    assert.ok(css.includes(selector), selector);
  }
  assert.match(css, /\.today\.arranging \.list, \.today\.arranging \.add \{ opacity: \.5; pointer-events: none; \}/);
  assert.match(css, /\.widget-frame > :not\(\.widget-bar\) \{ pointer-events: none; \}/);
});

test("js/app.js wires the Arrange button, the header's Arrange/Done label, and Escape", () => {
  const src = read('js/app.js');
  assert.match(src, /import \{ renderSide, WIDGET_IDS, setArranging \} from '\.\/ui\/widgets\.js';/);
  assert.match(src, /arranging: false,/);
  assert.match(src, /getElementById\('arrange-button'\)\.addEventListener\('click', \(\) => setArranging\(ctx, !ui\.arranging\)\)/);
  assert.match(src, /arrangeButton\.textContent = ui\.arranging \? 'Done' : 'Arrange';/);
  assert.match(src, /arrangeButton\.setAttribute\('aria-pressed', String\(ui\.arranging\)\);/);
  assert.match(src, /classList\.toggle\('arranging', ui\.arranging\)/);
  assert.match(src, /getElementById\('arrange-note'\)\.hidden = !ui\.arranging;/);
  assert.match(src, /getElementById\('list'\)\.inert = ui\.arranging;/);
  assert.match(src, /getElementById\('add'\)\.inert = ui\.arranging;/);
  assert.match(src, /key !== 'Escape' \|\| !ui\.arranging/);
  assert.match(src, /querySelector\('dialog\[open\]'\)/);
  assert.match(src, /getElementById\('editor'\)\.hidden/);
});
