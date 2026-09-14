// The Coach as a conversation (docs/superpowers/specs/2026-09-14-coach-conversation-design.md):
// when it opens one, what it's told, the records a conversation leaves — the talk itself and its
// journal entry — and Claude's guide for the week. Pure. js/coach-tools.js is what the Coach may
// do; js/ui/coach.js is the panel.

import { addDays, weekStart, longDate, shortWeekday } from './dates.js';
import { rowsForDay, weekTotal, countsOn, streak, goalProgress } from './schedule.js';
import { dayRecord, offLine, briefFor, clockLabel } from './calendar.js';
import { gymContext, dayLines, liftSummary, gymConfig, kgText, workouts, sessionLine } from './gym.js';
import { formatAmount } from './parse.js';
import { clip } from './coach.js';

export const MORNING = [7, 12];
export const AFTERNOON = [14, 17];
export const TALK_KEEP_DAYS = 30;
export const ENTRY_MAX = 600;
export const GUIDE_MAX = 600;
export const MESSAGE_MAX = 2000;
const POINTERS_MAX = 5;
const CONTEXT_MAX = 6000;

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
  const hours = { dayStartHour, checkinHour };
  const slot = momentAt(now, hours);
  if (!slot || talkOf(doc, today, slot)) return null;
  const spoke = talksOn(doc, today).some((t) => (t.messages ?? []).some((m) => m.who === 'george' && momentAt(new Date(m.at), hours) === slot));
  if (spoke) return null;
  if (slot === 'afternoon' && !slippedItems(doc, today, now).length) return null;
  return slot;
}

// The opener waiting on Today: the latest conversation the Coach opened that George hasn't answered.
export function waitingOpener(doc, today) {
  const t = talksOn(doc, today).filter((x) => !x.done && x.messages?.length && !heard(x)).at(-1);
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
  const rows = rowsForDay(doc, day).filter((r) => r.item.status === 'active');
  return rows.length ? rows.map((r) => rowText(doc, r, today)) : ['  nothing'];
}

function blocksText(doc, day) {
  return (dayRecord(doc, day)?.blocks ?? [])
    .map((b) => `${clockLabel(b.start)}–${clockLabel(b.end)} ${String(b.title).replace(/^~ /, '')}${b.state === 'rough' ? ' (rough)' : ''}`);
}

// Everything the Coach is told at the start of each turn, as compact text.
export function talkContext(doc, today, now) {
  const tomorrow = addDays(today, 1);
  const lines = [
    `Now: ${longDate(today)}, ${clockLabel(now.toISOString())}`,
    `Today's list (${today}):`, ...listText(doc, today, today),
    `Tomorrow's list (${tomorrow}):`, ...listText(doc, tomorrow, today),
  ];
  const cal = blocksText(doc, today);
  lines.push(cal.length ? `Calendar today: ${cal.join(' · ')}` : 'Calendar today: nothing booked by the planner');
  const slips = slippedItems(doc, today, now).map((id) => `"${clip(doc.items[id].title, 60)}"`);
  if (slips.length) lines.push(`Slipped earlier today: ${slips.join(', ')}`);
  for (const [d, name] of [[today, 'Today'], [tomorrow, 'Tomorrow']]) {
    const off = offLine(doc, d);
    if (off) lines.push(`${name}: ${off}`);
  }
  const brief = briefFor(doc, today);
  if (brief) lines.push(`Claude's brief for today: ${brief}`);
  const guide = guideFor(doc, today);
  if (guide) lines.push(`Claude's guide for this week: ${guide}`);
  lines.push(...gymContext(doc, today));
  const quotas = values(doc.items).filter((q) => q.type === 'quota' && q.status === 'active' && countsOn(q, today));
  if (quotas.length) {
    lines.push(`This week's targets: ${quotas.map((q) => `${clip(q.title, 60)} ${formatAmount(weekTotal(doc, q.id, today), q.unit ?? 'count')} of ${formatAmount(q.target, q.unit ?? 'count')}`).join('; ')}`);
  }
  const goals = values(doc.goals).filter((g) => g.status === 'active');
  if (goals.length) lines.push(`Goals: ${goals.map((g) => `${clip(g.title, 60)} (${goalProgress(doc, g).pct}%)`).join('; ')}`);
  const entries = recentEntries(doc, today);
  if (entries.length) lines.push('Recent journal entries:', ...entries.map((e) => `  ${entryLine(e)}`));
  const text = lines.join('\n');
  return text.length > CONTEXT_MAX ? `${text.slice(0, CONTEXT_MAX - 1)}…` : text;
}

export const TALK_SYSTEM = [
  "You are George's coach inside his personal dashboard, talking with him in short messages. British English; direct, warm and specific. No emojis, no filler, no bullet lists unless he asks. One to four sentences a reply, and at most one question at a time.",
  "You can change today's and tomorrow's plan with your tools: add a task, move one between today and tomorrow, skip one, set a length, a time or notes, tick off what he says he's done, and block out hours he's busy. Do it when he asks or clearly means it, then say in a few words what you did. You can't touch goals, habits, weekly targets, whole days off or anything after tomorrow: hand those to Claude with hand_to_claude and tell him you have.",
  'His gym sessions are his own to plan. Talk about them, never plan them.',
  'Refer to items by the 8-character ids in the lists. Look things up with get_day, get_gym, find and get_journal rather than guessing.',
  "When the conversation reaches a natural end — he has what he needed, or says bye — call finish with its journal entry: how he's feeling, in a few words; what's on his mind, written about him in plain sentences (at most 600 characters); and up to 5 short pointers he gave you about how he works or what matters. Then say a short goodbye.",
].join('\n');

export function talkSystem(doc, today, now) {
  return `${TALK_SYSTEM}\n\nWhat you know right now:\n${talkContext(doc, today, now)}`;
}

export const OPENERS = {
  morning: "It's the morning. Open a short conversation with George: one or two sentences, ending in one question about what today looks like and anything the plan should know. Reply with just your message.",
  afternoon: "It's the afternoon and something from earlier has slipped. Open a short conversation with George: name what slipped, and ask whether to move something. Reply with just your message.",
  evening: "It's the evening. Open a short conversation with George: one or two sentences about how today went — name something specific from it — ending in one question about today or tomorrow. Reply with just your message.",
};
export const PLAIN_OPENERS = {
  morning: "Morning — what's today looking like?",
  afternoon: 'How is the afternoon going — shall we move anything?',
  evening: 'How did today go?',
};
export const WRAP_UP = '(George has closed the conversation. Call finish now with its journal entry.)';

// A conversation as Gemini's contents: George's messages as "user", the Coach's as "model",
// back-to-back ones from the same side joined. One the Coach opened starts with a note saying so,
// since Gemini's contents start on George's side.
export function talkContents(talk, extra = []) {
  const out = [];
  const msgs = talk?.messages ?? [];
  if (msgs[0]?.who === 'coach') out.push({ role: 'user', parts: [{ text: `(${slotName(talk.slot)}: the coach opened the conversation.)` }] });
  for (const m of msgs) {
    const role = m.who === 'george' ? 'user' : 'model';
    const prev = out.at(-1);
    if (prev?.role === role) prev.parts = [{ text: `${prev.parts[0].text}\n\n${m.text}` }];
    else out.push({ role, parts: [{ text: m.text }] });
  }
  for (const c of extra) {
    const prev = out.at(-1);
    if (prev?.role === c.role && c.parts?.[0]?.text != null) prev.parts = [{ text: `${prev.parts[0].text}\n\n${c.parts[0].text}` }];
    else out.push(c);
  }
  return out;
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
