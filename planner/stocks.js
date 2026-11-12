// Stocks for the planner (docs/superpowers/specs/2026-11-12-stocks-design.md): the free half. Each run
// reads `stocks/desk.json` (Claude's: symbols, tiers, the shortlist, an alert) and keeps
// `stocks/market.json` (positions, prices, lenses) in the sync repo up to date:
// - Trading 212 positions at most hourly, with George's Portfolio-only key (T212_KEY, T212_SECRET);
// - prices once a day from 06:00 London (Yahoo, Stooq when Yahoo refuses), never stored as history;
// - US company accounts from SEC weekly, only with SEC_CONTACT set (SEC asks for a contact).
// And sends Claude's alert, once per id and at most one a day. `request(url, init) → { status, text }`
// blocks (UrlFetchApp). Nothing here throws to the planner.

import { encodeBase64, decodeBase64 } from '../js/sync.js';
import { validDesk, validMarket, MARKET_PATH, DESK_PATH } from '../js/stocks.js';
import { trend, risk, rsi14, sigma, moveToday, priceLens, healthLens, quarters } from './stocks-lenses.js';

const HOUR = 3600000;
const ZONE = 'Europe/London';
const T212 = 'https://live.trading212.com/api/v0/equity/portfolio';

const londonParts = (t) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
    .formatToParts(t).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
};

const gbpRate = (ccy, fx) => {
  if (ccy === 'GBP') return 1;
  if (ccy === 'GBp' || ccy === 'GBX') return 0.01;
  if (ccy === 'USD') return fx?.GBPUSD ? 1 / fx.GBPUSD : null;
  if (ccy === 'EUR') return fx?.EURGBP ?? null;
  return null;
};
const round2 = (x) => Math.round(x * 100) / 100;

export function parseYahoo(text) {
  const r = JSON.parse(text)?.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const closes = r?.indicators?.quote?.[0]?.close ?? [];
  const series = ts.map((s, i) => ({ day: new Date(s * 1000).toISOString().slice(0, 10), close: closes[i] })).filter((x) => x.close != null);
  return series.length ? { series, ccy: r?.meta?.currency ?? null } : null;
}

export function parseStooq(text) {
  const rows = String(text).trim().split('\n').slice(1).map((l) => l.split(','))
    .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c[0]) && Number.isFinite(Number(c[4])))
    .map((c) => ({ day: c[0], close: Number(c[4]) }));
  return rows.length ? { series: rows, ccy: null } : null;
}

// P/E at each month over the last five years: the close over the four quarters' EPS before it.
export function peHistory(series, eps) {
  const out = [];
  for (let i = series.length - 1; i >= 0 && out.length < 60; i -= 21) {
    const before = eps.filter((q) => q.end <= series[i].day).slice(-4);
    const ttm = before.length === 4 ? before.reduce((t, q) => t + q.val, 0) : null;
    if (ttm > 0) out.push(series[i].close / ttm);
  }
  return out;
}

export function createStocks({ request, props, log = () => {}, now, send = () => false }) {
  const get = (k) => props.get(k) || null;
  const repo = () => get('SYNC_REPO');
  const gh = () => ({ Authorization: `Bearer ${get('GITHUB_TOKEN')}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  const contents = (path) => `https://api.github.com/repos/${repo()}/contents/${path}`;

  function readFile(path) {
    const res = request(contents(path), { method: 'GET', headers: gh() });
    if (res.status === 404) return { doc: null, sha: null };
    if (res.status !== 200) throw new Error(`GitHub ${res.status} reading ${path}`);
    const f = JSON.parse(res.text);
    let doc = null;
    try { doc = JSON.parse(decodeBase64(f.content ?? '')); } catch { /* malformed: treated as absent */ }
    return { doc, sha: f.sha };
  }

  function writeFile(path, doc, sha) {
    const body = { message: 'stocks: market', content: encodeBase64(`${JSON.stringify(doc)}\n`), ...(sha ? { sha } : {}) };
    const res = request(contents(path), { method: 'PUT', headers: gh(), body: JSON.stringify(body) });
    if (res.status !== 200 && res.status !== 201) throw new Error(`GitHub ${res.status} saving ${path}`);
  }

  function positions(prev, t) {
    const key = get('T212_KEY');
    const keep = (error) => ({ ...(prev ?? { at: null, list: [] }), error });
    if (!key) return keep('No Trading 212 key yet: add T212_KEY to the planner (see README)');
    const last = Number(get('STOCKS_POS_AT') ?? 0);
    if (prev && !prev.error && t.getTime() - last < HOUR) return prev;
    const secret = get('T212_SECRET');
    try {
      const res = request(T212, { method: 'GET', headers: { Authorization: secret ? `Basic ${encodeBase64(`${key}:${secret}`)}` : key } });
      if (res.status !== 200) return keep(`Trading 212 answered ${res.status}`);
      props.put('STOCKS_POS_AT', String(t.getTime()));
      const list = JSON.parse(res.text).map((p) => ({ t212: p.ticker, qty: p.quantity, avg: p.averagePrice, price: p.currentPrice, ppl: (p.ppl ?? 0) + (p.fxPpl ?? 0) }));
      return { at: t.toISOString(), error: null, list };
    } catch (e) {
      return keep(`Trading 212 couldn't be reached (${e?.message ?? e})`);
    }
  }

  function prices(sym) {
    const tries = [];
    if (sym.yahoo) tries.push([`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym.yahoo)}?range=${sym.range ?? '5y'}&interval=1d`, parseYahoo]);
    if (sym.stooq) tries.push([`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym.stooq)}&i=d`, parseStooq]);
    for (const [url, parse] of tries) {
      try {
        const res = request(url, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' } });
        const got = res.status === 200 ? parse(res.text) : null;
        if (got) return { ...got, ccy: got.ccy ?? sym.ccy ?? null };
      } catch { /* the next source */ }
    }
    return null;
  }

  function fxRates() {
    const fx = {};
    for (const pair of ['GBPUSD', 'EURGBP']) {
      const got = prices({ yahoo: `${pair}=X`, range: '5d' });
      if (got) fx[pair] = got.series[got.series.length - 1].close;
    }
    return fx;
  }

  function fundamentals(cik, contact) {
    const res = request(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`, { method: 'GET', headers: { 'User-Agent': contact } });
    if (res.status !== 200) return null;
    const facts = JSON.parse(res.text);
    const eps = quarters(facts, ['EarningsPerShareDiluted'], 'USD/shares') ?? [];
    return { eps, health: healthLens(facts) };
  }

  function lensesFrom(got, fund) {
    if (!got) {
      const g = { dot: 'grey', reason: 'No price data today' };
      return { trend: g, price: g, health: fund?.health ?? g, risk: g, rsi: null, sigma: 0, moveToday: 0, close: null };
    }
    const closes = got.series.map((x) => x.close);
    const close = closes[closes.length - 1];
    const epsTtm = fund?.eps?.length >= 4 ? fund.eps.slice(-4).reduce((t, q) => t + q.val, 0) : null;
    return {
      trend: (({ dot, reason }) => ({ dot, reason }))(trend(closes)),
      price: fund ? priceLens({ price: close, epsTtm, peHistory: fund.pe }) : { dot: 'grey', reason: 'Accounts not available' },
      health: fund?.health ?? { dot: 'grey', reason: 'Accounts not available' },
      risk: (({ dot, reason }) => ({ dot, reason }))(risk(closes)),
      rsi: rsi14(closes), sigma: round2(sigma(closes) * 10000) / 10000, moveToday: Math.round(moveToday(closes) * 10000) / 10000, close,
    };
  }

  function run() {
    try {
      const t = now();
      const { day, hour } = londonParts(t);
      const deskFile = readFile(DESK_PATH);
      const desk = validDesk(deskFile.doc) ? deskFile.doc : null;
      const marketFile = readFile(MARKET_PATH);
      const prev = validMarket(marketFile.doc) ? marketFile.doc : null;
      const next = {
        v: 1, at: prev?.at ?? t.toISOString(),
        positions: positions(prev?.positions, t),
        account: prev?.account ?? {}, lenses: prev?.lenses ?? {}, quotes: prev?.quotes ?? {}, fx: prev?.fx ?? {},
        fundamentals: prev?.fundamentals ?? {},
      };
      const symbols = desk?.symbols ?? {};
      // Each position keeps the ticker and currency it last had, so a missing desk.json or a price
      // feed that fails for a day doesn't drop it from the total.
      const known = new Map((prev?.positions?.list ?? []).map((p) => [p.t212, p]));
      const symFor = (t212) => symbols[t212] ?? (known.get(t212)?.ticker ? { ticker: known.get(t212).ticker } : null);
      let refreshed = false;
      let secDue = false;

      if (get('STOCKS_DAY') !== day && hour >= 6) {
        next.fx = { ...next.fx, ...fxRates() };
        const contact = get('SEC_CONTACT');
        secDue = !!contact && t.getTime() - Number(get('STOCKS_SEC_AT') ?? 0) > 7 * 24 * HOUR;
        const lenses = {};
        const quotes = {};
        for (const p of next.positions.list) {
          const sym = symFor(p.t212);
          if (!sym) continue;
          const got = prices(sym);
          let fund = next.fundamentals[sym.ticker] ?? null;
          if (secDue && sym.cik && desk?.tiers?.[sym.ticker] === 'watched') {
            try {
              const f = fundamentals(sym.cik, contact);
              if (f) fund = { eps: f.eps.slice(-8), health: f.health, pe: got ? peHistory(got.series, f.eps) : [], at: t.toISOString() };
            } catch (e) { log(`Stocks: SEC for ${sym.ticker} failed (${e?.message ?? e})`); }
          }
          if (fund) next.fundamentals[sym.ticker] = fund;
          lenses[sym.ticker] = { ...lensesFrom(got, fund), at: t.toISOString() };
          if (got) quotes[sym.ticker] = { close: got.series[got.series.length - 1].close, ccy: got.ccy, at: t.toISOString() };
        }
        for (const s of desk?.shortlist ?? []) {
          if (s.status === 'dropped') continue;
          const got = prices({ yahoo: s.yahoo ?? s.ticker, stooq: s.stooq ?? null, ccy: s.ccy });
          if (got) quotes[s.ticker] = { close: got.series[got.series.length - 1].close, ccy: got.ccy, at: t.toISOString() };
        }
        next.lenses = lenses;
        next.quotes = { ...next.quotes, ...quotes }; // a symbol that failed today keeps yesterday's
        refreshed = true;
      }

      // Each position in pounds, from the price source's currency (GBp is pence).
      let value = 0; let ret = 0; let dayMove = 0;
      next.positions.list = next.positions.list.map((p) => {
        const sym = symFor(p.t212);
        const before = known.get(p.t212);
        const ticker = sym?.ticker ?? before?.ticker ?? null;
        const quote = ticker ? next.quotes[ticker] : null;
        const ccy = quote?.ccy ?? sym?.ccy ?? p.ccy ?? before?.ccy ?? null;
        const rate = gbpRate(ccy, next.fx);
        const valueGbp = rate != null ? round2(p.qty * p.price * rate) : null;
        const returnGbp = round2(p.ppl ?? p.returnGbp ?? 0);
        if (valueGbp != null) {
          value += valueGbp;
          // Today's move: the live price against the last close the morning refresh saw.
          if (quote?.close) dayMove += p.qty * (p.price - quote.close) * rate;
        }
        ret += returnGbp;
        return { t212: p.t212, ticker, qty: p.qty, avg: p.avg, price: p.price, ccy, valueGbp, returnGbp, ppl: p.ppl ?? returnGbp };
      });
      next.account = { valueGbp: round2(value), returnGbp: round2(ret), dayMoveGbp: round2(dayMove), dayMovePct: value ? round2((dayMove / (value - dayMove)) * 100) : 0 };

      const same = prev && JSON.stringify({ ...prev, at: null }) === JSON.stringify({ ...next, at: null });
      if (!same) {
        next.at = t.toISOString();
        writeFile(MARKET_PATH, next, marketFile.sha);
      }
      // Only once it's saved: a failed save fetches the prices again on the next run.
      if (refreshed) {
        if (secDue) props.put('STOCKS_SEC_AT', String(t.getTime()));
        props.put('STOCKS_DAY', day);
      }

      // Claude's alert: once per id, at most one a day.
      const alert = desk?.alert;
      if (alert?.id && alert.text && get('STOCKS_ALERT_SENT') !== alert.id && get('STOCKS_ALERT_DAY') !== day) {
        props.put('STOCKS_ALERT_SENT', alert.id);
        props.put('STOCKS_ALERT_DAY', day);
        send({ title: 'Stocks', body: String(alert.text).slice(0, 140), url: `./?big=stocks${alert.ticker ? `&ticker=${encodeURIComponent(alert.ticker)}` : ''}`, tag: `stocks:${alert.id}` });
      }
      return same ? null : 'stocks: market saved';
    } catch (e) {
      log(`Stocks failed: ${e?.message ?? e}`);
      return null;
    }
  }

  return { run };
}
