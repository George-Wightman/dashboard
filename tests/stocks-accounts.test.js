import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountsPatch } from '../claude/stocks-accounts.js';
import { quarters } from '../planner/stocks-lenses.js';

const q = (vals, from = 2024) => ({ units: { USD: vals.map((val, i) => ({ val, fp: `Q${(i % 4) + 1}`, form: '10-Q', end: `${from + Math.floor(i / 4)}-${String((i % 4) * 3 + 3).padStart(2, '0')}-28` })) } });
const eps = (vals) => ({ units: { 'USD/shares': q(vals).units.USD } });
const facts = { facts: { 'us-gaap': {
  Revenues: q(Array(8).fill(100)), GrossProfit: q(Array(8).fill(60)), OperatingIncomeLoss: q(Array(8).fill(30)),
  StockholdersEquity: q(Array(8).fill(500)), LongTermDebt: q(Array(8).fill(50)), EarningsPerShareDiluted: eps(Array(8).fill(1)),
} } };
const days = Array.from({ length: 300 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 86400000));
const yahoo = JSON.stringify({ chart: { result: [{ meta: { currency: 'USD' }, timestamp: days.map((d) => d / 1000), indicators: { quote: [{ close: days.map(() => 80) }] } }] } });
const desk = {
  symbols: {
    AAA_US_EQ: { ticker: 'AAA', yahoo: 'AAA', cik: '123', ccy: 'USD' },
    BBB_US_EQ: { ticker: 'BBB', yahoo: 'BBB', cik: null, ccy: 'USD' },
    PIEl_EQ: { ticker: 'PIE', yahoo: 'PIE.L', cik: '999', ccy: 'GBp' },
  },
  tiers: { AAA: 'watched', BBB: 'watched', PIE: 'pie' },
};

test('accountsPatch: a watched US company gets health and price lens notes from its accounts', async () => {
  const asked = [];
  const fetchText = async (url, headers) => {
    asked.push([url, headers.contact]);
    return url.includes('sec.gov') ? { status: 200, text: JSON.stringify(facts) } : { status: 200, text: yahoo };
  };
  const r = await accountsPatch({ desk, fetchText, contact: 'Someone a@b.c' });
  assert.deepEqual(Object.keys(r.lensNotes), ['AAA']);
  assert.equal(r.lensNotes.AAA.health.dot, 'green');
  assert.match(r.lensNotes.AAA.price.reason, /^P\/E 20/);
  assert.ok(asked.some(([u, c]) => u.includes('CIK0000000123') && c === 'Someone a@b.c'));
  assert.ok(!asked.some(([u]) => u.includes('999')), 'the pie is never asked for');
  assert.deepEqual(r.done, ['AAA']);
});

test('accountsPatch: a refused company is listed as failed, the others still done', async () => {
  const fetchText = async (url) => ({ status: url.includes('sec.gov') ? 403 : 200, text: yahoo });
  const r = await accountsPatch({ desk, fetchText, contact: 'x' });
  assert.deepEqual(r.lensNotes, {});
  assert.deepEqual(r.failed, ['AAA (SEC 403)']);
});

test('healthLens: no gross profit reported, so revenue minus cost of revenue', async () => {
  const { healthLens } = await import('../planner/stocks-lenses.js');
  const f = structuredClone(facts);
  delete f.facts['us-gaap'].GrossProfit;
  f.facts['us-gaap'].CostOfRevenue = q(Array(8).fill(40));
  const h = healthLens(f);
  assert.equal(h.dot, 'green');
  assert.match(h.reason, /^60% gross margin/);
});

test('peHistory: two years at most, since older earnings in SEC data are not split-adjusted', async () => {
  const { peHistory } = await import('../planner/stocks.js');
  const series = Array.from({ length: 1300 }, (_, i) => ({ day: new Date(Date.UTC(2021, 0, 1) + i * 86400000 * 1.4).toISOString().slice(0, 10), close: 100 }));
  const e = Array.from({ length: 24 }, (_, i) => ({ end: new Date(Date.UTC(2020, 0, 1) + i * 91 * 86400000).toISOString().slice(0, 10), val: 1 }));
  assert.ok(peHistory(series, e).length <= 24);
});

test('quarters: of two revenue concepts, the one reported most recently wins', () => {
  const old = { units: { USD: [1, 2, 3, 4].map((v, i) => ({ val: v, fp: `Q${i + 1}`, form: '10-Q', end: `2017-0${i + 1}-28` })) } };
  const now = { units: { USD: [10, 20, 30, 40].map((v, i) => ({ val: v, fp: `Q${i + 1}`, form: '10-Q', end: `2026-0${i + 1}-28` })) } };
  const f = { facts: { 'us-gaap': { Revenues: old, RevenueFromContractWithCustomerExcludingAssessedTax: now } } };
  assert.deepEqual(quarters(f, ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax']).map((x) => x.val), [10, 20, 30, 40]);
});
