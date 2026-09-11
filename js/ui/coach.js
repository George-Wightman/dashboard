// The Coach panel: today's evening check-in (and, from Tasks 6 and 7, goal shaping and last
// week's digest). Every Gemini request runs in the background: the panel says "Thinking…", the
// rest of the page keeps working, and a failure is one line of text, never a dialog. What George
// types lives in ctx.ui.coach, so a re-render (a sync landing, a tick on the left) never loses it.
// Nothing is written to the document until a reply has passed its parser.

import { h } from './dom.js';
import { GeminiError, MESSAGES } from '../gemini.js';
import {
  checkinOf, checkinState, questionsPrompt, feedbackPrompt, parseQuestions, parseFeedback, shapePrompt, parseShape,
} from '../coach.js';
import { addDays, hourLabel } from '../dates.js';

const link = (text, onclick) => h('button', { class: 'link', type: 'button', onclick }, text);

// Why a request can't be sent right now ('' when it can): no key on this device, or offline.
function blocker(ctx) {
  if (!ctx.coach.keys().length) return MESSAGES.nokey;
  if (navigator.onLine === false) return MESSAGES.offline;
  return '';
}

// Ask Gemini, then check the reply. Resolves { reply, model }. Rejects with an Error whose message
// is the line to show: Gemini's own plain-English message, or the catch-all — never another
// error's raw text.
async function consult(ctx, prompt, parse) {
  const why = blocker(ctx);
  if (why) throw new Error(why);
  try {
    const { data, model } = await ctx.coach.ask(prompt);
    return { reply: parse(data), model };
  } catch (e) {
    throw new Error(e instanceof GeminiError ? e.message : MESSAGES.failed);
  }
}

// Today's check-in state as the panel shows it right now. js/app.js repaints when it changes
// (the check-in hour arriving while the page sits open).
export function checkinNow(ctx) {
  const { store } = ctx;
  const { dayStartHour, checkinHour } = store.settings();
  return checkinState({
    doc: store.doc(), today: store.today(), now: new Date(), dayStartHour, checkinHour,
    hasKey: ctx.coach.keys().length > 0,
  });
}

// ---- The check-in -----------------------------------------------------------------------------

// Job A: Gemini's questions about today, saved as soon as they arrive (so they survive a reload
// or a switch of device).
export async function startCheckin(ctx) {
  const { store, ui } = ctx;
  const c = ui.coach;
  if (c.busy) return;
  const today = store.today();
  c.error = '';
  c.busy = 'questions';
  ctx.render();
  try {
    const { reply, model } = await consult(ctx, questionsPrompt(store.doc(), today), parseQuestions);
    c.answers = [];
    c.notNow = '';
    store.saveJournal({ kind: 'checkin', day: today, questions: reply.questions, answers: [], feedback: '', tomorrowIds: [], model });
  } catch (e) {
    c.error = e.message;
  } finally {
    c.busy = '';
    ctx.render();
  }
}

// Job B: his answers go to Gemini; its feedback and at most two tasks for tomorrow come back.
// The tasks land as suggestions dated tomorrow, then the check-in is saved with the answers.
export async function sendCheckin(ctx) {
  const { store, ui } = ctx;
  const c = ui.coach;
  if (c.busy) return;
  const today = store.today();
  const rec = checkinOf(store.doc(), today);
  if (!rec?.questions?.length) return;
  const answers = rec.questions.map((_, i) => String(c.answers[i] ?? '').trim());
  if (!answers.some(Boolean)) {
    c.error = 'Answer at least one question first.';
    ctx.render();
    return;
  }
  c.error = '';
  c.busy = 'feedback';
  ctx.render();
  try {
    const { reply, model } = await consult(ctx, feedbackPrompt(store.doc(), today, rec.questions, answers), parseFeedback);
    const { items } = store.addPlan({ tasks: reply.tomorrow.map((t) => ({ title: t.title, date: addDays(today, 1) })) });
    store.saveJournal({ kind: 'checkin', day: today, answers, feedback: reply.feedback, tomorrowIds: items.map((i) => i.id), model });
    c.answers = [];
    c.feedbackOpen = true;
  } catch (e) {
    c.error = e.message;
  } finally {
    c.busy = '';
    ctx.render();
  }
}

function renderQuestions(ctx, rec) {
  const c = ctx.ui.coach;
  const send = () => sendCheckin(ctx);
  return h('form', { class: 'checkin', onsubmit: (e) => { e.preventDefault(); send(); } },
    rec.questions.map((q, i) => {
      // The box is rebuilt from ui.coach.answers on every render; data-focus lets renderSide
      // put the caret back after a re-render.
      const box = h('textarea', { rows: 2, 'data-focus': `coach-answer-${i}` });
      box.value = c.answers[i] ?? '';
      box.addEventListener('input', () => { c.answers[i] = box.value; });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
      });
      return h('label', { class: 'question' }, h('span', {}, q), box);
    }),
    h('div', { class: 'buttons' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Send'),
      link('Not now', () => { c.notNow = ctx.store.today(); c.error = ''; ctx.render(); })));
}

function renderFeedback(ctx, rec) {
  const c = ctx.ui.coach;
  const doc = ctx.store.doc();
  const waiting = (rec.tomorrowIds ?? []).filter((id) => doc.items[id]?.status === 'suggested').length;
  const details = h('details', { class: 'coach-feedback', open: c.feedbackOpen },
    h('summary', {}, "Today's check-in"),
    h('p', { class: 'feedback-text' }, rec.feedback),
    waiting
      ? h('p', { class: 'muted' }, waiting === 1
        ? 'A task for tomorrow waits at the top of the list.'
        : `${waiting} tasks for tomorrow wait at the top of the list.`)
      : null);
  details.addEventListener('toggle', () => { c.feedbackOpen = details.open; });
  return details;
}

function renderCheckin(ctx) {
  const { store, ui } = ctx;
  const c = ui.coach;
  if (c.busy) return h('p', { class: 'muted', role: 'status' }, 'Thinking…');
  const today = store.today();
  const doc = store.doc();
  switch (checkinNow(ctx)) {
    case 'nokey':
      return h('p', { class: 'muted' }, MESSAGES.nokey);
    case 'early':
      return h('p', { class: 'muted' },
        `Evening check-in from ${hourLabel(store.settings().checkinHour)} · `, link('check in now', () => startCheckin(ctx)));
    case 'due':
      return h('button', { class: 'btn primary', type: 'button', onclick: () => startCheckin(ctx) }, "Start today's check-in");
    case 'questions':
      return c.notNow === today
        ? h('p', { class: 'muted' }, "Today's check-in is waiting · ", link('answer now', () => { c.notNow = ''; ctx.render(); }))
        : renderQuestions(ctx, checkinOf(doc, today));
    default: // 'done'
      return renderFeedback(ctx, checkinOf(doc, today));
  }
}

// ---- The panel --------------------------------------------------------------------------------

export function renderCoach(ctx) {
  const c = ctx.ui.coach;
  return h('section', { class: 'panel coach' },
    h('h2', {}, 'Coach', ctx.coach.fake ? h('span', { class: 'fake' }, `fake · ${ctx.coach.fake}`) : null),
    renderCheckin(ctx),
    c.error ? h('p', { class: 'error', role: 'status' }, c.error) : null);
}

// ---- Shape a goal -----------------------------------------------------------------------------

// Job C: a big goal in plain words becomes a suggested goal with milestones, habits and weekly
// targets — all suggestions, written in one commit, only once the reply has passed its parser.
export async function shapeGoal(ctx, text) {
  const { store, ui } = ctx;
  const c = ui.coach;
  if (c.shapeBusy) return;
  if (!String(text ?? '').trim()) {
    c.shapeError = 'Say what you want to achieve first.';
    ctx.render();
    return;
  }
  const today = store.today();
  c.shapeError = '';
  c.shapeBusy = true;
  ctx.render();
  try {
    const { reply: plan } = await consult(ctx, shapePrompt(store.doc(), today, text), (data) => parseShape(data, today));
    store.addPlan({
      goal: { title: plan.title, targetDate: plan.targetDate, why: plan.why },
      milestones: plan.milestones,
      habits: plan.habits,
      targets: plan.targets,
    });
    c.shapeOpen = false;
    c.shapeText = '';
  } catch (e) {
    c.shapeError = e.message;
  } finally {
    c.shapeBusy = false;
    ctx.render();
  }
}

// The inline box under the Goals heading, or null while it's closed.
export function renderShapeBox(ctx) {
  const c = ctx.ui.coach;
  if (!c.shapeOpen) return null;
  const shape = () => shapeGoal(ctx, c.shapeText);
  const box = h('textarea', {
    rows: 3, placeholder: 'What do you want to achieve?', 'aria-label': 'What do you want to achieve?',
    'data-focus': 'coach-shape',
  });
  box.value = c.shapeText;
  box.addEventListener('input', () => { c.shapeText = box.value; });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); shape(); }
  });
  return h('form', { class: 'shape', onsubmit: (e) => { e.preventDefault(); shape(); } },
    box,
    h('div', { class: 'buttons' },
      h('button', { class: 'btn primary', type: 'submit', disabled: c.shapeBusy }, c.shapeBusy ? 'Shaping…' : 'Shape'),
      link('Cancel', () => { c.shapeOpen = false; c.shapeError = ''; ctx.render(); })),
    c.shapeError ? h('p', { class: 'error', role: 'status' }, c.shapeError) : null);
}
