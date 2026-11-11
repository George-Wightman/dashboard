// Close the day (js/close.js): a card at the top of Today from the evening on (and on any past day
// not closed yet), opening one sheet: tick what happened, log a meal, leave Claude a line, close.
// The line is a For Claude note like any other (js/ui/note.js), so the catch-up shows it first.

import { h } from './dom.js';
import { closeModel, closeDue, closeLine, closedLine, closedId, closedRecord } from '../close.js';
import { doingNow } from '../calendar.js';
import { longDate } from '../dates.js';
import { micButton, stopListening, grow } from './mic.js';
import { openSnap } from './snap.js';
import { shownDay } from '../timeline.js';

const dayOf = (ctx) => shownDay(ctx.ui.viewDay, ctx.store.today());

// The card, or the closed day's line; null when it isn't time.
export function renderCloseCard(ctx) {
  const doc = ctx.store.doc();
  const day = dayOf(ctx);
  const model = closeModel(doc, day);
  if (closedRecord(doc, day)) return h('p', { class: 'close-done', role: 'status' }, closedLine(model));
  if (!closeDue(doc, day, ctx.store.today(), new Date())) return null;
  return h('div', { class: 'close-card' },
    h('div', { class: 'close-words' }, h('strong', {}, day === ctx.store.today() ? 'Close the day' : 'Close this day'), h('span', { class: 'muted' }, closeLine(model))),
    h('button', { class: 'dl-btn primary', type: 'button', 'data-use': 'close-open', onclick: () => openClose(ctx) }, 'Close it'));
}

export function openClose(ctx) {
  const dlg = document.getElementById('close-day');
  if (!dlg) return;
  const day = dayOf(ctx);
  const state = { note: '', error: '' };
  const done = () => { stopListening(); dlg.close(); };

  const finish = () => {
    stopListening();
    const now = new Date();
    try {
      const text = state.note.trim();
      if (text) ctx.store.addFlag(`Closing ${longDate(day)}: ${text}`, ctx.flagState(), 'me', 'claude', { doing: doingNow(ctx.store.doc(), ctx.store.today(), now) });
      ctx.store.putCalendar(closedId(day), { day, closed: true, at: now.toISOString() }, 'me');
    } catch (e) {
      state.error = e.message;
      paint();
      return;
    }
    dlg.close();
    ctx.render();
  };

  function paint() {
    const model = closeModel(ctx.store.doc(), day);
    const box = h('textarea', {
      rows: 2, maxlength: 2000, 'data-focus': 'close-note', 'aria-label': 'A line for Claude about today',
      placeholder: 'Anything Claude should know about today? What got in the way, what to change…',
      oninput: (e) => { state.note = e.target.value; grow(e.target); },
    });
    box.value = state.note;
    queueMicrotask(() => grow(box));
    const row = (r) => {
      const id = `close-${r.item.id}`;
      return h('li', { class: 'close-row' },
        h('input', { type: 'checkbox', id, 'data-use': 'close-tick', onchange: () => { ctx.store.toggleDone(r.item.id, day); paint(); } }),
        h('label', { for: id }, r.item.title));
    };
    dlg.replaceChildren(h('div', { class: 'sheet-body' },
      h('div', { class: 'sheet-head' }, h('h2', {}, `Close ${day === ctx.store.today() ? 'today' : longDate(day)}`),
        h('button', { class: 'link sheet-close', type: 'button', 'aria-label': 'Close', onclick: done }, '✕')),
      h('p', { class: 'close-sum' }, closeLine(model)),
      model.tickable.length
        ? h('section', {}, h('h3', {}, 'Still open: tick what happened'), h('ul', { class: 'close-list' }, model.tickable.map(row)),
          h('p', { class: 'muted close-hint' }, 'What stays unticked counts as not done.'))
        : h('p', { class: 'close-all' }, model.total ? 'Everything is ticked.' : 'Nothing was on this day.'),
      h('section', { class: 'close-meals' }, h('h3', {}, 'Meals'),
        h('span', {}, `${model.meals} logged${model.mainMeals < 3 ? `, ${3 - model.mainMeals} of breakfast, lunch and dinner missing` : ''}`),
        h('button', { class: 'dl-btn', type: 'button', 'data-use': 'close-meal', onclick: () => { done(); openSnap(ctx); } }, 'Log a meal')),
      h('section', {}, h('h3', {}, 'A line for Claude'),
        h('div', { class: 'checkin-box' }, box, micButton({
          key: 'close-note',
          hint: 'note',
          getText: () => state.note,
          setText: (text) => {
            state.note = text;
            const live = dlg.querySelector('[data-focus="close-note"]') ?? box;
            live.value = text;
            grow(live);
          },
          onBlocked: (message) => { state.error = message; },
          render: paint,
        }))),
      state.error ? h('p', { class: 'error', role: 'alert' }, state.error) : null,
      h('div', { class: 'close-actions' },
        h('button', { class: 'dl-btn primary', type: 'button', 'data-use': 'close-finish', onclick: finish }, 'Close the day'))));
  }
  paint();
  if (!dlg.open) dlg.showModal();
}
