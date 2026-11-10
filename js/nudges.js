// Nudges: a push to George's devices before a miss, not after it. Fixed rules, no AI; the planner
// sends them (planner/nudges.js), each once, at most NUDGES_PER_DAY a day, never in the quiet hours.
// The back question in the morning and a coach's session half an hour ahead. No meal pushes: Claude
// logs his meals from a chat (10 Nov 2026), so the app never asks him to snap one.
// Hebrew has its own, from the Hebrew app (planner/hebrew-nudges.js). Pure: a document and a moment in.

import { addDays } from './dates.js';
import { wallClock, deviceZone } from './travel.js';
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
  return [backNudge(doc, t, day, clk), ...sessionNudges(doc, t, day, zone)].filter(Boolean);
}
