// The forecast to the London start (js/forecast.js), inside Money's big view. Always open: the answer
// up front (the pot at the end, its lowest point, the hours a week to break even and to keep a month's
// money), a chart of the pot month by month with a band from 6 to 12 hours a week (Salzburg's months
// shaded), and the pay it already knows (the next unpaid period's hours, done or booked). Folded under
// that: presets that swap every setting at once, and the sliders: hours a week after this pay period,
// spending by category at home and in Salzburg, flights, one-offs.
// Dragging repaints the answer and the chart only; letting go saves his settings (one synced record).

import { h } from './dom.js';
import { svg, tip } from './svg.js';
import { gbp, categoryLabel } from '../money.js';
import { hoursSummary } from '../hours.js';
import { shortDate, addDays, daysInMonth } from '../dates.js';
import { FORECAST_ID, SAFE_PENCE, BAND, WEEKS_A_MONTH, forecastSettings, forecastPresets, matchingPreset, statementAverage, statementSplit, runForecast, hoursFor, monthlySpend, monthlyAway } from '../forecast.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (m, year = false) => `${MONTHS[Number(m.slice(5, 7)) - 1]}${year ? ` ${m.slice(0, 4)}` : ''}`;
const hrs = (n) => (n == null ? '—' : `${(Math.round(n * 10) / 10).toFixed(1)} h`);
const stat = (value, label, cls = '') => h('div', { class: `mo-stat ${cls}` }, h('span', { class: 'mo-n' }, value), h('span', { class: 'mo-t' }, label));
function niceStep(range) {
  const raw = Math.max(range, 1) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
}

function chart(f, lo, hi) {
  const W = 640, H = 210, L = 58, R = 10, T = 12, B = 26;
  const all = [...f.rows, ...lo.rows, ...hi.rows].map((r) => r.pot);
  let min = Math.min(0, f.from.total, ...all), max = Math.max(SAFE_PENCE, f.from.total, ...all);
  if (max === min) max = min + 10000;
  const n = f.rows.length;
  const X = (i) => L + (n <= 1 ? 0.5 : i / n) * (W - L - R);
  const Y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const step = niceStep(max - min);
  const grid = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) grid.push(svg('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'mo-grid' }), svg('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'mo-axis' }, gbp(v)));
  // Point 0 is the balance the forecast starts from; point i+1 is the end of month i.
  const pts = (run) => [[X(0), Y(f.from.total)], ...run.rows.map((r, i) => [X(i + 1), Y(r.pot)])];
  const line = (run) => pts(run).map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
  const band = [...pts(hi), ...pts(lo).reverse()].map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ') + 'Z';
  // Month i runs from point i to point i+1; shade it by the share of its days in Salzburg.
  const away = f.rows.map((r, i) => (r.awayDays ? svg('rect', { x: X(i), y: T, width: X(i + 1) - X(i), height: H - T - B, class: 'fc-away',
    'fill-opacity': (0.1 + 0.14 * r.awayDays / daysInMonth(`${r.month}-01`)).toFixed(3) }, tip(`${monthName(r.month)}: ${r.awayDays} day${r.awayDays === 1 ? '' : 's'} in Salzburg`)) : null));
  return svg('svg', { class: 'mo-chart fc-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Your money each month to ${monthName(f.rows.at(-1).month)}: ${gbp(f.end)} at the end` },
    away,
    grid,
    svg('path', { d: band, class: 'fc-band' }, tip(`${BAND[0]}–${BAND[1]} h a week`)),
    svg('line', { x1: L, x2: W - R, y1: Y(0), y2: Y(0), class: 'fc-zero' }),
    svg('line', { x1: L, x2: W - R, y1: Y(SAFE_PENCE), y2: Y(SAFE_PENCE), class: 'fc-safe' }),
    svg('text', { x: W - R, y: Y(SAFE_PENCE) - 5, 'text-anchor': 'end', class: 'mo-axis fc-safe-label' }, 'a month in hand'),
    svg('path', { d: line(f), class: 'fc-line' }),
    pts(f).map(([x, y], i) => svg('circle', { cx: x, cy: y, r: 4.5, class: (i ? f.rows[i - 1].pot : f.from.total) < 0 ? 'fc-dot neg' : 'fc-dot' },
      tip(i ? `End of ${monthName(f.rows[i - 1].month, true)}: ${gbp(f.rows[i - 1].pot)}` : `${shortDate(f.from.day)}: ${gbp(f.from.total)}`))),
    pts(f).map(([x], i) => svg('text', { x, y: H - 6, 'text-anchor': 'middle', class: 'mo-axis' }, i ? monthName(f.rows[i - 1].month) : shortDate(f.from.day))));
}

// A labelled slider: `fmt` shows the value, `onInput` repaints, `onChange` saves.
function slider({ label, value, min, max, step, fmt, note, onInput, onChange }) {
  const val = h('span', { class: 'fc-val' }, fmt(value));
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label,
    oninput: (e) => { const v = Number(e.target.value); val.textContent = fmt(v); onInput(v); },
    onchange: (e) => onChange(Number(e.target.value)) });
  return h('div', { class: 'fc-row' }, h('span', { class: 'fc-label' }, label, note ? h('small', {}, note) : null), input, val);
}

export function forecastBlock(ctx, money, doc, today) {
  const s = structuredClone(forecastSettings(money, doc));
  const avg = statementAverage(money);
  const split = statementSplit(money, doc);
  const presets = forecastPresets(money, doc, today);
  const hs = hoursSummary(doc, today);
  const from = addDays(hs.expected.to, 1);
  const pay = (hours) => Math.round((hours * WEEKS_A_MONTH * (hs.pay.rate ?? 0) * (1 + hs.pay.holidayPct / 100)) * (hs.ratio ?? 1) * 100);
  const run = (hours) => runForecast({ money, doc, today, settings: s, hours });
  const first = run(s.hours);
  if (!first) return h('p', { class: 'muted' }, 'Needs a balance from a statement to start from.');
  const record = (x) => ({
    status: 'active', hours: x.hours, spend: x.spend, away: x.away, flights: x.flights,
    oneOffs: x.oneOffs.map((o) => ({ id: o.id, on: o.on, amount: o.amount, month: o.month })),
  });
  const save = () => { ctx.store.putCalendar(FORECAST_ID, record(s), 'me'); markPreset(); };
  // A whole preset replaces his settings; the agreed one is no record at all.
  const choose = (p) => {
    // His record lies over the agreed figures, so a category the preset leaves out is saved as £0.
    const zero = (o) => Object.fromEntries(Object.keys(o).map((c) => [c, 0]));
    const base = presets[0].settings;
    const x = { ...p.settings, spend: { ...zero(base.spend), ...p.settings.spend }, away: { ...zero(base.away), ...p.settings.away } };
    ctx.store.putCalendar(FORECAST_ID, p.id === 'agreed' ? { status: 'archived' } : record(x), 'me');
    ctx.render();
  };
  const presetNote = h('small', { class: 'muted fc-preset-note' });
  const presetName = () => matchingPreset(s, presets)?.label ?? 'your own mix';
  const presetBtns = presets.map((p) => h('button', { type: 'button', class: 'dl-btn', 'aria-pressed': 'false', title: p.note ?? '', onclick: () => choose(p) }, p.label));
  const markPreset = () => {
    const on = matchingPreset(s, presets);
    presetBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(presets[i] === on)));
    presetNote.textContent = on ? (on.note ?? '') : 'Your own mix: tap a preset to start again from it.';
    for (const el of foldNotes) el.textContent = ` · ${presetName()}, ${hrs(s.hours)} a week`;
  };
  const foldNotes = [];
  markPreset();

  // The pay it already knows: what's done or booked in the next unpaid period, before the slider.
  const ex = hs.expected;
  const inForecast = first.rows.some((r) => r.month === ex.period);
  const known = ex.net != null && inForecast
    ? h('p', { class: 'fc-known' }, h('b', {}, `${monthName(ex.period)} pay ~${gbp(Math.round(ex.net * 100))}`),
      ` on ${shortDate(ex.payday)}, from the ${ex.hours} h done or booked ${shortDate(ex.from)} – ${shortDate(ex.to)}. After that, the hours slider.`)
    : null;
  const answer = h('div', {});
  const totalEl = h('span', { class: 'fc-total' });
  const awayTotalEl = h('span', { class: 'fc-total' });
  // Pinned while he scrolls the sliders, so the result stays in view as he drags.
  const pin = h('div', { class: 'fc-pin', 'aria-live': 'polite' });
  const paint = () => {
    const f = run(s.hours);
    const lo = run(BAND[0]), hi = run(BAND[1]);
    const even = hoursFor({ money, doc, today, settings: s, target: f.from.total });
    const safe = hoursFor({ money, doc, today, settings: s, target: SAFE_PENCE });
    const lastMonth = f.rows.at(-1).month;
    answer.replaceChildren(
      h('div', { class: 'mo-stats fc-stats' },
        stat(gbp(f.end), `at the end of ${monthName(lastMonth)}`, f.end < 0 ? 'neg' : f.end < SAFE_PENCE ? 'warn' : ''),
        stat(gbp(f.lowest.pot), `lowest, end of ${monthName(f.lowest.month)}`, f.lowest.pot < 0 ? 'neg' : ''),
        stat(hrs(safe), `a week to keep ${gbp(SAFE_PENCE)}`),
        stat(hrs(even), `a week to break even (${gbp(f.from.total)})`)),
      chart(f, lo, hi),
      known,
      h('p', { class: 'muted mo-note' }, `From ${gbp(f.from.total)} on ${shortDate(f.from.day)} (your last statements). Line: ${hrs(s.hours)} a week from ${shortDate(from)}; band: ${BAND[0]}–${BAND[1]} h.${f.rows.some((r) => r.awayDays) ? ' Shaded: months in Salzburg (your EU days).' : ''}`));
    totalEl.textContent = `${gbp(monthlySpend(s))} a month`;
    awayTotalEl.textContent = `${gbp(monthlyAway(s))} a month`;
    pin.replaceChildren(
      h('span', {}, h('b', { class: f.end < 0 ? 'neg' : f.end < SAFE_PENCE ? 'warn' : '' }, gbp(f.end)), ` end of ${monthName(lastMonth)}`),
      h('span', {}, `lowest ${gbp(f.lowest.pot)}`),
      h('span', {}, `even at ${hrs(even)}`));
  };
  paint();

  const live = (fn) => (v) => { fn(v); paint(); };
  const keep = (fn) => (v) => { fn(v); save(); };
  const cats = Object.keys(s.spend).sort((a, b) => s.spend[b] - s.spend[a]);
  const awayCats = [...new Set([...Object.keys(s.away), ...cats])].sort((a, b) => (s.away[b] ?? 0) - (s.away[a] ?? 0));
  const maxFor = (c, v = s.spend[c], a = avg[c]) => Math.max(10000, Math.ceil((Math.max(v ?? 0, a ?? 0) * 2.5) / 5000) * 5000);
  const months = first.rows.map((r) => r.month);

  const oneOffRow = (o) => h('div', { class: 'fc-once' },
    h('label', { class: 'fc-check' },
      h('input', { type: 'checkbox', checked: o.on, onchange: (e) => { o.on = e.target.checked; paint(); save(); } }),
      h('span', {}, o.label)),
    h('span', { class: 'fc-amt' }, o.amount >= 0 ? '+£' : '−£',
      h('input', { type: 'number', inputmode: 'numeric', min: 0, step: 10, value: Math.abs(o.amount) / 100, 'aria-label': `${o.label} amount`,
        onchange: (e) => { const v = Math.round(Math.abs(Number(e.target.value) || 0) * 100); o.amount = o.amount < 0 ? -v : v; paint(); save(); } })),
    h('select', { 'aria-label': `${o.label} month`, onchange: (e) => { o.month = e.target.value; paint(); save(); } },
      [...new Set([...months, o.month])].sort().map((m) => h('option', { value: m, selected: m === o.month }, monthName(m)))));

  const foldNote = h('small', { class: 'muted fc-fold-note' });
  foldNotes.push(foldNote);
  markPreset();
  return h('div', { class: 'fc' },
    answer,
    h('details', { class: 'mo-fold fc-fold', open: !!ctx.ui.forecastOpen, ontoggle: (e) => { ctx.ui.forecastOpen = e.target.open; } },
      h('summary', {}, 'Change the assumptions', foldNote),
      h('div', { class: 'fc-presets' },
        h('div', { class: 'mo-seg', role: 'group', 'aria-label': 'Forecast presets' }, presetBtns),
        presetNote),
      h('div', { class: 'fc-controls' },
      pin,
      h('h4', { class: 'mo-sub' }, 'Work'),
      slider({ label: 'Hours a week', note: `from ${shortDate(from)}`, value: s.hours, min: 0, max: 20, step: 0.5,
        fmt: (v) => `${hrs(v)} · ~${gbp(pay(v))}/mo`, onInput: live((v) => { s.hours = v; }), onChange: keep((v) => { s.hours = v; }) }),
      h('h4', { class: 'mo-sub fc-head' }, 'Spending a month', totalEl),
      cats.map((c) => slider({ label: categoryLabel(c), note: avg[c] != null ? `avg ${gbp(avg[c])}` : null, value: s.spend[c] / 100, min: 0, max: maxFor(c) / 100, step: 5,
        fmt: (v) => gbp(v * 100), onInput: live((v) => { s.spend[c] = v * 100; }), onChange: keep((v) => { s.spend[c] = v * 100; }) })),
      h('details', { class: 'fc-fold fc-away-fold' },
        h('summary', { class: 'fc-head' }, h('span', {}, 'In Salzburg'), awayTotalEl),
        h('small', { class: 'muted' }, `On your EU days instead of the amounts above.${split.awayDays ? ` Your average from ${split.awayDays} days there is beside each.` : ''}`),
        awayCats.map((c) => slider({ label: categoryLabel(c), note: split.awayDays && split.away[c] != null ? `avg ${gbp(split.away[c])}` : null,
          value: (s.away[c] ?? 0) / 100, min: 0, max: maxFor(c, s.away[c], split.away[c]) / 100, step: 5,
          fmt: (v) => gbp(v * 100), onInput: live((v) => { s.away[c] = v * 100; }), onChange: keep((v) => { s.away[c] = v * 100; }) }))),
      h('h4', { class: 'mo-sub' }, 'Flights'),
      slider({ label: 'How many', value: s.flights.count, min: 0, max: 12, step: 1, fmt: (v) => `${v}`,
        onInput: live((v) => { s.flights.count = v; }), onChange: keep((v) => { s.flights.count = v; }) }),
      slider({ label: 'Each', value: s.flights.price / 100, min: 20, max: 250, step: 5, fmt: (v) => gbp(v * 100),
        onInput: live((v) => { s.flights.price = v * 100; }), onChange: keep((v) => { s.flights.price = v * 100; }) }),
      s.oneOffs.length ? h('h4', { class: 'mo-sub' }, 'One-offs') : null,
      s.oneOffs.map(oneOffRow))));
}
