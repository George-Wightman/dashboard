// Dashboard calendar planner — built by `npm run build-planner` from planner/ and js/. Don't edit by hand.
var PLANNER_BUILD = '33d6eee0';

// ---- planner/shims.js
const __planner_shims = (() => {
// The browser globals the app's modules use, for Apps Script, which has none of them. Each is
// installed only where it's missing, over Apps Script's own services: fetch over UrlFetchApp (a
// Promise that is already settled — UrlFetchApp waits), text and base64 over Utilities.

const signed = (b) => (b > 127 ? b - 256 : b);

function binaryString(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.slice(i, i + 8192));
  return s;
}

function installShims(g, { Utilities, UrlFetchApp }) {
  if (typeof g.TextEncoder !== 'function') {
    g.TextEncoder = class { encode(text) { return Uint8Array.from(Utilities.newBlob(String(text)).getBytes(), (b) => b & 255); } };
  }
  if (typeof g.TextDecoder !== 'function') {
    g.TextDecoder = class { decode(bytes) { return Utilities.newBlob(Array.from(bytes, signed)).getDataAsString('UTF-8'); } };
  }
  if (typeof g.btoa !== 'function') {
    g.btoa = (binary) => Utilities.base64Encode(Array.from(binary, (c) => signed(c.charCodeAt(0))));
  }
  if (typeof g.atob !== 'function') {
    g.atob = (b64) => binaryString(Utilities.base64Decode(b64).map((b) => b & 255));
  }
  if (typeof g.structuredClone !== 'function') {
    g.structuredClone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  }
  if (typeof g.crypto?.randomUUID !== 'function') {
    g.crypto = { ...(g.crypto ?? {}), randomUUID: () => Utilities.getUuid() };
  }
  if (typeof g.fetch !== 'function') {
    g.fetch = (url, init = {}) => {
      const headers = { ...(init.headers ?? {}) };
      let contentType;
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === 'content-type') { contentType = headers[k]; delete headers[k]; }
      }
      const options = { method: String(init.method ?? 'get').toLowerCase(), headers, muteHttpExceptions: true };
      if (init.body !== undefined) options.payload = init.body;
      if (contentType) options.contentType = contentType;
      try {
        const res = UrlFetchApp.fetch(url, options);
        const status = res.getResponseCode();
        const text = res.getContentText();
        return Promise.resolve({ ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) });
      } catch (e) {
        return Promise.reject(e);
      }
    };
  }
}
return { installShims };
})();

// ---- js/dates.js
const __js_dates = (() => {
// Pure day arithmetic. Days are 'YYYY-MM-DD' strings. Everything except logicalDay works in
// UTC on those strings, so a daylight-saving change can never move a day.

const pad = (n) => String(n).padStart(2, '0');
const DAY_MS = 86400000;

const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

// The day a moment belongs to, when the day starts at dayStartHour local time. Counted in
// wall-clock time (not by subtracting milliseconds), so a daylight-saving clock change on the
// boundary can never shift which calendar day it lands on.
function logicalDay(date, dayStartHour = 4) {
  let y = date.getFullYear();
  let m = date.getMonth();
  let d = date.getDate();
  if (date.getHours() < dayStartHour) {
    const prev = new Date(y, m, d - 1);
    y = prev.getFullYear();
    m = prev.getMonth();
    d = prev.getDate();
  }
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

function toUTC(day) {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addDays(day, n) {
  return fromUTC(toUTC(day) + n * DAY_MS);
}

function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
}

function weekday(day) {
  const w = new Date(toUTC(day)).getUTCDay();
  return w === 0 ? 7 : w;
}

function weekStart(day) {
  return addDays(day, 1 - weekday(day));
}

function dayOfMonth(day) {
  return Number(day.slice(8, 10));
}

function daysInMonth(day) {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function shortWeekday(day) {
  return WEEKDAYS_SHORT[weekday(day) - 1];
}

function shortDate(day) {
  return `${dayOfMonth(day)} ${MONTHS_SHORT[Number(day.slice(5, 7)) - 1]}`;
}

function longDate(day) {
  return `${WEEKDAYS_LONG[weekday(day) - 1]} ${dayOfMonth(day)} ${MONTHS_LONG[Number(day.slice(5, 7)) - 1]}`;
}

// The amber marker on a carried-over task.
function carryLabel(fromDay, today) {
  return daysBetween(fromDay, today) <= 6 ? `from ${shortWeekday(fromDay)}` : `from ${shortDate(fromDay)}`;
}

// A whole hour on the 12-hour clock: 18 → '6pm', 12 → '12pm', 0 → '12am'.
function hourLabel(hour) {
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${hour < 12 ? 'am' : 'pm'}`;
}

// The marker on a suggestion for a later day: the weekday within six days, else the date.
function forLabel(day, today) {
  const n = daysBetween(today, day);
  return n >= 1 && n <= 6 ? `for ${shortWeekday(day)}` : `for ${shortDate(day)}`;
}
return { logicalDay, addDays, daysBetween, weekday, weekStart, dayOfMonth, daysInMonth, shortWeekday, shortDate, longDate, carryLabel, hourLabel, forLabel };
})();

// ---- js/doc.js
const __js_doc = (() => {
// The shape of the synced document, shared by the store and the merge.

const MAPS = ['items', 'goals', 'milestones', 'logs', 'journal', 'flags', 'changes', 'calendar'];

function emptyDoc() {
  return { schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {}, flags: {}, changes: {}, calendar: {} };
}

// One check-in per logical day and one digest per week (filed under that week's Monday), on
// every device: the id is the kind and the day, so two devices writing the same one merge into
// one record.
function journalId(kind, day) {
  return `${kind}:${day}`;
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// A real dashboard document: a plain object with a numeric schema, an items map, and any of the
// other known maps either absent or themselves plain objects (never arrays). A document saved
// before the journal, the flags or the change log existed has none of them and is still a real
// document.
function isDoc(value) {
  if (!isPlainObject(value)) return false;
  if (typeof value.schema !== 'number') return false;
  if (!isPlainObject(value.items)) return false;
  return MAPS.filter((k) => k !== 'items').every((k) => value[k] === undefined || isPlainObject(value[k]));
}

// JSON with object keys sorted at every depth, so two equal documents always serialise the same.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
return { MAPS, emptyDoc, journalId, isDoc, stableStringify };
})();

// ---- js/merge.js
const __js_merge = (() => {
// Merging two copies of the document. Pure and deterministic: whichever device runs it, in
// whichever order, and however many times, the result is the same. Every quick-add is its own
// record and nothing is hard-deleted, so "later updated wins, per record" is the only rule.

const { MAPS, stableStringify } = __js_doc;

function pickWinner(a, b) {
  // A non-string `updated` (a malformed sync, a stray number) isn't a comparable timestamp —
  // treat it as unset rather than letting Number()/string coercion produce an order-dependent
  // comparison (e.g. a number vs an ISO string compares false both ways via >).
  const ua = typeof a.updated === 'string' ? a.updated : '';
  const ub = typeof b.updated === 'string' ? b.updated : '';
  if (ua !== ub) return ua > ub ? a : b;
  return stableStringify(a) >= stableStringify(b) ? a : b;
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Repairs the two things a malformed synced record is missing that would otherwise blank the
// page: a `created` day (derived from `updated`) and, once archived, an `archivedOn` day.
// `archivedOn` repair only makes sense for items/goals/milestones — a log's `archivedOn: null`
// is a deliberate tombstone shape (see constraints.md), not a gap to fill in.
// Returns the same object when nothing needs fixing, so it's a no-op to run twice.
function normaliseRecord(rec, repairArchivedOn) {
  const created = rec.created != null
    ? rec.created
    : (typeof rec.updated === 'string' ? rec.updated.slice(0, 10) : '1970-01-01');
  const archivedOn = repairArchivedOn && rec.status === 'archived' && !rec.archivedOn ? created : rec.archivedOn;
  if (created === rec.created && archivedOn === rec.archivedOn) return rec;
  return { ...rec, created, archivedOn };
}

function mergeMap(left, right, normalise = false, repairArchivedOn = false) {
  const lm = left ?? {};
  const rm = right ?? {};
  const ids = [...new Set([...Object.keys(lm), ...Object.keys(rm)])].sort();
  const map = {};
  for (const id of ids) {
    // Normalise each candidate before picking, not the winner afterwards: normalising only the
    // winner would let a repaired record's extra fields shift later tie-breaks, so repeated or
    // differently-grouped merges (a∪b)∪c vs a∪(b∪c) could disagree on the winner.
    const x = normalise && lm[id] ? normaliseRecord(lm[id], repairArchivedOn) : lm[id];
    const y = normalise && rm[id] ? normaliseRecord(rm[id], repairArchivedOn) : rm[id];
    // null and absent are both "nothing there", but not the same nothing: `x ?? y` alone picks
    // whichever side happens to be undefined, which is order-dependent when one side is null and
    // the other absent. Prefer null over absent, in both orders, when neither side has a record.
    if (x != null && y != null) map[id] = pickWinner(x, y);
    else if (x == null && y == null) map[id] = x === undefined ? y : x;
    else map[id] = x ?? y;
  }
  return map;
}

function mergeDocs(a, b) {
  const out = { schema: Math.max(a?.schema ?? 1, b?.schema ?? 1) };
  const keys = new Set([...MAPS, ...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  keys.delete('schema');
  for (const key of [...keys].sort()) {
    const left = a?.[key];
    const right = b?.[key];
    const hasLeft = left !== undefined;
    const hasRight = right !== undefined;
    // The known maps (MAPS) are always record maps; any other key is one too if the side(s) that
    // have it are plain objects — otherwise it's a scalar/array that passes straight through.
    const asMap = MAPS.includes(key)
      || (isPlainObject(left) && isPlainObject(right))
      || (isPlainObject(left) && !hasRight)
      || (isPlainObject(right) && !hasLeft);
    if (asMap) {
      out[key] = mergeMap(left, right, MAPS.includes(key), MAPS.includes(key) && key !== 'logs');
    } else if (hasLeft && hasRight) {
      out[key] = stableStringify(left) >= stableStringify(right) ? left : right;
    } else {
      out[key] = hasLeft ? left : right;
    }
  }
  return out;
}

function sameDoc(a, b) {
  return stableStringify(mergeDocs(a, null)) === stableStringify(mergeDocs(b, null));
}
return { pickWinner, mergeDocs, sameDoc };
})();

// ---- js/flags.js
const __js_flags = (() => {
// Flags: George's notes of something to change, written from inside the app (⚑) together with
// what the app was doing at that moment, and carried to GitHub by the sync. Pure helpers, no
// imports: the store writes the records (addFlag / addressFlag in js/data.js) and js/ui/flags.js
// draws the panel.

const FLAG_TEXT_MAX = 1000; // characters in a flag's sentence
const FLAG_CTX_MAX = 4096; // bytes of a flag's context, as UTF-8 JSON
const LAST_SYNCED_KEY = 'dash_last_synced'; // device-local: when a sync last succeeded
// The app's version as a flag records it: sw.js's CACHE name. Bump the two together
// (tests/sw.test.js, added with the offline-shell change, checks they match).
const APP_VERSION = 'dash-v8';

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
function capContext(ctx) {
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
function shortAgent(ua) {
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
function scrubText(text, secrets) {
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
function flagContext(state = {}) {
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
function flagAbout(ctx) {
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
function openFlags(doc) {
  return values(doc?.flags)
    .filter((f) => f.status === 'active')
    .sort((a, b) => (stampOf(a) === stampOf(b) ? (a.id < b.id ? 1 : -1) : stampOf(a) < stampOf(b) ? 1 : -1));
}

function addressedCount(doc) {
  return values(doc?.flags).filter((f) => f.status === 'archived').length;
}

// Flags written or addressed since the last successful sync (an ISO string, or null for never):
// the ones that haven't reached GitHub yet.
function waitingFlags(doc, lastSynced) {
  const since = typeof lastSynced === 'string' ? lastSynced : '';
  return values(doc?.flags).filter((f) => typeof f.updated === 'string' && f.updated > since);
}

// The line at the foot of the panel. The panel adds ' · Sync now' when sync is on and some wait.
function flagSyncLine(syncOn, waiting) {
  if (!syncOn) return 'Sync is off — flags stay on this device until you add the sync repo in ⚙';
  if (!waiting) return 'All flags have reached GitHub';
  return waiting === 1 ? "1 flag hasn't reached GitHub yet" : `${waiting} flags haven't reached GitHub yet`;
}

function readLastSynced(storage) {
  try {
    const value = storage.getItem(LAST_SYNCED_KEY);
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

function writeLastSynced(storage, iso) {
  try {
    storage.setItem(LAST_SYNCED_KEY, iso);
    return true;
  } catch {
    return false;
  }
}
return { FLAG_TEXT_MAX, FLAG_CTX_MAX, LAST_SYNCED_KEY, APP_VERSION, capContext, shortAgent, scrubText, flagContext, flagAbout, openFlags, addressedCount, waitingFlags, flagSyncLine, readLastSynced, writeLastSynced };
})();

// ---- js/changes.js
const __js_changes = (() => {
// Claude's change log: what one of Claude's commands changed, as plain data, and the readers ⚙ and
// the tool use. Pure. The store writes and undoes changes (js/data.js); this only describes them.

const { MAPS, stableStringify } = __js_doc;

const CHANGE_KEEP_DAYS = 30; // days a change keeps its before/after snapshots

const LOGGED = MAPS.filter((m) => m !== 'changes');
const DAY_MS = 86400000;

// Every record whose serialised form differs between two documents, as { map, id, before, after }
// (before is null for a new record). Copies, never the documents' own objects, in MAPS order then
// id order. The change log itself is left out.
function diffDocs(before, after) {
  const edits = [];
  for (const map of LOGGED) {
    const a = before?.[map] ?? {};
    const b = after?.[map] ?? {};
    for (const id of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (stableStringify(a[id] ?? null) === stableStringify(b[id] ?? null)) continue;
      edits.push({
        map, id,
        before: a[id] ? structuredClone(a[id]) : null,
        after: b[id] ? structuredClone(b[id]) : null,
      });
    }
  }
  return edits;
}

// The fields that differ between two versions of a record, `updated` aside.
function fieldChanges(before, after) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
    .filter((k) => k !== 'updated').sort();
  return keys
    .filter((k) => stableStringify(before?.[k] ?? null) !== stableStringify(after?.[k] ?? null))
    .map((k) => ({ field: k, from: before?.[k] ?? null, to: after?.[k] ?? null }));
}

function recordTitle(rec) {
  return String(rec?.title ?? rec?.text ?? rec?.summary ?? (rec?.day ? `on ${rec.day}` : ''));
}

const ITEM_NOUNS = { task: 'task', habit: 'habit', quota: 'weekly target' };
const NOUNS = { goals: 'goal', milestones: 'milestone', journal: 'journal entry', flags: 'flag' };

function noun(map, rec) {
  if (map === 'items') return ITEM_NOUNS[rec?.type] ?? 'item';
  if (map === 'logs') return rec?.kind === 'done' ? 'tick' : 'logged amount';
  return NOUNS[map] ?? map;
}

const show = (value) => {
  const s = JSON.stringify(value) ?? 'null';
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
};

// What one edit did, for ⚙'s Details: a new record in one line, a changed one field by field,
// named as Claude found it (so a rename reads 'task "A": title "A" → "B"'). A pruned edit (no
// snapshots) has nothing to show.
function editLines(edit) {
  if (!edit.before && !edit.after) return [];
  const rec = edit.before ?? edit.after;
  const name = `${noun(edit.map, rec)} "${recordTitle(rec)}"`;
  if (!edit.before) return [`New ${name}`];
  if (!edit.after) return [`Removed ${name}`];
  const fields = fieldChanges(edit.before, edit.after);
  return fields.length
    ? fields.map((f) => `${name}: ${f.field} ${show(f.from)} → ${show(f.to)}`)
    : [`${name}: no visible change`];
}

// Claude's changes, newest first.
function changeList(doc) {
  return Object.values(doc?.changes ?? {})
    .filter((c) => c.status === 'active')
    .sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
}

// ⚙'s summary line for the group: how many changes in the seven days up to `now`.
function changeCountLine(doc, now) {
  const list = changeList(doc);
  if (!list.length) return 'none yet';
  const since = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  return `${list.filter((c) => c.at >= since).length} in the last week`;
}

const canUndo = (change) => !change.undoneAt && !change.pruned;

// One line saying what an undo did (the result of store.undoChange).
function undoLine({ undone = [], skipped = [], already = false } = {}) {
  if (already) return 'Already undone, or too old to undo.';
  if (!undone.length) return 'Changed since — not undone.';
  if (!skipped.length) return 'Undone.';
  const names = skipped.map((e) => `"${recordTitle(e.after ?? e.before)}"`).join(', ');
  return `Undone, except ${names} — changed since, not undone.`;
}
return { CHANGE_KEEP_DAYS, diffDocs, fieldChanges, recordTitle, editLines, changeList, changeCountLine, canUndo, undoLine };
})();

// ---- js/parse.js
const __js_parse = (() => {
// Quick-add parsing and amount display. Minute quotas are stored in minutes and shown in hours.

const positive = (n) => (Number.isFinite(n) && n > 0 ? n : null);

function parseAmount(text, unit) {
  const s = String(text ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;

  if (unit === 'count') {
    return /^\d+(\.\d+)?$/.test(s) ? positive(Number(s)) : null;
  }

  let m;
  if ((m = s.match(/^(\d+(?:\.\d+)?)m?$/))) return positive(Math.round(Number(m[1])));
  if ((m = s.match(/^(\d+(?:\.\d+)?)h$/))) return positive(Math.round(Number(m[1]) * 60));
  if ((m = s.match(/^(\d+)h(\d{1,2})m?$/))) {
    const mins = Number(m[2]);
    return mins < 60 ? positive(Number(m[1]) * 60 + mins) : null;
  }
  return null;
}

const oneDecimal = (n) => String(Number(n.toFixed(1)));
const hours = (minutes) => oneDecimal(minutes / 60);

function formatAmount(value, unit) {
  if (unit === 'minutes') return value < 60 ? `${Math.round(value)}m` : `${hours(value)}h`;
  return String(Number(value.toFixed(2)));
}

function formatProgress(total, target, unit) {
  if (unit === 'minutes') return `${hours(total)} / ${hours(target)}h`;
  return `${formatAmount(total, unit)} / ${formatAmount(target, unit)}`;
}

// ---- Lengths and times (the calendar planner) ------------------------------------------------

const LENGTH_MIN = 5;
const LENGTH_MAX = 720;

// A task's or habit's length in minutes: "45m", "2h", "1h30", "1.5h" or a bare number of minutes,
// from 5 minutes to 12 hours.
function parseLength(text) {
  const n = parseAmount(text, 'minutes');
  return n != null && n >= LENGTH_MIN && n <= LENGTH_MAX ? n : null;
}

// A time of day, "14:00" or "9:30", as "HH:MM".
function parseClock(text) {
  const m = String(text ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? `${String(h).padStart(2, '0')}:${m[2]}` : null;
}

const LENGTH_WORD = /^(\d+(\.\d+)?h|\d+m|\d+h\d{1,2}m?)$/i;

// The add box: a trailing length and/or time come off the title ("Draft cover letter 2h", "Call
// NatCen 14:00", "Mock interview 14:00 1h"). A bare number stays in the title ("Read 20"), and the
// title always keeps at least one word.
function splitTaskInput(text) {
  const words = String(text ?? '').trim().split(/\s+/);
  let minutes = null;
  let time = null;
  while (words.length > 1) {
    const last = words[words.length - 1];
    if (time == null && parseClock(last)) { time = parseClock(last); words.pop(); continue; }
    if (minutes == null && LENGTH_WORD.test(last) && parseLength(last)) { minutes = parseLength(last); words.pop(); continue; }
    break;
  }
  return { title: words.join(' '), minutes, time };
}

function checkLength(v) {
  if (v == null || v === '') return null;
  if (!(Number.isInteger(v) && v >= LENGTH_MIN && v <= LENGTH_MAX)) throw new Error('A length should be from 5 minutes to 12 hours');
  return v;
}

const NOTES_MAX = 1000;

// A task's, habit's, target's or goal's notes: text, trimmed, at most NOTES_MAX characters.
function checkNotes(v) {
  if (v == null) return '';
  if (typeof v !== 'string') throw new Error('Notes should be text');
  const t = v.trim();
  if (t.length > NOTES_MAX) throw new Error(`Notes can be at most ${NOTES_MAX} characters`);
  return t;
}

function checkClock(v) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || parseClock(v) !== v) throw new Error('A time should look like 14:00');
  return v;
}
return { parseAmount, formatAmount, formatProgress, LENGTH_MIN, LENGTH_MAX, parseLength, parseClock, splitTaskInput, checkLength, NOTES_MAX, checkNotes, checkClock };
})();

// ---- js/data.js
const __js_data = (() => {
// The store: the whole state is one document in localStorage. Every change goes through here,
// stamps `updated`, saves, and tells listeners why it changed.

const { logicalDay, addDays, weekStart } = __js_dates;
const { MAPS, emptyDoc, stableStringify, isDoc, journalId } = __js_doc;
const { mergeDocs } = __js_merge;
const { FLAG_TEXT_MAX, capContext } = __js_flags;
const { CHANGE_KEEP_DAYS, canUndo } = __js_changes;
const { checkLength, checkClock, checkNotes } = __js_parse;

const DATA_KEY = 'dash_data';
const SETTINGS_KEY = 'dash_settings';
const CORRUPT_KEY = 'dash_data_corrupt';
const DEFAULT_SETTINGS = { token: '', repo: '', dayStartHour: 4, geminiKey: '', checkinHour: 18, look: 'auto' };

const ITEM_TYPES = ['task', 'habit', 'quota'];

// The content each kind of journal record carries, with its empty values.
const JOURNAL_FIELDS = {
  checkin: { questions: [], answers: [], feedback: '', tomorrowIds: [], model: '' },
  digest: { summary: '', wins: [], slipped: [], focus: '', model: '' },
  brief: { text: '' },
};

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function withMaps(doc) {
  for (const map of MAPS) doc[map] ??= {};
  doc.schema ??= 1;
  return doc;
}

// Unreadable saved data is set aside under CORRUPT_KEY, never silently overwritten.
function loadDoc(storage) {
  let raw = null;
  try {
    raw = storage.getItem(DATA_KEY);
  } catch {
    return { doc: emptyDoc(), error: "Saved data couldn't be read on this device, so it started empty." };
  }
  if (!raw) return { doc: emptyDoc(), error: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { doc: withMaps(parsed), error: null };
  } catch {
    // fall through to setting it aside
  }
  try { storage.setItem(CORRUPT_KEY, raw); } catch { /* nothing more can be done */ }
  return {
    doc: emptyDoc(),
    error: "Saved data couldn't be read on this device, so it started empty.",
  };
}

function requireTitle(title, what) {
  const t = String(title ?? '').trim();
  if (!t) throw new Error(`${what} needs a title`);
  return t;
}

function createStore({ storage, now = () => new Date(), newId = () => crypto.randomUUID() }) {
  const loaded = loadDoc(storage);
  let doc = loaded.doc;
  let settings = { ...DEFAULT_SETTINGS, ...(readJson(storage, SETTINGS_KEY) ?? {}) };
  const loadError = loaded.error;
  let saveError = null;
  const listeners = new Set();

  const stamp = () => now().toISOString();
  const today = () => logicalDay(now(), settings.dayStartHour);
  const notify = (reason) => { for (const fn of listeners) fn(reason); };

  function save(key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      saveError = null;
    } catch (e) {
      saveError = e?.message || String(e);
    }
  }

  function commit(reason) {
    save(DATA_KEY, doc);
    notify(reason);
  }

  // Writes a record into the document without saving, for callers that write several records
  // and then commit once.
  function build(map, fields) {
    const rec = {
      source: 'me', status: 'active', created: today(), archivedOn: null,
      ...fields,
      id: fields.id ?? newId(),
      updated: stamp(),
    };
    doc[map][rec.id] = rec;
    return rec;
  }

  function create(map, fields) {
    const rec = build(map, fields);
    commit('local');
    return rec;
  }

  function patch(map, id, changes) {
    const rec = doc[map][id];
    if (!rec) throw new Error(`No ${map} record ${id}`);
    doc[map][id] = { ...rec, ...changes, id, updated: stamp() };
    commit('local');
    return doc[map][id];
  }

  const nextOrder = (map) => Math.max(0, ...Object.values(doc[map]).map((r) => r.order ?? 0)) + 1;

  // An item's fields, checked and with the defaults filled in. Nothing is written.
  function itemFields(fields) {
    if (!ITEM_TYPES.includes(fields.type)) throw new Error(`Unknown item type ${fields.type}`);
    const title = requireTitle(fields.title, 'An item');
    if (fields.type === 'quota' && !(fields.target > 0)) throw new Error('A quota needs a target above 0');
    const defaults = { area: '', goalId: null, order: nextOrder('items') };
    if (fields.type === 'task') defaults.date = today();
    if (fields.type === 'habit') defaults.repeat = { kind: 'daily' };
    if (fields.type === 'quota') Object.assign(defaults, { unit: 'count', unitLabel: '' });
    const out = { ...defaults, ...fields, title };
    if (fields.minutes !== undefined) out.minutes = checkLength(fields.minutes);
    if (fields.time !== undefined && fields.time !== null && fields.time !== '') {
      if (fields.type !== 'task') throw new Error('Only a task has a time');
      out.time = checkClock(fields.time);
    }
    if (fields.notes !== undefined) out.notes = checkNotes(fields.notes);
    if (fields.priority !== undefined) {
      if (typeof fields.priority !== 'boolean') throw new Error('Priority is true or false');
      if (fields.type !== 'task' && fields.type !== 'habit') throw new Error('Only a task or a habit can be a priority');
      out.priority = fields.priority;
    }
    return out;
  }

  function addItem(fields) {
    return create('items', itemFields(fields));
  }

  function toggleDone(itemId, day = today(), source = 'me') {
    const existing = Object.values(doc.logs).filter((l) =>
      l.itemId === itemId && l.kind === 'done' && l.day === day && l.status === 'active');
    if (existing.length) {
      const t = stamp();
      for (const rec of existing) doc.logs[rec.id] = { ...rec, status: 'archived', updated: t };
      commit('local');
      return;
    }
    return create('logs', { itemId, goalId: null, kind: 'done', day, at: stamp(), note: '', source });
  }

  function logAmount({ itemId = null, goalId = null, amount, day = today(), note = '', source = 'me' }) {
    if (!(amount > 0)) throw new Error('An amount must be above 0');
    if (!itemId && !goalId) throw new Error('logAmount needs an itemId or a goalId');
    return create('logs', { itemId, goalId, kind: 'amount', amount, day, at: stamp(), note, source });
  }

  // A goal's fields, checked and with the defaults filled in. Nothing is written.
  function goalFields(fields) {
    const title = requireTitle(fields.title, 'A goal');
    const defaults = { targetDate: null, target: null, unit: 'count', unitLabel: '', order: nextOrder('goals') };
    const out = { ...defaults, ...fields, title };
    if (fields.notes !== undefined) out.notes = checkNotes(fields.notes);
    return out;
  }

  function addGoal(fields) {
    return create('goals', goalFields(fields));
  }

  function addMilestone(goalId, title, { source = 'me', status = 'active' } = {}) {
    return create('milestones', {
      goalId, title: requireTitle(title, 'A milestone'), done: false, order: nextOrder('milestones'), source, status,
    });
  }

  // A check-in or a digest. The id comes from the kind and the day, so there is only ever one
  // check-in per day and one digest per week, whichever device writes it. Creates the record, or
  // overwrites just the content fields given on the existing one (so saving the answers keeps
  // the questions). Content is copied in, never shared with the caller.
  function saveJournal(record, source = 'gemini') {
    const kind = record?.kind;
    const fields = JOURNAL_FIELDS[kind];
    if (!fields) throw new Error(`Unknown journal kind ${kind}`);
    const day = record.day;
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || addDays(day, 0) !== day) {
      throw new Error(`A journal record needs a real day, not ${day}`);
    }
    if (kind === 'digest' && weekStart(day) !== day) throw new Error("A digest is filed under its week's Monday");
    const id = journalId(kind, day);
    if (record.id != null && record.id !== id) throw new Error(`A ${kind} for ${day} has the id ${id}`);
    const content = {};
    for (const key of Object.keys(fields)) {
      if (record[key] !== undefined) content[key] = structuredClone(record[key]);
    }
    const existing = doc.journal[id];
    if (!existing) return create('journal', { source, ...structuredClone(fields), ...content, id, kind, day });
    doc.journal[id] = { ...existing, ...content, id, kind, day, updated: stamp() };
    commit('local');
    return doc.journal[id];
  }

  // Everything one Gemini reply (or a plan from Claude) proposes, written as suggestions in one
  // commit: a goal with its milestones and the habits and weekly targets linked to it, and tasks
  // for a given day. Every record is checked before any is written, so one bad record leaves the
  // document untouched.
  function addPlan({ goal = null, milestones = [], habits = [], targets = [], tasks = [], source = 'gemini' } = {}) {
    if (milestones.length && !goal) throw new Error('Milestones need a goal');
    const suggested = { status: 'suggested', source };
    const goalRec = goal
      ? goalFields({ title: goal.title, targetDate: goal.targetDate ?? null, why: goal.why ?? '', ...suggested })
      : null;
    const goalId = goalRec ? newId() : null;
    const firstMilestone = nextOrder('milestones');
    const milestoneRecs = milestones.map((title, i) => ({
      goalId, title: requireTitle(title, 'A milestone'), done: false, order: firstMilestone + i, ...suggested,
    }));
    const firstItem = nextOrder('items');
    const itemRecs = [
      ...habits.map((h) => itemFields({
        type: 'habit', title: h.title, repeat: h.repeat ?? { kind: 'daily' }, goalId, ...suggested,
      })),
      ...targets.map((t) => itemFields({
        type: 'quota', title: t.title, target: t.target, unit: t.unit ?? 'count', unitLabel: t.unitLabel ?? '', goalId, ...suggested,
      })),
      ...tasks.map((t) => itemFields({ type: 'task', title: t.title, date: t.date ?? today(), goalId: null, ...suggested })),
    ].map((fields, i) => ({ ...fields, order: firstItem + i }));
    if (!goalRec && !itemRecs.length) return { goal: null, milestones: [], items: [] };
    const out = {
      goal: goalRec ? build('goals', { ...goalRec, id: goalId }) : null,
      milestones: milestoneRecs.map((fields) => build('milestones', fields)),
      items: itemRecs.map((fields) => build('items', fields)),
    };
    commit('local');
    return out;
  }

  // ✓ on a suggested goal: the goal and its still-suggested milestones go live from today. Its
  // proposed habits and targets stay suggestions on Today, to be accepted one by one.
  function acceptGoalPlan(goalId) {
    const goal = doc.goals[goalId];
    if (!goal) throw new Error(`No goals record ${goalId}`);
    const live = { status: 'active', created: today(), updated: stamp() };
    if (goal.status === 'suggested') doc.goals[goalId] = { ...goal, ...live };
    for (const [id, m] of Object.entries(doc.milestones)) {
      if (m.goalId === goalId && m.status === 'suggested') doc.milestones[id] = { ...m, ...live };
    }
    commit('local');
    return doc.goals[goalId];
  }

  // ✕ on a suggested goal: the goal, its still-suggested milestones and any still-suggested items
  // linked to it are dismissed. Anything already accepted is left alone.
  function dismissGoalPlan(goalId) {
    const goal = doc.goals[goalId];
    if (!goal) throw new Error(`No goals record ${goalId}`);
    const gone = { status: 'dismissed', updated: stamp() };
    if (goal.status === 'suggested') doc.goals[goalId] = { ...goal, ...gone };
    for (const map of ['milestones', 'items']) {
      for (const [id, rec] of Object.entries(doc[map])) {
        if (rec.goalId === goalId && rec.status === 'suggested') doc[map][id] = { ...rec, ...gone };
      }
    }
    commit('local');
  }

  // ⚑: a note of something to change, with what the app was doing when the panel opened. The text
  // is trimmed and capped at FLAG_TEXT_MAX characters; the context is copied and capped at 4 KB
  // (js/flags.js), whoever built it.
  function addFlag(text, ctx = null, source = 'me') {
    const clean = Array.from(String(text ?? '').trim()).slice(0, FLAG_TEXT_MAX).join('').trim();
    if (!clean) throw new Error('A flag needs some text');
    return create('flags', { text: clean, ctx: capContext(ctx), source });
  }

  // "Mark addressed": archived, never deleted, and there is no un-address — so the later write
  // always wins a merge. Addressing one that is already addressed changes nothing.
  function addressFlag(id) {
    const rec = doc.flags[id];
    if (!rec) throw new Error(`No flags record ${id}`);
    if (rec.status === 'archived') return rec;
    return patch('flags', id, { status: 'archived', archivedOn: today() });
  }

  // Claude's change log (js/changes.js): one record per command of Claude's that changed
  // something, with a copy of every record it touched before and after. The tool writes these; the
  // page only reads and undoes them.
  function addChange({ summary, edits } = {}) {
    const text = String(summary ?? '').trim();
    if (!text) throw new Error('A change needs a summary');
    if (!Array.isArray(edits) || !edits.length) throw new Error('A change needs at least one edit');
    return create('changes', {
      source: 'claude', at: stamp(), summary: text, edits: structuredClone(edits),
      undoneAt: null, undoneBy: null, pruned: false,
    });
  }

  // Undo one of Claude's changes, record by record. A record Claude created is dismissed (a log is
  // archived, its tombstone); a record Claude changed gets its earlier state back with a fresh
  // stamp, so it wins the merge everywhere. A record that no longer matches what Claude left has
  // been changed since, and is left alone. The change is marked undone only if something was.
  function undoChange(changeId, by = 'me') {
    const change = doc.changes[changeId];
    if (!change) throw new Error(`No changes record ${changeId}`);
    if (!canUndo(change)) return { undone: [], skipped: [], already: true };
    const t = stamp();
    const undone = [];
    const skipped = [];
    for (const edit of change.edits) {
      const current = doc[edit.map]?.[edit.id];
      if (!current || stableStringify(current) !== stableStringify(edit.after)) {
        skipped.push(edit);
        continue;
      }
      doc[edit.map][edit.id] = edit.before
        ? { ...structuredClone(edit.before), updated: t }
        : { ...current, status: edit.map === 'logs' ? 'archived' : 'dismissed', updated: t };
      undone.push(edit);
    }
    if (!undone.length) return { undone, skipped, already: false };
    doc.changes[changeId] = { ...change, undoneAt: t, undoneBy: by, updated: t };
    commit('local');
    return { undone, skipped, already: false };
  }

  // Changes older than CHANGE_KEEP_DAYS lose their before/after snapshots (the summary stays, and
  // they can no longer be undone), so the synced file doesn't grow for ever. Returns how many.
  function pruneChanges() {
    const cutoff = new Date(now().getTime() - CHANGE_KEEP_DAYS * 86400000).toISOString();
    const t = stamp();
    let n = 0;
    for (const [id, c] of Object.entries(doc.changes)) {
      if (c.pruned || !(c.at < cutoff)) continue;
      const edits = (c.edits ?? []).map((e) => ({ map: e.map, id: e.id, before: null, after: null }));
      doc.changes[id] = { ...c, edits, pruned: true, updated: t };
      n++;
    }
    if (n) commit('local');
    return n;
  }

  // The calendar planner's records (js/calendar.js): created, or given new content. A record whose
  // content is already the same is left alone — nothing is written, so nothing syncs.
  function putCalendar(id, fields, source = 'planner') {
    const content = JSON.parse(JSON.stringify(fields));
    const existing = doc.calendar[id];
    if (existing && existing.status === 'active') {
      const same = existing.source === source
        && Object.keys(content).every((k) => stableStringify(existing[k]) === stableStringify(content[k]));
      if (same) return { rec: existing, changed: false };
      doc.calendar[id] = { ...existing, ...content, id, source, updated: stamp() };
      commit('local');
      return { rec: doc.calendar[id], changed: true };
    }
    return { rec: create('calendar', { ...content, id, source }), changed: true };
  }

  // Move `id` to just before `targetId` within `groupIds` (the on-screen order of the draggable
  // rows in the dragged row's own done/undone group, including `id`). The on-screen list is
  // shown as undone-then-done, so it isn't globally sorted by `order` — reordering has to stay
  // within the dragged row's own group, or a neighbour's midpoint can come from the wrong group.
  // Patches only the moved record (or, on a tie, every record whose order actually changes with
  // one shared stamp), so it can never clobber a concurrent edit to another visible row.
  function moveBefore(id, targetId, groupIds) {
    if (id === targetId) return;
    const list = groupIds.filter((x) => x !== id);
    const orderOf = (rid) => doc.items[rid]?.order ?? 0;
    const t = list.indexOf(targetId);
    if (t === -1) {
      // Dropped on a row of the other group: move to the end of this row's own group.
      const order = list.length ? Math.max(...list.map(orderOf)) + 1 : orderOf(id);
      patch('items', id, { order });
      return;
    }
    const hi = orderOf(targetId);
    const lo = t > 0 ? orderOf(list[t - 1]) : hi - 2;
    const mid = (lo + hi) / 2;
    if (lo < mid && mid < hi) {
      patch('items', id, { order: mid });
      return;
    }
    // A tie, or adjacent orders so close that double-precision arithmetic can't represent a
    // midpoint strictly between them: either way, renumber the whole group.
    const base = Math.min(...groupIds.map(orderOf));
    const renumbered = [...list.slice(0, t), id, ...list.slice(t)];
    const t2 = stamp();
    for (let i = 0; i < renumbered.length; i++) {
      const rid = renumbered[i];
      const order = base + i;
      if (orderOf(rid) !== order) doc.items[rid] = { ...doc.items[rid], order, updated: t2 };
    }
    commit('local');
  }

  function replaceDoc(next, reason = 'sync') {
    if (stableStringify(next) === stableStringify(doc)) return;
    doc = withMaps(next);
    commit(reason);
  }

  function importJson(text) {
    let incoming;
    try {
      incoming = JSON.parse(text);
    } catch {
      throw new Error("That file isn't valid JSON");
    }
    if (!isDoc(incoming)) {
      throw new Error("That file isn't a dashboard backup");
    }
    replaceDoc(mergeDocs(doc, incoming), 'local');
  }

  // A save from another window/tab on this device, arriving via the storage event. Merged in,
  // never thrown on — anything unparseable or not a real document is silently ignored.
  function absorbStored(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isDoc(parsed)) return;
    replaceDoc(mergeDocs(doc, parsed), 'sync');
  }

  function updateSettings(changes) {
    settings = { ...settings, ...changes };
    save(SETTINGS_KEY, settings);
    notify('settings');
  }

  return {
    doc: () => doc,
    settings: () => settings,
    today,
    saveError: () => saveError,
    loadError: () => loadError,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    addItem,
    updateItem: (id, changes) => patch('items', id, changes),
    archiveItem: (id) => patch('items', id, { status: 'archived', archivedOn: today() }),
    moveBefore,
    acceptSuggestion: (map, id) => patch(map, id, { status: 'active', created: today() }),
    dismissSuggestion: (map, id) => patch(map, id, { status: 'dismissed' }),

    toggleDone,
    logAmount,
    removeLog: (id) => patch('logs', id, { status: 'archived' }),

    addGoal,
    updateGoal: (id, changes) => patch('goals', id, changes),
    archiveGoal: (id) => patch('goals', id, { status: 'archived', archivedOn: today() }),
    addMilestone,
    updateMilestone: (id, changes) => patch('milestones', id, changes),
    toggleMilestone: (id) => patch('milestones', id, { done: !doc.milestones[id]?.done }),
    archiveMilestone: (id) => patch('milestones', id, { status: 'archived', archivedOn: today() }),

    saveJournal,
    addPlan,
    acceptGoalPlan,
    dismissGoalPlan,

    addFlag,
    addressFlag,

    addChange,
    undoChange,
    pruneChanges,

    putCalendar,

    replaceDoc,
    absorbStored,
    updateSettings,
    exportJson: () => JSON.stringify(doc, null, 2),
    importJson,
  };
}
return { DATA_KEY, SETTINGS_KEY, CORRUPT_KEY, DEFAULT_SETTINGS, createStore };
})();

// ---- js/sync.js
const __js_sync = (() => {
// Sync with one JSON file in a private GitHub repo: GET → merge → apply locally → PUT with the
// sha. A 409 means another device wrote in between, so go round again. Never throws, never
// blocks: every failure comes back as { ok: false, error } for the header to show.

const { mergeDocs, sameDoc } = __js_merge;
const { isDoc } = __js_doc;

class ConflictError extends Error {}

const API = 'https://api.github.com';

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function decodeBase64(b64) {
  const binary = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

function createGitHubClient({ token, repo, path = 'data.json', fetch = (...args) => globalThis.fetch(...args) }) {
  const url = `${API}/repos/${repo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  async function failure(res) {
    let message = '';
    try { message = (await res.json())?.message ?? ''; } catch { /* no body */ }
    return new Error(`GitHub ${res.status}${message ? `: ${message}` : ''}`);
  }

  // Plain-English cause for the two ways a bad or under-scoped key shows up: 401/403 on any
  // request, or a 404 on PUT (GitHub answers 404 rather than 403 when a fine-grained key can't
  // see the repo at all). Everything else keeps GitHub's own message.
  async function explain(res, repo, where) {
    if (res.status === 401 || res.status === 403) {
      return new Error(`GitHub refused the access key — check it hasn't expired and has Contents read and write on ${repo}`);
    }
    if (res.status === 404 && where === 'put') {
      return new Error(`GitHub can't see ${repo} with this key — check the repo name, and that the key was given access to that repo`);
    }
    return failure(res);
  }

  return {
    async get() {
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) throw await explain(res, repo, 'get');
      const body = await res.json();
      // Over 1 MB, the Contents API omits `content` and the file must be read as a blob instead.
      if (!body.content || body.encoding === 'none') {
        const blobRes = await fetch(`${API}/repos/${repo}/git/blobs/${body.sha}`, { headers, cache: 'no-store' });
        if (!blobRes.ok) throw await explain(blobRes, repo, 'get');
        const blob = await blobRes.json();
        return { doc: JSON.parse(decodeBase64(blob.content)), sha: body.sha };
      }
      return { doc: JSON.parse(decodeBase64(body.content)), sha: body.sha };
    },

    async put(doc, sha) {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'sync', content: encodeBase64(JSON.stringify(doc)), ...(sha ? { sha } : {}) }),
      });
      if (res.status === 409) throw new ConflictError(`GitHub 409`);
      if (res.status === 422) {
        const err = await failure(res);
        if (/sha/i.test(err.message)) throw new ConflictError(err.message);
        throw err;
      }
      if (!res.ok) throw await explain(res, repo, 'put');
      return (await res.json()).content.sha;
    },
  };
}

async function syncOnce({ store, client, maxAttempts = 3 }) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let remote;
    try {
      remote = await client.get();
    } catch (e) {
      return { ok: false, error: e.message };
    }
    if (remote && !isDoc(remote.doc)) {
      return { ok: false, error: "The sync file isn't a dashboard document — nothing was changed" };
    }

    let merged;
    try {
      merged = mergeDocs(store.doc(), remote?.doc ?? null);
    } catch (e) {
      return { ok: false, error: `Merge failed: ${e.message}` };
    }
    store.replaceDoc(merged);
    if (remote && sameDoc(merged, remote.doc)) return { ok: true, pushed: false };

    try {
      await client.put(merged, remote?.sha);
      return { ok: true, pushed: true };
    } catch (e) {
      if (!(e instanceof ConflictError)) return { ok: false, error: e.message };
    }
  }
  return { ok: false, error: 'Another device kept writing at the same moment — will retry next time' };
}

function createSyncScheduler({ run, canRun = () => true, debounceMs = 5000, timers = globalThis }) {
  let timer = null;
  let running = false;
  let again = false;

  function schedule() {
    if (timer) timers.clearTimeout(timer);
    timer = timers.setTimeout(now, debounceMs);
  }

  async function now() {
    if (timer) { timers.clearTimeout(timer); timer = null; }
    if (!canRun()) { schedule(); return; }
    if (running) { again = true; return; }
    running = true;
    try {
      await run();
    } finally {
      running = false;
      if (again) { again = false; now().catch(() => {}); }
    }
  }

  function flush() {
    if (!timer) return;
    return now();
  }

  return { now, changed: schedule, flush };
}
return { ConflictError, encodeBase64, decodeBase64, createGitHubClient, syncOnce, createSyncScheduler };
})();

// ---- js/calendar.js
const __js_calendar = (() => {
// The calendar planner's records in the synced document — the `calendar` map — and what the page
// and Claude's tool read from them. Pure. The planner (planner/) writes `day:1` … `day:7` (one per
// weekday, overwritten when that weekday comes round again: the blocks it booked, what George
// deleted or missed, its notes) and `status`; `config` holds its settings, written by Claude or
// seeded by the planner.

const { weekday, shortWeekday, shortDate, addDays } = __js_dates;

const CALENDAR_DEFAULTS = {
  hours: ['09:00', '19:00'], gapMinutes: 15, defaultMinutes: 30, maxBlockMinutes: 150,
  days: 7, exactDays: 2, firmUpHour: 20,
  ignore: ['University of York', 'MiM Committee Meetings', 'Family', 'PhD', 'Holidays in United Kingdom'],
  areaCalendars: { 'Job search': 'Application', 'Assessment centre': 'Application', Health: 'Gym', Challenger: 'Challenger' },
  defaultCalendar: 'main',
  habitEvents: [{ habit: 'Hebrew', calendar: 'main', title: 'Learn Hebrew' }, { habit: 'Gym', calendar: 'Gym', title: 'Gym' }],
  priorityAreas: [],
  areaColors: {},
  dayHours: {},
};

// Google Calendar's event colours, by the names George sees, and their ids in the API.
const COLOR_NAMES = {
  Lavender: '1', Sage: '2', Grape: '3', Flamingo: '4', Banana: '5', Tangerine: '6',
  Peacock: '7', Graphite: '8', Blueberry: '9', Basil: '10', Tomato: '11',
};

const colorName = (id) => Object.keys(COLOR_NAMES).find((n) => COLOR_NAMES[n] === String(id)) ?? null;

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');
const text = (v) => typeof v === 'string' && v.trim() !== '';
const copy = (v) => JSON.parse(JSON.stringify(v));
const norm = (s) => String(s ?? '').trim().toLowerCase();
const realDay = (d) => typeof d === 'string' && DAY.test(d) && addDays(d, 0) === d;

function clockMinutes(hhmm) {
  const m = CLOCK.exec(String(hhmm ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function wholeNumber(lo, hi) {
  return (v, field) => {
    if (!(Number.isInteger(v) && v >= lo && v <= hi)) throw new Error(`${field} should be a whole number from ${lo} to ${hi}`);
    return v;
  };
}

// Each setting's check: the value to keep, or a plain-English reason.
const CONFIG_CHECKS = {
  hours: (v, field) => {
    const ok = Array.isArray(v) && v.length === 2 && clockMinutes(v[0]) != null && clockMinutes(v[1]) != null
      && clockMinutes(v[0]) < clockMinutes(v[1]);
    if (!ok) throw new Error(`${field} should be two times like ["09:00", "19:00"], the first earlier`);
    return [v[0], v[1]];
  },
  gapMinutes: wholeNumber(0, 60),
  defaultMinutes: wholeNumber(5, 240),
  maxBlockMinutes: wholeNumber(30, 480),
  days: wholeNumber(1, 14),
  exactDays: wholeNumber(1, 7),
  firmUpHour: wholeNumber(12, 23),
  ignore: (v, field) => {
    if (!Array.isArray(v) || !v.every(text)) throw new Error(`${field} should be a list of calendar names`);
    return v.map((s) => s.trim());
  },
  areaCalendars: (v, field) => {
    const ok = v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([a, c]) => text(a) && text(c));
    if (!ok) throw new Error(`${field} should map each area to a calendar name, like {"Job search": "Application"}`);
    return Object.fromEntries(Object.entries(v).map(([a, c]) => [a.trim(), c.trim()]));
  },
  defaultCalendar: (v, field) => {
    if (!text(v)) throw new Error(`${field} should be a calendar name, or "main"`);
    return v.trim();
  },
  habitEvents: (v, field) => {
    const ok = Array.isArray(v) && v.every((l) => l && typeof l === 'object' && text(l.habit) && text(l.calendar) && text(l.title));
    if (!ok) throw new Error(`${field} should be a list like [{"habit": "Gym", "calendar": "Gym", "title": "Gym"}]`);
    return v.map((l) => ({ habit: l.habit.trim(), calendar: l.calendar.trim(), title: l.title.trim() }));
  },
  priorityAreas: (v, field) => {
    if (!Array.isArray(v) || !v.every(text)) throw new Error(`${field} should be a list of area names`);
    return v.map((s) => s.trim());
  },
  areaColors: (v, field) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${field} should map each area to a colour, like {"Assessment centre": "Grape"}`);
    const out = {};
    const used = new Map();
    for (const [area, name] of Object.entries(v)) {
      const colour = Object.keys(COLOR_NAMES).find((n) => n.toLowerCase() === norm(name));
      if (!text(area) || !colour) throw new Error(`${field}: "${name}" isn't one of Google's colours — ${Object.keys(COLOR_NAMES).join(', ')}`);
      if (used.has(colour)) throw new Error(`${field} gives ${colour} to both ${used.get(colour)} and ${area.trim()} — each area needs its own colour`);
      used.set(colour, area.trim());
      out[area.trim()] = colour;
    }
    return out;
  },
  dayHours: (v, field) => {
    const ok = v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([d, h]) => realDay(d)
      && Array.isArray(h) && h.length === 2 && clockMinutes(h[0]) != null && clockMinutes(h[1]) != null && clockMinutes(h[0]) < clockMinutes(h[1]));
    if (!ok) throw new Error(`${field} should map a date to two times, like {"2026-09-18": ["09:00", "13:00"]}`);
    return Object.fromEntries(Object.entries(v).map(([d, h]) => [d, [h[0], h[1]]]));
  },
};

// Settings that change one key at a time: a key set to null is removed; the rest are kept.
const MERGED_SETTINGS = ['areaCalendars', 'areaColors', 'dayHours'];

function mergeSetting(field, current, value) {
  if (!MERGED_SETTINGS.includes(field) || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = { ...(current ?? {}) };
  for (const [key, v] of Object.entries(value)) {
    const had = Object.keys(out).find((k) => norm(k) === norm(key));
    if (had !== undefined) delete out[had];
    if (v !== null) out[key.trim()] = v;
  }
  return out;
}

function checkConfigField(field, value) {
  const check = Object.hasOwn(CONFIG_CHECKS, field) ? CONFIG_CHECKS[field] : null;
  if (!check) throw new Error(`The planner has no setting "${field}" — settings: ${Object.keys(CONFIG_CHECKS).join(', ')}`);
  return check(value, field);
}

// The planner's settings: the defaults, with every good saved field over them. A bad saved field
// keeps its default and is named in `problems`.
function readPlannerConfig(doc) {
  const config = copy(CALENDAR_DEFAULTS);
  const problems = [];
  const saved = doc?.calendar?.config;
  if (saved && saved.status === 'active') {
    for (const field of Object.keys(CONFIG_CHECKS)) {
      if (saved[field] === undefined) continue;
      try {
        config[field] = checkConfigField(field, saved[field]);
      } catch (e) {
        problems.push(`The planner setting ${field} isn't usable (${e.message}), so it's using the default`);
      }
    }
  }
  return { config, problems };
}

// ---- Time off, priority, the brief (Claude's controls) -----------------------------------------

// Time off: `off:<start day>` records in the calendar map — whole days (start and end both dates,
// end included) or a stretch of hours (both YYYY-MM-DDTHH:MM, end not included) — covering `areas`,
// or everything when that's empty. Cancelled ones are archived.
function timeOff(doc) {
  return Object.values(doc?.calendar ?? {})
    .filter((r) => r.status === 'active' && String(r.id).startsWith('off:'))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

const wholeDays = (off) => DAY.test(off.start ?? '') && DAY.test(off.end ?? '');
const inScope = (off, area) => !off.areas?.length || off.areas.some((a) => norm(a) === norm(area));

const offCovers = (off, day) => wholeDays(off) && off.start <= day && day <= off.end;

// Whether an item is excused on a day: whole-day time off covering its area.
function excused(doc, item, day, offs = timeOff(doc)) {
  return offs.some((o) => offCovers(o, day) && inScope(o, item.area));
}

function localMs(stamp) {
  const [d, t = '00:00'] = stamp.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, h, min).getTime();
}

// The stretches of hours off that touch a day, in milliseconds.
function offWindows(doc, day, offs = timeOff(doc)) {
  const from = localMs(day);
  const to = localMs(addDays(day, 1));
  return offs
    .filter((o) => STAMP.test(o.start ?? '') && STAMP.test(o.end ?? ''))
    .map((o) => ({ start: localMs(o.start), end: localMs(o.end), areas: o.areas ?? [] }))
    .filter((w) => w.start < to && w.end > from);
}

// The line Today shows on a day with time off: 'Time off — Maya leaves for Austria · Job search'.
function offLine(doc, day) {
  const parts = [];
  for (const o of timeOff(doc)) {
    const hours = offWindows(doc, day, [o]).length > 0;
    if (!hours && !offCovers(o, day)) continue;
    const areas = o.areas?.length ? ` · ${o.areas.join(', ')}` : '';
    const when = hours ? ` · ${o.start.slice(11)}–${o.end.slice(11)}` : '';
    parts.push(`${o.reason || 'Time off'}${areas}${when}`);
  }
  return parts.length ? `Time off — ${parts.join('; ')}` : null;
}

// Time off as Claude's tool writes it, checked: plain English when it's wrong.
function checkTimeOff({ start, end, areas = [], reason = '' } = {}) {
  const s = String(start ?? '').trim();
  const e = String(end ?? start ?? '').trim();
  const days = realDay(s) && realDay(e);
  const stamp = (v) => STAMP.test(v) && realDay(v.slice(0, 10)) && clockMinutes(v.slice(11)) != null;
  const hours = stamp(s) && stamp(e);
  if (!days && !hours) throw new Error('Time off needs start and end as dates (YYYY-MM-DD), or both as a date and time (YYYY-MM-DDTHH:MM)');
  if (days ? e < s : e <= s) throw new Error('Time off has to end after it starts');
  if (!Array.isArray(areas) || !areas.every(text)) throw new Error('areas should be a list of area names, or left out for everything');
  const why = String(reason ?? '').trim();
  if (why.length > 200) throw new Error('The reason can be at most 200 characters');
  return { start: s, end: e, areas: areas.map((a) => a.trim()), reason: why };
}

// 'Wed 16 Sep – Thu 17 Sep — Maya leaves for Austria · Job search' or '… · everything'.
function offText(o) {
  const dayText = (d) => `${shortWeekday(d)} ${shortDate(d)}`;
  const range = o.start.length === 10
    ? (o.start === o.end ? dayText(o.start) : `${dayText(o.start)} – ${dayText(o.end)}`)
    : `${dayText(o.start.slice(0, 10))}, ${o.start.slice(11)}–${o.end.slice(11)}`;
  return `${range} — ${o.reason || 'Time off'} · ${o.areas?.length ? o.areas.join(', ') : 'everything'}`;
}

function nextOffId(doc, start) {
  const day = String(start).slice(0, 10);
  let id = `off:${day}`;
  for (let n = 0; doc?.calendar?.[id]; n++) id = `off:${day}${String.fromCharCode(98 + n)}`;
  return id;
}

// A priority: the item says so, or its area is one of the planner's priority areas.
function isPriority(doc, item, config = readPlannerConfig(doc).config) {
  return item.priority === true || config.priorityAreas.some((a) => norm(a) === norm(item.area));
}

// Claude's brief for a day (a journal record, kind 'brief').
function briefFor(doc, day) {
  const rec = doc?.journal?.[`brief:${day}`];
  return rec && rec.status === 'active' && rec.text ? rec.text : null;
}

const dayRecordId = (day) => `day:${weekday(day)}`;

function dayRecord(doc, day) {
  const rec = doc?.calendar?.[dayRecordId(day)];
  return rec && rec.status === 'active' && rec.day === day ? rec : null;
}

function plannerStatus(doc) {
  const rec = doc?.calendar?.status;
  return rec && rec.status === 'active' ? rec : null;
}

// Today's planned times by item, from today's exact, fixed, done and part-done blocks (rough ones
// never show on the list). An item in two blocks (the rest of a part-done one) shows the later.
function todaySlots(doc, today) {
  const slots = new Map();
  for (const b of dayRecord(doc, today)?.blocks ?? []) {
    if (b.state === 'rough') continue;
    for (const id of b.items ?? []) {
      const had = slots.get(id);
      if (!had || Date.parse(b.start) > Date.parse(had.start)) slots.set(id, { start: b.start, end: b.end, state: b.state, title: b.title });
    }
  }
  return slots;
}

const plannerNotes = (doc, today) => [...(dayRecord(doc, today)?.notes ?? [])];

// The notes the header shows: newest first, at most two, without the ones hidden on this device
// today (hidden keys are "<day>|<note>").
function visibleNotes(notes, hiddenKeys, today) {
  const hidden = new Set(hiddenKeys);
  return notes.filter((n) => !hidden.has(`${today}|${n}`)).reverse().slice(0, 2);
}

function clockLabel(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const localDayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 'HH:MM' for a moment today; 'Mon 14 Sep, 12:00' for any other day.
function momentLabel(iso, now) {
  const d = new Date(iso);
  const day = localDayOf(d);
  return day === localDayOf(now) ? clockLabel(iso) : `${shortWeekday(day)} ${shortDate(day)}, ${clockLabel(iso)}`;
}

// When the planner last ran, if that's more than `minutes` ago; null while it's running, before it
// has ever run, and while it's paused.
function staleSince(doc, now, minutes = 70) {
  const s = plannerStatus(doc);
  if (!s?.lastRun || s.paused) return null;
  return now.getTime() - Date.parse(s.lastRun) > minutes * 60000 ? momentLabel(s.lastRun, now) : null;
}

// Today's rows in the day's order: suggestions stay on top; then undone rows with a time, earliest
// first; then every other row in the order it came (undone, then done).
function timedOrder(rows, slots) {
  const timed = (r) => !r.suggested && !r.done && slots.has(r.item.id);
  const start = (r) => Date.parse(slots.get(r.item.id).start);
  return [
    ...rows.filter((r) => r.suggested),
    ...rows.filter(timed).sort((a, b) => start(a) - start(b)),
    ...rows.filter((r) => !r.suggested && !timed(r)),
  ];
}

// ⚙ → Calendar planner: the folded line and what's inside.
function plannerSummary(doc, now) {
  const { config } = readPlannerConfig(doc);
  const exact = config.exactDays === 1 ? 'today exact' : config.exactDays === 2 ? 'today and tomorrow exact' : `the first ${config.exactDays} days exact`;
  const lines = [`Plans ${config.hours[0]}–${config.hours[1]}, ${config.days} days ahead: ${exact}, rough after that.`];
  const s = plannerStatus(doc);
  if (!s) return { summary: 'not set up', lines: [...lines, "It hasn't run yet — the README says how to set it up."] };
  lines.push(`Last ran ${momentLabel(s.lastRun, now)}${s.version ? ` · build ${s.version}` : ''}.`);
  if (s.lastError) lines.push(`Last problem: ${s.lastError}`);
  lines.push('To change its settings, ask Claude — for example "plan between 8:30 and 6".');
  return { summary: s.paused ? 'paused' : `last ran ${momentLabel(s.lastRun, now)}`, lines };
}
return { CALENDAR_DEFAULTS, COLOR_NAMES, colorName, clockMinutes, CONFIG_CHECKS, MERGED_SETTINGS, mergeSetting, checkConfigField, readPlannerConfig, timeOff, offCovers, excused, offWindows, offLine, checkTimeOff, offText, nextOffId, isPriority, briefFor, dayRecordId, dayRecord, plannerStatus, todaySlots, plannerNotes, visibleNotes, clockLabel, momentLabel, staleSince, timedOrder, plannerSummary };
})();

// ---- js/gemini.js
const __js_gemini = (() => {
// The Gemini client. One call walks the models (lite first) on each key until one answers, and
// returns the reply's JSON. Every failure is a GeminiError carrying one of the plain-English
// messages below. The key only ever goes into the request URL: it is never put in an error, a
// log line, or anything else this module produces.

const MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 30000;
const MAX_WAIT_S = 20;
const HEBREW_KEY_NAMES = ['hvr_geminikey', 'hvr_geminikey2'];

const MESSAGES = {
  nokey: 'The coach needs a Gemini key. Add one in ⚙, or save one in the Hebrew app on this device.',
  offline: "Can't reach Gemini — check you're online and try again",
  quota: "Gemini's free limit is used up for today — try tomorrow",
  badkey: 'Gemini refused the key — check it in ⚙',
  failed: "Gemini didn't answer — try again",
  nonsense: "Gemini's reply didn't make sense — try again",
};

class GeminiError extends Error {
  constructor(code) {
    const known = Object.hasOwn(MESSAGES, code) ? code : 'failed';
    super(MESSAGES[known]);
    this.name = 'GeminiError';
    this.code = known;
  }
}

function readKey(storage, name) {
  try {
    const value = storage?.getItem(name);
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

// The Hebrew app's keys on this device (same origin, so the same localStorage), in its order.
function hebrewKeys(storage) {
  return [...new Set(HEBREW_KEY_NAMES.map((name) => readKey(storage, name)).filter(Boolean))];
}

// Every usable key, in the order to try them: the dashboard's own setting, then the Hebrew app's.
function geminiKeys(settings, storage) {
  const own = typeof settings?.geminiKey === 'string' ? settings.geminiKey.trim() : '';
  return [...new Set([own, ...hebrewKeys(storage)].filter(Boolean))];
}

function requestBody(system, prompt, plain) {
  if (plain) return { contents: [{ role: 'user', parts: [{ text: `${system}\n\n${prompt}` }] }] };
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.6 },
  };
}

// The JSON inside a 200 reply: the first candidate's text parts joined, ```json fences stripped.
// Throws the "didn't make sense" error for anything else.
function readReply(bodyText) {
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new GeminiError('nonsense');
  }
  const parts = body?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.filter((p) => typeof p?.text === 'string' && !p.thought).map((p) => p.text).join('').trim()
    : '';
  if (!text) throw new GeminiError('nonsense');
  const bare = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(bare);
  } catch {
    // Without JSON mode (the plain retry) the object can come wrapped in a sentence.
  }
  const from = bare.indexOf('{');
  const to = bare.lastIndexOf('}');
  if (from !== -1 && to > from) {
    try {
      return JSON.parse(bare.slice(from, to + 1));
    } catch {
      // fall through
    }
  }
  throw new GeminiError('nonsense');
}

// Seconds from a 429's "retry in Ns", or null when it has no such hint.
function retryAfterSeconds(text) {
  const m = String(text ?? '').match(/retry in ([\d.]+)s/i);
  const seconds = m ? Number(m[1]) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

// A key Google won't accept at all: no point trying it again on another model.
function refusesKey(status, text) {
  return status === 401 || status === 403 || (status === 400 && /API[ _]key not valid|API_KEY_INVALID/i.test(text));
}

// What to tell George once every model on every key has failed.
function verdict(outcomes) {
  const rest = outcomes.filter((o) => o !== 'badkey');
  if (!rest.length) return 'badkey';
  if (rest.every((o) => o === 'quota')) return 'quota';
  if (rest.every((o) => o === 'network')) return 'offline';
  return 'failed';
}

async function askGemini({
  keys,
  system,
  prompt,
  fetch = (...args) => globalThis.fetch(...args),
  timers = globalThis,
  models = MODELS,
  timeoutMs = TIMEOUT_MS,
}) {
  const usable = [...new Set((keys ?? []).map((k) => String(k ?? '').trim()).filter(Boolean))];
  if (!usable.length) throw new GeminiError('nokey');

  const sleep = (ms) => new Promise((resolve) => { timers.setTimeout(resolve, ms); });

  // One round trip, abandoned after timeoutMs. Resolves { status, text } or { fail }.
  async function send(model, key, plain) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = timers.setTimeout(() => { controller?.abort(); resolve({ fail: 'timeout' }); }, timeoutMs);
    });
    const work = (async () => {
      const res = await fetch(`${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody(system, prompt, plain)),
        signal: controller?.signal,
      });
      return { status: res.status, text: await res.text() };
    })().catch(() => ({ fail: 'network' }));
    try {
      return await Promise.race([work, timeout]);
    } finally {
      timers.clearTimeout(timer);
    }
  }

  // One model on one key. The plain-body retry after a 400 and the short wait after a 429 each
  // happen at most once. Resolves { data } or { fail }; a 200 that isn't JSON throws.
  async function attempt(model, key) {
    let plain = false;
    let waited = false;
    for (;;) {
      const res = await send(model, key, plain);
      if (res.fail) return { fail: res.fail };
      if (res.status >= 200 && res.status < 300) return { data: readReply(res.text) };
      if (refusesKey(res.status, res.text)) return { fail: 'badkey' };
      if (res.status === 400 && !plain) { plain = true; continue; }
      if (res.status === 429) {
        const wait = retryAfterSeconds(res.text);
        if (!waited && wait !== null && wait <= MAX_WAIT_S) {
          waited = true;
          await sleep(Math.ceil(wait * 1000));
          continue;
        }
        return { fail: 'quota' };
      }
      return { fail: res.status >= 500 ? 'server' : 'rejected' };
    }
  }

  // Lite on every key before Flash on any: the Hebrew app shares these keys and needs Flash.
  const outcomes = [];
  const refused = new Set();
  for (const model of models) {
    for (const key of usable) {
      if (refused.has(key)) continue;
      const result = await attempt(model, key);
      if ('data' in result) return { data: result.data, model };
      if (result.fail === 'badkey') refused.add(key);
      outcomes.push(result.fail);
    }
  }
  throw new GeminiError(verdict(outcomes));
}
return { MODELS, ENDPOINT, TIMEOUT_MS, MAX_WAIT_S, HEBREW_KEY_NAMES, MESSAGES, GeminiError, hebrewKeys, geminiKeys, readReply, retryAfterSeconds, askGemini };
})();

// ---- planner/time.js
const __planner_time = (() => {
// Moments on George's days, in local time. The tests set TZ=Europe/London; Apps Script uses the
// project's time zone (Europe/London in appsscript.json), so a planning hour is a wall-clock hour
// on both sides of a clock change.

const MINUTE = 60000;
const pad = (n) => String(n).padStart(2, '0');

function at(day, hhmm) {
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, h, min);
}

const localDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const iso = (msOrDate) => new Date(msOrDate).toISOString();
return { MINUTE, at, localDay, iso };
})();

// ---- planner/events.js
const __planner_events = (() => {
// Google Calendar events as the planner sees them. Pure. The planner marks every event it makes
// with private properties George never sees — that it's the planner's, which block, which items,
// the title without its prefixes, where it last put it, its state, whether George has moved it — so
// its memory of each block lives on the event itself.

const P = {
  mine: 'dash', key: 'dashKey', items: 'dashItems', title: 'dashTitle', at: 'dashAt',
  state: 'dashState', pin: 'dashPin', habit: 'dashHabit',
};

const when = (v) => (v ? new Date(v) : null);

function normEvent(raw, calendarId) {
  const allDay = !!raw.start?.date && !raw.start?.dateTime;
  const props = { ...(raw.extendedProperties?.private ?? {}) };
  return {
    id: raw.id,
    calendarId,
    title: String(raw.summary ?? ''),
    description: String(raw.description ?? ''),
    start: allDay ? null : when(raw.start?.dateTime),
    end: allDay ? null : when(raw.end?.dateTime),
    allDay,
    free: raw.transparency === 'transparent',
    others: (raw.attendees ?? []).filter((a) => !a.self && !a.resource).length,
    cancelled: raw.status === 'cancelled',
    recurringEventId: raw.recurringEventId ?? null,
    originalStart: when(raw.originalStartTime?.dateTime),
    props,
    mine: props[P.mine] === '1',
    colorId: raw.colorId ?? null,
    useDefault: raw.reminders?.useDefault ?? true,
  };
}

const atText = (start, end) => `${new Date(start).toISOString()}/${new Date(end).toISOString()}`;

// George has moved it: marked so already, or no longer where the planner last put it.
function movedByGeorge(ev) {
  if (ev.props[P.pin] === '1') return true;
  const at = ev.props[P.at];
  if (!at || !ev.start || !ev.end) return false;
  const [s, e] = at.split('/');
  return Date.parse(s) !== ev.start.getTime() || Date.parse(e) !== ev.end.getTime();
}

// A Hebrew or Gym session George placed himself: away from where the planner put it, or — if the
// planner never touched it — away from its series' own time.
function habitPinned(ev) {
  if (ev.props[P.at] || ev.props[P.pin]) return movedByGeorge(ev);
  return !!ev.originalStart && !!ev.start && ev.originalStart.getTime() !== ev.start.getTime();
}

// "dashboard:<id>" lines: Claude writes the id as its tool shows it (the first 8 characters).
function linkedIds(description) {
  return [...String(description ?? '').matchAll(/dashboard:([\w:.-]+)/g)].map((m) => m[1]);
}

// Google's event colours pair up dark and light. A rough block takes the light partner of the event
// colour nearest its calendar's colour — Graphite when that colour is already a light one.
const PALE = { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '5', 7: '1', 8: '8', 9: '1', 10: '2', 11: '4' };

function rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

// The event colour nearest a calendar's colour, by RGB distance; null when there's nothing to compare.
function nearestColor(calendarHex, eventColors) {
  const c = rgb(calendarHex);
  if (!c) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const [id, hex] of Object.entries(eventColors ?? {}).sort(([a], [b]) => Number(a) - Number(b))) {
    const e = rgb(hex);
    if (!e) continue;
    const d = (c[0] - e[0]) ** 2 + (c[1] - e[1]) ** 2 + (c[2] - e[2]) ** 2;
    if (d < bestDistance) { best = id; bestDistance = d; }
  }
  return best;
}

// An event colour's light partner; Graphite when it is already a light one.
function paleOf(id) {
  const pale = PALE[id] ?? '8';
  return pale === String(id) ? '8' : pale;
}

function roughColor(calendarHex, eventColors) {
  const best = nearestColor(calendarHex, eventColors);
  return best == null ? '8' : paleOf(best);
}
return { P, normEvent, atText, movedByGeorge, habitPinned, linkedIds, nearestColor, paleOf, roughColor };
})();

// ---- planner/calendars.js
const __planner_calendars = (() => {
// Which of George's calendars the planner reads, which one each area's blocks go on, and which
// habits are linked to events — from its settings, by the names George sees. Pure.

const norm = (s) => String(s ?? '').trim().toLowerCase();

// list: [{ id, name, primary, backgroundColor, accessRole }]. A calendar is ignored when its name
// starts with an `ignore` entry; `main` is the primary calendar.
function resolveCalendars(list, config) {
  const prefixes = config.ignore.map(norm).filter(Boolean);
  const watched = list.filter((c) => !prefixes.some((p) => norm(c.name).startsWith(p)));
  const find = (name) => (norm(name) === 'main'
    ? list.find((c) => c.primary)
    : list.find((c) => norm(c.name) === norm(name))) ?? null;
  return { watched, find };
}

function calendarFor(area, config, find, problems) {
  const key = Object.keys(config.areaCalendars).find((a) => norm(a) === norm(area));
  const wanted = key ? config.areaCalendars[key] : config.defaultCalendar;
  const cal = find(wanted);
  if (cal) return cal;
  problems.add(`Can't find the "${wanted}" calendar — ${area ? `blocks for ${area}` : 'those blocks'} went to your main calendar`);
  return find('main');
}

// Each `habitEvents` entry names its habit by id or by the start of its title. One matching no
// active habit, or more than one, is skipped with a note (its events are then just fixed events).
function habitLinks(doc, config, find, problems) {
  const habits = Object.values(doc.items ?? {}).filter((i) => i.type === 'habit' && i.status === 'active');
  const links = [];
  for (const link of config.habitEvents) {
    const byId = habits.filter((h) => h.id === link.habit);
    const matches = byId.length ? byId : habits.filter((h) => norm(h.title).startsWith(norm(link.habit)));
    if (matches.length !== 1) {
      problems.add(`The planner can't tell which habit "${link.habit}" is (${matches.length ? 'more than one match' : 'no match'}) — its events are treated as fixed`);
      continue;
    }
    const cal = find(link.calendar);
    if (!cal) {
      problems.add(`Can't find the "${link.calendar}" calendar for ${link.title}`);
      continue;
    }
    links.push({ habitId: matches[0].id, calendarId: cal.id, title: link.title, area: String(matches[0].area ?? '').trim() });
  }
  return links;
}
return { norm, resolveCalendars, calendarFor, habitLinks };
})();

// ---- js/schedule.js
const __js_schedule = (() => {
// What's on a day, and the numbers derived from it. Pure: a document and a day in, values out.

const { addDays, weekday, weekStart, dayOfMonth, daysInMonth } = __js_dates;
const { timeOff, excused, offCovers } = __js_calendar;

const values = (map) => Object.values(map ?? {});
const byOrder = (a, b) => (a.item.order ?? 0) - (b.item.order ?? 0);
const activeLogs = (doc, pred) => values(doc.logs).filter((l) => l.status === 'active' && pred(l));

// Live (or since archived), created by `day`, and not yet archived on it.
function countsOn(record, day) {
  if (record.status !== 'active' && record.status !== 'archived') return false;
  if (record.created > day) return false;
  return !record.archivedOn || day < record.archivedOn;
}

// Every active 'done' log, grouped by item, built in one pass. Pass this to the functions below
// (as their last argument) to avoid re-scanning all logs once per item.
function doneIndex(doc) {
  const idx = new Map();
  for (const l of values(doc.logs)) {
    if (l.status !== 'active' || l.kind !== 'done') continue;
    let set = idx.get(l.itemId);
    if (!set) idx.set(l.itemId, set = new Set());
    set.add(l.day);
  }
  return idx;
}

function doneDays(doc, itemId, idx) {
  if (idx) return idx.get(itemId) ?? new Set();
  return new Set(activeLogs(doc, (l) => l.itemId === itemId && l.kind === 'done').map((l) => l.day));
}

// Ticks on days in [from, to).
function doneBetween(doc, itemId, from, to, idx) {
  let n = 0;
  for (const d of doneDays(doc, itemId, idx)) if (d >= from && d < to) n++;
  return n;
}

function isHabitDue(doc, item, day, idx) {
  const r = item.repeat ?? { kind: 'daily' };
  switch (r.kind) {
    case 'daily': return true;
    case 'weekdays': return (r.days ?? []).includes(weekday(day));
    case 'weekly': return weekday(day) === r.day;
    case 'monthly': return dayOfMonth(day) === Math.min(r.date, daysInMonth(day));
    case 'perWeek': return doneBetween(doc, item.id, weekStart(day), day, idx) < r.n;
    default: return false;
  }
}

function taskRow(doc, item, day, idx) {
  if (item.date > day) return null;
  const doneOn = [...doneDays(doc, item.id, idx)].sort()[0] ?? null;
  if (doneOn && doneOn < day) return null;
  return {
    item, kind: 'task', done: doneOn === day,
    carriedFrom: item.date < day ? item.date : null, suggested: false,
  };
}

// The tasks and habits that count on a day — what the header and the history measure. Anything
// excused by time off (js/calendar.js) isn't on it; a task dated then carries to the next day.
function rowsForDay(doc, day, idx = doneIndex(doc), offs = timeOff(doc)) {
  const rows = [];
  for (const item of values(doc.items)) {
    if (!countsOn(item, day)) continue;
    if (offs.length && excused(doc, item, day, offs)) continue;
    if (item.type === 'task') {
      const row = taskRow(doc, item, day, idx);
      if (row) rows.push(row);
    } else if (item.type === 'habit' && isHabitDue(doc, item, day, idx)) {
      rows.push({ item, kind: 'habit', done: doneDays(doc, item.id, idx).has(day), carriedFrom: null, suggested: false });
    }
  }
  return rows.sort(byOrder);
}

// Amounts logged against an item or a goal in the Monday–Sunday week containing `day`.
function weekTotal(doc, id, day) {
  const start = weekStart(day);
  const end = addDays(start, 6);
  return activeLogs(doc, (l) =>
    l.kind === 'amount' && (l.itemId === id || l.goalId === id) && l.day >= start && l.day <= end)
    .reduce((sum, l) => sum + l.amount, 0);
}

// Everything on Today, in display order.
function todayRows(doc, today) {
  const idx = doneIndex(doc);
  const suggestions = values(doc.items)
    .filter((item) => item.status === 'suggested')
    .map((item) => ({ item, kind: item.type, done: false, carriedFrom: null, suggested: true }))
    .sort(byOrder);
  const quotas = values(doc.items)
    .filter((item) => item.type === 'quota' && item.status === 'active' && countsOn(item, today))
    .map((item) => {
      const total = weekTotal(doc, item.id, today);
      return { item, kind: 'quota', done: total >= item.target, carriedFrom: null, suggested: false, total };
    });
  const rows = [...rowsForDay(doc, today, idx).filter((r) => r.item.status === 'active'), ...quotas].sort(byOrder);
  return [...suggestions, ...rows.filter((r) => !r.done), ...rows.filter((r) => r.done)];
}

// ---- Streaks --------------------------------------------------------------------------------

function runs(outcomes) {
  let best = 0;
  let current = 0;
  for (const ok of outcomes) {
    current = ok ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return { current, best };
}

function occurrenceStreak(doc, item, today) {
  const idx = doneIndex(doc);
  const ticked = doneDays(doc, item.id, idx);
  const offs = timeOff(doc);
  const outcomes = [];
  for (let day = item.created; day <= today; day = addDays(day, 1)) {
    if (!isHabitDue(doc, item, day, idx)) continue;
    const ok = ticked.has(day);
    if (!ok && offs.length && excused(doc, item, day, offs)) continue; // time off: a miss doesn't count, a tick still does
    if (day === today && !ok) continue; // today isn't over yet
    outcomes.push(ok);
  }
  return runs(outcomes);
}

// One pass over an item/goal's active amount logs, totalled by the Monday it falls in.
function weekTotals(doc, id) {
  const totals = new Map();
  for (const l of activeLogs(doc, (l) => l.kind === 'amount' && (l.itemId === id || l.goalId === id))) {
    // A log whose day isn't a real YYYY-MM-DD string can't be placed in a week — skip it, matching
    // weekTotal's old behaviour of silently ignoring what it can't place, instead of throwing.
    if (typeof l.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(l.day)) continue;
    const w = weekStart(l.day);
    totals.set(w, (totals.get(w) ?? 0) + l.amount);
  }
  return totals;
}

function weeklyStreak(doc, item, today) {
  const idx = doneIndex(doc);
  const thisWeek = weekStart(today);
  const totals = item.type === 'quota' ? weekTotals(doc, item.id) : null;
  const outcomes = [];
  for (let week = weekStart(item.created); week <= thisWeek; week = addDays(week, 7)) {
    const ok = item.type === 'quota'
      ? (totals.get(week) ?? 0) >= item.target
      : doneBetween(doc, item.id, week, addDays(week, 7), idx) >= item.repeat.n;
    if (week === thisWeek && !ok) continue; // this week isn't over yet
    outcomes.push(ok);
  }
  return runs(outcomes);
}

function streak(doc, item, today) {
  if (item.type === 'quota' || item.repeat?.kind === 'perWeek') return weeklyStreak(doc, item, today);
  if (item.type === 'habit') return occurrenceStreak(doc, item, today);
  return { current: 0, best: 0 };
}

// ---- Completion, history, goals --------------------------------------------------------------

function dayCompletion(doc, day, idx = doneIndex(doc), offs = timeOff(doc)) {
  const rows = rowsForDay(doc, day, idx, offs);
  return { done: rows.filter((r) => r.done).length, total: rows.length };
}

// The current week and the two before it, Monday first: 21 cells. A day of time off for
// everything carries `off`, its reason, instead of reading as 0/0.
function history(doc, today) {
  const idx = doneIndex(doc);
  const offs = timeOff(doc);
  const start = addDays(weekStart(today), -14);
  return Array.from({ length: 21 }, (_, i) => {
    const day = addDays(start, i);
    if (day > today) return { day, future: true, done: 0, total: 0 };
    const off = offs.find((o) => offCovers(o, day) && !o.areas?.length);
    return { day, future: false, ...dayCompletion(doc, day, idx, offs), ...(off ? { off: off.reason || 'Time off' } : {}) };
  });
}

// What a history cell opens up to.
function dayDetail(doc, day) {
  const amounts = activeLogs(doc, (l) => l.kind === 'amount' && l.day === day)
    .map((log) => ({ log, item: doc.items[log.itemId] ?? null, goal: doc.goals[log.goalId] ?? null }))
    .sort((a, b) => ((a.log.at ?? '') < (b.log.at ?? '') ? -1 : 1));
  return { rows: rowsForDay(doc, day, doneIndex(doc)), amounts };
}

function goalTotal(doc, goalId) {
  return activeLogs(doc, (l) => l.kind === 'amount' && l.goalId === goalId)
    .reduce((sum, l) => sum + l.amount, 0);
}

function milestonesOf(doc, goalId) {
  return values(doc.milestones)
    .filter((m) => m.goalId === goalId && (m.status === 'active' || m.status === 'suggested'))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function goalItems(doc, goalId) {
  return values(doc.items)
    .filter((i) => i.goalId === goalId && i.status === 'active')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function goalProgress(doc, goal) {
  if (goal.target > 0) {
    const total = goalTotal(doc, goal.id);
    return { numeric: true, done: total, total: goal.target, pct: Math.min(100, Math.round((total / goal.target) * 100)) };
  }
  const live = milestonesOf(doc, goal.id).filter((m) => m.status === 'active');
  const ticked = live.filter((m) => m.done).length;
  return { numeric: false, done: ticked, total: live.length, pct: live.length ? Math.round((ticked / live.length) * 100) : 0 };
}
return { countsOn, doneIndex, doneDays, doneBetween, isHabitDue, rowsForDay, weekTotal, todayRows, streak, dayCompletion, history, dayDetail, goalTotal, milestonesOf, goalItems, goalProgress };
})();

// ---- planner/demand.js
const __planner_demand = (() => {
// What needs time on each day of the window, before any of it has a time: the day's tasks and
// habits grouped by area into blocks, their lengths, a weekly time target's share, and tasks with a
// set time. Time off (js/calendar.js) excuses what it covers: a task dated inside it moves to the
// next day that isn't off for it. Pure; planner/plan.js places what this returns.

const { addDays, weekStart } = __js_dates;
const { isHabitDue, doneIndex, doneDays, doneBetween, weekTotal } = __js_schedule;
const { timeOff, excused } = __js_calendar;
const { at, MINUTE } = __planner_time;
const { norm } = __planner_calendars;

const values = (map) => Object.values(map ?? {});
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const ceil15 = (n) => Math.ceil(n / 15) * 15;

// k of the list, spread evenly from the first: 2 of six days → the 1st and the 4th.
function evenPicks(list, k) {
  if (k <= 0) return [];
  if (k >= list.length) return [...list];
  return Array.from({ length: k }, (_, i) => list[Math.floor((i * list.length) / k)]);
}

// Tasks with a set time: a fixed event on their date, for their length (not on time off).
function fixedTasks({ doc, days, config }) {
  const offs = timeOff(doc);
  return values(doc.items)
    .filter((i) => i.type === 'task' && i.status === 'active' && i.time && days.includes(i.date) && !excused(doc, i, i.date, offs))
    .sort(byOrder)
    .map((i) => {
      const start = at(i.date, i.time).getTime();
      return {
        key: `${i.date}|fixed|${i.id}`, itemId: i.id, day: i.date, title: i.title, area: String(i.area ?? '').trim(),
        start, end: start + (i.minutes ?? config.defaultMinutes) * MINUTE,
      };
    });
}

// One area's entries on one day as blocks of at most maxBlockMinutes: tasks packed in order, a task
// longer than that in equal parts, then the weekly target's extra time.
function parts(entries, share, name, config) {
  const max = config.maxBlockMinutes;
  const out = [];
  let cur = null;
  for (const { item, carried } of entries) {
    const m = item.minutes ?? config.defaultMinutes;
    if (m > max) {
      const n = Math.ceil(m / max);
      const each = Math.min(max, ceil15(m / n));
      for (let k = 1; k <= n; k++) out.push({ ids: [item.id], titles: [], minutes: each, carried, split: `${item.title} (${k} of ${n})` });
      cur = null;
      continue;
    }
    if (!cur || cur.minutes + m > max) {
      cur = { ids: [], titles: [], minutes: 0, carried: false };
      out.push(cur);
    }
    cur.ids.push(item.id);
    cur.titles.push(item.title);
    cur.minutes += m;
    cur.carried = cur.carried || carried;
  }
  let extra = Math.max(0, (share?.minutes ?? 0) - out.reduce((s, p) => s + p.minutes, 0));
  const last = out[out.length - 1];
  if (extra > 0 && last && !last.split && last.minutes < max) {
    const add = Math.min(extra, max - last.minutes);
    last.minutes += add;
    last.padded = true;
    extra -= add;
  }
  while (extra > 0) {
    const m = Math.min(extra, max);
    out.push({ ids: [], titles: [], minutes: m, carried: false });
    extra -= m;
  }
  const targetTitle = share?.titles.length === 1 ? share.titles[0] : name;
  return out.map((p) => {
    const many = `${name} ×${p.ids.length}`;
    let base;
    if (p.split) base = p.split;
    else if (p.padded) base = p.ids.length > 1 ? many : name;
    else if (p.ids.length === 1) base = p.titles[0];
    else base = p.ids.length ? many : targetTitle;
    return { ids: p.ids, minutes: p.minutes, carried: p.carried, base };
  });
}

function demand({ doc, today, days, config, links, covered = new Map(), usedKeys = new Map(), todayClosed = false }) {
  const idx = doneIndex(doc);
  const offs = timeOff(doc);
  const off = (item, d) => offs.length > 0 && excused(doc, item, d, offs);
  const linked = new Set(links.map((l) => l.habitId));
  const linkedAreas = new Set(links.map((l) => norm(l.area)).filter(Boolean));
  const active = values(doc.items).filter((i) => i.status === 'active').sort(byOrder);
  const inWindow = new Set(days);
  const lastDay = days[days.length - 1];
  const thisMonday = weekStart(today);

  // The day a task is planned on: its date (today if it's overdue), moved past any time off for it.
  const dueDays = new Map();
  const dueDay = (i) => {
    if (!dueDays.has(i.id)) {
      let d = i.date < today ? today : i.date;
      while (d <= lastDay && off(i, d)) d = addDays(d, 1);
      dueDays.set(i.id, d);
    }
    return dueDays.get(i.id);
  };

  // A times-a-week habit: what's left this week spread over its remaining days; next week's n over
  // the whole of next week. Days off for it don't count.
  const perWeekDays = new Map();
  for (const h of active.filter((i) => i.type === 'habit' && i.repeat?.kind === 'perWeek' && !linked.has(i.id))) {
    const picks = new Set();
    for (const monday of [...new Set(days.map(weekStart))]) {
      const week = Array.from({ length: 7 }, (_, n) => addDays(monday, n));
      let left = h.repeat.n;
      let candidates = week;
      if (monday === thisMonday) {
        left -= doneBetween(doc, h.id, monday, addDays(today, 1), idx);
        const doneToday = doneDays(doc, h.id, idx).has(today);
        candidates = week.filter((d) => d > today || (d === today && !doneToday && !todayClosed));
      }
      for (const d of evenPicks(candidates.filter((d) => !off(h, d)), left)) if (inWindow.has(d)) picks.add(d);
    }
    perWeekDays.set(h.id, picks);
  }

  // A weekly time target's share of each day, by area, over the days not off for it.
  const shares = new Map();
  for (const q of active.filter((i) => i.type === 'quota' && i.unit === 'minutes' && !linkedAreas.has(norm(i.area)))) {
    const remaining = Math.max(0, q.target - weekTotal(doc, q.id, today));
    const daysLeft = days.filter((d) => weekStart(d) === thisMonday && (d !== today || !todayClosed) && !off(q, d));
    for (const d of days) {
      if (off(q, d)) continue;
      const minutes = weekStart(d) === thisMonday
        ? (daysLeft.includes(d) ? ceil15(remaining / daysLeft.length) : 0)
        : ceil15(q.target / 7);
      if (!minutes) continue;
      const a = norm(q.area);
      const byDay = shares.get(a) ?? new Map();
      const s = byDay.get(d) ?? { minutes: 0, titles: [], area: String(q.area ?? '').trim() };
      s.minutes += minutes;
      s.titles.push(q.title);
      byDay.set(d, s);
      shares.set(a, byDay);
    }
  }

  const blocks = [];
  for (const d of days) {
    const skip = covered.get(d) ?? new Set();
    const groups = new Map();
    const add = (item, carried) => {
      const a = norm(item.area);
      const g = groups.get(a) ?? { area: String(item.area ?? '').trim(), entries: [] };
      g.entries.push({ item, carried });
      groups.set(a, g);
    };
    for (const i of active) {
      if (skip.has(i.id)) continue;
      if (i.type === 'task' && !i.time) {
        if (doneDays(doc, i.id, idx).size) continue;
        if (dueDay(i) === d) add(i, i.date < d);
      } else if (i.type === 'habit' && !linked.has(i.id)) {
        if (doneDays(doc, i.id, idx).has(d) || off(i, d)) continue;
        const due = i.repeat?.kind === 'perWeek' ? perWeekDays.get(i.id)?.has(d) : isHabitDue(doc, i, d, idx);
        if (due) add(i, false);
      }
    }
    for (const [a, byDay] of shares) {
      if (byDay.has(d) && !groups.has(a)) groups.set(a, { area: byDay.get(d).area, entries: [] });
    }
    const used = usedKeys.get(d) ?? new Set();
    for (const [a, g] of [...groups].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
      g.entries.sort((x, y) => Number(y.carried) - Number(x.carried) || byOrder(x.item, y.item));
      const areaFirst = config.priorityAreas.some((p) => norm(p) === a);
      let n = 0;
      for (const p of parts(g.entries, shares.get(a)?.get(d), g.area || 'Tasks', config)) {
        while (used.has(`${d}|${a}|${n}`)) n++;
        const priority = areaFirst || p.ids.some((id) => doc.items[id]?.priority === true);
        blocks.push({ key: `${d}|${a}|${n++}`, day: d, area: g.area, items: p.ids, minutes: p.minutes, carried: p.carried, base: p.base, priority });
      }
    }
  }
  return { blocks };
}
return { evenPicks, fixedTasks, demand };
})();

// ---- planner/place.js
const __planner_place = (() => {
// Finding time. Pure. Times are milliseconds; a window is { start, end }, busy is [{ start, end }].
// Starts fall on the quarter hour, and a block keeps `gap` clear of everything busy.

const QUARTER = 15 * 60000;

const ceilQuarter = (ms) => Math.ceil(ms / QUARTER) * QUARTER;

function fits(start, end, busy, gap) {
  return busy.every((b) => end + gap <= b.start || start >= b.end + gap);
}

function earliestFit(length, window, busy, gap) {
  for (let s = ceilQuarter(window.start); s + length <= window.end; s += QUARTER) {
    if (fits(s, s + length, busy, gap)) return s;
  }
  return null;
}

// The free start nearest `want`; the earlier one on a tie.
function nearestFit(length, want, window, busy, gap) {
  let best = null;
  for (let s = ceilQuarter(window.start); s + length <= window.end; s += QUARTER) {
    if (!fits(s, s + length, busy, gap)) continue;
    if (best == null || Math.abs(s - want) < Math.abs(best - want)) best = s;
  }
  return best;
}
return { QUARTER, ceilQuarter, fits, earliestFit, nearestFit };
})();

// ---- planner/plan.js
const __planner_plan = (() => {
// One planning pass: the dashboard and George's calendars in; the calendar changes to make and the
// planner's day records out. Pure — planner/gas.js reads the calendars, applies the changes and
// keeps the records. The rules are the design's (docs/superpowers/specs/2026-09-14-calendar-planner-design.md):
// blocks by area, around fixed events, exact for the first days and rough after; never moved once
// George has moved them; trimmed, or moved to the tick, when he ticks; removed when missed.

const { addDays, logicalDay, daysBetween, shortWeekday } = __js_dates;
const { readPlannerConfig, timeOff, offWindows, offCovers, COLOR_NAMES, colorName } = __js_calendar;
const { at, localDay, iso, MINUTE } = __planner_time;
const { P, normEvent, atText, movedByGeorge, habitPinned, linkedIds, roughColor, nearestColor, paleOf } = __planner_events;
const { norm, resolveCalendars, calendarFor, habitLinks } = __planner_calendars;
const { demand, fixedTasks } = __planner_demand;
const { fits, earliestFit, nearestFit, ceilQuarter } = __planner_place;

const DESCRIPTION_LINE = 'Planned from your dashboard. Move it and it stays where you put it.';
const HISTORY = new Set(['done', 'partial']);
const MIN_BLOCK = 15 * MINUTE;
const MAX_NOTES = 20;
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const splitIds = (s) => String(s ?? '').split(',').filter(Boolean);

function blockTitle(base, state, done = 0, total = 0) {
  if (state === 'rough') return `~ ${base}`;
  if (state === 'done') return `✓ ${base}`;
  if (done > 0 && done < total) return `${base} · ${done} of ${total} done`;
  return base;
}

// A block as a Google event. `notes` lead the description (the items' notes); the title stays the
// title. `colorId` is the area's colour, or a rough block's pale one; none means the calendar's own.
function blockBody({ key, base, title, start, end, items, state, colorId = null, pinned = false, notes = [] }) {
  const rough = state === 'rough';
  const props = {
    [P.mine]: '1', [P.key]: key, [P.items]: items.join(','), [P.title]: base,
    [P.at]: atText(start, end), [P.state]: state,
  };
  if (pinned) props[P.pin] = '1';
  return {
    summary: title,
    description: [...notes, ...items.map((id) => `dashboard:${id}`), DESCRIPTION_LINE].join('\n'),
    start: { dateTime: iso(start) },
    end: { dateTime: iso(end) },
    ...(colorId ? { colorId } : {}),
    reminders: rough ? { useDefault: false, overrides: [] } : { useDefault: true },
    extendedProperties: { private: props },
  };
}

// Whether an event already is what `body` describes, so nothing needs writing.
function sameAs(ev, body) {
  const want = body.extendedProperties.private;
  return ev.title === body.summary
    && ev.description === body.description
    && ev.start.getTime() === Date.parse(body.start.dateTime)
    && ev.end.getTime() === Date.parse(body.end.dateTime)
    && (body.colorId === undefined || ev.colorId === body.colorId)
    && ev.useDefault === body.reminders.useDefault
    && Object.keys(want).every((k) => ev.props[k] === want[k]);
}

// The day records with the ids Google gave the new events, matched by block key.
function fillIds(days, byKey) {
  const out = JSON.parse(JSON.stringify(days));
  for (const rec of Object.values(out)) {
    for (const b of rec.blocks) if (!b.eventId && byKey[b.key]) b.eventId = byKey[b.key];
  }
  return out;
}

function plan({ doc, now, dayStartHour = 4, calendars, events: raw, eventColors = {}, memory = {} }) {
  const { config, problems: configProblems } = readPlannerConfig(doc);
  const problems = new Set(configProblems);
  const notes = [];
  const note = (text) => { if (!notes.includes(text)) notes.push(text); };
  const gap = config.gapMinutes * MINUTE;
  const nowMs = now.getTime();
  const today = logicalDay(now, dayStartHour);
  const yesterday = addDays(today, -1);
  const days = Array.from({ length: config.days }, (_, i) => addDays(today, i));
  const lastDay = days[days.length - 1];
  const onDay = (d) => (d === today ? '' : ` on ${shortWeekday(d)}`);
  const exactDay = (d) => {
    const i = daysBetween(today, d);
    return i < config.exactDays || (i === config.exactDays && now.getHours() >= config.firmUpHour);
  };

  const { watched, find } = resolveCalendars(calendars, config);
  const watchedIds = new Set(watched.map((c) => c.id));
  const calName = (id) => calendars.find((c) => c.id === id)?.name ?? '';
  const links = habitLinks(doc, config, find, problems);
  const items = doc.items ?? {};
  const itemIds = Object.keys(items);
  const offs = timeOff(doc);

  // Colours: each watched calendar takes the event colour nearest its own, so an area can't have it.
  const takenBy = new Map();
  for (const c of watched) {
    const id = nearestColor(c.backgroundColor, eventColors);
    if (id && !takenBy.has(id)) takenBy.set(id, String(c.name).trim());
  }
  const takenColors = [...takenBy.keys()].map(colorName).filter(Boolean).sort();
  const areaColorId = (area) => {
    const key = Object.keys(config.areaColors).find((a) => norm(a) === norm(area));
    if (key === undefined) return null;
    const name = config.areaColors[key];
    const id = COLOR_NAMES[name];
    if (!takenBy.has(id)) return id;
    const used = new Set([...takenBy.keys(), ...Object.values(config.areaColors).map((n) => COLOR_NAMES[n])]);
    const free = Object.keys(COLOR_NAMES).filter((n) => !used.has(COLOR_NAMES[n]));
    problems.add(`${name} is taken by your ${takenBy.get(id)} calendar — free: ${free.join(', ')}`);
    return null;
  };
  const colourFor = (area, state, cal) => {
    const id = areaColorId(area);
    if (state === 'rough') return id ? paleOf(id) : roughColor(cal?.backgroundColor, eventColors);
    return id;
  };
  // A block's area from its key (a task with a time, or a record of a missed one, takes its task's).
  const areaOfKey = (key, ids) => {
    const seg = String(key).split('|')[1] ?? '';
    return seg === 'fixed' || seg === 'done' ? String(items[ids[0]]?.area ?? '') : seg;
  };
  // The notes at the top of a block's description: the note alone for one task, "Title — note" for several.
  const noteLines = (ids) => {
    const unique = [...new Set(ids)];
    const withNotes = unique.map((id) => items[id]).filter((i) => i?.notes);
    if (unique.length === 1) return withNotes.map((i) => i.notes);
    return withNotes.map((i) => `${i.title} — ${i.notes}`);
  };
  // Time off as busy time for one area's blocks on a day: its stretches of hours, or the whole day.
  const offBusy = (d, area) => {
    const covers = (areas) => !areas?.length || areas.some((a) => norm(a) === norm(area));
    const out = offWindows(doc, d, offs).filter((w) => covers(w.areas)).map((w) => ({ start: w.start, end: w.end, title: 'time off' }));
    if (offs.some((o) => offCovers(o, d) && covers(o.areas))) {
      out.push({ start: at(d, '00:00').getTime(), end: at(addDays(d, 1), '00:00').getTime(), title: 'time off' });
    }
    return out;
  };

  const listed = raw.filter((e) => watchedIds.has(e.calendarId)).map((e) => normEvent(e, e.calendarId));
  const present = new Set(listed.map((e) => e.id));
  const timed = listed.filter((e) => !e.cancelled && !e.allDay && e.start && e.end);

  // A task counts as done from the day it's ticked; a habit only on the day ticked. `at` is the
  // latest tick's time, when the log has one.
  const doneLogs = Object.values(doc.logs ?? {}).filter((l) => l.kind === 'done' && l.status === 'active' && l.itemId);
  function tickOf(id, day) {
    const isTask = items[id]?.type === 'task';
    let finished = false;
    let when = null;
    for (const l of doneLogs) {
      if (l.itemId !== id || (isTask ? l.day > day : l.day !== day)) continue;
      finished = true;
      const t = Date.parse(l.at ?? '');
      if (Number.isFinite(t) && (when == null || t > when)) when = t;
    }
    return { finished, at: when };
  }

  const recs = {};
  const rec = (d) => (recs[d] ??= {
    blocks: [], skipped: new Set(memory[d]?.skipped ?? []), missed: [...(memory[d]?.missed ?? [])],
  });
  const covered = new Map();
  const cover = (d, ids) => { const s = covered.get(d) ?? new Set(); for (const id of ids) s.add(id); covered.set(d, s); };
  const usedKeys = new Map();
  const useKey = (d, k) => { const s = usedKeys.get(d) ?? new Set(); s.add(k); usedKeys.set(d, s); };
  const hard = [];
  const busy = (start, end, title) => hard.push({ start, end, title });
  const keep = new Map();
  const actions = [];
  const record = (d, b) => rec(d).blocks.push({
    key: b.key, eventId: b.eventId, calendarId: b.calendarId, calendar: calName(b.calendarId), title: b.title,
    start: iso(b.start), end: iso(b.end), state: b.state, items: b.items,
  });

  // An event's new shape: nothing when it's already right; a patch; or, for a rough block becoming
  // anything else, a fresh event (a patch can't be relied on to take the rough colour off).
  function emit(ev, body, key) {
    const toRough = body.extendedProperties.private[P.state] === 'rough';
    if ((ev.props[P.state] === 'rough' && !toRough) || (ev.colorId && body.colorId === undefined)) {
      actions.push({ op: 'delete', calendarId: ev.calendarId, eventId: ev.id });
      actions.push({ op: 'insert', calendarId: ev.calendarId, key, body });
      return null;
    }
    if (!sameAs(ev, body)) actions.push({ op: 'patch', calendarId: ev.calendarId, eventId: ev.id, body });
    return ev.id;
  }

  function patchHabit(ev, span, extra, keepAt = false) {
    const props = { ...ev.props, ...extra };
    if (!keepAt) props[P.at] = atText(span.start, span.end);
    const same = span.start === ev.start.getTime() && span.end === ev.end.getTime()
      && Object.keys(props).every((k) => ev.props[k] === props[k]);
    if (same) return;
    actions.push({
      op: 'patch', calendarId: ev.calendarId, eventId: ev.id,
      body: { start: { dateTime: iso(span.start) }, end: { dateTime: iso(span.end) }, extendedProperties: { private: props } },
    });
  }

  // Where finished work goes when it was done outside its block: ending at the tick, as long as the
  // block was, but not starting before whatever came before it that day; at least a quarter hour.
  function recordSpan(tick, length, exceptId) {
    const d = localDay(new Date(tick));
    const before = timed
      .filter((e) => e.id !== exceptId && !e.free && e.end.getTime() <= tick && localDay(e.start) === d)
      .map((e) => e.end.getTime());
    let start = Math.max(tick - length, at(d, '00:00').getTime(), ...before);
    if (tick - start < MIN_BLOCK) start = tick - MIN_BLOCK;
    return { start, end: tick };
  }

  // What George deleted: a block booked last run, not yet over, whose event has gone.
  for (const [d, prev] of Object.entries(memory)) {
    if (d < yesterday) continue;
    for (const b of prev.blocks ?? []) {
      if (!b.eventId || !['rough', 'exact', 'fixed'].includes(b.state)) continue;
      if (present.has(b.eventId) || Date.parse(b.end) <= nowMs) continue;
      const kd = String(b.key).split('|')[0] || d;
      for (const id of b.items ?? []) rec(kd).skipped.add(id);
    }
  }

  // ---- The planner's own events -----------------------------------------------------------------
  const fixedWanted = new Map(fixedTasks({ doc, days, config }).map((f) => [f.key, f]));
  for (const ev of timed.filter((e) => e.mine)) {
    const key = ev.props[P.key] ?? '';
    const kd = key.split('|')[0] || localDay(ev.start);
    const state = ev.props[P.state];
    const ids = splitIds(ev.props[P.items]);
    const base = ev.props[P.title] ?? ev.title;
    const start = ev.start.getTime();
    const end = ev.end.getTime();
    const pinned = movedByGeorge(ev);
    const settle = (span, nextState, title, coverIds = ids, nextBase = base) => {
      const colorId = HISTORY.has(state) ? ev.colorId : colourFor(areaOfKey(key, ids), nextState, calendars.find((c) => c.id === ev.calendarId));
      const body = blockBody({ key, base: nextBase, title, start: span.start, end: span.end, items: ids, state: nextState, pinned, colorId, notes: noteLines(ids) });
      const eventId = emit(ev, body, key);
      busy(span.start, span.end, title);
      cover(kd, coverIds);
      useKey(kd, key);
      record(localDay(new Date(span.start)), { key, eventId, calendarId: ev.calendarId, title, start: span.start, end: span.end, state: nextState, items: ids });
    };

    if (HISTORY.has(state)) {
      settle({ start, end }, state, ev.title, state === 'done' ? ids : ids.filter((id) => tickOf(id, kd).finished));
      continue;
    }
    if (state === 'fixed') {
      const want = fixedWanted.get(key);
      fixedWanted.delete(key);
      const finished = ids.length > 0 && tickOf(ids[0], kd).finished;
      if (!want && !finished && start > nowMs && !pinned) {
        actions.push({ op: 'delete', calendarId: ev.calendarId, eventId: ev.id });
        continue;
      }
      const span = want && !pinned && start > nowMs ? { start: want.start, end: want.end } : { start, end };
      const name = want?.title ?? base;
      settle(span, 'fixed', finished ? `✓ ${name}` : name, ids, name);
      continue;
    }

    const ticks = ids.map((id) => tickOf(id, kd));
    const doneCount = ticks.filter((t) => t.finished).length;
    const lastTick = ticks.reduce((m, t) => (t.at != null && (m == null || t.at > m) ? t.at : m), null);
    const allDone = ids.length > 0 && doneCount === ids.length;

    if (allDone && lastTick != null) {
      let span = { start, end };
      if (lastTick >= start && lastTick < end) span = { start, end: Math.max(lastTick, start + MIN_BLOCK) };
      else if (lastTick < start || localDay(new Date(lastTick)) === localDay(ev.start)) span = recordSpan(lastTick, end - start, ev.id);
      settle(span, 'done', blockTitle(base, 'done'));
      continue;
    }
    if (allDone) {
      if (start > nowMs && !pinned) {
        actions.push({ op: 'delete', calendarId: ev.calendarId, eventId: ev.id });
        continue;
      }
      settle({ start, end }, 'done', blockTitle(base, 'done'));
      continue;
    }
    if (end <= nowMs) {
      if (doneCount > 0) {
        settle({ start, end }, 'partial', blockTitle(base, 'partial', doneCount, ids.length), ids.filter((_, i) => ticks[i].finished));
      } else if (!ids.length) {
        settle({ start, end }, 'done', base);
      } else {
        actions.push({ op: 'delete', calendarId: ev.calendarId, eventId: ev.id });
        for (const id of ids) {
          if (!rec(kd).missed.some((m) => m.itemId === id)) rec(kd).missed.push({ itemId: id, minutes: items[id]?.minutes ?? config.defaultMinutes });
        }
      }
      continue;
    }
    if (start <= nowMs) {
      const nextState = state === 'rough' ? 'exact' : state;
      settle({ start, end }, nextState, blockTitle(base, nextState, doneCount, ids.length));
      continue;
    }
    if (pinned) {
      const nextState = state === 'rough' && exactDay(kd) ? 'exact' : state;
      settle({ start, end }, nextState, blockTitle(base, nextState, doneCount, ids.length));
      continue;
    }
    keep.set(key, ev);
  }

  // Tasks with a time that have no event yet.
  for (const f of fixedWanted.values()) {
    if (f.start <= nowMs || tickOf(f.itemId, f.day).finished || rec(f.day).skipped.has(f.itemId)) continue;
    const cal = calendarFor(f.area, config, find, problems);
    if (!cal) continue;
    actions.push({ op: 'insert', calendarId: cal.id, key: f.key, body: blockBody({ key: f.key, base: f.title, title: f.title, start: f.start, end: f.end, items: [f.itemId], state: 'fixed', colorId: colourFor(f.area, 'fixed', cal), notes: noteLines([f.itemId]) }) });
    busy(f.start, f.end, f.title);
    cover(f.day, [f.itemId]);
    useKey(f.day, f.key);
    record(f.day, { key: f.key, eventId: null, calendarId: cal.id, title: f.title, start: f.start, end: f.end, state: 'fixed', items: [f.itemId] });
  }

  // ---- Everything else: fixed events, links to tasks, Hebrew and Gym ------------------------------
  const resolveRef = (ref) => {
    if (items[ref]) return ref;
    if (ref.length < 4) return null;
    const hits = itemIds.filter((id) => id.startsWith(ref));
    return hits.length === 1 ? hits[0] : null;
  };
  const movableHabits = [];
  for (const ev of timed.filter((e) => !e.mine)) {
    const start = ev.start.getTime();
    const end = ev.end.getTime();
    const d = localDay(ev.start);
    const link = links.find((l) => l.calendarId === ev.calendarId && norm(l.title) === norm(ev.title));
    if (!link) {
      if (!ev.free) busy(start, end, ev.title);
      const ids = linkedIds(ev.description).map(resolveRef).filter(Boolean);
      if (ids.length) cover(d, ids);
      continue;
    }
    const tick = tickOf(link.habitId, d);
    if (ev.props[P.state] === 'done' || d < today) { busy(start, end, ev.title); continue; }
    if (tick.finished) {
      let span = { start, end };
      if (tick.at != null && tick.at >= start && tick.at < end) span = { start, end: Math.max(tick.at, start + MIN_BLOCK) };
      else if (tick.at != null && localDay(new Date(tick.at)) === d) span = recordSpan(tick.at, end - start, ev.id);
      patchHabit(ev, span, { [P.state]: 'done', [P.habit]: link.habitId });
      busy(span.start, span.end, ev.title);
      continue;
    }
    const placedByGeorge = habitPinned(ev);
    if (start <= nowMs || placedByGeorge) {
      if (placedByGeorge && ev.props[P.at] && ev.props[P.pin] !== '1') patchHabit(ev, { start, end }, { [P.pin]: '1' }, true);
      busy(start, end, ev.title);
      continue;
    }
    movableHabits.push({ ev, link, day: d });
  }
  movableHabits.sort((a, b) => a.ev.start - b.ev.start);

  // A missed task ticked later today: a record of it, ending at the tick.
  const todayRec = rec(today);
  todayRec.missed = todayRec.missed.filter((m) => {
    const t = tickOf(m.itemId, today);
    if (!t.finished) return true;
    if (t.at == null || covered.get(today)?.has(m.itemId) || !items[m.itemId]) return false;
    const cal = calendarFor(items[m.itemId].area ?? '', config, find, problems);
    if (!cal) return false;
    const key = `${today}|done|${m.itemId}`;
    const span = recordSpan(t.at, m.minutes * MINUTE, null);
    const title = blockTitle(items[m.itemId].title, 'done');
    actions.push({ op: 'insert', calendarId: cal.id, key, body: blockBody({ key, base: items[m.itemId].title, title, start: span.start, end: span.end, items: [m.itemId], state: 'done', colorId: colourFor(items[m.itemId].area ?? '', 'done', cal), notes: noteLines([m.itemId]) }) });
    busy(span.start, span.end, title);
    cover(today, [m.itemId]);
    useKey(today, key);
    record(today, { key, eventId: null, calendarId: cal.id, title, start: span.start, end: span.end, state: 'done', items: [m.itemId] });
    return false;
  });

  // ---- What needs time, and where it goes ---------------------------------------------------------
  const windowOf = (d) => {
    const [from, to] = config.dayHours[d] ?? config.hours;
    const open = at(d, from).getTime();
    const close = at(d, to).getTime();
    return { open, start: d === today ? Math.max(open, ceilQuarter(nowMs)) : open, end: close };
  };
  const todayWindow = windowOf(today);
  const todayClosed = todayWindow.start + MIN_BLOCK > todayWindow.end;
  for (const d of days) cover(d, rec(d).skipped);
  const { blocks: wanted } = demand({ doc, today, days, config, links, covered, usedKeys, todayClosed });

  const placed = [];
  let overflow = [];
  for (const d of days) {
    const win = windowOf(d);
    for (const { ev, link } of movableHabits.filter((m) => m.day === d)) {
      const start = ev.start.getTime();
      const length = ev.end.getTime() - start;
      const clash = hard.find((h) => start < h.end && h.start < start + length);
      if (!clash) { busy(start, start + length, ev.title); continue; }
      const to = nearestFit(length, start, win, hard, gap);
      if (to == null) {
        note(`${ev.title}${onDay(d)} clashes with ${clash.title} and there's no free time to move it to`);
        busy(start, start + length, ev.title);
        continue;
      }
      patchHabit(ev, { start: to, end: to + length }, { [P.habit]: link.habitId });
      if (exactDay(d)) note(`Moved ${ev.title}${onDay(d)} to ${hhmm(to)} (${clash.title})`);
      busy(to, to + length, ev.title);
    }

    const queue = [...overflow, ...wanted.filter((b) => b.day === d)]
      .sort((a, b) => Number(b.priority) - Number(a.priority) || Number(b.carried) - Number(a.carried)
        || b.minutes - a.minutes || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    overflow = [];
    const taken = [...hard];
    const slot = new Map();
    const take = (b, s) => { slot.set(b.key, s); taken.push({ start: s, end: s + b.minutes * MINUTE, title: b.base }); };
    if (exactDay(d)) {
      for (const b of queue) {
        const ex = keep.get(b.key);
        if (!ex || localDay(ex.start) !== d) continue;
        const s = ex.start.getTime();
        const e = s + b.minutes * MINUTE;
        if (s >= win.open && e <= win.end && fits(s, e, [...taken, ...offBusy(d, b.area)], gap)) take(b, s);
      }
    }
    for (const b of queue) {
      if (slot.has(b.key)) continue;
      const s = earliestFit(b.minutes * MINUTE, win, [...taken, ...offBusy(d, b.area)], gap);
      if (s != null) { take(b, s); continue; }
      const next = addDays(d, 1);
      if (next <= lastDay) {
        overflow.push({ ...b, carried: true });
        if (exactDay(d) && !(d === today && todayClosed)) note(`Couldn't fit ${b.base}${onDay(d)} — moved to ${shortWeekday(next)}`);
      } else {
        note(`Couldn't fit ${b.base} in the next ${config.days} days`);
      }
    }
    for (const b of queue) if (slot.has(b.key)) placed.push({ b, day: d, start: slot.get(b.key) });
  }

  for (const { b, day, start } of placed) {
    const end = start + b.minutes * MINUTE;
    const state = exactDay(day) ? 'exact' : 'rough';
    const cal = calendarFor(b.area, config, find, problems);
    if (!cal) continue;
    const title = blockTitle(b.base, state);
    const body = blockBody({ key: b.key, base: b.base, title, start, end, items: b.items, state, colorId: colourFor(b.area, state, cal), notes: noteLines(b.items) });
    const ex = keep.get(b.key);
    keep.delete(b.key);
    let eventId = null;
    if (ex && ex.calendarId === cal.id) {
      eventId = emit(ex, body, b.key);
      if (state === 'exact' && ex.props[P.state] === 'exact' && ex.start.getTime() !== start) {
        const s0 = ex.start.getTime();
        const e0 = ex.end.getTime();
        const why = hard.find((h) => !fits(s0, e0, [h], gap))?.title;
        note(`Moved ${b.base}${onDay(day)} to ${hhmm(start)}${why ? ` (${why})` : ''}`);
      }
    } else {
      if (ex) actions.push({ op: 'delete', calendarId: ex.calendarId, eventId: ex.id });
      actions.push({ op: 'insert', calendarId: cal.id, key: b.key, body });
    }
    record(day, { key: b.key, eventId, calendarId: cal.id, title, start, end, state, items: b.items });
  }
  for (const ex of keep.values()) actions.push({ op: 'delete', calendarId: ex.calendarId, eventId: ex.id });

  const out = {};
  for (const d of [yesterday, ...days]) {
    const r = rec(d);
    out[d] = {
      day: d,
      blocks: [...r.blocks].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)),
      skipped: [...r.skipped].sort(),
      missed: r.missed,
      notes: [],
    };
  }
  const before = memory[today]?.notes ?? [];
  out[today].notes = [...before, ...[...problems, ...notes].filter((n) => !before.includes(n))].slice(-MAX_NOTES);
  return { actions, days: out, problems: [...problems], takenColors };
}
return { blockTitle, blockBody, fillIds, plan };
})();

// ---- planner/tag.js
const __planner_tag = (() => {
// Giving an untagged task an area, so it can share a block: one question to Gemini, answered from
// the dashboard's own areas or not at all. Pure; planner/gas.js makes the call.

function tagPrompt(title, areas) {
  return {
    system: 'You sort to-do items into areas. Answer only with JSON: {"area": "<one of the areas, exactly as written>"}, or {"area": ""} when none fits.',
    prompt: `Areas: ${areas.map((a) => JSON.stringify(a)).join(', ')}\nTo-do: ${JSON.stringify(title)}`,
  };
}

function readArea(data, areas) {
  const wanted = String(data?.area ?? '').trim().toLowerCase();
  return areas.find((a) => a.toLowerCase() === wanted) ?? '';
}
return { tagPrompt, readArea };
})();

// ---- planner/gas.js
const __planner_gas = (() => {
// The planner inside Google Apps Script. George's calendars come through the Calendar advanced
// service, the dashboard through the app's own GitHub client and sync, and the planner's memory of
// its last run lives in script properties. Every Apps Script service comes in as a parameter, so the
// tests run all of this in Node against fakes; planner/entry.js hands in the real ones.

const { createStore, DATA_KEY, SETTINGS_KEY } = __js_data;
const { emptyDoc, isDoc } = __js_doc;
const { createGitHubClient, syncOnce } = __js_sync;
const { readPlannerConfig, dayRecordId, plannerStatus, CALENDAR_DEFAULTS } = __js_calendar;
const { scrubText } = __js_flags;
const { MODELS, ENDPOINT, readReply } = __js_gemini;
const { addDays, logicalDay } = __js_dates;
const { plan, fillIds } = __planner_plan;
const { resolveCalendars } = __planner_calendars;
const { P } = __planner_events;
const { at } = __planner_time;
const { tagPrompt, readArea } = __planner_tag;

const HEARTBEAT_MS = 55 * 60000;
const ECHO_MS = 2 * 60000;
const TAG_PER_RUN = 5;

class MemoryStorage {
  constructor(initial = {}) { this.map = new Map(Object.entries(initial)); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

function createPlanner({
  Calendar, UrlFetchApp, PropertiesService, LockService, ScriptApp, Logger = { log() {} },
  fetch = (...args) => globalThis.fetch(...args), now = () => new Date(), version = 'dev',
}) {
  const props = () => PropertiesService.getScriptProperties();
  const get = (k) => props().getProperty(k);
  const put = (k, v) => props().setProperty(k, String(v));
  const drop = (k) => props().deleteProperty(k);
  const clean = (text) => scrubText(String(text), [get('GITHUB_TOKEN'), get('GEMINI_KEY')].filter(Boolean));
  const log = (text) => Logger.log(clean(text));
  const dayStartHour = () => {
    const n = Number(get('DAY_START_HOUR') ?? 4);
    return Number.isInteger(n) && n >= 0 && n <= 12 ? n : 4;
  };

  function calendars() {
    const out = [];
    let pageToken;
    do {
      const res = Calendar.CalendarList.list({ maxResults: 250, pageToken });
      for (const c of res.items ?? []) {
        out.push({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: !!c.primary, backgroundColor: c.backgroundColor, accessRole: c.accessRole });
      }
      pageToken = res.nextPageToken;
    } while (pageToken);
    return out;
  }

  function eventColors() {
    return Object.fromEntries(Object.entries(Calendar.Colors.get().event ?? {}).map(([id, c]) => [id, c.background]));
  }

  function listEvents(ids, timeMin, timeMax, extra = {}) {
    const out = [];
    for (const calendarId of ids) {
      let pageToken;
      do {
        const res = Calendar.Events.list(calendarId, { timeMin, timeMax, singleEvents: true, showDeleted: false, maxResults: 2500, pageToken, ...extra });
        for (const e of res.items ?? []) out.push({ ...e, calendarId });
        pageToken = res.nextPageToken;
      } while (pageToken);
    }
    return out;
  }

  // The dashboard, in a store over memory, as the Claude tool opens it.
  async function open() {
    const token = get('GITHUB_TOKEN');
    const repo = get('SYNC_REPO');
    if (!token || !repo) throw new Error('The planner needs GITHUB_TOKEN and SYNC_REPO in its script properties');
    const client = createGitHubClient({ token, repo, fetch });
    const remote = await client.get();
    if (remote && !isDoc(remote.doc)) throw new Error("The sync file isn't a dashboard document — nothing was changed");
    const storage = new MemoryStorage({
      [DATA_KEY]: JSON.stringify(remote?.doc ?? emptyDoc()),
      [SETTINGS_KEY]: JSON.stringify({ dayStartHour: dayStartHour() }),
    });
    const store = createStore({ storage, now });
    let changed = false;
    store.subscribe((reason) => { if (reason === 'local') changed = true; });
    return { client, store, changed: () => changed };
  }

  function askArea(key, title, areas) {
    const { system, prompt } = tagPrompt(title, areas);
    const payload = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    });
    for (const model of MODELS) {
      try {
        const res = UrlFetchApp.fetch(`${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(key)}`,
          { method: 'post', contentType: 'application/json', payload, muteHttpExceptions: true });
        if (res.getResponseCode() === 200) return readArea(readReply(res.getContentText()), areas);
      } catch {
        // the next model
      }
    }
    return '';
  }

  // Untagged tasks in the window get an area, at most TAG_PER_RUN a run; each is asked about once.
  function tag(store, t) {
    const key = get('GEMINI_KEY');
    if (!key) return;
    const active = Object.values(store.doc().items ?? {}).filter((i) => i.status === 'active');
    const areas = [...new Set(active.map((i) => String(i.area ?? '').trim()).filter(Boolean))].sort();
    if (!areas.length) return;
    const asked = JSON.parse(get('TAGGED') || '{}');
    const last = addDays(logicalDay(t, dayStartHour()), 6);
    const todo = active
      .filter((i) => i.type === 'task' && !String(i.area ?? '').trim() && i.date <= last && !Object.hasOwn(asked, i.id))
      .slice(0, TAG_PER_RUN);
    if (!todo.length) return;
    for (const item of todo) {
      const area = askArea(key, item.title, areas);
      asked[item.id] = area;
      if (area) store.updateItem(item.id, { area });
    }
    const live = new Set(active.map((i) => i.id));
    put('TAGGED', JSON.stringify(Object.fromEntries(Object.entries(asked).filter(([id]) => live.has(id)))));
  }

  function apply(actions) {
    const byKey = {};
    const errors = [];
    for (const a of actions) {
      try {
        if (a.op === 'insert') byKey[a.key] = Calendar.Events.insert(a.body, a.calendarId).id;
        else if (a.op === 'patch') Calendar.Events.patch(a.body, a.calendarId, a.eventId);
        else Calendar.Events.remove(a.calendarId, a.eventId);
      } catch (err) {
        errors.push(`${a.op} "${a.body?.summary ?? a.eventId}": ${err?.message ?? err}`);
      }
    }
    return { byKey, errors };
  }

  // The planner's status for the dashboard, at most hourly unless something in it changed. It
  // carries the colours George's calendars take, so Claude's tool can refuse a clashing area colour.
  function heartbeat(store, t, lastError, takenColors = []) {
    const prev = plannerStatus(store.doc());
    const due = !prev || !prev.lastRun || prev.lastError !== lastError || prev.version !== version || prev.paused
      || (prev.takenColors ?? []).join() !== takenColors.join()
      || t.getTime() - Date.parse(prev.lastRun) > HEARTBEAT_MS;
    if (due) store.putCalendar('status', { lastRun: t.toISOString(), lastError, version, paused: false, takenColors });
  }

  async function run(e) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) return 'busy';
    try {
      if (get('PAUSED') === '1') return 'paused';
      const t = now();
      if (e && e.calendarId && Number(get('LAST_WRITE') ?? 0) > t.getTime() - ECHO_MS) return 'echo';
      const session = await open();
      const { store } = session;
      tag(store, t);
      const doc = store.doc();
      const { config } = readPlannerConfig(doc);
      const cals = calendars();
      const { watched } = resolveCalendars(cals, config);
      const today = logicalDay(t, dayStartHour());
      const events = listEvents(watched.map((c) => c.id), at(addDays(today, -1), '00:00').toISOString(), at(addDays(today, config.days), '04:00').toISOString());
      const result = plan({
        doc, now: t, dayStartHour: dayStartHour(), calendars: cals, events, eventColors: eventColors(),
        memory: JSON.parse(get('DAYS') || '{}'),
      });
      const { byKey, errors } = apply(result.actions);
      const days = fillIds(result.days, byKey);
      put('DAYS', JSON.stringify(days));
      if (result.actions.length) put('LAST_WRITE', now().getTime());
      for (const [day, rec] of Object.entries(days)) if (day >= today) store.putCalendar(dayRecordId(day), rec);
      if (!doc.calendar?.config) store.putCalendar('config', JSON.parse(JSON.stringify(CALENDAR_DEFAULTS)));
      const problem = errors.length
        ? `${errors.length} calendar change${errors.length === 1 ? '' : 's'} failed — first: ${errors[0]}`
        : get('LAST_ERROR');
      heartbeat(store, t, problem ? clean(problem) : null, result.takenColors ?? []);
      drop('LAST_ERROR');
      if (session.changed()) {
        const pushed = await syncOnce({ store, client: session.client });
        if (!pushed.ok) {
          put('LAST_ERROR', clean(pushed.error));
          log(`Couldn't save to the dashboard: ${pushed.error}`);
          return 'failed';
        }
      }
      if (errors.length) log(problem);
      return errors.length ? 'partly' : 'ok';
    } catch (err) {
      const message = clean(err?.message ?? err);
      put('LAST_ERROR', message);
      log(`The planner stopped: ${message}`);
      return 'failed';
    } finally {
      lock.releaseLock();
    }
  }

  async function install() {
    for (const tr of ScriptApp.getProjectTriggers()) if (tr.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(tr);
    ScriptApp.newTrigger('run').timeBased().everyMinutes(10).create();
    let config = CALENDAR_DEFAULTS;
    try {
      config = readPlannerConfig((await open()).store.doc()).config;
    } catch (err) {
      throw new Error(clean(err?.message ?? err));
    }
    const unwatched = [];
    for (const c of resolveCalendars(calendars(), config).watched) {
      try {
        ScriptApp.newTrigger('run').forUserCalendar(c.id).onEventUpdated().create();
      } catch {
        unwatched.push(c.name.trim());
      }
    }
    drop('PAUSED');
    const first = await run();
    const also = unwatched.length
      ? ` Couldn't watch ${unwatched.join(', ')} for changes — the 10-minute run covers them.`
      : ' It also runs whenever one of your calendars changes.';
    return `Installed: the planner runs every 10 minutes.${also} First run: ${first}.`;
  }

  async function pause() {
    put('PAUSED', '1');
    try {
      const s = await open();
      const prev = plannerStatus(s.store.doc());
      s.store.putCalendar('status', { lastRun: prev?.lastRun ?? null, lastError: prev?.lastError ?? null, version, paused: true, takenColors: prev?.takenColors ?? [] });
      if (s.changed()) await syncOnce({ store: s.store, client: s.client });
    } catch (err) {
      log(`Paused, but couldn't tell the dashboard: ${err?.message ?? err}`);
    }
    return 'Paused. Run resume() to start again.';
  }

  async function resume() {
    drop('PAUSED');
    return `Resumed. First run: ${await run()}.`;
  }

  // Every future event the planner made goes, and it pauses (nothing it made in the past is touched).
  async function removeAll() {
    put('PAUSED', '1');
    const t = now();
    let config = CALENDAR_DEFAULTS;
    try { config = readPlannerConfig((await open()).store.doc()).config; } catch { /* the defaults will do */ }
    const today = logicalDay(t, dayStartHour());
    const found = listEvents(resolveCalendars(calendars(), config).watched.map((c) => c.id),
      at(today, '00:00').toISOString(), at(addDays(today, 60), '00:00').toISOString(), { privateExtendedProperty: `${P.mine}=1` });
    let n = 0;
    for (const ev of found) {
      if (!(Date.parse(ev.start?.dateTime ?? '') > t.getTime())) continue;
      try {
        Calendar.Events.remove(ev.calendarId, ev.id);
        n++;
      } catch (err) {
        log(`Couldn't remove "${ev.summary}": ${err?.message ?? err}`);
      }
    }
    drop('DAYS');
    return `Removed ${n} planned block${n === 1 ? '' : 's'} and paused the planner. Run resume() to start again.`;
  }

  return { run, install, pause, resume, removeAll };
}
return { createPlanner };
})();

// ---- planner/entry.js
const __planner_entry = (() => {
// The bundle's entry (npm run build-planner): Apps Script's services in, `Planner` out. Only ever
// run inside Apps Script, or the bundle test's sandbox, where these globals exist.

const { installShims } = __planner_shims;
const { createPlanner } = __planner_gas;

const Planner = (() => {
  installShims(globalThis, { Utilities, UrlFetchApp });
  return createPlanner({
    Calendar, UrlFetchApp, PropertiesService, LockService, ScriptApp, Logger,
    fetch: (...args) => globalThis.fetch(...args),
    version: typeof PLANNER_BUILD === 'string' ? PLANNER_BUILD : 'dev',
  });
})();
return { Planner };
})();

var Planner = __planner_entry.Planner;
