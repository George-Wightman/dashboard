// The forecast to the London start (js/ui/forecast.js): his pot month by month from the latest
// statement balance, given the hours he works a week and what he spends. Three layers make the
// settings: amounts worked out from his statements (each category's average since the day he counts
// from, a little over and rounded up to £10), what Claude has agreed with him (`money.forecast` in
// the private ledger), and what he has moved the sliders to (one synced record, FORECAST_ID). Pure.

import { addDays, daysInMonth, dayOfMonth } from './dates.js';
import { ONE_OFF_CATS, inOut, wherePlaces, isCovered, startDay } from './money.js';
import { hoursSummary, grossFor, nextMonth } from './hours.js';

export const FORECAST_ID = 'money:forecast';
export const SAFE_PENCE = 75000; // a month's living money in hand when the job starts
export const WEEKS_A_MONTH = 365.25 / 12 / 7;
export const BAND = [6, 12]; // hours a week either side of his choice, drawn as a band
const DEFAULT_HOURS = 7;
const monthOf = (day) => day.slice(0, 7);
const roundUp10 = (pence) => Math.ceil(pence / 1000) * 1000;

// Monthly spending by category from the statements: the average since he counts from, 5% over,
// rounded up to £10. One-off categories (the car) are left out.
export function statementSpend(money) {
  const io = money ? inOut(money) : null;
  if (!io) return {};
  let days = 0;
  for (let d = io.from; d <= io.to; d = addDays(d, 1)) if (isCovered(money, d)) days++;
  const months = days / (365.25 / 12);
  if (months < 1) return {};
  const out = {};
  for (const e of wherePlaces(money, io.from, io.to)) {
    if (ONE_OFF_CATS.includes(e.cat) || e.total <= 0) continue;
    out[e.cat] = roundUp10((e.total / months) * 1.05);
  }
  return out;
}

// What he spent a month on each category, as it was (no rounding): shown faintly beside a slider.
export function statementAverage(money) {
  const io = money ? inOut(money) : null;
  if (!io) return {};
  let days = 0;
  for (let d = io.from; d <= io.to; d = addDays(d, 1)) if (isCovered(money, d)) days++;
  const months = days / (365.25 / 12);
  const out = {};
  if (months < 1) return out;
  for (const e of wherePlaces(money, io.from, io.to)) if (!ONE_OFF_CATS.includes(e.cat)) out[e.cat] = Math.round(e.total / months);
  return out;
}

const clean = (o) => JSON.parse(JSON.stringify(o ?? {}));

// The agreed settings (statements, then Claude's), before his own changes.
export function agreedSettings(money) {
  const f = money?.forecast ?? {};
  return {
    hours: typeof f.hours === 'number' ? f.hours : DEFAULT_HOURS,
    spend: { ...statementSpend(money), ...clean(f.spend) },
    flights: { count: 0, price: 8000, ...clean(f.flights) },
    oneOffs: clean(f.oneOffs ?? []),
  };
}

// What the sliders show: the agreed settings with his changes on top.
export function forecastSettings(money, doc) {
  const base = agreedSettings(money);
  const r = doc?.calendar?.[FORECAST_ID];
  if (r?.status !== 'active') return base;
  const mine = Object.fromEntries((r.oneOffs ?? []).map((o) => [o.id, o]));
  return {
    hours: typeof r.hours === 'number' ? r.hours : base.hours,
    spend: { ...base.spend, ...clean(r.spend) },
    flights: { ...base.flights, ...clean(r.flights) },
    oneOffs: base.oneOffs.map((o) => ({ ...o, ...(mine[o.id] ? { on: mine[o.id].on, amount: mine[o.id].amount, month: mine[o.id].month } : {}) })),
  };
}

export const monthlySpend = (s) => Object.values(s.spend).reduce((t, v) => t + v, 0);
const payFor = (hoursAWeek, pay, ratio) => Math.round((grossFor(hoursAWeek * WEEKS_A_MONTH, pay) ?? 0) * ratio * 100);

// Month by month from the latest balance to the month before the start date. The month of the
// balance counts only its days after it. The next pay is what Hours has booked or done; every later
// pay is `hours` a week. Returns { rows: [{ month, pay, spend, oneOff, pot }], end, lowest, start }.
export function runForecast({ money, doc, today, settings, hours = settings.hours }) {
  const start = startDay(doc);
  const bal = [...(money?.balances ?? [])].sort((a, b) => a.day.localeCompare(b.day)).at(-1);
  if (!bal) return null;
  const lastMonth = monthOf(addDays(`${monthOf(start)}-01`, -1));
  const h = hoursSummary(doc, today);
  const ratio = h.ratio ?? 1;
  const months = [];
  for (let m = monthOf(bal.day); m <= lastMonth; m = nextMonth(m)) months.push(m);
  if (!months.length) return null;
  const flightsEach = months.length ? (settings.flights.count * settings.flights.price) / months.length : 0;
  const perMonth = monthlySpend(settings);
  let pot = bal.total;
  const rows = [];
  for (const m of months) {
    const dim = daysInMonth(`${m}-01`);
    const share = m === monthOf(bal.day) ? (dim - dayOfMonth(bal.day)) / dim : 1;
    let pay = 0;
    if (m === h.expected.period) pay = Math.round((h.expected.net ?? 0) * 100);
    else if (m > h.expected.period) pay = payFor(hours, h.pay, ratio);
    const spend = Math.round(perMonth * share + flightsEach);
    const oneOff = settings.oneOffs.filter((o) => o.on && o.month === m).reduce((t, o) => t + o.amount, 0);
    pot += pay - spend + oneOff;
    rows.push({ month: m, pay, spend, oneOff, pot });
  }
  const lowest = rows.reduce((lo, r) => (lo == null || r.pot < lo.pot ? r : lo), null);
  return { rows, end: pot, lowest, start, from: bal };
}

// Hours a week to end with `target` pence: the forecast is a straight line in hours.
export function hoursFor({ money, doc, today, settings, target }) {
  const a = runForecast({ money, doc, today, settings, hours: 0 });
  const b = runForecast({ money, doc, today, settings, hours: 10 });
  if (!a || !b || b.end === a.end) return null;
  return Math.max(0, ((target - a.end) / (b.end - a.end)) * 10);
}
