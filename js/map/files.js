// The map's private files (docs/superpowers/specs/2026-10-22-civ-map-design.md): `map/index.json`
// lists the cities and `map/<city>.json` is each one's land, places and drawings, all in the private
// sync repo, read with the same key as data.json. The last good copies are kept on this device so the
// map works offline. And the day's place: which country George was in, stamped once a day.

import { CENTRAL } from '../travel.js';

export const MAPS_KEY = 'dash_maps';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9-]{1,40}$/;
const KINDS = ['found', 'build', 'wonder'];
const int = (v) => Number.isInteger(v) && Math.abs(v) < 1000;
const str = (v, max = 200) => typeof v === 'string' && v.length <= max;
// A drawing is an SVG and nothing that could run.
export const safeArt = (s) => str(s, 200000) && /^<svg[\s>]/.test(s) && !/<script|<foreignObject|\son[a-z]+\s*=|javascript:/i.test(s);

export function validMap(m) {
  if (!m || typeof m !== 'object') return false;
  if (!ID.test(m.id ?? '') || !str(m.name, 60) || !['uk', 'salzburg'].includes(m.place) || !DAY.test(m.start ?? '')) return false;
  if (m.end != null && !DAY.test(m.end)) return false;
  if (!Array.isArray(m.tiles) || !m.tiles.length || !m.tiles.every((t) => t && int(t.q) && int(t.r) && str(t.terrain, 20))) return false;
  if (!m.tiles.some((t) => t.q === 0 && t.r === 0)) return false;
  if (!Array.isArray(m.places) || !m.places.every((p) => p && ID.test(p.id ?? '') && str(p.name, 60) && KINDS.includes(p.kind) && int(p.q) && int(p.r))) return false;
  if (!m.tracks || typeof m.tracks !== 'object') return false;
  const builds = new Set(m.places.filter((p) => p.kind === 'build').map((p) => p.id));
  for (const t of Object.values(m.tracks)) {
    if (!t || !Array.isArray(t.areas) || !Array.isArray(t.list) || !t.list.length
      || !t.list.every((e) => Array.isArray(e) && builds.has(e[0]) && Number.isFinite(e[1]))) return false;
  }
  if (m.art != null && (typeof m.art !== 'object' || !Object.values(m.art).every(safeArt))) return false;
  return true;
}

export function loadCachedMaps(storage) {
  try {
    const saved = JSON.parse(storage.getItem(MAPS_KEY));
    return Array.isArray(saved?.maps) ? saved.maps.filter(validMap) : [];
  } catch {
    return [];
  }
}

// `clientFor(path)` gives a { get } like js/sync.js's createGitHubClient: null when the file isn't there.
export async function refreshMaps({ clientFor, storage }) {
  const index = await clientFor('map/index.json').get();
  const ids = Array.isArray(index?.doc?.cities) ? index.doc.cities.filter((id) => ID.test(id)) : [];
  const maps = [];
  // A city that can't be fetched (a blip) throws, so the cached maps stay; one that's malformed is left out.
  for (const id of ids) {
    const file = await clientFor(`map/${id}.json`).get();
    if (file && validMap(file.doc) && file.doc.id === id) maps.push(file.doc);
  }
  try { storage.setItem(MAPS_KEY, JSON.stringify({ at: new Date().toISOString(), maps })); } catch { /* too big for this device: kept for this visit only */ }
  return maps;
}

// The first open of a day says where George is: Central European time is Salzburg, anywhere else the UK.
export function ensureDayPlace(store, day, timeZone) {
  const id = `day:${day}`;
  if (store.doc().game?.[id]) return null;
  return store.putGame(id, { day, place: CENTRAL.test(timeZone ?? '') ? 'salzburg' : 'uk' });
}
