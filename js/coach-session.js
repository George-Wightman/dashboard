// A model turn edits an isolated draft. Only its validated net result can reach
// the live store, as one action. Proposals retain just touched records.
import { createStore, DATA_KEY, SETTINGS_KEY } from './data.js';
import { emptyDoc, stableStringify } from './doc.js';
import { diffDocs, fieldChanges } from './changes.js';
import { coachTools } from './coach-tools.js';

export function netEdits(before, after) {
  return diffDocs(before, after).filter((e) => !e.before || !e.after || fieldChanges(e.before, e.after).length);
}
export function describeEdits(edits, doc = null) {
  return edits.map((e) => {
    const r = e.after ?? e.before;
    if (e.map === 'items') {
      if (!e.before && r.status === 'suggested') return `Suggested ${r.type === 'quota' ? 'the weekly target' : `the ${r.type}`} "${r.title}"`;
      if (!e.before) return `Added "${r.title}"${r.date ? ` for ${r.date}` : ''}`;
      return `"${r.title}": ${fieldChanges(e.before, e.after).filter((f) => !['source', 'scheduleHold'].includes(f.field))
        .map((f) => `${f.field}: ${f.from ?? 'none'} → ${f.to ?? 'none'}`).join('; ') || 'scheduling updated'}`;
    }
    if (e.map === 'goals') return `Drafted goal "${r.title}"`;
    if (e.map === 'milestones') return `Stage: ${r.title}`;
    if (e.map === 'logs') return `${r.status === 'active' ? 'Recorded' : 'Removed'} ${r.kind === 'done' ? 'completion' : r.kind} for "${doc?.items?.[r.itemId]?.title ?? r.itemId ?? r.goalId}" on ${r.day}`;
    if (e.id.startsWith('closed:')) return `${r.closed ? 'Closed' : 'Reopened'} ${r.day} for planning`;
    if (e.id.startsWith('count:')) return r.status === 'active' ? `Counting down to "${r.title}" (${r.day})` : `Stopped counting down to "${r.title}"`;
    return `Updated ${r.title ?? r.day ?? e.id}`;
  });
}
export function prepareCoachTurn(store, now, { onHandoff, onFinish, message = '', only = null } = {}) {
  const before = structuredClone(store.doc());
  const id = crypto.randomUUID();
  let n = 0;
  const values = new Map([[DATA_KEY, JSON.stringify(before)], [SETTINGS_KEY, JSON.stringify(store.settings())]]);
  const draft = createStore({ storage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) },
    now, newId: () => `${id}-${++n}` });
  let proposal = false;
  let failure = null;
  let mutated = false;
  let undo = false;
  let undoResult = '';
  const captures = new Map();
  const tools = coachTools({ store: draft, onHandoff, onFinish, onProposal: () => { proposal = true; }, logChanges: false });
  return {
    draft, declarations: tools.declarations,
    run(name, args) {
      if (only && !only.includes(name)) return { ok: false, error: 'That action is not allowed during a journal wrap-up' };
      const capture = ['add_task', 'add_goal', 'log', 'suggest_habit', 'suggest_target', 'add_countdown'].includes(name) ? name + stableStringify(args) : null;
      if (capture && captures.has(capture)) return captures.get(capture);
      const res = tools.run(name, args);
      if (name === 'undo_last_action' && res.ok) { undo = true; undoResult = res.did; }
      const writes = !['get_day', 'get_gym', 'find', 'get_journal', 'propose_changes', 'finish', 'hand_to_claude'].includes(name);
      if (writes) { mutated = true; if (!res.ok) failure = res.error; }
      if (capture && res.ok) captures.set(capture, res);
      return res;
    },
    finish() {
      if (failure) throw new Error(`No plan changes were applied: ${failure}`);
      const edits = netEdits(before, draft.doc());
      const existing = edits.filter((e) => e.map === 'items' && e.before && fieldChanges(e.before, e.after).some((f) => ['date', 'time', 'minutes', 'status'].includes(f.field)));
      // Broad reviews and multi-item reshuffles need a concrete proposal. Clear
      // capture/tick commands stay direct. This is a fallback to the model's explicit proposal tool.
      if (existing.length && !/\bundo\b/i.test(message) && (existing.length > 1 || /\b(review|layout|relevant|reorganis\w*|reshuffl\w*)\b/i.test(message))) proposal = true;
      const summary = describeEdits(edits, draft.doc()).join(' · ') || undoResult || 'No net changes to the plan';
      const sparseBefore = emptyDoc(), sparseAfter = emptyDoc();
      for (const e of edits) {
        if (e.before) sparseBefore[e.map][e.id] = e.before;
        if (e.after) sparseAfter[e.map][e.id] = e.after;
      }
      for (const [key, value] of Object.entries(draft.doc().changes)) if (stableStringify(before.changes[key]) !== stableStringify(value)) {
        if (before.changes[key]) sparseBefore.changes[key] = before.changes[key];
        sparseAfter.changes[key] = value;
      }
      return { before: sparseBefore, after: sparseAfter, summary, edits, proposal: proposal && edits.length > 0, mutated, undo, id };
    },
  };
}
