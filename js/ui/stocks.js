// Stocks' tile and big view (docs/superpowers/specs/2026-11-12-stocks-design.md). The tile is the
// one-screen glance: value, today's verdict line, Claude's looks, a colour dot per theme, what's
// coming and at most one thing worth a look. The big view groups holdings by theme with five lens
// dots each; a row opens its card (thesis, lenses, Claude's notes). Built from js/stocks.js's view.

import { h } from './dom.js';
import { bigSection } from './big.js';
import { LOGOS } from './sources.js';
import { stocksView, LENSES } from '../stocks.js';
import { shortWeekday, shortDate, daysBetween } from '../dates.js';

const LENS_NAME = { trend: 'Trend', price: 'Price', health: 'Health', expectations: 'Expectations', risk: 'Risk' };
const pounds = (x) => (x == null ? '—' : `£${Math.round(x).toLocaleString('en-GB')}`);
const signedPounds = (x) => (x == null ? '—' : `${x < 0 ? '−' : '+'}${pounds(Math.abs(x))}`);
const dayText = (day, today) => (day === today ? 'today' : daysBetween(day, today) === 1 ? 'yesterday' : `${shortWeekday(day)} ${shortDate(day)}`);

// What the tile shows, as words: pure, so it can be tested without a page.
export function tileParts(v) {
  return {
    value: pounds(v.value),
    move: v.dayMovePct == null ? null : `${v.dayMovePct > 0 ? '+' : v.dayMovePct < 0 ? '−' : ''}${Math.abs(v.dayMovePct)}% today`,
    moveDir: v.dayMovePct == null ? 0 : Math.sign(v.dayMovePct),
    allTime: v.allTime == null ? null : `${signedPounds(v.allTime)} all time`,
    verdict: v.verdictLine,
    quiet: v.verdictLine === 'Nothing that changes your view today.',
    looked: v.lookedToday ? `Looked at ${v.lookedToday} today` : null,
    chips: v.themes.filter((t) => t.rows.some((r) => !r.also && r.tier && r.tier !== 'pie')).map((t) => ({ id: t.id, name: t.name, dot: t.dot, reason: t.reason })),
    coming: v.coming,
    look: v.look,
    note: v.positionsNote,
  };
}

function verdictLine(row) {
  const greens = row.dots.filter((d) => d === 'green').length;
  if (row.verdict === 'agrees') return row.tier === 'watched' ? `Numbers agree with you — ${greens} of 5` : 'Trend and risk look fine';
  if (row.verdict === 'disagrees') return 'Numbers disagree with you';
  if (row.verdict === 'mixed') return 'Mixed — some numbers agree, some don’t';
  return row.tier === 'pie' ? 'Part of your Pie' : 'No numbers yet';
}

// What a holding's card shows, as words.
export function cardParts(row, today) {
  const c = row.card;
  const n = c.notes;
  return {
    name: c.name,
    thesis: c.thesis?.line ?? null,
    watch: c.thesis?.watch ?? [],
    verdictLine: verdictLine(row),
    add: c.add ? 'A moment to add? Your thesis holds and the price has dipped.' : null,
    lenses: LENSES.map((k) => ({ key: k, name: LENS_NAME[k], dot: c.lenses[k].dot, reason: c.lenses[k].reason })),
    small: [c.rsi != null ? `RSI ${c.rsi}` : null, c.insider ? `Insider buying: ${c.insider.text}` : null].filter(Boolean).join(' · ') || null,
    notes: {
      lastLooked: n.lastLooked ? `Last looked ${dayText(n.lastLooked, today)}` : 'Not looked at yet',
      thinking: n.thinking?.text ?? null,
      next: n.next ? `Next: ${n.next.due ? `${shortWeekday(n.next.due)} ${shortDate(n.next.due)} — ` : ''}${n.next.text}` : null,
      earlier: n.earlier.map((x) => ({ day: dayText(x.at.slice(0, 10), today), text: x.text })),
    },
    events: c.events.map((e) => `${shortWeekday(e.day)} ${shortDate(e.day)} · ${e.text}`),
  };
}

export function usageLine(u) {
  if (!u.runs) return 'This week: no runs yet';
  return `This week: ${u.runs} run${u.runs === 1 ? '' : 's'}, ${u.searches} search${u.searches === 1 ? '' : 'es'}${u.tokens != null ? `, ~${Math.round(u.tokens / 1000)}k tokens` : ''}${u.pct != null ? `, ${u.pct}% of your weekly limit` : ''}`;
}

// The page.

function claudeMark(title) {
  const el = h('span', { class: 'src st-claude', title, role: 'img', 'aria-label': title });
  el.innerHTML = LOGOS.claude; // a fixed string from js/ui/sources.js, never data
  return el;
}
const dot = (d, title) => h('i', { class: `st-dot st-${d}`, 'data-dot': d, title: title || null, 'aria-label': title || d });
const viewOf = (ctx) => {
  const s = ctx.stocks?.() ?? {};
  return stocksView(s.market ?? null, s.desk ?? null, ctx.store.today());
};
const runTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');

export function renderStocksTile(ctx) {
  const v = viewOf(ctx);
  const p = tileParts(v);
  if (v.value == null && !v.themes.length) {
    return h('div', { class: 'tile-stack st-tile' }, h('p', { class: 'muted' }, 'Waiting for your Trading 212 key in the planner (see README → Stocks).'));
  }
  return h('div', { class: 'tile-stack st-tile' },
    h('p', { class: 'tile-hero' }, h('span', { class: 'tile-num' }, p.value),
      h('span', { class: 'tile-cap' }, p.move ? h('span', { class: p.moveDir < 0 ? 'st-down' : 'st-up' }, p.move) : null, p.allTime ? h('span', { class: 'st-all' }, p.allTime) : null)),
    p.note ? h('p', { class: 'st-note' }, p.note) : null,
    h('p', { class: `st-verdict${p.quiet ? ' quiet' : ''}` }, h('span', { class: 'st-tick', 'aria-hidden': 'true' }, p.quiet ? '✓' : '!'), p.verdict),
    p.looked ? h('p', { class: 'st-looked' }, claudeMark(`Claude's morning run, ${runTime(v.lastRun)}`), p.looked) : null,
    p.chips.length ? h('div', { class: 'st-chips' }, p.chips.map((c) => h('span', { class: 'st-chip', title: c.reason || null }, dot(c.dot, c.reason), c.name))) : null,
    p.coming.length ? h('ul', { class: 'st-coming' }, p.coming.map((c) => h('li', {}, c.text))) : null,
    p.look ? h('p', { class: 'st-look' }, p.look.text) : null);
}

function card(row, today) {
  const c = cardParts(row, today);
  return h('div', { class: 'st-card' },
    c.thesis ? h('blockquote', { class: 'st-thesis' }, c.thesis) : null,
    h('p', { class: `st-vline st-v-${row.verdict ?? 'none'}` }, c.verdictLine),
    c.add ? h('p', { class: 'st-look' }, c.add) : null,
    h('ul', { class: 'st-lenses' }, c.lenses.map((l) => h('li', {}, h('span', { class: 'st-lname' }, l.name), dot(l.dot), h('span', { class: 'st-reason' }, l.reason || '—')))),
    c.small ? h('p', { class: 'st-small' }, c.small) : null,
    h('div', { class: 'st-notes' },
      h('p', { class: 'st-looked' }, claudeMark('Claude’s notes'), c.notes.lastLooked),
      c.notes.thinking ? h('p', {}, c.notes.thinking) : null,
      c.notes.next ? h('p', { class: 'st-next' }, c.notes.next) : null,
      c.notes.earlier.length ? h('details', { class: 'st-earlier' }, h('summary', {}, `Earlier notes (${c.notes.earlier.length})`),
        h('ul', {}, c.notes.earlier.map((e) => h('li', {}, h('span', { class: 'st-when' }, e.day), ' ', e.text)))) : null),
    c.events.length ? h('ul', { class: 'st-coming' }, c.events.map((e) => h('li', {}, e))) : null);
}

function rowEl(ctx, row, today, rerender) {
  const open = ctx.ui.stocksOpen === row.ticker;
  const toggle = () => { ctx.ui.stocksOpen = open ? null : row.ticker; rerender(); };
  return h('li', { class: `st-row${open ? ' open' : ''}` },
    h('button', { class: 'st-rowbtn', type: 'button', 'aria-expanded': open ? 'true' : 'false', onclick: toggle },
      h('span', { class: 'st-tk' }, row.ticker),
      row.tier === 'pie' ? null : h('span', { class: 'st-dots' }, row.dots.map((d, i) => dot(d, `${LENS_NAME[LENSES[i]]}: ${row.card.lenses[LENSES[i]].reason || d}`))),
      h('span', { class: 'st-val' }, pounds(row.valueGbp)),
      row.hint ? h('span', { class: `st-hint${row.verdict === 'disagrees' ? ' bad' : ''}` }, row.hint) : null),
    open ? card(row, today) : null);
}

export function renderStocksBig(ctx) {
  const root = h('div', { class: 'big stocks' });
  const draw = () => {
    const today = ctx.store.today();
    const v = viewOf(ctx);
    const p = tileParts(v);
    const groups = v.themes.map((t) => {
      const collapsed = t.rows.every((r) => r.tier === 'pie' || r.tier === 'market');
      const list = h('ul', { class: 'st-rows' }, t.rows.map((r) => rowEl(ctx, r, today, draw)));
      const head = h('span', { class: 'st-theme' }, dot(t.dot), t.name);
      return collapsed && !t.rows.some((r) => r.ticker === ctx.ui.stocksOpen)
        ? h('details', { class: 'st-group' }, h('summary', {}, head), list)
        : h('section', { class: 'st-group' }, h('h4', {}, head), t.reason ? h('p', { class: 'st-treason' }, claudeMark('Claude’s current read'), t.reason) : null, list);
    });
    root.replaceChildren(...[
      h('div', { class: 'mo-stats' },
        h('div', { class: 'mo-stat' }, h('span', { class: 'mo-n' }, p.value), h('span', { class: 'mo-t' }, p.move ?? 'today —')),
        h('div', { class: 'mo-stat' }, h('span', { class: 'mo-n' }, p.allTime?.replace(' all time', '') ?? '—'), h('span', { class: 'mo-t' }, 'all time'))),
      p.note ? h('p', { class: 'st-note' }, p.note) : null,
      h('p', { class: `st-verdict${p.quiet ? ' quiet' : ''}` }, h('span', { class: 'st-tick', 'aria-hidden': 'true' }, p.quiet ? '✓' : '!'), p.verdict),
      v.payday ? h('p', { class: 'st-look' }, v.payday.text) : null,
      bigSection('Holdings by theme', h('p', { class: 'st-legend' }, 'Dots: trend · price · health · expectations · risk. Tap a holding for why.'), groups,
        v.unsorted.length ? h('section', { class: 'st-group' }, h('h4', {}, 'Not sorted yet'), h('ul', { class: 'st-rows' }, v.unsorted.map((r) => rowEl(ctx, r, today, draw)))) : null),
      v.shortlist.length ? bigSection('Shortlist', h('ul', { class: 'st-short' }, v.shortlist.map((s) => h('li', { class: s.status === 'dropped' ? 'dropped' : null },
        h('span', { class: 'st-tk' }, s.ticker), h('span', { class: 'st-sname' }, `${s.name} · ${s.theme} · since ${shortDate(s.day)}`),
        s.sincePct != null ? h('span', { class: s.sincePct < 0 ? 'st-down' : 'st-up' }, `${s.sincePct > 0 ? '+' : ''}${s.sincePct}%`) : null,
        h('p', { class: 'st-why' }, s.status === 'dropped' ? `Dropped: ${s.why ?? ''}` : s.reason),
        s.notes.thinking ? h('p', { class: 'st-why' }, claudeMark('Claude’s current read'), s.notes.thinking.text) : null)))) : null,
      h('p', { class: 'st-usage' }, usageLine(v.usage), v.lastRun ? ` · last run ${dayText(v.lastRun.slice(0, 10), today)} ${runTime(v.lastRun)}` : ''),
    ].filter(Boolean)); // replaceChildren would print a null as "null"
  };
  draw();
  return root;
}
