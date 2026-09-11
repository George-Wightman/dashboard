// The shape of the synced document, shared by the store and the merge.

export const MAPS = ['items', 'goals', 'milestones', 'logs'];

export function emptyDoc() {
  return { schema: 1, items: {}, goals: {}, milestones: {}, logs: {} };
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// A real dashboard document: a plain object with a numeric schema, an items map, and any of the
// other known maps either absent or themselves plain objects (never arrays).
export function isDoc(value) {
  if (!isPlainObject(value)) return false;
  if (typeof value.schema !== 'number') return false;
  if (!isPlainObject(value.items)) return false;
  return ['goals', 'milestones', 'logs'].every((k) => value[k] === undefined || isPlainObject(value[k]));
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
