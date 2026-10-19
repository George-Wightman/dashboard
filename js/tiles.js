// Daylight's tiles: their order and which are hidden, kept on this device in
// localStorage['dash_tiles'] as { v: 1, order: [ids], hidden: [ids] } (every known id is in `order`;
// the hidden ones are listed in `hidden` too). The first time, the arrangement comes from the classic
// screen's widgets (js/layout.js), read in its order: under the list, then each column. Also the
// big number at the top of Body and Hebrew. Pure apart from loadTiles/saveTiles' storage.

import { UNDER } from './layout.js';
import { weekTotal } from './schedule.js';
import { cardioQuotaId } from './gym.js';

export const TILES_KEY = 'dash_tiles';

// Where the note for Claude sits on Daylight (js/ui/noteslot.js), this device's own choice.
export const NOTE_KEY = 'dash_note';
export const NOTE_PLACES = ['top', 'day', 'tiles'];
export function loadNotePlace(storage) {
  try {
    const v = storage.getItem(NOTE_KEY);
    return NOTE_PLACES.includes(v) ? v : 'top';
  } catch {
    return 'top';
  }
}
export function saveNotePlace(storage, place) {
  try { storage.setItem(NOTE_KEY, NOTE_PLACES.includes(place) ? place : 'top'); } catch { /* this device only */ }
}
// `review` (the week in review) only shows Saturday to Monday, at the top.
export const TILE_IDS = ['review', 'needs', 'body', 'fuel', 'hebrew', 'goals', 'weeks', 'countdown', 'week'];
export const DEFAULT_TILES = Object.freeze({ v: 1, order: Object.freeze([...TILE_IDS]), hidden: Object.freeze([]) });

// The classic widgets with a tile. Note for Claude moved into the timeline; Muscles and Cardio
// trend into Body's big view.
export const CLASSIC_TO_TILE = {
  agenda: 'needs', gym: 'body', history: 'weeks', hebrew: 'hebrew', goals: 'goals', countdown: 'countdown', week: 'week',
};

const list = (v) => (Array.isArray(v) ? v : []);
const unique = (ids) => [...new Set(ids)];

export function fromClassic(layout) {
  const reading = [...list(layout?.[UNDER]), ...list(layout?.columns?.[0]), ...list(layout?.columns?.[1])];
  const mapped = (ids) => unique(ids.map((id) => CLASSIC_TO_TILE[id]).filter(Boolean));
  const order = mapped(reading);
  const hidden = mapped(list(layout?.hidden));
  const rest = TILE_IDS.filter((id) => !order.includes(id) && id !== 'review');
  return { v: 1, order: ['review', ...order, ...rest], hidden };
}

export function normalizeTiles(saved, known = TILE_IDS) {
  if (!saved || typeof saved !== 'object' || saved.v !== 1 || !Array.isArray(saved.order)) {
    return { v: 1, order: [...DEFAULT_TILES.order], hidden: [] };
  }
  const order = unique(saved.order.filter((id) => known.includes(id)));
  // A tile new since the arrangement was saved goes at the end, except the review, which leads.
  const missing = known.filter((id) => !order.includes(id));
  return {
    v: 1,
    order: [...missing.filter((id) => id === 'review'), ...order, ...missing.filter((id) => id !== 'review')],
    hidden: unique(list(saved.hidden).filter((id) => known.includes(id))),
  };
}

// `id` goes just before `beforeId`, or to the end when beforeId is null or unknown.
export function moveTile(tiles, id, beforeId) {
  const rest = tiles.order.filter((x) => x !== id);
  const at = beforeId == null ? -1 : rest.indexOf(beforeId);
  if (at === -1) rest.push(id);
  else rest.splice(at, 0, id);
  return { ...tiles, order: rest };
}

// One step up (-1) or down (1) among the tiles that show.
export function nudgeTile(tiles, id, dir) {
  const shown = tiles.order.filter((x) => !tiles.hidden.includes(x));
  const i = shown.indexOf(id);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= shown.length) return tiles;
  return dir < 0 ? moveTile(tiles, id, shown[j]) : moveTile(tiles, id, shown[j + 1] ?? null);
}

export const hideTile = (tiles, id) => ({ ...tiles, hidden: unique([...tiles.hidden, id]) });

export function showTile(tiles, id) {
  return { ...moveTile(tiles, id, null), hidden: tiles.hidden.filter((x) => x !== id) };
}

export function loadTiles(storage, classicLayout) {
  try {
    const saved = JSON.parse(storage.getItem(TILES_KEY));
    if (saved && saved.v === 1 && Array.isArray(saved.order)) return normalizeTiles(saved);
  } catch { /* unreadable: start from the classic layout */ }
  return fromClassic(classicLayout);
}

export function saveTiles(storage, tiles) {
  try { storage.setItem(TILES_KEY, JSON.stringify(tiles)); } catch { /* best effort, like the classic layout */ }
}

// ---- The hero numbers ----------------------------------------------------------------------------

const minutesQuota = (doc, id) => {
  const q = id ? doc?.items?.[id] : null;
  return q && q.type === 'quota' && q.status === 'active' && q.unit === 'minutes' ? q : null;
};

// The weekly Hebrew minutes target (the Hebrew Reader's sync fills it; time away from the app — a
// conversation, a podcast — is logged by hand, from the home-screen shortcut or the Hebrew tile).
export const hebrewMinutesId = (doc) => minutesQuota(doc, 'hebrew-minutes')?.id ?? null;

export function logHebrewByHand(store, minutes) {
  const id = hebrewMinutesId(store.doc());
  if (!id) throw new Error('No weekly Hebrew target yet: ask Claude to set one');
  return store.logAmount({ itemId: id, amount: minutes, note: 'logged by hand' });
}

export function bodyHero(doc, today) {
  const q = minutesQuota(doc, cardioQuotaId(doc));
  if (!q) return null;
  return { number: String(Math.round(weekTotal(doc, q.id, today))), caption: `of ${q.target} cardio minutes this week` };
}

// What Daylight's tiles already show, for This week to leave out: cardio when Body shows its big
// number, Hebrew's targets when the Hebrew tile shows (as the classic Hebrew widget does).
export function daylightShows(tiles, doc, today) {
  const shown = (id) => !tiles.hidden.includes(id);
  return {
    cardio: shown('body') && bodyHero(doc, today) != null,
    hebrew: shown('hebrew') && doc?.goals?.['hebrew-goal']?.status === 'active',
  };
}

export function hebrewHero(doc, today) {
  const q = minutesQuota(doc, 'hebrew-minutes');
  if (!q) return null;
  const total = Math.round(weekTotal(doc, q.id, today));
  const hours = Number((q.target / 60).toFixed(1));
  return { number: `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`, caption: `of ${hours} h this week` };
}
