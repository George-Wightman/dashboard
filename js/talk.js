// The Coach as a conversation (docs/superpowers/specs/2026-09-14-coach-conversation-design.md):
// when it opens one, what it's told, the records a conversation leaves — the talk itself and its
// journal entry — and Claude's guide for the week. Pure. js/coach-tools.js is what the Coach may
// do; js/ui/coach.js is the panel.

import { addDays, weekStart, longDate, shortWeekday, shortDate } from './dates.js';
import { rowsForDay, weekTotal, countsOn, streak, goalProgress, dayScore } from './schedule.js';
import { dayRecord, offLine, briefFor, clockLabel, excused, countdowns, daysLeft } from './calendar.js';
import { gymContext, dayLines, liftSummary, gymConfig, kgText, workouts, sessionLine, cardioQuotaId } from './gym.js';
import { scheduleView, scheduleBlocks, dayClosed } from './plan-state.js';
import { formatAmount } from './parse.js';
import { clip } from './coach.js';
import { picture, mindMessages, mindAlive, isMindTalk } from './mind.js';

export const MORNING = [7, 12];
export const AFTERNOON = [14, 17];
export const TALK_KEEP_DAYS = 30;
export const ENTRY_MAX = 600;
export const GUIDE_MAX = 600;
export const MESSAGE_MAX = 2000;
const POINTERS_MAX = 5;
const CONTEXT_MAX = 18000;
// How much of Claude's picture of George the Coach is given each turn (js/mind.js keeps up to 4,000).
export const PICTURE_IN_CONTEXT = 3000;

const values = (map) => Object.values(map ?? {});
const live = (r) => (r && r.status === 'active' ? r : null);

// ---- Records -------------------------------------------------------------------------------------

export const talkId = (day, slot) => `talk:${day}:${slot}`;
export const entryId = (day, slot) => `entry:${day}:${slot}`;
export const talkOf = (doc, day, slot) => live(doc?.journal?.[talkId(day, slot)]);
export const entryOf = (doc, day, slot) => live(doc?.journal?.[entryId(day, slot)]);

const SLOT_NAMES = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
export const slotName = (slot) => SLOT_NAMES[slot] ?? `Talk ${String(slot).replace('own-', '')}`;

// Whether George has said anything in a conversation.
export const heard = (talk) => (talk?.messages ?? []).some((m) => m.who === 'george');

const firstAt = (t) => t.messages?.[0]?.at ?? t.updated ?? '';

// A day's conversations, in the order they started.
export function talksOn(doc, day) {
  return values(doc?.journal)
    .filter((r) => r.kind === 'talk' && r.status === 'active' && r.day === day)
    .sort((a, b) => (firstAt(a) < firstAt(b) ? -1 : firstAt(a) > firstAt(b) ? 1 : 0));
}

// The slot for a conversation George starts himself: own-1, own-2 …
export function nextOwnSlot(doc, day) {
  let n = 1;
  while (doc?.journal?.[talkId(day, `own-${n}`)]) n++;
  return `own-${n}`;
}

// Conversations George spoke in that haven't been wrapped up, other than `except` (a talk id).
export function unfinished(doc, except = null) {
  return values(doc?.journal).filter((r) => r.kind === 'talk' && r.status === 'active' && !r.done && r.id !== except && heard(r));
}

// Claude's guide for the Coach for the week containing `day`.
export function guideFor(doc, day) {
  const rec = live(doc?.journal?.[`guide:${weekStart(day)}`]);
  return rec?.text ? rec.text : null;
}

// The Coach's library (its big view): every journal entry, weekly digest and evening check-in,
// newest first — a digest filed under its Monday comes after that week's entries — keeping only
// those with every word of `words` somewhere in them.
const LIBRARY_KINDS = new Set(['entry', 'digest', 'checkin']);
const libraryText = (r) => [
  r.feeling, r.text, ...(r.pointers ?? []), ...(r.forClaude ?? []),
  r.summary, ...(r.wins ?? []), ...(r.slipped ?? []), r.focus,
  ...(r.questions ?? []), ...(r.answers ?? []), r.feedback,
].filter(Boolean).join(' ').toLowerCase();

export function libraryOf(doc, words = '') {
  const want = String(words).toLowerCase().split(/\s+/).filter(Boolean);
  const when = (r) => (r.kind === 'digest' ? addDays(r.day, 6) : r.day);
  return values(doc?.journal)
    .filter((r) => r.status === 'active' && LIBRARY_KINDS.has(r.kind))
    .filter((r) => want.every((w) => libraryText(r).includes(w)))
    .sort((a, b) => (when(a) === when(b) ? (a.updated < b.updated ? 1 : -1) : when(a) < when(b) ? 1 : -1));
}

// Saved journal entries from the last `days` days, newest first.
export function recentEntries(doc, today, { days = 7, limit = 3 } = {}) {
  const from = addDays(today, -days);
  return values(doc?.journal)
    .filter((r) => r.kind === 'entry' && r.status === 'active' && r.day > from && r.day <= today)
    .sort((a, b) => (a.day === b.day ? (a.updated < b.updated ? 1 : -1) : a.day < b.day ? 1 : -1))
    .slice(0, limit);
}

export const entryLine = (e) => `${shortWeekday(e.day)} ${slotName(e.slot).toLowerCase()}: ${e.feeling ? `${e.feeling} — ` : ''}${clip(e.text, 300)}`;

// ---- When it talks ---------------------------------------------------------------------------------

// The moment it is: morning 07:00–12:00, afternoon 14:00–17:00, evening from the check-in hour
// until the day ends (so after midnight still counts). Otherwise null.
export function momentAt(now, { dayStartHour = 4, checkinHour = 18 } = {}) {
  const h = now.getHours();
  const hour = h < dayStartHour ? h + 24 : h;
  if (hour >= checkinHour) return 'evening';
  if (hour >= MORNING[0] && hour < MORNING[1]) return 'morning';
  if (hour >= AFTERNOON[0] && hour < AFTERNOON[1]) return 'afternoon';
  return null;
}

// What slipped earlier today: work in a block that has ended (or that the planner marked missed)
// still unticked, and tasks timed before now still unticked. Item ids, once each.
export function slippedItems(doc, today, now) {
  const rows = rowsForDay(doc, today).filter((r) => r.item.status === 'active');
  const undone = new Set(rows.filter((r) => !r.done).map((r) => r.item.id));
  const rec = dayRecord(doc, today);
  const t = now.getTime();
  const out = new Set();
  for (const m of rec?.missed ?? []) if (undone.has(m.itemId)) out.add(m.itemId);
  for (const b of rec?.blocks ?? []) {
    if (Date.parse(b.end) <= t) for (const id of b.items ?? []) if (undone.has(id)) out.add(id);
  }
  for (const r of rows) {
    if (!r.done && r.item.type === 'task' && r.item.time && new Date(`${today}T${r.item.time}:00`).getTime() <= t) out.add(r.item.id);
  }
  return [...out];
}

// The moment whose opener is due now, or null: one opener a moment, none once George has talked
// in that window, and the afternoon's only when something slipped.
export function openerDue(doc, { today, now, dayStartHour = 4, checkinHour = 18 }) {
  // While the background Mind is running (js/mind.js), it writes the openers — from the planner, so
  // they reach the phone and never come twice from two open pages.
  if (mindAlive(doc, now)) return null;
  const hours = { dayStartHour, checkinHour };
  const slot = momentAt(now, hours);
  if (!slot || dayClosed(doc, today) || talkOf(doc, today, slot)) return null;
  const spoke = talksOn(doc, today).some((t) => (t.messages ?? []).some((m) => m.who === 'george' && momentAt(new Date(m.at), hours) === slot));
  if (spoke) return null;
  if (slot === 'afternoon' && !slippedItems(doc, today, now).length) return null;
  return slot;
}

// The opener waiting on Today: the latest conversation the Coach opened that George hasn't answered.
export function waitingOpener(doc, today, now = null, hours = {}) {
  const t = talksOn(doc, today).filter((x) => !x.done && x.messages?.length && !heard(x) && !dayClosed(doc, today)
    && (!now || isMindTalk(x) || x.slot === momentAt(now, hours)) && !talksOn(doc, today).some((other) => heard(other) && firstAt(other) > firstAt(x))).at(-1);
  return t ? { slot: t.slot, text: t.messages[0].text } : null;
}

// ---- What it's told --------------------------------------------------------------------------------

const RANDOM = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
export const shortId = (id) => (RANDOM.test(id) ? id.slice(0, 8) : id);

// The item an id from the lists names (in full, or its first characters).
export function findItem(doc, ref) {
  const key = String(ref ?? '').trim().replace(/^#/, '');
  if (key.length < 4) throw new Error(`"${ref}" isn't an id from the lists`);
  if (doc.items[key]) return doc.items[key];
  const hits = values(doc.items).filter((i) => i.id.startsWith(key));
  if (hits.length !== 1) throw new Error(hits.length ? `${key} matches more than one item — use more of the id` : `No item has the id ${key}`);
  return hits[0];
}

// One row: '[ ] a1b2c3d4 task "Email NatCen" · Job search · 45m · at 14:00 · note: …'.
function rowText(doc, row, today) {
  const { item } = row;
  const parts = [`${row.done ? '[x]' : '[ ]'} ${shortId(item.id)} ${item.type} "${clip(item.title, 80)}"`];
  if (row.carriedFrom) parts.push(`carried from ${shortWeekday(row.carriedFrom)}`);
  if (item.area) parts.push(clip(item.area, 30));
  if (item.minutes) parts.push(formatAmount(item.minutes, 'minutes'));
  if (item.time) parts.push(`at ${item.time}`);
  if (item.type === 'habit') {
    const s = streak(doc, item, today);
    if (s.current > 1) parts.push(`${s.current} in a row`);
  }
  if (item.notes) parts.push(`note: ${clip(item.notes, 160)}`);
  return `  ${parts.join(' · ')}`;
}

export function listText(doc, day, today) {
  if (day < today) return rowsForDay(doc, day).map((r) => rowText(doc, r, today));
  const plan = scheduleView(doc, today, 14);
  const tasks = plan.entries.filter((e) => e.day === day).map((e) => {
    const booking = e.bookings[0];
    return '  [ ] ' + shortId(e.item.id) + ' task "' + clip(e.item.title, 100) + '" · requested ' + e.requestedDay
      + (booking ? ' · booked ' + e.scheduledDay + ' ' + clockLabel(booking.start) + '–' + clockLabel(booking.end) + ' on ' + booking.calendar : ' · unscheduled')
      + (e.reason ? ' · ' + e.reason : '');
  });
  // The schedule drops a task once it's ticked, so today's ticked tasks come from the day's rows —
  // without them the Coach saw only what was still booked and took that for what he'd done.
  const ticked = day === today ? rowsForDay(doc, day).filter((r) => r.item.type === 'task' && r.done).map((r) => rowText(doc, r, today)) : [];
  const habits = rowsForDay(doc, day).filter((r) => r.item.type !== 'task' && r.item.status === 'active').map((r) => rowText(doc, r, today));
  return [...tasks, ...ticked, ...habits].length ? [...tasks, ...ticked, ...habits] : ['  nothing'];
}

// What George has ticked today: the only record of what he has actually done.
export function tickedToday(doc, today) {
  return rowsForDay(doc, today).filter((r) => r.done && r.item.status === 'active').map((r) => r.item);
}

// A block whose time has passed is a plan that was, not work that was done: said so unless its
// tasks are ticked, so the Coach can't read a booking as an achievement.
function blocksText(doc, day, now = null) {
  const doneIds = new Set(values(doc.logs).filter((l) => l.kind === 'done' && l.status === 'active').map((l) => l.itemId));
  const passed = (b) => now && b.items.length && Date.parse(b.end) <= now.getTime() && !b.items.every((id) => doneIds.has(id));
  return [...scheduleBlocks(doc), ...(doc.calendar?.agenda?.busy ?? []).map((b) => ({ ...b, items: [] }))].filter((b) => b.start && new Date(b.start).toDateString() === new Date(day + 'T12:00:00').toDateString())
    .map((b) => `${b.allDay ? 'All day' : `${clockLabel(b.start)}–${clockLabel(b.end)}`} ${String(b.title).replace(/^~ /, '')}${b.state === 'rough' ? ' (flexible)' : ''} on ${b.calendar ?? 'Calendar'} [${b.items.map(shortId).join(', ')}]${passed(b) ? ' — time passed, not ticked' : ''}`);
}

const dayName = (day) => `${shortWeekday(day)} ${shortDate(day)}`;

// A task with no estimate takes the planner's defaultMinutes.
export const DEFAULT_TASK_MINUTES = 30;
// A day counts as light when the time still booked on it, doubled, is under the time asked for it.
export const LIGHT_DAY_RATIO = 2;

// How today turned out against what was asked of it, recomputed from the bookings every time.
// `movedOff` is the part the lists can't show: work that left this day, and where it went.
// `significant` is about what is left, not what moved — three tasks leaving a day that is still
// full is a non-event; three leaving a day that is now empty is worth a sentence. It lives here
// rather than in plan-state.js because only the Coach's prompt reads it, and plan-state is bundled
// into the Apps Script planner, which would then need redeploying for every change to this.
export function dayShape(doc, today) {
  const { entries } = scheduleView(doc, today);
  const bookedToday = entries.filter((e) => e.scheduledDay === today);
  const requested = entries.filter((e) => e.requestedDay === today);
  const minutes = (list) => list.reduce((n, e) => n + (e.item.minutes ?? DEFAULT_TASK_MINUTES), 0);
  const requestedMinutes = minutes(requested);
  const bookedMinutes = minutes(bookedToday);
  const movedOff = requested
    .filter((e) => e.scheduledDay && e.scheduledDay > today)
    .map((e) => ({ item: e.item, to: e.scheduledDay, reason: e.reason }));
  return {
    bookedToday,
    movedOff,
    unscheduled: requested.filter((e) => !e.scheduledDay),
    arrived: bookedToday.filter((e) => e.requestedDay < today),
    requestedMinutes,
    bookedMinutes,
    significant: movedOff.length > 0
      && (bookedToday.length === 0 || bookedMinutes * LIGHT_DAY_RATIO < requestedMinutes),
  };
}

// How today stands against what was asked of it. The lists above show what is booked; these lines
// are the part they can't show — work that left this day, and where it went. They are here on every
// turn, so the Coach is never wrong-footed by an intent line that the planner has since overtaken.
// The marker that licenses mentioning it unprompted is written only on the Coach's first message of
// a conversation, so there is nothing left to repeat on later turns.
function shapeLines(doc, today, first) {
  const shape = dayShape(doc, today);
  const titled = (e) => `"${clip(e.item.title, 80)}"`;
  const out = [];
  if (shape.movedOff.length) {
    out.push(`Requested for today, now booked later: ${shape.movedOff.map((m) => `${titled(m)} → ${dayName(m.to)}`).join(' · ')}`);
  }
  if (shape.unscheduled.length) {
    out.push(`Requested for today, no booking yet: ${shape.unscheduled.map(titled).join(' · ')}`);
  }
  if (shape.arrived.length) {
    out.push(`Booked today though requested earlier: ${shape.arrived.map((e) => `${titled(e)} (requested ${dayName(e.requestedDay)})`).join(' · ')}`);
  }
  if (first && shape.significant) {
    out.push("Today's shape is significantly different from what was asked of it. You may say so once, in this first message, naming where the work went. Do not raise it again unless George does.");
  }
  return out;
}

// What George committed to today and what has become of it (js/schedule.js's dayScore), so the Coach
// can hold him to it: moving or deleting work after the morning lock doesn't make the day a success.
export function commitmentLines(doc, today) {
  const score = dayScore(doc, today);
  const commitment = doc.calendar?.[`commit:${today}`];
  const named = (list, extra = () => '') => list.map((e) => `${shortId(e.item.id)} "${clip(e.item.title, 70)}"${extra(e)}`).join(' · ');
  const out = [commitment
    ? `Today's list locked at ${clockLabel(commitment.at)} with ${commitment.tasks.length} task${commitment.tasks.length === 1 ? '' : 's'}: that is what George committed to.`
    : "Today's list hasn't locked yet: until the morning check-in is done, moving work is planning, not slipping."];
  out.push(`Today's score so far: ${score.done} of ${score.total} done.`);
  if (score.open.length) out.push(`Committed and not done yet: ${named(score.open)}`);
  if (score.pushed.length) out.push(`Pushed off today after committing (not a fail yet, but ask why): ${named(score.pushed, (e) => ` → ${shortWeekday(e.to)}`)}`);
  if (score.missed.length) out.push(`Pushed for a second time, so counted as missed: ${named(score.missed)}`);
  if (score.dropped.length) out.push(`Deleted after committing, counted as missed unless he says it's no longer needed (then call release_task): ${named(score.dropped)}`);
  if (score.optional.length) out.push(`Optional today — times-a-week habits on pace, so leaving them is a rest day, not a fail: ${named(score.optional)}`);
  return out;
}

// What the Coach's background mind knows (docs/superpowers/specs/2026-09-25-coach-mind-design.md):
// Claude's picture of George, which can lag behind the lists (the lists win), and what the Coach said
// in the background that he hasn't answered yet.
export function mindLines(doc, today, now) {
  const out = [];
  const pic = picture(doc);
  if (pic) {
    const at = pic.at ? ` (written ${shortWeekday(pic.at.slice(0, 10))} ${clockLabel(pic.at)})` : '';
    out.push(`Claude's picture of George${at} — his standing understanding; where it disagrees with the lists, the lists are right:
${String(pic.text).trim().slice(0, PICTURE_IN_CONTEXT)}`);
  }
  const heardAfter = (talkId, at) => (doc.journal[talkId]?.messages ?? []).some((m) => m.who === 'george' && String(m.at ?? '') > String(at ?? ''));
  const waiting = mindMessages(doc, addDays(today, -1)).filter((x) => !heardAfter(x.talkId, x.m.at)).slice(-3);
  if (waiting.length) out.push(`Things you said in the background that he hasn't answered yet: ${waiting.map((x) => `"${clip(x.m.text, 200)}" (${clockLabel(x.m.at)})`).join(' · ')}`);
  return out;
}

// Everything the Coach is told at the start of each turn, as compact text. `first` marks the
// Coach's first message of a conversation — an opener, or its first reply in one George started.
export function talkContext(doc, today, now, { first = false } = {}) {
  const tomorrow = addDays(today, 1);
  const lines = [
    `Now: ${longDate(today)}, ${clockLabel(now.toISOString())}`,
    `Shared plan: tasks and Google Calendar use these same confirmed bookings. Requested dates are separate. Unscheduled means no confirmed booking.`,
    `Today is ${dayClosed(doc, today) ? 'CLOSED for new work' : 'open for planning'}.`,
    `Calendar last synchronized: ${scheduleView(doc, today).lastSynced ?? 'not yet'}. The planner runs periodically; never claim an unconfirmed edit has reached Calendar.`,
    `Today's list (${today}):`, ...listText(doc, today, today),
    `Tomorrow's list (${tomorrow}):`, ...listText(doc, tomorrow, today),
  ];
  const ticked = tickedToday(doc, today);
  lines.push(`Ticked off today (the only record of what George has done): ${ticked.length ? ticked.map((i) => `"${clip(i.title, 80)}"`).join(' · ') : 'nothing yet'}`);
  lines.push(...commitmentLines(doc, today));
  const cal = blocksText(doc, today, now);
  lines.push(cal.length ? `Calendar today: ${cal.join(' · ')}` : 'Calendar today: nothing booked by the planner');
  const next = scheduleView(doc, today).entries.filter((e) => e.day > tomorrow).slice(0, 25);
  if (next.length) lines.push('Upcoming tasks:', ...next.map((e) => `${shortId(e.item.id)} "${clip(e.item.title, 90)}" · requested ${e.requestedDay} · ${e.bookings[0] ? `booked ${e.scheduledDay} ${clockLabel(e.bookings[0].start)} on ${e.bookings[0].calendar}` : 'unscheduled'}${e.reason ? ' · ' + e.reason : ''}`));
  lines.push('Calendar tomorrow: ' + (blocksText(doc, tomorrow).join(' · ') || 'no confirmed bookings'));
  const slips = slippedItems(doc, today, now).map((id) => `"${clip(doc.items[id].title, 60)}"`);
  if (slips.length) lines.push(`Slipped earlier today: ${slips.join(', ')}`);
  for (const [d, name] of [[today, 'Today'], [tomorrow, 'Tomorrow']]) {
    const off = offLine(doc, d);
    if (off) lines.push(`${name}: ${off}`);
  }
  const counting = countdowns(doc, today);
  if (counting.length) lines.push(`Counting down to: ${counting.map((c) => `${c.id} "${clip(c.title, 60)}" ${c.day} (${daysLeft(c.days)})`).join('; ')}`);
  lines.push(...shapeLines(doc, today, first));
  const brief = briefFor(doc, today);
  if (brief) lines.push(`Today's intent (Claude — why today matters, not what is scheduled): ${brief}`);
  const guide = guideFor(doc, today);
  if (guide) lines.push(`Claude's guide for this week: ${guide}`);
  lines.push(...mindLines(doc, today, now));
  lines.push(...gymContext(doc, today));
  // Weekly targets in an area on time off today are paused, so they aren't mentioned; the ones
  // filled by the Hebrew app or Hevy are marked, so the Coach never logs them by hand.
  const cardio = cardioQuotaId(doc);
  const quotas = values(doc.items).filter((q) => q.type === 'quota' && q.status === 'active' && countsOn(q, today) && !excused(doc, q, today));
  if (quotas.length) {
    const auto = (q) => (q.source === 'hebrew' ? ' (from the Hebrew app)' : q.id === cardio ? ' (from Hevy)' : '');
    lines.push(`This week's targets: ${quotas.map((q) => `${shortId(q.id)} "${clip(q.title, 60)}" ${formatAmount(weekTotal(doc, q.id, today), q.unit ?? 'count')} of ${formatAmount(q.target, q.unit ?? 'count')}${auto(q)}`).join('; ')}`);
  }
  const goals = values(doc.goals).filter((g) => g.status === 'active');
  if (goals.length) lines.push(`Goals: ${goals.map((g) => `${clip(g.title, 60)} (${goalProgress(doc, g).pct}%)`).join('; ')}`);
  const entries = recentEntries(doc, today);
  if (entries.length) lines.push('Recent journal entries:', ...entries.map((e) => `  ${entryLine(e)}`));
  const text = lines.join('\n');
  return text.length > CONTEXT_MAX ? `${text.slice(0, CONTEXT_MAX - 1)}…` : text;
}

export const TALK_SYSTEM = [
  "You are George's coach inside his personal dashboard. British English; warm, direct, specific. One to four sentences, at most one question, no habitual follow-up question or forced goodbye. This is one continuous conversation; follow his current subject. Missed invitations expire, and silence is not failure.",
  "The shared schedule below is the Dashboard and Google Calendar's common plan. Requested date, actual calendar booking and deadline are different. Read get_day or find before reviewing work. A missing booking is unscheduled, not a reason to pull work into today. Never guess why a calendar task moved or claim to see external appointments that are absent from your context.",
  "Claude's intent lines say why today matters and how to approach it. They never state what is scheduled, and they are written in advance, so the planner may have moved the work they refer to. The lists and bookings are the only source of what is happening; where they disagree with an intent line, the lists are right.",
  "Only ticks say what George has done. Something is done when it is in 'Ticked off today' or he tells you so; a calendar block, even one whose time has passed, is a plan and not evidence. Never congratulate him on, or assume he did, anything that isn't ticked. If nothing is ticked, ask rather than guess.",
  "Hold George to what he committed to. Once today's list has locked, work he pushes to another day or deletes doesn't make the day a success: pushed, missed and deleted items are not wins. In the evening, and whenever he reviews the day, name them and ask what happened — briefly, curious rather than lecturing — and never call a day a success while any remain. A daily habit left undone is a miss; an optional times-a-week habit left undone is a rest day and needs no comment. If he says a deleted task genuinely isn't needed any more, call release_task with his reason.",
  "Talk about the day as it actually is. Do not volunteer that work has moved, slipped or been rebooked unless the context marks today as significantly different, or George raises it himself. When he asks, answer in full from the bookings.",
  "Execute explicit task instructions, including future dates, using tools. Add goals with add_goal. For an open-ended review ('the layout looks wrong', 'make tomorrow relevant') first use propose_changes and prepare specific changes for George to apply. Do not substitute unrelated tasks. Read original dates and pass expectedDay to move_task. Do not introduce earlier work, a different date, or extra tasks without a clear request.",
  "All tools work on one draft until your turn finishes. Do not promise success before tool results. Any failed mutation cancels the whole batch. Undo means undo_last_action; never attempt to reconstruct an earlier plan by moving items from memory. Recorded action receipts and their undo status are the evidence of changes, even when an earlier reply claimed otherwise.",
  "When George says the day is over or he is going to bed, call close_day. A closed day accepts no new work; capture future ideas normally. Only call reopen_day on his explicit request. You can still record something he says he already completed. Never reopen today to evade a tool refusal.",
  "For a flexible request such as 'over the weekend', choose and state a sensible weekend date, or ask one question if the choice matters. Goals are drafts that he can accept. New habits and weekly targets are suggestions too: suggest_habit and suggest_target, which he accepts on Today. When he says he did something a weekly target counts, log it. A date he wants to count down to is add_countdown. Hand app bugs, changes to an existing habit or target, and whole days off to Claude. Use item titles in conversation; IDs are for tools.",
  "His gym sessions are his own to plan: never plan them.",
  "Some of your messages came from your background mind: noticing something he did (Gemini) or a deeper review (Claude), marked as such. They are yours; carry them on naturally, and don't repeat them.",
  "When he asks for something that needs real thought — a re-plan, how something is going across weeks, anything you would have to guess at — call think_deeper with his question and tell him you'll think it through properly and come back to him in the conversation, usually within half an hour.",
  "At a natural end use finish to save a journal entry about George, not about yourself. Leave feeling blank if unknown. Do not force closure after every task or question. He can continue the conversation afterwards.",
].join('\n');

export function talkSystem(doc, today, now, { first = false } = {}) {
  return `${TALK_SYSTEM}\n\nWhat you know right now:\n${talkContext(doc, today, now, { first })}`;
}

// Whether the Coach has yet to speak in this conversation: an opener, or its first reply in one
// George started. Only then may it raise a significantly changed day unprompted.
export const firstCoachTurn = (doc, day, slot) => !(talkOf(doc, day, slot)?.messages ?? []).some((m) => m.who === 'coach');

export const OPENERS = {
  morning: "It's the morning. Open a short conversation with George: one or two sentences, ending in one question about what today looks like and anything the plan should know. Reply with just your message.",
  afternoon: "It's the afternoon. Use the current shared schedule to offer a brief, natural check-in. Do not assume a task has failed or needs moving merely because its slot passed. Ask one useful question. Reply with just your message.",
  evening: "It's the evening. Open a short conversation with George: one or two sentences about how today went — name something specific he ticked off today; if he has ticked nothing, don't claim anything was done; if anything he committed to was pushed, deleted or missed, ask about it rather than calling the day a success — ending in one question about today or tomorrow. Reply with just your message.",
};
export const PLAIN_OPENERS = {
  morning: "Morning — what's today looking like?",
  afternoon: 'How is the afternoon going?',
  evening: 'How did today go?',
};
export const WRAP_UP = '(George has closed the conversation. Call finish now with its journal entry.)';

// A conversation as Gemini's contents: George's messages as "user", the Coach's as "model",
// back-to-back ones from the same side joined. One the Coach opened starts with a note saying so,
// since Gemini's contents start on George's side.
export function talkContents(talk, extra = [], doc = null) {
  const out = [];
  const msgs = talk?.messages ?? [];
  if (msgs[0]?.who === 'coach') out.push({ role: 'user', parts: [{ text: `(${slotName(talk.slot)}: the coach opened the conversation.)` }] });
  for (const m of msgs) {
    const receipts = (m.did ?? []).map((d) => {
      const change = d.change && doc?.changes?.[d.change];
      return d.text + (change?.undoneAt ? ' [UNDONE]' : d.change ? ' [committed action ' + d.change + ']' : '');
    });
    const text = m.text + (receipts.length ? '\nRecorded action receipts: ' + receipts.join(' | ') : '');
    const role = m.who === 'george' ? 'user' : 'model';
    const prev = out.at(-1);
    if (prev?.role === role) prev.parts = [{ text: `${prev.parts[0].text}\n\n${text}` }];
    else out.push({ role, parts: [{ text }] });
  }
  for (const c of extra) {
    const prev = out.at(-1);
    if (prev?.role === c.role && c.parts?.[0]?.text != null) prev.parts = [{ text: `${prev.parts[0].text}\n\n${c.parts[0].text}` }];
    else out.push(c);
  }
  return out;
}

// Storage remains segmented by day for history and merging; model context is continuous.
export function conversationContents(doc, today, extra = []) {
  const talks = Object.values(doc.journal ?? {}).filter((t) => t.kind === 'talk' && t.status === 'active' && !t.pruned
    && t.day >= addDays(today, -7) && t.day <= today && (heard(t) || t === talksOn(doc, today).at(-1) || (isMindTalk(t) && t.day >= addDays(today, -1))))
    .sort((a, b) => firstAt(a).localeCompare(firstAt(b)));
  const messages = talks.flatMap((t) => t.messages ?? []).slice(-40);
  let size = 0;
  const kept = [];
  for (const m of [...messages].reverse()) { if (size + m.text.length > 24000) break; kept.unshift(m); size += m.text.length; }
  const contents = talkContents({ slot: 'own-1', messages: kept }, extra, doc);
  return contents.length ? contents : [{ role: 'user', parts: [{ text: 'Continue our conversation.' }] }];
}

// ---- Entries -------------------------------------------------------------------------------------

// What finish sends, made safe: a short feeling, the text (at most 600 characters), up to five
// pointers. Throws without text.
export function cleanEntry(args = {}) {
  const text = String(args.text ?? '').trim().slice(0, ENTRY_MAX).trim();
  if (!text) throw new Error("finish needs text: what's on his mind");
  return {
    feeling: clip(typeof args.feeling === 'string' ? args.feeling : '', 60),
    text,
    pointers: (Array.isArray(args.pointers) ? args.pointers : []).map((p) => clip(typeof p === 'string' ? p : '', 120)).filter(Boolean).slice(0, POINTERS_MAX),
  };
}

export function cleanHandoff(text) {
  const t = clip(text, 500);
  if (!t) throw new Error('hand_to_claude needs what George wants Claude to do or know');
  return t;
}

// When Gemini can't write the entry, one is kept from George's own words.
export function plainEntry(talk) {
  const said = (talk?.messages ?? []).filter((m) => m.who === 'george').map((m) => m.text);
  return { feeling: '', text: clip(said.join(' / '), ENTRY_MAX), pointers: [] };
}

// ---- Looking things up (the Coach's get_ tools) -------------------------------------------------

export function dayText(doc, day, today) {
  const lines = [`${longDate(day)} (${day})`, ...listText(doc, day, today)];
  const cal = blocksText(doc, day);
  if (cal.length) lines.push(`Calendar: ${cal.join(' · ')}`);
  const off = offLine(doc, day);
  if (off) lines.push(off);
  for (const g of dayLines(doc, day)) lines.push(`Gym: ${g}`);
  for (const e of values(doc.journal).filter((r) => r.kind === 'entry' && r.status === 'active' && r.day === day)) lines.push(`Journal: ${entryLine(e)}`);
  return lines.join('\n');
}

export function gymText(doc, today, lift = '') {
  const config = gymConfig(doc);
  const out = [];
  for (const l of lift ? [lift] : config.keyLifts) {
    const s = liftSummary(doc, l, today, config);
    if (!s) { out.push(`${l}: no sessions`); continue; }
    const parts = [`est. 1RM ${kgText(s.e1rm)} kg`, `last ${kgText(s.last.kg)} × ${s.last.reps} on ${s.last.day}`, s.pace != null ? `pace ${s.pace} kg/wk` : 'no pace yet'];
    if (s.prDay) parts.push(`last PR ${s.prDay}`);
    if (s.target) parts.push(s.projection?.reached ? `target ${kgText(s.target)} reached` : s.projection ? `target ${kgText(s.target)} by ~${s.projection.label}` : `target ${kgText(s.target)}`);
    out.push(`${l}: ${parts.join('; ')}`);
  }
  const recent = workouts(doc).filter((w) => w.day > addDays(today, -14) && w.day <= today).reverse();
  out.push(recent.length ? 'Last 14 days:' : 'No sessions in the last 14 days.', ...recent.map((w) => `${w.day}: ${sessionLine(doc, w, config)}`));
  return out.join('\n');
}

export function findText(doc, words) {
  const needle = String(words ?? '').trim().toLowerCase();
  if (!needle) return 'find needs some words';
  const has = (...texts) => texts.join(' ').toLowerCase().includes(needle);
  const hits = [
    ...values(doc.items).filter((i) => i.status === 'active' && has(i.title, i.notes ?? ''))
      .map((i) => `${shortId(i.id)} ${i.type} "${i.title}"${i.type === 'task' ? ` for ${i.date}` : ''}${i.area ? ` · ${i.area}` : ''}`),
    ...values(doc.goals).filter((g) => g.status === 'active' && has(g.title, g.notes ?? '', g.why ?? '')).map((g) => `goal "${g.title}"`),
  ];
  return hits.length ? hits.slice(0, 20).join('\n') : `Nothing matches "${needle}".`;
}

export function journalText(doc, today, days = 7) {
  const n = Math.min(30, Math.max(1, Math.floor(Number(days) || 7)));
  const list = recentEntries(doc, today, { days: n, limit: 30 });
  return list.length ? list.map(entryLine).join('\n') : 'No journal entries in that time.';
}
