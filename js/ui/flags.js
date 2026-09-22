// The ⚑ panel: George's notes of something to change, with the About line, the open flags, and
// whether they have reached GitHub. Everything it reads comes from ctx.flagState() (js/app.js),
// captured once when the panel opens (js/flags.js's flagContext), so the note always describes
// the moment he pressed ⚑, not whatever the page has moved on to while he types.

import { h } from './dom.js';
import {
  flagContext, flagAbout, openFlags, addressedCount, waitingFlags, flagSyncLine, scrubText,
  FLAG_KINDS, flagKind, flagKindCounts, flagSourceName,
} from '../flags.js';
import { LOGOS } from './sources.js';

const when = (iso) => new Date(iso).toLocaleString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

// A half-typed sentence, kept here (not just in the textarea) so Escape/Close doesn't lose it: the
// panel builds a fresh textarea every time it opens. Cleared once it's actually saved.
let draftText = '';
// The kind the next flag is saved as, and which kind the list shows (null: all). Kept across
// openings like the draft.
let draftKind = 'feature';
let showKind = null;
const PROMPTS = {
  feature: 'What would you change about this?',
  bug: 'What went wrong?',
  claude: 'What should Claude know for later?',
  note: 'What do you want to remember?',
};

// Who wrote it, as a mark: Gemini's star for the Coach, Claude's spark for Claude, the loop for a
// follow-up rule, and a plain "You" for George's own.
const MARK_LOGO = { coach: 'gemini', claude: 'claude', workflow: 'workflow', calendar: 'calendar' };
function sourceBadge(f) {
  const name = flagSourceName(f);
  const logo = LOGOS[MARK_LOGO[f.source]];
  const el = h('span', { class: `flag-src src-${MARK_LOGO[f.source] ?? 'me'}`, title: `From ${name}` });
  if (logo) {
    const icon = h('span', { class: 'src', 'aria-hidden': 'true' });
    icon.innerHTML = logo; // a fixed string from sources.js, never data
    el.append(icon, f.source === 'coach' ? 'Coach' : f.source === 'calendar' ? 'Calendar' : name);
  } else el.append(f.source === 'me' || !f.source ? 'You' : name);
  return el;
}

// The kind as a small select, so a flag can be re-sorted where it sits.
function kindPicker(ctx, f, repaint) {
  const kind = flagKind(f);
  const select = h('select', { class: `flag-kind kind-${kind}`, 'aria-label': 'What this flag is for' },
    Object.entries(FLAG_KINDS).map(([k, label]) => h('option', { value: k, selected: k === kind }, label)));
  select.addEventListener('change', () => { ctx.store.setFlagKind(f.id, select.value); repaint(); });
  return select;
}

// One open flag: his sentence, when, its captured context behind "More details", and a way to
// mark it addressed. Nothing is ever deleted — addressing just archives it (js/data.js).
function flagItem(ctx, f, repaint) {
  return h('li', { class: `flag-item kind-${flagKind(f)}` },
    h('div', { class: 'flag-head' }, kindPicker(ctx, f, repaint), sourceBadge(f),
      h('span', { class: 'muted flag-meta' }, when(f.at ?? f.updated))),
    h('p', { class: 'flag-text' }, f.text),
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
    rows: 4, maxlength: 1000, placeholder: PROMPTS[draftKind],
    'aria-label': 'What would you change about this?',
  });
  textarea.value = draftText;
  textarea.addEventListener('input', () => { draftText = textarea.value; });
  const status = h('p', { class: 'error', role: 'status' });
  const list = h('ul', { class: 'flag-list' });
  const filters = h('div', { class: 'flag-filters', role: 'group', 'aria-label': 'Show flags' });
  const chip = (label, on, onclick) => h('button', {
    class: on ? 'chip on' : 'chip', type: 'button', 'aria-pressed': String(on), onclick,
  }, label);
  const kindChips = h('div', { class: 'flag-kinds', role: 'group', 'aria-label': 'This flag is' });
  function paintKindChips() {
    kindChips.replaceChildren(...Object.entries(FLAG_KINDS).map(([k, label]) => chip(label, k === draftKind, () => {
      draftKind = k;
      paintKindChips();
      textarea.placeholder = PROMPTS[k];
      textarea.focus();
    })));
  }
  const addressedLine = h('p', { class: 'muted' }, '');
  const syncLine = h('p', { class: 'flag-sync' });

  function repaint() {
    const doc = store.doc();
    const counts = flagKindCounts(doc);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (showKind && !counts[showKind]) showKind = null;
    filters.hidden = !total;
    filters.replaceChildren(
      chip(`All ${total}`, !showKind, () => { showKind = null; repaint(); }),
      ...Object.entries(FLAG_KINDS).filter(([k]) => counts[k])
        .map(([k, label]) => chip(`${label} ${counts[k]}`, showKind === k, () => { showKind = k; repaint(); })));
    list.replaceChildren(...openFlags(doc, showKind).map((f) => flagItem(ctx, f, repaint)));
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
    store.addFlag(text, captured, 'me', draftKind);
    textarea.value = '';
    draftText = '';
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
      kindChips,
      textarea,
      status,
      h('div', { class: 'buttons' },
        h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
        h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Close'))),
    filters,
    list,
    addressedLine,
    syncLine);
  paintKindChips();
  repaint();
  dialog.showModal();
  textarea.focus();
}
