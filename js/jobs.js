// The background jobs, for ⚙ → Claude: each one the planner runs, when it last worked and what's
// wrong, in a line. A job never set up is left out. Pure: a document and a moment in.

import { plannerStatus, plannerLastRun, momentLabel } from './calendar.js';
import { gymStatus } from './gym.js';
import { routinesOf } from './coach.js';
import { CHECKIN_STATUS } from './checkins.js';

// The planner rewrites its status at least hourly (planner/gas.js heartbeat), so 70 minutes without
// one means it has stopped, as js/calendar.js's staleSince also reckons.
const QUIET_MIN = 70;
const minutesSince = (iso, now) => (now.getTime() - Date.parse(iso)) / 60000;

// Google gives a free account 90 minutes of Apps Script triggers a day, and the planner then stops until
// the day resets: no bookings, no pings, no nudges. On 19 Nov 2026 it had used 74.5 of them by 19:07.
export const APPS_SCRIPT_MINUTES = 90;
export const BUDGET_WARN_MINUTES = 75;
const STEP_NAMES = {
  open: 'reading the dashboard', hevy: 'Hevy', health: 'Google Health', duolingo: 'Duolingo', workflows: 'follow-ups and reviews',
  tag: 'tagging areas', calendarRead: 'reading the calendars', reconcile: 'reading calendar edits', inboundSave: 'saving calendar edits',
  shifts: 'shifts', plan: 'planning', calendarWrite: 'writing the calendar', record: 'recording bookings', checkins: 'check-ins',
  hebrew: 'Hebrew pings', save: 'saving', pings: 'check-in pings', nudges: 'nudges', stocks: 'stocks', letter: 'the Sunday letter', other: 'the rest',
};

// The planner's biggest steps today (planner/timing.js counts them), in words: "reading the calendars 21 min, saving 9 min, …".
export function phaseLine(phases, top = 4) {
  const list = Object.entries(phases ?? {}).filter(([, ms]) => Number.isFinite(ms) && ms >= 30000)
    .sort((a, b) => b[1] - a[1]).slice(0, top);
  return list.map(([k, ms]) => `${STEP_NAMES[k] ?? k} ${Math.round(ms / 60000)} min`).join(', ');
}

// The planner's own count of today's run time (planner/checkins.js writes it hourly) for `today`, or null.
export function plannerBudget(doc, today) {
  const s = doc?.calendar?.[CHECKIN_STATUS];
  if (s?.status !== 'active' || s.day !== today || !(s.runs > 0)) return null;
  const minutes = Math.round((Number(s.runMs) || 0) / 60000);
  const each = Math.round((Number(s.runMs) || 0) / s.runs / 1000);
  const most = phaseLine(s.phases);
  return { minutes, runs: s.runs, phases: s.phases ?? null, line: `Apps Script today: ${minutes} of Google's ${APPS_SCRIPT_MINUTES} minutes, over ${s.runs} runs (about ${each} s each)${most ? `; most of it ${most}` : ''}` };
}

export function jobLines(doc, now = new Date()) {
  const out = [];
  const when = (iso) => momentLabel(iso, now);
  const planner = plannerStatus(doc);
  const last = plannerLastRun(doc);
  if (planner && last) {
    const quiet = !planner.paused && minutesSince(last, now) > QUIET_MIN;
    out.push({
      name: 'Calendar planner', ok: !planner.lastError && !quiet,
      line: planner.paused ? 'paused' : planner.lastError ? `${planner.lastError} (last ran at ${when(last)})`
        : quiet ? `last ran at ${when(last)} — it runs every 10 minutes, so something has stopped it` : `ran at ${when(last)}`,
    });
  }
  const gym = gymStatus(doc);
  if (gym) {
    out.push({ name: 'Reading Hevy', ok: !gym.lastError, line: gym.lastError ? gym.lastError : gym.lastSync ? `last read at ${when(gym.lastSync)}` : 'not read yet' });
  }
  if (doc?.gym?.routines?.status === 'active') {
    const r = routinesOf(doc);
    out.push({ name: 'Sessions into Hevy', ok: !r.lastError, line: r.lastError ?? `${Object.keys(r.byRoutine ?? {}).length} routines in the Dashboard folder` });
  }
  const checkins = doc?.calendar?.[CHECKIN_STATUS];
  if (checkins?.status === 'active' && checkins.lastRun) {
    out.push({ name: 'Check-ins', ok: !checkins.lastError, line: checkins.lastError ?? `ran at ${when(checkins.lastRun)}` });
  }
  const nudges = doc?.calendar?.['nudges:status'];
  if (nudges?.status === 'active' && nudges.lastRun) {
    out.push({ name: 'Nudges', ok: !nudges.lastError, line: nudges.lastError ?? `${nudges.sent ?? 0} sent today, last at ${when(nudges.lastRun)}` });
  }
  const reviews = doc?.calendar?.['review-status'];
  if (reviews?.status === 'active') out.push({ name: 'Goal reviews', ok: !reviews.lastError, line: reviews.lastError ?? 'working' });
  return out;
}
