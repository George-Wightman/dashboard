// Flags: George's notes of something to change, written from inside the app (⚑) together with
// what the app was doing at that moment, and carried to GitHub by the sync. Pure helpers, no
// imports: the store writes the records (addFlag / addressFlag in js/data.js) and js/ui/flags.js
// draws the panel.

export const FLAG_TEXT_MAX = 1000; // characters in a flag's sentence
export const FLAG_CTX_MAX = 4096; // bytes of a flag's context, as UTF-8 JSON
export const LAST_SYNCED_KEY = 'dash_last_synced'; // device-local: when a sync last succeeded
// The app's version as a flag records it: sw.js's CACHE name. Bump the two together
// (tests/sw.test.js, added with the offline-shell change, checks they match).
export const APP_VERSION = 'dash-v9';

// A "secret" shorter than this would blank ordinary words, so it isn't scrubbed.
const SECRET_MIN = 6;

const values = (map) => Object.values(map ?? {});
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const pad = (n) => String(n).padStart(2, '0');

function clip(text, n) {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

// A copy of a JSON value with every string passed through fn.
function mapStrings(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
  }
  return value;
}

// A plain-JSON copy of a context, at most FLAG_CTX_MAX bytes serialised. Too big: every string is
// clipped to 200 characters, `truncated: true` is added, and the largest fields go first until it
// fits. Not a plain object, or not serialisable (a cycle, a BigInt): null. Never throws.
export function capContext(ctx) {
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return null;
  let out;
  try {
    out = JSON.parse(JSON.stringify(ctx));
  } catch {
    return null;
  }
  if (!out || typeof out !== 'object' || Array.isArray(out)) return null;
  if (bytes(out) <= FLAG_CTX_MAX) return out;
  out = mapStrings(out, (s) => clip(s, 200));
  out.truncated = true;
  const largestFirst = Object.keys(out)
    .filter((k) => k !== 'truncated')
    .sort((a, b) => bytes(out[b]) - bytes(out[a]) || (a < b ? -1 : 1));
  for (const key of largestFirst) {
    if (bytes(out) <= FLAG_CTX_MAX) break;
    delete out[key];
  }
  return out;
}

const BROWSERS = [['Edge', /Edg\/(\d+)/], ['Firefox', /Firefox\/(\d+)/], ['Chrome', /Chrome\/(\d+)/], ['Safari', /Version\/(\d+).*Safari/]];
const SYSTEMS = [['Android', /Android/], ['iPhone', /iPhone/], ['iPad', /iPad/], ['Windows', /Windows/], ['ChromeOS', /CrOS/], ['Mac', /Mac OS X/], ['Linux', /Linux/]];

// 'Chrome 128 · Windows' from a full user agent; the first 60 characters if neither is recognised.
export function shortAgent(ua) {
  if (typeof ua !== 'string' || !ua) return null;
  const browser = BROWSERS.map(([name, re]) => [name, ua.match(re)]).find(([, m]) => m);
  const system = SYSTEMS.find(([, re]) => re.test(ua));
  const parts = [browser && `${browser[0]} ${browser[1][1]}`, system && system[0]].filter(Boolean);
  return parts.length ? parts.join(' · ') : clip(ua, 60);
}

// Every occurrence of a secret (and its trimmed form) in text, replaced by the same '[hidden]'
// marker flagContext uses. A secret shorter than SECRET_MIN is ignored so an ordinary word can't
// be blanked by mistake. Shared so anything that stores raw text — a captured context, a flag's
// typed sentence — scrubs it the same way.
export function scrubText(text, secrets) {
  const list = (secrets ?? [])
    .filter((v) => typeof v === 'string')
    .flatMap((v) => [v, v.trim()])
    .filter((v) => v.length >= SECRET_MIN)
    .sort((a, b) => b.length - a.length);
  return list.reduce((t, secret) => t.split(secret).join('[hidden]'), text);
}

// What the app was doing when the ⚑ panel opened, as plain data (the shape is in the plan's
// Shared interfaces). Only the listed fields are read. The repo and the keys go in as booleans
// only; every string is scrubbed of the token's and the Gemini key's values before it is used, so
// they can't reach a flag even if passed in by mistake. Capped at FLAG_CTX_MAX bytes.
export function flagContext(state = {}) {
  const settings = state.settings ?? {};
  const scrub = (text) => scrubText(text, [settings.token, settings.geminiKey]);
  const str = (v, n = 300) => (typeof v === 'string' ? clip(scrub(v), n) : null);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const iso = (v) => {
    const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
  };
  const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => str(x, 40)) : []);
  const coach = state.coach ?? {};
  const sync = state.sync ?? {};
  const layout = state.layout ?? {};
  const out = {
    at: iso(state.now),
    day: str(state.today, 10),
    look: str(state.look, 10),
    lookSetting: str(settings.look, 10),
    checkinHour: num(settings.checkinHour),
    dayStartHour: num(settings.dayStartHour),
    window: { width: num(state.window?.width), height: num(state.window?.height) },
    columns: num(state.columns),
    layout: { columns: Array.isArray(layout.columns) ? layout.columns.map((c) => ids(c)) : [], hidden: ids(layout.hidden) },
    arranging: state.arranging === true,
    today: { done: num(state.day?.done), total: num(state.day?.total) },
    expandedGoals: num(state.expandedGoals),
    historyDay: str(state.historyDay, 10),
    coach: {
      checkin: str(coach.checkin, 20),
      busy: str(coach.busy, 20) ?? '',
      shapeBusy: coach.shapeBusy === true,
      digestBusy: coach.digestBusy === true,
      error: str(coach.error) ?? '',
      shapeError: str(coach.shapeError) ?? '',
      digestError: str(coach.digestError) ?? '',
    },
    sync: { state: str(sync.state, 20), error: str(sync.error), lastSynced: iso(sync.lastSynced) },
    set: { repo: !!settings.repo, token: !!settings.token, geminiKey: !!settings.geminiKey, hebrewKey: !!state.hebrewKey },
    version: str(state.version, 40),
    ua: typeof state.userAgent === 'string' ? shortAgent(scrub(state.userAgent)) : null,
  };
  return capContext(mapStrings(out, scrub));
}

const LOOK_NAMES = { paper: 'Paper', night: 'Night' };
const CHECKIN_WORDS = {
  done: 'check-in done', questions: 'check-in waiting', due: 'check-in due', early: 'check-in later', nokey: 'no Gemini key',
};
const SYNC_WORDS = { off: 'sync off', syncing: 'syncing', offline: 'offline', failing: 'sync failing' };

function hhmm(isoText) {
  const d = new Date(isoText);
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The panel's About line, from a captured context:
// 'Today · Night look · 3 of 8 done · Coach: check-in waiting · synced 18:04'.
export function flagAbout(ctx) {
  const c = ctx ?? {};
  const parts = [c.arranging ? 'Arranging widgets' : 'Today'];
  if (LOOK_NAMES[c.look]) parts.push(`${LOOK_NAMES[c.look]} look`);
  if (c.today && typeof c.today.total === 'number') {
    parts.push(c.today.total ? `${c.today.done} of ${c.today.total} done` : 'nothing on today');
  }
  if (c.coach) {
    const busy = c.coach.busy || c.coach.shapeBusy || c.coach.digestBusy;
    const error = c.coach.error || c.coach.shapeError || c.coach.digestError;
    const word = busy ? 'thinking' : error ? 'showing an error' : CHECKIN_WORDS[c.coach.checkin];
    if (word) parts.push(`Coach: ${word}`);
  }
  if (c.sync) {
    const at = c.sync.state === 'ok' ? hhmm(c.sync.lastSynced) : '';
    if (at) parts.push(`synced ${at}`);
    else if (SYNC_WORDS[c.sync.state]) parts.push(SYNC_WORDS[c.sync.state]);
  }
  return parts.join(' · ');
}

const stampOf = (f) => (typeof f.updated === 'string' ? f.updated : '');

// The open flags, newest first (an open flag is never edited, so `updated` is when it was written).
export function openFlags(doc) {
  return values(doc?.flags)
    .filter((f) => f.status === 'active')
    .sort((a, b) => (stampOf(a) === stampOf(b) ? (a.id < b.id ? 1 : -1) : stampOf(a) < stampOf(b) ? 1 : -1));
}

export function addressedCount(doc) {
  return values(doc?.flags).filter((f) => f.status === 'archived').length;
}

// Flags written or addressed since the last successful sync (an ISO string, or null for never):
// the ones that haven't reached GitHub yet.
export function waitingFlags(doc, lastSynced) {
  const since = typeof lastSynced === 'string' ? lastSynced : '';
  return values(doc?.flags).filter((f) => typeof f.updated === 'string' && f.updated > since);
}

// The line at the foot of the panel. The panel adds ' · Sync now' when sync is on and some wait.
export function flagSyncLine(syncOn, waiting) {
  if (!syncOn) return 'Sync is off — flags stay on this device until you add the sync repo in ⚙';
  if (!waiting) return 'All flags have reached GitHub';
  return waiting === 1 ? "1 flag hasn't reached GitHub yet" : `${waiting} flags haven't reached GitHub yet`;
}

export function readLastSynced(storage) {
  try {
    const value = storage.getItem(LAST_SYNCED_KEY);
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

export function writeLastSynced(storage, iso) {
  try {
    storage.setItem(LAST_SYNCED_KEY, iso);
    return true;
  } catch {
    return false;
  }
}
