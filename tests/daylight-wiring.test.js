import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../js/data.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the Daylight root sits beside the classic screen, which keeps its ids', () => {
  const html = read('index.html');
  // No `hidden` attribute: styles.css forces [hidden] with !important, so CSS on data-screen alone decides.
  assert.match(html, /<div id="daylight" class="dl">[\s\S]*id="dl-sky"[\s\S]*id="timeline"[\s\S]*id="tiles"/);
  assert.match(read('styles/daylight.css'), /\.dl \{ display: none; \}\s*:root\[data-screen="daylight"\] \.dl \{ display: block; \}/);
  assert.match(html, /<ul id="list" class="list"><\/ul>/);
  assert.match(html, /href="styles\/daylight\.css"/);
  assert.doesNotMatch(html + read('styles/daylight.css'), /fonts\.googleapis\.com/);
});

test('the screen and place settings default to classic and auto', () => {
  assert.equal(DEFAULT_SETTINGS.screen, 'classic');
  assert.equal(DEFAULT_SETTINGS.place, 'auto');
});

test('every new file is in the offline shell', () => {
  const sw = read('sw.js');
  for (const f of ['styles/daylight.css', 'js/sky.js', 'js/timeline.js', 'js/header.js', 'js/needs.js', 'js/tiles.js']) assert.ok(sw.includes(`'${f}'`), f);
});

test('the head script picks the screen before paint, from the setting or ?daylight', () => {
  const html = read('index.html');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.match(script, /dataset\.screen/);
  assert.match(script, /daylight/);
});

test('typing protection and focus restore cover the Daylight areas', () => {
  assert.match(read('js/app.js'), /closest\('#list, #under, #side, #timeline, #tiles, #dl-sky'\)/);
  assert.match(read('js/ui/timeline.js'), /keptFocus\(root\)[\s\S]*restoreFocus\(root, kept\)/);
});

test('the timeline reuses the classic rows and check-in, and drag no longer assumes #list', () => {
  const tl = read('js/ui/timeline.js');
  assert.match(tl, /renderRow\(/);
  assert.match(tl, /renderCheckin\(ctx\)/);
  assert.match(tl, /Nothing on today\. Tell Claude what you want to get done\./);
  assert.doesNotMatch(read('js/ui/today.js'), /querySelectorAll\('#list li\.row/);
});

test('motion stops for reduced motion', () => {
  assert.match(read('styles/daylight.css'), /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*animation: none/);
});

test('the tile registry has the seven tiles, in the default order, each with a renderer', () => {
  const src = read('js/ui/tiles.js');
  for (const id of ['needs', 'body', 'hebrew', 'goals', 'weeks', 'countdown', 'week']) assert.match(src, new RegExp(`id: '${id}'`));
  assert.match(src, /setTiles\(/);
});

test('Needs you resolves through the existing conflict path', () => {
  assert.match(read('js/ui/needs.js'), /resolveConflict\(ctx, /);
  assert.match(read('js/ui/needs.js'), /needsCopy\(/);
});

test('another window rearranging tiles is followed', () => {
  assert.match(read('js/app.js'), /e\.key === TILES_KEY/);
});
