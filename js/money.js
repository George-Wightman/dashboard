// Money (docs/superpowers/specs/2026-11-05-hours-money-london-design.md): what George earns and spends,
// back from his bank statements and forward to the London start date. The ledger is `money.json` in
// the private sync repo, written by Claude after reading statements on the laptop: only totals per day
// per category, income items, balance totals and plan lines, never shop names or account numbers.
// Amounts are whole pence. Future income comes from Hours (js/hours.js). Pure.

import { addDays, daysInMonth, dayOfMonth } from './dates.js';
import { payForecast, hoursSummary, nextMonth } from './hours.js';
import { euDays } from './eu.js';

export const MONEY_PATH = 'money.json';
export const MONEY_KEY = 'dash_money';
export const START_ID = 'move:start';
export const DEFAULT_START = '2027-05-01';

export const CATEGORIES = [
  { id: 'groceries', label: 'Groceries' },
  { id: 'eating-out', label: 'Eating out' },
  { id: 'going-out', label: 'Going out' },
  { id: 'local-travel', label: 'Local travel' },
  { id: 'trips', label: 'Trips' },
  { id: 'gym-health', label: 'Gym & health' },
  { id: 'phone-subs', label: 'Phone & subscriptions' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'gifts', label: 'Gifts' },
  { id: 'rent-bills', label: 'Rent & bills' },
  { id: 'other', label: 'Other' },
];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const categoryLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label ?? id;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const pence = (v) => Number.isInteger(v) && Math.abs(v) < 1e9;
const monthOf = (day) => day.slice(0, 7);
const sum = (o) => Object.values(o ?? {}).reduce((t, v) => t + v, 0);

export function validMoney(m) {
  if (!m || typeof m !== 'object' || m.v !== 1) return false;
  if (!m.days || typeof m.days !== 'object') return false;
  for (const [day, cats] of Object.entries(m.days)) {
    if (!DAY.test(day) || !cats || typeof cats !== 'object') return false;
    if (!Object.entries(cats).every(([c, v]) => CATEGORY_IDS.includes(c) && pence(v))) return false;
  }
  if (!Array.isArray(m.income) || !m.income.every((i) => i && DAY.test(i.day ?? '') && pence(i.amount) && ['pay', 'refund', 'other'].includes(i.kind))) return false;
  if (!Array.isArray(m.balances) || !m.balances.every((b) => b && DAY.test(b.day ?? '') && pence(b.total))) return false;
  if (!Array.isArray(m.plan) || !m.plan.every((p) => p && MONTH.test(p.month ?? '') && pence(p.amount) && ['spend', 'income'].includes(p.kind) && typeof p.label === 'string' && (p.cat == null || CATEGORY_IDS.includes(p.cat)))) return false;
  if (!Array.isArray(m.covered) || !m.covered.every((c) => c && DAY.test(c.from ?? '') && DAY.test(c.to ?? '') && c.from <= c.to)) return false;
  return true;
}

export const emptyMoney = () => ({ v: 1, updated: null, days: {}, income: [], balances: [], plan: [], covered: [] });

// The start date of the London job: one synced setting, 1 May 2027 unless changed.
export function startDay(doc) {
  const r = doc?.calendar?.[START_ID];
  return r?.status === 'active' && DAY.test(r.day ?? '') ? r.day : DEFAULT_START;
}

// Is `day` inside a stretch a statement covered? Days with no spending there are real £0 days.
export const isCovered = (money, day) => money.covered.some((c) => day >= c.from && day <= c.to);
export const lastCovered = (money) => money.covered.reduce((m, c) => (m == null || c.to > m ? c.to : m), null);

// One month's spending by category, its income (one-offs apart) and how many of its days are covered.
export function monthActuals(money, month) {
  const spend = {};
  for (const [day, cats] of Object.entries(money.days)) {
    if (monthOf(day) !== month) continue;
    for (const [c, v] of Object.entries(cats)) spend[c] = (spend[c] ?? 0) + v;
  }
  let income = 0, oneOff = 0;
  for (const i of money.income) {
    if (monthOf(i.day) !== month) continue;
    if (i.oneOff) oneOff += i.amount; else income += i.amount;
  }
  let days = 0;
  for (let d = `${month}-01`; monthOf(d) === month; d = addDays(d, 1)) if (isCovered(money, d)) days++;
  return { month, spend, total: sum(spend), income, oneOff, days, full: days === daysInMonth(`${month}-01`) };
}

// Average spending a month by category over the last `n` fully covered months before `today`'s.
export function averageSpend(money, today, n = 3) {
  const months = [];
  for (let m = monthOf(addDays(`${monthOf(today)}-01`, -1)); months.length < n && m >= '2000-01'; m = monthOf(addDays(`${m}-01`, -1))) {
    const a = monthActuals(money, m);
    if (a.full) months.push(a);
    if (!money.covered.some((c) => c.from <= `${m}-01`)) break;
  }
  const out = {};
  if (!months.length) return { spend: out, total: 0, months: 0 };
  for (const a of months) for (const [c, v] of Object.entries(a.spend)) out[c] = (out[c] ?? 0) + v;
  for (const c of Object.keys(out)) out[c] = Math.round(out[c] / months.length);
  return { spend: out, total: sum(out), months: months.length };
}

const planFor = (money, month, kind) => money.plan.filter((p) => p.month === month && p.kind === kind);

// Month by month from the first statement to the month before the start date:
// [{ month, actual, income, spend, pot }]. Actual months come from the ledger; the rest are planned:
// income from Hours (booked shifts, then his average) plus plan lines, spending at his recent average
// plus plan lines. The pot starts from the latest balance total and is null before it.
export function potForecast({ money, doc, today }) {
  const start = startDay(doc);
  const lastMonth = monthOf(addDays(`${monthOf(start)}-01`, -1));
  const covered = lastCovered(money);
  const firstDay = money.covered.reduce((m, c) => (m == null || c.from < m ? c.from : m), null);
  if (!firstDay) return { rows: [], atStart: null, start };
  const avg = averageSpend(money, today);
  const pay = payForecast(doc, today, monthOf(today), lastMonth);
  const bal = [...money.balances].sort((a, b) => a.day.localeCompare(b.day)).at(-1) ?? null;
  const rows = [];
  let pot = null;
  for (let m = monthOf(firstDay); m <= lastMonth; m = nextMonth(m)) {
    const a = monthActuals(money, m);
    const dim = daysInMonth(`${m}-01`);
    // The part of the month no statement covers yet (past days too: spent, just not seen yet).
    const planFrom = [`${m}-01`, covered ? addDays(covered, 1) : `${m}-01`].sort().at(-1);
    const planDays = monthOf(planFrom) === m ? dim - dayOfMonth(planFrom) + 1 : 0;
    const share = planDays / dim;
    const plannedSpend = Math.round(avg.total * share) + planFor(money, m, 'spend').reduce((t, p) => t + p.amount, 0);
    const payNet = pay[m]?.net != null && m >= monthOf(today) ? Math.round(pay[m].net * 100) : 0;
    const plannedIncome = (share > 0 ? payNet : 0) + planFor(money, m, 'income').reduce((t, p) => t + p.amount, 0);
    const income = a.income + a.oneOff + plannedIncome;
    const spend = a.total + plannedSpend;
    if (bal && monthOf(bal.day) === m) {
      // From the balance on: only what happens after its day.
      let after = 0;
      for (const [day, cats] of Object.entries(money.days)) if (monthOf(day) === m && day > bal.day) after -= sum(cats);
      for (const i of money.income) if (monthOf(i.day) === m && i.day > bal.day) after += i.amount;
      pot = bal.total + after + plannedIncome - plannedSpend;
    } else if (pot != null) {
      pot += income - spend;
    }
    rows.push({ month: m, actual: share === 0, income, spend, plannedSpend, plannedIncome, spendByCat: a.spend, pot });
  }
  return { rows, atStart: pot, start };
}

// Spending per week by category over the covered days that pass `test`.
function perWeek(money, days) {
  const spend = {};
  for (const d of days) for (const [c, v] of Object.entries(money.days[d] ?? {})) spend[c] = (spend[c] ?? 0) + v;
  const weeks = days.length / 7;
  const out = {};
  for (const [c, v] of Object.entries(spend)) out[c] = weeks ? Math.round(v / weeks) : 0;
  return { days: days.length, perWeek: out, total: weeks ? Math.round(sum(spend) / weeks) : 0 };
}

const coveredDays = (money, from, to) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isCovered(money, d)) out.push(d);
  return out;
};

// Two stretches side by side, per week so different lengths compare fairly. `a` and `b` are
// { from, to }; with `eu: true` instead, a is his days in the EU (Salzburg) and b the rest.
export function compare(money, doc, { a, b, eu = false } = {}) {
  if (eu) {
    const inEu = euDays(doc);
    const all = money.covered.flatMap((c) => coveredDays(money, c.from, c.to));
    const unique = [...new Set(all)].sort();
    return { a: { label: 'Salzburg', ...perWeek(money, unique.filter((d) => inEu.has(d))) }, b: { label: 'UK', ...perWeek(money, unique.filter((d) => !inEu.has(d))) } };
  }
  return { a: { label: `${a.from} – ${a.to}`, ...perWeek(money, coveredDays(money, a.from, a.to)) }, b: { label: `${b.from} – ${b.to}`, ...perWeek(money, coveredDays(money, b.from, b.to)) } };
}

// The tile: what he'll have at the start, this month so far against its plan, the next pay.
export function moneySummary(money, doc, today) {
  const f = money ? potForecast({ money, doc, today }) : { rows: [], atStart: null, start: startDay(doc) };
  const row = f.rows.find((r) => r.month === monthOf(today));
  const spent = money ? monthActuals(money, monthOf(today)).total : null;
  const avg = money ? averageSpend(money, today).total : null;
  const h = hoursSummary(doc, today);
  return { start: f.start, atStart: f.atStart, spent, planned: row ? row.spend : avg || null, nextPay: h.expected, rows: f.rows };
}

export const gbp = (p, { pennies = false } = {}) => {
  if (p == null || !Number.isFinite(p)) return '—';
  const v = p / 100;
  const s = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: pennies ? 2 : 0, maximumFractionDigits: pennies ? 2 : 0 });
  return `${v < 0 ? '−' : ''}£${s}`;
};

// Merges an import into the ledger: days, income and balances replace what's there for the same day
// (income by day + kind + amount + note), plan lines by month + label, covered stretches join up.
export function mergeMoney(base, add) {
  const out = structuredClone(base ?? emptyMoney());
  Object.assign(out.days, add.days ?? {});
  const key = (i) => `${i.day}|${i.kind}|${i.amount}|${i.note ?? ''}`;
  const income = new Map(out.income.map((i) => [key(i), i]));
  for (const i of add.income ?? []) income.set(key(i), i);
  out.income = [...income.values()].sort((x, y) => x.day.localeCompare(y.day));
  const bal = new Map(out.balances.map((b) => [b.day, b]));
  for (const b of add.balances ?? []) bal.set(b.day, b);
  out.balances = [...bal.values()].sort((x, y) => x.day.localeCompare(y.day));
  const plan = new Map(out.plan.map((p) => [`${p.month}|${p.label}`, p]));
  for (const p of add.plan ?? []) plan.set(`${p.month}|${p.label}`, p);
  out.plan = [...plan.values()].filter((p) => p.amount !== 0).sort((x, y) => x.month.localeCompare(y.month));
  const ranges = [...out.covered, ...(add.covered ?? [])].sort((x, y) => x.from.localeCompare(y.from));
  out.covered = [];
  for (const r of ranges) {
    const last = out.covered.at(-1);
    if (last && r.from <= addDays(last.to, 1)) { if (r.to > last.to) last.to = r.to; } else out.covered.push({ ...r });
  }
  out.updated = add.updated ?? out.updated;
  return out;
}
