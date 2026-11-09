// Money's tile and big view (js/money.js, js/hours.js). The tile: what he's made or lost since the day
// he counts from, and the next pay. The big view, phone first: in and out each month (what came in
// beside what went out, by group; tap a month for its categories), every category since that day
// (total or per month; tap one for its places), Hours (weeks, what's booked; payslips folded away),
// Salzburg against the UK, and settings. Claude fills the ledger from his statements; here he looks,
// and sets the start date and which Work events count.

import { h } from './dom.js';
import { svg, tip } from './svg.js';
import { bigSection } from './big.js';
import { shortDate, shortWeekday, addDays, daysInMonth } from '../dates.js';
import { moneySummary, compare, gbp, startDay, START_ID, categoryLabel, inOut, wherePlaces, isCovered, UNNAMED, ONE_OFF_CATS } from '../money.js';
import { hoursSummary, countId, ordinal } from '../hours.js';

const signed = (p) => `${p > 0 ? '+' : ''}${gbp(p)}`;
const sinceText = (day) => `${Number(day.slice(8, 10))} ${monthName(day.slice(0, 7))}`;

// Eight colour groups (the chart's categorical slots, in fixed order); the ledger keeps finer categories.
export const GROUPS = [
  { id: 'food', label: 'Food', cats: ['groceries', 'eating-out'] },
  { id: 'going-out', label: 'Going out', cats: ['going-out'] },
  { id: 'local-travel', label: 'Getting about', cats: ['local-travel', 'car'] },
  { id: 'trips', label: 'Trips', cats: ['trips'] },
  { id: 'gym-health', label: 'Gym & health', cats: ['gym-health'] },
  { id: 'phone-subs', label: 'Phone & subs', cats: ['phone-subs'] },
  { id: 'shopping', label: 'Shopping & gifts', cats: ['shopping', 'gifts'] },
  { id: 'other', label: 'Other', cats: ['rent-bills', 'other'] },
];
export const groupOf = (cat) => GROUPS.findIndex((g) => g.cats.includes(cat));
export function byGroup(spend) {
  const out = GROUPS.map(() => 0);
  for (const [c, v] of Object.entries(spend ?? {})) { const i = groupOf(c); out[i < 0 ? GROUPS.length - 1 : i] += v; }
  return out;
}
// Series colours are classes (styles/tools.css), in the groups' fixed order. Green is kept for pay, so
// Getting about and Phone & subs take their own colours rather than the palette's two greens.
const GROUP_COLOURS = ['viz-1', 'viz-2', 'mo-c-travel', 'viz-4', 'viz-5', 'mo-c-phone', 'viz-7', 'viz-8'];
const viz = (i) => GROUP_COLOURS[Math.min(Math.max(i, 0), 7)];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (m, year = false) => `${MONTHS[Number(m.slice(5, 7)) - 1]}${year ? ` ${m.slice(0, 4)}` : ''}`;
const dayText = (d) => `${shortWeekday(d)} ${shortDate(d)}`;
const pounds2 = (n) => (n == null ? '—' : `£${n.toFixed(2)}`);
const monthEnd = (m) => addDays(`${m}-01`, daysInMonth(`${m}-01`) - 1);
// About four gridlines: a round step (1, 2 or 5 × a power of ten) for the range.
export function niceStep(range) {
  const raw = Math.max(range, 1) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
}
const stat = (value, label) => h('div', { class: 'mo-stat' }, h('span', { class: 'mo-n' }, value), h('span', { class: 'mo-t' }, label));
// Small print, folded away until he wants it.
const fold = (label, ...body) => h('details', { class: 'mo-fold' }, h('summary', {}, label), ...body);

function payLine(pay) {
  return pay.net != null ? h('li', {}, 'Next pay ', h('b', {}, `~${pounds2(pay.net)}`), `, ${dayText(pay.payday)} · ${pay.hours} h`) : h('li', {}, `${pay.hours} h towards the next pay`);
}

export function renderMoneyTile(ctx) {
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const money = ctx.money?.() ?? null;
  const s = moneySummary(money, doc, today);
  const io = money ? inOut(money) : null;
  if (!io) {
    return h('div', { class: 'tile-stack mo-tile' },
      h('ul', { class: 'mo-facts' }, payLine(s.nextPay)),
      h('p', { class: 'muted' }, 'Give Claude your bank statements to see what comes in and goes out.'));
  }
  return h('div', { class: 'tile-stack mo-tile' },
    h('p', { class: 'tile-hero' }, h('span', { class: 'tile-num' }, signed(io.totals.net)), h('span', { class: 'tile-cap' }, `since ${sinceText(io.from)}`)),
    h('ul', { class: 'mo-facts' }, payLine(s.nextPay)));
}

// Spending by category over the days of `month` that fall in the stretch he counts.
function monthSpend(money, io, month) {
  const from = [`${month}-01`, io.from].sort().at(-1);
  const to = [monthEnd(month), io.to].sort()[0];
  return wherePlaces(money, from, to);
}

// Each month: what came in (pay, then one-off money on top) beside what went out (stacked by group),
// with the net under it. Tapping a month opens its categories below.
function inOutChart(ctx, money, io) {
  const W = 640, H = 240, L = 56, R = 8, T = 10, B = 50, GAP = 2;
  const outs = io.rows.map((r) => byGroup(Object.fromEntries(monthSpend(money, io, r.month).map((e) => [e.cat, e.total]))));
  const hi = Math.max(1, ...io.rows.map((r) => Math.max(r.in, r.spend)));
  const slot = (W - L - R) / io.rows.length;
  const bw = Math.min(26, slot / 2 - 5);
  const X = (i) => L + (i + 0.5) * slot;
  const Y = (v) => T + (1 - v / hi) * (H - T - B);
  const step = niceStep(hi);
  const grid = [];
  for (let v = 0; v <= hi; v += step) grid.push(svg('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'mo-grid' }), svg('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'mo-axis' }, gbp(v)));
  const rect = (x, from, to, cls, label) => (to > from ? svg('rect', { x, y: Y(to), width: bw, height: Math.max(0, Y(from) - Y(to) - (from ? GAP : 0)), rx: 3, class: cls }, tip(label)) : null);
  const bars = io.rows.map((r, i) => {
    const name = monthName(r.month, true);
    let base = 0;
    const out = outs[i].map((v, gi) => {
      if (v <= 0) return null;
      const seg = rect(X(i) + 2, base, base + v, viz(gi), `${name}: ${GROUPS[gi].label} ${gbp(v)}`);
      base += v;
      return seg;
    });
    const on = ctx.ui.moneyMonth === r.month;
    return svg('g', { class: `mo-bar${on ? ' on' : ''}`, role: 'button', tabindex: 0, 'aria-label': `${name}: in ${gbp(r.in)}, out ${gbp(r.spend)}`,
      onclick: () => { ctx.ui.moneyMonth = on ? null : r.month; ctx.render(); },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.ui.moneyMonth = on ? null : r.month; ctx.render(); } } },
      svg('rect', { x: X(i) - slot / 2 + 2, y: T, width: slot - 4, height: H - T - B + 44, rx: 6, class: 'mo-hit' }),
      rect(X(i) - bw - 2, 0, r.regular, 'mo-in', `${name}: pay ${gbp(r.regular)}`),
      rect(X(i) - bw - 2, r.regular, r.in, 'mo-in-once', `${name}: one-off ${gbp(r.oneOff)}`),
      out,
      svg('text', { x: X(i), y: H - B + 18, 'text-anchor': 'middle', class: 'mo-axis' }, monthName(r.month)),
      svg('text', { x: X(i), y: H - B + 38, 'text-anchor': 'middle', class: r.net < 0 ? 'mo-net neg' : 'mo-net' }, signed(r.net)));
  });
  return svg('svg', { class: 'mo-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `In and out each month since ${sinceText(io.from)}: net ${signed(io.totals.net)}` }, grid, bars);
}

// Categories, biggest first; tap one to see the places it went to. `per` divides every amount (months).
function catBreakdown(entries, per = 1) {
  const amt = (p) => gbp(Math.round(p / per));
  return h('div', { class: 'mo-cats' }, entries.map((e) => h('details', { class: 'mo-cat' },
    h('summary', {}, h('span', {}, h('i', { class: `mo-swatch ${viz(groupOf(e.cat))}` }), categoryLabel(e.cat)), h('span', { class: 'n' }, amt(e.total))),
    h('ul', { class: 'mo-places' }, e.places.map((p) => h('li', { class: p.name === UNNAMED ? 'muted' : '' }, h('span', {}, p.name), h('span', { class: 'n' }, amt(p.amount))))))));
}

// One-off money between two days, by what it was (its note), biggest first.
function oneOffItems(money, from, to) {
  const by = {};
  for (const i of money.income) {
    if (i.day < from || i.day > to || !(i.oneOff || i.kind === 'refund')) continue;
    const k = i.note || (i.kind === 'refund' ? 'Refund' : 'One-off');
    by[k] = (by[k] ?? 0) + i.amount;
  }
  return Object.entries(by).sort((a, b) => b[1] - a[1]);
}
const itemRows = (items) => items.map(([note, v]) => h('tr', { class: 'mo-sub-row' }, h('td', {}, note), h('td', { class: 'n' }, gbp(v))));

function monthDetail(money, io, month) {
  const r = io.rows.find((x) => x.month === month);
  if (!r) return null;
  return h('div', { class: 'mo-month' },
    h('h4', {}, monthName(month, true)),
    catBreakdown(monthSpend(money, io, month)),
    h('table', { class: 'mo-table' }, h('tbody', {},
      h('tr', { class: 'mo-total' }, h('td', {}, 'Spent'), h('td', { class: 'n' }, gbp(r.spend))),
      h('tr', {}, h('td', {}, 'Came in'), h('td', { class: 'n' }, gbp(r.in))),
      r.regular ? h('tr', { class: 'mo-sub-row' }, h('td', {}, h('i', { class: 'mo-swatch mo-in' }), 'Pay (and interest)'), h('td', { class: 'n' }, gbp(r.regular))) : null,
      itemRows(oneOffItems(money, [`${month}-01`, io.from].sort().at(-1), [monthEnd(month), io.to].sort()[0])),
      h('tr', { class: 'mo-total' }, h('td', {}, 'Net'), h('td', { class: 'n' }, signed(r.net))))));
}

function inOutBlock(ctx, money, io) {
  const items = oneOffItems(money, io.from, io.to);
  const shown = GROUPS.map((_, i) => i).filter((gi) => io.rows.some((r) => byGroup(Object.fromEntries(monthSpend(money, io, r.month).map((e) => [e.cat, e.total])))[gi] > 0));
  const month = ctx.ui.moneyMonth && io.rows.some((r) => r.month === ctx.ui.moneyMonth) ? ctx.ui.moneyMonth : null;
  return h('div', {},
    h('ul', { class: 'mo-legend' },
      h('li', {}, h('i', { class: 'mo-in' }), 'Pay'), h('li', {}, h('i', { class: 'mo-in-once' }), 'One-off money in'),
      shown.map((gi) => h('li', {}, h('i', { class: viz(gi) }), GROUPS[gi].label))),
    inOutChart(ctx, money, io),
    month ? monthDetail(money, io, month) : h('p', { class: 'muted mo-note' }, 'Left bar in, right bar out. Tap a month to see where it went.'),
    items.length ? fold(`One-off money in since ${sinceText(io.from)}: ${gbp(io.totals.oneOff)}`,
      h('table', { class: 'mo-table' }, h('tbody', {}, itemRows(items)))) : null,
    fold('How this is worked out',
      h('p', { class: 'muted mo-note' },
        `From ${shortDate(io.from)} to ${shortDate(io.to)} (the last day on your statements): in ${gbp(io.totals.in)}, out ${gbp(io.totals.spend)}. `,
        'Pay is Signify (and a little interest); one-off money is anything else that came in. ',
        'Money moved between your own accounts, into shares or into your Lifetime ISA isn\'t counted either way.')));
}

function categoryBlock(ctx, money, io) {
  let days = 0;
  for (let d = io.from; d <= io.to; d = addDays(d, 1)) if (isCovered(money, d)) days++;
  const months = days / (365.25 / 12);
  const perMonth = !!ctx.ui.moneyPerMonth && months >= 1;
  const set = (on) => { ctx.ui.moneyPerMonth = on; ctx.render(); };
  const all = wherePlaces(money, io.from, io.to);
  const once = all.filter((e) => ONE_OFF_CATS.includes(e.cat));
  return h('div', {},
    months >= 1 ? h('div', { class: 'mo-seg', role: 'group', 'aria-label': 'Show totals or a month' },
      h('button', { type: 'button', class: 'dl-btn', 'aria-pressed': String(!perMonth), onclick: () => set(false) }, 'Total'),
      h('button', { type: 'button', class: 'dl-btn', 'aria-pressed': String(perMonth), onclick: () => set(true) }, 'Per month')) : null,
    catBreakdown(all.filter((e) => !ONE_OFF_CATS.includes(e.cat)), perMonth ? months : 1),
    once.length ? h('h4', { class: 'mo-sub' }, perMonth ? 'One-off purchases (not averaged)' : 'One-off purchases') : null,
    once.length ? catBreakdown(once) : null,
    h('p', { class: 'muted mo-note' }, perMonth
      ? `An average month over the ${months.toFixed(1)} months from ${shortDate(io.from)} to ${shortDate(io.to)}. Tap a category to see where it went.`
      : 'Tap a category to see where it went.'));
}

function compareBlock(ctx, money, doc) {
  const pick = ctx.ui.moneyCompare ?? { eu: true };
  const c = compare(money, doc, pick);
  const ga = byGroup(c.a.perWeek), gb = byGroup(c.b.perWeek);
  const hi = Math.max(1, ...ga, ...gb);
  const row = (i) => h('div', { class: 'mo-cmp-row' }, h('span', { class: 'mo-cmp-label' }, GROUPS[i].label),
    h('span', { class: 'mo-cmp-bars' },
      h('i', { class: 'mo-cmp-a', style: `width:${(ga[i] / hi) * 100}%`, title: `${c.a.label} ${gbp(ga[i])} a week` }),
      h('i', { class: 'mo-cmp-b', style: `width:${(gb[i] / hi) * 100}%`, title: `${c.b.label} ${gbp(gb[i])} a week` })),
    h('span', { class: 'mo-cmp-n' }, `${gbp(ga[i])} · ${gbp(gb[i])}`));
  const shown = GROUPS.map((_, i) => i).filter((i) => ga[i] || gb[i]);
  const range = (k) => {
    const v = ctx.ui.moneyRange?.[k] ?? {};
    const set = (which, val) => { ctx.ui.moneyRange = { ...(ctx.ui.moneyRange ?? {}), [k]: { ...v, [which]: val } }; };
    return h('span', { class: 'mo-range' },
      h('input', { type: 'date', value: v.from ?? '', 'aria-label': `Stretch ${k.toUpperCase()} from`, onchange: (e) => set('from', e.target.value) }),
      '–',
      h('input', { type: 'date', value: v.to ?? '', 'aria-label': `Stretch ${k.toUpperCase()} to`, onchange: (e) => set('to', e.target.value) }));
  };
  const go = () => {
    const r = ctx.ui.moneyRange ?? {};
    if (r.a?.from && r.a?.to && r.b?.from && r.b?.to) { ctx.ui.moneyCompare = { a: r.a, b: r.b }; ctx.render(); }
  };
  return h('div', { class: 'mo-cmp' },
    h('div', { class: 'mo-seg', role: 'group', 'aria-label': 'What to compare' },
      h('button', { type: 'button', class: 'dl-btn', 'aria-pressed': String(!!pick.eu), onclick: () => { ctx.ui.moneyCompare = { eu: true }; ctx.render(); } }, 'Salzburg vs UK'),
      h('button', { type: 'button', class: 'dl-btn', 'aria-pressed': String(!pick.eu), onclick: () => { ctx.ui.moneyCompare = { pick: true, a: ctx.ui.moneyRange?.a ?? {}, b: ctx.ui.moneyRange?.b ?? {} }; ctx.render(); } }, 'Two stretches')),
    pick.eu ? null : h('div', { class: 'mo-ranges' }, h('label', {}, 'A ', range('a')), h('label', {}, 'B ', range('b')), h('button', { type: 'button', class: 'dl-btn', onclick: go }, 'Compare')),
    pick.pick && !(pick.a?.from && pick.b?.from) ? h('p', { class: 'muted' }, 'Pick two stretches, then Compare.')
      : pick.eu && !(c.a.days && c.b.days) ? h('p', { class: 'muted' }, c.a.days ? 'Every day on your statements so far was in Salzburg.' : 'None of the days on your statements are marked as EU days yet. Mark them in EU days and this compares the two.')
      : h('div', {},
      h('p', { class: 'mo-cmp-head' }, h('span', {}, h('i', { class: 'mo-cmp-a' }), `${c.a.label}: ${gbp(c.a.total)} a week (${c.a.days} days)`), h('span', {}, h('i', { class: 'mo-cmp-b' }), `${c.b.label}: ${gbp(c.b.total)} a week (${c.b.days} days)`)),
      shown.length ? shown.map(row) : h('p', { class: 'muted' }, 'No spending on statements in those days yet.')));
}

function hoursBlock(ctx, doc, today) {
  const s = hoursSummary(doc, today);
  const hi = Math.max(1, ...s.weeks.map((w) => w.hours));
  const W = 640, H = 120, L = 8, R = 8, T = 16, B = 22;
  const bw = (W - L - R) / s.weeks.length - 6;
  const X = (i) => L + ((i + 0.5) / s.weeks.length) * (W - L - R);
  const Y = (v) => T + (1 - v / hi) * (H - T - B);
  const weekChart = svg('svg', { class: 'mo-chart mo-weeks', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Hours each week, the last 12 weeks; average ${s.weeklyAverage} h` },
    s.weeks.map((w, i) => svg('g', {},
      w.hours ? svg('rect', { x: X(i) - bw / 2, y: Y(w.hours), width: bw, height: Math.max(0, H - B - Y(w.hours)), rx: 3, class: 'mo-hbar' }, tip(`Week of ${shortDate(w.start)}: ${w.hours} h`)) : null,
      w.hours ? svg('text', { x: X(i), y: Y(w.hours) - 4, 'text-anchor': 'middle', class: 'mo-axis' }, String(Math.round(w.hours))) : null,
      i % 2 === 1 || s.weeks.length <= 6 ? svg('text', { x: X(i), y: H - 6, 'text-anchor': 'middle', class: 'mo-axis' }, shortDate(w.start)) : null)));
  const setCount = (eventId, on) => ctx.store.putCalendar(countId(eventId), { status: 'active', count: on }, 'me');
  return h('div', { class: 'mo-hours' },
    h('div', { class: 'mo-stats' },
      stat(`${s.periodHours} h`, `this pay period (to the ${ordinal(s.pay.cutoff)})`),
      stat(`${s.weeklyAverage} h`, 'a week, last 8 weeks')),
    weekChart,
    s.upcoming.length ? h('div', {}, h('h4', {}, 'Booked ahead'), h('ul', { class: 'mo-list' }, s.upcoming.slice(0, 10).map((x) => h('li', {}, `${dayText(x.day)} · ${Math.round(x.minutes / 6) / 10} h`)))) : null,
    s.notCounted.length ? h('div', {}, h('h4', {}, 'Not counted as shifts'),
      h('ul', { class: 'mo-list' }, s.notCounted.map((x) => h('li', {}, `${dayText(x.day)} · "${x.title}" `,
        h('button', { type: 'button', class: 'link', onclick: () => setCount(x.eventId, true) }, 'Count it'))))) : null,
    s.slips.length ? fold('Payslips against your calendar',
      h('table', { class: 'mo-table mo-slips' }, h('thead', {}, h('tr', {}, h('th', {}, 'Paid'), h('th', { class: 'n' }, 'Hours'), h('th', { class: 'n' }, 'Calendar'), h('th', { class: 'n' }, 'Net'))),
        h('tbody', {}, [...s.slips].reverse().map((p) => h('tr', {},
          h('td', {}, monthName(p.period, true), h('small', {}, `${shortDate(p.from)} – ${shortDate(p.to)}`)),
          h('td', { class: 'n' }, String(p.hours)),
          h('td', { class: `n${Math.abs(p.diff) >= 1 ? ' mo-diff' : ''}` }, String(p.calendarHours), p.diff ? h('small', {}, `${p.diff > 0 ? '+' : ''}${p.diff} h paid`) : h('small', {}, 'matches')),
          h('td', { class: 'n' }, pounds2(p.net))))))) : null,
    fold('How shifts are counted', h('p', { class: 'muted mo-note' }, 'Every event in your Work calendar is a shift unless its title says otherwise.')));
}

export function renderMoneyBig(ctx) {
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const money = ctx.money?.() ?? null;
  const s = moneySummary(money, doc, today);
  const io = money ? inOut(money) : null;
  const start = startDay(doc);
  const setStart = (e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) ctx.store.putCalendar(START_ID, { status: 'active', day: e.target.value }, 'me'); };
  return h('div', { class: 'big money' },
    h('div', { class: 'mo-stats' },
      stat(s.nextPay.net != null ? `~${pounds2(s.nextPay.net)}` : `${s.nextPay.hours} h`, `next pay, ${dayText(s.nextPay.payday)}`),
      io ? stat(signed(io.totals.net), `net since ${sinceText(io.from)}`) : null),
    !io ? h('p', { class: 'mo-empty' }, 'No statements yet. In a chat on the laptop, give Claude your bank statements and say "add these to Money".') : null,
    io ? bigSection(`In and out since ${sinceText(io.from)}`, inOutBlock(ctx, money, io)) : null,
    io ? bigSection(`By category since ${sinceText(io.from)}`, categoryBlock(ctx, money, io)) : null,
    bigSection('Hours', hoursBlock(ctx, doc, today)),
    money ? bigSection('Compare', compareBlock(ctx, money, doc)) : null,
    bigSection('Settings',
      h('label', { class: 'mo-start' }, 'London start date ', h('input', { type: 'date', value: start, onchange: setStart })),
      money?.plan?.length ? h('ul', { class: 'mo-list' }, money.plan.map((p) => h('li', {}, `${monthName(p.month, true)} · ${p.label} · ${p.kind === 'income' ? '+' : '−'}${gbp(p.amount)}${p.cat ? ` (${categoryLabel(p.cat)})` : ''}`))) : null));
}
