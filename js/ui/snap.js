// Logging a meal (#snap): say or type what you had and how much, or log a usual meal in one tap. A
// photo is optional, for what the food is; the words carry the amounts. The meal pass asks Gemini,
// and the estimate comes back here: protein (the number that matters) and calories, item by item
// with a count to change (5 eggs, not 4), and "Save as a usual meal". Any meal can be opened again
// (openMeal) to change its counts, its words (estimated again) or when it was eaten, or to remove it.
// The sheet's state is ctx.ui.snap; js/app.js's render repaints it, so the estimate appears when the
// meal pass writes it.

import { h } from './dom.js';
import { usualMeals, slotFor, slotName, finalFor, dayProtein, fuelSettings, snapTime, mealValue, withQty, nextQty, itemsTotal, PORTIONS } from '../food.js';
import { clockLabel } from '../calendar.js';
import { shrink, localPhotos, keepPhoto } from '../photos.js';
import { micButton, stopListening, grow } from './mic.js';

const BIG = 768;
const SMALL = 480;
const PORTION_LABELS = { lighter: 'lighter', right: 'about right', bigger: 'bigger' };
const pad = (n) => String(n).padStart(2, '0');

// `marker` ({ slot, start }) when opened from a breakfast, lunch or dinner marker on the timeline.
export function openSnap(ctx, marker = null) {
  show(ctx, { step: 'pick', text: '', mealId: null, preview: null, usual: false, error: '', marker, fresh: true });
}

// A meal already logged, opened again from Fuel.
export function openMeal(ctx, mealId) {
  const meal = ctx.store.doc().meals?.[mealId];
  if (!meal) return;
  show(ctx, { step: 'result', text: meal.text ?? '', mealId, preview: null, usual: false, error: '', marker: null, fresh: false });
  localPhotos.get(mealId).then((p) => {
    if (p?.small && ctx.ui.snap?.mealId === mealId) { ctx.ui.snap.preview = `data:image/jpeg;base64,${p.small}`; paintSnap(ctx); }
  });
}

function show(ctx, state) {
  const dlg = document.getElementById('snap');
  if (!dlg) return;
  ctx.ui.snap = state;
  // Only this sheet's own closing clears it: a close still on its way from the last one mustn't
  // leave this one open but never repainted.
  dlg.onclose = () => { stopListening(); if (ctx.ui.snap === state) ctx.ui.snap = null; };
  paintSnap(ctx);
  if (!dlg.open) dlg.showModal();
}

const close = () => document.getElementById('snap')?.close();

async function takePhoto(ctx, file) {
  const s = ctx.ui.snap;
  if (!file || !s) return;
  stopListening();
  Object.assign(s, { step: 'working', error: '' });
  paintSnap(ctx);
  let big;
  let small;
  try {
    [big, small] = [await shrink(file, BIG, 0.75), await shrink(file, SMALL, 0.7)];
  } catch {
    Object.assign(s, { step: 'pick', error: 'That photo couldn’t be read. Try another, or just the words.' });
    paintSnap(ctx);
    return;
  }
  const meal = ctx.store.addMeal({ at: snapTime(new Date(), s.marker), text: s.text, hasPhoto: true });
  const kept = await keepPhoto(ctx.store, localPhotos, meal.id, { big: big.base64, small: small.base64 });
  Object.assign(s, { mealId: meal.id, preview: `data:image/jpeg;base64,${small.base64}`,
    error: kept ? '' : 'The photo couldn’t be kept on this device, so it’ll be estimated from your words.' });
  paintSnap(ctx);
  await ctx.mealPass();
  if (ctx.ui.snap === s) { s.step = 'result'; paintSnap(ctx); }
}

async function justWords(ctx) {
  const s = ctx.ui.snap;
  if (!s?.text.trim()) return;
  stopListening();
  const meal = ctx.store.addMeal({ at: snapTime(new Date(), s.marker), text: s.text, hasPhoto: false });
  Object.assign(s, { step: 'working', mealId: meal.id });
  paintSnap(ctx);
  await ctx.mealPass();
  if (ctx.ui.snap === s) { s.step = 'result'; paintSnap(ctx); }
}

// New words for a logged meal: estimated again, and the sheet waits for it.
async function estimateAgain(ctx) {
  const s = ctx.ui.snap;
  if (!s?.mealId || !s.text.trim()) return;
  stopListening();
  try {
    ctx.store.redoMeal(s.mealId, s.text);
  } catch (e) {
    s.error = e.message;
    paintSnap(ctx);
    return;
  }
  Object.assign(s, { step: 'working', error: '' });
  paintSnap(ctx);
  await ctx.mealPass();
  if (ctx.ui.snap === s) { s.step = 'result'; paintSnap(ctx); }
}

function logUsual(ctx, usual) {
  stopListening();
  const meal = ctx.store.addMeal({ at: snapTime(new Date(), ctx.ui.snap.marker), usualId: usual.id });
  Object.assign(ctx.ui.snap, { step: 'result', mealId: meal.id });
  paintSnap(ctx);
}

function fileButton(ctx, label, capture) {
  const input = h('input', { type: 'file', accept: 'image/*', class: 'snap-file', ...(capture ? { capture: 'environment' } : {}),
    onchange: (e) => takePhoto(ctx, e.target.files?.[0]) });
  return h('label', { class: 'dl-btn' }, input, label);
}

// The words box, with the mic: on a new meal and on one opened again.
function wordsBox(ctx, { placeholder, onChange }) {
  const s = ctx.ui.snap;
  const box = h('textarea', {
    rows: 3, maxlength: 400, 'data-focus': 'snap-text', 'aria-label': 'What you had, and how much', placeholder,
    oninput: (e) => { s.text = e.target.value; grow(e.target); onChange(); },
  });
  box.value = s.text;
  return h('div', { class: 'snap-line' }, box, micButton({
    key: 'snap-text',
    hint: 'meal',
    getText: () => s.text,
    setText: (text) => { s.text = text; const live = document.querySelector('[data-focus="snap-text"]') ?? box; live.value = text; grow(live); onChange(); },
    onBlocked: (message) => { s.error = message; },
    render: () => paintSnap(ctx),
  }));
}

function pickStep(ctx) {
  const s = ctx.ui.snap;
  const now = snapTime(new Date(), s.marker);
  const logButton = h('button', { class: 'dl-btn primary', type: 'button', disabled: !s.text.trim(), onclick: () => justWords(ctx) }, 'Log it');
  const usual = usualMeals(ctx.store.doc()).slice(0, 6);
  return [
    h('p', { class: 'snap-when' }, `${slotName(slotFor(now))} · ${pad(now.getHours())}:${pad(now.getMinutes())}`),
    wordsBox(ctx, { placeholder: 'What did you have, and how much? “5 fried eggs, 2 pittas, a slice of cheddar”', onChange: () => { logButton.disabled = !s.text.trim(); } }),
    s.error ? h('p', { class: 'error', role: 'alert' }, s.error) : null,
    h('div', { class: 'snap-actions' }, logButton),
    usual.length ? h('div', { class: 'snap-usual', role: 'group', 'aria-label': 'Usual meals' },
      usual.map((u) => h('button', { class: 'dl-btn', type: 'button', title: `${u.protein} g protein · ${u.kcal} kcal`, onclick: () => logUsual(ctx, u) }, `★ ${u.name}`))) : null,
    h('div', { class: 'snap-photo', role: 'group', 'aria-label': 'Add a photo' },
      h('span', { class: 'muted' }, 'Add a photo, if it helps:'), fileButton(ctx, 'Take one', true), fileButton(ctx, 'Choose one', false)),
  ];
}

function workingStep(ctx) {
  const s = ctx.ui.snap;
  const meal = s.mealId ? ctx.store.doc().meals[s.mealId] : null;
  return [
    s.preview ? h('img', { class: 'snap-preview', src: s.preview, alt: 'Your meal' }) : null,
    h('div', { class: 'snap-working', role: 'status' }, h('span', { class: 'snap-spinner', 'aria-hidden': 'true' }),
      h('strong', {}, `Working out your ${slotName(meal?.slot ?? slotFor(new Date())).toLowerCase()}…`)),
    h('p', { class: 'muted' }, 'Usually a few seconds. You can close this: it finishes on its own, and waits for signal if you’re offline.'),
    h('div', { class: 'snap-actions' }, h('button', { class: 'dl-btn', type: 'button', onclick: close }, 'Close')),
  ];
}

// "2026-10-20T08:05" in this device's time, for a datetime-local input.
function localStamp(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function qtyText(q) {
  const whole = Math.floor(q);
  if (q - whole !== 0.5) return String(q);
  return whole ? `${whole}½` : '½';
}

// The items with a count each. A change saves at once, and the meal counts the new total.
function itemRows(ctx, meal, items) {
  const set = (i, qty) => {
    const next = items.map((it, j) => (j === i ? withQty(it, qty) : it));
    ctx.store.updateMeal(meal.id, { items: next, final: itemsTotal(next), correction: null });
  };
  return h('ul', { class: 'snap-items editable' }, items.map((it, i) => h('li', { class: it.qty === 0 ? 'none' : '' },
    h('span', { class: 'snap-item-name' }, it.name),
    h('span', { class: 'snap-qty', role: 'group', 'aria-label': `How many: ${it.name}` },
      h('button', { class: 'snap-step', type: 'button', 'aria-label': `Fewer: ${it.name}`, disabled: it.qty <= 0, onclick: () => set(i, nextQty(it, -1)) }, '−'),
      h('span', { class: 'snap-count' }, `${qtyText(it.qty)}${it.unit ? ` ${it.unit}` : ''}`),
      h('button', { class: 'snap-step', type: 'button', 'aria-label': `More: ${it.name}`, onclick: () => set(i, nextQty(it, 1)) }, '+')),
    h('span', { class: 'muted snap-item-nums' }, `${it.protein} g · ${it.kcal} kcal`))));
}

function resultStep(ctx) {
  const s = ctx.ui.snap;
  const doc = ctx.store.doc();
  const meal = doc.meals[s.mealId];
  if (!meal || meal.status === 'archived') return [h('p', {}, 'That meal has gone.'), h('div', { class: 'snap-actions' }, h('button', { class: 'dl-btn', type: 'button', onclick: close }, 'Close'))];
  const today = ctx.store.today();
  const { protein: target } = fuelSettings(doc);
  const remove = h('button', { class: 'link', type: 'button', onclick: () => { ctx.store.archiveMeal(meal.id); close(); } }, 'Remove this meal');
  const when = h('label', { class: 'snap-at' }, h('span', { class: 'muted' }, 'Eaten'), h('input', {
    type: 'datetime-local', value: localStamp(meal.at),
    onchange: (e) => { if (e.target.value) { try { ctx.store.retimeMeal(meal.id, new Date(e.target.value)); } catch { /* left as it was */ } } },
  }));
  const againButton = h('button', { class: 'dl-btn', type: 'button', disabled: !s.text.trim() || s.text.trim() === (meal.text ?? '').trim(), onclick: () => estimateAgain(ctx) }, 'Estimate again');
  const words = [
    wordsBox(ctx, { placeholder: 'What you had, and how much', onChange: () => { againButton.disabled = !s.text.trim() || s.text.trim() === (meal.text ?? '').trim(); } }),
    h('div', { class: 'snap-actions' }, againButton),
  ];
  if (meal.state !== 'estimated') {
    const said = meal.state === 'failed'
      ? `Couldn’t estimate it${meal.error ? ` (${meal.error})` : ''}. It’s kept, and will be tried again.`
      : 'Saved. It’ll be estimated as soon as Gemini can be reached.';
    return [s.preview ? h('img', { class: 'snap-preview small', src: s.preview, alt: 'Your meal' }) : null, h('p', {}, said), ...words, when,
      s.error ? h('p', { class: 'error', role: 'alert' }, s.error) : null,
      h('div', { class: 'snap-actions' }, h('button', { class: 'dl-btn primary', type: 'button', onclick: close }, 'Done'), remove)];
  }
  const est = meal.estimate;
  const value = mealValue(meal) ?? { protein: 0, kcal: 0 };
  const items = meal.items ?? est?.items ?? [];
  const counted = items.length > 0 && items.every((i) => typeof i.qty === 'number');
  const save = () => {
    if (s.usual) ctx.store.saveUsual({ name: est?.name ?? meal.text, protein: value.protein, kcal: value.kcal });
    close();
  };
  return [
    s.preview ? h('img', { class: 'snap-preview small', src: s.preview, alt: 'Your meal' }) : null,
    h('p', { class: 'snap-name' }, h('span', { class: 'muted' }, `${slotName(meal.slot)} · ${clockLabel(meal.at)}`), h('strong', {}, est?.name ?? meal.text)),
    h('div', { class: 'snap-numbers' },
      h('div', { class: 'snap-num protein' }, h('span', {}, 'Protein'), h('strong', {}, `≈${value.protein} g`), est && !meal.items ? h('span', {}, `${est.protein.low}–${est.protein.high}`) : null),
      h('div', { class: 'snap-num' }, h('span', {}, 'Calories'), h('strong', {}, `≈${value.kcal.toLocaleString('en-GB')}`), est && !meal.items ? h('span', {}, `${est.kcal.low}–${est.kcal.high}`) : null)),
    meal.correction ? h('p', { class: 'muted snap-foot' }, `Claude corrected this: ${meal.correction.why}. Changing a count replaces it.`) : null,
    counted ? itemRows(ctx, meal, items)
      : items.length ? h('ul', { class: 'snap-items' }, items.map((i) => h('li', {}, h('span', {}, i.name), h('span', { class: 'muted' }, `≈${i.protein} g · ${i.kcal} kcal`)))) : null,
    est && !counted ? h('div', { class: 'snap-portion', role: 'group', 'aria-label': 'Portion' }, Object.keys(PORTIONS).map((p) => h('button', {
      class: meal.portion === p ? 'dl-btn primary' : 'dl-btn', type: 'button', 'aria-pressed': String(meal.portion === p),
      onclick: () => ctx.store.updateMeal(meal.id, { portion: p, final: finalFor(est, p), correction: null }),
    }, PORTION_LABELS[p]))) : null,
    s.fresh ? null : h('p', { class: 'muted snap-label' }, 'Not right? Change the words and estimate it again.'),
    ...(s.fresh ? [] : words),
    s.fresh ? null : when,
    s.error ? h('p', { class: 'error', role: 'alert' }, s.error) : null,
    est ? h('label', { class: 'snap-usual-tick' }, h('input', { type: 'checkbox', checked: s.usual, onchange: (e) => { s.usual = e.target.checked; } }), 'Save as a usual meal, one tap next time') : null,
    h('div', { class: 'snap-actions' },
      h('button', { class: 'dl-btn primary', type: 'button', onclick: save }, `${s.fresh ? 'Save' : 'Done'} · ${dayProtein(doc, today)} of ${target} g today`),
      remove),
    h('p', { class: 'muted snap-foot' }, 'An estimate. Change a count if it’s off; Claude checks the week’s meals when you plan.'),
  ];
}

export function paintSnap(ctx) {
  const dlg = document.getElementById('snap');
  const s = ctx.ui.snap;
  if (!dlg || !s) return;
  const body = s.step === 'pick' ? pickStep(ctx) : s.step === 'working' ? workingStep(ctx) : resultStep(ctx);
  const focused = document.activeElement?.dataset?.focus === 'snap-text' && dlg.contains(document.activeElement);
  dlg.replaceChildren(h('div', { class: 'sheet-body' },
    h('div', { class: 'sheet-head' }, h('h2', {}, s.fresh ? 'Log a meal' : 'Your meal'),
      h('button', { class: 'link sheet-close', type: 'button', 'aria-label': 'Close', onclick: close }, '✕')),
    ...body.filter(Boolean)));
  if (focused) dlg.querySelector('[data-focus="snap-text"]')?.focus();
}
