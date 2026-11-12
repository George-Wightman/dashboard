import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THRESHOLDS, trend, risk, rsi14, sigma, moveToday, priceLens, healthLens } from '../planner/stocks-lenses.js';

const rising = (n, start = 100, step = 0.002) => Array.from({ length: n }, (_, i) => start * (1 + step) ** i);

test('THRESHOLDS: the written-down values', () => {
  assert.equal(THRESHOLDS.trendGreen, 0.10);
  assert.equal(THRESHOLDS.trendRed, -0.10);
  assert.equal(THRESHOLDS.riskAmber, 1.5);
  assert.equal(THRESHOLDS.riskRed, 2.5);
  assert.deepEqual(THRESHOLDS.pe, { amber: 1.2, red: 1.5 });
});

test('trend: a steady climb is green and says "Up"', () => {
  const t = trend(rising(300));
  assert.equal(t.dot, 'green');
  assert.match(t.reason, /^Up \d+% over 12 months/);
});

test('trend: flat then a 20% fall is red', () => {
  const closes = [...Array(260).fill(100), ...Array(30).fill(80)];
  assert.equal(trend(closes).dot, 'red');
});

test('trend: under a year of prices is grey', () => {
  assert.equal(trend(rising(100)).dot, 'grey');
});

test('risk: a drawdown well past its usual is amber, then red', () => {
  // A year of small wobbles (typical drawdown ~4%), then a fall.
  const wobble = Array.from({ length: 400 }, (_, i) => 100 * (1 + 0.04 * Math.sin(i / 5)));
  const typical = risk(wobble).typical;
  assert.ok(typical > 0.03 && typical < 0.1, `typical ${typical}`);
  const high = Math.max(...wobble.slice(-252));
  const amber = [...wobble, high * (1 - typical * 2)];
  const red = [...wobble, high * (1 - typical * 3)];
  assert.equal(risk(amber).dot, 'amber');
  assert.equal(risk(red).dot, 'red');
  assert.equal(risk(wobble.slice(0, 20)).dot, 'grey');
});

test('rsi14: a series that only rises is 100; too short is null', () => {
  assert.equal(rsi14(rising(40)), 100);
  assert.equal(rsi14(rising(10)), null);
});

test('sigma and moveToday', () => {
  assert.ok(Math.abs(sigma(rising(100)) - 0) < 1e-9);
  assert.ok(Math.abs(moveToday([100, 110]) - 0.1) < 1e-9);
});

test('priceLens: P/E against its own 5-year median', () => {
  assert.equal(priceLens({ price: 160, epsTtm: 1, peHistory: [100, 100, 100] }).dot, 'red');
  assert.equal(priceLens({ price: 130, epsTtm: 1, peHistory: [100, 100, 100] }).dot, 'amber');
  const g = priceLens({ price: 90, epsTtm: 1, peHistory: [100, 100, 100] });
  assert.equal(g.dot, 'green');
  assert.match(g.reason, /P\/E 90.*median of 100/);
  assert.equal(priceLens({ price: 90, epsTtm: -1, peHistory: [100] }).dot, 'grey');
});

// A slice of SEC company facts: quarterly values for a few us-gaap concepts.
const q = (vals) => ({ units: { USD: vals.map((val, i) => ({ val, fp: `Q${(i % 4) + 1}`, form: '10-Q', end: `2025-${String(i + 1).padStart(2, '0')}-28` })) } });
const facts = (over = {}) => ({ facts: { 'us-gaap': {
  Revenues: q([100, 100, 100, 100, 100, 100, 100, 100]),
  GrossProfit: q([60, 60, 60, 60, 60, 60, 60, 60]),
  OperatingIncomeLoss: q([30, 30, 30, 30, 30, 30, 30, 30]),
  StockholdersEquity: q([500, 500, 500, 500, 500, 500, 500, 500]),
  LongTermDebt: q([50, 50, 50, 50, 50, 50, 50, 50]),
  ...over,
} } });

test('healthLens: high steady margins and little debt are green', () => {
  const h = healthLens(facts());
  assert.equal(h.dot, 'green');
  assert.match(h.reason, /60% gross margin/);
});

test('healthLens: no gross profit reported is grey', () => {
  const f = facts(); delete f.facts['us-gaap'].GrossProfit;
  assert.equal(healthLens(f).dot, 'grey');
  assert.equal(healthLens(null).dot, 'grey');
});

test('healthLens: losses and heavy debt are red', () => {
  const h = healthLens(facts({ OperatingIncomeLoss: q([-10, -10, -10, -10, -10, -10, -10, -10]), LongTermDebt: q(Array(8).fill(5000)) }));
  assert.equal(h.dot, 'red');
});
