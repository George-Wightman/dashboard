// Food: a meal snapped (a photo and/or a line) or a usual meal logged in one tap. Gemini estimates
// protein and calories as ranges; George picks a portion; Claude can correct a big miss later. Protein
// is the number that matters day to day; calories only as a weekly average against maintenance (he's
// maintaining, not cutting). Meals live in the `meals` map of data.json. Pure.

import { addDays } from './dates.js';

export const PORTIONS = { lighter: 0.75, right: 1, bigger: 1.3 };
export const MAX_TRIES = 3;
export const FUEL_ID = 'fuel:settings';
const DEFAULT_PROTEIN = 180;

const pad = (n) => String(n).padStart(2, '0');

export function slotFor(date) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes < 11 * 60) return 'breakfast';
  if (minutes < 15 * 60) return 'lunch';
  if (minutes >= 17 * 60 && minutes < 21 * 60 + 30) return 'dinner';
  return 'snack';
}

export const MEAL_SYSTEM = [
  'You estimate the protein and calories in a meal, from a photo of it, a few words about it, or both.',
  'Assume typical UK portions unless the words say otherwise. Be honest about uncertainty: give a low, a middle and a high value.',
  'Reply only with JSON, exactly this shape:',
  '{"name": "a short name for the meal", "items": [{"name": "an item", "protein": grams, "kcal": calories}], "protein": {"low": g, "mid": g, "high": g}, "kcal": {"low": n, "mid": n, "high": n}}',
].join('\n');

export function mealPrompt({ text, at, hasPhoto }) {
  const words = String(text ?? '').trim();
  return [
    hasPhoto ? 'The photo is the meal.' : 'There is no photo; go by the words.',
    words ? `What George says about it: ${words}` : 'George added no words.',
    `Eaten at ${pad(at.getHours())}:${pad(at.getMinutes())}.`,
  ].join('\n');
}

const BAD = 'Gemini’s estimate didn’t make sense';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const roundProtein = (g) => Math.round(g);
const roundKcal = (k) => Math.round(k / 10) * 10;

function range(r, round) {
  if (!r || typeof r !== 'object' || ![r.low, r.mid, r.high].every(isNum)) throw new Error(BAD);
  const out = { low: round(r.low), mid: round(r.mid), high: round(r.high) };
  if (!(out.low <= out.mid && out.mid <= out.high)) throw new Error(BAD);
  return out;
}

export function parseEstimate(data) {
  if (!data || typeof data !== 'object' || typeof data.name !== 'string' || !data.name.trim()) throw new Error(BAD);
  const items = (Array.isArray(data.items) ? data.items : [])
    .filter((i) => i && typeof i.name === 'string' && i.name.trim() && isNum(i.protein) && isNum(i.kcal))
    .map((i) => ({ name: i.name.trim(), protein: roundProtein(i.protein), kcal: roundKcal(i.kcal) }));
  return { name: data.name.trim(), items, protein: range(data.protein, roundProtein), kcal: range(data.kcal, roundKcal) };
}

export function finalFor(estimate, portion = 'right') {
  const k = PORTIONS[portion] ?? 1;
  return { protein: roundProtein(estimate.protein.mid * k), kcal: roundKcal(estimate.kcal.mid * k) };
}

// What a meal counts for: Claude's correction if he made one, else what George saved.
export function mealValue(meal) {
  const v = meal?.correction ?? meal?.final;
  return v && isNum(v.protein) && isNum(v.kcal) ? { protein: v.protein, kcal: v.kcal } : null;
}

const meals = (doc) => Object.values(doc?.meals ?? {}).filter((m) => m && m.kind === 'meal' && m.status !== 'archived' && m.status !== 'dismissed');

export function mealsOn(doc, day) {
  return meals(doc).filter((m) => m.day === day).sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

export function dayProtein(doc, day) {
  return mealsOn(doc, day).reduce((sum, m) => sum + (mealValue(m)?.protein ?? 0), 0);
}

// The mean of each day's calories over the last seven days that have a counted meal.
export function weekKcal(doc, today) {
  const totals = [];
  for (let i = 6; i >= 0; i--) {
    const values = mealsOn(doc, addDays(today, -i)).map(mealValue).filter(Boolean);
    if (values.length) totals.push(values.reduce((s, v) => s + v.kcal, 0));
  }
  if (!totals.length) return { average: null, days: 0 };
  return { average: roundKcal(totals.reduce((s, t) => s + t, 0) / totals.length), days: totals.length };
}

export function fuelSettings(doc) {
  const rec = doc?.meals?.[FUEL_ID];
  const live = rec && rec.status !== 'archived' ? rec : {};
  return {
    protein: isNum(live.protein) && live.protein > 0 ? live.protein : DEFAULT_PROTEIN,
    maintenanceKcal: isNum(live.maintenanceKcal) && live.maintenanceKcal > 0 ? live.maintenanceKcal : null,
  };
}

export function maintenanceVerdict(average, maintenanceKcal) {
  if (!isNum(average) || !isNum(maintenanceKcal) || !maintenanceKcal) return null;
  const off = (average - maintenanceKcal) / maintenanceKcal;
  if (Math.abs(off) <= 0.1) return 'about maintenance';
  return off > 0 ? 'above maintenance' : 'below maintenance';
}

export function usualMeals(doc) {
  return Object.values(doc?.meals ?? {})
    .filter((m) => m && m.kind === 'usual' && m.status !== 'archived')
    .map((m) => ({ id: m.id, name: m.name, protein: m.protein, kcal: m.kcal, uses: m.uses ?? 0 }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}

// What this device should do next: estimate the meals it holds a photo for (and any meal with
// only words, which any device can do), and upload the photos it holds.
export function mealWork(doc, localIds) {
  const needsEstimate = (m) => m.status === 'pending' || (m.status === 'failed' && (m.tries ?? 0) < MAX_TRIES);
  const all = meals(doc);
  return {
    estimate: all.filter((m) => needsEstimate(m) && (localIds.has(m.id) || !m.photoState)),
    upload: all.filter((m) => m.photoState === 'local' && localIds.has(m.id)),
  };
}
