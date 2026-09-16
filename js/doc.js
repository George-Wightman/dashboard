// The shape of the synced document, shared by the store and the merge.

export const MAPS = ['items', 'goals', 'milestones', 'logs', 'journal', 'flags', 'changes', 'calendar', 'gym'];

export function emptyDoc() {
  return { schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {}, flags: {}, changes: {}, calendar: {}, gym: {} };
}

// One check-in per logical day and one digest per week (filed under that week's Monday), on
// every device: the id is the kind and the day, so two devices writing the same one merge into
// one record.
export function journalId(kind, day) {
  return `${kind}:${day}`;
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const unsafe = (k) => ['__proto__', 'prototype', 'constructor'].includes(k);
const string = (v) => typeof v === 'string';
const strings = (v) => Array.isArray(v) && v.every(string);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const day = (v) => string(v) && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const timestamp = (v) => string(v) && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const clock = (v) => string(v) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

// Reject dangerous property names and pathological nesting before recursive readers
// or object-map writes see data from an import, another device, or an integration.
function safeJson(v, depth = 0) {
  if (depth > 40) return false;
  if (v == null || string(v) || typeof v === 'boolean') return true;
  if (typeof v === 'number') return finite(v);
  if (Array.isArray(v)) return v.every((x) => safeJson(x, depth + 1));
  return isPlainObject(v) && Object.entries(v).every(([k, x]) => !unsafe(k) && safeJson(x, depth + 1));
}

export function recordProblem(map, id, r) {
  if (!MAPS.includes(map) || !string(id) || !id || unsafe(id) || !isPlainObject(r)) return 'Invalid record';
  if (!safeJson(r)) return 'Invalid record data';
  if (r.id !== id) return 'Record ID does not match its map key';
  const optional = (key, test, nullable = false) => r[key] === undefined || (nullable && r[key] === null) || test(r[key]);
  if (!optional('status', (v) => ['active', 'archived', 'suggested', 'dismissed'].includes(v))) return 'Invalid status';
  for (const key of ['created', 'archivedOn']) if (!optional(key, day, true)) return `Invalid ${key} day`;
  if (!optional('updated', timestamp)) return 'Invalid updated timestamp';
  for (const key of ['title', 'source', 'area', 'unitLabel']) if (!optional(key, string)) return `Invalid ${key}`;
  if (map !== 'calendar' && !optional('notes', string)) return 'Invalid notes';
  for (const key of ['order', 'target', 'amount', 'minutes']) if (!optional(key, finite, true)) return `Invalid ${key}`;
  if (!optional('time', (v) => v === '' || clock(v), true)) return 'Invalid time';
  if (!optional('priority', (v) => typeof v === 'boolean')) return 'Invalid priority';
  if (r._sync !== undefined) {
    const m = r._sync;
    if (!isPlainObject(m) || !timestamp(m.version) || !isPlainObject(m.fields)
      || !Object.values(m.fields).every((v) => v === '' || timestamp(v))) return 'Invalid field versions';
    if (m.resetMessages !== undefined && m.resetMessages !== '' && !timestamp(m.resetMessages)) return 'Invalid conversation reset';
    if (m.messages !== undefined) {
      if (!isPlainObject(m.messages)) return 'Invalid conversation versions';
      for (const [text, v] of Object.entries(m.messages)) {
        let message;
        try { message = JSON.parse(text); } catch { return 'Invalid conversation version'; }
        if (!validMessage(message) || !isPlainObject(v) || !timestamp(v.at) || !Number.isInteger(v.order)
          || typeof v.deleted !== 'boolean') return 'Invalid conversation version';
      }
    }
  }
  if (['items', 'goals', 'milestones'].includes(map) && (!string(r.title) || !r.title.trim())) return 'A record needs a title';
  if (map === 'items') {
    if (!['task', 'habit', 'quota'].includes(r.type)) return 'Invalid item type';
    if (r.type === 'task' && !day(r.date)) return 'A task needs a real date';
    if (r.type === 'quota' && !(finite(r.target) && r.target > 0)) return 'A quota needs a positive target';
    if (r.minutes != null && (!Number.isInteger(r.minutes) || r.minutes < 5 || r.minutes > 720)) return 'A length is from 5 minutes to 12 hours';
    if (r.type === 'habit' && r.repeat !== undefined) {
      const p = r.repeat;
      if (!isPlainObject(p)) return 'Invalid habit repeat';
      const integer = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
      if (!(p.kind === 'daily' || (p.kind === 'weekly' && integer(p.day, 1, 7))
        || (p.kind === 'monthly' && integer(p.date, 1, 31)) || (p.kind === 'perWeek' && integer(p.n, 1, 7))
        || (p.kind === 'weekdays' && Array.isArray(p.days) && p.days.length > 0 && p.days.every((d) => integer(d, 1, 7))))) return 'Invalid habit repeat';
    }
  }
  if (map === 'goals' && !optional('targetDate', (v) => v === '' || day(v), true)) return 'Invalid goal date';
  if (map === 'logs') {
    if (!['done', 'amount', 'skip'].includes(r.kind) || !day(r.day)) return 'Invalid log';
    if (r.kind === 'amount' && !(finite(r.amount) && r.amount > 0)) return 'Invalid logged amount';
  }
  if (map === 'journal') {
    if (!['checkin', 'digest', 'brief', 'talk', 'entry', 'guide'].includes(r.kind) || !day(r.day)) return 'Invalid journal record';
    for (const key of ['questions', 'answers', 'tomorrowIds', 'wins', 'slipped', 'handoffs', 'pointers', 'forClaude', 'flagIds']) {
      if (!optional(key, strings)) return `Invalid ${key}`;
    }
    for (const key of ['feedback', 'summary', 'focus', 'model', 'text', 'feeling', 'slot']) if (!optional(key, string)) return `Invalid ${key}`;
    if (!optional('messages', (v) => Array.isArray(v) && v.every(validMessage))) return 'Invalid conversation messages';
  }
  if (map === 'flags' && !string(r.text)) return 'Invalid flag text';
  if (map === 'changes') {
    if (!string(r.summary) || !Array.isArray(r.edits) || !r.edits.every((e) => isPlainObject(e)
      && MAPS.includes(e.map) && e.map !== 'changes' && string(e.id) && !unsafe(e.id)
      && (e.before == null || isPlainObject(e.before)) && (e.after == null || isPlainObject(e.after)))) return 'Invalid change log';
  }
  if (map === 'calendar') {
    for (const key of ['notes', 'skipped', 'takenColors']) if (!optional(key, strings)) return `Invalid calendar ${key}`;
    if (!optional('missed', (v) => Array.isArray(v) && v.every((x) => isPlainObject(x) && string(x.itemId)))) return 'Invalid missed items';
    if (!optional('blocks', (v) => Array.isArray(v) && v.every((b) => isPlainObject(b)
      && string(b.key) && timestamp(b.start) && timestamp(b.end) && strings(b.items)))) return 'Invalid calendar blocks';
    if (!optional('day', day) || !optional('lastRun', timestamp, true)) return 'Invalid calendar date';
    if (!optional('calendars', (v) => Array.isArray(v) && v.every((c) => isPlainObject(c) && string(c.name)))) return 'Invalid calendar list';
  }
  if (map === 'gym' && id.startsWith('w:')) {
    if (!day(r.day) || !timestamp(r.start) || !timestamp(r.end) || !Array.isArray(r.exercises)
      || !r.exercises.every((e) => isPlainObject(e) && string(e.name)
        && (e.best == null || Array.isArray(e.best)) && (e.sets == null || Array.isArray(e.sets)))) return 'Invalid workout';
  }
  return null;
}

function validMessage(m) {
  return isPlainObject(m) && ['george', 'coach'].includes(m.who) && string(m.text) && (m.at === undefined || timestamp(m.at))
    && (m.did === undefined || (Array.isArray(m.did) && m.did.every((d) => isPlainObject(d) && string(d.text))));
}

// Supported schema, safe JSON, and valid records in every known map. Older
// documents may omit maps introduced later; unsupported schemas are not guessed at.
export function isDoc(value) {
  if (!isPlainObject(value)) return false;
  if (value.schema !== 1 || !safeJson(value)) return false;
  if (!isPlainObject(value.items)) return false;
  return MAPS.every((k) => value[k] === undefined || (isPlainObject(value[k])
    && Object.entries(value[k]).every(([id, r]) => !recordProblem(k, id, r))));
}

// Recovery retains valid records from a damaged local document; callers preserve
// the entire original separately. Remote/import data is rejected as a unit instead.
export function recoverDoc(value) {
  const recovered = emptyDoc();
  if (!isPlainObject(value) || value.schema !== 1) return recovered;
  for (const map of MAPS) {
    if (!isPlainObject(value[map])) continue;
    for (const [id, r] of Object.entries(value[map])) if (!recordProblem(map, id, r)) recovered[map][id] = r;
  }
  return recovered;
}

// JSON with object keys sorted at every depth, so two equal documents always serialise the same.
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
