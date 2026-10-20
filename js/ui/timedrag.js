// Dragging a task to a new time on Daylight's day (js/timeline.js's dropTime has the rule). With the
// mouse it starts once the row moves; on the phone after a long press, so the day still scrolls. A
// label says where it will land. Let go on the day and the task takes that time today, and the
// planner moves its calendar block on its next run; let go on "Any time today" and it's reordered
// there; anywhere else and nothing changes. Shifts, habits and done rows stay where they are.

import { h } from './dom.js';
import { dropTime, toClock, toDay } from '../timeline.js';

const HOLD_MS = 400;
const SLOP_PX = 8;

let drag = null;
let quietUntil = 0;

const blockScroll = (e) => { if (drag?.active) e.preventDefault(); };

function anchors(root, id) {
  return [...root.querySelectorAll('ol.tl > li[data-start]')].filter((el) => el.dataset.id !== id);
}

// Where the pointer is: on the day (a time), on "Any time today" (a row to go before), or neither.
function target(root, y, id, item, now) {
  const day = root.querySelector('ol.tl');
  const any = root.querySelector('ul.tl-any');
  const box = day?.getBoundingClientRect();
  if (box && item.type === 'task' && y >= box.top - 24 && y <= box.bottom + 24) {
    const els = anchors(root, id);
    const i = els.findIndex((el) => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2; });
    const aboveEl = i === -1 ? els.at(-1) : els[i - 1];
    const belowEl = i === -1 ? null : els[i];
    const read = (el) => (el ? { start: el.dataset.start, end: el.dataset.end || el.dataset.start } : null);
    const top = aboveEl ? aboveEl.getBoundingClientRect().bottom : box.top;
    const bottom = belowEl ? belowEl.getBoundingClientRect().top : box.bottom;
    const fraction = bottom > top ? (y - top) / (bottom - top) : 0;
    const when = dropTime({ above: read(aboveEl), below: read(belowEl), fraction, minutes: item.minutes ?? 30, now });
    return { kind: 'time', when, mark: belowEl ?? aboveEl, after: !belowEl };
  }
  const anyBox = any?.getBoundingClientRect();
  if (anyBox && y >= anyBox.top && y <= anyBox.bottom) {
    const rows = [...any.querySelectorAll(':scope > li.row')].filter((el) => el.dataset.id !== id);
    const before = rows.find((el) => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2; });
    return { kind: 'order', before, mark: before ?? rows.at(-1), after: !before };
  }
  return null;
}

function paint(d) {
  for (const el of d.root.querySelectorAll('.tl-drop-before, .tl-drop-after')) el.classList.remove('tl-drop-before', 'tl-drop-after');
  d.label.style.top = `${d.y - 18}px`;
  d.label.style.left = `${Math.min(window.innerWidth - 160, d.x + 16)}px`;
  if (!d.target) { d.label.textContent = 'Let go to leave it'; return; }
  d.target.mark?.classList.add(d.target.after ? 'tl-drop-after' : 'tl-drop-before');
  d.label.textContent = d.target.kind === 'time' ? `Move to ${toClock(d.target.when)}` : 'Any time today';
}

function begin(d) {
  d.active = true;
  d.ctx.ui.timelineDrag = true;
  d.li.classList.add('tl-dragging');
  d.label = h('div', { class: 'tl-drag-label', role: 'status' });
  document.body.append(d.label);
  navigator.vibrate?.(15);
  d.target = target(d.root, d.y, d.id, d.item, new Date());
  paint(d);
}

function finish(commit) {
  const d = drag;
  drag = null;
  if (!d) return;
  clearTimeout(d.hold);
  document.removeEventListener('pointermove', move);
  document.removeEventListener('pointerup', up);
  document.removeEventListener('pointercancel', cancel);
  if (!d.active) return;
  d.label?.remove();
  d.li.classList.remove('tl-dragging');
  for (const el of d.root.querySelectorAll('.tl-drop-before, .tl-drop-after')) el.classList.remove('tl-drop-before', 'tl-drop-after');
  d.ctx.ui.timelineDrag = false;
  // The click that ends a mouse drag mustn't also open or tick the row.
  quietUntil = Date.now() + 400;
  const t = commit ? d.target : null;
  try {
    if (t?.kind === 'time') d.ctx.store.updateItem(d.id, { date: toDay(t.when), time: toClock(t.when) });
    else if (t?.kind === 'order' && t.before) {
      const ids = [...d.root.querySelectorAll('ul.tl-any > li.row[data-drag]')].map((el) => el.dataset.id);
      d.ctx.store.moveBefore(d.id, t.before.dataset.id, ids);
    }
  } finally {
    d.ctx.render();
  }
}

function move(e) {
  const d = drag;
  if (!d || e.pointerId !== d.pointer) return;
  d.x = e.clientX;
  d.y = e.clientY;
  if (!d.active) {
    const far = Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > SLOP_PX;
    if (!far) return;
    // A finger that moves before the hold is scrolling; a mouse that moves is dragging.
    if (d.touch) { finish(false); return; }
    begin(d);
  }
  e.preventDefault();
  d.target = target(d.root, d.y, d.id, d.item, new Date());
  paint(d);
}

const up = (e) => { if (drag && e.pointerId === drag.pointer) finish(true); };
const cancel = (e) => { if (drag && e.pointerId === drag.pointer) finish(false); };

// Once per timeline root: pointer handling for every row marked data-drag.
export function enableTimeDrag(root, ctx) {
  if (root.dataset.timeDrag) return;
  root.dataset.timeDrag = '1';
  document.addEventListener('touchmove', blockScroll, { passive: false });
  window.addEventListener('click', (e) => { if (Date.now() < quietUntil) { e.stopPropagation(); e.preventDefault(); } }, true);
  root.addEventListener('pointerdown', (e) => {
    if (drag || e.button > 0 || ctx.ui.arranging) return;
    const li = e.target.closest?.('li.row[data-drag]');
    if (!li || e.target.closest('input, button, a, textarea, select, label')) return;
    const item = ctx.store.doc().items[li.dataset.id];
    if (!item) return;
    drag = {
      ctx, root, li, item, id: li.dataset.id, pointer: e.pointerId, touch: e.pointerType !== 'mouse',
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false, target: null, label: null, hold: null,
    };
    if (drag.touch) drag.hold = setTimeout(() => { if (drag && !drag.active) begin(drag); }, HOLD_MS);
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
  });
  // A long press would otherwise open the phone's menu over the row.
  root.addEventListener('contextmenu', (e) => { if (drag?.active || drag?.touch) e.preventDefault(); });
}
