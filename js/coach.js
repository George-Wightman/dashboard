// The coach's view of the document: the plain-text summary Gemini is given, a week's numbers, and
// the small readers the Coach panel needs. Pure: a document and a day in, values out.

import { addDays, weekStart, shortWeekday, shortDate, longDate, carryLabel } from './dates.js';
import {
  rowsForDay, doneIndex, dayCompletion, streak, weekTotal, countsOn, goalProgress, milestonesOf, doneBetween,
} from './schedule.js';
import { formatAmount } from './parse.js';
import { journalId } from './doc.js';
import { GeminiError } from './gemini.js';

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

// ---- Prompts -----------------------------------------------------------------------------------
// Each builder returns { system, prompt } for askGemini. The job texts are the design's, word for
// word; dev/fake-gemini.js recognises a job by finding its text in the prompt.

export const SYSTEM = "You are George's coach inside his personal daily dashboard. Be direct, warm and specific, in British English. Refer to the actual items, numbers and words in the data you are given; never give generic advice or motivational filler. No emojis. Stay within the length limits. Reply with JSON only, in exactly the shape asked for.";

export const JOBS = {
  questions: `Ask George 2 or 3 short questions about today, each answerable in a sentence or two. At least one must name something specific from today — a miss, a win, or a number. The last question is about tomorrow. Shape: {"questions": ["…", "…"]}`,
  feedback: `Reply with feedback of at most 90 words. First one specific thing that went well, if anything did; then the single most useful change for tomorrow, grounded in his answers and the numbers. Don't moralise and don't repeat his answers back to him. Then suggest at most 2 concrete tasks for tomorrow, only if they follow from what he said. Shape: {"feedback": "…", "tomorrow": [{"title": "…"}]}`,
  shape: `Turn this into a plan George can start this week. Don't duplicate anything he already tracks. Prefer small weekly targets he can actually hit. Shape: {"title": "short goal name", "targetDate": "YYYY-MM-DD" or null (only if he gave or implied a deadline), "milestones": ["3 to 6 concrete, checkable steps, in order"], "habits": [0 to 2 of {"title": "…", "repeat": {"kind": "daily"} or {"kind": "weekdays", "days": [1-7…]} or {"kind": "perWeek", "n": 1-7}}], "targets": [0 to 2 of {"title": "…", "target": number, "unit": "count" or "minutes", "unitLabel": "…"}], "why": "one sentence"}`,
  digest: `Write last week's digest, for George and for Claude, who reads it later to help him. Shape: {"summary": "at most 120 words", "wins": [0 to 3 short phrases], "slipped": [0 to 3 short phrases], "focus": "one sentence for this week"}`,
};

const TYPED_CAP = 1000;
const TRACKED_CAP = 80;

// Job A — the check-in questions.
export function questionsPrompt(doc, today) {
  return { system: SYSTEM, prompt: `${coachContext(doc, today)}\n\n${JOBS.questions}` };
}

// Job B — feedback on his answers. A blank answer is sent as "(no answer)".
export function feedbackPrompt(doc, today, questions, answers) {
  const qa = questions.flatMap((q, i) => [`Q: ${clip(q, ANSWER_CAP)}`, `A: ${clip(answers?.[i], TYPED_CAP) || '(no answer)'}`]);
  return {
    system: SYSTEM,
    prompt: `${coachContext(doc, today)}\n\nToday's check-in:\n${qa.join('\n')}\n\n${JOBS.feedback}`,
  };
}

// Every goal and item he tracks or has been offered, so a new plan doesn't repeat them.
function trackedTitles(doc) {
  const live = (r) => r.status === 'active' || r.status === 'suggested';
  return [...values(doc.goals).filter(live).sort(byOrder), ...values(doc.items).filter(live).sort(byOrder)]
    .map((r) => clip(r.title, 80))
    .filter(Boolean);
}

// Job C — shape a goal from what he typed.
export function shapePrompt(doc, today, text) {
  const titles = trackedTitles(doc);
  return {
    system: SYSTEM,
    prompt: [
      coachContext(doc, today),
      '',
      `Today's date: ${today}`,
      `Already tracked: ${titles.length ? titles.slice(0, TRACKED_CAP).join('; ') : 'nothing yet'}`,
      'Days of the week are numbered 1 (Monday) to 7 (Sunday). Time targets are in minutes.',
      `George wrote: ${clip(text, TYPED_CAP)}`,
      '',
      JOBS.shape,
    ].join('\n'),
  };
}

function goalWeekLine(g) {
  const detail = g.numeric
    ? `${formatAmount(g.done, g.unit)} of ${formatAmount(g.total, g.unit)}, ${formatAmount(g.week, g.unit)} this week`
    : `${g.done} of ${g.total} milestones`;
  return `${clip(g.title, 80)} — ${g.pct}% (${detail})`;
}

// Job D — the digest of the week starting `monday`: its numbers, then its check-ins.
export function digestPrompt(doc, monday) {
  const s = weekStats(doc, monday);
  const checkins = values(doc.journal)
    .filter((c) => c.kind === 'checkin' && c.status === 'active' && c.day >= s.monday && c.day <= s.sunday)
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map((c) => {
      const answers = answersOf(c).map((a) => clip(a, ANSWER_CAP)).join(' / ') || '(none)';
      return `${shortWeekday(c.day)}: answers: ${answers} — feedback: ${clip(c.feedback, 400) || '(none)'}`;
    });
  const lines = [
    `Week: ${longDate(s.monday)} to ${longDate(s.sunday)} ${s.sunday.slice(0, 4)}`,
    `Days: ${s.days.map((d) => `${shortWeekday(d.day)} ${d.done}/${d.total}`).join(' · ')}`,
    ...section('Habits:', s.habits.slice(0, ROW_CAP).map((h) => `${clip(h.title, 80)}: ${h.done} of ${h.scheduled}`), s.habits.length, 'none'),
    ...section('Weekly targets:', s.targets.slice(0, TARGET_CAP).map((t) => targetLine(t, t.total)), s.targets.length, 'none'),
    `Tasks: ${s.tasks.done} of ${s.tasks.total} done`,
    ...section('Goals:', s.goals.slice(0, GOAL_CAP).map(goalWeekLine), s.goals.length, 'none'),
    ...section('Check-ins:', checkins, checkins.length, 'none'),
  ];
  return { system: SYSTEM, prompt: `${lines.join('\n')}\n\n${JOBS.digest}` };
}

// ---- Reply parsers -----------------------------------------------------------------------------
// Each takes the JSON askGemini returned and gives back a clean object, or throws the "didn't make
// sense" GeminiError. Strings are trimmed and capped, lists cut to the counts the prompts ask
// for, and any field not asked for is dropped. Nothing is written until a parser has passed.

const nonsense = () => new GeminiError('nonsense');
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const oneLine = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n).trim() : '');
const block = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n).trim() : '');
const lineList = (v, max, n) => (Array.isArray(v) ? v.map((x) => oneLine(x, n)).filter(Boolean).slice(0, max) : []);
const isRealDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && addDays(d, 0) === d;

// → { questions: string[] }  1–3 questions, each at most 300 characters.
export function parseQuestions(data) {
  if (!isObject(data)) throw nonsense();
  const questions = lineList(data.questions, 3, 300);
  if (!questions.length) throw nonsense();
  return { questions };
}

// → { feedback: string, tomorrow: { title }[] }  feedback at most 900 characters; 0–2 tasks.
export function parseFeedback(data) {
  if (!isObject(data)) throw nonsense();
  const feedback = block(data.feedback, 900);
  if (!feedback) throw nonsense();
  const tomorrow = (Array.isArray(data.tomorrow) ? data.tomorrow : [])
    .map((t) => ({ title: oneLine(isObject(t) ? t.title : t, 80) }))
    .filter((t) => t.title)
    .slice(0, 2);
  return { feedback, tomorrow };
}

// Only the three repeats the prompt offers; anything else becomes daily.
function cleanRepeat(r) {
  if (isObject(r) && r.kind === 'weekdays' && Array.isArray(r.days)) {
    const days = [...new Set(r.days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);
    if (days.length) return { kind: 'weekdays', days };
  }
  if (isObject(r) && r.kind === 'perWeek' && typeof r.n === 'number' && Number.isFinite(r.n)) {
    return { kind: 'perWeek', n: Math.min(7, Math.max(1, Math.round(r.n))) };
  }
  return { kind: 'daily' };
}

// A weekly target, or null when it can't be one: a positive number, in minutes for time.
function cleanTarget(t) {
  if (!isObject(t)) return null;
  const unit = t.unit === undefined ? 'count' : t.unit;
  if (unit !== 'count' && unit !== 'minutes') return null;
  const title = oneLine(t.title, 80);
  let target = typeof t.target === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(t.target) ? Number(t.target) : t.target;
  if (typeof target !== 'number' || !Number.isFinite(target)) return null;
  if (unit === 'minutes') target = Math.round(target);
  if (!title || !(target > 0)) return null;
  return { title, target, unit, unitLabel: unit === 'count' ? oneLine(t.unitLabel, 40) : '' };
}

// → { title, targetDate, milestones, habits, targets, why }  targetDate only if it's a real day
// on or after today; up to 6 milestones, 2 habits and 2 targets.
export function parseShape(data, today) {
  if (!isObject(data)) throw nonsense();
  const title = oneLine(data.title, 80);
  if (!title) throw nonsense();
  return {
    title,
    targetDate: isRealDay(data.targetDate) && data.targetDate >= today ? data.targetDate : null,
    milestones: lineList(data.milestones, 6, 80),
    habits: (Array.isArray(data.habits) ? data.habits : [])
      .filter(isObject)
      .map((h) => ({ title: oneLine(h.title, 80), repeat: cleanRepeat(h.repeat) }))
      .filter((h) => h.title)
      .slice(0, 2),
    targets: (Array.isArray(data.targets) ? data.targets : []).map(cleanTarget).filter(Boolean).slice(0, 2),
    why: oneLine(data.why, 300),
  };
}

// → { summary, wins, slipped, focus }  summary at most 1200 characters; 0–3 wins and slips.
export function parseDigest(data) {
  if (!isObject(data)) throw nonsense();
  const summary = block(data.summary, 1200);
  if (!summary) throw nonsense();
  return {
    summary,
    wins: lineList(data.wins, 3, 80),
    slipped: lineList(data.slipped, 3, 80),
    focus: oneLine(data.focus, 300),
  };
}

// ---- The suggested-goal card -------------------------------------------------------------------

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function repeatText(repeat) {
  switch (repeat?.kind) {
    case 'weekdays': return (repeat.days ?? []).map((d) => DAY_NAMES[d - 1]).filter(Boolean).join(', ');
    case 'perWeek': return repeat.n === 1 ? 'once a week' : `${repeat.n} times a week`;
    case 'weekly': return `every ${DAY_NAMES[repeat.day - 1] ?? 'week'}`;
    case 'monthly': return `on day ${repeat.date} of the month`;
    default: return 'every day';
  }
}

// One line for a habit or weekly target a plan proposes, as the suggested-goal card lists it:
// 'Habit: Stretch · Mon, Wed, Fri' · 'Weekly target: Running · 1.5h' · 'Weekly target: Parkruns · 2 runs'.
export function proposalLine(item) {
  if (item.type === 'habit') return `Habit: ${item.title} · ${repeatText(item.repeat)}`;
  if (item.type === 'quota') {
    const unit = item.unit ?? 'count';
    const label = unit === 'count' && item.unitLabel ? ` ${item.unitLabel}` : '';
    return `Weekly target: ${item.title} · ${formatAmount(Number(item.target) || 0, unit)}${label}`;
  }
  return item.title;
}
