// The forecast to the London start (js/ui/forecast.js): his pot month by month from the latest
// statement balance, given the hours he works a week and what he spends. Three layers make the
// settings: amounts worked out from his statements (each category's average since the day he counts
// from, a little over and rounded up to £10), what Claude has agreed with him (`money.forecast` in
// the private ledger), and what he has moved the sliders to (one synced record, FORECAST_ID). Pure.
// Spending has two rates: at home (`spend`) and in Salzburg (`away`), used on the days he has
// marked as EU days (js/eu.js). Presets are whole sets of settings he can switch between: the
// agreed figures, his exact averages, and any Claude has agreed with him (`money.forecast.presets`).

import { addDays, daysInMonth, dayOfMonth } from './dates.js';
import { ONE_OFF_CATS, inOut, wherePlaces, isCovered, startDay } from './money.js';
import { hoursSummary, grossFor, nextMonth, payPeriods } from './hours.js';
import { euDays } from './eu.js';

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

// What he spent a month on each category at home and in Salzburg (his EU days), exactly, from the
// covered days since he counts from. Trips (flights, trains home) are averaged over all the days
// rather than split, since he books them from either place. { home, away, homeDays, awayDays }.
export function statementSplit(money, doc) {
  const io = money ? inOut(money) : null;
  const out = { home: {}, away: {}, homeDays: 0, awayDays: 0 };
  if (!io) return out;
  const eu = euDays(doc);
  const sums = { home: {}, away: {} };
  let trips = 0;
  for (let d = io.from; d <= io.to; d = addDays(d, 1)) {
    if (!isCovered(money, d)) continue;
    const where = eu.has(d) ? 'away' : 'home';
    out[`${where}Days`]++;
    for (const [c, v] of Object.entries(money.days[d] ?? {})) {
      if (ONE_OFF_CATS.includes(c)) continue;
      if (c === 'trips') { trips += v; continue; }
      sums[where][c] = (sums[where][c] ?? 0) + v;
    }
  }
  const month = 365.25 / 12;
  const all = out.homeDays + out.awayDays;
  for (const where of ['home', 'away']) {
    const n = out[`${where}Days`];
    if (!n) continue;
    for (const [c, v] of Object.entries(sums[where])) if (v > 0) out[where][c] = Math.round((v / n) * month);
    if (trips > 0) out[where].trips = Math.round((trips / all) * month);
  }
  return out;
}

const clean = (o) => JSON.parse(JSON.stringify(o ?? {}));

// The agreed settings (statements, then Claude's), before his own changes. Without agreed Salzburg
// figures, spending there is the same as at home.
export function agreedSettings(money) {
  const f = money?.forecast ?? {};
  const spend = { ...statementSpend(money), ...clean(f.spend) };
  return {
    hours: typeof f.hours === 'number' ? f.hours : DEFAULT_HOURS,
    spend,
    away: f.away ? clean(f.away) : { ...spend },
    flights: { count: 0, price: 8000, ...clean(f.flights) },
    oneOffs: clean(f.oneOffs ?? []),
  };
}

// A partial set of settings laid over a whole one: one-offs by id (only the agreed ones exist).
function overlay(base, r) {
  const mine = Object.fromEntries((r.oneOffs ?? []).map((o) => [o.id, o]));
  const pick = (o) => Object.fromEntries(['on', 'amount', 'month'].filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  return {
    hours: typeof r.hours === 'number' ? r.hours : base.hours,
    spend: { ...base.spend, ...clean(r.spend) },
    away: { ...base.away, ...clean(r.away) },
    flights: { ...base.flights, ...clean(r.flights) },
    oneOffs: base.oneOffs.map((o) => ({ ...o, ...(mine[o.id] ? pick(mine[o.id]) : {}) })),
  };
}

// What the sliders show: the agreed settings with his changes on top.
export function forecastSettings(money, doc) {
  const base = agreedSettings(money);
  const r = doc?.calendar?.[FORECAST_ID];
  return r?.status === 'active' ? overlay(base, r) : base;
}

// The presets he can switch between: the agreed figures, his exact averages (home and Salzburg
// apart, flights inside them, hours at his last-8-weeks average), then Claude's. [{ id, label, note, settings }].
export function forecastPresets(money, doc, today) {
  const agreed = agreedSettings(money);
  const out = [{ id: 'agreed', label: 'Cautious', note: 'The agreed figures, rounded up', settings: agreed }];
  const split = statementSplit(money, doc);
  if (split.homeDays >= 28) {
    const avg = hoursSummary(doc, today).weeklyAverage;
    out.push({ id: 'averages', label: 'Your averages', note: 'Exactly what you spent and worked, nothing added', settings: {
      hours: typeof avg === 'number' && avg > 0 ? Math.round(avg * 2) / 2 : agreed.hours,
      spend: split.home,
      away: split.awayDays >= 14 ? split.away : { ...split.home },
      flights: { ...agreed.flights, count: 0 },
      oneOffs: clean(agreed.oneOffs),
    } });
  }
  for (const p of money?.forecast?.presets ?? []) {
    const s = overlay(agreed, p);
    // A preset's spending replaces the agreed one whole, so a category it leaves out is £0.
    if (p.spend) s.spend = clean(p.spend);
    if (p.away) s.away = clean(p.away);
    out.push({ id: p.id, label: p.label, note: p.note ?? null, settings: s });
  }
  return out;
}

// The preset the settings match exactly, or null once he has moved a slider away from it.
const sorted = (o) => Object.entries(o ?? {}).filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b));
export function matchingPreset(settings, presets) {
  const key = (s) => JSON.stringify([s.hours, sorted(s.spend), sorted(s.away), s.flights.count, s.flights.price,
    s.oneOffs.map((o) => [o.id, o.on, o.amount, o.month])]);
  const k = key(settings);
  return presets.find((p) => key(p.settings) === k) ?? null;
}

export const monthlySpend = (s) => Object.values(s.spend).reduce((t, v) => t + v, 0);
export const monthlyAway = (s) => Object.values(s.away ?? s.spend).reduce((t, v) => t + v, 0);
const payFor = (hours, pay, ratio) => Math.round((grossFor(hours, pay) ?? 0) * ratio * 100);
const daysIn = (w) => (Date.parse(w.to) - Date.parse(w.from)) / 86400000 + 1;

// Month by month from the latest balance to the month before the start date. The month of the
// balance counts only its days after it. The next pay is what Hours has booked or done; every later
// pay is `hours` a week over the days its pay period runs. Returns { rows: [{ month, pay, spend, oneOff, pot }], end, lowest, start }.
export function runForecast({ money, doc, today, settings, hours = settings.hours }) {
  const start = startDay(doc);
  const bal = [...(money?.balances ?? [])].sort((a, b) => a.day.localeCompare(b.day)).at(-1);
  if (!bal) return null;
  const lastMonth = monthOf(addDays(`${monthOf(start)}-01`, -1));
  const h = hoursSummary(doc, today);
  const ratio = h.ratio ?? 1;
  const periods = payPeriods(doc, h.pay.cutoff);
  const months = [];
  for (let m = monthOf(bal.day); m <= lastMonth; m = nextMonth(m)) months.push(m);
  if (!months.length) return null;
  const flightsEach = months.length ? (settings.flights.count * settings.flights.price) / months.length : 0;
  const home = monthlySpend(settings), away = monthlyAway(settings);
  const eu = euDays(doc);
  let pot = bal.total;
  const rows = [];
  for (const m of months) {
    const dim = daysInMonth(`${m}-01`);
    // Each day left in the month costs a day at the home or the Salzburg rate.
    let awayDays = 0, homeDays = 0;
    for (let d = m === monthOf(bal.day) ? dayOfMonth(bal.day) + 1 : 1; d <= dim; d++) {
      if (eu.has(`${m}-${String(d).padStart(2, '0')}`)) awayDays++; else homeDays++;
    }
    let pay = 0;
    if (m === h.expected.period) pay = Math.round((h.expected.net ?? 0) * 100);
    else if (m > h.expected.period) pay = payFor((hours / 7) * daysIn(periods.windowOf(m)), h.pay, ratio);
    const spend = Math.round((home * homeDays + away * awayDays) / dim + flightsEach);
    const oneOff = settings.oneOffs.filter((o) => o.on && o.month === m).reduce((t, o) => t + o.amount, 0);
    pot += pay - spend + oneOff;
    rows.push({ month: m, pay, spend, oneOff, pot, awayDays });
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
