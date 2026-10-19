// Log Hebrew time by hand: the minutes away from the Hebrew Reader (a conversation with Maya, a
// podcast), which its sync can't see. Opened from the home-screen shortcut or the Hebrew tile.

import { h } from './dom.js';
import { logHebrewByHand } from '../tiles.js';

const CHOICES = [15, 30, 45, 60];

export function openHebrewLog(ctx) {
  const dlg = document.getElementById('hebrew-log');
  if (!dlg) return;
  let error = '';
  const close = () => dlg.close();
  const save = (minutes) => {
    try {
      logHebrewByHand(ctx.store, minutes);
      close();
    } catch (e) {
      error = e.message;
      paint();
    }
  };
  const paint = () => {
    const custom = h('input', { type: 'number', min: 1, max: 600, step: 1, inputmode: 'numeric', 'aria-label': 'Other minutes', placeholder: 'Other' });
    dlg.replaceChildren(h('div', { class: 'sheet-body' },
      h('div', { class: 'sheet-head' }, h('h2', {}, 'Log Hebrew time'),
        h('button', { class: 'link sheet-close', type: 'button', 'aria-label': 'Close', onclick: close }, '✕')),
      h('p', { class: 'snap-when' }, 'Time away from the Hebrew Reader: a conversation, a podcast, a lesson.'),
      h('div', { class: 'hebrew-log-choices' }, CHOICES.map((n) => h('button', { class: 'dl-btn', type: 'button', onclick: () => save(n) }, `${n} min`))),
      h('form', { class: 'hebrew-log-other', onsubmit: (e) => { e.preventDefault(); save(Math.round(Number(custom.value))); } },
        custom, h('button', { class: 'dl-btn primary', type: 'submit' }, 'Log')),
      error ? h('p', { class: 'error', role: 'alert' }, error) : null));
  };
  paint();
  if (!dlg.open) dlg.showModal();
}
