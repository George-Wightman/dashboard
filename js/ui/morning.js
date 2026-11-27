// Start the day (js/morning.js): a card at the top of Today until the morning is done, opening one
// sheet: the back, yesterday's ticks, yesterday's food as taps, a line for Claude, Done. The morning
// push (js/nudges.js) and the home-screen shortcut open the sheet straight away.
//
// Food (27 Nov 2026): a row each for breakfast, lunch, dinner and a snack. A row offers his usual
// meals for it (js/food.js rowUsuals) and, at lunch and dinner, shares of the pots in the fridge;
// "something else" takes one meal in words (dictated with the phone's own keyboard) for Gemini to
// estimate. "I cooked a pot" turns an ingredient list into a pot in the fridge. Nothing is split.

import { h, grow } from './dom.js';
import { morningModel, morningDue, morningLine, finishMorning, claudeMorningUrl, logTap, usualFromMeal, savePot } from '../morning.js';
import { BACK } from '../coach.js';
import { closeLine, closedLine } from '../close.js';
import { rowUsuals, rowPots, potShares, shareWords, slotName, POT_SYSTEM, potPrompt, parsePot, MEAL_MODELS, MEAL_TEMPERATURE } from '../food.js';
import { mealWords } from './fuel.js';
import { doingNow } from '../calendar.js';
import { shortWeekday } from '../dates.js';

const ROWS = ['breakfast', 'lunch', 'dinner', 'snack'];
const SHARE_LABELS = { 0.167: '⅙', 0.2: '⅕', 0.25: '¼', 0.333: '⅓', 0.5: '½' };

// The card on Today (today only): the question until done, then the morning's one line.
export function renderMorningCard(ctx) {
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const model = morningModel(doc, today);
  if (!morningDue(doc, today)) return h('p', { class: 'close-done morning-done', role: 'status' }, morningLine(model));
  const parts = [model.back ? `back ${model.back.word}` : 'back to answer', model.close.closed ? `${shortWeekday(model.yesterday)} closed` : `${shortWeekday(model.yesterday)}: ${closeLine(model.close)}`];
  return h('div', { class: 'close-card morning-card' },
    h('div', { class: 'close-words' }, h('strong', {}, 'Start the day'), h('span', { class: 'muted' }, parts.join(' · '))),
    h('button', { class: 'dl-btn primary', type: 'button', 'data-use': 'morning-open', onclick: () => openMorning(ctx) }, 'Start'));
}

// Kept between paints and closes of the sheet, and cleared on a new day: the line for Claude, which
// row's "something else" box is open and what's in it, rows opened for more, and the pot being made.
const fresh = (day) => ({ day, note: '', other: null, words: '', more: new Set(), pot: { open: false, text: '', busy: false, result: null, name: '' }, error: '' });
let draft = fresh(null);

export function openMorning(ctx) {
  const dlg = document.getElementById('morning');
  if (!dlg) return;
  const today = ctx.store.today();
  if (draft.day !== today) draft = fresh(today);
  const done = () => { dlg.close(); ctx.render(); };
  const startHour = () => ctx.store.settings().dayStartHour;

  const act = (fn) => {
    try {
      fn();
      draft.error = '';
    } catch (e) { draft.error = e.message; }
    paint();
  };

  const back = (score) => act(() => { ctx.store.setBack(today, score); ctx.store.soreFlag(today); });

  const tap = (slot, what) => act(() => {
    logTap(ctx.store, { day: morningModel(ctx.store.doc(), today).yesterday, slot, ...what }, startHour());
    draft.more.delete(slot);
  });

  function logWords(slot) {
    if (!draft.words.trim()) return;
    act(() => {
      logTap(ctx.store, { day: morningModel(ctx.store.doc(), today).yesterday, slot, text: draft.words }, startHour());
      draft.other = null;
      draft.words = '';
      draft.more.delete(slot);
    });
    ctx.mealPass?.().then(() => { if (dlg.open) paint(); });
  }

  async function workOutPot() {
    const p = draft.pot;
    if (!p.text.trim()) return;
    p.busy = true;
    draft.error = '';
    paint();
    try {
      const { data } = await ctx.gemini.ask({ system: POT_SYSTEM, prompt: potPrompt({ text: p.text }), models: MEAL_MODELS, temperature: MEAL_TEMPERATURE });
      p.result = parsePot(data);
      p.name = p.result.name;
    } catch (e) {
      draft.error = `${e.message}. Your list is kept: try again, or tell Claude.`;
    }
    p.busy = false;
    paint();
  }

  const keepPot = () => act(() => {
    const p = draft.pot;
    const name = p.name.trim() || p.result.name;
    savePot(ctx.store, { text: p.text, pot: { ...p.result, name }, cookedOn: morningModel(ctx.store.doc(), today).yesterday });
    draft.pot = fresh(today).pot;
  });

  function finish() {
    try {
      finishMorning(ctx.store, { today, note: draft.note, at: new Date(), flagState: ctx.flagState(), doing: doingNow(ctx.store.doc(), today, new Date()) });
    } catch (e) {
      draft.error = e.message;
      paint();
      return;
    }
    draft = fresh(today);
    done();
  }

  // A box for words. Dictation is the phone's own keyboard (Gboard, Wispr Flow): no mic of our own.
  const box = (key, label, placeholder, get, set, rows = 2, max = 2000) => {
    const el = h('textarea', { rows, maxlength: max, 'data-focus': key, 'aria-label': label, placeholder, oninput: (e) => { set(e.target.value); grow(e.target); } });
    el.value = get();
    queueMicrotask(() => grow(el));
    return el;
  };

  // A meal logged for yesterday: what it is, its numbers when there, ☆ to keep it as a usual, ✕.
  const loggedMeal = (meal) => h('li', { class: 'morning-logged' },
    h('span', { class: 'morning-logged-words' }, h('strong', {}, meal.estimate?.name ?? meal.text ?? slotName(meal.slot)), h('span', { class: 'muted' }, mealWords(meal))),
    !meal.usualId && !meal.batchId && meal.final ? h('button', { class: 'link', type: 'button', title: 'Keep as a usual for this meal', 'aria-label': `Keep ${meal.estimate?.name ?? meal.text} as a usual`, 'data-use': 'morning-make-usual', onclick: () => act(() => usualFromMeal(ctx.store, meal.id)) }, '☆ usual') : null,
    h('button', { class: 'link', type: 'button', 'aria-label': `Take off ${meal.estimate?.name ?? meal.text}`, 'data-use': 'morning-unlog', onclick: () => act(() => ctx.store.archiveMeal(meal.id)) }, '✕'));

  function choices(doc, slot) {
    const usuals = rowUsuals(doc, slot, today);
    const pots = rowPots(doc, slot, today);
    const other = draft.other === slot;
    return [
      h('div', { class: 'morning-chips' },
        usuals.map((u) => h('button', { class: 'dl-btn', type: 'button', 'data-use': 'morning-usual', onclick: () => tap(slot, { usualId: u.id }) }, u.name)),
        other ? null : h('button', { class: 'dl-btn ghost', type: 'button', 'data-use': 'morning-other', onclick: () => { draft.other = slot; draft.words = ''; paint(); dlg.querySelector('[data-focus="morning-words"]')?.focus(); } }, 'something else')),
      pots.map((b) => h('div', { class: 'morning-pot' }, h('span', {}, b.name),
        h('span', { class: 'morning-shares', role: 'group', 'aria-label': `How much of the ${b.name}` },
          potShares(doc, b.id).map((s) => h('button', { class: 'dl-btn', type: 'button', 'data-use': 'morning-share', title: `${shareWords(s)} of the pot`, 'aria-label': `${shareWords(s)} of the ${b.name}`, onclick: () => tap(slot, { batchId: b.id, share: s }) }, SHARE_LABELS[s]))))),
      other ? h('div', { class: 'morning-other' },
        box('morning-words', `What you had for ${slotName(slot).toLowerCase()}`, 'One meal, with amounts: "4 eggs on 2 slices of toast with Philadelphia, half a cucumber"', () => draft.words, (v) => { draft.words = v; }),
        h('div', { class: 'close-actions' },
          h('button', { class: 'link', type: 'button', onclick: () => { draft.other = null; paint(); } }, 'Cancel'),
          h('button', { class: 'dl-btn primary', type: 'button', 'data-use': 'morning-log-words', onclick: () => logWords(slot) }, 'Log it'))) : null,
    ];
  }

  function row(doc, m, slot) {
    const logged = m.meals.filter((meal) => meal.slot === slot);
    const open = !logged.length || draft.more.has(slot) || draft.other === slot;
    if (slot === 'snack' && !logged.length && !draft.more.has('snack') && draft.other !== 'snack') {
      return h('div', { class: 'morning-row' }, h('button', { class: 'link', type: 'button', 'data-use': 'morning-snack', onclick: () => { draft.more.add('snack'); paint(); } }, '+ a snack'));
    }
    return h('div', { class: 'morning-row' }, h('h4', {}, slotName(slot)),
      logged.length ? h('ul', { class: 'morning-meals' }, logged.map(loggedMeal)) : null,
      open ? choices(doc, slot) : h('button', { class: 'link', type: 'button', onclick: () => { draft.more.add(slot); paint(); } }, '+ more'));
  }

  function potSection() {
    const p = draft.pot;
    if (!p.open) return h('button', { class: 'link', type: 'button', 'data-use': 'morning-pot-open', onclick: () => { p.open = true; paint(); } }, '+ I cooked a pot');
    if (p.result) {
      const r = p.result;
      return h('div', { class: 'morning-potmake' }, h('h4', {}, 'Into the fridge'),
        h('input', { type: 'text', value: p.name, maxlength: 60, 'aria-label': 'What to call it', oninput: (e) => { p.name = e.target.value; } }),
        h('ul', { class: 'morning-meals' }, r.items.map((i) => h('li', {}, `${i.qty} ${i.unit} ${i.name}`.trim(), h('span', { class: 'muted' }, ` · ${i.protein} g protein, ${i.kcal.toLocaleString('en-GB')} kcal`)))),
        h('p', { class: 'close-hint' }, h('strong', {}, `The whole pot: ${r.protein} g protein, ${r.kcal.toLocaleString('en-GB')} kcal`)),
        h('div', { class: 'close-actions' },
          h('button', { class: 'link', type: 'button', onclick: () => { p.result = null; paint(); } }, 'Change the list'),
          h('button', { class: 'dl-btn primary', type: 'button', 'data-use': 'morning-pot-save', onclick: keepPot }, 'Put it in the fridge')));
    }
    return h('div', { class: 'morning-potmake' }, h('h4', {}, 'What went in the pot'),
      box('morning-pot', 'What went in the pot', 'Everything, with amounts: "6 raw chicken breasts, 500 g dry rice, 2 tins chopped tomatoes, 2 onions, a tablespoon of oil"', () => p.text, (v) => { p.text = v; }, 3, 500),
      h('div', { class: 'close-actions' },
        h('button', { class: 'link', type: 'button', onclick: () => { draft.pot = fresh(today).pot; paint(); } }, 'Cancel'),
        h('button', { class: 'dl-btn primary', type: 'button', 'data-use': 'morning-pot-work', disabled: p.busy, onclick: workOutPot }, p.busy ? 'Working it out…' : 'Work it out')));
  }

  function paint() {
    const doc = ctx.store.doc();
    const m = morningModel(doc, today);
    const day = shortWeekday(m.yesterday);
    const tick = (r) => {
      const id = `morning-${r.item.id}`;
      return h('li', { class: 'close-row' },
        h('input', { type: 'checkbox', id, 'data-use': 'morning-tick', onchange: () => { ctx.store.toggleDone(r.item.id, m.yesterday); paint(); } }),
        h('label', { for: id }, r.item.title));
    };
    dlg.replaceChildren(h('div', { class: 'sheet-body' },
      h('div', { class: 'sheet-head' }, h('h2', {}, 'Start the day'),
        h('button', { class: 'link sheet-close', type: 'button', 'aria-label': 'Close', onclick: done }, '✕')),

      h('section', {}, h('h3', { id: 'morning-back' }, "How's your back?"),
        h('span', { class: 'tl-back-answers', role: 'group', 'aria-labelledby': 'morning-back' },
          BACK.map((word, score) => h('button', { class: `dl-btn back-${score}`, type: 'button', 'aria-pressed': m.back?.score === score ? 'true' : 'false', onclick: () => back(score) }, word)))),

      h('section', {}, h('h3', {}, `${day}: tick what happened`),
        m.close.closed ? h('p', { class: 'close-all' }, closedLine(m.close))
          : m.close.tickable.length ? [h('ul', { class: 'close-list' }, m.close.tickable.map(tick)), h('p', { class: 'muted close-hint' }, 'What stays unticked counts as not done.')]
          : h('p', { class: 'close-all' }, m.close.total ? 'Everything is ticked.' : 'Nothing was on that day.')),

      h('section', { class: 'morning-food' }, h('h3', {}, `${day}: what did you eat?`),
        ROWS.map((slot) => row(doc, m, slot)),
        potSection()),

      h('section', {}, h('h3', {}, 'A line for Claude'),
        box('morning-note', 'A line for Claude', 'Anything Claude should know? What got in the way, what to change…', () => draft.note, (v) => { draft.note = v; })),

      draft.error ? h('p', { class: 'error', role: 'alert' }, draft.error) : null,
      h('div', { class: 'close-actions morning-actions' },
        h('a', { class: 'link', href: claudeMorningUrl(), target: '_blank', rel: 'noopener', 'data-use': 'morning-claude' }, 'Tell Claude instead'),
        h('button', { class: 'dl-btn primary', type: 'button', 'data-use': 'morning-finish', onclick: finish }, 'Done'))));
  }
  paint();
  if (!dlg.open) dlg.showModal();
}
