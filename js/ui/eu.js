// The EU days tile (js/eu.js): days left today big, a bar of the 90 (used, then planned), and the
// few lines George plans visits to Maya by. Its big view is the calendar: 180 days back to a year
// ahead, where he clicks a day, or presses and drags across a stretch, to mark or unmark it. A drag
// follows the first day pressed (an empty one fills the stretch, a marked one clears it) and is only
// saved when he lets go, so the page redrawing can't cut it short. On a phone a horizontal drag along
// a week works the same; holding a day then tapping another does a longer stretch.

import { h } from './dom.js';
import { addDays, shortWeekday, shortDate } from '../dates.js';
import { EU_LIMIT, euDays, euCount, euSummary, longestStay, dayRange, setEuDays, windowStart } from '../eu.js';

const AHEAD = 365;
const HOLD_MS = 450;
const dayText = (d) => `${shortWeekday(d)} ${shortDate(d)}`;
const span = (v) => (v.start === v.end ? dayText(v.start) : `${dayText(v.start)} – ${dayText(v.end)}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function facts(s) {
  return [
    h('li', {}, h('b', {}, String(s.used)), ` of ${EU_LIMIT} used in the last 180 days`),
    s.here ? h('li', {}, `In now until `, h('b', {}, dayText(s.here.end))) : null,
    s.next ? h('li', {}, 'Next visit ', h('b', {}, span(s.next)), `, ${plural(s.next.days, 'day')}`) : null,
    s.planned ? (s.over
      ? h('li', { class: 'eu-warn' }, 'Plans go over 90 on ', h('b', {}, dayText(s.over)))
      : h('li', {}, 'Plans fit ✓')) : null,
    s.back ? h('li', {}, 'Days start coming back ', h('b', {}, dayText(s.back))) : null,
  ];
}

function bar(s) {
  const pct = (n) => `${Math.min(100, (n / EU_LIMIT) * 100)}%`;
  return h('div', { class: 'eu-bar', role: 'img', 'aria-label': `${s.used} of ${EU_LIMIT} used, ${s.planned} planned` },
    h('i', { class: 'eu-bar-used', style: `width:${pct(s.used)}` }),
    h('i', { class: 'eu-bar-plan', style: `width:${pct(Math.min(s.planned, s.left))}` }));
}

export function renderEuTile(ctx) {
  const doc = ctx.store.doc();
  if (!euDays(doc).size) {
    return h('div', { class: 'tile-stack' },
      h('p', { class: 'muted' }, `90 days in any 180. Mark the days you've been in the EU and the visits you're planning.`),
      ctx.openEu ? h('button', { class: 'dl-btn', type: 'button', onclick: ctx.openEu }, 'Open the calendar') : null);
  }
  const s = euSummary(doc, ctx.store.today(), AHEAD);
  return h('div', { class: 'tile-stack eu-tile' },
    h('p', { class: 'tile-hero' }, h('span', { class: 'tile-num' }, String(s.left)), h('span', { class: 'tile-cap' }, 'days left today')),
    bar(s),
    h('ul', { class: 'eu-facts' }, facts(s)));
}

// What the line above the calendar says about one day.
function dayLine(days, day, today) {
  const n = euCount(days, day);
  const head = [h('b', {}, dayText(day)), `: ${n} of ${EU_LIMIT} in the 180 days to here`];
  if (day <= today) return head;
  return [...head, ' · a stay starting here could last ', h('b', {}, String(longestStay(days, day))), ' days'];
}

function months(today) {
  const out = [];
  let m = `${windowStart(today).slice(0, 7)}-01`;
  const last = addDays(today, AHEAD).slice(0, 7);
  while (m.slice(0, 7) <= last) {
    out.push(m);
    const [y, mo] = m.split('-').map(Number);
    m = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
  }
  return out;
}

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function renderEuBig(ctx) {
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const days = euDays(doc);
  const s = euSummary(doc, today, AHEAD);
  const first = windowStart(today);
  ctx.ui.euFocus ??= today;
  const line = h('p', { class: 'eu-line', 'aria-live': 'polite' }, dayLine(days, ctx.ui.euFocus, today));

  const grid = h('div', { class: 'eu-months' }, months(today).map((m) => {
    const [y, mo] = m.split('-').map(Number);
    const lead = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7;
    const cells = [];
    for (let d = m; d.slice(0, 7) === m.slice(0, 7); d = addDays(d, 1)) {
      if (d < first) { cells.push(h('span', { class: 'eu-d eu-before' }, String(Number(d.slice(8))))); continue; }
      const on = days.has(d);
      const cls = ['eu-d',
        on ? (d > today ? 'eu-plan' : 'eu-in') : '',
        on && d > today && euCount(days, d) > EU_LIMIT ? 'eu-over' : '',
        d > today && days.has(addDays(d, -180)) ? 'eu-back' : '',
        d === today ? 'eu-today' : ''].filter(Boolean).join(' ');
      cells.push(h('button', { class: cls, type: 'button', 'data-day': d, 'aria-pressed': on ? 'true' : 'false', 'aria-label': `${dayText(d)}${on ? ', marked' : ''}` }, String(Number(d.slice(8)))));
    }
    return h('div', { class: 'eu-month', 'data-month': m.slice(0, 7) },
      h('h4', {}, MONTH.format(new Date(Date.UTC(y, mo - 1, 1)))),
      h('div', { class: 'eu-grid' },
        ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((c) => h('span', { class: 'eu-dow' }, c)),
        Array.from({ length: lead }, () => h('span', {})),
        cells));
  }));
  wireDrag(ctx, grid, days, line, today);
  // Just opened (the sheet isn't showing yet): start at last month rather than 180 days back.
  if (!document.getElementById('widget-sheet')?.open) {
    // By id, as the page may redraw the sheet once more first.
    const all = months(today);
    const anchor = all[Math.max(0, all.indexOf(`${today.slice(0, 7)}-01`) - 1)].slice(0, 7);
    setTimeout(() => document.querySelector(`#widget-sheet [data-month="${anchor}"]`)?.scrollIntoView({ block: 'start' }));
  }

  return h('div', { class: 'big eu' },
    h('div', { class: 'eu-summary' },
      stat(s.used, 'used, last 180 days'), stat(s.left, 'left today'), stat(s.planned, 'planned ahead'), stat(s.stay, 'longest stay if you went tomorrow')),
    s.over ? h('p', { class: 'eu-warn' }, `Your plans go over 90 on ${dayText(s.over)}. Red days are the ones over.`) : null,
    h('div', { class: 'eu-legend' },
      h('span', { class: 'eu-key eu-in' }, 'In the EU'), h('span', { class: 'eu-key eu-plan' }, 'Planned'),
      h('span', { class: 'eu-key eu-over' }, 'Over 90 that day'), h('span', { class: 'eu-key eu-back' }, 'A day comes back')),
    h('p', { class: 'muted eu-how' }, 'Click a day, or press and drag across a stretch. On a phone, hold a day then tap the last one. Mark the days you fly in and out too: they count.'),
    line,
    grid);
}

const stat = (n, label) => h('div', { class: 'eu-stat' }, h('span', { class: 'eu-n' }, String(n)), h('span', { class: 'eu-t' }, label));

// Press, drag, let go: the stretch is shown as it grows and saved once.
function wireDrag(ctx, grid, days, line, today) {
  let drag = null;
  let hold = null;
  const dayAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('[data-day]')?.dataset.day ?? null;
  const show = (from, to) => {
    const lo = from <= to ? from : to;
    const hi = from <= to ? to : from;
    for (const el of grid.querySelectorAll('[data-day]')) {
      const d = el.dataset.day;
      el.classList.toggle('eu-pick', d >= lo && d <= hi);
      el.classList.toggle('eu-unpick', !drag.on && d >= lo && d <= hi);
    }
  };
  const focus = (d) => { ctx.ui.euFocus = d; line.replaceChildren(...dayLine(days, d, today)); };
  const save = (from, to, on) => {
    drag = null;
    ctx.ui.euHold = null;
    setEuDays(ctx.store, dayRange(from, to), on);
  };

  grid.addEventListener('pointerover', (e) => {
    const d = e.target.closest?.('[data-day]')?.dataset.day;
    if (d && e.pointerType === 'mouse' && !drag) focus(d);
  });
  grid.addEventListener('pointerdown', (e) => {
    const d = e.target.closest?.('[data-day]')?.dataset.day;
    if (!d || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // A held day waiting for its end: this tap finishes the stretch.
    if (ctx.ui.euHold) { e.preventDefault(); save(ctx.ui.euHold.from, d, ctx.ui.euHold.on); return; }
    drag = { from: d, to: d, on: !days.has(d), id: e.pointerId };
    focus(d);
    if (e.pointerType === 'mouse') { e.preventDefault(); grid.setPointerCapture(e.pointerId); }
    show(d, d);
    if (e.pointerType !== 'mouse') {
      clearTimeout(hold);
      hold = setTimeout(() => {
        if (!drag || drag.to !== drag.from) return;
        ctx.ui.euHold = { from: drag.from, on: drag.on };
        drag = null;
        line.replaceChildren(h('b', {}, dayText(ctx.ui.euHold.from)), ctx.ui.euHold.on ? ': now tap the last day to mark' : ': now tap the last day to clear');
      }, HOLD_MS);
    }
  });
  grid.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = dayAt(e.clientX, e.clientY);
    if (d && d !== drag.to) { drag.to = d; clearTimeout(hold); show(drag.from, d); focus(d); }
  });
  grid.addEventListener('pointerup', (e) => {
    clearTimeout(hold);
    if (!drag || e.pointerId !== drag.id) return;
    save(drag.from, drag.to, drag.on);
  });
  grid.addEventListener('pointercancel', () => {
    clearTimeout(hold);
    if (!drag) return;
    drag = null;
    for (const el of grid.querySelectorAll('.eu-pick')) el.classList.remove('eu-pick', 'eu-unpick');
  });
  // Keyboard: Enter or Space on a day marks or unmarks it.
  grid.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const d = e.target.closest?.('[data-day]')?.dataset.day;
    if (d) setEuDays(ctx.store, [d], !days.has(d));
  });
  if (ctx.ui.euHold) {
    const el = grid.querySelector(`[data-day="${ctx.ui.euHold.from}"]`);
    el?.classList.add('eu-pick');
    if (!ctx.ui.euHold.on) el?.classList.add('eu-unpick');
  }
}
