// Money's tile and big view (js/money.js, js/hours.js). The tile: what he'll have at the London start,
// the next pay, this month so far. The big view, phone first: the pot to the start date, spending by
// month (tap a month for its breakdown), Salzburg against the UK, Hours (his shifts, payslips against
// the calendar, what's booked, what isn't counted), and the plan. Claude fills the ledger from his
// statements; here he looks, and sets the start date and which Work events count.

import { h } from './dom.js';
import { svg, tip } from './svg.js';
import { bigSection } from './big.js';
import { shortDate, shortWeekday } from '../dates.js';
import { moneySummary, monthActuals, compare, gbp, startDay, START_ID, CATEGORIES, categoryLabel, lastCovered, averageSpend } from '../money.js';
import { hoursSummary, countId, ordinal } from '../hours.js';

// Eight colour groups (the chart's categorical slots, in fixed order); the ledger keeps finer categories.
export const GROUPS = [
  { id: 'food', label: 'Food', cats: ['groceries', 'eating-out'] },
  { id: 'going-out', label: 'Going out', cats: ['going-out'] },
  { id: 'local-travel', label: 'Getting about', cats: ['local-travel'] },
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
// Series colours are classes (styles/tools.css .viz-1 … .viz-8), in the groups' fixed order.
const viz = (i) => `viz-${Math.min(Math.max(i, 0), 7) + 1}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (m, year = false) => `${MONTHS[Number(m.slice(5, 7)) - 1]}${year ? ` ${m.slice(0, 4)}` : ''}`;
const dayText = (d) => `${shortWeekday(d)} ${shortDate(d)}`;
const pounds2 = (n) => (n == null ? '—' : `£${n.toFixed(2)}`);
// About four gridlines: a round step (1, 2 or 5 × a power of ten) for the range.
export function niceStep(range) {
  const raw = Math.max(range, 1) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
}
const stat = (value, label) => h('div', { class: 'mo-stat' }, h('span', { class: 'mo-n' }, value), h('span', { class: 'mo-t' }, label));
const legend = (ids = GROUPS.map((_, i) => i)) => h('ul', { class: 'mo-legend' }, ids.map((i) => h('li', {}, h('i', { class: viz(i) }), GROUPS[i].label)));

export function renderMoneyTile(ctx) {
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const money = ctx.money?.() ?? null;
  const s = moneySummary(money, doc, today);
  const pay = s.nextPay;
  const payLine = pay.net != null ? h('li', {}, 'Next pay ', h('b', {}, `~${pounds2(pay.net)}`), `, ${dayText(pay.payday)} · ${pay.hours} h`) : h('li', {}, `${pay.hours} h towards the next pay`);
  if (!money) {
    return h('div', { class: 'tile-stack mo-tile' },
      h('ul', { class: 'mo-facts' }, payLine),
      h('p', { class: 'muted' }, 'Give Claude your bank statements to see your spending and what you\'ll have in May.'));
  }
  return h('div', { class: 'tile-stack mo-tile' },
    h('p', { class: 'tile-hero' }, h('span', { class: 'tile-num' }, gbp(s.atStart)), h('span', { class: 'tile-cap' }, `at the start, ${monthName(s.start.slice(0, 7), true)}`)),
    h('ul', { class: 'mo-facts' }, payLine,
      s.spent != null ? h('li', {}, 'This month ', h('b', {}, gbp(s.spent)), s.planned ? ` of ~${gbp(s.planned)}` : '')
        : s.planned ? h('li', {}, 'This month ', h('b', {}, `~${gbp(s.planned)}`), ' planned') : null));
}

// The pot, month by month: solid where the statements are, dashed where it's planned.
function potChart(rows, start) {
  const pts = rows.filter((r) => r.pot != null);
  if (pts.length < 2) return null;
  const W = 640, H = 200, L = 56, R = 12, T = 14, B = 26;
  const vals = pts.map((r) => r.pot);
  let lo = Math.min(0, ...vals), hi = Math.max(...vals);
  if (hi === lo) hi = lo + 10000;
  const X = (i) => L + (i / (pts.length - 1)) * (W - L - R);
  const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const step = niceStep(hi - lo);
  const grid = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    grid.push(svg('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'mo-grid' }), svg('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'mo-axis' }, gbp(v)));
  }
  const firstPlan = pts.findIndex((r) => !r.actual);
  const path = (from, to) => pts.slice(from, to).map((r, i) => `${i ? 'L' : 'M'}${X(from + i)},${Y(r.pot)}`).join(' ');
  const solidEnd = firstPlan === -1 ? pts.length : Math.max(1, firstPlan);
  return svg('svg', { class: 'mo-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Your money each month, reaching ${gbp(pts.at(-1).pot)} by ${start}` },
    grid,
    svg('path', { d: path(0, solidEnd), class: 'mo-pot' }),
    firstPlan === -1 ? null : svg('path', { d: path(Math.max(0, solidEnd - 1), pts.length), class: 'mo-pot mo-pot-plan' }),
    pts.map((r, i) => svg('circle', { cx: X(i), cy: Y(r.pot), r: 5, class: r.actual ? 'mo-dot' : 'mo-dot mo-dot-plan' }, tip(`${monthName(r.month, true)}: ${gbp(r.pot)}${r.actual ? '' : ' (planned)'}`))),
    pts.map((r, i) => (i === 0 || i === pts.length - 1 || pts.length <= 8 || i % 2 === 0
      ? svg('text', { x: X(i), y: H - 6, 'text-anchor': 'middle', class: 'mo-axis' }, monthName(r.month)) : null)));
}

// Spending by month, stacked by group. Planned months are hatched. Tapping one opens its breakdown.
function spendChart(ctx, rows) {
  if (!rows.length) return null;
  const W = 640, H = 200, L = 56, R = 8, T = 10, B = 26, GAP = 2;
  // Planned spending is drawn as its own hatched cap on top of what the statements show.
  const stacks = rows.map((r) => byGroup(r.spendByCat));
  const totals = rows.map((r) => r.spend);
  const hi = Math.max(1, ...totals);
  const bw = Math.min(40, (W - L - R) / rows.length - 6);
  const X = (i) => L + ((i + 0.5) / rows.length) * (W - L - R);
  const Y = (v) => T + (1 - v / hi) * (H - T - B);
  const step = niceStep(hi);
  const grid = [];
  for (let v = step; v <= hi; v += step) grid.push(svg('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'mo-grid' }), svg('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'mo-axis' }, gbp(v)));
  const bars = rows.map((r, i) => {
    let base = 0;
    const segs = [];
    stacks[i].forEach((v, gi) => {
      if (!v) return;
      const y0 = Y(base), y1 = Y(base + v);
      segs.push(svg('rect', { x: X(i) - bw / 2, y: y1, width: bw, height: Math.max(0, y0 - y1 - GAP), rx: 3, class: viz(gi) }, tip(`${GROUPS[gi].label} ${gbp(v)}`)));
      base += v;
    });
    if (r.plannedSpend) {
      const y0 = Y(base), y1 = Y(base + r.plannedSpend);
      segs.push(svg('rect', { x: X(i) - bw / 2, y: y1, width: bw, height: Math.max(0, y0 - y1 - GAP), rx: 3, class: 'mo-plan' }, tip(`Planned ${gbp(r.plannedSpend)}`)));
    }
    const on = ctx.ui.moneyMonth === r.month;
    return svg('g', { class: `mo-bar${on ? ' on' : ''}`, role: 'button', tabindex: 0, 'aria-label': `${monthName(r.month, true)}: ${gbp(r.spend)}`, onclick: () => { ctx.ui.moneyMonth = on ? null : r.month; ctx.render(); } },
      svg('rect', { x: X(i) - bw / 2 - 3, y: T, width: bw + 6, height: H - T - B + 4, class: 'mo-hit' }),
      segs,
      svg('text', { x: X(i), y: H - 6, 'text-anchor': 'middle', class: 'mo-axis' }, monthName(r.month)));
  });
  return svg('svg', { class: 'mo-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Spending each month by group' }, svg('defs', {},
    svg('pattern', { id: 'mo-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, svg('rect', { width: 6, height: 6, class: 'mo-hatch-bg' }), svg('rect', { width: 3, height: 6, class: 'mo-hatch-fg' }))), grid, bars);
}

function monthDetail(money, rows, month) {
  const row = rows.find((r) => r.month === month);
  if (!row) return null;
  const a = monthActuals(money, month);
  const cats = CATEGORIES.filter((c) => a.spend[c.id]).sort((x, y) => a.spend[y.id] - a.spend[x.id]);
  return h('div', { class: 'mo-month' },
    h('h4', {}, monthName(month, true), row.actual ? '' : ' (part planned)'),
    h('table', { class: 'mo-table' }, h('tbody', {},
      cats.map((c) => h('tr', {}, h('td', {}, h('i', { class: `mo-swatch ${viz(groupOf(c.id))}` }), c.label), h('td', { class: 'n' }, gbp(a.spend[c.id])))),
      row.plannedSpend ? h('tr', {}, h('td', {}, h('i', { class: 'mo-swatch mo-plan-swatch' }), 'Planned'), h('td', { class: 'n' }, gbp(row.plannedSpend))) : null,
      h('tr', { class: 'mo-total' }, h('td', {}, 'Spent'), h('td', { class: 'n' }, gbp(row.spend))),
      h('tr', {}, h('td', {}, 'Came in'), h('td', { class: 'n' }, gbp(row.income))),
      a.oneOff ? h('tr', { class: 'muted' }, h('td', {}, 'of which one-off'), h('td', { class: 'n' }, gbp(a.oneOff))) : null)));
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
      stat(s.expected.net != null ? `~${pounds2(s.expected.net)}` : `${s.expected.hours} h`, `next pay, ${dayText(s.expected.payday)}`),
      stat(`${s.weeklyAverage} h`, 'a week, last 8 weeks')),
    weekChart,
    s.upcoming.length ? h('div', {}, h('h4', {}, 'Booked ahead'), h('ul', { class: 'mo-list' }, s.upcoming.slice(0, 10).map((x) => h('li', {}, `${dayText(x.day)} · ${Math.round(x.minutes / 6) / 10} h`)))) : null,
    s.slips.length ? h('div', {}, h('h4', {}, 'Payslips against your calendar'),
      h('table', { class: 'mo-table mo-slips' }, h('thead', {}, h('tr', {}, h('th', {}, 'Paid'), h('th', { class: 'n' }, 'Hours'), h('th', { class: 'n' }, 'Calendar'), h('th', { class: 'n' }, 'Net'))),
        h('tbody', {}, [...s.slips].reverse().map((p) => h('tr', {},
          h('td', {}, monthName(p.period, true), h('small', {}, `${shortDate(p.from)} – ${shortDate(p.to)}`)),
          h('td', { class: 'n' }, String(p.hours)),
          h('td', { class: `n${Math.abs(p.diff) >= 1 ? ' mo-diff' : ''}` }, String(p.calendarHours), p.diff ? h('small', {}, `${p.diff > 0 ? '+' : ''}${p.diff} h paid`) : h('small', {}, 'matches')),
          h('td', { class: 'n' }, pounds2(p.net))))))) : null,
    s.notCounted.length ? h('div', {}, h('h4', {}, 'Not counted as shifts'),
      h('ul', { class: 'mo-list' }, s.notCounted.map((x) => h('li', {}, `${dayText(x.day)} · "${x.title}" `,
        h('button', { type: 'button', class: 'link', onclick: () => setCount(x.eventId, true) }, 'Count it'))))) : null,
    h('p', { class: 'muted mo-note' }, 'Every event in your Work calendar is a shift unless its title says otherwise.'));
}

export function renderMoneyBig(ctx) {
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const money = ctx.money?.() ?? null;
  const s = moneySummary(money, doc, today);
  const start = startDay(doc);
  const setStart = (e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) ctx.store.putCalendar(START_ID, { status: 'active', day: e.target.value }, 'me'); };
  const month = ctx.ui.moneyMonth ?? null;
  const avg = money ? averageSpend(money, today) : null;
  return h('div', { class: 'big money' },
    h('div', { class: 'mo-stats' },
      stat(gbp(s.atStart), `at the start, ${dayText(start)}`),
      stat(s.nextPay.net != null ? `~${pounds2(s.nextPay.net)}` : `${s.nextPay.hours} h`, `next pay, ${dayText(s.nextPay.payday)}`),
      money ? (s.spent != null ? stat(gbp(s.spent), `spent in ${monthName(today.slice(0, 7))}, ${s.seenDays} days on statements`) : stat(`~${gbp(s.planned)}`, `planned for ${monthName(today.slice(0, 7))}`)) : null),
    !money ? h('p', { class: 'mo-empty' }, 'No statements yet. In a chat on the laptop, give Claude your bank statements (PDFs) and say "add these to Money". Only daily totals per category are saved; the statements stay on your laptop.') : null,
    money ? bigSection('Your money to the start', potChart(s.rows, start) ?? h('p', { class: 'muted' }, 'Needs a balance from a statement to draw.'),
      h('p', { class: 'muted mo-note' }, `Solid is from your statements (up to ${shortDate(lastCovered(money))}); dashed is the plan: your pay from Hours, spending at your recent average${avg?.months ? ` (${gbp(avg.total)} a month)` : ''}.`)) : null,
    money ? bigSection('Spending by month', legend(), spendChart(ctx, s.rows), month ? monthDetail(money, s.rows, month) : h('p', { class: 'muted mo-note' }, 'Tap a month to see where it went.')) : null,
    money ? bigSection('Compare', compareBlock(ctx, money, doc)) : null,
    bigSection('Hours', hoursBlock(ctx, doc, today)),
    bigSection('The plan',
      h('label', { class: 'mo-start' }, 'London start date ', h('input', { type: 'date', value: start, onchange: setStart })),
      money?.plan?.length ? h('ul', { class: 'mo-list' }, money.plan.map((p) => h('li', {}, `${monthName(p.month, true)} · ${p.label} · ${p.kind === 'income' ? '+' : '−'}${gbp(p.amount)}${p.cat ? ` (${categoryLabel(p.cat)})` : ''}`)))
        : h('p', { class: 'muted' }, 'No planned costs yet. Tell Claude about a flight, a deposit or a birthday and it goes here.')));
}
