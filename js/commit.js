// What George committed to for a day (docs/superpowers/specs/2026-09-23-honest-day-score-design.md):
// the tasks on its list at 11:00. Before then he can reshuffle freely; after, a task moved off the day
// is "pushed" and one deleted is "dropped" (js/schedule.js's dayScore). Written once, by the app or the
// planner, whichever gets there first. Pure apart from ensureCommitment's write. (Until 26 Sep 2026 the
// Coach's morning exchange could lock it earlier.)

import { rowsForDay } from './schedule.js';

export const LOCK_HOUR = 11;
export const commitKey = (day) => `commit:${day}`;

// Whether the day's list should lock now. `now` is within `day` (its logical day).
export function lockDue(doc, day, now) {
  if (doc?.calendar?.[commitKey(day)]) return false;
  return now.getHours() >= LOCK_HOUR;
}

// Locks the day's list if it's time, and returns the commitment it wrote (null when it didn't).
export function ensureCommitment(store, day, now) {
  const doc = store.doc();
  if (!lockDue(doc, day, now)) return null;
  const tasks = rowsForDay(doc, day).filter((r) => r.item.type === 'task' && r.item.status === 'active').map((r) => r.item.id);
  store.putCalendar(commitKey(day), { day, at: now.toISOString(), tasks });
  return store.doc().calendar[commitKey(day)];
}
