import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../js/data.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the Daylight root sits beside the classic screen, which keeps its ids', () => {
  const html = read('index.html');
  assert.match(html, /<div id="daylight" class="dl" hidden>[\s\S]*id="dl-sky"[\s\S]*id="timeline"[\s\S]*id="tiles"/);
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
