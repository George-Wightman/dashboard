// The note for Claude: a small widget for a thought George wants Claude to pick up next time they
// talk — said into the mic or typed, read back, sent. Each one is a *For Claude* flag (js/flags.js),
// stamped with the time and what he was in the middle of (js/calendar.js's doingNow), so it needs no
// trip into ⚑. Claude's `catchup` puts them first. The draft lives in ctx.ui.note, so a re-render
// never loses it.

import { h } from './dom.js';
import { doingNow, clockLabel } from '../calendar.js';
import { openFlags } from '../flags.js';
import { micButton, stopListening, grow } from './mic.js';

export const noteState = () => ({ draft: '', error: '', sent: '' });
const SENT_FOR_MS = 8000;

// Notes he's left that Claude hasn't picked up yet.
export const notesWaiting = (doc) => openFlags(doc, 'claude').filter((f) => (f.source ?? 'me') === 'me');

function send(ctx) {
  const n = ctx.ui.note;
  stopListening();
  const now = ctx.now?.() ?? new Date();
  try {
    ctx.store.addFlag(n.draft, ctx.flagState(), 'me', 'claude', { doing: doingNow(ctx.store.doc(), ctx.store.today(), now) });
  } catch (e) {
    n.error = e.message === 'A flag needs some text' ? 'Say or type something first.' : e.message;
    ctx.render();
    return;
  }
  Object.assign(n, { draft: '', error: '', sent: `Sent at ${clockLabel(now.toISOString())}.` });
  setTimeout(() => { if (n.sent) { n.sent = ''; ctx.render(); } }, SENT_FOR_MS);
  ctx.render();
}

export function renderNote(ctx) {
  const n = ctx.ui.note;
  const waiting = notesWaiting(ctx.store.doc()).length;
  const box = h('textarea', {
    rows: 1, maxlength: 2000, 'data-focus': 'note-for-claude', 'aria-label': 'A note for Claude',
    placeholder: 'Say or type a note…',
    oninput: (e) => { n.draft = e.target.value; grow(e.target); },
    onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(ctx); } },
  });
  box.value = n.draft;
  queueMicrotask(() => grow(box));
  return h('section', { class: 'panel note-panel' },
    h('h2', {}, 'Note for Claude',
      waiting ? h('span', { class: 'muted note-waiting', title: 'Waiting for Claude to pick up (in ⚑ under For Claude)' }, `${waiting} waiting`) : null),
    h('div', { class: 'note-box' }, box,
      micButton({
        key: 'note',
        getText: () => n.draft,
        setText: (text) => {
          n.draft = text;
          const live = document.querySelector('[data-focus="note-for-claude"]') ?? box;
          live.value = text;
          grow(live);
        },
        onBlocked: (message) => { n.error = message; },
        render: ctx.render,
      }),
      h('button', { class: 'btn primary', type: 'button', onclick: () => send(ctx) }, 'Send')),
    n.error ? h('p', { class: 'error', role: 'alert' }, n.error) : null,
    n.sent ? h('p', { class: 'muted note-sent', role: 'status' }, n.sent) : null);
}
