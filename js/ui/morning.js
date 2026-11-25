// Start the day (js/morning.js): a card at the top of Today until the morning is done, opening one
// sheet: the back, yesterday's ticks, yesterday's food in one go, a line for Claude, Done. The
// morning push (js/nudges.js) and the home-screen shortcut open the sheet straight away.

import { h } from './dom.js';
import { morningModel, morningDue, morningLine, saveSplitMeals, finishMorning, firstMissingSlot, claudeMorningUrl } from '../morning.js';
import { BACK } from '../coach.js';
import { closeLine, closedLine } from '../close.js';
import { DAY_SPLIT_SYSTEM, daySplitPrompt, parseDaySplit, liveBatches, usualMeals, slotName, MEAL_MODELS, MEAL_TEMPERATURE, SPLIT_DEFAULT_TIMES } from '../food.js';
import { mealWords } from './fuel.js';
import { doingNow } from '../calendar.js';
import { shortWeekday } from '../dates.js';
import { micButton, stopListening, grow } from './mic.js';

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const hhmm = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

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

// Kept between paints and closes of the sheet (a draft survives a re-render), cleared on a new day.
const draft = { day: null, note: '', said: '', rows: null, busy: false, error: '' };

export function openMorning(ctx) {
  const dlg = document.getElementById('morning');
  if (!dlg) return;
  const today = ctx.store.today();
  if (draft.day !== today) Object.assign(draft, { day: today, note: '', said: '', rows: null, busy: false, error: '' });
  const done = () => { stopListening(); dlg.close(); ctx.render(); };

  const back = (score) => {
    try {
      ctx.store.setBack(today, score);
      ctx.store.soreFlag(today);
    } catch (e) { draft.error = e.message; }
    paint();
  };

  async function split() {
    const doc = ctx.store.doc();
    const m = morningModel(doc, today);
    const text = draft.said.trim();
    if (!text) return;
    draft.busy = true;
    draft.error = '';
    paint();
    try {
      const pots = liveBatches(doc, today);
      const { data } = await ctx.gemini.ask({
        system: DAY_SPLIT_SYSTEM,
        prompt: daySplitPrompt({ text, day: m.yesterday, logged: m.meals, batches: pots }),
        models: MEAL_MODELS, temperature: MEAL_TEMPERATURE,
      });
      draft.rows = [...(draft.rows ?? []), ...parseDaySplit(data, { batches: pots })];
      draft.said = '';
    } catch (e) {
      draft.error = `${e.message}. Your words are kept: try again, or log them as one meal.`;
    }
    draft.busy = false;
    paint();
  }

  function oneMeal() {
    draft.rows = [...(draft.rows ?? []), { slot: 'lunch', time: SPLIT_DEFAULT_TIMES.lunch, text: draft.said.trim(), batchId: null, share: null }];
    draft.said = '';
    draft.error = '';
    paint();
  }

  // Whether they saved: a row that can't be (no time, a usual meal or pot gone) saves none of them.
  function saveMeals() {
    const m = morningModel(ctx.store.doc(), today);
    let ok = true;
    try {
      saveSplitMeals(ctx.store, m.yesterday, draft.rows ?? [], ctx.store.settings().dayStartHour);
      draft.rows = null;
      draft.error = '';
    } catch (e) {
      draft.error = e.message;
      ok = false;
    }
    paint();
    return ok;
  }

  function finish() {
    stopListening();
    try {
      // Words split but not saved yet go in with Done, so nothing he checked is lost.
      if (draft.rows?.length && !saveMeals()) return;
      finishMorning(ctx.store, { today, note: draft.note, at: new Date(), flagState: ctx.flagState(), doing: doingNow(ctx.store.doc(), today, new Date()) });
    } catch (e) {
      draft.error = e.message;
      paint();
      return;
    }
    Object.assign(draft, { note: '', said: '', rows: null, error: '' });
    done();
  }

  const box = (key, label, placeholder, get, set) => {
    const el = h('textarea', { rows: 2, maxlength: 2000, 'data-focus': key, 'aria-label': label, placeholder, oninput: (e) => { set(e.target.value); grow(e.target); } });
    el.value = get();
    queueMicrotask(() => grow(el));
    return h('div', { class: 'checkin-box' }, el, micButton({
      key, hint: key === 'morning-food' ? 'day' : 'note', getText: get,
      setText: (text) => {
        set(text);
        const live = dlg.querySelector(`[data-focus="${key}"]`) ?? el;
        live.value = text;
        grow(live);
      },
      onBlocked: (message) => { draft.error = message; },
      render: paint,
    }));
  };

  const splitRow = (r, i) => {
    const change = (k) => (e) => { draft.rows[i] = { ...draft.rows[i], [k]: e.target.value }; };
    const slot = h('select', { 'aria-label': 'Which meal', onchange: change('slot') }, SLOTS.map((s) => h('option', { value: s }, slotName(s))));
    slot.value = r.slot;
    const time = h('input', { type: 'time', value: r.time, 'aria-label': 'When', onchange: change('time') });
    const words = h('input', { type: 'text', value: r.text, 'aria-label': 'What you ate', maxlength: 500, oninput: change('text'), disabled: !!r.usualId || !!r.batchId });
    return h('li', { class: 'morning-split-row' }, slot, time, words,
      h('button', { class: 'link', type: 'button', 'aria-label': `Leave out ${r.text}`, onclick: () => { draft.rows.splice(i, 1); if (!draft.rows.length) draft.rows = null; paint(); } }, '✕'));
  };

  function paint() {
    const doc = ctx.store.doc();
    const m = morningModel(doc, today);
    const day = shortWeekday(m.yesterday);
    const usual = usualMeals(doc).slice(0, 6);
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
        m.meals.length ? h('ul', { class: 'morning-meals' }, m.meals.map((meal) => h('li', {}, h('strong', {}, `${slotName(meal.slot)} ${hhmm(meal.at)}`), ` ${meal.estimate?.name ?? meal.text ?? ''} · ${mealWords(meal)}`))) : null,
        draft.rows ? [h('p', { class: 'muted close-hint' }, 'Check the split, then save. The numbers follow in a minute.'),
          h('ul', { class: 'morning-split' }, draft.rows.map(splitRow)),
          h('div', { class: 'close-actions' }, h('button', { class: 'dl-btn primary', type: 'button', 'data-use': 'morning-save-meals', onclick: saveMeals }, `Save ${draft.rows.length} meal${draft.rows.length === 1 ? '' : 's'}`))] : null,
        box('morning-food', `What you ate on ${day}`, 'Everything, in one go: "eggs and two pittas, then a quarter of the chilli, pasta for dinner, a shake"', () => draft.said, (v) => { draft.said = v; }),
        usual.length ? h('div', { class: 'morning-usual' }, usual.map((u) => h('button', { class: 'dl-btn', type: 'button', onclick: () => {
          const slot = firstMissingSlot(m.meals, draft.rows ?? []);
          draft.rows = [...(draft.rows ?? []), { slot, time: SPLIT_DEFAULT_TIMES[slot], text: u.name, usualId: u.id, batchId: null, share: null }];
          paint();
        } }, u.name))) : null,
        h('div', { class: 'close-actions' },
          h('button', { class: 'dl-btn', type: 'button', 'data-use': 'morning-split', disabled: draft.busy, onclick: split }, draft.busy ? 'Splitting…' : 'Split into meals'),
          draft.error && draft.said.trim() ? h('button', { class: 'link', type: 'button', onclick: oneMeal }, 'Log as one meal') : null)),

      h('section', {}, h('h3', {}, 'A line for Claude'),
        box('morning-note', 'A line for Claude', 'Anything Claude should know? What got in the way, what to change…', () => draft.note, (v) => { draft.note = v; })),

      draft.error ? h('p', { class: 'error', role: 'alert' }, draft.error) : null,
      h('div', { class: 'close-actions morning-actions' },
        h('a', { class: 'link', href: claudeMorningUrl(), target: '_blank', rel: 'noopener', 'data-use': 'morning-claude' }, 'Talk it through with Claude'),
        h('button', { class: 'dl-btn primary', type: 'button', 'data-use': 'morning-finish', onclick: finish }, 'Done'))));
  }
  paint();
  if (!dlg.open) dlg.showModal();
}
