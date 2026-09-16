// Claude's change log: what one of Claude's commands changed, as plain data, and the readers ⚙ and
// the tool use. Pure. The store writes and undoes changes (js/data.js); this only describes them.

import { MAPS, stableStringify } from './doc.js';

export const CHANGE_KEEP_DAYS = 30; // days a change keeps its before/after snapshots

const LOGGED = MAPS.filter((m) => m !== 'changes');
const DAY_MS = 86400000;

// Every record whose serialised form differs between two documents, as { map, id, before, after }
// (before is null for a new record). Copies, never the documents' own objects, in MAPS order then
// id order. The change log itself is left out.
export function diffDocs(before, after) {
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
export function fieldChanges(before, after) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
    .filter((k) => k !== 'updated' && k !== '_sync').sort();
  return keys
    .filter((k) => stableStringify(before?.[k] ?? null) !== stableStringify(after?.[k] ?? null))
    .map((k) => ({ field: k, from: before?.[k] ?? null, to: after?.[k] ?? null }));
}

export function recordTitle(rec) {
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
export function editLines(edit) {
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
export function changeList(doc) {
  return Object.values(doc?.changes ?? {})
    .filter((c) => c.status === 'active')
    .sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
}

// ⚙'s summary line for the group: how many changes in the seven days up to `now`.
export function changeCountLine(doc, now) {
  const list = changeList(doc);
  if (!list.length) return 'none yet';
  const since = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  return `${list.filter((c) => c.at >= since).length} in the last week`;
}

export const canUndo = (change) => !change.undoneAt && !change.pruned;

// One line saying what an undo did (the result of store.undoChange).
export function undoLine({ undone = [], skipped = [], already = false } = {}) {
  if (already) return 'Already undone, or too old to undo.';
  if (!undone.length) return 'Changed since — not undone.';
  if (!skipped.length) return 'Undone.';
  const names = skipped.map((e) => `"${recordTitle(e.after ?? e.before)}"`).join(', ');
  return `Undone, except ${names} — changed since, not undone.`;
}
