// Hours (docs/superpowers/specs/2026-11-05-hours-money-london-design.md): his paid shifts, read from
// the Work calendar. Shifts that have ended are the planner's `work:<event id>` records (planner/work.js,
// the Civ map's hammers, never changed here) and, from before those began, `hours:<event id>` records
// Claude imported once. Shifts booked ahead are the planner's `hours:upcoming` list. A shift counts
// unless its title clearly says it's something else; `hours-count:<event id>` overrides that. Pay is an
// hourly rate plus holiday pay on top, paid monthly for the hours up to a cut-off day (`money:pay`);
// each payslip Claude reads is a `payslip:<YYYY-MM>` record. Pure.

import { addDays, dayOfMonth, daysInMonth, weekday, weekStart } from './dates.js';

export const UPCOMING_ID = 'hours:upcoming';
export const PAY_ID = 'money:pay';
export const countId = (eventId) => `hours-count:${eventId}`;
export const payslipId = (period) => `payslip:${period}`;
export const DEFAULT_PAY = Object.freeze({ rate: null, holidayPct: 12.07, cutoff: 23 });

const PERIOD = /^\d{4}-\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const cal = (doc) => doc?.calendar ?? {};
const num = (v) => (Number.isFinite(v) ? v : null);
const round2 = (n) => Math.round(n * 100) / 100;

// Untitled, or some spelling of Signify ("Signifi", "Singify"…), or plainly a shift.
export function isShiftTitle(title) {
  const s = String(title ?? '').trim();
  if (!s) return true;
  return /^s[iy]n?g?n?i?f/i.test(s) || /^(shift|work)\b/i.test(s);
}

export function paySettings(doc) {
  const r = cal(doc)[PAY_ID];
  const rate = num(r?.rate);
  const holidayPct = num(r?.holidayPct) ?? DEFAULT_PAY.holidayPct;
  const cutoff = Number.isInteger(r?.cutoff) && r.cutoff >= 1 && r.cutoff <= 31 ? r.cutoff : DEFAULT_PAY.cutoff;
  return { rate: rate != null && rate > 0 ? rate : null, holidayPct, cutoff };
}

export const nextMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};
export const prevMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
};

// The month whose payslip pays a shift on `day`: up to and including the cut-off, that month's.
export function payPeriodOf(day, cutoff = DEFAULT_PAY.cutoff) {
  return dayOfMonth(day) <= cutoff ? day.slice(0, 7) : nextMonth(day.slice(0, 7));
}

// Pay lands on the month's last weekday.
export function paydayOf(period) {
  let d = `${period}-${String(daysInMonth(`${period}-01`)).padStart(2, '0')}`;
  while (weekday(d) > 5) d = addDays(d, -1);
  return d;
}

// Every shift known, one per calendar event: { id, eventId, day, start, end, minutes, title, counted, source }.
export function shifts(doc) {
  const byEvent = new Map();
  const add = (eventId, r, source) => {
    if (!eventId || !DAY.test(r?.day ?? '') || !(r.minutes > 0)) return;
    if (byEvent.has(eventId) && byEvent.get(eventId).source === 'work') return;
    byEvent.set(eventId, { eventId, day: r.day, start: r.start ?? null, end: r.end ?? null, minutes: r.minutes, title: String(r.title ?? ''), source });
  };
  for (const r of Object.values(cal(doc))) {
    if (r?.status !== 'active') continue;
    const id = String(r.id ?? '');
    if (id.startsWith('work:')) add(id.slice(5), r, 'work');
  }
  for (const r of Object.values(cal(doc))) {
    if (r?.status !== 'active') continue;
    const id = String(r.id ?? '');
    if (id.startsWith('hours:') && id !== UPCOMING_ID) add(id.slice(6), r, 'hours');
  }
  const up = cal(doc)[UPCOMING_ID];
  if (up?.status === 'active' && Array.isArray(up.list)) {
    for (const r of up.list) if (!byEvent.has(r?.eventId)) add(r?.eventId, r, 'upcoming');
  }
  return [...byEvent.values()].map((s) => {
    const o = cal(doc)[countId(s.eventId)];
    const counted = o?.status === 'active' && typeof o.count === 'boolean' ? o.count : isShiftTitle(s.title);
    return { ...s, id: s.eventId, counted };
  }).sort((a, b) => (a.start ?? a.day).localeCompare(b.start ?? b.day));
}

export function payslips(doc) {
  return Object.values(cal(doc))
    .filter((r) => r?.status === 'active' && String(r.id).startsWith('payslip:') && PERIOD.test(r.period ?? ''))
    .map((r) => ({
      period: r.period, paid: r.paid ?? null, from: DAY.test(r.from ?? '') ? r.from : null, to: DAY.test(r.to ?? '') ? r.to : null, hours: num(r.hours) ?? 0, holiday: num(r.holiday) ?? 0,
      gross: num(r.gross) ?? 0, tax: num(r.tax) ?? 0, ni: num(r.ni) ?? 0, net: num(r.net) ?? 0,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

// What reaches his account per £ earned: everything, unless the latest payslip took tax or NI (then
// that payslip's share). Older taxed months don't count: tax taken in error gets refunded.
export function netRatio(slips) {
  const last = slips.at(-1);
  if (!last || !(last.tax > 0 || last.ni > 0) || !(last.gross > 0)) return 1;
  return last.net / last.gross;
}

export const grossFor = (hours, pay) => (pay.rate == null ? null : round2(hours * pay.rate * (1 + pay.holidayPct / 100)));

const hoursIn = (list, test) => round2(list.filter(test).reduce((t, s) => t + s.minutes, 0) / 60);
const cutDay = (m, cutoff) => `${m}-${String(Math.min(cutoff, daysInMonth(`${m}-01`))).padStart(2, '0')}`;

// The days of work a period's payslip pays: the day after last month's cut-off to this month's.
export const periodWindow = (m, cutoff) => ({ from: addDays(cutDay(prevMonth(m), cutoff), 1), to: cutDay(m, cutoff) });

// The days a payslip actually paid: the ones written on it when they differ from the rule (cut-offs
// have moved about), otherwise its period's window.
const slipWindow = (slip, cutoff) => {
  const w = periodWindow(slip.period, cutoff);
  return { from: slip.from ?? w.from, to: slip.to ?? w.to };
};

// Everything Hours shows, as of `today`. Shifts after the last payslip's last day are unpaid; each
// goes to the period of its day under the cut-off rule.
export function hoursSummary(doc, today) {
  const pay = paySettings(doc);
  const all = shifts(doc);
  const counted = all.filter((s) => s.counted);
  const slips = payslips(doc);
  const ratio = netRatio(slips);
  const windows = slips.map((s) => slipWindow(s, pay.cutoff));
  const paidTo = windows.reduce((m, w) => (m == null || w.to > m ? w.to : m), null);
  const unpaid = counted.filter((s) => paidTo == null || s.day > paidTo);
  const periodOf = (day) => payPeriodOf(day, pay.cutoff);

  const period = periodOf(today);
  const periodHours = hoursIn(unpaid, (s) => periodOf(s.day) === period && s.day <= today);

  // The next pay not yet on a payslip: everything booked in it, done or still to come.
  const next = paidTo == null ? period : [period, periodOf(addDays(paidTo, 1))].sort()[0];
  const nextHours = hoursIn(unpaid, (s) => periodOf(s.day) === next);
  const nextGross = grossFor(nextHours, pay);
  const expected = { period: next, hours: nextHours, gross: nextGross, net: nextGross == null ? null : round2(nextGross * ratio), payday: paydayOf(next) };

  const thisWeek = weekStart(today);
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const start = addDays(thisWeek, -7 * i);
    const end = addDays(start, 6);
    weeks.push({ start, hours: hoursIn(counted, (s) => s.day >= start && s.day <= end && s.day <= today) });
  }
  const full = weeks.slice(-9, -1);
  const weeklyAverage = round2(full.reduce((t, w) => t + w.hours, 0) / full.length);

  const withCalendar = slips.map((s, i) => {
    const w = windows[i];
    const calendarHours = hoursIn(counted, (x) => x.day >= w.from && x.day <= w.to);
    return { ...s, from: w.from, to: w.to, calendarHours, diff: round2(s.hours - calendarHours) };
  });
  const notCounted = all.filter((s) => !s.counted).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 20);
  const upcoming = counted.filter((s) => s.day > today || s.source === 'upcoming').slice(0, 30);

  return { pay, ratio, paidTo, period, periodHours, expected, weeks, weeklyAverage, slips: withCalendar, notCounted, upcoming };
}

// Expected take-home in each month from `from` to `to` (inclusive, YYYY-MM): unpaid hours already done
// or booked, plus the weekly average for the period's days not yet booked. { month: { net, booked, guessed } }.
export function payForecast(doc, today, from, to) {
  const s = hoursSummary(doc, today);
  const out = {};
  if (s.pay.rate == null) return out;
  const unpaid = shifts(doc).filter((x) => x.counted && (s.paidTo == null || x.day > s.paidTo));
  const lastBooked = unpaid.reduce((m, x) => (x.day > m ? x.day : m), today);
  for (let m = from; m <= to; m = nextMonth(m)) {
    const w = periodWindow(m, s.pay.cutoff);
    if (s.paidTo != null && w.to <= s.paidTo) continue;
    const booked = hoursIn(unpaid, (x) => payPeriodOf(x.day, s.pay.cutoff) === m);
    const guessFrom = [w.from, addDays(lastBooked, 1), addDays(today, 1), s.paidTo ? addDays(s.paidTo, 1) : w.from].sort().at(-1);
    const guessDays = guessFrom <= w.to ? (Date.parse(w.to) - Date.parse(guessFrom)) / 86400000 + 1 : 0;
    const guessed = round2((guessDays / 7) * s.weeklyAverage);
    const gross = grossFor(booked + guessed, s.pay);
    out[m] = { net: round2(gross * s.ratio), booked, guessed };
  }
  return out;
}

// 1st, 2nd, 3rd, 23rd, 11th…
export function ordinal(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] ?? 'th'}`;
}
