// Merging two copies of the document. Pure and deterministic: whichever device runs it, in
// whichever order, and however many times, the result is the same. Every quick-add is its own
// record and nothing is hard-deleted, so "later updated wins, per record" is the only rule.

import { MAPS, emptyDoc, stableStringify } from './doc.js';

export function pickWinner(a, b) {
  if (a.updated !== b.updated) return (a.updated ?? '') > (b.updated ?? '') ? a : b;
  return stableStringify(a) >= stableStringify(b) ? a : b;
}

export function mergeDocs(a, b) {
  const out = emptyDoc();
  out.schema = Math.max(a?.schema ?? 1, b?.schema ?? 1);
  for (const map of MAPS) {
    const left = a?.[map] ?? {};
    const right = b?.[map] ?? {};
    const ids = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const id of ids) {
      const x = left[id];
      const y = right[id];
      out[map][id] = x && y ? pickWinner(x, y) : (x ?? y);
    }
  }
  return out;
}

export function sameDoc(a, b) {
  return stableStringify(mergeDocs(a, null)) === stableStringify(mergeDocs(b, null));
}
