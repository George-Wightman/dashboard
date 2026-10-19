// Where Daylight's note for Claude sits (js/tiles.js keeps the choice on this device): at the top,
// centred under the sky (the default), under the day's timeline, or first among the tiles. In
// Arrange mode the note offers the three places.

import { h } from './dom.js';
import { renderNote } from './note.js';
import { NOTE_PLACES } from '../tiles.js';
import { keptFocus, restoreFocus } from './side.js';

const PLACE_NAMES = { top: 'Top', day: 'Under the day', tiles: 'With the tiles' };

// The note, dressed for Daylight, with the place buttons while arranging.
export function noteBlock(ctx) {
  const note = renderNote(ctx);
  note.classList.add('dl-note');
  if (ctx.ui.arranging) {
    note.append(h('div', { class: 'note-place', role: 'group', 'aria-label': 'Where the note sits' },
      h('span', { class: 'muted' }, 'Put this note:'),
      NOTE_PLACES.map((p) => h('button', {
        class: ctx.notePlace() === p ? 'dl-btn primary' : 'dl-btn', type: 'button', 'aria-pressed': ctx.notePlace() === p ? 'true' : 'false',
        onclick: () => ctx.setNotePlace(p),
      }, PLACE_NAMES[p]))));
  }
  return note;
}

// The top slot: the note when it lives there, nothing otherwise.
export function renderNoteSlot(ctx) {
  const root = document.getElementById('dl-note-top');
  if (!root) return;
  const kept = keptFocus(root);
  root.replaceChildren(...(ctx.notePlace() === 'top' ? [noteBlock(ctx)] : []));
  restoreFocus(root, kept);
}
