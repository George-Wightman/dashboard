// The phone's home-screen widgets (android/): each a small copy of a Daylight tile — the day as a short
// calendar, Fuel, Hebrew, Body, Goals, Countdown and This week. The planner's web app answers a widget
// with this (planner/glance.js), so what a widget says can change without a new app on the phone: the
// app only lays out a title, a big number with its caption, and a few lines, and opens the dashboard
// on that tile, big, when tapped. Pure.

import { todayRows, weekTotal, doneBetween, dayCompletion, goalProgress, duolingoOn } from './schedule.js';
import { todaySlots, clockLabel, countdowns, daysLeft, excused } from './calendar.js';
import { scheduleView, localDate } from './plan-state.js';
import { movedSlot } from './timeline.js';
import { mealsOn, dayProtein, weekKcal, fuelSettings, mealValue, slotName } from './food.js';
import { formatProgress } from './parse.js';
import { weekStart, addDays, shortWeekday, shortDate, longDate } from './dates.js';
import { HEBREW_IDS } from './hebrewSync.js';
import { cardioQuotaId, gymHabitId } from './gym.js';
import { nextSession, BACK } from './coach.js';
import { mapToday, glanceMap } from './map/summary.js';

export const SITE = 'https://george-wightman.github.io/dashboard/';
export const GLANCE_TILES = ['day', 'fuel', 'hebrew', 'body', 'goals', 'countdown', 'week', 'map'];
const LINES = 8;

const values = (o) => Object.values(o ?? {});
const active = (doc, id) => (doc.items?.[id]?.status === 'active' ? doc.items[id] : null);
const open = (tile) => (tile === 'day' ? SITE : `${SITE}?big=${tile}`);
const kcal = (n) => Math.round(n).toLocaleString('en-GB');

// The day as a short calendar: what has a time today in order (shifts too), then how many have none.
function day(doc, today, now) {
  const rows = todayRows(doc, today).filter((r) => !r.suggested && !r.blocked && r.kind !== 'quota');
  const slots = todaySlots(doc, today);
  const timed = [];
  let anytime = 0;
  for (const r of rows) {
    const s = movedSlot(r.item, slots.get(r.item.id), today);
    if (s) timed.push({ start: s.start, end: s.end, text: r.item.title, done: r.done });
    else if (!r.done) anytime++;
  }
  for (const c of scheduleView(doc, today).commitments) {
    if (!c.allDay && localDate(c.start) === today) timed.push({ start: c.start, end: c.end, text: c.title, busy: true });
  }
  timed.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  // What's over drops to one line, so the widget shows what's still to come.
  const over = timed.filter((e) => Date.parse(e.end ?? e.start) <= +now);
  const ahead = timed.filter((e) => !over.includes(e));
  const next = ahead.find((e) => !e.done);
  const lines = ahead.map((e) => `${e === next ? '▸ ' : ''}${clockLabel(e.start)}  ${e.done ? '✓ ' : ''}${e.text}${e.busy ? ' (until ' + clockLabel(e.end) + ')' : ''}`);
  const overTasks = over.filter((e) => !e.busy);
  if (overTasks.length) lines.unshift(`${overTasks.filter((e) => e.done).length} of ${overTasks.length} earlier done`);
  if (anytime) lines.push(`+ ${anytime} any time today`);
  const { done, total } = dayCompletion(doc, today);
  return {
    title: longDate(today).replace(/ \w+$/, ''), number: `${done}/${total}`, caption: 'done today',
    lines: lines.length ? lines : ['Nothing on today.'], open: open('day'),
  };
}

function fuel(doc, today) {
  const { protein: target } = fuelSettings(doc);
  const lines = mealsOn(doc, today).map((m) => {
    const v = mealValue(m);
    return `${slotName(m.slot)}: ${m.estimate?.name ?? m.text ?? ''}${v ? ` · ${v.protein} g` : ' · waiting'}`;
  });
  const { average } = weekKcal(doc, today);
  if (average != null) lines.push(`This week ≈${kcal(average)} kcal a day`);
  return {
    title: 'Fuel', number: `${dayProtein(doc, today)} g`, caption: `of ${target} g protein today`,
    lines: lines.length ? lines : ['Nothing logged yet today.'], open: open('fuel'),
  };
}

function hebrew(doc, today) {
  const minutes = active(doc, HEBREW_IDS.minutes);
  if (!minutes) return null;
  const total = Math.round(weekTotal(doc, minutes.id, today));
  const lines = [];
  for (const key of ['spoken', 'live']) {
    const q = active(doc, HEBREW_IDS[key]);
    if (q) lines.push(`${Math.round(weekTotal(doc, q.id, today))} of ${q.target} ${q.unitLabel || q.title}`);
  }
  const monday = weekStart(today);
  const strip = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    if (d > today) return '·';
    const m = values(doc.logs).filter((l) => l.status === 'active' && l.itemId === minutes.id && l.kind === 'amount' && l.day === d).reduce((s, l) => s + l.amount, 0);
    return m >= 30 ? '●' : m > 0 ? '◐' : duolingoOn(doc, HEBREW_IDS.habit, d) > 0 ? '◔' : '○';
  }).join('');
  lines.push(`${strip}  Mon–Sun`);
  return {
    title: 'Hebrew', number: `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`,
    caption: `of ${Number((minutes.target / 60).toFixed(1))} h this week`, lines, open: open('hebrew'),
  };
}

function body(doc, today) {
  const lines = [];
  const gym = active(doc, gymHabitId(doc));
  if (gym?.repeat?.kind === 'perWeek') {
    const monday = weekStart(today);
    lines.push(`Gym ${doneBetween(doc, gym.id, monday, addDays(monday, 7))} of ${gym.repeat.n} this week`);
  }
  const next = nextSession(doc, today);
  if (next) lines.push(`Next: ${next.title} · ${next.date === today ? 'today' : `${shortWeekday(next.date)} ${shortDate(next.date)}`}`);
  const back = doc.gym?.[`back:${today}`];
  if (back?.status === 'active' && BACK[back.score]) lines.push(`Back this morning: ${BACK[back.score]}`);
  const cardio = active(doc, cardioQuotaId(doc));
  if (!cardio && !lines.length) return null;
  return {
    title: 'Body', number: cardio ? String(Math.round(weekTotal(doc, cardio.id, today))) : '',
    caption: cardio ? `of ${cardio.target} cardio min this week` : '', lines, open: open('body'),
  };
}

function goals(doc) {
  const list = values(doc.goals).filter((g) => g.status === 'active' && g.id !== HEBREW_IDS.goal)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!list.length) return null;
  const lines = list.map((g) => {
    const p = goalProgress(doc, g);
    const by = g.targetDate ? ` · by ${shortDate(g.targetDate)}` : '';
    return `${g.title}: ${p.numeric ? `${p.pct}%` : `${p.done} of ${p.total}`}${by}`;
  });
  return { title: 'Goals', number: String(list.length), caption: list.length === 1 ? 'goal on the go' : 'goals on the go', lines, open: open('goals') };
}

function countdown(doc, today) {
  const list = countdowns(doc, today);
  if (!list.length) return null;
  const [first, ...rest] = list;
  return {
    title: 'Countdown', number: first.days > 1 ? String(first.days) : daysLeft(first.days), caption: `${first.days > 1 ? 'days to ' : ''}${first.title}`,
    lines: rest.map((c) => `${c.title} · ${daysLeft(c.days)} · ${shortWeekday(c.day)} ${shortDate(c.day)}`), open: open('countdown'),
  };
}

// The weekly targets the Hebrew and Body widgets don't already show.
function week(doc, today) {
  const cardio = cardioQuotaId(doc);
  const targets = values(doc.items)
    .filter((i) => i.type === 'quota' && i.status === 'active' && i.id !== cardio && i.goalId !== HEBREW_IDS.goal && !excused(doc, i, today))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!targets.length) return null;
  const met = targets.filter((q) => weekTotal(doc, q.id, today) >= q.target).length;
  return {
    title: 'This week', number: `${met}/${targets.length}`, caption: 'targets met',
    lines: targets.map((q) => `${q.title}: ${formatProgress(weekTotal(doc, q.id, today), q.target, q.unit)}${q.unit === 'count' && q.unitLabel ? ` ${q.unitLabel}` : ''}`),
    open: open('week'),
  };
}

// The map (js/map/summary.js): only when the planner could read the private map files.
function map(doc, today, now, maps) {
  const got = mapToday(doc, maps, today);
  return got ? glanceMap(got, SITE) : null;
}

const MAKERS = { day, fuel, hebrew, body, goals, countdown, week, map };
const TITLES = { day: 'Today', fuel: 'Fuel', hebrew: 'Hebrew', body: 'Body', goals: 'Goals', countdown: 'Countdown', week: 'This week', map: 'Map' };

// Every widget's content for `today` at `now`. A tile with nothing to show says so, rather than vanish
// from a home screen it was put on.
export function glanceOf(doc, today, now = new Date(), maps = []) {
  const tiles = {};
  for (const id of GLANCE_TILES) {
    let t = null;
    try { t = MAKERS[id](doc, today, now, maps); } catch { t = null; }
    t ??= { title: TITLES[id], number: '', caption: '', lines: ['Nothing to show yet.'], open: open(id) };
    const more = t.lines.length - LINES;
    tiles[id] = { ...t, lines: more > 0 ? [...t.lines.slice(0, LINES - 1), `+ ${more + 1} more`] : t.lines };
  }
  return { at: now.toISOString(), day: today, tiles };
}
