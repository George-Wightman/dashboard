// What's on a day, and the numbers derived from it. Pure: a document and a day in, values out.

import { addDays, weekday, weekStart, dayOfMonth, daysInMonth } from './dates.js';

const values = (map) => Object.values(map ?? {});
const byOrder = (a, b) => (a.item.order ?? 0) - (b.item.order ?? 0);
const activeLogs = (doc, pred) => values(doc.logs).filter((l) => l.status === 'active' && pred(l));

// Live (or since archived), created by `day`, and not yet archived on it.
export function countsOn(record, day) {
  if (record.status !== 'active' && record.status !== 'archived') return false;
  if (record.created > day) return false;
  return !record.archivedOn || day < record.archivedOn;
}

export function doneDays(doc, itemId) {
  return new Set(activeLogs(doc, (l) => l.itemId === itemId && l.kind === 'done').map((l) => l.day));
}

// Ticks on days in [from, to).
export function doneBetween(doc, itemId, from, to) {
  let n = 0;
  for (const d of doneDays(doc, itemId)) if (d >= from && d < to) n++;
  return n;
}

export function isHabitDue(doc, item, day) {
  const r = item.repeat ?? { kind: 'daily' };
  switch (r.kind) {
    case 'daily': return true;
    case 'weekdays': return (r.days ?? []).includes(weekday(day));
    case 'weekly': return weekday(day) === r.day;
    case 'monthly': return dayOfMonth(day) === Math.min(r.date, daysInMonth(day));
    case 'perWeek': return doneBetween(doc, item.id, weekStart(day), day) < r.n;
    default: return false;
  }
}

function taskRow(doc, item, day) {
  if (item.date > day) return null;
  const doneOn = [...doneDays(doc, item.id)].sort()[0] ?? null;
  if (doneOn && doneOn < day) return null;
  return {
    item, kind: 'task', done: doneOn === day,
    carriedFrom: item.date < day ? item.date : null, suggested: false,
  };
}

// The tasks and habits that count on a day — what the header and the history measure.
export function rowsForDay(doc, day) {
  const rows = [];
  for (const item of values(doc.items)) {
    if (!countsOn(item, day)) continue;
    if (item.type === 'task') {
      const row = taskRow(doc, item, day);
      if (row) rows.push(row);
    } else if (item.type === 'habit' && isHabitDue(doc, item, day)) {
      rows.push({ item, kind: 'habit', done: doneDays(doc, item.id).has(day), carriedFrom: null, suggested: false });
    }
  }
  return rows.sort(byOrder);
}

// Amounts logged against an item or a goal in the Monday–Sunday week containing `day`.
export function weekTotal(doc, id, day) {
  const start = weekStart(day);
  const end = addDays(start, 6);
  return activeLogs(doc, (l) =>
    l.kind === 'amount' && (l.itemId === id || l.goalId === id) && l.day >= start && l.day <= end)
    .reduce((sum, l) => sum + l.amount, 0);
}

// Everything on Today, in display order.
export function todayRows(doc, today) {
  const suggestions = values(doc.items)
    .filter((item) => item.status === 'suggested')
    .map((item) => ({ item, kind: item.type, done: false, carriedFrom: null, suggested: true }))
    .sort(byOrder);
  const quotas = values(doc.items)
    .filter((item) => item.type === 'quota' && item.status === 'active' && countsOn(item, today))
    .map((item) => {
      const total = weekTotal(doc, item.id, today);
      return { item, kind: 'quota', done: total >= item.target, carriedFrom: null, suggested: false, total };
    });
  const rows = [...rowsForDay(doc, today).filter((r) => r.item.status === 'active'), ...quotas].sort(byOrder);
  return [...suggestions, ...rows.filter((r) => !r.done), ...rows.filter((r) => r.done)];
}
