// Merging two copies of the document. Pure and deterministic: whichever device runs it, in
// whichever order, and however many times, the result is the same. Every quick-add is its own
// record and nothing is hard-deleted, so "later updated wins, per record" is the only rule.

import { MAPS, stableStringify } from './doc.js';

export function pickWinner(a, b) {
  if (a.updated !== b.updated) return (a.updated ?? '') > (b.updated ?? '') ? a : b;
  return stableStringify(a) >= stableStringify(b) ? a : b;
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Repairs the two things a malformed synced record is missing that would otherwise blank the
// page: a `created` day (derived from `updated`) and, once archived, an `archivedOn` day.
// Returns the same object when nothing needs fixing, so it's a no-op to run twice.
function normaliseRecord(rec) {
  const created = rec.created !== undefined ? rec.created : (rec.updated?.slice(0, 10) ?? '1970-01-01');
  const archivedOn = rec.status === 'archived' && !rec.archivedOn ? created : rec.archivedOn;
  if (created === rec.created && archivedOn === rec.archivedOn) return rec;
  return { ...rec, created, archivedOn };
}

function mergeMap(left, right, normalise = false) {
  const lm = left ?? {};
  const rm = right ?? {};
  const ids = [...new Set([...Object.keys(lm), ...Object.keys(rm)])].sort();
  const map = {};
  for (const id of ids) {
    // Normalise each candidate before picking, not the winner afterwards: normalising only the
    // winner would let a repaired record's extra fields shift later tie-breaks, so repeated or
    // differently-grouped merges (a∪b)∪c vs a∪(b∪c) could disagree on the winner.
    const x = normalise && lm[id] ? normaliseRecord(lm[id]) : lm[id];
    const y = normalise && rm[id] ? normaliseRecord(rm[id]) : rm[id];
    map[id] = x && y ? pickWinner(x, y) : (x ?? y);
  }
  return map;
}

export function mergeDocs(a, b) {
  const out = { schema: Math.max(a?.schema ?? 1, b?.schema ?? 1) };
  const keys = new Set([...MAPS, ...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  keys.delete('schema');
  for (const key of [...keys].sort()) {
    const left = a?.[key];
    const right = b?.[key];
    const hasLeft = left !== undefined;
    const hasRight = right !== undefined;
    // The four known maps are always record maps; any other key is one too if the side(s) that
    // have it are plain objects — otherwise it's a scalar/array that passes straight through.
    const asMap = MAPS.includes(key)
      || (isPlainObject(left) && isPlainObject(right))
      || (isPlainObject(left) && !hasRight)
      || (isPlainObject(right) && !hasLeft);
    if (asMap) {
      out[key] = mergeMap(left, right, MAPS.includes(key));
    } else if (hasLeft && hasRight) {
      out[key] = stableStringify(left) >= stableStringify(right) ? left : right;
    } else {
      out[key] = hasLeft ? left : right;
    }
  }
  return out;
}

export function sameDoc(a, b) {
  return stableStringify(mergeDocs(a, null)) === stableStringify(mergeDocs(b, null));
}
