// Merging two copies of the document. Pure and deterministic: whichever device runs it, in
// whichever order, and however many times, the result is the same. Every quick-add is its own
// record and nothing is hard-deleted, so "later updated wins, per record" is the only rule.

import { MAPS, stableStringify } from './doc.js';

export function pickWinner(a, b) {
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

export function mergeDocs(a, b) {
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

export function sameDoc(a, b) {
  return stableStringify(mergeDocs(a, null)) === stableStringify(mergeDocs(b, null));
}
