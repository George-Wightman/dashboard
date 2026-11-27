// START THE DAY (25 Nov 2026): one card in the morning instead of the evening close, the back push
// and the stocks brief, which he kept missing. The back, yesterday's ticks, yesterday's food and a
// line for Claude, answered in one go on the phone or the laptop. Done is one small record,
// calendar['morning:<day>'], written by the card or by Claude after a chat that covered the same
// ground; the morning push and the card both read it. Pure; js/ui/morning.js draws it.

import { addDays, shortWeekday } from './dates.js';
import { closeModel } from './close.js';
import { mealsOn, MEAL_TIMES } from './food.js';
import { BACK } from './coach.js';

export const morningId = (day) => `morning:${day}`;
export const MORNING_PARTS = ['back', 'food'];

export function morningRecord(doc, day) {
  const rec = doc?.calendar?.[morningId(day)];
  return rec?.status === 'active' && rec.done === true ? rec : null;
}

function backOn(doc, day) {
  const r = doc?.gym?.[`back:${day}`];
  return r && r.status === 'active' && Number.isInteger(r.score) && BACK[r.score] ? { score: r.score, word: BACK[r.score] } : null;
}

// What the card shows: today's back answer, yesterday as the close sheet sees it, yesterday's meals.
export function morningModel(doc, today) {
  const yesterday = addDays(today, -1);
  return {
    day: today,
    yesterday,
    back: backOn(doc, today),
    close: closeModel(doc, yesterday),
    meals: mealsOn(doc, yesterday),
    done: morningRecord(doc, today),
  };
}

// The card asks until the morning is done, at any hour of the day.
export const morningDue = (doc, today) => !morningRecord(doc, today);

const hhmm = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// The done card's one line. Misses by name, and a skipped part said as skipped.
export function morningLine(model) {
  const skipped = new Set(model.done?.skipped ?? []);
  const at = model.done?.at ? hhmm(model.done.at) : '';
  const parts = [`Morning done${at ? ` at ${at}` : ''}`];
  parts.push(model.back ? `back ${model.back.word}` : skipped.has('back') ? 'back skipped' : 'back not answered');
  const day = shortWeekday(model.yesterday);
  const c = model.close;
  if (c.closed && !c.total) parts.push(`nothing was on ${day}`);
  else if (c.closed) {
    parts.push(`${day} closed: ${c.done} of ${c.total} done${c.notDone.length ? ` · not done: ${c.notDone.join(', ')}` : ''}`);
  } else parts.push(`${day} not closed`);
  parts.push(`${model.meals.length} meal${model.meals.length === 1 ? '' : 's'} logged`);
  if (skipped.has('food')) parts.push('food skipped');
  return parts.join(' · ');
}

// ---- What the card saves (js/ui/morning.js) --------------------------------------------------------


// A time he gave for a meal on `day`: before the day starts (01:30, say) it's the night after.
export function mealTimeFor(day, hhmm, dayStartHour = 4) {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d + (hh < dayStartHour ? 1 : 0), hh, mm);
}

// For a usual meal tapped in: the first of breakfast, lunch and dinner with nothing logged or split.
export function firstMissingSlot(logged, rows) {
  const have = new Set([...logged, ...rows].map((m) => m.slot));
  return ['breakfast', 'lunch', 'dinner'].find((s) => !have.has(s)) ?? 'snack';
}

// The checked split, saved: a usual meal exactly, a share of a pot exactly, anything else as his
// words, pending, for the background estimate (js/photos.js). An empty row is left out. Every row is
// checked before any is written, so a bad one saves nothing and saving again never doubles a meal.
// Returns how many were saved.
export function saveSplitMeals(store, day, rows, dayStartHour = 4) {
  const doc = store.doc();
  const keep = rows.filter((r) => String(r.text ?? '').trim() || r.usualId);
  for (const r of keep) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(r.time ?? ''))) throw new Error(`Give ${String(r.text ?? '').trim() || 'each meal'} a time like 19:30`);
    if (r.usualId && !(doc.meals?.[r.usualId]?.kind === 'usual' && doc.meals[r.usualId].status === 'active')) throw new Error(`${r.text} isn't a usual meal any more`);
    if (r.batchId && !(doc.meals?.[r.batchId]?.kind === 'batch' && doc.meals[r.batchId].status === 'active')) throw new Error(`${r.text}: that pot isn't in the fridge any more`);
  }
  let n = 0;
  for (const r of keep) {
    const text = String(r.text ?? '').trim();
    const at = mealTimeFor(day, r.time, dayStartHour);
    const meal = r.usualId ? store.addMeal({ at, usualId: r.usualId })
      : r.batchId ? store.addServing({ at, batchId: r.batchId, share: r.share })
      : store.addMeal({ at, text });
    if (r.slot && meal.slot !== r.slot) store.updateMeal(meal.id, { slot: r.slot });
    n++;
  }
  return n;
}

// Done: the line for Claude (a For Claude flag, first in catchup), yesterday closed unless it
// already is, and the morning record, saying which parts were left empty.
export function finishMorning(store, { today, note = '', at, flagState = null, doing = null }) {
  const doc = store.doc();
  const m = morningModel(doc, today);
  const text = String(note ?? '').trim();
  if (text) store.addFlag(`Start of ${today}: ${text}`, flagState, 'me', 'claude', { doing });
  if (!m.close.closed) store.putCalendar(`closed:${m.yesterday}`, { day: m.yesterday, closed: true, at: at.toISOString() }, 'me');
  const skipped = [];
  if (!m.back) skipped.push('back');
  if (!m.meals.length) skipped.push('food');
  store.putCalendar(morningId(today), { day: today, done: true, at: at.toISOString(), skipped }, 'me');
  return morningRecord(store.doc(), today);
}

export const claudeMorningUrl = () => `https://claude.ai/new?q=${encodeURIComponent("/dashboard Start my day with me: back, yesterday's ticks and food.")}`;

// ---- Food by taps (27 Nov 2026) ---------------------------------------------------------------------

// One tap on a food row: a usual meal or a share of a pot, counted exactly, or his words for one
// meal, left for the background estimate. Logged on `day` at the row's time, the row's meal kept.
export function logTap(store, { day, slot, usualId = null, batchId = null, share = null, text = '' }, dayStartHour = 4) {
  const at = mealTimeFor(day, MEAL_TIMES[slot] ?? MEAL_TIMES.snack, dayStartHour);
  const words = String(text ?? '').trim();
  if (!usualId && !batchId && !words) throw new Error('Say what you had');
  const meal = usualId ? store.addMeal({ at, usualId }) : batchId ? store.addServing({ at, batchId, share }) : store.addMeal({ at, text: words });
  if (meal.slot !== slot) store.updateMeal(meal.id, { slot });
  return store.doc().meals[meal.id];
}

// An estimated meal kept as a usual for its row, and the meal linked to it.
export function usualFromMeal(store, mealId) {
  const meal = store.doc().meals[mealId];
  if (!meal || meal.kind !== 'meal' || !meal.final) throw new Error('A meal can be kept as a usual once it has numbers');
  const u = store.saveUsual({ name: meal.estimate?.name ?? meal.text, ...meal.final, slot: meal.slot });
  store.updateMeal(mealId, { usualId: u.id });
  return u;
}

// A pot worked out from its ingredients (js/food.js parsePot), into the fridge.
export function savePot(store, { text, pot, cookedOn }) {
  const { name, items, ...numbers } = pot;
  return store.saveBatch({ ...numbers, name, ingredients: text, cookedOn });
}
