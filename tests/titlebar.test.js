import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SKY_TOP } from '../js/sky.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test("the title bar takes the sky's top colour in every phase, the same as the CSS draws", () => {
  const css = read('styles/daylight.css');
  for (const [phase, colour] of Object.entries(SKY_TOP)) {
    const rule = css.match(new RegExp(`\\.dl-sky\\[data-phase="${phase}"\\] \\{ --s1: (#[0-9A-Fa-f]{6})`));
    assert.ok(rule, phase);
    assert.equal(rule[1].toUpperCase(), colour.toUpperCase(), phase);
  }
  assert.match(read('js/ui/sky.js'), /theme-color[\s\S]*SKY_TOP\[phase\]/);
  assert.match(read('js/app.js'), /if \(meta && !daylight\(\)/, 'the classic look leaves Daylight\'s title bar to the sky');
});
