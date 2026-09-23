// What George committed to for a day (docs/superpowers/specs/2026-09-23-honest-day-score-design.md):
// the tasks on its list once the morning check-in is done — he has answered the Coach and it has
// replied — or at 11:00 if he hasn't. Before then he can reshuffle freely; after, a task moved off the
// day is "pushed" and one deleted is "dropped" (js/schedule.js's dayScore). Written once, by the app
// or the planner, whichever gets there first. Pure apart from ensureCommitment's write.

import { rowsForDay } from './schedule.js';

export const LOCK_HOUR = 11;
export const commitKey = (day) => `commit:${day}`;

// Whether the day's list should lock now. `now` is within `day` (its logical day).
export function lockDue(doc, day, now) {
  if (doc?.calendar?.[commitKey(day)]) return false;
  if (now.getHours() >= LOCK_HOUR) return true;
  const talk = doc?.journal?.[`talk:${day}:morning`];
  const messages = talk?.status === 'active' ? talk.messages ?? [] : [];
  const firstReply = messages.findIndex((m) => m.who === 'george');
  return firstReply >= 0 && messages.slice(firstReply + 1).some((m) => m.who === 'coach');
}

// Locks the day's list if it's time, and returns the commitment it wrote (null when it didn't).
export function ensureCommitment(store, day, now) {
  const doc = store.doc();
  if (!lockDue(doc, day, now)) return null;
  const tasks = rowsForDay(doc, day).filter((r) => r.item.type === 'task' && r.item.status === 'active').map((r) => r.item.id);
  store.putCalendar(commitKey(day), { day, at: now.toISOString(), tasks });
  return store.doc().calendar[commitKey(day)];
}
