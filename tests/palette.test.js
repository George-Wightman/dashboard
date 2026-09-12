import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { THEME_COLORS } from '../js/look.js';

const CSS = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// Every .js file under js/, as text.
function jsSources(dir = new URL('../js/', import.meta.url)) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? jsSources(new URL(`${e.name}/`, dir))
    : e.name.endsWith('.js') ? [readFileSync(new URL(e.name, dir), 'utf8')] : []));
}

// The design's table, verbatim.
const PAPER = {
  '--bg': '#f5f0e7', '--panel': '#fffdf8', '--ink': '#22303c', '--muted': '#6b7a88', '--border': '#e4ded1',
  '--accent': '#0d6e6e', '--accent-soft': '#e3f0ee', '--gold': '#b3803a', '--warn': '#c07a2e', '--bad': '#b3453a',
  '--lvl1': '#e3f0ee', '--lvl2': '#b8d9d4', '--lvl3': '#6fb0a7', '--lvl4': '#0d6e6e',
};
const NIGHT = {
  '--bg': '#1c232b', '--panel': '#252e38', '--ink': '#eef1ed', '--muted': '#a8b3be', '--border': '#36424e',
  '--accent': '#4fb8ac', '--accent-soft': '#20413f', '--gold': '#e0ae62', '--warn': '#eb9a52', '--bad': '#f0806f',
  '--lvl1': '#20413f', '--lvl2': '#2d6660', '--lvl3': '#3f958b', '--lvl4': '#4fb8ac',
};

// The body of the first rule whose selector matches `selector` (a regex source), as text.
function blockText(selector) {
  const m = CSS.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `no rule for ${selector}`);
  return m[1];
}
const vars = (text) => Object.fromEntries([...text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
const PAPER_SEL = ':root,\\s*:root\\[data-theme="paper"\\]';
const NIGHT_SEL = ':root\\[data-theme="night"\\]';
const SHARED_SEL = '(?:^|\\n):root';

// Every simple rule (no nested braces) as [selector, body], comments removed; rules inside @media
// come out too.
const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = () => [...BARE.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => [sel.trim().replace(/\s+/g, ' '), body]);

test("Paper and Night carry the design's palette exactly", () => {
  assert.deepEqual(vars(blockText(PAPER_SEL)), PAPER);
  assert.deepEqual(vars(blockText(NIGHT_SEL)), NIGHT);
});

test('a page with no data-theme is Paper, and each look sets its color-scheme', () => {
  assert.match(CSS, /(?:^|\n):root,\s*:root\[data-theme="paper"\]\s*\{/);
  assert.match(blockText(PAPER_SEL), /color-scheme:\s*light;/);
  assert.match(blockText(NIGHT_SEL), /color-scheme:\s*dark;/);
});

test("the title-bar colours are each look's --bg", () => {
  assert.equal(THEME_COLORS.paper, PAPER['--bg']);
  assert.equal(THEME_COLORS.night, NIGHT['--bg']);
});

test('the look no longer follows the operating system', () => {
  assert.doesNotMatch(CSS, /prefers-color-scheme/);
});

test('one vocabulary: the old token names are gone, and every var() used is defined', () => {
  const sources = [CSS, ...jsSources()];
  for (const src of sources) assert.doesNotMatch(src, /--(?:surface|text|line|carry|danger)\b/);
  const defined = new Set([...Object.keys(vars(blockText(PAPER_SEL))), ...Object.keys(vars(blockText(SHARED_SEL)))]);
  assert.deepEqual(Object.keys(vars(blockText(NIGHT_SEL))).sort(), Object.keys(PAPER).sort());
  for (const name of ['--radius', '--radius-sm', '--font', '--display']) assert.ok(defined.has(name), name);
  for (const src of sources) {
    for (const [, name] of src.matchAll(/var\((--[\w-]+)/g)) assert.ok(defined.has(name), `${name} is not defined`);
  }
});

test('type: 15px, 17px from 1100px wide; the date heading in Georgia', () => {
  assert.match(CSS, /(?:^|\n)html\s*\{\s*font-size:\s*15px;\s*\}/);
  assert.match(CSS, /@media \(min-width: 1100px\)\s*\{\s*html\s*\{\s*font-size:\s*17px;\s*\}\s*\}/);
  assert.equal(vars(blockText(SHARED_SEL))['--display'], 'Georgia, "Times New Roman", serif');
  const body = rules().find(([sel]) => sel === 'body');
  assert.match(body[1], /font:\s*1rem\/1\.45 var\(--font\)/);
  const h1 = rules().find(([sel]) => sel === '.top h1');
  assert.match(h1[1], /font-family:\s*var\(--display\)/);
});

test('fixed sizes are in rem (borders, outlines, shadows, media queries and page widths aside)', () => {
  const sized = /^(?:font-size|font|border-radius|gap|row-gap|column-gap|height|width|min-height|padding(?:-\w+)?|margin(?:-\w+)?|letter-spacing|line-height)$/;
  for (const [sel, body] of rules()) {
    if (sel === 'html') continue;
    for (const decl of body.split(';')) {
      const [prop, ...rest] = decl.split(':');
      if (!sized.test(prop.trim())) continue;
      const value = rest.join(':').replace(/(?:min|max|clamp)\([^)]*\)/g, '');
      assert.doesNotMatch(value, /\d+px/, `${sel} { ${decl.trim()} }`);
    }
  }
});

test('gold means "you did this" and is used for nothing else', () => {
  const gold = rules().filter(([, body]) => body.includes('var(--gold)')).map(([sel]) => sel).sort();
  assert.deepEqual(gold, ['.bar.met > span', '.met', '.streak']);
  const amber = rules().filter(([, body]) => body.includes('var(--warn)')).map(([sel]) => sel).sort();
  assert.deepEqual(amber, ['.carry', '.coach h2 .fake']);
});
