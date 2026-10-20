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
