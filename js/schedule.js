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

// ---- Streaks --------------------------------------------------------------------------------

function runs(outcomes) {
  let best = 0;
  let current = 0;
  for (const ok of outcomes) {
    current = ok ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return { current, best };
}

function occurrenceStreak(doc, item, today) {
  const ticked = doneDays(doc, item.id);
  const outcomes = [];
  for (let day = item.created; day <= today; day = addDays(day, 1)) {
    if (!isHabitDue(doc, item, day)) continue;
    const ok = ticked.has(day);
    if (day === today && !ok) continue; // today isn't over yet
    outcomes.push(ok);
  }
  return runs(outcomes);
}

function weeklyStreak(doc, item, today) {
  const thisWeek = weekStart(today);
  const outcomes = [];
  for (let week = weekStart(item.created); week <= thisWeek; week = addDays(week, 7)) {
    const ok = item.type === 'quota'
      ? weekTotal(doc, item.id, week) >= item.target
      : doneBetween(doc, item.id, week, addDays(week, 7)) >= item.repeat.n;
    if (week === thisWeek && !ok) continue; // this week isn't over yet
    outcomes.push(ok);
  }
  return runs(outcomes);
}

export function streak(doc, item, today) {
  if (item.type === 'quota' || item.repeat?.kind === 'perWeek') return weeklyStreak(doc, item, today);
  if (item.type === 'habit') return occurrenceStreak(doc, item, today);
  return { current: 0, best: 0 };
}

// ---- Completion, history, goals --------------------------------------------------------------

export function dayCompletion(doc, day) {
  const rows = rowsForDay(doc, day);
  return { done: rows.filter((r) => r.done).length, total: rows.length };
}

// The current week and the two before it, Monday first: 21 cells.
export function history(doc, today) {
  const start = addDays(weekStart(today), -14);
  return Array.from({ length: 21 }, (_, i) => {
    const day = addDays(start, i);
    if (day > today) return { day, future: true, done: 0, total: 0 };
    return { day, future: false, ...dayCompletion(doc, day) };
  });
}

// What a history cell opens up to.
export function dayDetail(doc, day) {
  const amounts = activeLogs(doc, (l) => l.kind === 'amount' && l.day === day)
    .map((log) => ({ log, item: doc.items[log.itemId] ?? null, goal: doc.goals[log.goalId] ?? null }))
    .sort((a, b) => ((a.log.at ?? '') < (b.log.at ?? '') ? -1 : 1));
  return { rows: rowsForDay(doc, day), amounts };
}

export function goalTotal(doc, goalId) {
  return activeLogs(doc, (l) => l.kind === 'amount' && l.goalId === goalId)
    .reduce((sum, l) => sum + l.amount, 0);
}

export function milestonesOf(doc, goalId) {
  return values(doc.milestones)
    .filter((m) => m.goalId === goalId && (m.status === 'active' || m.status === 'suggested'))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function goalItems(doc, goalId) {
  return values(doc.items)
    .filter((i) => i.goalId === goalId && i.status === 'active')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function goalProgress(doc, goal) {
  if (goal.target > 0) {
    const total = goalTotal(doc, goal.id);
    return { numeric: true, done: total, total: goal.target, pct: Math.min(100, Math.round((total / goal.target) * 100)) };
  }
  const live = milestonesOf(doc, goal.id).filter((m) => m.status === 'active');
  const ticked = live.filter((m) => m.done).length;
  return { numeric: false, done: ticked, total: live.length, pct: live.length ? Math.round((ticked / live.length) * 100) : 0 };
}
