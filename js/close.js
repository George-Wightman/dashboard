// Closing the day: one pass in the evening instead of a question after every task. What's still
// open (tick what happened; the rest are named as not done), the meals, and one line for Claude.
// He ticks in a batch late in the evening anyway, so the app meets him there. A closed day is one
// small record, calendar['closed:<day>'], so the phone and the laptop agree; it's the record the
// planner already reads (js/plan-state.js dayClosed): nothing more is booked on a closed day, and
// what wasn't done gets a new slot. Pure; js/ui/close.js draws it.

import { todayRows, dayScore } from './schedule.js';
import { mealsOn } from './food.js';

export const CLOSE_FROM_HOUR = 19; // the card shows from here on today; a past day always shows it
export const closedId = (day) => `closed:${day}`;

export function closedRecord(doc, day) {
  const rec = doc?.calendar?.[closedId(day)];
  return rec?.status === 'active' && rec.closed ? rec : null;
}

// What closing the day has to show: the rows still open, the ones done, and the meals logged.
export function closeModel(doc, day) {
  const rows = todayRows(doc, day).filter((r) => !r.suggested);
  const open = rows.filter((r) => !r.done && r.kind !== 'quota' && r.item.type !== 'quota');
  // The numbers are the day score's (js/schedule.js), so a task moved or dropped after the 11:00
  // lock still counts here exactly as it does everywhere else.
  const score = dayScore(doc, day);
  const slots = new Set(mealsOn(doc, day).map((m) => m.slot).filter((s) => ['breakfast', 'lunch', 'dinner'].includes(s)));
  // The meals row ticks itself from the meals; it's counted, never ticked by hand.
  const tickable = open.filter((r) => r.kind !== 'meals');
  const notDone = [...score.open, ...score.missed, ...score.dropped].map((r) => r.item.title);
  return { open, tickable, done: score.done, total: score.total, notDone, pushed: score.pushed.map((r) => r.item.title), meals: mealsOn(doc, day).length, mainMeals: slots.size, closed: closedRecord(doc, day) };
}

// Whether the card belongs on screen: any past day not yet closed, or today from the evening on.
export function closeDue(doc, day, today, now) {
  if (closedRecord(doc, day)) return false;
  if (day < today) return closeModel(doc, day).total > 0;
  return day === today && now.getHours() >= CLOSE_FROM_HOUR;
}

// The card's one line: "3 of 7 done · 4 still open · 2 of 3 meals".
export function closeLine(model) {
  const parts = [`${model.done} of ${model.total} done`];
  if (model.notDone.length) parts.push(`${model.notDone.length} not done`);
  if (model.pushed.length) parts.push(`${model.pushed.length} pushed`);
  parts.push(`${model.mainMeals} of 3 meals`);
  return parts.join(' · ');
}

// What a closed day says: the misses by name. Moving or dropping work never makes it a clean day.
export function closedLine(model) {
  const at = model.closed?.at ? new Date(model.closed.at) : null;
  const when = at ? ` at ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : '';
  // The meals row included: an unlogged day is a miss too.
  return `Day closed${when} · ${model.done} of ${model.total} done${model.notDone.length ? ` · not done: ${model.notDone.join(', ')}` : ''}${model.pushed.length ? ` · pushed: ${model.pushed.join(', ')}` : ''}`;
}
