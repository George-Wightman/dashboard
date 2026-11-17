// Daylight's Fuel tile: today's protein as a plate filling towards the target, the meals so far
// (with the photo while this device still has it, each opening again to change), "Log a meal", the week's calories against
// maintenance, and how many meals are waiting to be estimated. Opened big: the last 14 days.
// The balance (17 Nov 2026): beside the plate, today's fibre and fruit and veg and the week's
// different plants, each against its target; opened big, the week's balance in full.

import { h } from './dom.js';
import { mealsOn, mealValue, dayProtein, weekKcal, fuelSettings, maintenanceVerdict, slotName, MAX_TRIES, liveBatches, batchEaten, dayBalance, weekBalance } from '../food.js';
import { addDays, shortWeekday, shortDate } from '../dates.js';
import { clockLabel } from '../calendar.js';
import { localPhotos } from '../photos.js';
import { LOGOS } from './sources.js';
import { openSnap, openMeal } from './snap.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const RING = 2 * Math.PI * 70;

function plate(protein, target) {
  const share = Math.max(0, Math.min(1, protein / target));
  const ring = svg('svg', { class: 'fuel-plate-ring', viewBox: '0 0 190 190', role: 'img', 'aria-label': `Protein today ${protein} of ${target} grams` });
  ring.append(
    svg('circle', { cx: 95, cy: 95, r: 86, class: 'plate' }),
    svg('circle', { cx: 95, cy: 95, r: 70, class: 'track' }),
    svg('circle', { cx: 95, cy: 95, r: 70, class: 'fill', 'stroke-dasharray': `${(share * RING).toFixed(1)} ${RING.toFixed(1)}`, transform: 'rotate(-90 95 95)' }));
  return h('div', { class: 'fuel-plate' }, ring,
    h('div', { class: 'fuel-plate-words' }, h('span', { class: 'fuel-plate-num' }, `${protein} g`), h('span', {}, `of ${target}`)));
}

// The photo, while this device still holds it (the sync repo is private, so the page never fetches
// uploaded ones); otherwise a placeholder. Asked for once, and again a few seconds later if it
// wasn't there yet (a photo that's still being saved); the page redraws when it arrives.
const RETRY_MS = 4000;
function thumb(ctx, meal) {
  const thumbs = (ctx.ui.thumbs ??= {});
  const known = thumbs[meal.id];
  if (!known || (!known.src && Date.now() - known.at > RETRY_MS)) {
    thumbs[meal.id] = { src: null, at: Date.now() };
    localPhotos.get(meal.id).then((p) => { if (p?.small) { thumbs[meal.id] = { src: `data:image/jpeg;base64,${p.small}`, at: Date.now() }; (ctx.whenIdle?.() ?? Promise.resolve()).then(ctx.render); } });
  }
  return thumbs[meal.id].src
    ? h('img', { class: 'fuel-thumb', src: thumbs[meal.id].src, alt: '' })
    : h('span', { class: 'fuel-thumb placeholder', 'aria-hidden': 'true' }, slotName(meal.slot).slice(0, 1));
}

function claudeMark(why) {
  const el = h('span', { class: 'src', title: `Corrected by Claude: ${why}`, role: 'img', 'aria-label': `Corrected by Claude: ${why}` });
  el.innerHTML = LOGOS.claude; // a fixed string from js/ui/sources.js, never data
  return el;
}

export function mealWords(meal) {
  const v = mealValue(meal);
  if (v) return `≈${v.protein} g · ≈${v.kcal.toLocaleString('en-GB')} kcal`;
  if (meal.state === 'failed') return (meal.tries ?? 0) >= MAX_TRIES ? 'couldn’t estimate it, Claude will look' : 'couldn’t estimate it yet, will try again';
  return 'waiting to be estimated';
}

// Each meal opens again, to change its counts, words or time.
function mealLine(ctx, meal) {
  const name = meal.estimate?.name ?? meal.text ?? slotName(meal.slot);
  return h('li', {}, h('button', { class: 'fuel-meal', type: 'button', 'aria-label': `${name}, ${clockLabel(meal.at)}: open to change`, onclick: () => openMeal(ctx, meal.id) },
    thumb(ctx, meal),
    h('span', { class: 'fuel-meal-words' },
      h('strong', {}, name),
      h('span', {}, `${clockLabel(meal.at)} · ${mealWords(meal)}`)),
    meal.correction ? claudeMark(meal.correction.why) : null));
}

function weekLine(doc, today) {
  const { average } = weekKcal(doc, today);
  if (average == null) return null;
  const verdict = maintenanceVerdict(average, fuelSettings(doc).maintenanceKcal);
  return h('p', { class: 'fuel-week' }, `This week about ${average.toLocaleString('en-GB')} kcal a day${verdict ? `, ${verdict}` : ''}.`);
}

// What's still in the fridge from a batch, as the share of the pot he hasn't logged (anyone else's included).
function fridgeLine(doc, today) {
  const live = liveBatches(doc, today);
  if (!live.length) return null;
  return h('p', { class: 'fuel-week fuel-fridge' }, `In the fridge: ${live.map((b) => `${b.name.toLowerCase()}, ${Math.round((1 - batchEaten(doc, b.id)) * 100)}% not logged`).join(' · ')}.`);
}

const num = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '').replace('.5', '½'));

// One measure against its target: a name, "22 of 35 g", and a thin bar.
function measure(name, value, target, unit = '') {
  const share = Math.max(0, Math.min(1, value / target));
  return h('li', { class: `fuel-measure${value >= target ? ' met' : ''}` },
    h('span', { class: 'fuel-measure-name' }, name),
    h('span', { class: 'fuel-measure-num' }, `${num(value)} of ${num(target)}${unit}`),
    h('span', { class: 'fuel-measure-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${(share * 100).toFixed(0)}%` })));
}

// Today's fibre and fruit and veg, and the week's plants: only once a meal has a full estimate.
function balanceList(doc, today) {
  const t = fuelSettings(doc);
  const day = dayBalance(doc, today);
  const week = weekBalance(doc, today);
  if (!day.known && !week.known) return null;
  return h('ul', { class: 'fuel-balance', 'aria-label': 'Balance' },
    day.known ? measure('Fibre', day.fibre, t.fibre, ' g') : null,
    day.known ? measure('Fruit & veg', day.fruitVeg, t.fruitVeg) : null,
    week.known ? measure('Plants this week', week.plants.length, t.plants) : null);
}

// The week's balance in full, for the big view.
function weekBalanceSection(doc, today) {
  const t = fuelSettings(doc);
  const w = weekBalance(doc, today);
  if (!w.known) return h('p', { class: 'muted' }, 'Fibre, fruit and veg and plants show once a meal has a full estimate: tell Claude what you ate.');
  const rows = [];
  if (w.days) {
    rows.push(measure('Fibre a day', w.fibre, t.fibre, ' g'), measure('Fruit & veg a day', w.fruitVeg, t.fruitVeg));
  }
  rows.push(measure('Different plants', w.plants.length, t.plants), measure('Oily fish', w.oilyFish, t.oilyFish));
  const lines = [];
  if (w.split) lines.push(`Calories from protein ${w.split.protein}%, carbs ${w.split.carbs}%, fat ${w.split.fat}%.`);
  if (w.days) lines.push(`Sugar about ${w.sugar} g a day.`);
  if (w.plants.length) lines.push(`Plants: ${w.plants.join(', ')}.`);
  return h('section', { class: 'fuel-week-balance' },
    h('h3', {}, 'Balance, last 7 days'),
    h('ul', { class: 'fuel-balance' }, rows),
    lines.map((l) => h('p', { class: 'fuel-week' }, l)),
    h('p', { class: 'muted' }, w.days ? `Averages from ${w.days === 1 ? 'the one day' : `the ${w.days} days`} with every meal fully estimated.` : 'No day has every meal fully estimated yet, so no averages.'));
}

const waitingCount = (doc) => Object.values(doc.meals ?? {})
  .filter((m) => m?.kind === 'meal' && m.status === 'active' && (m.state === 'pending' || (m.state === 'failed' && (m.tries ?? 0) < MAX_TRIES))).length;

export function renderFuel(ctx) {
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const { protein: target } = fuelSettings(doc);
  const meals = mealsOn(doc, today);
  const waiting = waitingCount(doc);
  return h('div', { class: 'fuel' },
    h('div', { class: 'fuel-top' }, plate(dayProtein(doc, today), target),
      balanceList(doc, today),
      meals.length ? h('ul', { class: 'fuel-meals' }, meals.map((m) => mealLine(ctx, m))) : h('p', { class: 'fuel-none' }, 'Nothing logged yet today.')),
    h('button', { class: 'fuel-snap', type: 'button', onclick: () => openSnap(ctx) }, 'Log a meal'),
    weekLine(doc, today),
    fridgeLine(doc, today),
    waiting ? h('p', { class: 'fuel-waiting', role: 'status' }, `${waiting} meal${waiting === 1 ? '' : 's'} waiting to be estimated`) : null);
}

export function renderFuelBig(ctx) {
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const { protein: target, maintenanceKcal } = fuelSettings(doc);
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, -i));
  return h('div', { class: 'fuel-big' },
    weekLine(doc, today),
    fridgeLine(doc, today),
    maintenanceKcal ? null : h('p', { class: 'muted' }, 'Claude sets your maintenance figure once there are two weeks of meals.'),
    weekBalanceSection(doc, today),
    days.map((day) => {
      const meals = mealsOn(doc, day);
      const protein = dayProtein(doc, day);
      const kcal = meals.map(mealValue).filter(Boolean).reduce((s, v) => s + v.kcal, 0);
      const bal = dayBalance(doc, day);
      const partial = bal.known && bal.known < bal.meals ? ` (${bal.known} of ${bal.meals} meals)` : '';
      return h('section', { class: 'fuel-day' },
        h('h3', {}, `${shortWeekday(day)} ${shortDate(day)}`,
          h('span', { class: protein >= target ? 'met' : 'muted' }, meals.length ? ` · ${protein} of ${target} g · ≈${kcal.toLocaleString('en-GB')} kcal` : ' · nothing logged'),
          bal.known ? h('span', { class: 'muted' }, ` · fibre ${bal.fibre} g · ${num(bal.fruitVeg)} fruit & veg${partial}`) : null),
        meals.length ? h('ul', { class: 'fuel-meals' }, meals.map((m) => mealLine(ctx, m))) : null);
    }));
}
