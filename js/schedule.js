// What's on a day, and the numbers derived from it. Pure: a document and a day in, values out.

import { addDays, weekday, weekStart, dayOfMonth, daysInMonth } from './dates.js';
import { timeOff, excused, offCovers } from './calendar.js';

const values = (map) => Object.values(map ?? {});
const byOrder = (a, b) => (a.item.order ?? 0) - (b.item.order ?? 0);
const activeLogs = (doc, pred) => values(doc.logs).filter((l) => l.status === 'active' && pred(l));

// Live (or since archived), created by `day`, and not yet archived on it.
export function countsOn(record, day) {
  if (record.status !== 'active' && record.status !== 'archived') return false;
  if (record.created > day) return false;
  return !record.archivedOn || day < record.archivedOn;
}

// Every active 'done' log, grouped by item, built in one pass. Pass this to the functions below
// (as their last argument) to avoid re-scanning all logs once per item.
export function doneIndex(doc) {
  const idx = new Map();
  for (const l of values(doc.logs)) {
    if (l.status !== 'active' || l.kind !== 'done') continue;
    let set = idx.get(l.itemId);
    if (!set) idx.set(l.itemId, set = new Set());
    set.add(l.day);
  }
  return idx;
}

export function doneDays(doc, itemId, idx) {
  if (idx) return idx.get(itemId) ?? new Set();
  return new Set(activeLogs(doc, (l) => l.itemId === itemId && l.kind === 'done').map((l) => l.day));
}

// Ticks on days in [from, to).
export function doneBetween(doc, itemId, from, to, idx) {
  let n = 0;
  for (const d of doneDays(doc, itemId, idx)) if (d >= from && d < to) n++;
  return n;
}

export function isHabitDue(doc, item, day, idx) {
  const r = item.repeat ?? { kind: 'daily' };
  switch (r.kind) {
    case 'daily': return true;
    case 'weekdays': return (r.days ?? []).includes(weekday(day));
    case 'weekly': return weekday(day) === r.day;
    case 'monthly': return dayOfMonth(day) === Math.min(r.date, daysInMonth(day));
    case 'perWeek': return doneBetween(doc, item.id, weekStart(day), day, idx) < r.n;
    default: return false;
  }
}

function taskRow(doc, item, day, idx) {
  if (item.date > day) return null;
  const doneOn = [...doneDays(doc, item.id, idx)].sort()[0] ?? null;
  if (doneOn && doneOn < day) return null;
  return {
    item, kind: 'task', done: doneOn === day,
    carriedFrom: item.date < day ? item.date : null, suggested: false,
  };
}

// The tasks and habits that count on a day — what the header and the history measure. Anything
// excused by time off (js/calendar.js) isn't on it; a task dated then carries to the next day.
export function rowsForDay(doc, day, idx = doneIndex(doc), offs = timeOff(doc)) {
  const rows = [];
  for (const item of values(doc.items)) {
    if (!countsOn(item, day)) continue;
    if (offs.length && excused(doc, item, day, offs)) continue;
    if (item.type === 'task') {
      const row = taskRow(doc, item, day, idx);
      if (row) rows.push(row);
    } else if (item.type === 'habit' && isHabitDue(doc, item, day, idx)) {
      rows.push({ item, kind: 'habit', done: doneDays(doc, item.id, idx).has(day), carriedFrom: null, suggested: false });
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
  const idx = doneIndex(doc);
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
  const rows = [...rowsForDay(doc, today, idx).filter((r) => r.item.status === 'active'), ...quotas].sort(byOrder);
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
  const idx = doneIndex(doc);
  const ticked = doneDays(doc, item.id, idx);
  const offs = timeOff(doc);
  const outcomes = [];
  for (let day = item.created; day <= today; day = addDays(day, 1)) {
    if (!isHabitDue(doc, item, day, idx)) continue;
    if (offs.length && excused(doc, item, day, offs)) continue; // time off: neither kept nor broken
    const ok = ticked.has(day);
    if (day === today && !ok) continue; // today isn't over yet
    outcomes.push(ok);
  }
  return runs(outcomes);
}

// One pass over an item/goal's active amount logs, totalled by the Monday it falls in.
function weekTotals(doc, id) {
  const totals = new Map();
  for (const l of activeLogs(doc, (l) => l.kind === 'amount' && (l.itemId === id || l.goalId === id))) {
    // A log whose day isn't a real YYYY-MM-DD string can't be placed in a week — skip it, matching
    // weekTotal's old behaviour of silently ignoring what it can't place, instead of throwing.
    if (typeof l.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(l.day)) continue;
    const w = weekStart(l.day);
    totals.set(w, (totals.get(w) ?? 0) + l.amount);
  }
  return totals;
}

function weeklyStreak(doc, item, today) {
  const idx = doneIndex(doc);
  const thisWeek = weekStart(today);
  const totals = item.type === 'quota' ? weekTotals(doc, item.id) : null;
  const outcomes = [];
  for (let week = weekStart(item.created); week <= thisWeek; week = addDays(week, 7)) {
    const ok = item.type === 'quota'
      ? (totals.get(week) ?? 0) >= item.target
      : doneBetween(doc, item.id, week, addDays(week, 7), idx) >= item.repeat.n;
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

export function dayCompletion(doc, day, idx = doneIndex(doc), offs = timeOff(doc)) {
  const rows = rowsForDay(doc, day, idx, offs);
  return { done: rows.filter((r) => r.done).length, total: rows.length };
}

// The current week and the two before it, Monday first: 21 cells. A day of time off for
// everything carries `off`, its reason, instead of reading as 0/0.
export function history(doc, today) {
  const idx = doneIndex(doc);
  const offs = timeOff(doc);
  const start = addDays(weekStart(today), -14);
  return Array.from({ length: 21 }, (_, i) => {
    const day = addDays(start, i);
    if (day > today) return { day, future: true, done: 0, total: 0 };
    const off = offs.find((o) => offCovers(o, day) && !o.areas?.length);
    return { day, future: false, ...dayCompletion(doc, day, idx, offs), ...(off ? { off: off.reason || 'Time off' } : {}) };
  });
}

// What a history cell opens up to.
export function dayDetail(doc, day) {
  const amounts = activeLogs(doc, (l) => l.kind === 'amount' && l.day === day)
    .map((log) => ({ log, item: doc.items[log.itemId] ?? null, goal: doc.goals[log.goalId] ?? null }))
    .sort((a, b) => ((a.log.at ?? '') < (b.log.at ?? '') ? -1 : 1));
  return { rows: rowsForDay(doc, day, doneIndex(doc)), amounts };
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
