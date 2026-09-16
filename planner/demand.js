// What needs time on each day of the window, before any of it has a time: the day's tasks and
// habits grouped by area into blocks, their lengths, a weekly time target's share, and tasks with a
// set time. Time off (js/calendar.js) excuses what it covers: a task dated inside it moves to the
// next day that isn't off for it. Pure; planner/plan.js places what this returns.

import { addDays, weekStart } from '../js/dates.js';
import { isHabitDue, doneIndex, doneDays, doneBetween, weekTotal } from '../js/schedule.js';
import { timeOff, excused } from '../js/calendar.js';
import { at, MINUTE } from './time.js';
import { norm } from './calendars.js';

const values = (map) => Object.values(map ?? {});
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const ceil15 = (n) => Math.ceil(n / 15) * 15;

// k of the list, spread evenly from the first: 2 of six days → the 1st and the 4th.
export function evenPicks(list, k) {
  if (k <= 0) return [];
  if (k >= list.length) return [...list];
  return Array.from({ length: k }, (_, i) => list[Math.floor((i * list.length) / k)]);
}

// Anything with a set time: a fixed event where it belongs, for its length (not on time off). A task
// sits on its own date; a habit repeats, so it takes one on every day it's due and isn't already
// ticked. A habit linked to its own calendar events (habitEvents) is left alone — those events are
// its sessions, and a second fixed block would just compete with them.
export function fixedTasks({ doc, days, config, links = [] }) {
  const offs = timeOff(doc);
  const idx = doneIndex(doc);
  const linked = new Set(links.map((l) => l.habitId));
  const out = [];
  const place = (i, day) => {
    const start = at(day, i.time).getTime();
    return {
      key: `${day}|fixed|${i.id}`, itemId: i.id, day, title: i.title, area: String(i.area ?? '').trim(),
      start, end: start + (i.minutes ?? config.defaultMinutes) * MINUTE,
    };
  };
  for (const i of values(doc.items).filter((x) => x.status === 'active' && x.time).sort(byOrder)) {
    if (i.type === 'task') {
      if (days.includes(i.date) && !excused(doc, i, i.date, offs)) out.push(place(i, i.date));
    } else if (i.type === 'habit' && !linked.has(i.id)) {
      const ticked = doneDays(doc, i.id, idx);
      for (const d of days) {
        if (ticked.has(d) || excused(doc, i, d, offs) || !isHabitDue(doc, i, d, idx)) continue;
        out.push(place(i, d));
      }
    }
  }
  return out;
}

// One area's entries on one day as blocks of at most maxBlockMinutes: tasks packed in order, a task
// longer than that in equal parts, then the weekly target's extra time.
function parts(entries, share, name, config) {
  const max = config.maxBlockMinutes;
  const out = [];
  let cur = null;
  for (const { item, carried } of entries) {
    const m = item.minutes ?? config.defaultMinutes;
    if (m > max) {
      const n = Math.ceil(m / max);
      const each = Math.min(max, ceil15(m / n));
      for (let k = 1; k <= n; k++) out.push({ ids: [item.id], titles: [], minutes: each, carried, split: `${item.title} (${k} of ${n})` });
      cur = null;
      continue;
    }
    if (!cur || cur.minutes + m > max) {
      cur = { ids: [], titles: [], minutes: 0, carried: false };
      out.push(cur);
    }
    cur.ids.push(item.id);
    cur.titles.push(item.title);
    cur.minutes += m;
    cur.carried = cur.carried || carried;
  }
  let extra = Math.max(0, (share?.minutes ?? 0) - out.reduce((s, p) => s + p.minutes, 0));
  const last = out[out.length - 1];
  if (extra > 0 && last && !last.split && last.minutes < max) {
    const add = Math.min(extra, max - last.minutes);
    last.minutes += add;
    last.padded = true;
    extra -= add;
  }
  while (extra > 0) {
    const m = Math.min(extra, max);
    out.push({ ids: [], titles: [], minutes: m, carried: false });
    extra -= m;
  }
  const targetTitle = share?.titles.length === 1 ? share.titles[0] : name;
  return out.map((p) => {
    const many = `${name} ×${p.ids.length}`;
    let base;
    if (p.split) base = p.split;
    else if (p.padded) base = p.ids.length > 1 ? many : name;
    else if (p.ids.length === 1) base = p.titles[0];
    else base = p.ids.length ? many : targetTitle;
    return { ids: p.ids, minutes: p.minutes, carried: p.carried, base };
  });
}

export function demand({ doc, today, days, config, links, covered = new Map(), usedKeys = new Map(), todayClosed = false }) {
  const idx = doneIndex(doc);
  const offs = timeOff(doc);
  const off = (item, d) => offs.length > 0 && excused(doc, item, d, offs);
  const linked = new Set(links.map((l) => l.habitId));
  const linkedAreas = new Set(links.map((l) => norm(l.area)).filter(Boolean));
  const active = values(doc.items).filter((i) => i.status === 'active').sort(byOrder);
  const inWindow = new Set(days);
  const lastDay = days[days.length - 1];
  const thisMonday = weekStart(today);

  // The day a task is planned on: its date (today if it's overdue), moved past any time off for it.
  const dueDays = new Map();
  const dueDay = (i) => {
    if (!dueDays.has(i.id)) {
      let d = i.date < today ? today : i.date;
      while (d <= lastDay && off(i, d)) d = addDays(d, 1);
      dueDays.set(i.id, d);
    }
    return dueDays.get(i.id);
  };

  // A times-a-week habit: what's left this week spread over its remaining days; next week's n over
  // the whole of next week. Days off for it don't count.
  const perWeekDays = new Map();
  for (const h of active.filter((i) => i.type === 'habit' && i.repeat?.kind === 'perWeek' && !linked.has(i.id))) {
    const picks = new Set();
    for (const monday of [...new Set(days.map(weekStart))]) {
      const week = Array.from({ length: 7 }, (_, n) => addDays(monday, n));
      let left = h.repeat.n;
      let candidates = week;
      if (monday === thisMonday) {
        left -= doneBetween(doc, h.id, monday, addDays(today, 1), idx);
        const doneToday = doneDays(doc, h.id, idx).has(today);
        candidates = week.filter((d) => d > today || (d === today && !doneToday && !todayClosed));
      }
      for (const d of evenPicks(candidates.filter((d) => !off(h, d)), left)) if (inWindow.has(d)) picks.add(d);
    }
    perWeekDays.set(h.id, picks);
  }

  // A weekly time target's share of each day, by area, over the days not off for it.
  const shares = new Map();
  for (const q of active.filter((i) => i.type === 'quota' && i.unit === 'minutes' && !linkedAreas.has(norm(i.area)))) {
    const remaining = Math.max(0, q.target - weekTotal(doc, q.id, today));
    const daysLeft = days.filter((d) => weekStart(d) === thisMonday && (d !== today || !todayClosed) && !off(q, d));
    for (const d of days) {
      if (off(q, d)) continue;
      const minutes = weekStart(d) === thisMonday
        ? (daysLeft.includes(d) ? ceil15(remaining / daysLeft.length) : 0)
        : ceil15(q.target / 7);
      if (!minutes) continue;
      const a = norm(q.area);
      const byDay = shares.get(a) ?? new Map();
      const s = byDay.get(d) ?? { minutes: 0, titles: [], area: String(q.area ?? '').trim() };
      s.minutes += minutes;
      s.titles.push(q.title);
      byDay.set(d, s);
      shares.set(a, byDay);
    }
  }

  const blocks = [];
  for (const d of days) {
    const skip = covered.get(d) ?? new Set();
    const groups = new Map();
    const add = (item, carried) => {
      const a = norm(item.area);
      const g = groups.get(a) ?? { area: String(item.area ?? '').trim(), entries: [] };
      g.entries.push({ item, carried });
      groups.set(a, g);
    };
    for (const i of active) {
      if (skip.has(i.id)) continue;
      if (i.type === 'task' && !i.time) {
        if (doneDays(doc, i.id, idx).size) continue;
        if (dueDay(i) === d) add(i, i.date < d);
      } else if (i.type === 'habit' && !linked.has(i.id) && !i.time) {
        if (doneDays(doc, i.id, idx).has(d) || off(i, d)) continue;
        const due = i.repeat?.kind === 'perWeek' ? perWeekDays.get(i.id)?.has(d) : isHabitDue(doc, i, d, idx);
        if (due) add(i, false);
      }
    }
    for (const [a, byDay] of shares) {
      if (byDay.has(d) && !groups.has(a)) groups.set(a, { area: byDay.get(d).area, entries: [] });
    }
    const used = usedKeys.get(d) ?? new Set();
    for (const [a, g] of [...groups].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
      g.entries.sort((x, y) => Number(y.carried) - Number(x.carried) || byOrder(x.item, y.item));
      const areaFirst = config.priorityAreas.some((p) => norm(p) === a);
      let n = 0;
      for (const p of parts(g.entries, shares.get(a)?.get(d), g.area || 'Tasks', config)) {
        while (used.has(`${d}|${a}|${n}`)) n++;
        const priority = areaFirst || p.ids.some((id) => doc.items[id]?.priority === true);
        blocks.push({ key: `${d}|${a}|${n++}`, day: d, area: g.area, items: p.ids, minutes: p.minutes, carried: p.carried, base: p.base, priority });
      }
    }
  }
  return { blocks };
}
