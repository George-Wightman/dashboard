// The store: the whole state is one document in localStorage. Every change goes through here,
// stamps `updated`, saves, and tells listeners why it changed.

import { logicalDay } from './dates.js';
import { MAPS, emptyDoc, stableStringify } from './doc.js';
import { mergeDocs } from './merge.js';

export const DATA_KEY = 'dash_data';
export const SETTINGS_KEY = 'dash_settings';
export const CORRUPT_KEY = 'dash_data_corrupt';
export const DEFAULT_SETTINGS = { token: '', repo: '', dayStartHour: 4 };

const ITEM_TYPES = ['task', 'habit', 'quota'];

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

  function create(map, fields) {
    const rec = {
      source: 'me', status: 'active', created: today(), archivedOn: null,
      ...fields,
      id: fields.id ?? newId(),
      updated: stamp(),
    };
    doc[map][rec.id] = rec;
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

  function addItem(fields) {
    if (!ITEM_TYPES.includes(fields.type)) throw new Error(`Unknown item type ${fields.type}`);
    const title = requireTitle(fields.title, 'An item');
    if (fields.type === 'quota' && !(fields.target > 0)) throw new Error('A quota needs a target above 0');
    const defaults = { area: '', goalId: null, order: nextOrder('items') };
    if (fields.type === 'task') defaults.date = today();
    if (fields.type === 'habit') defaults.repeat = { kind: 'daily' };
    if (fields.type === 'quota') Object.assign(defaults, { unit: 'count', unitLabel: '' });
    return create('items', { ...defaults, ...fields, title });
  }

  function toggleDone(itemId, day = today()) {
    const existing = Object.values(doc.logs).find((l) =>
      l.itemId === itemId && l.kind === 'done' && l.day === day && l.status === 'active');
    if (existing) return patch('logs', existing.id, { status: 'archived' });
    return create('logs', { itemId, goalId: null, kind: 'done', day, at: stamp(), note: '' });
  }

  function logAmount({ itemId = null, goalId = null, amount, day = today(), note = '' }) {
    if (!(amount > 0)) throw new Error('An amount must be above 0');
    if (!itemId && !goalId) throw new Error('logAmount needs an itemId or a goalId');
    return create('logs', { itemId, goalId, kind: 'amount', amount, day, at: stamp(), note });
  }

  function addGoal(fields) {
    const title = requireTitle(fields.title, 'A goal');
    const defaults = { targetDate: null, target: null, unit: 'count', unitLabel: '', order: nextOrder('goals') };
    return create('goals', { ...defaults, ...fields, title });
  }

  function addMilestone(goalId, title) {
    return create('milestones', {
      goalId, title: requireTitle(title, 'A milestone'), done: false, order: nextOrder('milestones'),
    });
  }

  function reorder(idList) {
    const t = stamp();
    idList.forEach((id, i) => {
      const rec = doc.items[id];
      if (rec && rec.order !== i + 1) doc.items[id] = { ...rec, order: i + 1, updated: t };
    });
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
    if (!incoming || typeof incoming !== 'object' || !incoming.items || typeof incoming.items !== 'object') {
      throw new Error("That file isn't a dashboard backup");
    }
    replaceDoc(mergeDocs(doc, incoming), 'local');
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
    reorder,
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

    replaceDoc,
    updateSettings,
    exportJson: () => JSON.stringify(doc, null, 2),
    importJson,
  };
}
