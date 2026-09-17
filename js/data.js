// The store: the whole state is one document in localStorage. Every change goes through here,
// stamps `updated`, saves, and tells listeners why it changed.

import { logicalDay, addDays, weekStart } from './dates.js';
import { MAPS, emptyDoc, stableStringify, isDoc, journalId, recordProblem, recoverDoc } from './doc.js';
import { mergeDocs } from './merge.js';
import { FLAG_TEXT_MAX, capContext } from './flags.js';
import { CHANGE_KEEP_DAYS, canUndo, diffDocs } from './changes.js';
import { checkLength, checkClock, checkNotes } from './parse.js';
import { reviseRecord, recordContent } from './record.js';
import { WORKFLOW_MAPS, checkDetails, checkDetailLinks, checkAnswers, checkRule, blockers } from './workflow.js';

export const DATA_KEY = 'dash_data';
export const SETTINGS_KEY = 'dash_settings';
export const CORRUPT_KEY = 'dash_data_corrupt';
export const BACKUP_KEY = 'dash_data_previous';
export const DEFAULT_SETTINGS = { token: '', repo: '', dayStartHour: 4, geminiKey: '', checkinHour: 18, look: 'auto' };

const ITEM_TYPES = ['task', 'habit', 'quota'];

// The content each kind of journal record carries, with its empty values.
const JOURNAL_FIELDS = {
  checkin: { questions: [], answers: [], feedback: '', tomorrowIds: [], model: '' },
  digest: { summary: '', wins: [], slipped: [], focus: '', model: '' },
  brief: { text: '' },
  // The Coach as a conversation (js/talk.js): a conversation and its journal entry, filed by day and
  // slot; Claude's guide for the Coach, filed under the week's Monday.
  talk: { slot: '', messages: [], handoffs: [], done: false, model: '' },
  entry: { slot: '', feeling: '', text: '', pointers: [], forClaude: [], flagIds: [] },
  guide: { text: '' },
};
const SLOTTED = new Set(['talk', 'entry']);
const SLOT = /^(morning|afternoon|evening|own-\d{1,2})$/;
const WEEKLY = new Set(['digest', 'guide']);

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
  let recovered = emptyDoc();
  try {
    const parsed = JSON.parse(raw);
    if (isDoc(parsed)) return { doc: mergeDocs(parsed, null), error: null };
    recovered = recoverDoc(parsed);
  } catch {
    // fall through to setting it aside
  }
  let preserved = false;
  try { storage.setItem(CORRUPT_KEY, raw); preserved = true; } catch { /* report the failed recovery copy */ }
  const backup = readJson(storage, BACKUP_KEY);
  recovered = mergeDocs(recovered, isDoc(backup) ? backup : null);
  return {
    doc: recovered,
    error: "Some saved data couldn't be read. Valid records were recovered; " + (preserved
      ? 'the original was set aside on this device.' : 'the original could not be copied. Export a backup before making more changes.'),
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
  const saveErrors = new Map();
  const listeners = new Set();
  let transactionDepth = 0;

  const stamp = () => now().toISOString();
  const today = () => logicalDay(now(), settings.dayStartHour);
  const notify = (reason) => { for (const fn of listeners) fn(reason); };

  function save(key, value) {
    try {
      const raw = JSON.stringify(value);
      try { storage.setItem(key, raw); } catch (e) {
        // Recovery copies must never prevent saving the primary document.
        if (key !== DATA_KEY || !(e?.name === 'QuotaExceededError' || e?.code === 22 || e?.code === 1014)
          || storage.getItem(BACKUP_KEY) === null) throw e;
        storage.removeItem(BACKUP_KEY);
        storage.setItem(key, raw);
      }
      saveErrors.delete(key);
    } catch (e) {
      saveErrors.set(key, e?.message || String(e));
    }
  }

  function commit(reason) {
    if (transactionDepth) return;
    save(DATA_KEY, doc);
    notify(reason);
  }

  function writeRecord(map, id, next) {
    const rec = reviseRecord(doc[map][id], next, stamp());
    const problem = recordProblem(map, id, rec);
    if (problem) throw new Error(problem);
    if (map === 'items' && next.details) checkDetailLinks(doc, id, next.details);
    doc[map][id] = rec;
    return rec;
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
    return writeRecord(map, rec.id, rec);
  }

  function create(map, fields) {
    const rec = build(map, fields);
    commit('local');
    return rec;
  }

  function patch(map, id, changes) {
    const rec = doc[map][id];
    if (!rec) throw new Error(`No ${map} record ${id}`);
    writeRecord(map, id, { ...rec, ...changes, id });
    commit('local');
    return doc[map][id];
  }

  const nextOrder = (map) => Object.values(doc[map]).reduce((max, r) => Math.max(max, r.order ?? 0), 0) + 1;

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
      if (fields.type === 'quota') throw new Error('A weekly target has no time');
      out.time = checkClock(fields.time);
    }
    if (fields.notes !== undefined) out.notes = checkNotes(fields.notes);
    if (fields.priority !== undefined) {
      if (typeof fields.priority !== 'boolean') throw new Error('Priority is true or false');
      if (fields.type !== 'task' && fields.type !== 'habit') throw new Error('Only a task or a habit can be a priority');
      out.priority = fields.priority;
    }
    const problem = recordProblem('items', fields.id ?? 'check', { ...out, id: fields.id ?? 'check' });
    if (problem) throw new Error(problem);
    return out;
  }

  function addItem(fields) {
    return create('items', itemFields(fields));
  }

  function toggleDone(itemId, day = today(), source = 'me') {
    const existing = Object.values(doc.logs).filter((l) =>
      l.itemId === itemId && l.kind === 'done' && l.day === day && l.status === 'active');
    if (existing.length) {
      for (const rec of existing) writeRecord('logs', rec.id, { ...rec, status: 'archived' });
      commit('local');
      return;
    }
    const item = doc.items[itemId];
    if (item?.details?.outcomeForm?.length) throw new Error('Report the outcome to complete this item');
    checkCompletion(item, day);
    return create('logs', { itemId, goalId: null, kind: 'done', day, at: stamp(), note: '', source });
  }

  function checkCompletion(item, day) {
    if (!item) throw new Error('Item not found');
    const reasons = blockers(doc, item, day);
    if (reasons.length) throw new Error(reasons.join('; '));
    if (item.details?.requireChecklist && item.details.checklist?.some((c) => !c.done)) throw new Error('Complete the checklist first');
  }

  // Synchronous transactions publish once; an invalid action leaves no partial edits.
  function transaction(fn, { summary, source = 'workflow' } = {}) {
    const before = structuredClone(doc);
    transactionDepth++;
    let result;
    try {
      result = fn();
      if (result?.then) throw new Error('Store transactions must be synchronous');
      if (summary) {
        const edits = diffDocs(before, doc).filter((e) => !['workflowRuns', 'reviews'].includes(e.map));
        if (edits.length) addChange({ summary, edits, source });
      }
    } catch (e) { doc = before; throw e; }
    finally { transactionDepth--; }
    commit('local');
    return result;
  }

  function putWorkflow(map, id, fields) {
    if (!WORKFLOW_MAPS.includes(map)) throw new Error('Unknown workflow map');
    return doc[map][id] ? patch(map, id, fields) : create(map, { source: 'workflow', ...fields, id });
  }

  function setDetails(map, id, changes) {
    if (!['items', 'goals'].includes(map) || !doc[map][id]) throw new Error('Details need an existing item or goal');
    const details = checkDetails({ ...doc[map][id].details, ...changes });
    return patch(map, id, { details });
  }

  function saveRule({ id = newId(), title, enabled = false, definition }) {
    checkRule(definition, doc);
    if (Object.values(doc.rules).filter((r) => r.status === 'active' && r.enabled && r.id !== id).length >= 50 && enabled) throw new Error('At most 50 enabled rules');
    const prior = Object.values(doc.outcomes).filter((o) => o.sourceId === definition.sourceId)
      .reduce((latest, o) => Math.max(latest, Date.parse(o.at) + 1), 0);
    const enabledAt = new Date(Math.max(Date.parse(stamp()), prior)).toISOString();
    return putWorkflow('rules', id, { title, enabled, enabledAt, definition, status: 'active' });
  }

  function reportOutcome({ sourceId, answers, day = today(), complete = false, id = newId(), source = 'me' }) {
    if (typeof complete !== 'boolean') throw new Error('complete must be boolean');
    if (day > today()) throw new Error('An outcome cannot be reported for a future day');
    const record = doc.items[sourceId] ?? doc.goals[sourceId];
    if (!record || record.status !== 'active') throw new Error('Outcome needs an active item or goal');
    if (!record.details?.outcomeForm?.length) throw new Error('Configure the outcome questions first');
    const checked = checkAnswers(record.details.outcomeForm, answers);
    if (doc.outcomes[id]) {
      if (doc.outcomes[id].sourceId !== sourceId || stableStringify(doc.outcomes[id].answers) !== stableStringify(checked)
        || doc.outcomes[id].day !== day || doc.outcomes[id].complete !== complete) throw new Error('This outcome ID was already used for a different report');
      return doc.outcomes[id];
    }
    if (complete && (!doc.items[sourceId] || record.type === 'quota')) throw new Error('Only tasks and habits can be completed with an outcome');
    if (complete) checkCompletion(record, day);
    return transaction(() => {
      const activated = Object.values(doc.rules).filter((r) => r.definition.sourceId === sourceId)
        .reduce((latest, r) => Math.max(latest, Date.parse(r.enabledAt)), 0);
      const at = new Date(Math.max(Date.parse(stamp()), activated)).toISOString();
      const outcome = putWorkflow('outcomes', id, { sourceId, answers: checked, day, at, complete, source });
      if (complete && !Object.values(doc.logs).some((l) => l.status === 'active' && l.kind === 'done' && l.itemId === sourceId && l.day === day)) {
        create('logs', { id: `outcome:${id}`, itemId: sourceId, goalId: null, kind: 'done', day, at: stamp(), note: '', source });
      }
      return outcome;
    });
  }

  function requestReview(goalId, reason = 'Requested goal review', day = today()) {
    if (doc.goals[goalId]?.status !== 'active') throw new Error('Review needs an active goal');
    const id = `review:${goalId}:${day}`;
    return doc.reviews[id] ?? putWorkflow('reviews', id, { goalId, day, reason: String(reason).slice(0, 500), result: { state: 'pending' } });
  }

  // A habit let off for a day (the Coach's skip): excused like time off, so its streak is safe.
  function skipItem(itemId, day = today(), note = '', source = 'coach') {
    return create('logs', { itemId, goalId: null, kind: 'skip', day, at: stamp(), note, source });
  }

  // Conversations older than TALK_KEEP_DAYS lose their messages; their journal entries stay.
  function pruneTalks(keepDays = 30) {
    const cutoff = addDays(today(), -keepDays);
    let n = 0;
    for (const [id, r] of Object.entries(doc.journal)) {
      if (r.kind !== 'talk' || !(r.day < cutoff)
        || (!r.messages?.length && !Object.keys(r._sync?.messages ?? {}).length)) continue;
      writeRecord('journal', id, { ...r, messages: [], pruned: true });
      n++;
    }
    if (n) commit('local');
    return n;
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
    const problem = recordProblem('goals', fields.id ?? 'check', { ...out, id: fields.id ?? 'check' });
    if (problem) throw new Error(problem);
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
    if (WEEKLY.has(kind) && weekStart(day) !== day) throw new Error(`A ${kind} is filed under its week's Monday`);
    let id = journalId(kind, day);
    if (SLOTTED.has(kind)) {
      if (!SLOT.test(String(record.slot ?? ''))) throw new Error(`A ${kind} needs a slot: morning, afternoon, evening or own-1 …`);
      id = `${id}:${record.slot}`;
    }
    if (record.id != null && record.id !== id) throw new Error(`A ${kind} for ${day} has the id ${id}`);
    const content = {};
    for (const key of Object.keys(fields)) {
      if (record[key] !== undefined) content[key] = structuredClone(record[key]);
    }
    const existing = doc.journal[id];
    if (!existing) return create('journal', { source, ...structuredClone(fields), ...content, id, kind, day });
    writeRecord('journal', id, { ...existing, ...content, id, kind, day });
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
    const extras = (rec) => Object.fromEntries(['area', 'minutes', 'time', 'priority', 'notes', 'details']
      .filter((key) => rec[key] !== undefined).map((key) => [key, rec[key]]));
    const goalRec = goal
      ? goalFields({ ...extras(goal), title: goal.title, targetDate: goal.targetDate ?? null, why: goal.why ?? '', ...suggested })
      : null;
    const goalId = goalRec ? newId() : null;
    const firstMilestone = nextOrder('milestones');
    const milestoneRecs = milestones.map((title, i) => ({
      goalId, title: requireTitle(title, 'A milestone'), done: false, order: firstMilestone + i, ...suggested,
    }));
    const firstItem = nextOrder('items');
    const itemRecs = [
      ...habits.map((h) => itemFields({
        ...extras(h), type: 'habit', title: h.title, repeat: h.repeat ?? { kind: 'daily' }, goalId, ...suggested,
      })),
      ...targets.map((t) => itemFields({
        ...extras(t), type: 'quota', title: t.title, target: t.target, unit: t.unit ?? 'count', unitLabel: t.unitLabel ?? '', goalId, ...suggested,
      })),
      ...tasks.map((t) => itemFields({ ...extras(t), type: 'task', title: t.title, date: t.date ?? today(), goalId, ...suggested })),
    ].map((fields, i) => ({ ...fields, order: firstItem + i }));
    if (!goalRec && !itemRecs.length) return { goal: null, milestones: [], items: [] };
    return transaction(() => ({
      goal: goalRec ? build('goals', { ...goalRec, id: goalId }) : null,
      milestones: milestoneRecs.map((fields) => build('milestones', fields)),
      items: itemRecs.map((fields) => build('items', fields)),
    }));
  }

  // ✓ on a suggested goal: the goal and its still-suggested milestones go live from today. Its
  // proposed habits and targets stay suggestions on Today, to be accepted one by one.
  function acceptGoalPlan(goalId) {
    const goal = doc.goals[goalId];
    if (!goal) throw new Error(`No goals record ${goalId}`);
    const live = { status: 'active', created: today(), updated: stamp() };
    if (goal.status === 'suggested') writeRecord('goals', goalId, { ...goal, ...live });
    for (const [id, m] of Object.entries(doc.milestones)) {
      if (m.goalId === goalId && m.status === 'suggested') writeRecord('milestones', id, { ...m, ...live });
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
    if (goal.status === 'suggested') writeRecord('goals', goalId, { ...goal, ...gone });
    for (const map of ['milestones', 'items']) {
      for (const [id, rec] of Object.entries(doc[map])) {
        if (rec.goalId === goalId && rec.status === 'suggested') writeRecord(map, id, { ...rec, ...gone });
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
  function addChange({ summary, edits, source = 'claude' } = {}) {
    const text = String(summary ?? '').trim();
    if (!text) throw new Error('A change needs a summary');
    if (!Array.isArray(edits) || !edits.length) throw new Error('A change needs at least one edit');
    return create('changes', {
      source, at: stamp(), summary: text, edits: structuredClone(edits),
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
      if (!current || stableStringify(recordContent(current)) !== stableStringify(recordContent(edit.after))) {
        skipped.push(edit);
        continue;
      }
      writeRecord(edit.map, edit.id, edit.before
        ? structuredClone(edit.before)
        : { ...current, status: edit.map === 'logs' ? 'archived' : 'dismissed' });
      undone.push(edit);
    }
    if (!undone.length) return { undone, skipped, already: false };
    writeRecord('changes', changeId, { ...change, undoneAt: t, undoneBy: by });
    commit('local');
    return { undone, skipped, already: false };
  }

  // Changes older than CHANGE_KEEP_DAYS lose their before/after snapshots (the summary stays, and
  // they can no longer be undone), so the synced file doesn't grow for ever. Returns how many.
  function pruneChanges() {
    const cutoff = new Date(now().getTime() - CHANGE_KEEP_DAYS * 86400000).toISOString();
    let n = 0;
    for (const [id, c] of Object.entries(doc.changes)) {
      if (c.pruned || !(c.at < cutoff)) continue;
      const edits = (c.edits ?? []).map((e) => ({ map: e.map, id: e.id, before: null, after: null }));
      writeRecord('changes', id, { ...c, edits, pruned: true });
      n++;
    }
    if (n) commit('local');
    return n;
  }

  // A record the planner's script (or Claude) keeps by a fixed id: created, or given new content. A
  // record whose content is already the same is left alone — nothing is written, so nothing syncs.
  function putRecord(map, id, fields, source) {
    const content = JSON.parse(JSON.stringify(fields));
    const existing = doc[map][id];
    if (existing && existing.status === 'active') {
      const same = existing.source === source
        && Object.keys(content).every((k) => stableStringify(existing[k]) === stableStringify(content[k]));
      if (same) return { rec: existing, changed: false };
      writeRecord(map, id, { ...existing, ...content, id, source });
      commit('local');
      return { rec: doc[map][id], changed: true };
    }
    return { rec: create(map, { ...content, id, source }), changed: true };
  }

  // The calendar planner's records (js/calendar.js).
  const putCalendar = (id, fields, source = 'planner') => putRecord('calendar', id, fields, source);

  // The gym's records (js/gym.js): workouts, templates and status from Hevy, settings from Claude.
  const putGym = (id, fields, source = 'hevy') => putRecord('gym', id, fields, source);

  // A log with a fixed id (a Hevy workout's tick or cardio minutes): made once, then only its given
  // fields change, whatever its status — so a tick George has taken off stays off.
  function putLog(id, fields) {
    const existing = doc.logs[id];
    if (!existing) return create('logs', { goalId: null, note: '', ...structuredClone(fields), id });
    const same = Object.keys(fields).every((k) => stableStringify(existing[k]) === stableStringify(fields[k]));
    if (same) return existing;
    return patch('logs', id, structuredClone(fields));
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
    for (let i = 0; i < renumbered.length; i++) {
      const rid = renumbered[i];
      const order = base + i;
      if (orderOf(rid) !== order) writeRecord('items', rid, { ...doc.items[rid], order });
    }
    commit('local');
  }

  function replaceDoc(next, reason = 'sync') {
    if (!isDoc(next)) throw new Error("That isn't a valid dashboard document");
    if (stableStringify(next) === stableStringify(doc)) return;
    // Best-effort recovery point before external data replaces the working copy.
    try { storage.setItem(BACKUP_KEY, JSON.stringify(doc)); } catch { /* keep the working copy */ }
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
    saveError: () => [...saveErrors.values()].join('; ') || null,
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
    skipItem,
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
    updateJournal: (id, changes) => patch('journal', id, structuredClone(changes)),
    pruneTalks,
    addPlan,
    acceptGoalPlan,
    dismissGoalPlan,

    addFlag,
    addressFlag,

    addChange,
    undoChange,
    pruneChanges,

    putCalendar,
    putGym,
    putLog,
    transaction,
    putWorkflow,
    setDetails,
    saveRule,
    reportOutcome,
    requestReview,

    replaceDoc,
    absorbStored,
    updateSettings,
    exportJson: () => JSON.stringify(doc, null, 2),
    importJson,
  };
}
