// Check-ins on screen (js/checkins.js): the waiting question at the top of Today's list, one at a
// time — a box, a mic, Save and Skip. Save keeps his words at once; Gemini then tidies them into a
// short note in the background, and a failure there costs nothing (Claude reads his words either
// way). What he's typed or said lives in ctx.ui.checkin, so a re-render never loses it.

import { h } from './dom.js';
import { waitingCheckins, questionFor, SUMMARY_SYSTEM, summaryPrompt, parseSummary } from '../checkins.js';
import { micButton, stopListening, grow } from './mic.js';

const SAVED_FOR_MS = 6000;

export const checkinState = () => ({ drafts: {}, error: '', saved: '', first: null });

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
  stopListening();
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
  stopListening();
  delete c.drafts[rec.id];
  Object.assign(c, { error: '', first: null });
  ctx.store.skipCheckin(rec.id);
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
    h('div', { class: 'checkin-box' }, box, micButton({
      key: `checkin-${rec.id}`,
      getText: () => c.drafts[rec.id] ?? '',
      setText: (text) => {
        c.drafts[rec.id] = text;
        const live = document.querySelector(`[data-focus="checkin-${rec.id}"]`) ?? box;
        live.value = text;
        grow(live);
      },
      onBlocked: (message) => { c.error = message; },
      render: ctx.render,
    })),
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
