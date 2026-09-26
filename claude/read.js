// The tool's read commands: the dashboard as short plain text for Claude, with an id on every
// line to act on. Each is (doc, today, arg) => string and starts with header().

import {
  todayRows, streak, weekTotal, doneBetween, doneIndex, milestonesOf, goalProgress, history, dayDetail,
  dayCompletion, dayScore,
} from '../js/schedule.js';
import { longDate, weekStart, addDays, shortWeekday, carryLabel, forLabel, logicalDay, daysBetween } from '../js/dates.js';
import { formatProgress } from '../js/parse.js';
import { openFlags, FLAG_KINDS, flagKind, flagSourceName } from '../js/flags.js';
import { changeList } from '../js/changes.js';
import {
  readPlannerConfig, dayRecord, plannerStatus, plannerNotes, clockLabel, offLine, briefFor, isPriority, timeOff, offText, countdowns, daysLeft,
} from '../js/calendar.js';
import { attention } from '../js/attention.js';
import {
  gymConfig, gymStatusLines, liftSummary, workouts, cardioOf, cardioQuotaId, gymHabitId, sessionLine, kgText, trainingWeek,
} from '../js/gym.js';
import { checkinsSince } from '../js/checkins.js';

// A row's notes, on their own indented line under it.
const withNote = (line, item) => (item.notes ? `${line}\n      note: ${String(item.notes).replace(/\s+/g, ' ').slice(0, 300)}` : line);
import { shortId } from './ids.js';
import { resolveId } from './ids.js';
import { blockers } from '../js/workflow.js';
import { q, dayName, when, toDay, TYPE_NAMES, repeatText, amountText } from './text.js';

const SOURCES = { claude: 'Claude', gemini: 'Gemini', hebrew: 'Hebrew app', notion: 'Notion', coach: 'the Coach', hevy: 'Hevy', workflow: 'a rule' };
const by = (rec) => (SOURCES[rec.source] ? ` · by ${SOURCES[rec.source]}` : '');
const tag = (id) => `#${shortId(id)}`;
const values = (map) => Object.values(map ?? {});
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
const live = (doc) => values(doc.items).filter((i) => i.status === 'active').sort(byOrder);

export function header(doc, today) {
  const { done, total, pushed } = dayScore(doc, today);
  return `Today is ${longDate(today)} (${today}) · ${done} of ${total} done${pushed.length ? ` · ${pushed.length} pushed` : ''}`;
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
  if (row.blocked) parts.push(row.blocked.join('; '));
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
  const counting = countdowns(doc, day);
  if (counting.length) out.push('Counting down to:', ...counting.map((c) => `  ${q(c.title)} · ${dayName(c.day, day)} (${daysLeft(c.days)}) ${tag(c.id)}`));
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
  const score = dayScore(doc, d);
  const out = [header(doc, today), `${longDate(d)} (${d}) · ${score.done} of ${score.total} done`];
  const off = offLine(doc, d);
  if (off) out.push(off);
  for (const r of rows) out.push(`  ${r.done ? '[x]' : '[ ]'} ${TYPE_NAMES[r.item.type]} ${q(r.item.title)} ${tag(r.item.id)}`);
  // What he committed to that left the day, and what didn't need doing (js/schedule.js's dayScore).
  const named = (list, extra = () => '') => list.map((e) => `${q(e.item.title)} ${tag(e.item.id)}${extra(e)}`).join(', ');
  const commitment = doc.calendar?.[`commit:${d}`];
  if (commitment) out.push(`  Locked at ${clockLabel(commitment.at)} with ${commitment.tasks.length} task${commitment.tasks.length === 1 ? '' : 's'}.`);
  if (score.pushed.length) out.push(`  Pushed after the lock (not counted): ${named(score.pushed, (e) => ` → ${dayName(e.to, today)}`)}`);
  if (score.missed.length) out.push(`  Pushed a second time (counted as missed): ${named(score.missed)}`);
  if (score.dropped.length) out.push(`  Deleted after the lock (counted as missed): ${named(score.dropped)}`);
  if (score.released.length) out.push(`  Released as no longer needed: ${named(score.released, (e) => ` — ${e.item.released}`)}`);
  if (score.optional.length) out.push(`  Optional (on pace for the week): ${named(score.optional)}`);
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

// ---- Check-ins and the catch-up -------------------------------------------------------------------

// What George said about a task, as one or two lines: Gemini's tidy version, and his own words when
// they say more.
function checkinLines(r, today, indent = '  ') {
  const head = `${indent}${dayName(r.day, today)} · ${q(r.title)} ${tag(r.itemId)} · ${r.why === 'missed' ? 'block passed unticked' : 'ticked'}`;
  if (r.status === 'dismissed') return [`${head} · skipped`];
  if (!r.answeredAt) return [`${head} · not answered`];
  const said = String(r.said ?? '').replace(/\s+/g, ' ').trim();
  const out = [`${head} · answered ${when(r.answeredAt).split(', ')[1]}`];
  if (r.summary) out.push(`${indent}  summary: ${r.summary}`);
  if (said && said !== r.summary) out.push(`${indent}  his words: ${said.slice(0, 1500)}`);
  return out;
}

// The last `days` days of check-ins (14 by default), newest first.
function checkins(doc, today, arg) {
  const days = Number(arg) > 0 ? Math.min(90, Math.floor(Number(arg))) : 14;
  const list = checkinsSince(doc, addDays(today, 1 - days));
  return [header(doc, today), list.length ? `Check-ins, last ${days} days (newest first):` : `No check-ins in the last ${days} days.`,
    ...list.flatMap((r) => checkinLines(r, today))].join('\n');
}

// Where the last catch-up got to (cli.js writes it once a catch-up has been read).
export const CAUGHT_UP = 'claude:caughtup';
export const caughtUpSince = (doc) => (doc.calendar?.[CAUGHT_UP]?.status === 'active' ? doc.calendar[CAUGHT_UP].at ?? null : null);
const CATCHUP_MAX_DAYS = 7;

// Everything since the last catch-up (or the last `arg` days): each day's ticks and what wasn't done,
// the check-ins, new flags, workouts, what George changed in Google Calendar, then today's planner
// notes and what needs attention.
function catchup(doc, today, arg, now = new Date()) {
  const n = Number(arg);
  const since = n > 0 ? null : caughtUpSince(doc);
  const from = n > 0 ? addDays(today, 1 - Math.min(30, Math.floor(n)))
    : since ? logicalDay(new Date(since), 4) : addDays(today, -1);
  const first = daysBetween(from, today) >= CATCHUP_MAX_DAYS ? addDays(today, 1 - CATCHUP_MAX_DAYS) : from;
  const cutoff = since ?? `${first}T00:00`;
  const out = [header(doc, today)];
  out.push(n > 0 ? `Catching up on the last ${Math.floor(n)} day${n === 1 ? '' : 's'}.`
    : since ? `Catching up since the last catch-up, ${when(since)}${first > from ? ` (only the last ${CATCHUP_MAX_DAYS} days shown)` : ''}.`
    : 'First catch-up: yesterday and today.');

  // His notes for Claude first (the Note for Claude widget, or ⚑ → For Claude): every open one, old or
  // new, oldest first, with when and what he was doing. Act on them, then `archive` each.
  const left = openFlags(doc, 'claude').filter((f) => (f.source ?? 'me') === 'me').reverse();
  if (left.length) {
    out.push('Notes George left you (act on each, then archive it):',
      ...left.map((f) => `  ${when(f.at ?? f.updated)}${f.doing ? `, during ${f.doing}` : ''}: ${q(String(f.text).replace(/\s+/g, ' '), 2000)} ${tag(f.id)}`));
  }

  out.push('Day by day:');
  const idx = doneIndex(doc);
  for (let d = first; d <= today; d = addDays(d, 1)) {
    const s = dayScore(doc, d, idx);
    const ticks = Object.values(doc.logs ?? {}).filter((l) => l.status === 'active' && l.kind === 'done' && l.day === d)
      .sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')))
      .map((l) => `${q(doc.items[l.itemId]?.title ?? '?')}${l.at ? ` ${when(l.at).split(', ')[1]}` : ''}${l.source && l.source !== 'me' ? ` (${SOURCES[l.source] ?? l.source})` : ''}`);
    out.push(`  ${dayName(d, today)}: ${s.done} of ${s.total} done${d === today ? ' so far' : ''}`);
    if (ticks.length) out.push(`    ticked: ${ticks.join(', ')}`);
    if (s.open.length) out.push(`    ${d === today ? 'still open' : 'not done'}: ${s.open.map((r) => `${q(r.item.title)} ${tag(r.item.id)}`).join(', ')}`);
    if (s.pushed.length) out.push(`    pushed after the lock: ${s.pushed.map((e) => `${q(e.item.title)} → ${dayName(e.to, today)}`).join(', ')}`);
    if (s.missed.length || s.dropped.length) out.push(`    counted as missed: ${[...s.missed, ...s.dropped].map((e) => q(e.item.title)).join(', ')}`);
  }

  const said = checkinsSince(doc, first).filter((r) => r.day >= first);
  out.push(said.length ? 'Check-ins (what he said; newest first):' : 'No check-ins in that time.', ...said.flatMap((r) => checkinLines(r, today)));

  const flagsNew = Object.values(doc.flags ?? {}).filter((f) => f.status === 'active' && String(f.at ?? f.updated ?? '') > cutoff && !left.includes(f));
  if (flagsNew.length) {
    out.push('New flags:', ...flagsNew.map((f) => `  ${FLAG_KINDS[flagKind(f)]}: ${q(String(f.text).replace(/\s+/g, ' '), 600)} ${tag(f.id)} · from ${flagSourceName(f)}`));
  }

  const trained = workouts(doc).filter((w) => w.day >= first && w.day <= today);
  if (trained.length) out.push('Workouts (Hevy):', ...trained.map((w) => `  ${dayName(w.day, today)}: ${sessionLine(doc, w)}`));
  if (workouts(doc).length) out.push(`Training this week: ${trainingWeek(doc, today)}`);

  // Each task once: where it started, where it ended up, and how many times it moved in between.
  const byItem = new Map();
  for (const c of [...changeList(doc)].reverse()) {
    if (c.source !== 'calendar' || !(String(c.at) > cutoff)) continue;
    for (const e of c.edits ?? []) {
      if (e.map !== 'items' || !e.before || !e.after) continue;
      const slot = (r) => `${r.date ? dayName(r.date, today) : '?'}${r.time ? ` ${r.time}` : ''}`;
      const gone = e.after.status === 'archived' && e.before.status === 'active';
      if (!gone && slot(e.before) === slot(e.after)) continue;
      const m = byItem.get(e.id) ?? { title: e.after.title ?? e.before.title, from: slot(e.before), moves: 0, first: c.at };
      Object.assign(m, { to: slot(e.after), gone, last: c.at, moves: m.moves + (gone ? 0 : 1) });
      byItem.set(e.id, m);
    }
  }
  if (byItem.size) {
    out.push('What he changed in Google Calendar (each task once, oldest first):', ...[...byItem].map(([id, m]) => `  ${q(m.title)} ${tag(id)}: ${m.gone
      ? `deleted ${when(m.last)}`
      : `${m.from} → ${m.to}${m.moves > 1 ? ` (moved ${m.moves} times, last ${when(m.last)})` : ` (${when(m.last)})`}`}`));
  }

  const notes = plannerNotes(doc, today);
  if (notes.length) out.push("The planner's notes today:", ...notes.map((x) => `  ${x}`));
  const needs = attention(doc, today);
  if (needs.length) out.push('Needs attention:', ...needs.map((x) => `  ${x}`));
  const open = openFlags(doc).length;
  if (open) out.push(`${open} open flag${open === 1 ? '' : 's'} in all (flags).`);
  return out.join('\n');
}

// Open flags in full, grouped by what they're for: George's feature requests and bugs, notes left
// for you (his own, and handoffs the retired Coach made), and notes for him. `flags
// <kind>` shows one group.
const KIND_WORDS = { feature: 'feature', features: 'feature', bug: 'bug', bugs: 'bug', claude: 'claude', 'for claude': 'claude', note: 'note', notes: 'note' };
function flags(doc, today, arg = '') {
  const want = String(arg ?? '').trim().toLowerCase();
  const only = want ? KIND_WORDS[want] : null;
  const open = openFlags(doc, only);
  const out = [header(doc, today)];
  if (want && !only) out.push(`(No kind called ${q(want)}, so here are all of them. Kinds: ${Object.keys(FLAG_KINDS).join(', ')}.)`);
  if (!open.length) return [...out, only ? `No open ${FLAG_KINDS[only]} flags.` : 'No open flags.'].join('\n');
  for (const [kind, label] of Object.entries(FLAG_KINDS)) {
    const group = open.filter((f) => flagKind(f) === kind);
    if (!group.length) continue;
    out.push(`${label} (${group.length}, newest first):`,
      ...group.map((f) => `  ${q(String(f.text).replace(/\s+/g, ' '), 1000)} ${tag(f.id)} · ${when(f.at ?? f.updated)}${f.doing ? ` · during ${f.doing}` : ''} · from ${flagSourceName(f)}`));
  }
  return out.join('\n');
}

function changes(doc, today, arg) {
  const n = Number(arg) > 0 ? Math.floor(Number(arg)) : 10;
  const list = changeList(doc).slice(0, n);
  const state = (c) => (c.undoneAt ? ' · undone' : c.pruned ? ' · too old to undo' : '');
  return [header(doc, today), list.length ? `Claude's last ${list.length} changes (newest first):` : "Claude hasn't changed anything yet.",
    ...list.map((c) => `  ${tag(c.id)} · ${when(c.at)} · ${c.summary}${c.source === 'coach' ? ' · by the Coach' : ''}${state(c)}`)].join('\n');
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
  inspect: (doc, today, ref) => {
    if (!ref) return header(doc, today) + '\ninspect needs the ID from find or list';
    const { map, id, rec } = resolveId(doc, ref);
    const { _sync, ...record } = rec;
    return header(doc, today) + '\n' + JSON.stringify({ map, record, ...(map === 'items' ? { blockers: blockers(doc, rec, today) } : {}),
      rules: Object.values(doc.rules ?? {}).filter((r) => r.definition.sourceId === id).map((r) => ({ id: r.id, title: r.title, enabled: r.enabled })) }, null, 2);
  },
  workflows: (doc, today) => [header(doc, today), 'Rules:',
    ...Object.values(doc.rules ?? {}).filter((r) => r.status === 'active').map((r) => `${tag(r.id)} ${r.enabled ? 'enabled' : 'paused'}: ${r.title}`),
    'Recent outcomes:', ...Object.values(doc.outcomes ?? {}).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10).map((r) => `${tag(r.id)} ${r.day} ${JSON.stringify(r.answers)}`),
    'Recent rule runs:', ...Object.values(doc.workflowRuns ?? {}).sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 10).map((r) => `${tag(r.id)} ${r.result}${r.error ? ': ' + r.error : ''}`),
    'Goal reviews:', ...Object.values(doc.reviews ?? {}).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 10).map((r) => `${tag(r.id)} ${r.result.state}: ${r.result.summary ?? r.result.message ?? r.reason}`),
    'Pending reviews require the planner and its GEMINI_KEY. Review suggestions wait for acceptance.'
  ].join('\n'),
  today, week, goals, list, find, day, history: hist, checkins, catchup, flags, changes, planner: plannerRead, attention: attentionRead, gym: gymRead,
  // What older copies of the skill still ask for.
  journal: checkins,
};
