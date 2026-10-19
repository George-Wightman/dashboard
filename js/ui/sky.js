// Daylight's header: the sky for this moment (js/sky.js), the sun or moon on its arc with a dot for
// each of today's blocks, and the words over it (js/header.js) — greeting, progress, Claude's brief,
// time off and the planner's notes (each hidden with × for the rest of the day), any warning — plus
// the actions the classic header has: sync, ⚑, Arrange, ⚙ and "Update ready".

import { h } from './dom.js';
import { sunTimes, skyPhase, sunAt, blockDots, SKY_TOP } from '../sky.js';
import { syncLabel, progressText } from '../header.js';
import { todaySlots } from '../calendar.js';
import { todayRows } from '../schedule.js';
import { LOGOS } from './sources.js';
import { openFlagPanel } from './flags.js';
import { setArranging } from './widgets.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
};
const pct = (v) => `${(v * 100).toFixed(2)}%`;
const localKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function icon(paths, label = null) {
  const el = svg('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    ...paths.map((d) => svg('path', { d })));
  if (label) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', label); } else el.setAttribute('aria-hidden', 'true');
  return el;
}
const FLAG = ['M5 21V4', 'M5 4h11l-2 4 2 4H5'];
const GEAR = ['M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6', 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1'];
const CLOUD = ['M7 18h10a4 4 0 0 0 0-8a6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z'];

function bands() {
  return svg('svg', { class: 'dl-bands', viewBox: '0 0 1440 300', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    svg('rect', { width: 1440, height: 300, class: 'b3' }),
    svg('path', { class: 'b2', d: 'M0 0H1440V120C1200 96 980 140 720 114C460 88 240 134 0 108Z' }),
    svg('path', { class: 'b1', d: 'M0 0H1440V58C1180 42 960 80 720 60C470 40 230 74 0 54Z' }),
    svg('path', { class: 'horizon', d: 'M0 258C240 240 480 276 720 256C960 236 1200 270 1440 250V300H0Z' }),
    svg('path', { class: 'arc', d: 'M60 280Q720 -120 1380 280', fill: 'none' }));
}

// Today's blocks for the arc: each row with a time, done or not.
function blocksOf(doc, today) {
  const slots = todaySlots(doc, today);
  return todayRows(doc, today)
    .filter((r) => !r.suggested && slots.has(r.item.id))
    .map((r) => ({ id: r.item.id, title: r.item.title, start: slots.get(r.item.id).start, done: r.done, area: r.item.area ?? null }));
}

function progress(done, total, pushed) {
  const text = progressText(done, total, pushed);
  if (!total) return null;
  const segs = total <= 12
    ? h('span', { class: 'dl-segs', role: 'img', 'aria-label': text }, Array.from({ length: total }, (_, i) => h('i', { class: i < done ? 'on' : null })))
    : null;
  return h('span', { class: 'dl-progress' }, segs, h('strong', {}, text));
}

function noteChip(ctx, today, text, lead = null, cls = '') {
  return h('p', { class: `dl-chip ${cls}`.trim() },
    lead,
    h('span', {}, text),
    h('button', { class: 'dl-chip-x', type: 'button', title: 'Hide for today', 'aria-label': `Hide: ${text}`, onclick: () => ctx.hideNote(today, text) }, '×'));
}

function claudeMark() {
  const el = h('span', { class: 'src', title: 'From Claude', role: 'img', 'aria-label': 'From Claude' });
  el.innerHTML = LOGOS.claude; // a fixed string from js/ui/sources.js, never data
  return el;
}

export function renderSky(ctx) {
  const root = document.getElementById('dl-sky');
  const { store, ui } = ctx;
  const doc = store.doc();
  const today = store.today();
  const now = new Date();
  const m = ctx.headerModel();
  const times = sunTimes(localKey(now), ctx.place());
  const phase = skyPhase(now, times);
  const sun = sunAt(now, times);
  root.dataset.phase = phase;
  // The installed app's title bar takes the top of the sky, so it blends in.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && meta.getAttribute('content') !== SKY_TOP[phase]) meta.setAttribute('content', SKY_TOP[phase]);
  document.title = m.total ? `Today · ${m.done}/${m.total}` : 'Today';

  const [syncText, syncTitle] = syncLabel(ctx.syncState());
  const failing = ctx.syncState().state === 'failing';
  const actions = h('nav', { class: 'dl-actions', 'aria-label': 'App' },
    ctx.updater.state().ready
      ? h('button', { class: 'dl-pill dl-update', type: 'button', title: ctx.updater.state().error ?? 'Reload into the downloaded update', onclick: () => ctx.applyUpdate() }, 'Update ready · reload')
      : null,
    h('button', { class: `dl-pill${failing ? ' failing' : ''}`, type: 'button', title: syncTitle, onclick: () => (failing ? ctx.openSettings() : ctx.syncNow()) }, syncText),
    h('button', { class: `dl-round${ctx.flagWaiting() ? ' waiting' : ''}`, type: 'button', title: 'Note something to change', 'aria-label': 'Note something to change', onclick: () => openFlagPanel(ctx) }, icon(FLAG)),
    h('button', { class: 'dl-pill', type: 'button', 'aria-pressed': String(ui.arranging), onclick: () => setArranging(ctx, !ui.arranging) }, ui.arranging ? 'Done' : 'Arrange'),
    h('button', { class: 'dl-round', type: 'button', 'aria-label': 'Settings', onclick: () => ctx.openSettings() }, icon(GEAR)));

  const lights = [
    sun.up
      ? h('div', { class: 'dl-sun', style: `left: ${pct(sun.x)}; top: ${pct(sun.y)}` })
      : h('div', { class: 'dl-moon', 'aria-hidden': 'true' }),
    ...blockDots(blocksOf(doc, today), times).map((d) => h('div', {
      class: `dl-dot${d.done ? ' done' : ''}`, 'data-area': d.area ?? 'none', title: `${d.title}${d.done ? ', done' : ''}`,
      style: `left: ${pct(d.x)}; top: ${pct(d.y)}`,
    })),
  ];

  const words = h('div', { class: 'dl-sky-words' },
    h('div', { class: 'dl-sky-top' }, h('span', { class: 'dl-date' }, `${m.date} · ${m.time} · ${ctx.place().name}`), actions),
    h('div', { class: 'dl-sky-bottom' },
      h('div', { class: 'dl-hello' }, h('h1', {}, m.greeting), progress(m.done, m.total, m.pushed.length)),
      h('div', { class: 'dl-notes' },
        m.warnings.map((w) => h('p', { class: 'dl-chip dl-warning', role: 'status' }, icon(CLOUD), h('span', {}, w))),
        m.brief ? noteChip(ctx, today, m.brief, claudeMark(), 'dl-brief') : null,
        m.off ? noteChip(ctx, today, m.off) : null,
        m.notes.map((n) => noteChip(ctx, today, n)))));

  root.replaceChildren(bands(), ...lights, words);
}
