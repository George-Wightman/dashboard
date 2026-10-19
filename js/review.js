// The week in review, for Daylight's Sunday tile (js/ui/review.js): every miss named with its day,
// done against planned the honest way (js/schedule.js's dayScore), the weekly targets that have
// numbers, and a hand-over to Claude to plan the next one. Shown Saturday and Sunday for the week so
// far, and Monday for the week just gone. Pure.

import { addDays, weekStart, weekday } from './dates.js';
import { dayScore, doneIndex, weekTotal } from './schedule.js';
import { cardioQuotaId } from './gym.js';
import { mealsOn, dayProtein, fuelSettings } from './food.js';
import { backScores, sessionTasks } from './coach.js';

export const PLAN_URL = `https://claude.ai/new?q=${encodeURIComponent('/dashboard Plan my next week: start with catchup 7, name what I missed, then plan it.')}`;

const quota = (doc, id) => {
  const q = id ? doc?.items?.[id] : null;
  return q && q.status === 'active' && q.type === 'quota' && q.unit === 'minutes' ? q : null;
};

export function reviewWeek(doc, today) {
  const dow = weekday(today);
  let start;
  let end;
  if (dow >= 6) { start = weekStart(today); end = today; }
  else if (dow === 1) { start = addDays(weekStart(today), -7); end = addDays(start, 6); }
  else return null;
  const idx = doneIndex(doc);
  const days = [];
  const misses = [];
  const pushed = [];
  const named = new Set();
  let done = 0;
  let total = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const s = dayScore(doc, d, idx);
    const missed = [...(d < today ? s.open : []), ...s.missed, ...s.dropped].map((r) => r.item);
    days.push({ day: d, done: s.done, total: s.total, missed: missed.map((i) => i.title) });
    done += s.done;
    total += s.total;
    for (const item of missed) {
      // A task carried over is one miss, on the first day it was missed; a daily habit, each day.
      const key = item.type === 'task' ? item.id : `${item.id}|${d}`;
      if (named.has(key)) continue;
      named.add(key);
      misses.push({ title: item.title, day: d });
    }
    for (const p of s.pushed) pushed.push({ title: p.item.title, day: d, to: p.to });
  }
  misses.sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title));

  const heb = quota(doc, 'hebrew-minutes');
  const cardio = quota(doc, cardioQuotaId(doc));
  const eaten = days.filter((x) => mealsOn(doc, x.day).length);
  const target = fuelSettings(doc).protein;
  const scores = backScores(doc, end, 7).filter((x) => x.day >= start);
  const planned = sessionTasks(doc, start, end);
  return {
    start, end, days, misses, pushed, done, total,
    hebrew: heb ? { minutes: Math.round(weekTotal(doc, heb.id, end)), target: heb.target } : null,
    cardio: cardio ? { minutes: Math.round(weekTotal(doc, cardio.id, end)), target: cardio.target } : null,
    protein: eaten.length ? { onTarget: eaten.filter((x) => dayProtein(doc, x.day) >= target).length, days: eaten.length, target } : null,
    back: scores.length ? { answered: scores.length, sore: scores.filter((x) => x.score >= 2).length } : null,
    sessions: planned.length ? { planned: planned.length, done: planned.filter((t) => idx.get(t.id)?.size).length } : null,
  };
}
