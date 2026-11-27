// Food: a meal described in words (a photo is optional) or a usual meal logged in one tap. Gemini
// estimates protein and calories as ranges, item by item with a count he can change (5 eggs, not 4);
// any meal can be opened again to change its counts, words or time; Claude can correct a big miss. Protein
// is the number that matters day to day; calories only as a weekly average against maintenance (he's
// maintaining, not cutting). Meals live in the `meals` map of data.json; a meal's progress is its
// `state` (pending, estimated, failed), since `status` is the record's own (active, archived). Pure.
//
// The balance (17 Nov 2026): a meal also carries carbs, fat, fibre and sugar in grams, portions of veg,
// fruit and oily fish, and the plants in it (for the week's count of different plants). Claude works
// these out when George tells him a meal; Gemini when he logs one in the app. Micronutrients are never
// estimated: no model gives a trustworthy milligram of iron from a sentence, so the food groups stand
// in for them. A meal from before has protein and calories only, and the balance leaves it out.

import { addDays } from './dates.js';

export const PORTIONS = { lighter: 0.75, right: 1, bigger: 1.3 };
export const MAX_TRIES = 3;
export const FUEL_ID = 'fuel:settings';
// Meals go to Flash first (a few a day; worth the better model) and with little randomness.
export const MEAL_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
export const MEAL_TEMPERATURE = 0.2;
const DEFAULT_PROTEIN = 180;
// Fibre in grams a day (the UK's 30 g, more for a big eater), fruit and veg portions a day, different
// plants a week, oily fish portions a week. Claude can change any of them.
const DEFAULTS = { fibre: 35, fruitVeg: 5, plants: 30, oilyFish: 1 };

// Grams of carbs, fat, fibre and sugar, and portions (80 g of veg or fruit, 140 g of oily fish).
export const GRAMS = ['carbs', 'fat', 'fibre', 'sugar'];
export const GROUPS = ['veg', 'fruit', 'oilyFish'];
export const EXTRA = [...GRAMS, ...GROUPS];
const MAX_PLANTS = 30;

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
  'You estimate what is in a meal (protein, calories, carbs, fat, fibre, sugar, and portions of veg, fruit and oily fish), from what he says about it, and sometimes a photo.',
  'His words are the best guide to how much he ate. When they give amounts (5 eggs, 2 pittas, half the tray), use exactly those. A photo shows what the food is; for how much, trust his words over the photo.',
  'He is a big, active man who eats large portions, around 4,000 kcal a day. When nothing says how much, assume a generous portion, not a typical one.',
  'He often speaks his meals, and voice typing hears "pittas" as "pizzas": with eggs, cheese or salad, or "wholemeal", it means pitta breads. Only count a pizza when the meal really is one (a takeaway, a frozen or fresh-counter pizza).',
  'List each item with a count he can correct: qty is a number, unit is what is counted (eggs, pittas, slices, g, ml, bowls, portions), and every number on an item is for that whole quantity.',
  'Per item: protein, carbs, fat, fibre and sugar in grams (sugar is total sugars), kcal, and portions: veg and fruit (80 g is one portion; potatoes are not veg; beans and lentils count as one at most; juice or a smoothie counts as one at most), oilyFish (140 g of salmon, mackerel, sardines, trout or herring is one; tuna is not oily). Use 0 where there is none.',
  'Protein and carbs are about 4 kcal a gram and fat about 9: the grams should roughly add up to the calories.',
  'plants is every different plant food in the meal (vegetables, fruit, wholegrains, beans, nuts, seeds, herbs and spices), each named once, lower case and singular ("tomato", "oat", "chickpea"). White bread, white rice and sugar are not plants for this.',
  'Be honest about uncertainty: give a low, a middle and a high value of protein and calories for the whole meal.',
  'Reply only with JSON, exactly this shape:',
  '{"name": "a short name for the meal", "items": [{"name": "fried egg", "qty": 5, "unit": "eggs", "protein": g, "kcal": n, "carbs": g, "fat": g, "fibre": g, "sugar": g, "veg": 0, "fruit": 0, "oilyFish": 0}], "plants": ["spinach"], "protein": {"low": g, "mid": g, "high": g}, "kcal": {"low": n, "mid": n, "high": n}}',
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

// The time a row on Start the day's food logs a meal at (js/morning.js), on the day before.
export const MEAL_TIMES = { breakfast: '08:30', lunch: '13:00', dinner: '19:00', snack: '16:00' };

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
const round4 = (n) => Math.round(n * 10000) / 10000;
const roundHalf = (n) => Math.round(n * 2) / 2;
// How each number is kept: kcal to the 10, portions to the half, grams whole.
const roundFor = (k) => (k === 'kcal' ? roundKcal : GROUPS.includes(k) ? roundHalf : roundProtein);
const NUMS = ['protein', 'kcal', ...EXTRA];

// The plants in a meal: named once each, lower case, at most 30.
export function cleanPlants(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const p of list) {
    const name = typeof p === 'string' ? p.trim().toLowerCase().slice(0, 40) : '';
    if (name && !out.includes(name)) out.push(name);
  }
  return out.slice(0, MAX_PLANTS);
}

// An item keeps what one of its units is worth (`each`), so changing the count never drifts. Carbs,
// fat, fibre, sugar and the food groups come along when the estimate gave them.
function item(raw) {
  const qty = isNum(raw.qty) && raw.qty > 0 ? round1(raw.qty) : 1;
  const out = { name: raw.name.trim(), qty, unit: typeof raw.unit === 'string' ? raw.unit.trim().slice(0, 20) : '' };
  const each = {};
  for (const k of NUMS) {
    if (!isNum(raw[k])) continue;
    out[k] = roundFor(k)(raw[k]);
    // Four places, so an item counted in grams (4 g of protein in 160 g) keeps its worth per gram.
    each[k] = round4(raw[k] / qty);
  }
  return { ...out, each };
}

const validItems = (list) => (Array.isArray(list) ? list : [])
  .filter((i) => i && typeof i.name === 'string' && i.name.trim() && isNum(i.protein) && isNum(i.kcal))
  .map(item);

// The meal's carbs, fat, fibre, sugar and groups: added up from the items when every item has that
// number, otherwise the meal's own figure if the reply gave one.
function extrasOf(items, data = {}) {
  const out = {};
  const counted = items.filter((i) => i.qty !== 0);
  for (const k of EXTRA) {
    if (counted.length && counted.every((i) => isNum(i[k]))) out[k] = roundFor(k)(counted.reduce((s, i) => s + i[k], 0));
    else if (isNum(data[k])) out[k] = roundFor(k)(data[k]);
  }
  return out;
}

export function parseEstimate(data) {
  if (!data || typeof data !== 'object' || typeof data.name !== 'string' || !data.name.trim()) throw new Error(BAD);
  const items = validItems(data.items);
  const out = { name: data.name.trim(), items, protein: range(data.protein, roundProtein), kcal: range(data.kcal, roundKcal), ...extrasOf(items, data) };
  const plants = cleanPlants(data.plants);
  return plants.length ? { ...out, plants } : out;
}

// A POT FROM ITS INGREDIENTS (27 Nov 2026): he lists what went into a batch he cooked, amounts and
// all, and Gemini works out the whole pot item by item. One dish with its amounts said is the easy
// case; nothing is split. He sees the items and totals before it goes in the fridge.
export const POT_SYSTEM = [
  'He has cooked a large batch (a pot) and lists what went into it, with amounts. Work out the whole pot, ingredient by ingredient.',
  'Use exactly the amounts he says. Weights are as he gives them: "dry rice" and "raw chicken" are weighed before cooking, so count them that way. When he gives no amount, assume a normal amount for a big family-size pot.',
  'Voice typing hears "pittas" as "pizzas"; read it sensibly.',
  'Per ingredient: qty (a number), unit (g, ml, tins, breasts, cloves, tbsp…), and for that whole quantity: protein, carbs, fat, fibre and sugar in grams, kcal, and portions of veg and fruit (80 g is one) and oilyFish (140 g is one). Use 0 where there is none. Oil and butter count.',
  'plants is every different plant food in it, each named once, lower case and singular. White rice, white pasta and sugar are not plants for this.',
  'name is a short name for the dish.',
  'Reply only with JSON, exactly this shape:',
  '{"name": "Chicken and rice", "items": [{"name": "raw chicken breast", "qty": 6, "unit": "breasts", "protein": g, "kcal": n, "carbs": g, "fat": g, "fibre": g, "sugar": g, "veg": 0, "fruit": 0, "oilyFish": 0}], "plants": ["tomato"]}',
].join('\n');

export const potPrompt = ({ text }) => `What went in: ${String(text ?? '').trim()}`;

const POT_BAD = 'Gemini’s pot didn’t make sense';
export function parsePot(data) {
  const name = data && typeof data === 'object' && typeof data.name === 'string' ? data.name.trim().slice(0, 60) : '';
  const items = validItems(data?.items);
  if (!name || !items.length) throw new Error(POT_BAD);
  const out = { name, items, ...itemsTotal(items), ...extrasOf(items, data) };
  const plants = cleanPlants(data.plants);
  return plants.length ? { ...out, plants } : out;
}

// A meal Claude worked out in a chat, item by item: the same shape as Gemini's, its range the total.
export function claudeEstimate({ name, items, plants }) {
  const list = validItems(items);
  if (!list.length) throw new Error('A meal you estimate needs items, each with a name, qty, unit, protein and kcal (and carbs, fat, fibre, sugar, veg, fruit and oilyFish)');
  const total = itemsTotal(list);
  const title = String(name ?? '').trim() || list.map((i) => i.name).join(', ').slice(0, 60);
  const out = { name: title, by: 'claude', items: list, protein: { low: total.protein, mid: total.protein, high: total.protein },
    kcal: { low: total.kcal, mid: total.kcal, high: total.kcal }, ...extrasOf(list) };
  const named = cleanPlants(plants);
  return named.length ? { ...out, plants: named } : out;
}

// The same item with a new count (0 leaves it out of the totals).
export function withQty(it, qty) {
  const q = isNum(qty) ? round1(qty) : it.qty;
  const each = { ...(it.each ?? {}) };
  for (const k of NUMS) if (isNum(it[k]) && !isNum(each[k])) each[k] = it[k] / (it.qty || 1);
  const out = { ...it, qty: q, each };
  for (const k of NUMS) if (isNum(each[k])) out[k] = roundFor(k)(each[k] * q);
  return out;
}

// The count one step up (dir 1) or down (-1): 25 at a time for grams and millilitres, otherwise one,
// or a half below one (half a pitta). Never below 0.
export function nextQty(it, dir) {
  const q = it.qty ?? 1;
  if (/^(g|grams?|ml)$/i.test(it.unit ?? '')) return Math.max(0, q + 25 * dir);
  const step = q < 1 || (q === 1 && dir < 0) ? 0.5 : 1;
  return Math.max(0, round1(q + step * dir));
}

// The items added up; carbs and the rest only when every item counted has them.
export function itemsTotal(items) {
  return {
    protein: roundProtein(items.reduce((s, i) => s + i.protein, 0)),
    kcal: roundKcal(items.reduce((s, i) => s + i.kcal, 0)),
    ...extrasOf(items),
  };
}

const withPlants = (value, plants) => (plants?.length ? { ...value, plants: [...plants] } : value);

// What a fresh estimate counts for: its items added up when it has them (so changing a count moves
// the total from where it started), otherwise the middle of the range for the portion picked.
export function finalFor(estimate, portion = 'right', items = null) {
  const list = items ?? estimate.items;
  if (list?.length && list.every((i) => isNum(i.qty))) return withPlants(itemsTotal(list), estimate.plants);
  const k = PORTIONS[portion] ?? 1;
  const out = { protein: roundProtein(estimate.protein.mid * k), kcal: roundKcal(estimate.kcal.mid * k) };
  for (const x of EXTRA) if (isNum(estimate[x])) out[x] = roundFor(x)(estimate[x] * k);
  return withPlants(out, estimate.plants);
}

// What a meal counts for: what George saved, with Claude's correction over it if he made one (a
// correction of protein and calories alone keeps the rest of the estimate).
export function mealValue(meal) {
  const base = meal?.final ?? null;
  const fix = meal?.correction ?? null;
  const v = fix ? { ...(base ?? {}), ...fix } : base;
  if (!v || !isNum(v.protein) || !isNum(v.kcal)) return null;
  const out = { protein: v.protein, kcal: v.kcal };
  for (const k of EXTRA) if (isNum(v[k])) out[k] = v[k];
  return withPlants(out, cleanPlants(v.plants));
}

// The numbers a record carries (a usual meal, a batch), scaled: protein, kcal, and whichever of the
// rest it has.
export function nutrientsOf(rec, scale = 1) {
  const out = { protein: roundProtein(rec.protein * scale), kcal: roundKcal(rec.kcal * scale) };
  for (const k of EXTRA) if (isNum(rec[k])) out[k] = roundFor(k)(rec[k] * scale);
  return withPlants(out, cleanPlants(rec.plants));
}

// The calories a meal's grams come to (4 a gram of protein and carbs, 9 of fat), when that is more
// than a fifth away from its own calories: a sign the estimate is off. Otherwise null.
export function macroGap(value) {
  if (!value || !isNum(value.carbs) || !isNum(value.fat) || !value.kcal) return null;
  const sum = value.protein * 4 + value.carbs * 4 + value.fat * 9;
  return Math.abs(sum - value.kcal) / value.kcal > 0.2 ? roundKcal(sum) : null;
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
  const pick = (k) => (isNum(live[k]) && live[k] > 0 ? live[k] : DEFAULTS[k]);
  return {
    protein: isNum(live.protein) && live.protein > 0 ? live.protein : DEFAULT_PROTEIN,
    maintenanceKcal: isNum(live.maintenanceKcal) && live.maintenanceKcal > 0 ? live.maintenanceKcal : null,
    fibre: pick('fibre'), fruitVeg: pick('fruitVeg'), plants: pick('plants'), oilyFish: pick('oilyFish'),
  };
}
export const BALANCE_TARGETS = Object.keys(DEFAULTS);

// The balance of a day. A meal counts towards it once it has fibre (the sign of a full estimate), and
// `known` of `meals` says how many did. Fruit and veg are portions; plants are the different ones.
export function dayBalance(doc, day) {
  const values = mealsOn(doc, day).map(mealValue).filter(Boolean);
  const known = values.filter((v) => isNum(v.fibre));
  const sum = (k) => known.reduce((s, v) => s + (isNum(v[k]) ? v[k] : 0), 0);
  return {
    meals: values.length, known: known.length,
    protein: roundProtein(sum('protein')), kcal: roundKcal(sum('kcal')),
    carbs: roundProtein(sum('carbs')), fat: roundProtein(sum('fat')), fibre: roundProtein(sum('fibre')), sugar: roundProtein(sum('sugar')),
    fruitVeg: roundHalf(sum('veg') + sum('fruit')), oilyFish: roundHalf(sum('oilyFish')),
    plants: [...new Set(known.flatMap((v) => v.plants ?? []))],
  };
}

// The last seven days' balance. The averages come from full days (every meal fully estimated), so a
// half-known day never drags them down; plants and oily fish count every meal that has them.
// `split` is the share of calories from protein, carbs and fat, in percent.
export function weekBalance(doc, today) {
  const days = Array.from({ length: 7 }, (_, i) => dayBalance(doc, addDays(today, -i)));
  const full = days.filter((d) => d.meals && d.known === d.meals);
  const plants = [...new Set(days.flatMap((d) => d.plants))].sort();
  const oilyFish = roundHalf(days.reduce((s, d) => s + d.oilyFish, 0));
  const known = days.some((d) => d.known);
  if (!full.length) return { days: 0, known, plants, oilyFish, fibre: null, sugar: null, fruitVeg: null, split: null };
  const avg = (k) => full.reduce((s, d) => s + d[k], 0) / full.length;
  const p = avg('protein') * 4, c = avg('carbs') * 4, f = avg('fat') * 9;
  const total = p + c + f;
  return {
    days: full.length, known, plants, oilyFish,
    fibre: Math.round(avg('fibre')), sugar: Math.round(avg('sugar')), fruitVeg: roundHalf(avg('fruitVeg')),
    split: total ? { protein: Math.round((p / total) * 100), carbs: Math.round((c / total) * 100), fat: Math.round((f / total) * 100) } : null,
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

// START THE DAY'S FOOD ROWS (27 Nov 2026): breakfast, lunch, dinner and a snack as taps. A row offers
// the usual meals he has had most recently at that meal, so a Salzburg lunch gives way to a London
// one by itself, and a usual Claude saved with that home meal (`slot`) before he's had it.
export const ROW_USUALS = 2;
export const ROW_DAYS = 14;
export const POT_SHARES = [0.167, 0.2, 0.25, 0.333, 0.5];

export function rowUsuals(doc, slot, today, n = ROW_USUALS) {
  const from = addDays(today, -ROW_DAYS);
  const last = new Map();
  for (const m of meals(doc)) {
    if (!m.usualId || m.slot !== slot || m.day < from || m.day > today) continue;
    if (String(m.at) > (last.get(m.usualId) ?? '')) last.set(m.usualId, String(m.at));
  }
  return Object.values(doc?.meals ?? {})
    .filter((u) => u && u.kind === 'usual' && u.status === 'active')
    .filter((u) => last.has(u.id) || (u.slot === slot && String(u.updated ?? u.created ?? '').slice(0, 10) >= from))
    // Newest first: when it was last had here, or for one given this home meal, when that was saved.
    .sort((a, b) => keyOf(b).localeCompare(keyOf(a)))
    .slice(0, n);
  function keyOf(u) {
    const saved = u.slot === slot ? String(u.updated ?? u.created ?? '') : '';
    const had = last.get(u.id) ?? '';
    return had > saved ? had : saved;
  }
}

// The shares of a pot still offered: those that fit in what's left of it.
export const potShares = (doc, batchId) => POT_SHARES.filter((s) => batchEaten(doc, batchId) + s <= 1.02);

// Pots in the fridge are offered at lunch and dinner, where leftovers get eaten.
export const rowPots = (doc, slot, today) => (slot === 'lunch' || slot === 'dinner' ? liveBatches(doc, today) : []);

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

// Batches (10 Nov 2026): a pot he cooks once and eats over a few days, often shared. Claude
// works out the whole pot from what went in, and each serving is his share of the whole ("a
// quarter"), whoever ate the rest, so it counts exactly, with no estimate. A batch is a record in
// `meals` with kind 'batch'; a serving is an ordinary meal with `batchId` and `share`.
export const BATCH_DAYS = 7; // how long a batch shows as in the fridge

// A share of the whole pot: a number from 0 to 1, a fraction ("1/4"), or a percentage ("25%").
export function parseShare(v) {
  let n = null;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const s = v.trim();
    const frac = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    const pct = s.match(/^(\d+(?:\.\d+)?)\s*%$/);
    if (frac) n = Number(frac[1]) / Number(frac[2]);
    else if (pct) n = Number(pct[1]) / 100;
    else if (/^\d*\.?\d+$/.test(s)) n = Number(s);
  }
  if (!(Number.isFinite(n) && n > 0 && n <= 1)) throw new Error('A share is part of the whole pot: 0.25, "1/4" or "25%"');
  return Math.round(n * 1000) / 1000;
}

// The share as he'd say it: a quarter, a fifth, a third, or a percentage.
const SHARE_WORDS = { 1: 'all', 0.5: 'half', 0.333: 'a third', 0.667: 'two thirds', 0.25: 'a quarter', 0.75: 'three quarters', 0.2: 'a fifth', 0.4: 'two fifths', 0.167: 'a sixth', 0.125: 'an eighth' };
export const shareWords = (share) => SHARE_WORDS[Math.round(share * 1000) / 1000] ?? `${Math.round(share * 100)}%`;

export const servingValue = (batch, share) => nutrientsOf(batch, share);

export const batchServings = (doc, batchId) => meals(doc).filter((m) => m.batchId === batchId).sort((a, b) => String(a.at).localeCompare(String(b.at)));

// How much of the pot he has logged (anyone else's share is never logged).
export const batchEaten = (doc, batchId) => Math.round(batchServings(doc, batchId).reduce((s, m) => s + (m.share ?? 0), 0) * 1000) / 1000;

export function batches(doc) {
  return Object.values(doc?.meals ?? {})
    .filter((m) => m && m.kind === 'batch' && m.status === 'active')
    .sort((a, b) => String(b.cookedOn).localeCompare(String(a.cookedOn)) || String(b.created).localeCompare(String(a.created)));
}

// The batches still in the fridge: cooked in the last week and not all logged.
export const liveBatches = (doc, today) => batches(doc).filter((b) => b.cookedOn > addDays(today, -BATCH_DAYS) && batchEaten(doc, b.id) < 0.98);
