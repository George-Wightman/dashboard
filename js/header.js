// The words at the top of the page: the sync status (both screens), and for Daylight's sky the
// greeting, the day's progress, Claude's brief, time off, the planner's notes and any warning. Pure.

import { dayScore } from './schedule.js';
import { briefFor, offLine, plannerNotes, visibleNotes, staleSince } from './calendar.js';
import { longDate } from './dates.js';

export function syncLabel(sync) {
  switch (sync.state) {
    case 'off': return ['on this device', 'Sync is off. Add a repo and an access key in settings.'];
    case 'syncing': return ['syncing…', ''];
    case 'offline': return ['offline', "Can't reach GitHub. Working on this device."];
    case 'failing': return ['sync failing', `${sync.error ?? ''} — click for details`];
    default: return [`synced ${sync.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 'Click to sync now'];
  }
}

// "2 of 6 done · 1 pushed": moving work never makes a day a success, so pushed work is named.
export function progressText(done, total, pushed) {
  if (!total) return '';
  return `${done} of ${total} done${pushed ? ` · ${pushed} pushed` : ''}`;
}

// Before the day starts (⚙ → The day) it is still last night's evening.
export function greeting(now, dayStartHour = 4) {
  const hour = now.getHours();
  return `${hour < dayStartHour ? 'Evening' : hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening'}, George.`;
}

// hiddenNotes are this device's "<day>|<text>" keys for lines hidden with × today.
export function headerModel({ doc, today, now, hiddenNotes, saveProblem, dayStartHour = 4 }) {
  const { done, total, pushed } = dayScore(doc, today);
  const hidden = new Set(hiddenNotes);
  const shown = (text) => (text && !hidden.has(`${today}|${text}`) ? text : null);
  const stale = staleSince(doc, now);
  return {
    greeting: greeting(now, dayStartHour),
    date: longDate(today),
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    done,
    total,
    pushed,
    brief: shown(briefFor(doc, today)),
    off: shown(offLine(doc, today)),
    notes: visibleNotes(plannerNotes(doc, today), hiddenNotes, today),
    warnings: [saveProblem, stale ? `calendar planner hasn't run since ${stale}` : null].filter(Boolean),
  };
}
