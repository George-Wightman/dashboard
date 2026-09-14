// The store: the whole state is one document in localStorage. Every change goes through here,
// stamps `updated`, saves, and tells listeners why it changed.

import { logicalDay, addDays, weekStart } from './dates.js';
import { MAPS, emptyDoc, stableStringify, isDoc, journalId } from './doc.js';
import { mergeDocs } from './merge.js';
import { FLAG_TEXT_MAX, capContext } from './flags.js';
import { CHANGE_KEEP_DAYS, canUndo } from './changes.js';
import { checkLength, checkClock, checkNotes } from './parse.js';

export const DATA_KEY = 'dash_data';
export const SETTINGS_KEY = 'dash_settings';
export const CORRUPT_KEY = 'dash_data_corrupt';
export const DEFAULT_SETTINGS = { token: '', repo: '', dayStartHour: 4, geminiKey: '', checkinHour: 18, look: 'auto' };

const ITEM_TYPES = ['task', 'habit', 'quota'];

// The content each kind of journal record carries, with its empty values.
const JOURNAL_FIELDS = {
  checkin: { questions: [], answers: [], feedback: '', tomorrowIds: [], model: '' },
  digest: { summary: '', wins: [], slipped: [], focus: '', model: '' },
  brief: { text: '' },
};

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function withMaps(doc) {
  for (const map of MAPS) doc[map] ??= {};
  doc.schema ??= 1;
  return doc;
}

// Unreadable saved data is set aside under CORRUPT_KEY, never silently overwritten.
function loadDoc(storage) {
  let raw = null;
  try {
    raw = storage.getItem(DATA_KEY);
  } catch {
    return { doc: emptyDoc(), error: "Saved data couldn't be read on this device, so it started empty." };
  }
  if (!raw) return { doc: emptyDoc(), error: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { doc: withMaps(parsed), error: null };
  } catch {
    // fall through to setting it aside
  }
  try { storage.setItem(CORRUPT_KEY, raw); } catch { /* nothing more can be done */ }
  return {
    doc: emptyDoc(),
    error: "Saved data couldn't be read on this device, so it started empty.",
  };
}

function requireTitle(title, what) {
  const t = String(title ?? '').trim();
  if (!t) throw new Error(`${what} needs a title`);
  return t;
}

export function createStore({ storage, now = () => new Date(), newId = () => crypto.randomUUID() }) {
  const loaded = loadDoc(storage);
  let doc = loaded.doc;
  let settings = { ...DEFAULT_SETTINGS, ...(readJson(storage, SETTINGS_KEY) ?? {}) };
  const loadError = loaded.error;
  let saveError = null;
  const listeners = new Set();

  const stamp = () => now().toISOString();
  const today = () => logicalDay(now(), settings.dayStartHour);
  const notify = (reason) => { for (const fn of listeners) fn(reason); };

  function save(key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      saveError = null;
    } catch (e) {
      saveError = e?.message || String(e);
    }
  }

  function commit(reason) {
    save(DATA_KEY, doc);
    notify(reason);
  }

  // Writes a record into the document without saving, for callers that write several records
  // and then commit once.
  function build(map, fields) {
    const rec = {
      source: 'me', status: 'active', created: today(), archivedOn: null,
      ...fields,
      id: fields.id ?? newId(),
      updated: stamp(),
    };
    doc[map][rec.id] = rec;
    return rec;
  }

  function create(map, fields) {
    const rec = build(map, fields);
    commit('local');
    return rec;
  }

  function patch(map, id, changes) {
    const rec = doc[map][id];
    if (!rec) throw new Error(`No ${map} record ${id}`);
    doc[map][id] = { ...rec, ...changes, id, updated: stamp() };
    commit('local');
    return doc[map][id];
  }

  const nextOrder = (map) => Math.max(0, ...Object.values(doc[map]).map((r) => r.order ?? 0)) + 1;

  // An item's fields, checked and with the defaults filled in. Nothing is written.
  function itemFields(fields) {
    if (!ITEM_TYPES.includes(fields.type)) throw new Error(`Unknown item type ${fields.type}`);
    const title = requireTitle(fields.title, 'An item');
    if (fields.type === 'quota' && !(fields.target > 0)) throw new Error('A quota needs a target above 0');
    const defaults = { area: '', goalId: null, order: nextOrder('items') };
    if (fields.type === 'task') defaults.date = today();
    if (fields.type === 'habit') defaults.repeat = { kind: 'daily' };
    if (fields.type === 'quota') Object.assign(defaults, { unit: 'count', unitLabel: '' });
    const out = { ...defaults, ...fields, title };
    if (fields.minutes !== undefined) out.minutes = checkLength(fields.minutes);
    if (fields.time !== undefined && fields.time !== null && fields.time !== '') {
      if (fields.type !== 'task') throw new Error('Only a task has a time');
      out.time = checkClock(fields.time);
    }
    if (fields.notes !== undefined) out.notes = checkNotes(fields.notes);
    if (fields.priority !== undefined) {
      if (typeof fields.priority !== 'boolean') throw new Error('Priority is true or false');
      if (fields.type !== 'task' && fields.type !== 'habit') throw new Error('Only a task or a habit can be a priority');
      out.priority = fields.priority;
    }
    return out;
  }

  function addItem(fields) {
    return create('items', itemFields(fields));
  }

  function toggleDone(itemId, day = today(), source = 'me') {
    const existing = Object.values(doc.logs).filter((l) =>
      l.itemId === itemId && l.kind === 'done' && l.day === day && l.status === 'active');
    if (existing.length) {
      const t = stamp();
      for (const rec of existing) doc.logs[rec.id] = { ...rec, status: 'archived', updated: t };
      commit('local');
      return;
    }
    return create('logs', { itemId, goalId: null, kind: 'done', day, at: stamp(), note: '', source });
  }

  function logAmount({ itemId = null, goalId = null, amount, day = today(), note = '', source = 'me' }) {
    if (!(amount > 0)) throw new Error('An amount must be above 0');
    if (!itemId && !goalId) throw new Error('logAmount needs an itemId or a goalId');
    return create('logs', { itemId, goalId, kind: 'amount', amount, day, at: stamp(), note, source });
  }

  // A goal's fields, checked and with the defaults filled in. Nothing is written.
  function goalFields(fields) {
    const title = requireTitle(fields.title, 'A goal');
    const defaults = { targetDate: null, target: null, unit: 'count', unitLabel: '', order: nextOrder('goals') };
    const out = { ...defaults, ...fields, title };
    if (fields.notes !== undefined) out.notes = checkNotes(fields.notes);
    return out;
  }

  function addGoal(fields) {
    return create('goals', goalFields(fields));
  }

  function addMilestone(goalId, title, { source = 'me', status = 'active' } = {}) {
    return create('milestones', {
      goalId, title: requireTitle(title, 'A milestone'), done: false, order: nextOrder('milestones'), source, status,
    });
  }

  // A check-in or a digest. The id comes from the kind and the day, so there is only ever one
  // check-in per day and one digest per week, whichever device writes it. Creates the record, or
  // overwrites just the content fields given on the existing one (so saving the answers keeps
  // the questions). Content is copied in, never shared with the caller.
  function saveJournal(record, source = 'gemini') {
    const kind = record?.kind;
    const fields = JOURNAL_FIELDS[kind];
    if (!fields) throw new Error(`Unknown journal kind ${kind}`);
    const day = record.day;
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || addDays(day, 0) !== day) {
      throw new Error(`A journal record needs a real day, not ${day}`);
    }
    if (kind === 'digest' && weekStart(day) !== day) throw new Error("A digest is filed under its week's Monday");
    const id = journalId(kind, day);
    if (record.id != null && record.id !== id) throw new Error(`A ${kind} for ${day} has the id ${id}`);
    const content = {};
    for (const key of Object.keys(fields)) {
      if (record[key] !== undefined) content[key] = structuredClone(record[key]);
    }
    const existing = doc.journal[id];
    if (!existing) return create('journal', { source, ...structuredClone(fields), ...content, id, kind, day });
    doc.journal[id] = { ...existing, ...content, id, kind, day, updated: stamp() };
    commit('local');
    return doc.journal[id];
  }

  // Everything one Gemini reply (or a plan from Claude) proposes, written as suggestions in one
  // commit: a goal with its milestones and the habits and weekly targets linked to it, and tasks
  // for a given day. Every record is checked before any is written, so one bad record leaves the
  // document untouched.
  function addPlan({ goal = null, milestones = [], habits = [], targets = [], tasks = [], source = 'gemini' } = {}) {
    if (milestones.length && !goal) throw new Error('Milestones need a goal');
    const suggested = { status: 'suggested', source };
    const goalRec = goal
      ? goalFields({ title: goal.title, targetDate: goal.targetDate ?? null, why: goal.why ?? '', ...suggested })
      : null;
    const goalId = goalRec ? newId() : null;
    const firstMilestone = nextOrder('milestones');
    const milestoneRecs = milestones.map((title, i) => ({
      goalId, title: requireTitle(title, 'A milestone'), done: false, order: firstMilestone + i, ...suggested,
    }));
    const firstItem = nextOrder('items');
    const itemRecs = [
      ...habits.map((h) => itemFields({
        type: 'habit', title: h.title, repeat: h.repeat ?? { kind: 'daily' }, goalId, ...suggested,
      })),
      ...targets.map((t) => itemFields({
        type: 'quota', title: t.title, target: t.target, unit: t.unit ?? 'count', unitLabel: t.unitLabel ?? '', goalId, ...suggested,
      })),
      ...tasks.map((t) => itemFields({ type: 'task', title: t.title, date: t.date ?? today(), goalId: null, ...suggested })),
    ].map((fields, i) => ({ ...fields, order: firstItem + i }));
    if (!goalRec && !itemRecs.length) return { goal: null, milestones: [], items: [] };
    const out = {
      goal: goalRec ? build('goals', { ...goalRec, id: goalId }) : null,
      milestones: milestoneRecs.map((fields) => build('milestones', fields)),
      items: itemRecs.map((fields) => build('items', fields)),
    };
    commit('local');
    return out;
  }

  // ✓ on a suggested goal: the goal and its still-suggested milestones go live from today. Its
  // proposed habits and targets stay suggestions on Today, to be accepted one by one.
  function acceptGoalPlan(goalId) {
    const goal = doc.goals[goalId];
    if (!goal) throw new Error(`No goals record ${goalId}`);
    const live = { status: 'active', created: today(), updated: stamp() };
    if (goal.status === 'suggested') doc.goals[goalId] = { ...goal, ...live };
    for (const [id, m] of Object.entries(doc.milestones)) {
      if (m.goalId === goalId && m.status === 'suggested') doc.milestones[id] = { ...m, ...live };
    }
    commit('local');
    return doc.goals[goalId];
  }

  // ✕ on a suggested goal: the goal, its still-suggested milestones and any still-suggested items
  // linked to it are dismissed. Anything already accepted is left alone.
  function dismissGoalPlan(goalId) {
    const goal = doc.goals[goalId];
    if (!goal) throw new Error(`No goals record ${goalId}`);
    const gone = { status: 'dismissed', updated: stamp() };
    if (goal.status === 'suggested') doc.goals[goalId] = { ...goal, ...gone };
    for (const map of ['milestones', 'items']) {
      for (const [id, rec] of Object.entries(doc[map])) {
        if (rec.goalId === goalId && rec.status === 'suggested') doc[map][id] = { ...rec, ...gone };
      }
    }
    commit('local');
  }

  // ⚑: a note of something to change, with what the app was doing when the panel opened. The text
  // is trimmed and capped at FLAG_TEXT_MAX characters; the context is copied and capped at 4 KB
  // (js/flags.js), whoever built it.
  function addFlag(text, ctx = null, source = 'me') {
    const clean = Array.from(String(text ?? '').trim()).slice(0, FLAG_TEXT_MAX).join('').trim();
    if (!clean) throw new Error('A flag needs some text');
    return create('flags', { text: clean, ctx: capContext(ctx), source });
  }

  // "Mark addressed": archived, never deleted, and there is no un-address — so the later write
  // always wins a merge. Addressing one that is already addressed changes nothing.
  function addressFlag(id) {
    const rec = doc.flags[id];
    if (!rec) throw new Error(`No flags record ${id}`);
    if (rec.status === 'archived') return rec;
    return patch('flags', id, { status: 'archived', archivedOn: today() });
  }

  // Claude's change log (js/changes.js): one record per command of Claude's that changed
  // something, with a copy of every record it touched before and after. The tool writes these; the
  // page only reads and undoes them.
  function addChange({ summary, edits } = {}) {
    const text = String(summary ?? '').trim();
    if (!text) throw new Error('A change needs a summary');
    if (!Array.isArray(edits) || !edits.length) throw new Error('A change needs at least one edit');
    return create('changes', {
      source: 'claude', at: stamp(), summary: text, edits: structuredClone(edits),
      undoneAt: null, undoneBy: null, pruned: false,
    });
  }

  // Undo one of Claude's changes, record by record. A record Claude created is dismissed (a log is
  // archived, its tombstone); a record Claude changed gets its earlier state back with a fresh
  // stamp, so it wins the merge everywhere. A record that no longer matches what Claude left has
  // been changed since, and is left alone. The change is marked undone only if something was.
  function undoChange(changeId, by = 'me') {
    const change = doc.changes[changeId];
    if (!change) throw new Error(`No changes record ${changeId}`);
    if (!canUndo(change)) return { undone: [], skipped: [], already: true };
    const t = stamp();
    const undone = [];
    const skipped = [];
    for (const edit of change.edits) {
      const current = doc[edit.map]?.[edit.id];
      if (!current || stableStringify(current) !== stableStringify(edit.after)) {
        skipped.push(edit);
        continue;
      }
      doc[edit.map][edit.id] = edit.before
        ? { ...structuredClone(edit.before), updated: t }
        : { ...current, status: edit.map === 'logs' ? 'archived' : 'dismissed', updated: t };
      undone.push(edit);
    }
    if (!undone.length) return { undone, skipped, already: false };
    doc.changes[changeId] = { ...change, undoneAt: t, undoneBy: by, updated: t };
    commit('local');
    return { undone, skipped, already: false };
  }

  // Changes older than CHANGE_KEEP_DAYS lose their before/after snapshots (the summary stays, and
  // they can no longer be undone), so the synced file doesn't grow for ever. Returns how many.
  function pruneChanges() {
    const cutoff = new Date(now().getTime() - CHANGE_KEEP_DAYS * 86400000).toISOString();
    const t = stamp();
    let n = 0;
    for (const [id, c] of Object.entries(doc.changes)) {
      if (c.pruned || !(c.at < cutoff)) continue;
      const edits = (c.edits ?? []).map((e) => ({ map: e.map, id: e.id, before: null, after: null }));
      doc.changes[id] = { ...c, edits, pruned: true, updated: t };
      n++;
    }
    if (n) commit('local');
    return n;
  }

  // The calendar planner's records (js/calendar.js): created, or given new content. A record whose
  // content is already the same is left alone — nothing is written, so nothing syncs.
  function putCalendar(id, fields, source = 'planner') {
    const content = JSON.parse(JSON.stringify(fields));
    const existing = doc.calendar[id];
    if (existing && existing.status === 'active') {
      const same = existing.source === source
        && Object.keys(content).every((k) => stableStringify(existing[k]) === stableStringify(content[k]));
      if (same) return { rec: existing, changed: false };
      doc.calendar[id] = { ...existing, ...content, id, source, updated: stamp() };
      commit('local');
      return { rec: doc.calendar[id], changed: true };
    }
    return { rec: create('calendar', { ...content, id, source }), changed: true };
  }

  // Move `id` to just before `targetId` within `groupIds` (the on-screen order of the draggable
  // rows in the dragged row's own done/undone group, including `id`). The on-screen list is
  // shown as undone-then-done, so it isn't globally sorted by `order` — reordering has to stay
  // within the dragged row's own group, or a neighbour's midpoint can come from the wrong group.
  // Patches only the moved record (or, on a tie, every record whose order actually changes with
  // one shared stamp), so it can never clobber a concurrent edit to another visible row.
  function moveBefore(id, targetId, groupIds) {
    if (id === targetId) return;
    const list = groupIds.filter((x) => x !== id);
    const orderOf = (rid) => doc.items[rid]?.order ?? 0;
    const t = list.indexOf(targetId);
    if (t === -1) {
      // Dropped on a row of the other group: move to the end of this row's own group.
      const order = list.length ? Math.max(...list.map(orderOf)) + 1 : orderOf(id);
      patch('items', id, { order });
      return;
    }
    const hi = orderOf(targetId);
    const lo = t > 0 ? orderOf(list[t - 1]) : hi - 2;
    const mid = (lo + hi) / 2;
    if (lo < mid && mid < hi) {
      patch('items', id, { order: mid });
      return;
    }
    // A tie, or adjacent orders so close that double-precision arithmetic can't represent a
    // midpoint strictly between them: either way, renumber the whole group.
    const base = Math.min(...groupIds.map(orderOf));
    const renumbered = [...list.slice(0, t), id, ...list.slice(t)];
    const t2 = stamp();
    for (let i = 0; i < renumbered.length; i++) {
      const rid = renumbered[i];
      const order = base + i;
      if (orderOf(rid) !== order) doc.items[rid] = { ...doc.items[rid], order, updated: t2 };
    }
    commit('local');
  }

  function replaceDoc(next, reason = 'sync') {
    if (stableStringify(next) === stableStringify(doc)) return;
    doc = withMaps(next);
    commit(reason);
  }

  function importJson(text) {
    let incoming;
    try {
      incoming = JSON.parse(text);
    } catch {
      throw new Error("That file isn't valid JSON");
    }
    if (!isDoc(incoming)) {
      throw new Error("That file isn't a dashboard backup");
    }
    replaceDoc(mergeDocs(doc, incoming), 'local');
  }

  // A save from another window/tab on this device, arriving via the storage event. Merged in,
  // never thrown on — anything unparseable or not a real document is silently ignored.
  function absorbStored(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isDoc(parsed)) return;
    replaceDoc(mergeDocs(doc, parsed), 'sync');
  }

  function updateSettings(changes) {
    settings = { ...settings, ...changes };
    save(SETTINGS_KEY, settings);
    notify('settings');
  }

  return {
    doc: () => doc,
    settings: () => settings,
    today,
    saveError: () => saveError,
    loadError: () => loadError,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    addItem,
    updateItem: (id, changes) => patch('items', id, changes),
    archiveItem: (id) => patch('items', id, { status: 'archived', archivedOn: today() }),
    moveBefore,
    acceptSuggestion: (map, id) => patch(map, id, { status: 'active', created: today() }),
    dismissSuggestion: (map, id) => patch(map, id, { status: 'dismissed' }),

    toggleDone,
    logAmount,
    removeLog: (id) => patch('logs', id, { status: 'archived' }),

    addGoal,
    updateGoal: (id, changes) => patch('goals', id, changes),
    archiveGoal: (id) => patch('goals', id, { status: 'archived', archivedOn: today() }),
    addMilestone,
    updateMilestone: (id, changes) => patch('milestones', id, changes),
    toggleMilestone: (id) => patch('milestones', id, { done: !doc.milestones[id]?.done }),
    archiveMilestone: (id) => patch('milestones', id, { status: 'archived', archivedOn: today() }),

    saveJournal,
    addPlan,
    acceptGoalPlan,
    dismissGoalPlan,

    addFlag,
    addressFlag,

    addChange,
    undoChange,
    pruneChanges,

    putCalendar,

    replaceDoc,
    absorbStored,
    updateSettings,
    exportJson: () => JSON.stringify(doc, null, 2),
    importJson,
  };
}
