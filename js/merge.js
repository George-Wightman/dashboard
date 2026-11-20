// Deterministic merge: edited records carry per-field versions; older records
// retain their whole-record timestamp semantics. Every quick-add is independent,
// and removals remain tombstones so offline devices cannot resurrect them.

import { MAPS, stableStringify } from './doc.js';
import { mergeRecord } from './record.js';

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
    if (x != null && y != null) map[id] = normalise ? mergeRecord(x, y, pickWinner) : pickWinner(x, y);
    else if (x == null && y == null) map[id] = x === undefined ? y : x;
    else map[id] = x ?? y;
  }
  return map;
}

// What leaves the synced file for good, so it stops growing: Claude's changes more than
// CHANGE_DROP_DAYS older than the newest one (their snapshots went at 14 days, js/changes.js), and
// usage weeks (js/usage.js) more than USAGE_DROP_WEEKS behind the newest. Measured from the records
// themselves, never a clock, so every device, the planner and Claude's tool drop exactly the same
// ones in every merge and a dropped record can't come back from a copy that still has it.
//
// THE FILE WAS 1.75 MB ON 20 NOV 2026, and over 1 MB every read takes two requests. 31% was this
// change log (414 changes back 44 days, 271 of them already without their snapshots), and a further
// 150 KB was per-field sync stamps on records no one had touched for a month. So changes now leave
// after 21 days (their snapshots still go at 14, so nothing that can be undone is lost), and:
//
// A RECORD UNTOUCHED FOR SYNC_COLD_DAYS LOSES ITS PER-FIELD STAMPS. Without them the merge counts
// every field as edited at the record's `updated` (js/record.js, metadata), which for a record no one
// has changed in a month says the same thing: two copies of it agree, and a newer edit on another
// device still wins the fields it changed. Measured from the newest `updated` in the document, like
// the rest, so every copy strips the same ones. The old coach's talks keep theirs (their messages
// carry their own versions).
export const CHANGE_DROP_DAYS = 21;
export const USAGE_DROP_WEEKS = 16;
export const SYNC_COLD_DAYS = 30;
const DAY_MS = 86400000;

function coldStamps(doc) {
  let newest = '';
  for (const map of MAPS) for (const r of Object.values(doc[map] ?? {})) if (typeof r?.updated === 'string' && r.updated > newest) newest = r.updated;
  const t = Date.parse(newest);
  if (!Number.isFinite(t)) return;
  const cutoff = new Date(t - SYNC_COLD_DAYS * DAY_MS).toISOString();
  for (const map of MAPS) {
    const recs = doc[map];
    if (!recs) continue;
    for (const [id, r] of Object.entries(recs)) {
      if (!r?._sync || typeof r.updated !== 'string' || !(r.updated < cutoff) || r.kind === 'talk' || r._sync.messages) continue;
      const { _sync, ...rest } = r;
      recs[id] = rest;
    }
  }
}

function expire(doc) {
  coldStamps(doc);
  const changes = doc.changes ?? {};
  let newest = '';
  for (const c of Object.values(changes)) if (typeof c?.at === 'string' && c.at > newest) newest = c.at;
  const t = Date.parse(newest);
  if (Number.isFinite(t)) {
    const cutoff = new Date(t - CHANGE_DROP_DAYS * DAY_MS).toISOString();
    for (const [id, c] of Object.entries(changes)) if (typeof c?.at === 'string' && c.at < cutoff) delete changes[id];
  }
  const calendar = doc.calendar ?? {};
  const weekOf = (id) => (/^usage:[a-z0-9]+:\d{4}-\d{2}-\d{2}$/.test(id) ? id.slice(-10) : null);
  let last = '';
  for (const id of Object.keys(calendar)) { const w = weekOf(id); if (w && w > last) last = w; }
  const lt = Date.parse(`${last}T00:00:00Z`);
  if (Number.isFinite(lt)) {
    const cutoff = new Date(lt - USAGE_DROP_WEEKS * 7 * DAY_MS).toISOString().slice(0, 10);
    for (const id of Object.keys(calendar)) { const w = weekOf(id); if (w && w < cutoff) delete calendar[id]; }
  }
  return doc;
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
  return expire(out);
}

export function sameDoc(a, b) {
  return stableStringify(mergeDocs(a, null)) === stableStringify(mergeDocs(b, null));
}
