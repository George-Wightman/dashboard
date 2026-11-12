import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { briefInput, mergeDesk, stocksLines, writeStocks, readStocks, emptyDesk } from '../claude/stocks.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const market = () => load('stocks-market.json');
const desk = () => load('stocks-desk.json');
const TODAY = '2026-11-12';
const NOW = new Date('2026-11-12T07:30:00Z');
const fakeFiles = () => {
  const files = new Map();
  return { files, async read(p) { return files.has(p) ? { text: files.get(p) } : null; }, async write(p, text) { files.set(p, text); } };
};

test('briefInput: a big mover and results within two days are triggers; the pie never is', () => {
  const text = briefInput(market(), desk(), TODAY, 'daily').join('\n');
  assert.match(text, /Search cap: 8/);
  const search = text.split('\n').find((l) => l.startsWith('Search these'));
  assert.match(search, /BBB \([^)]*moved -7%/);
  assert.match(search, /AAA \([^)]*results in 2 days/);
  assert.doesNotMatch(search, /PIE|FUND/);
});

test('briefInput: a new holding asks for a tier and thesis', () => {
  assert.match(briefInput(market(), desk(), TODAY, 'daily').join('\n'), /New holdings needing a tier and thesis: NEW/);
});

test('briefInput: over the cap, the largest holdings are searched and the rest skipped', () => {
  const m = market(); const d = desk();
  m.positions.list = []; d.tiers = {}; d.symbols = {};
  for (let i = 1; i <= 10; i++) {
    const k = `T${i}`;
    m.positions.list.push({ t212: `${k}_US_EQ`, qty: 1, avg: 1, price: 1, ccy: 'USD', valueGbp: i * 10, returnGbp: 0 });
    d.symbols[`${k}_US_EQ`] = { ticker: k, yahoo: k, stooq: null, cik: null, name: k };
    d.tiers[k] = 'watched';
  }
  d.notes = []; d.events = [];
  const lines = briefInput(m, d, TODAY, 'daily');
  const search = lines.find((l) => l.startsWith('Search these'));
  const skip = lines.find((l) => l.startsWith('Skip'));
  assert.equal(search.match(/T\d+ \(/g).length, 8);
  assert.match(search, /^Search these[^:]*: T10 /);
  assert.match(skip, /T2.*T1|T1.*T2/);
  assert.match(briefInput(m, d, TODAY, 'weekly').join('\n'), /Search cap: 15/);
});

test('briefInput: a lens that changed colour since the last write is a trigger', () => {
  const d = desk(); d.meta.lastDots = { CCC: 'agggg' };
  assert.match(briefInput(market(), d, TODAY, 'daily').join('\n'), /CCC \([^)]*expectations green→amber/);
});

test('mergeDesk: caps are refused, by name', () => {
  const brief = { at: NOW.toISOString(), verdict: 'x', happened: [1, 2, 3, 4].map((i) => ({ text: `h${i}`, ticker: null, url: null, day: null })), coming: [], look: [], payday: null };
  assert.throws(() => mergeDesk(desk(), { brief }, NOW), /What happened.*3/);
  assert.throws(() => mergeDesk(desk(), { brief: { ...brief, happened: [], look: [1, 2, 3].map(() => ({ kind: 'idea', text: 'x', ticker: null, url: null })) } }, NOW), /Worth a look.*2/);
});

test('mergeDesk: one alert a London day', () => {
  const once = mergeDesk(desk(), { alert: { id: 'a1', text: 'BBB cut guidance', ticker: 'BBB' } }, NOW);
  assert.equal(once.alert.id, 'a1');
  assert.throws(() => mergeDesk(once, { alert: { id: 'a2', text: 'Again', ticker: null } }, new Date('2026-11-12T20:00:00Z')), /one alert a day/);
  assert.equal(mergeDesk(once, { alert: { id: 'a2', text: 'Next day', ticker: null } }, new Date('2026-11-13T07:00:00Z')).alert.id, 'a2');
});

test('mergeDesk: a looked note answering a next note closes it; six notes keep five', () => {
  const d = mergeDesk(desk(), { notes: [{ subject: 'AAA', kind: 'looked', text: 'Results: beat.', answers: '2026-11-05T07:00:00.000Z' }] }, NOW);
  assert.equal(d.notes.find((n) => n.kind === 'next' && n.subject === 'AAA').closed, true);
  const more = mergeDesk(d, { notes: [1, 2].map((i) => ({ subject: 'AAA', kind: 'thinking', text: `t${i}` })) }, NOW);
  assert.equal(more.notes.filter((n) => n.subject === 'AAA').length, 5);
  assert.ok(!more.notes.some((n) => n.text === 'Older thought.'));
});

test('mergeDesk: fold turns a subject\'s older notes into one summary', () => {
  const d = mergeDesk(desk(), { fold: [{ subject: 'AAA', text: 'So far: steady, stretched on price.' }] }, NOW);
  const aaa = d.notes.filter((n) => n.subject === 'AAA');
  assert.ok(aaa.some((n) => n.kind === 'summary' && n.text.startsWith('So far')));
  assert.ok(!aaa.some((n) => n.text === 'Older thought.'));
  assert.ok(aaa.some((n) => n.kind === 'next' && !n.closed), 'an open next note is never folded away');
  assert.equal(aaa.length, 4); // the two newest, the open next note, the summary
});

test('mergeDesk: keyed parts merge, a null removes; themes and shortlist upsert; runs append', () => {
  const d = mergeDesk(desk(), {
    tiers: { NEW: 'watched', PIE: null },
    theses: { NEW: { line: 'A new idea.', watch: [], intact: true } },
    themes: [{ id: 'power', name: 'Power and grid', holdings: ['CCC', 'FUND'], also: [], interests: ['grid'] }],
    shortlist: [{ ticker: 'IDEA', name: 'Idea Co', theme: 'power', day: '2026-10-03', price: 100, ccy: 'USD', reason: 'Grid supplier', status: 'dropped', why: 'Story faded' }],
    run: { kind: 'daily', searches: 4, looked: ['AAA'], skipped: [], tokens: null, pct: null },
  }, NOW);
  assert.equal(d.tiers.NEW, 'watched');
  assert.equal(d.tiers.PIE, undefined);
  assert.equal(d.themes.find((t) => t.id === 'power').name, 'Power and grid');
  assert.equal(d.themes.length, 3);
  assert.equal(d.shortlist[0].status, 'dropped');
  assert.equal(d.meta.runs.at(-1).at, NOW.toISOString());
  assert.throws(() => mergeDesk(desk(), { tiers: { X: 'gold' } }, NOW), /tier/);
});

test('writeStocks: starts a desk when there is none, records the dots it saw, and stocks reads it back', async () => {
  const f = fakeFiles();
  f.files.set('stocks/market.json', JSON.stringify(market()));
  const msg = await writeStocks(f, JSON.stringify({ tiers: { AAA: 'watched' }, symbols: desk().symbols }), NOW);
  assert.match(msg, /Saved stocks\/desk\.json/);
  const { desk: saved } = await readStocks(f);
  assert.equal(saved.tiers.AAA, 'watched');
  assert.equal(saved.meta.lastDots.AAA.length, 5);
  await assert.rejects(writeStocks(f, 'not json', NOW), /needs a JSON file/);
});

test('stocksLines: a quiet day reads as such, with themes, dots and usage', () => {
  const text = stocksLines(market(), desk(), TODAY).join('\n');
  assert.match(text, /Nothing that changes your view today\./);
  assert.match(text, /Chips \(amber\)/);
  assert.match(text, /AAA ga\w{3} agrees/);
  assert.match(text, /This week: 2 runs, 5 searches/);
  assert.match(stocksLines(null, null, TODAY).join('\n'), /No stocks files yet/);
});

test('emptyDesk is a valid desk', async () => {
  const { validDesk } = await import('../js/stocks.js');
  assert.equal(validDesk(emptyDesk()), true);
});
