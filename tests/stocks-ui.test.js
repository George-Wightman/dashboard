import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stocksView } from '../js/stocks.js';
import { tileParts, cardParts, usageLine } from '../js/ui/stocks.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const TODAY = '2026-11-12';
const view = (m = load('stocks-market.json'), d = load('stocks-desk.json')) => stocksView(m, d, TODAY);
const row = (v, t) => v.themes.flatMap((x) => x.rows).find((r) => r.ticker === t);

test('tileParts: a quiet day, Claude\'s looks, theme chips with colour dots', () => {
  const p = tileParts(view());
  assert.equal(p.verdict, 'Nothing that changes your view today.');
  assert.equal(p.quiet, true);
  assert.equal(p.looked, 'Looked at 2 today');
  assert.deepEqual(p.chips.map((c) => [c.name, c.dot]), [['Chips', 'amber'], ['Power', 'amber']]); // Power's only company (CCC) is mixed
  assert.equal(p.coming.length, 1);
  assert.equal(p.look.ticker, 'CCC');
  assert.equal(p.value, '£328');
  assert.equal(p.move, '+0.8% today');
});

test('tileParts: the Pie is never a chip; no desk says there is no brief', () => {
  const p = tileParts(view(undefined, null));
  assert.equal(p.verdict, 'No brief yet');
  assert.equal(p.chips.length, 0);
  assert.equal(p.value, '£328');
});

test('cardParts: thesis, verdict line, five lenses in order, Claude\'s next note', () => {
  const c = cardParts(row(view(), 'AAA'), TODAY);
  assert.equal(c.thesis, 'The default chip, locked in by its software.');
  assert.equal(c.verdictLine, 'Numbers agree with you — 4 of 5');
  assert.deepEqual(c.lenses.map((l) => l.name), ['Trend', 'Price', 'Health', 'Expectations', 'Risk']);
  assert.equal(c.notes.next, 'Next: Sat 14 Nov — Check guidance on results.');
  assert.equal(c.notes.thinking, 'Stretched on price; fine while forecasts rise.');
  assert.equal(c.notes.lastLooked, 'Last looked today');
  assert.equal(c.notes.earlier.length, 2);
  assert.match(c.small, /RSI 61/);
});

test('cardParts: disagreement and a moment to add read plainly', () => {
  assert.equal(cardParts(row(view(), 'BBB'), TODAY).verdictLine, 'Numbers disagree with you');
  const ccc = cardParts(row(view(), 'CCC'), TODAY);
  assert.equal(ccc.add, 'A moment to add? Your thesis holds and the price has dipped.');
});

test('usageLine: runs, searches, tokens and share of the weekly limit', () => {
  assert.equal(usageLine(view().usage), 'This week: 2 runs, 5 searches, ~70k tokens, 2% of your weekly limit');
  assert.equal(usageLine({ runs: 0, searches: 0, tokens: null, pct: null }), 'This week: no runs yet');
});

test('the stocks view never uses weather icons and gives buy/sell no voice', () => {
  const src = readFileSync(new URL('../js/ui/stocks.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /ti-sun|ti-cloud|weather/);
  assert.doesNotMatch(src, /\b(Buy|Sell)\b/);
});
