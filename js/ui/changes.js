// ⚙ → Claude's changes: what Claude has changed from a chat, newest first, 20 at a time, each with
// its Details (field by field) and Undo (js/changes.js, store.undoChange). Undo never overwrites
// something changed since; the row says what happened.

import { h } from './dom.js';
import { changeList, editLines, canUndo, undoLine } from '../changes.js';

const PAGE = 20;

const when = (at) => new Date(at).toLocaleString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

export function changesPanel(ctx) {
  const { store } = ctx;
  const box = h('div', { class: 'claude-changes' });
  const notes = new Map(); // change id → what its Undo did, shown under the row
  let shown = PAGE;

  function undo(c) {
    notes.set(c.id, undoLine(store.undoChange(c.id, 'me')));
    paint();
  }

  function row(c) {
    const lines = c.pruned ? [] : c.edits.flatMap((e) => editLines(e));
    return h('li', { class: c.undoneAt ? 'change undone' : 'change' },
      h('div', { class: 'change-line' },
        h('span', { class: 'muted' }, `${when(c.at)} · `),
        h('span', { class: 'change-summary' }, c.summary),
        c.undoneAt ? h('span', { class: 'muted' }, ' · undone') : null),
      lines.length
        ? h('details', {}, h('summary', {}, 'Details'), h('ul', { class: 'change-edits' }, lines.map((line) => h('li', {}, line))))
        : null,
      canUndo(c) ? h('button', { class: 'link', type: 'button', onclick: () => undo(c) }, 'Undo') : null,
      notes.has(c.id) ? h('p', { class: 'muted', role: 'status' }, notes.get(c.id)) : null);
  }

  function paint() {
    const list = changeList(store.doc());
    if (!list.length) {
      box.replaceChildren(h('p', { class: 'note' }, 'Nothing yet. Anything Claude changes from a chat shows here, with Undo.'));
      return;
    }
    box.replaceChildren(
      h('ul', { class: 'change-list' }, list.slice(0, shown).map(row)),
      list.length > shown
        ? h('button', { class: 'link', type: 'button', onclick: () => { shown += PAGE; paint(); } }, 'Show more')
        : null);
  }

  paint();
  return box;
}
