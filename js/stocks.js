// Stocks (docs/superpowers/specs/2026-11-12-stocks-design.md): the view-model behind the tile and big
// view. Two private files in the sync repo: `stocks/market.json` (the planner: positions, prices,
// lenses) and `stocks/desk.json` (Claude: theses, themes, tiers, the brief, its notes, the shortlist,
// the run log). This joins them. Pure, no DOM.

import { addDays, daysBetween, shortWeekday, shortDate } from './dates.js';

export const MARKET_PATH = 'stocks/market.json';
export const DESK_PATH = 'stocks/desk.json';
export const MARKET_KEY = 'dash_stocks_market';
export const DESK_KEY = 'dash_stocks_desk';

export const LENSES = ['trend', 'price', 'health', 'expectations', 'risk'];
export const TIERS = ['watched', 'fund', 'market', 'pie'];
const DOTS = ['green', 'amber', 'red', 'grey'];

const obj = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
const arr = Array.isArray;

export function validMarket(x) {
  return obj(x) && x.v === 1 && obj(x.positions) && arr(x.positions.list) && obj(x.lenses) && obj(x.account ?? {}) && obj(x.quotes ?? {});
}

export function validDesk(x) {
  return obj(x) && x.v === 1 && obj(x.symbols) && obj(x.tiers) && arr(x.themes) && obj(x.theses)
    && arr(x.notes) && arr(x.shortlist) && obj(x.meta) && arr(x.meta.runs)
    && Object.values(x.tiers).every((t) => TIERS.includes(t));
}

const grey = (reason = 'no data yet') => ({ dot: 'grey', reason });
const lens = (l) => (obj(l) && DOTS.includes(l.dot) ? { dot: l.dot, reason: l.reason ?? '' } : null);

// The five lenses for a ticker: the planner's, overridden by Claude's notes where it wrote one.
export function lensesFor(ticker, market, desk) {
  const tier = desk?.tiers?.[ticker];
  const m = market?.lenses?.[ticker] ?? {};
  const notes = desk?.lensNotes?.[ticker] ?? {};
  const out = {};
  for (const k of LENSES) out[k] = lens(notes[k]) ?? lens(m[k]) ?? grey();
  if (tier === 'fund' || tier === 'market') {
    for (const k of ['price', 'health', 'expectations']) out[k] = grey("doesn't apply to a fund");
  }
  return out;
}

const count = (lenses, dot) => LENSES.filter((k) => lenses[k]?.dot === dot).length;

export function verdict(lenses, tier) {
  if (tier === 'pie' || !tier) return null;
  if (count(lenses, 'grey') === LENSES.length) return null; // nothing to judge yet
  if (tier === 'fund' || tier === 'market') {
    const t = lenses.trend.dot; const r = lenses.risk.dot;
    if (t === 'grey' && r === 'grey') return null;
    if (t === 'green' && r === 'green') return 'agrees';
    if (t === 'red' && r === 'red') return 'disagrees';
    return 'mixed';
  }
  if (count(lenses, 'red') >= 2 || (lenses.trend.dot === 'red' && lenses.expectations.dot === 'red')) return 'disagrees';
  if (count(lenses, 'green') >= 4 && count(lenses, 'red') === 0) return 'agrees';
  return 'mixed';
}

export function themeDot(verdicts) {
  const v = verdicts.filter(Boolean);
  if (!v.length) return 'grey';
  if (v.filter((x) => x === 'agrees').length * 2 > v.length) return 'green';
  if (v.filter((x) => x === 'disagrees').length * 2 > v.length) return 'red';
  return 'amber';
}

export function momentToAdd(ticker, lenses, desk) {
  // Only once the routine has judged the thesis intact from the news: a dip alone is never enough.
  if (desk?.theses?.[ticker]?.intact !== true) return false;
  if (lenses.health.dot === 'red' || lenses.expectations.dot === 'red') return false;
  return lenses.risk.dot === 'amber' || lenses.risk.dot === 'red';
}

const dayOf = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : null);
const newest = (a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);

// What Claude last did, thinks now and will do next for a subject ('NVDA', 'theme:ai', 'idea:KOG').
export function notesFor(subject, desk) {
  const notes = (desk?.notes ?? []).filter((n) => n.subject === subject).sort(newest);
  const looked = notes.find((n) => n.kind === 'looked');
  const thinking = notes.find((n) => n.kind === 'thinking') ?? null;
  const next = notes.find((n) => n.kind === 'next' && !n.closed) ?? null;
  return { lastLooked: looked ? dayOf(looked.at) : null, thinking, next, earlier: notes.filter((n) => n !== thinking && n !== next) };
}

const round1 = (x) => Math.round(x * 10) / 10;

function hintFor({ ticker, verdict: v, desk, today, lastLooked }) {
  const results = (desk?.events ?? []).filter((e) => e.ticker === ticker && e.kind === 'results' && e.day >= today && daysBetween(today, e.day) <= 7)
    .sort((a, b) => (a.day < b.day ? -1 : 1))[0];
  if (results) return `results ${shortWeekday(results.day)}`;
  if (v === 'disagrees') return 'numbers disagree with you';
  if (lastLooked && daysBetween(lastLooked, today) >= 7) return `quiet ${daysBetween(lastLooked, today)} days`;
  return null;
}

export function stocksView(market, desk, today) {
  const symbols = desk?.symbols ?? {};
  const tickerOf = (t212) => symbols[t212]?.ticker ?? t212.replace(/(_[A-Z]{2})?_EQ$|l_EQ$/, '');
  const positions = (market?.positions?.list ?? []).map((p) => ({ ...p, ticker: tickerOf(p.t212) }));
  const value = (t) => positions.find((p) => p.ticker === t)?.valueGbp ?? null;

  const rowFor = (ticker, also = false) => {
    const tier = desk?.tiers?.[ticker] ?? null;
    const lenses = lensesFor(ticker, market, desk);
    const v = verdict(lenses, tier);
    const notes = notesFor(ticker, desk);
    return {
      ticker, tier, also, verdict: v, valueGbp: value(ticker),
      dots: LENSES.map((k) => lenses[k].dot),
      hint: tier === 'pie' ? null : hintFor({ ticker, verdict: v, desk, today, lastLooked: notes.lastLooked }),
      card: {
        name: Object.values(symbols).find((s) => s.ticker === ticker)?.name ?? ticker,
        thesis: desk?.theses?.[ticker] ?? null, lenses, notes,
        rsi: market?.lenses?.[ticker]?.rsi ?? null, insider: desk?.insider?.[ticker] ?? null,
        add: tier === 'watched' && momentToAdd(ticker, lenses, desk),
        events: (desk?.events ?? []).filter((e) => e.ticker === ticker && e.day >= today).sort((a, b) => (a.day < b.day ? -1 : 1)),
      },
    };
  };

  const themes = (desk?.themes ?? []).map((t) => {
    const rows = [...t.holdings.map((k) => rowFor(k)), ...(t.also ?? []).map((k) => rowFor(k, true))];
    const own = rows.filter((r) => !r.also);
    const watched = own.filter((r) => r.tier === 'watched');
    const dot = themeDot((watched.length ? watched : own.filter((r) => r.tier === 'fund' || r.tier === 'market')).map((r) => r.verdict));
    return { id: t.id, name: t.name, dot, reason: notesFor(`theme:${t.id}`, desk).thinking?.text ?? null, interests: t.interests ?? [], rows };
  });
  const placed = new Set((desk?.themes ?? []).flatMap((t) => t.holdings));
  const unsorted = positions.filter((p) => !placed.has(p.ticker) || !desk?.tiers?.[p.ticker]).map((p) => rowFor(p.ticker));

  const brief = desk?.brief ?? null;
  const briefToday = brief && dayOf(brief.at) === today;
  const verdictLine = !brief ? 'No brief yet' : !briefToday ? 'No brief yet today'
    : (brief.happened?.[0]?.text ?? brief.verdict ?? 'Nothing that changes your view today.');
  const lastRun = (desk?.meta?.runs ?? []).map((r) => r.at).sort().pop() ?? null;
  const todaysRuns = (desk?.meta?.runs ?? []).filter((r) => dayOf(r.at) === today);
  const lookedToday = new Set(todaysRuns.flatMap((r) => r.looked ?? [])).size;

  const since = addDays(today, -6);
  const week = (desk?.meta?.runs ?? []).filter((r) => dayOf(r.at) >= since && dayOf(r.at) <= today);
  const sumOf = (k) => (week.some((r) => r[k] != null) ? week.reduce((t, r) => t + (r[k] ?? 0), 0) : null);

  const pos = market?.positions;
  const positionsNote = !pos?.error ? null
    : pos.at ? `Couldn't read Trading 212 — holdings as of ${shortWeekday(dayOf(pos.at))} ${shortDate(dayOf(pos.at))}`
      : `Couldn't read Trading 212 yet (${pos.error})`;

  return {
    value: market?.account?.valueGbp ?? null,
    dayMove: market?.account?.dayMoveGbp ?? null,
    dayMovePct: market?.account?.dayMovePct ?? null,
    allTime: market?.account?.returnGbp ?? null,
    verdictLine, lookedToday, lastRun,
    themes, unsorted,
    coming: briefToday ? (brief.coming ?? []).slice(0, 2) : [],
    look: briefToday ? (brief.look ?? [])[0] ?? null : null,
    payday: briefToday ? brief.payday ?? null : null,
    shortlist: (desk?.shortlist ?? []).map((s) => {
      const close = market?.quotes?.[s.ticker]?.close ?? market?.lenses?.[s.ticker]?.close ?? null;
      return { ...s, sincePct: close != null && s.price ? round1((close / s.price - 1) * 100) : null, notes: notesFor(`idea:${s.ticker}`, desk) };
    }),
    positionsNote,
    usage: { runs: week.length, searches: sumOf('searches') ?? 0, tokens: sumOf('tokens'), pct: sumOf('pct') },
  };
}
