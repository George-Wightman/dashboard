// Field versions let independent edits converge without replacing the whole record.
// A legacy writer changes `updated` without updating the marker: treat that record
// as a whole-record edit, rather than trusting stale field metadata.
import { stableStringify } from './doc.js';

const keysOf = (r) => Object.keys(r ?? {}).filter((k) => k !== 'updated' && k !== '_sync');
const stampOf = (r) => typeof r?.updated === 'string' ? r.updated : '';
const same = (a, b) => stableStringify(a) === stableStringify(b);
const validMeta = (r) => !!r?._sync && r._sync.version === r.updated && r._sync.fields && typeof r._sync.fields === 'object';

function metadata(rec) {
  const fields = Object.fromEntries(keysOf(rec).map((k) => [k, stampOf(rec)]));
  return validMeta(rec) ? { ...rec._sync, fields: { ...fields, ...rec._sync.fields } } : { version: stampOf(rec), fields };
}

function messageVersions(rec, meta) {
  if (meta.messages) return meta.messages;
  return Object.fromEntries((rec.messages ?? []).map((m, order) => [stableStringify(m), { at: stampOf(rec), order, deleted: false }]));
}

function messagesFrom(meta) {
  return Object.entries(meta.messages ?? {}).filter(([, v]) => !v.deleted && v.at > (meta.resetMessages ?? ''))
    .sort(([a, x], [b, y]) => x.at.localeCompare(y.at) || x.order - y.order || a.localeCompare(b))
    .map(([text]) => JSON.parse(text));
}

export function reviseRecord(before, next, time) {
  const previous = Date.parse(before?.updated ?? '');
  const updated = new Date(Math.max(Date.parse(time), Number.isFinite(previous) ? previous + 1 : 0)).toISOString();
  if (!before) return { ...next, updated };
  const meta = metadata(before);
  for (const key of new Set([...keysOf(before), ...keysOf(next)])) {
    if (!same(before[key], next[key])) meta.fields[key] = updated;
  }
  meta.version = updated;
  const out = { ...next, updated, _sync: meta };
  if (next.kind === 'talk') {
    meta.messages = { ...messageVersions(before, metadata(before)) };
    if (next.pruned && !next.messages?.length) {
      meta.messages = {};
      meta.resetMessages = updated;
    } else {
      const wanted = new Map((next.messages ?? []).map((m, i) => [stableStringify(m), i]));
      for (const [text, v] of Object.entries(meta.messages)) {
        if (!wanted.has(text) && !v.deleted) meta.messages[text] = { ...v, at: updated, deleted: true };
      }
      for (const [text, order] of wanted) {
        if (!meta.messages[text] || meta.messages[text].deleted) meta.messages[text] = { at: updated, order, deleted: false };
      }
      out.messages = messagesFrom(meta);
    }
  }
  return out;
}

export function mergeRecord(a, b, fallback) {
  if (!validMeta(a) && !validMeta(b)) return fallback(a, b);
  const am = metadata(a), bm = metadata(b);
  const updated = stampOf(a) > stampOf(b) ? stampOf(a) : stampOf(b);
  const out = { updated };
  const meta = { version: updated, fields: {} };
  for (const key of new Set([...keysOf(a), ...keysOf(b), ...Object.keys(am.fields), ...Object.keys(bm.fields)])) {
    const at = am.fields[key] ?? '', bt = bm.fields[key] ?? '';
    const winner = at > bt ? a : bt > at ? b
      : stableStringify([Object.hasOwn(a, key), a[key]]) >= stableStringify([Object.hasOwn(b, key), b[key]]) ? a : b;
    if (winner[key] !== undefined) out[key] = winner[key];
    meta.fields[key] = at > bt ? at : bt;
  }
  if (out.kind === 'talk') {
    meta.resetMessages = [am.resetMessages ?? '', bm.resetMessages ?? ''].sort().at(-1);
    const av = messageVersions(a, am), bv = messageVersions(b, bm);
    meta.messages = {};
    for (const text of new Set([...Object.keys(av), ...Object.keys(bv)])) {
      const x = av[text], y = bv[text];
      const v = !x ? y : !y ? x : x.at > y.at ? x : y.at > x.at ? y
        : stableStringify(x) >= stableStringify(y) ? x : y;
      if (v.at > meta.resetMessages) meta.messages[text] = v;
    }
    out.messages = messagesFrom(meta);
  }
  out._sync = meta;
  return out;
}

export function recordContent(rec) {
  if (!rec) return rec;
  const { _sync, ...content } = rec;
  return content;
}
