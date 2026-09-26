// A widget opened big: click its heading and its big view (the widget's `big` in js/ui/widgets.js)
// opens in a window over the page (#widget-sheet) — the whole screen on a phone. What it shows is
// the widget's own panel plus the long view that has no room on the page. It is redrawn with the
// page (js/app.js's render), keeping where it was scrolled and any text box's caret; Escape, ✕ or a
// click outside closes it.

import { h } from './dom.js';
import { keptFocus, restoreFocus } from './side.js';

// A section of a big view: a small heading, then its content (null content is left out).
export const bigSection = (title, ...content) => h('section', { class: 'big-section' }, h('h3', {}, title), ...content);

// `widget` is its registry entry: { id, title, big }.
export function openBig(ctx, widget) {
  const dlg = document.getElementById('widget-sheet');
  if (!dlg || !widget?.big) return;
  ctx.ui.big = widget;
  dlg.onclose = () => { ctx.ui.big = null; };
  paintBig(ctx, { top: true });
  if (!dlg.open) dlg.showModal();
  dlg.querySelector('.sheet-close')?.focus();
}

export function paintBig(ctx, { top = false } = {}) {
  const dlg = document.getElementById('widget-sheet');
  const widget = ctx.ui.big;
  if (!dlg || !widget) return;
  const scroll = top ? 0 : dlg.querySelector('.big-body')?.scrollTop ?? 0;
  const kept = keptFocus(dlg);
  const content = widget.big(ctx) ?? h('p', { class: 'muted' }, 'Nothing to show yet.');
  const body = h('div', { class: 'big-body' }, content);
  dlg.replaceChildren(h('div', { class: 'sheet-body' },
    h('div', { class: 'sheet-head' }, h('h2', {}, widget.title),
      h('button', { class: 'link sheet-close', type: 'button', title: 'Close (Esc)', 'aria-label': `Close ${widget.title}`, onclick: () => dlg.close() }, '✕')),
    body));
  body.scrollTop = scroll;
  restoreFocus(dlg, kept);
}

// Makes a widget's heading open it: the whole heading is the button (Enter or Space too), with a
// small ⤢ beside the title that shows on hover. `open` is what opening does.
export function makeOpener(head, title, open, { mark = true } = {}) {
  if (!head) return;
  const first = head.firstChild;
  const label = h('span', { class: 'head-title' }, first?.nodeType === 3 ? first.textContent : title,
    mark ? h('span', { class: 'open-mark', 'aria-hidden': 'true' }, '⤢') : null);
  if (first?.nodeType === 3) first.replaceWith(label);
  else head.prepend(label);
  head.classList.add('opens');
  Object.assign(head, { tabIndex: 0, title: `Open ${title} big` });
  head.setAttribute('role', 'button');
  head.addEventListener('click', (e) => { if (!e.target.closest('button')) open(); });
  head.addEventListener('keydown', (e) => {
    if (e.target === head && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); }
  });
}
