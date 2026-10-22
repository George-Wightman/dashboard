// Duolingo, for the planner's run: the XP on George's Hebrew course, read from his public profile,
// and what it gained since the last check added to that day's log on the Hebrew practice habit
// (js/duolingo.js says what the dashboard makes of it). Read only, and no login: Duolingo has no
// official API, so this is the endpoint its own site uses for a public profile, and its day-by-day
// history (which needs a login) is never asked for. That's why the first check only takes a starting
// point. A failure is kept as a sentence in the status record and never stops the planner.

import { logicalDay } from '../js/dates.js';
import { HEBREW_IDS } from '../js/hebrewSync.js';
import { DUOLINGO_SOURCE, DUOLINGO_STATUS, duolingoStatus, duolingoLogId } from '../js/duolingo.js';

export const DUOLINGO = 'https://www.duolingo.com/2017-06-30/users';
const QUIET_MS = 55 * 60000; // a check that found nothing new is recorded at most hourly

class DuolingoError extends Error {}

// The XP on his Hebrew courses (learning Hebrew, from any language), from the public profile.
async function hebrewXp(fetch, user) {
  let res;
  try {
    res = await fetch(`${DUOLINGO}?username=${encodeURIComponent(user)}`, { headers: { accept: 'application/json' } });
  } catch {
    throw new DuolingoError("Couldn't reach Duolingo");
  }
  if (!res.ok) throw new DuolingoError(`Couldn't reach Duolingo (it answered ${res.status})`);
  let body;
  try {
    body = await res.json();
  } catch {
    throw new DuolingoError("Duolingo's reply wasn't JSON");
  }
  const profile = body?.users?.[0];
  if (!profile) throw new DuolingoError(`Duolingo has no public profile called ${user}`);
  if (!Array.isArray(profile.courses)) throw new DuolingoError("Duolingo's profile has no course list (is it private?)");
  const hebrew = profile.courses.filter((c) => c?.learningLanguage === 'he' && Number.isFinite(c.xp));
  if (!hebrew.length) throw new DuolingoError(`${user} isn't doing a Hebrew course on Duolingo`);
  return hebrew.reduce((n, c) => n + c.xp, 0);
}

// One check. Returns the status as it now stands.
export async function syncDuolingo({ fetch, user, store, now = () => new Date(), dayStartHour = 4, scrub = (s) => s }) {
  const t = now();
  const prev = duolingoStatus(store.doc());
  // A new username starts again from its own XP.
  const base = prev?.user === user && Number.isFinite(prev.xp) ? prev.xp : null;
  const status = { user, xp: base, lastSync: prev?.user === user ? prev.lastSync ?? null : null, lastError: null };
  try {
    const xp = await hebrewXp(fetch, user);
    const gained = base == null ? 0 : xp - base;
    const habit = store.doc().items[HEBREW_IDS.habit];
    if (gained > 0 && habit?.status === 'active') {
      const day = logicalDay(t, dayStartHour);
      const id = duolingoLogId(day);
      const log = store.doc().logs[id];
      const before = log?.status === 'active' ? Number(log.amount) || 0 : 0;
      store.putLog(id, {
        itemId: habit.id, kind: 'amount', amount: before + gained, day, at: t.toISOString(),
        note: 'Duolingo XP', source: DUOLINGO_SOURCE, status: 'active',
      });
    }
    status.xp = xp;
    if (xp !== base || !status.lastSync || t.getTime() - Date.parse(status.lastSync) >= QUIET_MS) status.lastSync = t.toISOString();
  } catch (err) {
    status.lastError = scrub(err instanceof DuolingoError ? err.message : `Duolingo check stopped: ${err?.message ?? err}`);
  }
  store.putCalendar(DUOLINGO_STATUS, status, DUOLINGO_SOURCE);
  return status;
}
