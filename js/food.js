// Food: a meal described in words (a photo is optional) or a usual meal logged in one tap. Gemini
// estimates protein and calories as ranges, item by item with a count he can change (5 eggs, not 4);
// any meal can be opened again to change its counts, words or time; Claude can correct a big miss. Protein
// is the number that matters day to day; calories only as a weekly average against maintenance (he's
// maintaining, not cutting). Meals live in the `meals` map of data.json; a meal's progress is its
// `state` (pending, estimated, failed), since `status` is the record's own (active, archived). Pure.

import { addDays } from './dates.js';

export const PORTIONS = { lighter: 0.75, right: 1, bigger: 1.3 };
export const MAX_TRIES = 3;
export const FUEL_ID = 'fuel:settings';
// Meals go to Flash first (a few a day; worth the better model) and with little randomness.
export const MEAL_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
export const MEAL_TEMPERATURE = 0.2;
const DEFAULT_PROTEIN = 180;

const pad = (n) => String(n).padStart(2, '0');

const SLOT_NAMES = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
export const slotName = (slot) => SLOT_NAMES[slot] ?? 'Meal';

export function slotFor(date) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes < 11 * 60) return 'breakfast';
  if (minutes < 15 * 60) return 'lunch';
  if (minutes >= 17 * 60 && minutes < 21 * 60 + 30) return 'dinner';
  return 'snack';
}

// When a snapped meal was eaten: now, unless it was opened from a breakfast, lunch or dinner marker
// whose time has passed (he's logging a meal he forgot), when it's that meal at its usual time.
export function snapTime(now, marker) {
  if (!marker?.start) return now;
  const at = new Date(marker.start);
  return at <= now ? at : now;
}

export const MEAL_SYSTEM = [
  'You estimate the protein and calories in a meal, from what he says about it, and sometimes a photo.',
  'His words are the best guide to how much he ate. When they give amounts (5 eggs, 2 pittas, half the tray), use exactly those. A photo shows what the food is; for how much, trust his words over the photo.',
  'He is a big, active man who eats large portions, around 4,000 kcal a day. When nothing says how much, assume a generous portion, not a typical one.',
  'List each item with a count he can correct: qty is a number, unit is what is counted (eggs, pittas, slices, g, ml, bowls, portions), and protein and kcal are for that whole quantity.',
  'Be honest about uncertainty: give a low, a middle and a high value for the whole meal.',
  'Reply only with JSON, exactly this shape:',
  '{"name": "a short name for the meal", "items": [{"name": "fried egg", "qty": 5, "unit": "eggs", "protein": grams, "kcal": calories}], "protein": {"low": g, "mid": g, "high": g}, "kcal": {"low": n, "mid": n, "high": n}}',
].join('\n');

// `usual` is his usual meals, given for scale: what his own portions come to.
export function mealPrompt({ text, at, hasPhoto, usual = [] }) {
  const words = String(text ?? '').trim();
  const scale = usual.slice(0, 6).map((u) => `${u.name}: ${u.protein} g protein, ${u.kcal} kcal`);
  return [
    hasPhoto ? 'There is a photo of the meal.' : 'There is no photo; go by the words.',
    words ? `What he says about it: ${words}` : 'He added no words.',
    `Eaten at ${pad(at.getHours())}:${pad(at.getMinutes())}.`,
    scale.length ? `For scale, his usual meals: ${scale.join('; ')}.` : null,
  ].filter(Boolean).join('\n');
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

const round1 = (n) => Math.round(n * 10) / 10;

// An item keeps what one of its units is worth (`each`), so changing the count never drifts.
function item(name, qty, unit, protein, kcal) {
  return { name, qty, unit, protein: roundProtein(protein), kcal: roundKcal(kcal), each: { protein: round1(protein / qty), kcal: round1(kcal / qty) } };
}

export function parseEstimate(data) {
  if (!data || typeof data !== 'object' || typeof data.name !== 'string' || !data.name.trim()) throw new Error(BAD);
  const items = (Array.isArray(data.items) ? data.items : [])
    .filter((i) => i && typeof i.name === 'string' && i.name.trim() && isNum(i.protein) && isNum(i.kcal))
    .map((i) => item(i.name.trim(), isNum(i.qty) && i.qty > 0 ? round1(i.qty) : 1, typeof i.unit === 'string' ? i.unit.trim().slice(0, 20) : '', i.protein, i.kcal));
  return { name: data.name.trim(), items, protein: range(data.protein, roundProtein), kcal: range(data.kcal, roundKcal) };
}

// The same item with a new count (0 leaves it out of the totals).
export function withQty(it, qty) {
  const q = isNum(qty) ? round1(qty) : it.qty;
  const each = it.each ?? { protein: it.protein / (it.qty || 1), kcal: it.kcal / (it.qty || 1) };
  return { ...it, qty: q, each, protein: roundProtein(each.protein * q), kcal: roundKcal(each.kcal * q) };
}

// The count one step up (dir 1) or down (-1): 25 at a time for grams and millilitres, otherwise one,
// or a half below one (half a pitta). Never below 0.
export function nextQty(it, dir) {
  const q = it.qty ?? 1;
  if (/^(g|grams?|ml)$/i.test(it.unit ?? '')) return Math.max(0, q + 25 * dir);
  const step = q < 1 || (q === 1 && dir < 0) ? 0.5 : 1;
  return Math.max(0, round1(q + step * dir));
}

export const itemsTotal = (items) => ({
  protein: roundProtein(items.reduce((s, i) => s + i.protein, 0)),
  kcal: roundKcal(items.reduce((s, i) => s + i.kcal, 0)),
});

// What a fresh estimate counts for: its items added up when it has them (so changing a count moves
// the total from where it started), otherwise the middle of the range for the portion picked.
export function finalFor(estimate, portion = 'right', items = null) {
  const list = items ?? estimate.items;
  if (list?.length && list.every((i) => isNum(i.qty))) return itemsTotal(list);
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

// What this device should do next: estimate the meals it holds a photo for (and any meal whose photo
// isn't waiting on another device, which goes by its words), and upload the photos it holds.
export function mealWork(doc, localIds) {
  const needsEstimate = (m) => m.state === 'pending' || (m.state === 'failed' && (m.tries ?? 0) < MAX_TRIES);
  const all = meals(doc);
  return {
    estimate: all.filter((m) => needsEstimate(m) && (localIds.has(m.id) || m.photoState !== 'local')),
    upload: all.filter((m) => m.photoState === 'local' && localIds.has(m.id)),
  };
}
