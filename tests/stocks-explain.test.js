import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LENS_KEYS, lensExplainer, termExplainer, splitTerms, verdictExplainer, ADD_EXPLAINER } from '../js/stocks-explain.js';
import { LENSES } from '../js/stocks.js';

test('every lens has an explainer with what, look, a four-colour scale and a reading', () => {
  assert.deepEqual(LENS_KEYS, LENSES);
  for (const k of LENSES) {
    const e = lensExplainer(k, { dot: 'green', reason: 'x' });
    assert.ok(e.what && e.look && e.yours, k);
    assert.deepEqual(e.scale.map(([d]) => d), ['green', 'amber', 'red', 'grey']);
  }
  assert.equal(lensExplainer('nope'), null);
});

test('price: turns the P/E and its median into plain words', () => {
  const e = lensExplainer('price', { dot: 'green', reason: 'P/E 21, below its 2-year median of 39' });
  assert.match(e.yours, /about 21 times its yearly profit/);
  assert.match(e.yours, /less than the 39 times/);
  assert.match(e.yours, /Cheap or fair/);
  assert.match(lensExplainer('price', { dot: 'red', reason: 'P/E 60, above its 2-year median of 30' }).yours, /Expensive/);
});

test('trend: up, down and flat each read differently', () => {
  assert.match(lensExplainer('trend', { dot: 'green', reason: 'Up 23% over 12 months' }).yours, /up 23%.*agreeing/);
  assert.match(lensExplainer('trend', { dot: 'red', reason: 'Down 41% over 12 months' }).yours, /down 41%.*against/);
  assert.match(lensExplainer('trend', { dot: 'amber', reason: 'Flat over 12 months' }).yours, /flat/i);
});

test('a soft or SEC tag is dropped from the reading; grey on a fund says why', () => {
  const y = lensExplainer('health', { dot: 'amber', reason: '19% gross margin; gross margin under 40% (SEC accounts)' }).yours;
  assert.match(y, /^Amber/);
  assert.doesNotMatch(y, /SEC accounts/);
  assert.match(lensExplainer('health', { dot: 'grey', reason: "doesn't apply to a fund" }, 'market').yours, /fund/);
});

test('splitTerms: finds jargon, longest name first, whole words only', () => {
  const parts = splitTerms('75% gross margin, 65% operating margin, 59% return on capital');
  assert.deepEqual(parts.filter((p) => p.term).map((p) => p.term), ['gross margin', 'operating margin', 'return on capital']);
  assert.equal(parts.map((p) => p.text).join(''), '75% gross margin, 65% operating margin, 59% return on capital');
  assert.deepEqual(splitTerms('P/E 21, below its 2-year median of 39').filter((p) => p.term).map((p) => p.term), ['P/E', 'median']);
  assert.deepEqual(splitTerms('RSI 61').map((p) => p.term), ['RSI', null]);
  assert.deepEqual(splitTerms('Nothing here'), [{ text: 'Nothing here', term: null }]);
  assert.deepEqual(splitTerms(''), []);
});

test('termExplainer: case-insensitive, null when unknown', () => {
  assert.equal(termExplainer('GROSS MARGIN').key, 'gross margin');
  assert.match(termExplainer('P/E').what, /each £1 of yearly profit/);
  assert.equal(termExplainer('ebitda'), null);
});

test('verdictExplainer: says how it is worked out, and that disagrees is not "sell"', () => {
  assert.match(verdictExplainer('disagrees', 'watched').yours, /doesn’t mean sell/);
  assert.match(verdictExplainer('mixed', 'market').look, /trend and risk/);
  assert.match(verdictExplainer(null, 'pie').yours, /cashback/);
  assert.match(ADD_EXPLAINER.look, /never advice/);
});
