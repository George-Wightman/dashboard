// Daylight's colours keep text readable: every text-on-ground pair at 4.5:1 or better, by day and
// by night. Reads the token blocks out of styles/daylight.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../styles/daylight.css', import.meta.url), 'utf8');
const block = (sel) => {
  const m = CSS.match(new RegExp(`(?:^|\\n)${sel}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `no rule for ${sel}`);
  return Object.fromEntries([...m[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)].map(([, k, v]) => [k, v]));
};
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const PAIRS = [['--dl-ink', '--dl-ground'], ['--dl-muted', '--dl-ground'], ['--dl-ink', '--dl-card'], ['--dl-muted', '--dl-card'],
  ['--dl-on-body', '--dl-body'], ['--dl-on-fuel', '--dl-fuel'], ['--dl-on-hebrew', '--dl-hebrew'], ['--dl-on-needs', '--dl-needs'], ['--dl-carry-ink', '--dl-carry']];
const DAY = ':root\\[data-screen="daylight"\\]';
const NIGHT = ':root\\[data-screen="daylight"\\]\\[data-theme="night"\\]';

for (const [name, sel] of [['day', DAY], ['night', NIGHT]]) {
  test(`${name} tokens keep text at 4.5:1`, () => {
    const t = { ...block(DAY), ...block(sel) };
    for (const [fg, bg] of PAIRS) {
      assert.ok(t[fg] && t[bg], `${name}: ${fg} or ${bg} missing`);
      assert.ok(ratio(t[fg], t[bg]) >= 4.5, `${name}: ${fg} on ${bg} is ${ratio(t[fg], t[bg]).toFixed(2)}`);
    }
  });
}
