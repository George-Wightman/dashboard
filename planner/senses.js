// The Senses (docs/superpowers/specs/2026-09-25-coach-mind-design.md): each planner run, compare the
// document and George's calendars with what was seen last time (the cursor, kept in mind.json), and
// write down what happened as events — who did it, and how much it matters (level 3: worth a word
// now; 2: worth a word soon; 1: for Claude's next deep run; 0: noted). Plain code, no AI. Pure.

import { addDays, logicalDay, daysBetween, shortWeekday, shortDate } from '../js/dates.js';
import { scheduleView, scheduleBlocks, localDate } from '../js/plan-state.js';
import { dayRecord, clockLabel, isPriority } from '../js/calendar.js';
import { milestonesOf } from '../js/schedule.js';
import { isMindMessage, isMindTalk, openAsks } from '../js/mind.js';
import { P } from './events.js';
import { drivePaths, htmlText } from './drive.js';

export const SLIP_GRACE_MINUTES = 30;
export const DESCRIPTION_MAX = 600;
const DUE_SOON_DAYS = 21;
const WINDOW_DAYS = 8;
const MIN = 60000;

const values = (map) => Object.values(map ?? {});
const live = (r) => r?.status === 'active';
const dayName = (day) => `${shortWeekday(day)} ${shortDate(day)}`;
const q = (t) => `"${String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)}"`;
const WHO = { claude: 'Claude', coach: 'the Coach', calendar: 'George (in Google Calendar)', me: 'George', hevy: 'Hevy', hebrew: 'the Hebrew app', workflow: 'a follow-up rule', planner: 'the planner', gemini: 'the Coach' };
const who = (by) => WHO[by] ?? by;

// A short, stable hash for an id: FNV-1a, 8 hex digits.
function hash8(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

function event(fields) {
  const refs = Object.fromEntries(Object.entries(fields.refs ?? {}).filter(([, v]) => v != null));
  return { facts: [], by: 'me', ...fields, refs, reflex: null, deep: null };
}

// ---- What the cursor remembers --------------------------------------------------------------------

const itemKey = (i) => `${i.status}|${i.date ?? ''}|${i.time ?? ''}`;
const parseItemKey = (k) => { const [status, date, time] = String(k ?? '').split('|'); return { status, date: date || null, time: time || null }; };
const georgeCount = (t) => (t.messages ?? []).filter((m) => m.who === 'george').length;

function external(raw) {
  const props = raw.extendedProperties?.private ?? {};
  return raw.status !== 'cancelled' && props[P.mine] !== '1' && !props[P.habit];
}
function startOf(raw) {
  if (raw.start?.dateTime) return { iso: new Date(raw.start.dateTime).toISOString(), day: localDate(raw.start.dateTime), allDay: false };
  if (raw.start?.date) return { iso: `${raw.start.date}T00:00`, day: raw.start.date, allDay: true };
  return null;
}
function endOf(raw) {
  if (raw.end?.dateTime) return new Date(raw.end.dateTime).toISOString();
  return raw.end?.date ? `${raw.end.date}T00:00` : null;
}

function calendarNow(calEvents, today) {
  const last = addDays(today, WINDOW_DAYS - 1);
  const out = {};
  for (const raw of calEvents) {
    if (!external(raw)) continue;
    const s = startOf(raw);
    if (!s || s.day < today || s.day > last) continue;
    out[`${raw.calendarId}|${raw.id}`] = { s: s.iso, e: endOf(raw), t: String(raw.summary ?? ''), day: s.day, allDay: s.allDay };
  }
  return out;
}

// The items the planner has placed later than asked, and where.
function overflowNow(doc, today) {
  const out = {};
  for (const e of scheduleView(doc, today).entries) {
    if (e.scheduledDay && e.scheduledDay > e.requestedDay && e.requestedDay <= addDays(today, 6)) out[e.item.id] = e.scheduledDay;
  }
  return out;
}

// Work whose block ended more than half an hour ago with it still unticked: [{ itemId, block }].
function slipsNow(doc, today, now) {
  const doneToday = new Set(values(doc.logs).filter((l) => live(l) && l.kind === 'done' && l.day === today).map((l) => l.itemId));
  const cutoff = now.getTime() - SLIP_GRACE_MINUTES * MIN;
  const out = [];
  const blocks = [...scheduleBlocks(doc), ...(dayRecord(doc, today)?.blocks ?? [])];
  const seen = new Set();
  for (const b of blocks) {
    if (!b.start || localDate(b.start) !== today || Date.parse(b.end) > cutoff || ['done', 'partial'].includes(b.state)) continue;
    const open = (b.items ?? []).filter((id) => live(doc.items[id]) && !doneToday.has(id));
    for (const id of open) if (!seen.has(id)) { seen.add(id); out.push({ itemId: id, size: open.length, end: b.end }); }
  }
  for (const m of dayRecord(doc, today)?.missed ?? []) {
    if (!seen.has(m.itemId) && live(doc.items[m.itemId]) && !doneToday.has(m.itemId)) { seen.add(m.itemId); out.push({ itemId: m.itemId, size: 1, end: null }); }
  }
  return out;
}

export function cursorOf(doc, calEvents, now, dayStartHour = 4, slipped = {}) {
  const today = logicalDay(now, dayStartHour);
  const recent = addDays(today, -3);
  const cur = { at: now.toISOString(), day: today, items: {}, done: {}, amounts: {}, milestones: {}, flags: [], talks: {}, cal: {}, overflow: {}, slipped: {} };
  for (const i of values(doc.items)) if (i.type !== 'quota') cur.items[i.id] = itemKey(i);
  for (const l of values(doc.logs)) {
    if (l.day < recent) continue;
    if (l.kind === 'done') cur.done[l.id] = l.status;
    if (l.kind === 'amount' && l.source === 'hebrew') cur.amounts[l.id] = `${l.status}|${l.amount}`;
  }
  for (const m of values(doc.milestones)) cur.milestones[m.id] = !!m.done;
  cur.flags = values(doc.flags).filter(live).map((f) => f.id).sort();
  for (const t of values(doc.journal)) if (t.kind === 'talk' && live(t) && t.day >= addDays(today, -1)) cur.talks[t.id] = georgeCount(t);
  cur.cal = calendarNow(calEvents, today);
  cur.overflow = overflowNow(doc, today);
  for (const [k, v] of Object.entries(slipped)) if (k.startsWith(`${today}|`)) cur.slipped[k] = v;
  for (const s of slipsNow(doc, today, now)) cur.slipped[`${today}|${s.itemId}`] = true;
  return cur;
}

// ---- Who changed an item ----------------------------------------------------------------------------

function changedBy(doc, itemId, since) {
  const hits = values(doc.changes).filter((c) => String(c.at ?? '') > since
    && (c.edits ?? []).some((e) => e.map === 'items' && e.id === itemId))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return hits[0]?.source ?? 'me';
}

// ---- Facts a prompt can cite ------------------------------------------------------------------------

function goalFacts(doc, goal, today) {
  if (!live(goal)) return [];
  const ms = milestonesOf(doc, goal.id).filter((m) => m.status === 'active');
  const due = goal.targetDate ? `, due ${dayName(goal.targetDate)} (${daysBetween(today, goal.targetDate)} days)` : '';
  const next = ms.filter((m) => !m.done).slice(0, 2).map((m) => q(m.title));
  const out = [`Goal ${q(goal.title)}${due}; ${ms.filter((m) => m.done).length} of ${ms.length} milestones done${next.length ? `; next: ${next.join(', ')}` : ''}`];
  const done = new Set(values(doc.logs).filter((l) => live(l) && l.kind === 'done').map((l) => l.itemId));
  const upcoming = values(doc.items).filter((i) => live(i) && i.type === 'task' && i.goalId === goal.id && !done.has(i.id) && i.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.order ?? 0) - (b.order ?? 0)).slice(0, 4);
  if (upcoming.length) out.push(`Next for that goal: ${upcoming.map((i) => `${q(i.title)} ${dayName(i.date)}`).join('; ')}`);
  return out;
}

function tickLevel(doc, item, today) {
  const goal = live(doc.goals[item.goalId]) ? doc.goals[item.goalId] : null;
  const left = goal?.targetDate ? daysBetween(today, goal.targetDate) : null;
  if (item.type === 'task' && (isPriority(doc, item) || drivePaths(item.notes).length || (left != null && left >= 0 && left <= DUE_SOON_DAYS))) return 3;
  return goal ? 2 : 1;
}

function overlapsBooked(doc, s, e) {
  const from = Date.parse(s);
  const to = Date.parse(e ?? s);
  return scheduleBlocks(doc).some((b) => (b.items ?? []).length && Date.parse(b.start) < to && Date.parse(b.end) > from);
}

function when(c) {
  return c.allDay ? `${dayName(c.day)} (all day)` : `${dayName(c.day)} ${clockLabel(c.s)}–${clockLabel(c.e)}`;
}

// ---- The events ----------------------------------------------------------------------------------------

export function sense({ doc, cursor, calEvents = [], now, dayStartHour = 4 }) {
  const today = logicalDay(now, dayStartHour);
  const next = cursorOf(doc, calEvents, now, dayStartHour, cursor?.day === today ? cursor.slipped : {});
  if (!cursor) return { cursor: next, events: [] };
  const at = now.toISOString();
  const since = cursor.at ?? '';
  const events = [];
  const add = (fields) => events.push(event({ at, day: today, ...fields }));

  // Ticks, and ticks taken off.
  for (const l of values(doc.logs)) {
    if (l.kind !== 'done' || l.day < addDays(today, -3)) continue;
    const item = doc.items[l.itemId];
    if (!item) continue;
    const was = cursor.done?.[l.id];
    if (live(l) && was !== 'active') {
      const by = l.source ?? 'me';
      const time = l.at ? ` at ${clockLabel(l.at)}` : '';
      const goal = doc.goals[item.goalId];
      if (by === 'hevy') {
        add({ id: `workout:${l.id}`, kind: 'workout', level: 1, by, refs: { itemId: item.id }, text: `Hevy logged a workout, ticking ${q(item.title)}${time}` });
        continue;
      }
      if (by === 'hebrew') {
        add({ id: `hebrew:tick:${l.id}`, kind: 'hebrew', level: 1, by, refs: { itemId: item.id }, text: `The Hebrew app ticked ${q(item.title)}${time}` });
        continue;
      }
      const paths = drivePaths(item.notes);
      add({
        id: `tick:${l.id}`, kind: 'tick', level: tickLevel(doc, item, today), by,
        refs: { itemId: item.id, goalId: live(goal) ? goal.id : null },
        text: `${who(by)} ticked ${q(item.title)}${item.area ? ` (${item.area})` : ''}${time}`,
        facts: [...(item.notes ? [`Its notes: ${String(item.notes).replace(/\s+/g, ' ').slice(0, 400)}`] : []), ...goalFacts(doc, goal, today)],
        ...(paths.length ? { paths } : {}),
      });
    } else if (!live(l) && was === 'active') {
      add({ id: `untick:${l.id}`, kind: 'untick', level: 1, by: l.source ?? 'me', refs: { itemId: item.id }, text: `The tick came off ${q(item.title)} (${l.day})` });
    }
  }

  // Committed work pushed off today or deleted; blocks George moved in Google Calendar.
  const committed = new Set(doc.calendar?.[`commit:${today}`]?.tasks ?? []);
  const reported = new Set();
  for (const item of values(doc.items)) {
    if (item.type === 'quota') continue;
    const prev = cursor.items?.[item.id];
    if (prev === undefined || prev === itemKey(item)) continue;
    const was = parseItemKey(prev);
    const by = changedBy(doc, item.id, since);
    const goal = doc.goals[item.goalId];
    const refs = { itemId: item.id, goalId: live(goal) ? goal.id : null };
    if (committed.has(item.id) && was.status === 'active' && item.status === 'archived' && !item.released) {
      add({ id: `dropped:${item.id}`, kind: 'dropped', level: 3, by, refs, text: `${who(by)} deleted ${q(item.title)}, which was on today's committed list`, facts: goalFacts(doc, goal, today) });
      reported.add(item.id);
    } else if (committed.has(item.id) && live(item) && item.date > today && (was.date ?? '') <= today) {
      add({ id: `pushed:${item.id}:${item.date}`, kind: 'pushed', level: 3, by, refs, text: `${who(by)} pushed ${q(item.title)} from today (committed) to ${dayName(item.date)}`, facts: goalFacts(doc, goal, today) });
      reported.add(item.id);
    }
    if (!reported.has(item.id) && by === 'calendar' && live(item) && (item.date !== was.date || item.time !== was.time)) {
      // His own rearranging. A move within the day is his to make: noted, never remarked on (on 25 Sep
      // four of the Coach's eight messages were "you moved X — how are you managing?"). A move to
      // another day can change what the days hold, so it's looked at once the calendar settles.
      const level = item.date !== was.date ? 2 : 1;
      add({ id: `moved:${item.id}:${item.date}|${item.time ?? ''}`, kind: 'moved', level, by, refs,
        text: `George moved ${q(item.title)} in Google Calendar from ${was.date ? dayName(was.date) : '?'}${was.time ? ` ${was.time}` : ''} to ${dayName(item.date)}${item.time ? ` ${item.time}` : ''}`,
        facts: goalFacts(doc, goal, today) });
    }
  }

  // Blocks that ended with their work unticked.
  for (const s of slipsNow(doc, today, now)) {
    const key = `${today}|${s.itemId}`;
    if (cursor.day === today && cursor.slipped?.[key]) continue;
    const item = doc.items[s.itemId];
    const goal = doc.goals[item.goalId];
    // Noted for the evening and the deep runs, never chased one block at a time: he often ticks
    // afterwards, through Claude.
    add({ id: `slip:${today}:${item.id}`, kind: 'slip', level: 1, by: 'me',
      refs: { itemId: item.id, goalId: live(goal) ? goal.id : null },
      text: `${q(item.title)} was booked until ${s.end ? clockLabel(s.end) : 'earlier'} and isn't ticked`, facts: goalFacts(doc, goal, today) });
  }

  // The planner placing work later than asked.
  for (const [id, day] of Object.entries(next.overflow)) {
    if (cursor.overflow?.[id] === day) continue;
    const item = doc.items[id];
    const goal = doc.goals[item?.goalId];
    add({ id: `overflow:${id}:${day}`, kind: 'overflow', level: 1, by: 'planner', refs: { itemId: id, goalId: live(goal) ? goal.id : null },
      text: `The planner couldn't fit ${q(item?.title)} on ${dayName(item?.date ?? today)}, so it's booked ${dayName(day)}` });
  }

  // George's calendars: what's new, moved, or gone.
  for (const [key, c] of Object.entries(next.cal)) {
    const was = cursor.cal?.[key];
    const raw = calEvents.find((r) => `${r.calendarId}|${r.id}` === key);
    const soon = c.day <= addDays(today, 1);
    const described = htmlText(raw?.description ?? '').slice(0, DESCRIPTION_MAX);
    const facts = [`Calendar: ${raw?.calendarId ?? ''}`, ...(described ? [`Description: ${described}`] : [])];
    if (!was) {
      const created = Date.parse(raw?.created ?? '');
      if (Number.isFinite(created) && raw.created <= since) continue; // an old event that just came into view
      const level = soon ? (!c.allDay && overlapsBooked(doc, c.s, c.e) ? 3 : 2) : 1;
      add({ id: `cal:${key}:${hash8(`new|${c.s}|${c.e}|${c.t}`)}`, kind: 'calendar', level, by: 'me', refs: { calendar: key },
        text: `New in George's calendar: ${q(c.t)} ${when(c)}`, facts });
    } else if (was.s !== c.s || was.e !== c.e || was.t !== c.t) {
      if (raw?.updated && raw.updated <= since) continue;
      const moved = was.s !== c.s || was.e !== c.e;
      const level = moved ? (soon ? (!c.allDay && overlapsBooked(doc, c.s, c.e) ? 3 : 2) : 1) : 1;
      add({ id: `cal:${key}:${hash8(`changed|${c.s}|${c.e}|${c.t}`)}`, kind: 'calendar', level, by: 'me', refs: { calendar: key },
        text: moved ? `George moved ${q(c.t)} in his calendar from ${when(was)} to ${when(c)}` : `George renamed ${q(was.t)} to ${q(c.t)} (${when(c)})`, facts });
    }
  }
  for (const [key, was] of Object.entries(cursor.cal ?? {})) {
    if (next.cal[key] || !(Date.parse(was.s) > now.getTime()) || was.day > addDays(today, WINDOW_DAYS - 1)) continue;
    add({ id: `cal:${key}:${hash8(`gone|${was.s}|${was.t}`)}`, kind: 'calendar', level: was.day <= addDays(today, 1) ? 2 : 1, by: 'me', refs: { calendar: key },
      text: `George removed ${q(was.t)} (${when(was)}) from his calendar` });
  }

  // Milestones reached.
  for (const m of values(doc.milestones)) {
    if (!m.done || cursor.milestones?.[m.id] !== false || !live(m)) continue;
    const goal = doc.goals[m.goalId];
    add({ id: `ms:${m.id}`, kind: 'milestone', level: 2, by: 'me', refs: { milestoneId: m.id, goalId: live(goal) ? goal.id : null },
      text: `Milestone reached: ${q(m.title)}`, facts: goalFacts(doc, goal, today) });
  }

  // The Hebrew app's numbers.
  const hebrew = values(doc.logs).filter((l) => l.kind === 'amount' && l.source === 'hebrew' && l.day >= addDays(today, -3) && live(l)
    && cursor.amounts?.[l.id] !== `${l.status}|${l.amount}`);
  if (hebrew.length) {
    const lines = hebrew.map((l) => `${q(doc.items[l.itemId]?.title ?? l.itemId)} ${l.amount} on ${l.day}`);
    add({ id: `hebrew:${today}:${hash8(lines.join('|'))}`, kind: 'hebrew', level: 1, by: 'hebrew', refs: {}, text: `The Hebrew app synced: ${lines.join('; ')}` });
  }

  // George answering something the Mind said.
  for (const t of values(doc.journal)) {
    if (t.kind !== 'talk' || !live(t) || t.day < addDays(today, -1)) continue;
    const n = georgeCount(t);
    if (n <= (cursor.talks?.[t.id] ?? 0)) continue;
    if (!isMindTalk(t) && !(t.messages ?? []).some(isMindMessage)) continue;
    const said = (t.messages ?? []).filter((m) => m.who === 'george').at(-1)?.text ?? '';
    add({ id: `reply:${t.id}:${n}`, kind: 'reply', level: 1, by: 'me', refs: { talkId: t.id }, text: `George answered the Coach: ${q(said)}` });
  }

  // Flags, and questions George has asked the Mind to think about.
  const flagsBefore = new Set(cursor.flags ?? []);
  for (const f of values(doc.flags)) {
    if (!live(f) || flagsBefore.has(f.id)) continue;
    add({ id: `flag:${f.id}`, kind: 'flag', level: 1, by: f.source ?? 'me', refs: {}, text: `New flag (${f.kind ?? 'note'}): ${q(f.text)}` });
  }
  for (const a of openAsks(doc)) {
    add({ id: `ask:${a.id}`, kind: 'ask', level: 3, by: 'me', refs: { askId: a.id }, text: `George asked for a deeper look: ${q(a.text)}` });
  }

  return { cursor: next, events };
}

// Whether the plan for a goal has stopped fitting: three or more pieces of its work pushed along by
// the planner in a day, or work asked for before the goal's date now booked after it. One `risk`
// event per goal per day.
export function planRisk(doc, events, today, now = new Date()) {
  const out = [];
  const view = scheduleView(doc, today, 21).entries;
  for (const goal of values(doc.goals).filter(live)) {
    const overflows = events.filter((e) => e.kind === 'overflow' && e.day === today && e.refs?.goalId === goal.id);
    const late = goal.targetDate ? view.filter((e) => e.item.goalId === goal.id && e.requestedDay <= goal.targetDate
      && e.scheduledDay && e.scheduledDay > goal.targetDate) : [];
    if (overflows.length < 3 && !late.length) continue;
    const facts = [
      ...late.map((e) => `${q(e.item.title)} asked for ${dayName(e.requestedDay)}, now booked ${dayName(e.scheduledDay)} — after the goal's date`),
      ...(overflows.length >= 3 ? [`${overflows.length} pieces of this goal's work pushed along by the planner today`] : []),
      ...goalFacts(doc, goal, today),
    ];
    out.push(event({ id: `risk:${goal.id}:${today}`, at: now.toISOString(), day: today, kind: 'risk', level: 3, by: 'planner',
      refs: { goalId: goal.id }, text: `The plan for ${q(goal.title)} may no longer fit${goal.targetDate ? ` before ${dayName(goal.targetDate)}` : ''}`, facts }));
  }
  return out;
}
