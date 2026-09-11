// The coach's view of the document: the plain-text summary Gemini is given, a week's numbers, and
// the small readers the Coach panel needs. Pure: a document and a day in, values out.

import { addDays, weekStart, shortWeekday, shortDate, longDate, carryLabel } from './dates.js';
import {
  rowsForDay, doneIndex, dayCompletion, streak, weekTotal, countsOn, goalProgress, milestonesOf, doneBetween,
} from './schedule.js';
import { formatAmount } from './parse.js';
import { journalId } from './doc.js';

export const CONTEXT_CAP = 4000;
const ROW_CAP = 25;
const TARGET_CAP = 10;
const GOAL_CAP = 8;
const ANSWER_CAP = 300;

const values = (map) => Object.values(map ?? {});
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

// One line of at most n characters: whitespace collapsed, and … where it was cut.
export function clip(text, n) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

// A check-in's non-blank answers.
const answersOf = (checkin) => (Array.isArray(checkin?.answers) ? checkin.answers : [])
  .filter((a) => typeof a === 'string' && a.trim());

// A heading and its lines, with "…and N more" when `lines` is a cut-down `total`, or the heading
// and `none` on one line when there is nothing.
function section(heading, lines, total, none) {
  if (!total) return [`${heading} ${none}`];
  return [heading, ...lines, ...(total > lines.length ? [`…and ${total - lines.length} more`] : [])];
}

function streakText(item, s) {
  if (s.current < 2) return null;
  const kind = item.repeat?.kind ?? 'daily';
  if (kind === 'perWeek') return `${s.current}-week streak`;
  if (kind === 'daily') return `${s.current}-day streak`;
  return `${s.current} in a row`;
}

function rowLine(doc, row, today) {
  const { item } = row;
  const notes = [];
  if (row.carriedFrom) notes.push(`carried ${carryLabel(row.carriedFrom, today)}`);
  if (row.kind === 'habit') {
    const text = streakText(item, streak(doc, item, today));
    if (text) notes.push(text);
  }
  const area = item.area ? ` [${clip(item.area, 30)}]` : '';
  return `${row.done ? '✓' : '✗'} ${clip(item.title, 80)}${area}${notes.length ? ` — ${notes.join(', ')}` : ''}`;
}

// 'Job search: 3.5h of 6h' · 'Applications: 3 of 5'. Works on a quota item or a weekStats target.
function targetLine(target, total) {
  const unit = target.unit ?? 'count';
  const label = unit === 'count' && target.unitLabel ? ` ${clip(target.unitLabel, 30)}` : '';
  return `${clip(target.title, 80)}: ${formatAmount(total, unit)} of ${formatAmount(Number(target.target) || 0, unit)}${label}`;
}

function goalLine(doc, goal) {
  const { pct } = goalProgress(doc, goal);
  const next = milestonesOf(doc, goal.id)
    .filter((m) => m.status === 'active' && !m.done)
    .slice(0, 2)
    .map((m) => clip(m.title, 60));
  const date = goal.targetDate ? `, target ${shortDate(goal.targetDate)}` : '';
  return `${clip(goal.title, 80)} — ${pct}%${date}${next.length ? `; next: ${next.join(', ')}` : ''}`;
}

// ---- Readers -----------------------------------------------------------------------------------

export function checkinOf(doc, day) {
  const rec = doc.journal?.[journalId('checkin', day)];
  return rec && rec.status === 'active' ? rec : null;
}

export function digestOf(doc, monday) {
  const rec = doc.journal?.[journalId('digest', weekStart(monday))];
  return rec && rec.status === 'active' ? rec : null;
}

// Habits and weekly targets Gemini proposed for a goal that are still waiting on Today.
export function proposedItems(doc, goalId) {
  return values(doc.items).filter((i) => i.goalId === goalId && i.status === 'suggested').sort(byOrder);
}

// What the Coach panel shows for today's check-in:
//   'done'      — today's feedback is in (shown even without a key)
//   'nokey'     — no Gemini key on this device
//   'questions' — the questions are saved and waiting for answers
//   'due'       — no check-in yet, and it's the check-in hour or later
//   'early'     — no check-in yet, before the check-in hour
// Hours before the day starts (after midnight) still count as the evening of the logical day.
export function checkinState({ doc, today, now, dayStartHour = 4, checkinHour = 18, hasKey }) {
  const rec = checkinOf(doc, today);
  if (rec?.feedback) return 'done';
  if (!hasKey) return 'nokey';
  if (Array.isArray(rec?.questions) && rec.questions.length) return 'questions';
  const hour = now.getHours();
  return (hour < dayStartHour ? hour + 24 : hour) >= checkinHour ? 'due' : 'early';
}

// ---- The context block -------------------------------------------------------------------------

// Everything Gemini is told about George's day, as compact plain text, never over CONTEXT_CAP.
export function coachContext(doc, today) {
  const idx = doneIndex(doc);
  const rows = rowsForDay(doc, today, idx).filter((r) => r.item.status === 'active');
  const quotas = values(doc.items)
    .filter((q) => q.type === 'quota' && q.status === 'active' && countsOn(q, today))
    .sort(byOrder);
  const goals = values(doc.goals).filter((g) => g.status === 'active').sort(byOrder);
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, -i);
    const { done, total } = dayCompletion(doc, day, idx);
    return `${shortWeekday(day)} ${done}/${total}`;
  });
  const checkins = [1, 2, 3]
    .map((n) => checkinOf(doc, addDays(today, -n)))
    .filter((c) => c && answersOf(c).length)
    .map((c) => `${shortWeekday(c.day)}: ${answersOf(c).map((a) => clip(a, ANSWER_CAP)).join(' / ')}`);

  const lines = [
    `Today: ${longDate(today)} ${today.slice(0, 4)}`,
    ...section("Today's list:", rows.slice(0, ROW_CAP).map((r) => rowLine(doc, r, today)), rows.length, 'nothing scheduled'),
    ...section("This week's targets:", quotas.slice(0, TARGET_CAP).map((q) => targetLine(q, weekTotal(doc, q.id, today))), quotas.length, 'none'),
    `Last 7 days: ${week.join(' · ')}`,
    ...section('Goals:', goals.slice(0, GOAL_CAP).map((g) => goalLine(doc, g)), goals.length, 'none'),
    ...(checkins.length ? ['Recent check-ins (his answers):', ...checkins] : []),
  ];
  const text = lines.join('\n');
  return text.length > CONTEXT_CAP ? `${text.slice(0, CONTEXT_CAP - 1)}…` : text;
}

// ---- A week's numbers --------------------------------------------------------------------------

// The Monday–Sunday week containing `monday` (normally its Monday), for the weekly digest.
export function weekStats(doc, monday) {
  const start = weekStart(monday);
  const end = addDays(start, 6);
  const idx = doneIndex(doc);
  const days = [];
  const habits = new Map();
  const tasks = new Map();
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const rows = rowsForDay(doc, day, idx);
    days.push({ day, done: rows.filter((r) => r.done).length, total: rows.length });
    for (const r of rows) {
      if (r.kind === 'task') {
        tasks.set(r.item.id, (tasks.get(r.item.id) ?? false) || r.done);
        continue;
      }
      const h = habits.get(r.item.id) ?? { id: r.item.id, title: r.item.title, done: 0, scheduled: 0 };
      h.scheduled++;
      if (r.done) h.done++;
      habits.set(r.item.id, h);
    }
  }
  // A few-times-a-week habit stays on the list until it's met, so days listed aren't its target.
  for (const h of habits.values()) {
    const repeat = doc.items[h.id].repeat;
    if (repeat?.kind === 'perWeek') {
      h.done = doneBetween(doc, h.id, start, addDays(start, 7), idx);
      h.scheduled = repeat.n;
    }
  }
  const targets = values(doc.items)
    .filter((q) => q.type === 'quota' && days.some((d) => countsOn(q, d.day)))
    .sort(byOrder)
    .map((q) => ({
      id: q.id, title: q.title, total: weekTotal(doc, q.id, start), target: q.target,
      unit: q.unit ?? 'count', unitLabel: q.unitLabel ?? '',
    }));
  const goals = values(doc.goals)
    .filter((g) => g.status === 'active' && g.created <= end)
    .sort(byOrder)
    .map((g) => {
      const p = goalProgress(doc, g);
      return {
        id: g.id, title: g.title, pct: p.pct, done: p.done, total: p.total, numeric: p.numeric,
        unit: g.unit ?? 'count', week: weekTotal(doc, g.id, start),
      };
    });
  const amounts = values(doc.logs)
    .filter((l) => l.status === 'active' && l.kind === 'amount' && l.day >= start && l.day <= end).length;
  const doneTasks = [...tasks.values()].filter(Boolean).length;
  return {
    monday: start,
    sunday: end,
    days,
    habits: [...habits.values()].sort((a, b) => byOrder(doc.items[a.id], doc.items[b.id])),
    tasks: { done: doneTasks, total: tasks.size },
    targets,
    goals,
    amounts,
    empty: days.every((d) => d.total === 0) && amounts === 0,
  };
}

// Last week's Monday when its digest should be written: none exists yet and the week had any
// counted rows or amounts. Otherwise null.
export function digestDue(doc, today) {
  const monday = addDays(weekStart(today), -7);
  if (digestOf(doc, monday)) return null;
  return weekStats(doc, monday).empty ? null : monday;
}
