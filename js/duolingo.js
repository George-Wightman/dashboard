// Duolingo, as the dashboard reads it (docs/superpowers/specs/2026-10-22-duolingo-design.md). The
// planner (planner/duolingo.js) checks George's public profile and adds the XP his Hebrew course
// gains to the day's `duolingo:<day>` log: an amount log on the Hebrew practice habit. That's a
// weaker day than a Hebrew Reader session: the habit stays unticked and the day isn't counted as
// done, but the streak survives it (js/schedule.js). Pure.

export const DUOLINGO_SOURCE = 'duolingo';
export const DUOLINGO_STATUS = 'duolingo-status';
export const duolingoLogId = (day) => `duolingo:${day}`;

// What the planner last saw: { user, xp, lastSync, lastError }, or null before its first check.
export function duolingoStatus(doc) {
  const s = doc?.calendar?.[DUOLINGO_STATUS];
  return s && s.status === 'active' ? s : null;
}

// One line for ⚙ and Claude's planner read, or null while Duolingo isn't set up.
export function duolingoStatusLine(doc, when = (iso) => iso) {
  const s = duolingoStatus(doc);
  if (!s) return null;
  if (s.lastError) return `Duolingo (${s.user}): ${s.lastError}`;
  return `Duolingo (${s.user}): last checked ${s.lastSync ? when(s.lastSync) : 'never'} · ${s.xp} Hebrew XP`;
}
