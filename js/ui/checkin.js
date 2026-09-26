// Check-ins on screen (js/checkins.js): the waiting question at the top of Today's list, one at a
// time — a box, a mic, Save and Skip. Save keeps his words at once; Gemini then tidies them into a
// short note in the background, and a failure there costs nothing (Claude reads his words either
// way). What he's typed or said lives in ctx.ui.checkin, so a re-render never loses it.

import { h } from './dom.js';
import { waitingCheckins, questionFor, SUMMARY_SYSTEM, summaryPrompt, parseSummary } from '../checkins.js';

const MIC = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>';
const SAVED_FOR_MS = 6000;
let listening = null;

export const checkinState = () => ({ drafts: {}, error: '', saved: '', first: null });

export function speechRecognition(g = globalThis) {
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

// A tick from the list or a task card: the tick, then (for a task) the question — or, for a tick
// taken off, its unanswered question goes too.
export function tickAndAsk(ctx, itemId) {
  const { store } = ctx;
  const day = store.today();
  const log = store.toggleDone(itemId, day);
  if (store.doc().items[itemId]?.type !== 'task') return;
  if (log) store.askCheckin({ day, itemId, why: 'done' });
  else store.withdrawCheckin(day, itemId);
}

// The one on show: the one a notification opened, else the oldest waiting.
function current(ctx) {
  const waiting = waitingCheckins(ctx.store.doc(), ctx.store.today());
  const first = waiting.find((r) => r.id === ctx.ui.checkin.first);
  return { rec: first ?? waiting[0] ?? null, count: waiting.length };
}

async function tidy(ctx, rec, said) {
  if (!ctx.gemini?.keys().length || navigator.onLine === false) return;
  try {
    const { data, model } = await ctx.gemini.ask({ system: SUMMARY_SYSTEM, prompt: summaryPrompt(rec, said) });
    await ctx.whenIdle();
    ctx.store.summariseCheckin(rec.id, parseSummary(data), model);
  } catch { /* his words are kept; the summary is only a convenience */ }
}

function save(ctx, rec) {
  const c = ctx.ui.checkin;
  listening?.stop();
  const said = String(c.drafts[rec.id] ?? '').trim();
  try {
    ctx.store.answerCheckin(rec.id, said);
  } catch (e) {
    c.error = e.message;
    ctx.render();
    return;
  }
  delete c.drafts[rec.id];
  Object.assign(c, { error: '', saved: `Saved — Claude will see it next time you talk.`, first: null });
  setTimeout(() => { if (c.saved) { c.saved = ''; ctx.render(); } }, SAVED_FOR_MS);
  ctx.render();
  tidy(ctx, rec, said);
}

function skip(ctx, rec) {
  const c = ctx.ui.checkin;
  listening?.stop();
  delete c.drafts[rec.id];
  Object.assign(c, { error: '', first: null });
  ctx.store.skipCheckin(rec.id);
}

function grow(box) {
  box.style.height = 'auto';
  box.style.height = `${box.scrollHeight + 2}px`;
}

function micButton(ctx, rec, box) {
  const Recognition = speechRecognition();
  if (!Recognition) return null;
  const c = ctx.ui.checkin;
  const on = !!listening;
  const button = h('button', {
    class: `btn mic${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on),
    'aria-label': on ? 'Stop listening' : 'Speak your answer', title: on ? 'Stop listening' : 'Speak instead of typing',
    onclick: () => {
      if (listening) { listening.stop(); return; }
      const r = new Recognition();
      r.lang = 'en-GB';
      r.interimResults = true;
      r.continuous = true;
      const before = c.drafts[rec.id] ? `${String(c.drafts[rec.id]).trimEnd()} ` : '';
      r.onresult = (e) => {
        let heard = '';
        for (let i = 0; i < e.results.length; i++) heard += e.results[i][0].transcript;
        c.drafts[rec.id] = `${before}${heard.trim()}`;
        const live = document.querySelector(`[data-focus="checkin-${rec.id}"]`) ?? box;
        live.value = c.drafts[rec.id];
        grow(live);
      };
      r.onerror = (e) => {
        if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') c.error = 'The microphone is blocked for this page: allow it in the browser to speak.';
      };
      r.onend = () => { listening = null; ctx.render(); };
      listening = r;
      try { r.start(); } catch { listening = null; }
      ctx.render();
    },
  });
  button.innerHTML = MIC; // a fixed string, never data
  return button;
}

// The card, as the first row of the list — or the "saved" line for a few seconds after. Null when
// nothing is waiting.
export function renderCheckin(ctx) {
  const c = ctx.ui.checkin;
  const { rec, count } = current(ctx);
  if (!rec) return c.saved ? h('li', { class: 'checkin-saved', role: 'status' }, c.saved) : null;
  const box = h('textarea', {
    rows: 2, maxlength: 4000, 'data-focus': `checkin-${rec.id}`, 'aria-label': questionFor(rec.why, rec.title),
    placeholder: rec.why === 'missed' ? 'What got in the way — or did it happen and just not get ticked?' : 'What went well, what didn\'t, what you\'d change…',
    oninput: (e) => { c.drafts[rec.id] = e.target.value; grow(e.target); },
    onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(ctx, rec); } },
  });
  box.value = c.drafts[rec.id] ?? '';
  queueMicrotask(() => grow(box));
  return h('li', { class: `checkin${rec.why === 'missed' ? ' missed' : ''}`, 'data-checkin': rec.id },
    h('p', { class: 'checkin-q' }, questionFor(rec.why, rec.title), count > 1 ? h('span', { class: 'muted' }, ` · 1 of ${count}`) : null),
    h('div', { class: 'checkin-box' }, box, micButton(ctx, rec, box)),
    c.error ? h('p', { class: 'error', role: 'alert' }, c.error) : null,
    h('div', { class: 'buttons' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => save(ctx, rec) }, 'Save'),
      h('button', { class: 'link', type: 'button', onclick: () => skip(ctx, rec) }, 'Skip')));
}

// Opened from a notification: that question first, the list in view and the box ready.
export function openCheckin(ctx, id) {
  ctx.ui.checkin.first = id;
  ctx.render();
  const card = document.querySelector(`[data-checkin="${CSS.escape(id)}"]`);
  card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  card?.querySelector('textarea')?.focus();
}
