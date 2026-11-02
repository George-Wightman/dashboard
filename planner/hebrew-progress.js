// The Hebrew app's own sync file (progress.json in hebrew-reader-sync), read by the planner itself:
// until now only the dashboard app on a device pulled it, so the planner never knew whether he'd
// practised, and George has stopped opening the dashboard. Synchronous, like the relay — the
// caller hands in a blocking `request(url, init) → { status, text }` (UrlFetchApp) and `gunzip(base64)
// → text` (Utilities.ungzip), so the widgets' doPost can use it too. Never throws.

import { API } from './relay.js';
import { addDays } from '../js/dates.js';

export const HEBREW_REPO = 'George-Wightman/hebrew-reader-sync';

const objectAt = (keys, name) => {
  try {
    const v = JSON.parse(keys?.[name] ?? 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
};

// The strong band on the latest day up to `day` that reports one.
function strongBy(stats, day) {
  const days = Object.keys(stats).filter((d) => d <= day).sort();
  for (let i = days.length - 1; i >= 0; i--) {
    const n = stats[days[i]]?.bands?.strong;
    if (typeof n === 'number') return n;
  }
  return 0;
}

// { ok: true, days: { [day]: { sec, sessions } }, strongGain, push: [{ id, endpoint, p256dh, auth }] }
// or { ok: false, error }. `today` sets the week for strongGain.
export function readHebrewProgress({ request, repo = HEBREW_REPO, token, gunzip, today }) {
  if (!token) return { ok: false, error: 'No token for the Hebrew app\'s sync repo' };
  let res;
  try {
    res = request(`${API}/repos/${repo}/contents/progress.json`, { method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github.raw+json' } });
  } catch (e) {
    return { ok: false, error: `Couldn't reach the Hebrew app's sync repo (${e?.message ?? e})` };
  }
  if (res.status === 404 || res.status === 403 || res.status === 401) {
    return { ok: false, error: `The planner's token can't see ${repo} (GitHub ${res.status}): put a read-only token for it in the HEBREW_TOKEN script property` };
  }
  if (res.status !== 200) return { ok: false, error: `Couldn't read the Hebrew app's progress (GitHub ${res.status})` };
  let keys;
  try {
    const envelope = JSON.parse(res.text);
    if (envelope?.enc !== 'gzip' || typeof envelope.body !== 'string') throw new Error('not an envelope');
    keys = JSON.parse(gunzip(envelope.body)).keys;
  } catch {
    return { ok: false, error: 'The Hebrew app\'s progress.json isn\'t a sync file the planner can read' };
  }
  const stats = objectAt(keys, 'hvr_stats');
  const days = {};
  for (const [day, s] of Object.entries(stats)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) days[day] = { sec: Math.max(0, Number(s?.sec) || 0), sessions: Math.max(0, Number(s?.sessions) || 0) };
  }
  const push = Object.entries(objectAt(keys, 'hvr_push'))
    .filter(([, p]) => p && !p.off && typeof p.endpoint === 'string' && /^https:\/\//.test(p.endpoint) && typeof p.p256dh === 'string' && typeof p.auth === 'string')
    .map(([id, p]) => ({ id: `hvr:${id}`, endpoint: p.endpoint, p256dh: p.p256dh, auth: p.auth, label: 'Hebrew app' }));
  const strongGain = today ? Math.max(0, strongBy(stats, today) - strongBy(stats, addDays(today, -7))) : 0;
  return { ok: true, days, strongGain, push };
}
