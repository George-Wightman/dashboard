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
