// The tool's read commands: the dashboard as short plain text for Claude, with an id on every
// line to act on. Each is (doc, today, arg) => string and starts with header().

import {
  todayRows, streak, weekTotal, doneBetween, doneIndex, milestonesOf, goalProgress, history, dayDetail,
  dayCompletion,
} from '../js/schedule.js';
import { longDate, weekStart, addDays, shortWeekday, carryLabel, forLabel } from '../js/dates.js';
import { formatProgress } from '../js/parse.js';
import { openFlags } from '../js/flags.js';
import { changeList } from '../js/changes.js';
import {
  readPlannerConfig, dayRecord, plannerStatus, plannerNotes, clockLabel, offLine, briefFor, isPriority, timeOff, offText,
} from '../js/calendar.js';
import { attention } from '../js/attention.js';
import {
  gymConfig, gymStatusLines, liftSummary, workouts, cardioOf, cardioQuotaId, gymHabitId, sessionLine, kgText,
} from '../js/gym.js';
import { guideFor, recentEntries, talksOn, entryOf, slotName } from '../js/talk.js';

// A row's notes, on their own indented line under it.
const withNote = (line, item) => (item.notes ? `${line}\n      note: ${String(item.notes).replace(/\s+/g, ' ').slice(0, 300)}` : line);
import { shortId } from './ids.js';
import { q, dayName, when, toDay, TYPE_NAMES, repeatText, amountText } from './text.js';

const SOURCES = { claude: 'Claude', gemini: 'Gemini', hebrew: 'Hebrew app', notion: 'Notion', coach: 'the Coach' };
const by = (rec) => (SOURCES[rec.source] ? ` · by ${SOURCES[rec.source]}` : '');
const tag = (id) => `#${shortId(id)}`;
const values = (map) => Object.values(map ?? {});
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
const live = (doc) => values(doc.items).filter((i) => i.status === 'active').sort(byOrder);

export function header(doc, today) {
  const { done, total } = dayCompletion(doc, today);
  return `Today is ${longDate(today)} (${today}) · ${done} of ${total} done`;
}

function rowLine(doc, row, today, idx) {
  const { item } = row;
  const mark = row.suggested ? '?' : row.done ? '[x]' : '[ ]';
  const star = !row.suggested && item.type !== 'quota' && isPriority(doc, item) ? '★ ' : '';
  const parts = [`${mark} ${star}${TYPE_NAMES[item.type]} ${q(item.title)} ${tag(item.id)}`];
  if (row.suggested && item.type === 'task' && item.date && item.date !== today) parts.push(forLabel(item.date, today));
  if (row.carriedFrom) parts.push(carryLabel(row.carriedFrom, today));
  if (item.type === 'habit' && !row.suggested) {
    const s = streak(doc, item, today);
    if (s.current > 1) parts.push(`streak ${s.current}`);
    if (item.repeat?.kind === 'perWeek') {
      const start = weekStart(today);
      parts.push(`${doneBetween(doc, item.id, start, addDays(start, 7), idx)} of ${item.repeat.n} this week`);
    }
  }
  if (item.type === 'quota') {
    const total = row.total ?? weekTotal(doc, item.id, today);
    parts.push(`${formatProgress(total, item.target, item.unit)}${item.unitLabel ? ` ${item.unitLabel}` : ''} this week`);
  }
  if (item.area) parts.push(item.area);
  return withNote(`  ${parts.join(' · ')}${by(item)}`, item);
}

function today(doc, day) {
  const rows = todayRows(doc, day);
  const idx = doneIndex(doc);
  const out = [header(doc, day)];
  const brief = briefFor(doc, day);
  if (brief) out.push(`Claude's brief: ${brief}`);
  const off = offLine(doc, day);
  if (off) out.push(off);
  const groups = [
    ['Suggested (waiting for ✓/✕ in the app)', rows.filter((r) => r.suggested)],
    ['To do', rows.filter((r) => !r.suggested && !r.done)],
    ['Done', rows.filter((r) => !r.suggested && r.done)],
  ];
  for (const [name, list] of groups) {
    if (list.length) out.push(`${name}:`, ...list.map((r) => rowLine(doc, r, day, idx)));
  }
  if (!rows.length) out.push('Nothing on today.');
  return out.join('\n');
}

function week(doc, day) {
  const idx = doneIndex(doc);
  const start = weekStart(day);
  const out = [header(doc, day), `This week (from ${dayName(start, day)}):`];
  for (const i of live(doc).filter((x) => x.type === 'quota')) {
    const total = weekTotal(doc, i.id, day);
    out.push(`  target ${q(i.title)} ${tag(i.id)} · ${formatProgress(total, i.target, i.unit)}${i.unitLabel ? ` ${i.unitLabel}` : ''}${total >= i.target ? ' · met' : ''}`);
  }
  for (const i of live(doc).filter((x) => x.type === 'habit' && x.repeat?.kind === 'perWeek')) {
    const n = doneBetween(doc, i.id, start, addDays(start, 7), idx);
    out.push(`  habit ${q(i.title)} ${tag(i.id)} · ${n} of ${i.repeat.n}${n >= i.repeat.n ? ' · met' : ''}`);
  }
  if (out.length === 2) out.push('  No weekly targets or times-a-week habits.');
  const offs = timeOff(doc).filter((o) => o.end.slice(0, 10) >= day);
  if (offs.length) out.push('Time off coming:', ...offs.map((o) => `  ${offText(o)} ${tag(o.id)}`));
  out.push(...calendarLines(doc, day));
  return out.join('\n');
}

// What the planner booked for the next seven days, from its day records (js/calendar.js).
function calendarLines(doc, day) {
  const line = (b) => `${b.state === 'rough' ? '~' : ''}${clockLabel(b.start)}–${clockLabel(b.end)} ${String(b.title).replace(/^~ /, '')}`;
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(day, i);
    const blocks = dayRecord(doc, d)?.blocks ?? [];
    if (blocks.length) out.push(`  ${dayName(d, day)}: ${blocks.map(line).join(' · ')}`);
  }
  return out.length ? ['Calendar, as the planner booked it (~ = rough):', ...out] : ["Calendar: the planner hasn't booked anything yet."];
}

// The calendar planner: when it last ran, its settings, anything it couldn't use, its notes today.
function plannerRead(doc, day) {
  const { config, problems } = readPlannerConfig(doc);
  const s = plannerStatus(doc);
  const out = [header(doc, day)];
  out.push(s
    ? `Calendar planner: last ran ${when(s.lastRun)}${s.paused ? ' · paused' : ''}${s.version ? ` · build ${s.version}` : ''}`
    : "Calendar planner: hasn't run yet.");
  if (s?.lastError) out.push(`  Last problem: ${s.lastError}`);
  out.push(`Settings: hours ${config.hours[0]}–${config.hours[1]} · gapMinutes ${config.gapMinutes} · defaultMinutes ${config.defaultMinutes} · maxBlockMinutes ${config.maxBlockMinutes} · days ${config.days} · exactDays ${config.exactDays} · firmUpHour ${config.firmUpHour}`);
  out.push(`  areaCalendars: ${Object.entries(config.areaCalendars).map(([a, c]) => `${a} → ${c}`).join(', ') || 'none'} · defaultCalendar: ${config.defaultCalendar}`);
  out.push(`  habitEvents: ${config.habitEvents.map((l) => `${l.habit} → "${l.title}" on ${l.calendar}`).join(', ') || 'none'}`);
  out.push(`  ignore: ${config.ignore.join(', ') || 'nothing'}`);
  out.push(`  priorityAreas: ${config.priorityAreas.join(', ') || 'none'} · areaColors: ${Object.entries(config.areaColors).map(([a, c]) => `${a} → ${c}`).join(', ') || 'none'}`);
  out.push(`  dayHours: ${Object.entries(config.dayHours).map(([d, [f, t]]) => `${d} ${f}–${t}`).join(', ') || 'none'}`);
  out.push(`  Colours George's calendars take (not for areas): ${s?.takenColors?.length ? s.takenColors.join(', ') : 'not known until the planner runs'}`);
  // George's calendars by name, because without them anyone looking at his calendar from outside the
  // dashboard has to guess what they're called — and guessing one out of seven once had a whole
  // session concluding the planner was broken when it was working perfectly well.
  if (s?.calendars?.length) {
    const named = s.calendars.map((c) => `${c.name.trim()}${c.primary ? ' (main)' : ''}${c.watched ? '' : ' — ignored'}`);
    out.push(`  George's calendars: ${named.join(' · ')}`);
    out.push("  Those are the names Google knows them by. Read them all before deciding what's on his calendar; one of them is not the picture.");
  }
  for (const p of problems) out.push(`  ! ${p}`);
  const notes = plannerNotes(doc, day);
  out.push(notes.length ? 'Its notes today:' : 'No notes from it today.', ...notes.map((n) => `  ${n}`));
  return out.join('\n');
}

function goals(doc, day) {
  const list = values(doc.goals)
    .filter((g) => g.status === 'active' || g.status === 'suggested')
    .sort((a, b) => (a.status === b.status ? byOrder(a, b) : a.status === 'suggested' ? -1 : 1));
  const out = [header(doc, day)];
  if (!list.length) out.push('No goals.');
  for (const g of list) {
    const p = goalProgress(doc, g);
    const progress = p.numeric
      ? `${amountText(p.done, 'count', g.unitLabel)} of ${amountText(p.total, 'count', g.unitLabel)} (${p.pct}%)`
      : `${p.done} of ${p.total} milestones (${p.pct}%)`;
    const due = g.targetDate ? ` · by ${dayName(g.targetDate, day)}` : '';
    out.push(`${g.status === 'suggested' ? '? suggested ' : ''}goal ${q(g.title)} ${tag(g.id)} · ${progress}${due}${by(g)}`);
    if (g.why) out.push(`  why: ${g.why}`);
    for (const m of milestonesOf(doc, g.id)) {
      out.push(`  ${m.status === 'suggested' ? '?' : m.done ? '[x]' : '[ ]'} milestone ${q(m.title)} ${tag(m.id)}`);
    }
    const linked = values(doc.items)
      .filter((x) => x.goalId === g.id && (x.status === 'active' || x.status === 'suggested'))
      .sort(byOrder);
    for (const i of linked) out.push(`  · ${i.status === 'suggested' ? 'suggested ' : ''}${TYPE_NAMES[i.type]} ${q(i.title)} ${tag(i.id)}`);
  }
  return out.join('\n');
}

function list(doc, day) {
  const items = live(doc);
  const out = [header(doc, day)];
  const section = (name, rows) => { if (rows.length) out.push(`${name}:`, ...rows); };
  const area = (i) => (i.area ? ` · ${i.area}` : '');
  const star = (i) => (isPriority(doc, i) ? ' · ★' : '');
  section('Upcoming tasks', items
    .filter((i) => i.type === 'task' && i.date > day)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : byOrder(a, b)))
    .map((i) => withNote(`  task ${q(i.title)} ${tag(i.id)} · ${dayName(i.date, day)}${area(i)}${star(i)}${by(i)}`, i)));
  section('Habits', items.filter((i) => i.type === 'habit')
    .map((i) => withNote(`  habit ${q(i.title)} ${tag(i.id)} · ${repeatText(i.repeat)}${area(i)}${star(i)}${by(i)}`, i)));
  section('Weekly targets', items.filter((i) => i.type === 'quota')
    .map((i) => `  target ${q(i.title)} ${tag(i.id)} · ${amountText(i.target, i.unit, i.unitLabel)} a week${area(i)}${by(i)}`));
  if (out.length === 1) out.push('Nothing beyond today.');
  return out.join('\n');
}

function find(doc, day, words) {
  const needle = String(words ?? '').trim().toLowerCase();
  if (!needle) throw new Error('find needs some words to look for');
  const kinds = { items: (r) => TYPE_NAMES[r.type], goals: () => 'goal', milestones: () => 'milestone', flags: () => 'flag' };
  const hits = [];
  for (const [map, kind] of Object.entries(kinds)) {
    for (const r of values(doc[map])) {
      if (r.status === 'dismissed') continue;
      const text = r.title ?? r.text ?? '';
      if (!text.toLowerCase().includes(needle)) continue;
      const extra = [r.status !== 'active' ? r.status : null, r.type === 'task' && r.date ? dayName(r.date, day) : null].filter(Boolean);
      hits.push(`  ${kind(r)} ${q(text)} ${tag(r.id)}${extra.length ? ` · ${extra.join(' · ')}` : ''}`);
    }
  }
  return [header(doc, day), hits.length ? `Matches for ${q(needle)}:` : `Nothing matches ${q(needle)}.`, ...hits].join('\n');
}

function day(doc, today, arg) {
  const d = toDay(arg || 'today', today);
  const { rows, amounts } = dayDetail(doc, d);
  const { done, total } = dayCompletion(doc, d);
  const out = [header(doc, today), `${longDate(d)} (${d}) · ${done} of ${total} done`];
  const off = offLine(doc, d);
  if (off) out.push(off);
  for (const r of rows) out.push(`  ${r.done ? '[x]' : '[ ]'} ${TYPE_NAMES[r.item.type]} ${q(r.item.title)} ${tag(r.item.id)}`);
  for (const { log, item, goal } of amounts) {
    const on = item ?? goal;
    const label = item ? item.unitLabel : goal?.unitLabel;
    out.push(`  logged ${amountText(log.amount, item?.unit ?? 'count', label ?? '')} on ${q(on?.title ?? '?')} ${tag(log.id)}${log.note ? ` · ${log.note}` : ''}`);
  }
  if (!rows.length && !amounts.length) out.push('  Nothing on this day.');
  return out.join('\n');
}

function hist(doc, today) {
  const cells = history(doc, today);
  const out = [header(doc, today), 'Last three weeks (done of total):'];
  for (let w = 0; w < 3; w++) {
    const days = cells.slice(w * 7, w * 7 + 7);
    out.push(`  w/c ${dayName(days[0].day, today)}: ${days.map((c) => `${shortWeekday(c.day)} ${c.future ? '–' : `${c.done}/${c.total}`}`).join(' · ')}`);
  }
  return out.join('\n');
}

// The journal: your guide for the Coach this week, the last 14 days' entries from conversations
// with the Coach, the latest weekly digest, and the last evening check-ins from before the Coach
// talked.
function journal(doc, today) {
  const recs = values(doc.journal).filter((r) => r.status === 'active');
  const newest = (a, b) => (a.day < b.day ? 1 : -1);
  const digest = recs.filter((r) => r.kind === 'digest').sort(newest)[0];
  const checkins = recs.filter((r) => r.kind === 'checkin').sort(newest).slice(0, 3);
  const out = [header(doc, today)];
  const guide = guideFor(doc, today);
  out.push(guide ? `Your guide for the Coach this week: ${guide}` : 'No guide for the Coach this week yet.');
  const entries = recentEntries(doc, today, { days: 14, limit: 60 });
  out.push(entries.length ? 'Journal entries from conversations with the Coach (last 14 days, newest first):' : 'No journal entries in the last 14 days.');
  for (const e of entries) {
    out.push(`  ${dayName(e.day, today)}, ${slotName(e.slot).toLowerCase()}${e.feeling ? ` · ${e.feeling}` : ''}: ${e.text.replace(/\s+/g, ' ')}`);
    for (const p of e.pointers ?? []) out.push(`    pointer: ${p}`);
    for (const f of e.forClaude ?? []) out.push(`    for you: ${f}`);
  }
  if (entries.length) out.push('  (A day\'s conversations in full: talk <day>.)');
  if (digest) {
    out.push(`Weekly digest, week of ${dayName(digest.day, today)}:`, `  ${digest.summary}`);
    if (digest.wins?.length) out.push(`  Went well: ${digest.wins.join('; ')}`);
    if (digest.slipped?.length) out.push(`  Slipped: ${digest.slipped.join('; ')}`);
    if (digest.focus) out.push(`  Focus: ${digest.focus}`);
  } else {
    out.push('No weekly digest yet.');
  }
  for (const c of checkins) {
    out.push(`Check-in, ${dayName(c.day, today)}:`);
    (c.questions ?? []).forEach((question, i) => out.push(`  Q: ${question}`, `  A: ${c.answers?.[i] || '(not answered)'}`));
    if (c.feedback) out.push(`  Coach: ${c.feedback}`);
  }
  if (!checkins.length) out.push('No check-ins yet.');
  return out.join('\n');
}

// Open flags in full: George's own, yours, and the Coach's handoffs from his conversations.
function flags(doc, today) {
  const open = openFlags(doc);
  return [header(doc, today), open.length ? 'Open flags (newest first):' : 'No open flags.',
    ...open.map((f) => `  ${q(String(f.text).replace(/\s+/g, ' '), 1000)} ${tag(f.id)} · ${when(f.updated)}${by(f)}`)].join('\n');
}

function changes(doc, today, arg) {
  const n = Number(arg) > 0 ? Math.floor(Number(arg)) : 10;
  const list = changeList(doc).slice(0, n);
  const state = (c) => (c.undoneAt ? ' · undone' : c.pruned ? ' · too old to undo' : '');
  return [header(doc, today), list.length ? `Claude's last ${list.length} changes (newest first):` : "Claude hasn't changed anything yet.",
    ...list.map((c) => `  ${tag(c.id)} · ${when(c.at)} · ${c.summary}${c.source === 'coach' ? ' · by the Coach' : ''}${state(c)}`)].join('\n');
}

// A day's conversations with the Coach, in full, with what it did and the entry each left.
function talkRead(doc, today, arg) {
  const d = toDay(arg || 'today', today);
  const talks = talksOn(doc, d);
  const out = [header(doc, today), talks.length ? `Conversations with the Coach, ${dayName(d, today)}:` : `No conversations with the Coach on ${dayName(d, today)}.`];
  for (const t of talks) {
    out.push(`${slotName(t.slot)}${t.done ? '' : ' (still open)'}${t.pruned ? ' — over 30 days old: only its entry is kept' : ''}:`);
    for (const m of t.messages ?? []) {
      out.push(`  ${m.who === 'george' ? 'George' : 'Coach'}: ${String(m.text).replace(/\s+/g, ' ')}`);
      for (const x of m.did ?? []) out.push(`    did: ${x.text}`);
    }
    for (const x of t.handoffs ?? []) out.push(`  for you: ${x}`);
    const e = entryOf(doc, d, t.slot);
    if (e) out.push(`  Entry${e.feeling ? ` (${e.feeling})` : ''}: ${e.text.replace(/\s+/g, ' ')}`);
  }
  return out.join('\n');
}

// What needs Claude's attention (js/attention.js).
function attentionRead(doc, day) {
  const lines = attention(doc, day);
  return [header(doc, day), lines.length ? 'Needs attention:' : 'Nothing needs attention.', ...lines.map((l) => `  ${l}`)].join('\n');
}

// Training from Hevy (js/gym.js): the connection, each key lift, cardio by week, the last 14 days'
// sessions, and the settings.
function gymRead(doc, day) {
  const config = gymConfig(doc);
  const out = [header(doc, day), ...gymStatusLines(doc, (iso) => when(iso))];
  out.push('Key lifts (estimated 1RM, Epley, from sets of 1–12 reps):');
  for (const lift of config.keyLifts) {
    const s = liftSummary(doc, lift, day, config);
    if (!s) { out.push(`  ${lift}: no sessions yet`); continue; }
    const parts = [`est. 1RM ${kgText(s.e1rm)} kg`, `last ${kgText(s.last.kg)} × ${s.last.reps} ${dayName(s.last.day, day)}`];
    parts.push(s.prDay ? `last PR ${dayName(s.prDay, day)}${s.pr ? ' (that session)' : ''}` : 'no PR yet');
    if (s.repNote) parts.push(`${s.repNote} at that weight`);
    parts.push(s.pace != null ? `pace ${s.pace >= 0 ? '+' : ''}${s.pace} kg/wk over 8 weeks` : 'pace: needs 4 sessions in 8 weeks');
    if (s.target) parts.push(s.projection?.reached ? `target ${kgText(s.target)} reached` : s.projection ? `target ${kgText(s.target)} → ~${s.projection.label}` : `target ${kgText(s.target)}, no projection yet`);
    parts.push(`${s.sessions} session${s.sessions === 1 ? '' : 's'}`);
    out.push(`  ${lift}: ${parts.join(' · ')}`);
  }
  const quota = cardioQuotaId(doc, config);
  const all = workouts(doc);
  const weeks = [0, 1, 2, 3].map((n) => {
    const start = addDays(weekStart(day), -7 * n);
    const minutes = Math.round(all.filter((w) => w.day >= start && w.day <= addDays(start, 6)).reduce((m, w) => m + cardioOf(w).minutes, 0));
    return `${n === 0 ? 'this week' : `w/c ${dayName(start, day)}`} ${minutes} min`;
  });
  out.push(quota
    ? `Cardio target ${q(doc.items[quota].title)} ${tag(quota)} · ${formatProgress(weekTotal(doc, quota, day), doc.items[quota].target, 'minutes')} this week`
    : 'Cardio: no target linked — set one with {"op": "gym", "cardioQuota": "<a weekly target in minutes>"}');
  out.push(`  From Hevy: ${weeks.join(' · ')}`);
  const recent = all.filter((w) => w.day > addDays(day, -14) && w.day <= day);
  out.push(recent.length ? 'Last 14 days:' : 'No sessions in the last 14 days.');
  for (const w of [...recent].reverse()) out.push(`  ${dayName(w.day, day)}: ${sessionLine(doc, w, config)}`);
  const habit = gymHabitId(doc, config);
  const targets = Object.entries(config.liftTargets).map(([l, kg]) => `${l} ${kgText(kg)}`).join(', ') || 'none';
  out.push(`Settings: keyLifts ${config.keyLifts.join(', ')} · liftTargets ${targets} · habit ${habit ? `${q(doc.items[habit].title)} ${tag(habit)}` : `"${config.habit}" (no single live habit matches)`}`);
  return out.join('\n');
}

export const READS = {
  today, week, goals, list, find, day, history: hist, journal, talk: talkRead, flags, changes, planner: plannerRead, attention: attentionRead, gym: gymRead,
};
