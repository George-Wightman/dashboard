// Nudges: a push to George's devices before a miss, not after it. Fixed rules, no AI; the planner
// sends them (planner/nudges.js), each once, at most NUDGES_PER_DAY a day, never in the quiet hours.
// The back question in the morning, an unlogged lunch, Hebrew short of the day's share in the
// evening, and a coach's session half an hour ahead. Pure: a document and a moment in.

import { addDays } from './dates.js';
import { wallClock, deviceZone } from './travel.js';
import { mealsOn } from './food.js';
import { readPlannerConfig, dayRecord } from './calendar.js';
import { sessionTasks, routineFor } from './coach.js';

export const NUDGES_PER_DAY = 4;
const SESSION_AHEAD_MIN = 35;
// Times are George's, where he is (the zone his phone last reported), not the planner's clock.
const between = (clk, from, to) => clk.minutes >= from && clk.minutes < to;
export const QUIET = [22 * 60 + 30, 7 * 60];

// The quiet hours (22:30 to 07:00) in his own time.
export function quietAt(t, zone) {
  const m = wallClock(t, zone).minutes;
  return m >= QUIET[0] || m < QUIET[1];
}
const done = (doc, id) => Object.values(doc.logs ?? {}).some((l) => l.status === 'active' && l.kind === 'done' && l.itemId === id);

function backNudge(doc, t, day, clk) {
  if (!between(clk, 7 * 60 + 30, 11 * 60)) return null;
  const r = doc.gym?.[`back:${day}`];
  if (r && r.status === 'active') return null;
  return { id: `back:${day}`, title: "How's your back?", body: 'One tap: fine, stiff, sore or bad.', url: './?do=back' };
}

function lunchNudge(doc, t, day, clk) {
  if (!between(clk, 14 * 60, 17 * 60)) return null;
  if (mealsOn(doc, day).some((m) => m.slot === 'lunch')) return null;
  // Only once he snaps meals at all (any in the last week): never a nag about something he doesn't use.
  const since = new Date(t.getTime() - 7 * 86400000).toISOString();
  if (!Object.values(doc.meals ?? {}).some((m) => m.kind === 'meal' && m.status === 'active' && String(m.at) >= since)) return null;
  return { id: `lunch:${day}`, title: 'Lunch', body: 'Snap your lunch while you remember it.', url: './?do=snap' };
}

function hebrewNudge(doc, t, day, clk) {
  if (!between(clk, 20 * 60, 22 * 60 + 30)) return null;
  const q = doc.items?.['hebrew-minutes'];
  if (!q || q.status !== 'active' || q.type !== 'quota' || !(q.target > 0)) return null;
  const share = Math.round(q.target / 7);
  const minutes = Math.round(Object.values(doc.logs ?? {})
    .filter((l) => l.status === 'active' && l.kind === 'amount' && l.itemId === q.id && l.day === day)
    .reduce((n, l) => n + (Number(l.amount) || 0), 0));
  if (minutes >= share) return null;
  // "Logged so far": the Hebrew Reader's minutes arrive when the dashboard syncs on one of his devices.
  return { id: `hebrew:${day}`, title: 'Hebrew', body: `Hebrew logged so far today: ${minutes} of ${share} minutes.`, url: './?do=hebrew' };
}

function sessionNudges(doc, t, day, zone) {
  const blocks = dayRecord(doc, day)?.blocks ?? [];
  const out = [];
  for (const task of sessionTasks(doc, day, day)) {
    if (done(doc, task.id)) continue;
    const block = blocks.find((b) => (b.items ?? []).includes(task.id) && b.state !== 'rough');
    if (!block) continue;
    const start = new Date(block.start);
    const ahead = (start.getTime() - t.getTime()) / 60000;
    if (ahead <= 0 || ahead > SESSION_AHEAD_MIN) continue;
    out.push({
      id: `session:${task.id}:${day}`, title: `${task.session.name} at ${wallClock(start, zone).hhmm}`,
      body: routineFor(doc, task) ? "The routine's in Hevy, with the weights filled in." : 'Your session is on the dashboard.', url: './',
    });
  }
  return out;
}

// The nudges due at `t`, whether or not they've been sent (the sender remembers that).
export function dueNudges(doc, t, dayStartHour = 4) {
  if (readPlannerConfig(doc).config.nudges === false) return [];
  const zone = deviceZone(doc);
  const clk = wallClock(t, zone);
  const day = clk.minutes < dayStartHour * 60 ? addDays(clk.date, -1) : clk.date;
  return [backNudge(doc, t, day, clk), lunchNudge(doc, t, day, clk), hebrewNudge(doc, t, day, clk), ...sessionNudges(doc, t, day, zone)].filter(Boolean);
}
