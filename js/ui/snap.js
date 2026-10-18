// Snapping a meal (#snap): take or choose a photo, add a line if you like (typed or said), or log a
// usual meal in one tap. The photo is shrunk and kept on the device, the meal pass asks Gemini, and
// the estimate comes back here: protein (the number that matters) and calories as ranges, the items,
// a portion to adjust it, and "Save as a usual meal". Close at any point: it finishes on its own.
// The sheet's state is ctx.ui.snap; js/app.js's render repaints it, so the estimate appears when the
// meal pass writes it.

import { h } from './dom.js';
import { usualMeals, slotFor, slotName, finalFor, dayProtein, fuelSettings, snapTime, PORTIONS } from '../food.js';
import { clockLabel } from '../calendar.js';
import { shrink, localPhotos, keepPhoto } from '../photos.js';
import { micButton, stopListening, grow } from './mic.js';

const BIG = 768;
const SMALL = 480;
const PORTION_LABELS = { lighter: 'lighter', right: 'about right', bigger: 'bigger' };
const pad = (n) => String(n).padStart(2, '0');

// `marker` ({ slot, start }) when opened from a breakfast, lunch or dinner marker on the timeline.
export function openSnap(ctx, marker = null) {
  const dlg = document.getElementById('snap');
  if (!dlg) return;
  ctx.ui.snap = { step: 'pick', text: '', mealId: null, preview: null, usual: false, error: '', marker };
  dlg.onclose = () => { stopListening(); ctx.ui.snap = null; };
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

function logUsual(ctx, usual) {
  const meal = ctx.store.addMeal({ at: snapTime(new Date(), ctx.ui.snap.marker), usualId: usual.id });
  Object.assign(ctx.ui.snap, { step: 'result', mealId: meal.id });
  paintSnap(ctx);
}

function fileButton(ctx, label, capture) {
  const input = h('input', { type: 'file', accept: 'image/*', class: 'snap-file', ...(capture ? { capture: 'environment' } : {}),
    onchange: (e) => takePhoto(ctx, e.target.files?.[0]) });
  return h('label', { class: capture ? 'snap-shutter' : 'dl-btn' }, input, label);
}

function pickStep(ctx) {
  const s = ctx.ui.snap;
  const now = snapTime(new Date(), s.marker);
  const box = h('textarea', {
    rows: 1, maxlength: 400, 'data-focus': 'snap-text', 'aria-label': 'What’s in it (optional)', placeholder: 'Add a line if you like: what’s in it',
    oninput: (e) => { s.text = e.target.value; grow(e.target); paintButtons(); },
  });
  box.value = s.text;
  const wordsButton = h('button', { class: 'dl-btn', type: 'button', disabled: !s.text.trim(), onclick: () => justWords(ctx) }, 'Just the words');
  const paintButtons = () => { wordsButton.disabled = !s.text.trim(); };
  const usual = usualMeals(ctx.store.doc()).slice(0, 6);
  return [
    h('p', { class: 'snap-when' }, `${slotName(slotFor(now))} · ${pad(now.getHours())}:${pad(now.getMinutes())}`),
    usual.length ? h('div', { class: 'snap-usual', role: 'group', 'aria-label': 'Usual meals' },
      usual.map((u) => h('button', { class: 'dl-btn', type: 'button', title: `${u.protein} g protein · ${u.kcal} kcal`, onclick: () => logUsual(ctx, u) }, `★ ${u.name}`))) : null,
    h('div', { class: 'snap-line' }, box, micButton({
      key: 'snap-text',
      getText: () => s.text,
      setText: (text) => { s.text = text; const live = document.querySelector('[data-focus="snap-text"]') ?? box; live.value = text; grow(live); paintButtons(); },
      onBlocked: (message) => { s.error = message; },
      render: () => paintSnap(ctx),
    })),
    s.error ? h('p', { class: 'error', role: 'alert' }, s.error) : null,
    h('div', { class: 'snap-actions' }, fileButton(ctx, 'Take a photo', true), fileButton(ctx, 'Choose from photos', false), wordsButton),
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

function resultStep(ctx) {
  const s = ctx.ui.snap;
  const doc = ctx.store.doc();
  const meal = doc.meals[s.mealId];
  if (!meal) return [h('p', {}, 'That meal has gone.'), h('div', { class: 'snap-actions' }, h('button', { class: 'dl-btn', type: 'button', onclick: close }, 'Close'))];
  const today = ctx.store.today();
  const { protein: target } = fuelSettings(doc);
  const remove = h('button', { class: 'link', type: 'button', onclick: () => { ctx.store.archiveMeal(meal.id); close(); } }, 'Remove this meal');
  if (meal.state !== 'estimated') {
    const said = meal.state === 'failed'
      ? `Couldn’t estimate it${meal.error ? ` (${meal.error})` : ''}. It’s kept, and will be tried again.`
      : 'Saved. It’ll be estimated as soon as Gemini can be reached.';
    return [s.preview ? h('img', { class: 'snap-preview small', src: s.preview, alt: 'Your meal' }) : null, h('p', {}, said),
      h('div', { class: 'snap-actions' }, h('button', { class: 'dl-btn primary', type: 'button', onclick: close }, 'Done'), remove)];
  }
  const est = meal.estimate;
  const final = meal.final ?? { protein: 0, kcal: 0 };
  const save = () => {
    if (s.usual) ctx.store.saveUsual({ name: est?.name ?? meal.text, protein: final.protein, kcal: final.kcal });
    close();
  };
  return [
    s.preview ? h('img', { class: 'snap-preview small', src: s.preview, alt: 'Your meal' }) : null,
    h('p', { class: 'snap-name' }, h('span', { class: 'muted' }, `${slotName(meal.slot)} · ${clockLabel(meal.at)}`), h('strong', {}, est?.name ?? meal.text)),
    h('div', { class: 'snap-numbers' },
      h('div', { class: 'snap-num protein' }, h('span', {}, 'Protein'), h('strong', {}, `≈${final.protein} g`), est ? h('span', {}, `${est.protein.low}–${est.protein.high}`) : null),
      h('div', { class: 'snap-num' }, h('span', {}, 'Calories'), h('strong', {}, `≈${final.kcal.toLocaleString('en-GB')}`), est ? h('span', {}, `${est.kcal.low}–${est.kcal.high}`) : null)),
    est?.items?.length ? h('ul', { class: 'snap-items' }, est.items.map((i) => h('li', {}, h('span', {}, i.name), h('span', { class: 'muted' }, `≈${i.protein} g · ${i.kcal} kcal`)))) : null,
    est ? h('div', { class: 'snap-portion', role: 'group', 'aria-label': 'Portion' }, Object.keys(PORTIONS).map((p) => h('button', {
      class: meal.portion === p ? 'dl-btn primary' : 'dl-btn', type: 'button', 'aria-pressed': String(meal.portion === p),
      onclick: () => ctx.store.updateMeal(meal.id, { portion: p, final: finalFor(est, p) }),
    }, PORTION_LABELS[p]))) : null,
    est ? h('label', { class: 'snap-usual-tick' }, h('input', { type: 'checkbox', checked: s.usual, onchange: (e) => { s.usual = e.target.checked; } }), 'Save as a usual meal, one tap next time') : null,
    h('div', { class: 'snap-actions' },
      h('button', { class: 'dl-btn primary', type: 'button', onclick: save }, `Save · ${dayProtein(doc, today)} of ${target} g today`),
      remove),
    h('p', { class: 'muted snap-foot' }, 'An estimate. Claude checks the week’s meals when you plan.'),
  ];
}

export function paintSnap(ctx) {
  const dlg = document.getElementById('snap');
  const s = ctx.ui.snap;
  if (!dlg || !s) return;
  const body = s.step === 'pick' ? pickStep(ctx) : s.step === 'working' ? workingStep(ctx) : resultStep(ctx);
  const focused = document.activeElement?.dataset?.focus === 'snap-text' && dlg.contains(document.activeElement);
  dlg.replaceChildren(h('div', { class: 'sheet-body' },
    h('div', { class: 'sheet-head' }, h('h2', {}, 'Snap a meal'),
      h('button', { class: 'link sheet-close', type: 'button', 'aria-label': 'Close', onclick: close }, '✕')),
    ...body.filter(Boolean)));
  if (focused) dlg.querySelector('[data-focus="snap-text"]')?.focus();
}
