import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStocks } from '../planner/stocks.js';
import { encodeBase64, decodeBase64 } from '../js/sync.js';

// 12 Nov 2026, 06:30 London (= UTC in November).
const at = (iso) => () => new Date(iso);
const MORNING = '2026-11-12T06:30:00Z';

const desk = (over = {}) => ({
  v: 1,
  symbols: {
    AAA_US_EQ: { ticker: 'AAA', yahoo: 'AAA', stooq: 'aaa.us', cik: '320193', name: 'Alpha' },
    BBB_US_EQ: { ticker: 'BBB', yahoo: 'BBB', stooq: 'bbb.us', cik: null, name: 'Beta' },
  },
  tiers: { AAA: 'watched', BBB: 'watched' },
  themes: [], theses: {}, notes: [], shortlist: [], meta: { runs: [] }, alert: null,
  ...over,
});

const days = (n) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 86400000));
const yahoo = (n = 300, currency = 'USD') => JSON.stringify({ chart: { result: [{ meta: { currency },
  timestamp: days(n).map((d) => d.getTime() / 1000), indicators: { quote: [{ close: days(n).map((_, i) => 100 + i * 0.1) }] } }] } });
const stooq = (n = 300) => `Date,Open,High,Low,Close,Volume\n${days(n).map((d, i) => `${d.toISOString().slice(0, 10)},1,1,1,${100 + i * 0.1},1`).join('\n')}`;

// A fake network: the sync repo's two files, Trading 212, Yahoo, Stooq, SEC and FX.
function net({ deskDoc = desk(), market = null, t212 = 200, yahooStatus = {}, stooqStatus = {} } = {}) {
  const files = { 'stocks/desk.json': deskDoc ? { text: JSON.stringify(deskDoc), sha: 'd1' } : null, 'stocks/market.json': market ? { text: JSON.stringify(market), sha: 'm1' } : null };
  const calls = [];
  const puts = [];
  const request = (url, init = {}) => {
    calls.push(url);
    const method = (init.method ?? 'GET').toUpperCase();
    const file = /contents\/(stocks\/[a-z]+\.json)/.exec(url)?.[1];
    if (file) {
      if (method === 'PUT') {
        const body = JSON.parse(init.body);
        files[file] = { text: decodeBase64(body.content), sha: 'm2' };
        puts.push(file);
        return { status: 200, text: '{}' };
      }
      const f = files[file];
      return f ? { status: 200, text: JSON.stringify({ content: encodeBase64(f.text), encoding: 'base64', sha: f.sha }) } : { status: 404, text: '' };
    }
    if (url.includes('trading212')) {
      return t212 === 200 ? { status: 200, text: JSON.stringify([
        { ticker: 'AAA_US_EQ', quantity: 1, averagePrice: 100, currentPrice: 130, ppl: 22 },
        { ticker: 'BBB_US_EQ', quantity: 2, averagePrice: 50, currentPrice: 40, ppl: -15 },
      ]) } : { status: t212, text: 'error' };
    }
    if (url.includes('yahoo')) {
      if (/GBPUSD|EURGBP|USDGBP|GBPEUR/.test(url)) return { status: 200, text: yahoo(10, 'USD').replace(/"close":\[[^\]]*\]/, '"close":[1.25,1.25,1.25,1.25,1.25,1.25,1.25,1.25,1.25,1.25]') };
      const sym = /chart\/([^?]+)/.exec(url)[1];
      return { status: yahooStatus[sym] ?? 200, text: (yahooStatus[sym] ?? 200) === 200 ? yahoo() : '' };
    }
    if (url.includes('stooq')) {
      const sym = /s=([^&]+)/.exec(url)[1];
      return { status: stooqStatus[sym] ?? 200, text: (stooqStatus[sym] ?? 200) === 200 ? stooq() : '' };
    }
    if (url.includes('sec.gov')) return { status: 200, text: JSON.stringify({ facts: { 'us-gaap': {} } }) };
    return { status: 404, text: '' };
  };
  return { request, calls, puts, files };
}

function propsFrom(initial = {}) {
  const map = new Map(Object.entries({ SYNC_REPO: 'me/sync', GITHUB_TOKEN: 'gh', T212_KEY: 'k', ...initial }));
  return { get: (k) => map.get(k) ?? null, put: (k, v) => map.set(k, String(v)), map };
}

const marketOf = (n) => JSON.parse(n.files['stocks/market.json'].text);

test('a morning run writes market.json with positions, lenses and the account', () => {
  const n = net();
  createStocks({ request: n.request, props: propsFrom(), now: at(MORNING), send: () => true }).run();
  const m = marketOf(n);
  assert.equal(m.v, 1);
  assert.equal(m.positions.list.length, 2);
  assert.equal(m.positions.error, null);
  assert.equal(m.lenses.AAA.trend.dot, 'green');
  assert.ok(m.account.valueGbp > 0);
  assert.equal(m.account.returnGbp, 7);
});

test('Trading 212 failing keeps the old list and says so', () => {
  const old = { v: 1, at: '2026-11-11T06:00:00Z', positions: { at: '2026-11-11T06:00:00Z', error: null, list: [{ t212: 'AAA_US_EQ', qty: 1, avg: 1, price: 1, ccy: 'USD', valueGbp: 1, returnGbp: 0 }] }, account: {}, lenses: {}, quotes: {} };
  const n = net({ market: old, t212: 500 });
  createStocks({ request: n.request, props: propsFrom(), now: at(MORNING), send: () => true }).run();
  const m = marketOf(n);
  assert.equal(m.positions.list.length, 1);
  assert.match(m.positions.error, /500/);
  assert.equal(m.positions.at, '2026-11-11T06:00:00Z');
});

test('no key yet: positions say so, nothing else breaks', () => {
  const n = net();
  createStocks({ request: n.request, props: propsFrom({ T212_KEY: undefined }), now: at(MORNING), send: () => true }).run();
  assert.match(marketOf(n).positions.error, /key/);
  assert.ok(!n.calls.some((u) => u.includes('trading212')));
});

test('Yahoo refusing falls back to Stooq', () => {
  const n = net({ yahooStatus: { AAA: 429 } });
  createStocks({ request: n.request, props: propsFrom(), now: at(MORNING), send: () => true }).run();
  assert.ok(n.calls.some((u) => u.includes('stooq') && u.includes('aaa.us')));
  assert.equal(marketOf(n).lenses.AAA.trend.dot, 'green');
});

test('both price sources failing greys only that ticker', () => {
  const n = net({ yahooStatus: { AAA: 429 }, stooqStatus: { 'aaa.us': 500 } });
  createStocks({ request: n.request, props: propsFrom(), now: at(MORNING), send: () => true }).run();
  const m = marketOf(n);
  assert.equal(m.lenses.AAA.trend.dot, 'grey');
  assert.equal(m.lenses.AAA.trend.reason, 'No price data today');
  assert.equal(m.lenses.BBB.trend.dot, 'green');
});

test('a second run the same day fetches no prices; nothing changed means no write', () => {
  const n = net();
  const props = propsFrom();
  createStocks({ request: n.request, props, now: at(MORNING), send: () => true }).run();
  const before = n.calls.length;
  const writes = n.puts.length;
  createStocks({ request: n.request, props, now: at('2026-11-12T06:40:00Z'), send: () => true }).run();
  const later = n.calls.slice(before);
  assert.ok(!later.some((u) => u.includes('yahoo') || u.includes('stooq') || u.includes('trading212')));
  assert.equal(n.puts.length, writes);
});

test('before 06:00 London there is no full refresh', () => {
  const n = net();
  createStocks({ request: n.request, props: propsFrom(), now: at('2026-11-12T05:30:00Z'), send: () => true }).run();
  assert.ok(!n.calls.some((u) => u.includes('yahoo')));
});

test('an alert goes out once per id and at most once a day', () => {
  const sent = [];
  const send = (m) => { sent.push(m); return true; };
  const props = propsFrom();
  const n = net({ deskDoc: desk({ alert: { id: 'a1', text: 'BBB cut its guidance.', ticker: 'BBB' } }) });
  createStocks({ request: n.request, props, now: at(MORNING), send }).run();
  createStocks({ request: n.request, props, now: at('2026-11-12T07:00:00Z'), send }).run();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body, 'BBB cut its guidance.');
  assert.match(sent[0].url, /big=stocks&ticker=BBB/);
  n.files['stocks/desk.json'].text = JSON.stringify(desk({ alert: { id: 'a2', text: 'Another.', ticker: null } }));
  createStocks({ request: n.request, props, now: at('2026-11-12T08:00:00Z'), send }).run();
  assert.equal(sent.length, 1);
  createStocks({ request: n.request, props, now: at('2026-11-13T08:00:00Z'), send }).run();
  assert.equal(sent.length, 2);
});

test('SEC is only asked when SEC_CONTACT is set, with it as the User-Agent', () => {
  const n = net();
  createStocks({ request: n.request, props: propsFrom(), now: at(MORNING), send: () => true }).run();
  assert.ok(!n.calls.some((u) => u.includes('sec.gov')));
  const seen = [];
  const n2 = net();
  const req = (url, init = {}) => { if (url.includes('sec.gov')) seen.push(init.headers?.['User-Agent']); return n2.request(url, init); };
  createStocks({ request: req, props: propsFrom({ SEC_CONTACT: 'Someone someone@example.com' }), now: at(MORNING), send: () => true }).run();
  assert.deepEqual(seen, ['Someone someone@example.com']);
});

test('a run never throws, even with the sync repo unreachable', () => {
  const request = () => { throw new Error('offline'); };
  assert.doesNotThrow(() => createStocks({ request, props: propsFrom(), now: at(MORNING), send: () => true }).run());
});

test('review fix: with desk.json gone, an hourly read keeps the value from each position\'s last currency', () => {
  const n = net();
  const props = propsFrom();
  createStocks({ request: n.request, props, now: at(MORNING), send: () => true }).run();
  const before = marketOf(n).account.valueGbp;
  n.files['stocks/desk.json'] = null;
  createStocks({ request: n.request, props, now: at('2026-11-12T08:00:00Z'), send: () => true }).run();
  assert.equal(marketOf(n).account.valueGbp, before);
});

test('review fix: one symbol failing keeps its value in the total, from yesterday\'s quote', () => {
  const n = net();
  const props = propsFrom();
  createStocks({ request: n.request, props, now: at(MORNING), send: () => true }).run();
  const before = marketOf(n).account.valueGbp;
  const n2 = net({ market: marketOf(n), yahooStatus: { AAA: 429 }, stooqStatus: { 'aaa.us': 500 } });
  createStocks({ request: n2.request, props, now: at('2026-11-13T06:30:00Z'), send: () => true }).run();
  assert.equal(marketOf(n2).account.valueGbp, before);
});

test('review fix: today\'s move is the live price against the last close', () => {
  const n = net();
  createStocks({ request: n.request, props: propsFrom(), now: at(MORNING), send: () => true }).run();
  const m = marketOf(n);
  // AAA: 1 × $130 live; BBB: 2 × $40 live. Last closes from the fake price feed (~129.9 each).
  const close = m.quotes.AAA.close;
  const expected = Math.round(((1 * 130 - 1 * close) + (2 * 40 - 2 * close)) / 1.25 * 100) / 100;
  assert.equal(m.account.dayMoveGbp, expected);
});

test('review fix: a failed save fetches the prices again on the next run', () => {
  const n = net();
  const props = propsFrom();
  const failing = (url, init = {}) => ((init.method ?? 'GET').toUpperCase() === 'PUT' ? { status: 500, text: '' } : n.request(url, init));
  createStocks({ request: failing, props, now: at(MORNING), send: () => true }).run();
  const before = n.calls.length;
  createStocks({ request: n.request, props, now: at('2026-11-12T06:40:00Z'), send: () => true }).run();
  assert.ok(n.calls.slice(before).some((u) => u.includes('yahoo')));
});
