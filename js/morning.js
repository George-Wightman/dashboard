// START THE DAY (25 Nov 2026): one card in the morning instead of the evening close, the back push
// and the stocks brief, which he kept missing. The back, yesterday's ticks, yesterday's food and a
// line for Claude, answered in one go on the phone or the laptop. Done is one small record,
// calendar['morning:<day>'], written by the card or by Claude after a chat that covered the same
// ground; the morning push and the card both read it. Pure; js/ui/morning.js draws it.

import { addDays, shortWeekday } from './dates.js';
import { closeModel } from './close.js';
import { mealsOn } from './food.js';
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
  if (c.closed) {
    parts.push(`${day} closed: ${c.done} of ${c.total} done${c.notDone.length ? ` · not done: ${c.notDone.join(', ')}` : ''}`);
  } else parts.push(`${day} not closed`);
  parts.push(`${model.meals.length} meal${model.meals.length === 1 ? '' : 's'} logged`);
  if (skipped.has('food')) parts.push('food skipped');
  return parts.join(' · ');
}
