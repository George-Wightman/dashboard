// The number lenses behind Stocks (docs/superpowers/specs/2026-11-12-stocks-design.md), worked out by
// the planner from free data so they cost no tokens. Closes are daily, oldest first. Pure.
// A lens is { dot: 'green'|'amber'|'red'|'grey', reason } with the reason in plain English.

export const THRESHOLDS = {
  // Momentum research uses the 12-month return skipping the last month; ±10% separates a real
  // trend from noise for a single stock.
  trendGreen: 0.10,
  trendRed: -0.10,
  // A fall is unusual when it's well past the stock's own typical drawdown: 1.5× is worth a look,
  // 2.5× is a big move even for a volatile name.
  riskAmber: 1.5,
  riskRed: 2.5,
  // P/E against its own 5-year median: 20% over is stretched, 50% over is expensive for it.
  pe: { amber: 1.2, red: 1.5 },
  health: {
    grossMargin: 0.40, // pricing power: 40%+ gross margin
    opMarginStdMax: 0.05, // steady: quarterly operating margin varies by under 5 points
    roicGreen: 0.10, // earns 10%+ after tax on the money invested in it
    debtToEbitdaRed: 4, // more than 4 years of operating profit in debt is heavy
  },
};

const YEAR = 252;
const MONTH = 21;
const pct = (x) => `${Math.round(Math.abs(x) * 100)}%`;
const grey = (reason) => ({ dot: 'grey', reason });
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

export function trend(closes) {
  if (!closes || closes.length < YEAR + 1) return { ...grey('Not enough price history yet'), value: null };
  const n = closes.length;
  const value = closes[n - 1 - MONTH] / closes[n - 1 - YEAR] - 1;
  const dot = value >= THRESHOLDS.trendGreen ? 'green' : value <= THRESHOLDS.trendRed ? 'red' : 'amber';
  const reason = Math.abs(value) < 0.02 ? 'Flat over 12 months' : `${value > 0 ? 'Up' : 'Down'} ${pct(value)} over 12 months`;
  return { dot, reason, value };
}

const drawdownAt = (closes, i) => {
  let high = -Infinity;
  for (let j = Math.max(0, i - YEAR + 1); j <= i; j++) high = Math.max(high, closes[j]);
  return 1 - closes[i] / high;
};

export function risk(closes) {
  if (!closes || closes.length < 60) return { ...grey('Not enough price history yet'), drawdown: null, typical: null };
  const all = closes.map((_, i) => drawdownAt(closes, i));
  const drawdown = all[all.length - 1];
  const typical = Math.max(median(all), 0.01);
  const ratio = drawdown / typical;
  const dot = ratio >= THRESHOLDS.riskRed ? 'red' : ratio >= THRESHOLDS.riskAmber ? 'amber' : 'green';
  const reason = drawdown < 0.01 ? 'At its high'
    : `${pct(drawdown)} off its high — ${dot === 'green' ? 'normal for it' : dot === 'amber' ? 'more than usual for it' : 'far more than usual for it'}`;
  return { dot, reason, drawdown, typical };
}

export function rsi14(closes) {
  if (!closes || closes.length < 15) return null;
  let gain = 0; let loss = 0;
  for (let i = 1; i <= 14; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= 14; loss /= 14;
  for (let i = 15; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * 13 + Math.max(d, 0)) / 14;
    loss = (loss * 13 + Math.max(-d, 0)) / 14;
  }
  if (loss === 0) return 100;
  return Math.round(100 - 100 / (1 + gain / loss));
}

const returns = (closes) => closes.slice(1).map((c, i) => c / closes[i] - 1);

export function sigma(closes) {
  const r = returns(closes ?? []).slice(-60);
  if (r.length < 2) return 0;
  const m = r.reduce((t, x) => t + x, 0) / r.length;
  return Math.sqrt(r.reduce((t, x) => t + (x - m) ** 2, 0) / (r.length - 1));
}

export function moveToday(closes) {
  return closes && closes.length >= 2 ? closes[closes.length - 1] / closes[closes.length - 2] - 1 : 0;
}

export function priceLens({ price, epsTtm, peHistory }) {
  if (!(epsTtm > 0) || !price) return grey('No profits to price it on');
  const pe = price / epsTtm;
  const med = median((peHistory ?? []).filter((x) => x > 0));
  if (!med) return grey(`P/E ${Math.round(pe)}, no history to compare`);
  const ratio = pe / med;
  const dot = ratio >= THRESHOLDS.pe.red ? 'red' : ratio >= THRESHOLDS.pe.amber ? 'amber' : 'green';
  const where = ratio >= 1.05 ? 'above' : ratio <= 0.95 ? 'below' : 'about';
  return { dot, reason: `P/E ${Math.round(pe)}, ${where === 'about' ? 'about at' : where} its 5-year median of ${Math.round(med)}` };
}

// Quarterly values of an SEC us-gaap concept, oldest first: 10-Q quarters (3-month spans when a
// start is given) and Q4 worked out as the 10-K year minus the three quarters before it.
export function quarters(facts, names, unit = 'USD') {
  const g = facts?.facts?.['us-gaap'] ?? {};
  const name = names.find((n) => g[n]?.units?.[unit]);
  if (!name) return null;
  const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
  const rows = g[name].units[unit];
  const byEnd = new Map();
  for (const r of rows) {
    if (!r.end) continue;
    const span = r.start ? days(r.start, r.end) : null;
    if (/^Q[1-4]$/.test(r.fp ?? '') && (span == null || (span > 75 && span < 105))) byEnd.set(r.end, r.val);
  }
  for (const r of rows) {
    if (r.form !== '10-K' || r.fp !== 'FY' || !r.start || days(r.start, r.end) < 340 || byEnd.has(r.end)) continue;
    const inside = [...byEnd.entries()].filter(([end]) => end > r.start && end < r.end);
    if (inside.length === 3) byEnd.set(r.end, r.val - inside.reduce((t, [, v]) => t + v, 0));
  }
  return [...byEnd.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([end, val]) => ({ end, val }));
}

// A balance-sheet figure (an instant): the latest value.
export function latest(facts, names, unit = 'USD') {
  const g = facts?.facts?.['us-gaap'] ?? {};
  const name = names.find((n) => g[n]?.units?.[unit]);
  if (!name) return null;
  const rows = [...g[name].units[unit]].filter((r) => r.end).sort((a, b) => (a.end < b.end ? -1 : 1));
  return rows.length ? rows[rows.length - 1].val : null;
}

const REVENUE = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet'];
const ttm = (qs) => (qs && qs.length >= 4 ? qs.slice(-4).reduce((t, q) => t + q.val, 0) : null);

export function healthLens(facts) {
  const rev = quarters(facts, REVENUE);
  const gp = quarters(facts, ['GrossProfit']);
  const op = quarters(facts, ['OperatingIncomeLoss']);
  if (!rev || !gp || !op || rev.length < 4 || gp.length < 4 || op.length < 4) return grey('Accounts not available');
  const H = THRESHOLDS.health;
  const revT = ttm(rev); const gpT = ttm(gp); const opT = ttm(op);
  if (!(revT > 0)) return grey('Accounts not available');
  const gross = gpT / revT;
  const margins = op.slice(-8).map((q) => {
    const r = rev.find((x) => x.end === q.end)?.val;
    return r ? q.val / r : null;
  }).filter((x) => x != null);
  const m = margins.reduce((t, x) => t + x, 0) / margins.length;
  const std = Math.sqrt(margins.reduce((t, x) => t + (x - m) ** 2, 0) / margins.length);
  const equity = latest(facts, ['StockholdersEquity']) ?? 0;
  const debt = latest(facts, ['LongTermDebt', 'LongTermDebtNoncurrent']) ?? 0;
  const roic = equity + debt > 0 ? (opT * 0.79) / (equity + debt) : null;
  const debtYears = opT > 0 ? debt / opT : Infinity;
  const reason = `${Math.round(gross * 100)}% gross margin, ${Math.round((opT / revT) * 100)}% operating${roic != null ? `, ${Math.round(roic * 100)}% return on capital` : ''}`;
  if (opT <= 0) return { dot: 'red', reason: `Losing money at the operating line; ${Math.round(gross * 100)}% gross margin` };
  if (debtYears > H.debtToEbitdaRed) return { dot: 'red', reason: `${reason}; heavy debt` };
  if (gross >= H.grossMargin && std <= H.opMarginStdMax && roic != null && roic >= H.roicGreen) return { dot: 'green', reason };
  return { dot: 'amber', reason };
}
