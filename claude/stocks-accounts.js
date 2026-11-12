// Stocks: US company accounts, fetched from the laptop (the Saturday routine runs `stocks-accounts`).
// The SEC asks every caller to say who it is; Google's script servers can't, so the planner's own SEC
// step gets nothing (12 Nov 2026). Here the accounts become Price and Health lens notes in
// stocks/desk.json, worked out by the same code the planner uses. Plain code: no tokens.
// `fetchText(url, { contact }) → { status, text }`; the caller sends `contact` as the request's
// identification header.

import { healthLens, priceLens, quarters } from '../planner/stocks-lenses.js';
import { parseYahoo, peHistory } from '../planner/stocks.js';

export async function accountsPatch({ desk, fetchText, contact }) {
  const lensNotes = {};
  const done = [];
  const failed = [];
  const watched = Object.values(desk?.symbols ?? {}).filter((s) => s?.cik && desk?.tiers?.[s.ticker] === 'watched');
  for (const s of watched) {
    try {
      const sec = await fetchText(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(s.cik).padStart(10, '0')}.json`, { contact });
      if (sec.status !== 200) { failed.push(`${s.ticker} (SEC ${sec.status})`); continue; }
      const facts = JSON.parse(sec.text);
      const eps = quarters(facts, ['EarningsPerShareDiluted'], 'USD/shares') ?? [];
      const epsTtm = eps.length >= 4 ? eps.slice(-4).reduce((t, q) => t + q.val, 0) : null;
      const px = await fetchText(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s.yahoo)}?range=5y&interval=1d`, {});
      const series = px.status === 200 ? parseYahoo(px.text)?.series ?? null : null;
      const close = series ? series[series.length - 1].close : null;
      lensNotes[s.ticker] = {
        health: healthLens(facts),
        price: close ? priceLens({ price: close, epsTtm, peHistory: peHistory(series, eps) }) : { dot: 'grey', reason: 'No price data today' },
      };
      done.push(s.ticker);
    } catch (e) {
      failed.push(`${s.ticker} (${e?.message ?? e})`);
    }
  }
  return { lensNotes, done, failed };
}
