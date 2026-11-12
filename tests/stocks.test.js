import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validMarket, validDesk, lensesFor, verdict, themeDot, momentToAdd, notesFor, stocksView } from '../js/stocks.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const market = () => load('stocks-market.json');
const desk = () => load('stocks-desk.json');
const TODAY = '2026-11-12';
const L = (dots) => Object.fromEntries(['trend', 'price', 'health', 'expectations', 'risk'].map((k, i) => [k, { dot: dots[i], reason: '' }]));

test('validMarket / validDesk: the fixtures pass, a wrong version or a missing part fails', () => {
  assert.equal(validMarket(market()), true);
  assert.equal(validDesk(desk()), true);
  assert.equal(validMarket({ ...market(), v: 2 }), false);
  assert.equal(validDesk({ ...desk(), themes: 'x' }), false);
  assert.equal(validMarket(null), false);
});

test('verdict: watched holdings', () => {
  assert.equal(verdict(L(['green', 'green', 'green', 'green', 'green']), 'watched'), 'agrees');
  assert.equal(verdict(L(['green', 'green', 'green', 'green', 'amber']), 'watched'), 'agrees');
  assert.equal(verdict(L(['green', 'red', 'green', 'red', 'green']), 'watched'), 'disagrees');
  assert.equal(verdict(L(['red', 'green', 'green', 'red', 'green']), 'watched'), 'disagrees');
  assert.equal(verdict(L(['green', 'green', 'green', 'amber', 'red']), 'watched'), 'mixed');
});

test('verdict: funds use trend and risk only; the pie has none', () => {
  assert.equal(verdict(L(['green', 'grey', 'grey', 'grey', 'green']), 'fund'), 'agrees');
  assert.equal(verdict(L(['red', 'grey', 'grey', 'grey', 'red']), 'market'), 'disagrees');
  assert.equal(verdict(L(['green', 'grey', 'grey', 'grey', 'red']), 'fund'), 'mixed');
  assert.equal(verdict(L(['green', 'green', 'green', 'green', 'green']), 'pie'), null);
});

test('verdict: no data yet is no verdict, so a theme waiting for prices is grey', () => {
  assert.equal(verdict(L(['grey', 'grey', 'grey', 'grey', 'grey']), 'watched'), null);
  assert.equal(verdict(L(['grey', 'grey', 'grey', 'grey', 'grey']), 'fund'), null);
  const d = desk(); d.lensNotes = {};
  const v = stocksView(null, d, TODAY);
  assert.ok(v.themes.every((t) => t.dot === 'grey'));
});

test('themeDot: majority, ties go amber, empty is grey', () => {
  assert.equal(themeDot(['agrees', 'agrees', 'mixed']), 'green');
  assert.equal(themeDot(['agrees', 'disagrees']), 'amber');
  assert.equal(themeDot(['disagrees', 'disagrees', 'agrees']), 'red');
  assert.equal(themeDot([]), 'grey');
});

test('lensesFor: Claude\'s lens notes override; funds get grey price, health and expectations', () => {
  const l = lensesFor('AAA', market(), desk());
  assert.equal(l.expectations.dot, 'green');
  assert.equal(l.trend.dot, 'green');
  const d = desk(); d.lensNotes.AAA.price = { dot: 'red', reason: 'Results changed it', at: '2026-11-12T07:00:00.000Z' };
  assert.equal(lensesFor('AAA', market(), d).price.dot, 'red');
  const f = lensesFor('FUND', market(), desk());
  assert.equal(f.price.dot, 'grey');
  assert.equal(f.expectations.reason, "doesn't apply to a fund");
  assert.equal(lensesFor('ZZZ', market(), desk()).trend.dot, 'grey');
});

test('momentToAdd: needs the thesis intact, health and expectations not red, and a dip', () => {
  const d = desk();
  assert.equal(momentToAdd('CCC', L(['amber', 'green', 'green', 'amber', 'amber']), d), true);
  assert.equal(momentToAdd('CCC', L(['amber', 'green', 'green', 'amber', 'green']), d), false);
  assert.equal(momentToAdd('CCC', L(['amber', 'green', 'red', 'amber', 'amber']), d), false);
  d.theses.CCC.intact = false;
  assert.equal(momentToAdd('CCC', L(['amber', 'green', 'green', 'amber', 'amber']), d), false);
});

test('notesFor: last looked, newest thinking, the open next note, the rest folded', () => {
  const n = notesFor('AAA', desk());
  assert.equal(n.lastLooked, '2026-11-12');
  assert.equal(n.thinking.text, 'Stretched on price; fine while forecasts rise.');
  assert.equal(n.next.due, '2026-11-14');
  assert.deepEqual(n.earlier.map((x) => x.text), ['Quiet; results Friday.', 'Older thought.']);
  const d = desk(); d.notes.find((x) => x.kind === 'next').closed = true;
  assert.equal(notesFor('AAA', d).next, null);
  assert.deepEqual(notesFor('NONE', desk()), { lastLooked: null, thinking: null, next: null, earlier: [] });
});

test('stocksView: the glance numbers, verdict line and Claude\'s looks today', () => {
  const v = stocksView(market(), desk(), TODAY);
  assert.equal(v.value, 327.5);
  assert.equal(v.dayMovePct, 0.8);
  assert.equal(v.allTime, 55);
  assert.equal(v.verdictLine, 'Nothing that changes your view today.');
  assert.equal(v.lookedToday, 2);
  assert.equal(v.coming.length, 1);
  assert.equal(v.look.ticker, 'CCC');
  assert.equal(v.positionsNote, null);
});

test('stocksView: a What happened item leads the verdict line', () => {
  const d = desk(); d.brief.happened = [{ text: 'BBB cut its guidance.', ticker: 'BBB', url: null, day: TODAY }];
  assert.equal(stocksView(market(), d, TODAY).verdictLine, 'BBB cut its guidance.');
});

test('stocksView: themes carry dots and rows; hints say only what matters', () => {
  const v = stocksView(market(), desk(), TODAY);
  const chips = v.themes.find((t) => t.id === 'chips');
  assert.equal(chips.dot, 'amber'); // AAA agrees, BBB disagrees
  const row = (t, k) => v.themes.find((x) => x.id === t).rows.find((r) => r.ticker === k);
  assert.equal(row('chips', 'AAA').hint, 'results Sat');
  assert.equal(row('chips', 'BBB').hint, 'numbers disagree with you');
  assert.equal(row('chips', 'AAA').dots.length, 5);
  const power = v.themes.find((t) => t.id === 'power');
  assert.ok(power.rows.some((r) => r.ticker === 'AAA' && r.also), 'watched-under holdings show in the second theme');
  assert.equal(row('power', 'CCC').hint, null);
});

test('stocksView: a holding quiet for a week says so', () => {
  const d = desk(); d.events = []; d.notes = d.notes.filter((n) => n.subject !== 'AAA');
  d.notes.push({ at: '2026-11-01T07:00:00.000Z', subject: 'AAA', kind: 'looked', text: 'x', due: null, closed: false });
  const v = stocksView(market(), d, TODAY);
  assert.equal(v.themes[0].rows.find((r) => r.ticker === 'AAA').hint, 'quiet 11 days');
});

test('stocksView: a fund-only theme takes its dot from its funds', () => {
  const d = desk(); d.themes = [{ id: 'idx', name: 'Index', holdings: ['FUND'], also: [], interests: [] }];
  assert.equal(stocksView(market(), d, TODAY).themes[0].dot, 'green');
});

test('stocksView: a holding with no tier lands in Not sorted yet', () => {
  const v = stocksView(market(), desk(), TODAY);
  assert.deepEqual(v.unsorted.map((r) => r.ticker), ['NEW']);
});

test('stocksView: no desk yet still shows the value and says there is no brief', () => {
  const v = stocksView(market(), null, TODAY);
  assert.equal(v.value, 327.5);
  assert.equal(v.verdictLine, 'No brief yet');
  assert.equal(v.unsorted.length, 6);
});

test('stocksView: a brief from another day is not today\'s', () => {
  const d = desk(); d.brief.at = '2026-11-10T07:00:00.000Z';
  assert.equal(stocksView(market(), d, TODAY).verdictLine, 'No brief yet today');
});

test('stocksView: positions that could not be read say "as of"', () => {
  const m = market(); m.positions.error = 'Trading 212 answered 500'; m.positions.at = '2026-11-10T06:00:00.000Z';
  assert.match(stocksView(m, desk(), TODAY).positionsNote, /as of Tue 10 Nov/);
});

test('stocksView: the shortlist shows the move since raised; usage sums the last 7 days', () => {
  const v = stocksView(market(), desk(), TODAY);
  assert.equal(v.shortlist[0].sincePct, 10);
  assert.deepEqual(v.usage, { runs: 2, searches: 5, tokens: 70000, pct: 2 });
});

test('stocksView: no market yet', () => {
  const v = stocksView(null, desk(), TODAY);
  assert.equal(v.value, null);
  assert.equal(v.themes.length, 3);
});
