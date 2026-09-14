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

// A real dashboard document: a plain object with a numeric schema, an items map, and any of the
// other known maps either absent or themselves plain objects (never arrays). A document saved
// before the journal, the flags or the change log existed has none of them and is still a real
// document.
export function isDoc(value) {
  if (!isPlainObject(value)) return false;
  if (typeof value.schema !== 'number') return false;
  if (!isPlainObject(value.items)) return false;
  return MAPS.filter((k) => k !== 'items').every((k) => value[k] === undefined || isPlainObject(value[k]));
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
