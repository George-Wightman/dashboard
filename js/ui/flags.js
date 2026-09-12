// The ⚑ panel: George's notes of something to change, with the About line, the open flags, and
// whether they have reached GitHub. Everything it reads comes from ctx.flagState() (js/app.js),
// captured once when the panel opens (js/flags.js's flagContext), so the note always describes
// the moment he pressed ⚑, not whatever the page has moved on to while he types.

import { h } from './dom.js';
import { flagContext, flagAbout, openFlags, addressedCount, waitingFlags, flagSyncLine, scrubText } from '../flags.js';

const when = (iso) => new Date(iso).toLocaleString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

// One open flag: his sentence, when, its captured context behind "More details", and a way to
// mark it addressed. Nothing is ever deleted — addressing just archives it (js/data.js).
function flagItem(ctx, f, repaint) {
  return h('li', { class: 'flag-item' },
    h('p', { class: 'flag-text' }, f.text),
    h('p', { class: 'muted flag-meta' }, when(f.updated)),
    h('details', {}, h('summary', {}, 'More details'), h('pre', {}, JSON.stringify(f.ctx, null, 2))),
    h('button', {
      class: 'link', type: 'button',
      onclick: () => { ctx.store.addressFlag(f.id); repaint(); },
    }, 'Mark addressed'));
}

export function openFlagPanel(ctx) {
  const { store } = ctx;
  const dialog = document.getElementById('flags');
  // Captured once, at the moment the panel opens — not re-captured as George types or the page
  // changes underneath the dialog.
  const captured = flagContext(ctx.flagState());

  const textarea = h('textarea', {
    rows: 4, maxlength: 1000, placeholder: 'What would you change about this?',
    'aria-label': 'What would you change about this?',
  });
  const status = h('p', { class: 'error', role: 'status' });
  const list = h('ul', { class: 'flag-list' });
  const addressedLine = h('p', { class: 'muted' }, '');
  const syncLine = h('p', { class: 'flag-sync' });

  function repaint() {
    const doc = store.doc();
    list.replaceChildren(...openFlags(doc).map((f) => flagItem(ctx, f, repaint)));
    const addressed = addressedCount(doc);
    addressedLine.hidden = !addressed;
    addressedLine.textContent = addressed ? `${addressed} addressed` : '';
    const syncOn = ctx.syncOn();
    const waiting = waitingFlags(doc, ctx.lastSynced()).length;
    syncLine.replaceChildren(flagSyncLine(syncOn, waiting));
    if (syncOn && waiting) {
      syncLine.append(' · ', h('button', {
        class: 'link', type: 'button',
        onclick: () => { ctx.syncNow().then(repaint); },
      }, 'Sync now'));
    }
  }

  function save(e) {
    e.preventDefault();
    const raw = textarea.value.trim();
    if (!raw) { status.textContent = 'Write something first.'; return; }
    // Scrubbed the same way as the captured context, so a pasted key can't reach a flag through
    // the typed sentence either. The store itself stays unaware of settings.
    const { token, geminiKey } = store.settings();
    const text = scrubText(raw, [token, geminiKey]);
    store.addFlag(text, captured);
    textarea.value = '';
    textarea.focus();
    status.textContent = 'Saved.';
    repaint();
    ctx.syncNow().then(repaint);
  }
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(e); }
  });

  // Repainted on every store change while the panel is open (a sync landing, another window's
  // save, addressing a flag from here); stopped when the dialog closes.
  const unsubscribe = store.subscribe(repaint);
  dialog.addEventListener('close', () => unsubscribe(), { once: true });

  dialog.replaceChildren(
    h('h2', {}, 'Note something to change'),
    h('p', { class: 'about' }, h('strong', {}, 'About: '), flagAbout(captured)),
    h('form', { onsubmit: save },
      textarea,
      status,
      h('div', { class: 'buttons' },
        h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
        h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Close'))),
    list,
    addressedLine,
    syncLine);
  repaint();
  dialog.showModal();
  textarea.focus();
}
