// Check-ins (docs/superpowers/specs/2026-09-26-checkins-design.md): one short question about a task,
// asked when George ticks it or when its calendar block ends with it unticked, answered in a line or
// by voice, and kept for Claude to pick up later. One journal record per task per day,
// `reflect:<day>:<itemId>`, so the app and the planner asking about the same task write one record.
// Pure: the store writes them (js/data.js), the app shows them (js/ui/checkin.js), the planner asks
// about misses (planner/checkins.js).

import { scheduleBlocks, localDate } from './plan-state.js';
import { dayRecord } from './calendar.js';

export const SAID_MAX = 4000;
export const SUMMARY_MAX = 600;
// A block counts as missed once it has been over for this long with its task unticked: he often
// ticks a little after finishing.
export const MISS_GRACE_MINUTES = 30;

export const checkinId = (day, itemId) => `reflect:${day}:${itemId}`;

const values = (map) => Object.values(map ?? {});
const live = (r) => r?.status === 'active';
const isCheckin = (r) => r?.kind === 'reflect';

export function questionFor(why, title) {
  const t = `"${String(title ?? '').trim()}"`;
  return why === 'missed' ? `${t} isn't ticked — what happened?` : `How did ${t} go?`;
}

// The ones waiting for an answer today, oldest first. Only today's: a question that has lost its
// moment isn't asked the next morning.
export function waitingCheckins(doc, today) {
  return values(doc?.journal)
    .filter((r) => isCheckin(r) && live(r) && r.day === today && !r.answeredAt && live(doc.items?.[r.itemId]))
    .sort((a, b) => String(a.askedAt ?? '').localeCompare(String(b.askedAt ?? '')) || a.id.localeCompare(b.id));
}

// Every check-in from `from` on — answered, unanswered and skipped (dismissed) — newest first.
export function checkinsSince(doc, from) {
  return values(doc?.journal)
    .filter((r) => isCheckin(r) && (live(r) || r.status === 'dismissed') && r.day >= from)
    .sort((a, b) => b.day.localeCompare(a.day) || String(b.answeredAt ?? b.askedAt ?? '').localeCompare(String(a.answeredAt ?? a.askedAt ?? '')));
}

// Tasks whose block ended at least MISS_GRACE_MINUTES ago today with the task still unticked:
// [{ itemId, end }]. Habits (the Gym, the walk) are left to Claude's catch-up.
export function missedTasks(doc, today, now) {
  const doneToday = new Set(values(doc.logs).filter((l) => live(l) && l.kind === 'done' && l.day === today).map((l) => l.itemId));
  const cutoff = now.getTime() - MISS_GRACE_MINUTES * 60000;
  const out = [];
  const seen = new Set();
  const open = (id) => live(doc.items?.[id]) && doc.items[id].type === 'task' && !doneToday.has(id) && !seen.has(id);
  for (const b of [...scheduleBlocks(doc), ...(dayRecord(doc, today)?.blocks ?? [])]) {
    if (!b.start || localDate(b.start) !== today || Date.parse(b.end) > cutoff || ['done', 'partial'].includes(b.state)) continue;
    for (const id of b.items ?? []) if (open(id)) { seen.add(id); out.push({ itemId: id, end: b.end }); }
  }
  for (const m of dayRecord(doc, today)?.missed ?? []) {
    if (open(m.itemId)) { seen.add(m.itemId); out.push({ itemId: m.itemId, end: null }); }
  }
  return out;
}

// ---- Gemini tidies what he said -------------------------------------------------------------------

export const SUMMARY_SYSTEM = [
  "You tidy George's spoken or typed answer about one piece of work into a short note for his own records.",
  'Two or three plain sentences, first person, in his words where you can; British English.',
  'Keep every specific: what he did, what went well, what went wrong, what got in the way, numbers, names.',
  'Drop filler and repetition. Add nothing he did not say: no advice, no praise, no judgement.',
  'Reply with JSON only: {"summary": "…"}',
].join(' ');

export function summaryPrompt(rec, said) {
  const context = rec.why === 'missed'
    ? `The task "${rec.title}" was booked in his calendar and wasn't ticked off. He was asked what happened.`
    : `He has just ticked off the task "${rec.title}". He was asked how it went.`;
  return `${context}\n\nWhat he said:\n${String(said).slice(0, SAID_MAX)}`;
}

export function parseSummary(data) {
  const text = typeof data?.summary === 'string' ? data.summary.replace(/\s+/g, ' ').trim() : '';
  if (!text) throw new Error('No summary in the reply');
  return text.slice(0, SUMMARY_MAX);
}

// The planner's record of its asking (planner/checkins.js), for ⚙ → Claude.
export const CHECKIN_STATUS = 'checkins:status';
