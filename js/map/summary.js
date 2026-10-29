// The map in words (docs/superpowers/specs/2026-10-22-civ-map-design.md): for Claude's catch-up and
// `map` read (claude/cli.js), and for the phone's Map widget (js/glance.js). Pure.

import { replay, makeCityOf, lookups } from './engine.js';
import { distK } from './hex.js';
import { shortWeekday, shortDate } from '../dates.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The city showing today: where he is, else the latest one started.
export function mapToday(doc, maps, today) {
  if (!maps?.length) return null;
  const cityOf = makeCityOf(doc, maps);
  const here = cityOf(today);
  const map = maps.find((m) => m.id === here) ?? [...maps].filter((m) => m.start <= today).sort((a, b) => (a.start < b.start ? 1 : -1))[0];
  return map ? { map, state: replay({ doc, map, today, cityOf }) } : null;
}

const nextOf = (state, def, L) => {
  const next = def.list.find(([id]) => !state.earned.has(id));
  return next ? `${def.name} ${state.track[Object.keys(state.map.tracks).find((t) => state.map.tracks[t] === def)] ?? 0}/${next[1]} → ${L.byId.get(next[0])?.name}` : `${def.name}: all cards earned, levelling up`;
};

// Lines for Claude. Hidden places stay hidden: only how many are left, never their names.
export function mapSummary({ map, state }) {
  const L = lookups(map);
  const out = [`${map.name}: turn ${state.turn}, ${plural(state.owned.size, 'tile')} of ${L.tiles.size}. ${state.ready ? `${plural(state.ready, 'tile')} waiting to be claimed; ` : ''}${state.pool}/${state.cost} hammers to the next.`];
  // A visit is a chapter in Salzburg, where he comes and goes (docs/superpowers/specs/2026-10-29-salzburg-era-design.md).
  if (map.place === 'salzburg' && state.chapter) out.push(`Chapter ${state.chapter.n}, since ${shortWeekday(state.chapter.start)} ${shortDate(state.chapter.start)}: this visit.`);
  out.push(state.golden.on ? `Golden age: ${state.golden.run} finished days in a row (tiles cost ${state.cost}).` : `No golden age: ${plural(state.golden.run, 'finished day')} in a row (three starts one).`);
  for (const c of state.camps) {
    const away = Math.min(...[...state.owned].map((k) => distK(k, `${c.q},${c.r}`))) - 1;
    out.push(`Barbarians heading for ${L.byId.get(c.target)?.name ?? 'the centre'}, ${away <= 0 ? 'at his border' : `${plural(away, 'tile')} from his border`} (they came from a missed ${L.byId.get(c.target)?.track ?? 'day'}).`);
  }
  if (state.pillaged.size) out.push(`${plural(state.pillaged.size, 'raided tile')}: the next ${state.pillaged.size * 20} hammers repair them.`);
  if (state.cards.length) out.push(`Cards waiting to be placed: ${state.cards.map((c) => (c.kind === 'wonder' ? 'a wonder' : L.byId.get(c.id)?.name)).join(', ')}.`);
  out.push(`Next: ${Object.values(map.tracks ?? {}).map((def) => nextOf(state, def, L)).join('; ')}.`);
  const found = [...state.found].map((id) => L.byId.get(id)?.name);
  const hidden = map.places.filter((p) => p.kind === 'found' && !state.found.has(p.id)).length;
  const built = [...Object.keys(state.built), ...state.wonders].map((id) => `${L.byId.get(id)?.name}${state.levels[id] > 1 ? ` (level ${state.levels[id]})` : ''}`);
  out.push(`Found: ${found.length ? found.join(', ') : 'nothing yet'}; ${plural(hidden, 'place')} still hidden (don't tell him what).${built.length ? ` Built: ${built.join(', ')}.` : ''}`);
  if (state.last) out.push(`Last turn (${state.last.day}): ${state.last.done} of ${state.last.total} done, +${state.last.hammers} hammers${state.last.events.length ? `; ${state.last.events.map((e) => e.text).join('; ')}` : ''}.`);
  return out;
}

// The phone's Map widget: the city, its tiles, and what's waiting.
export function glanceMap({ map, state }, site) {
  const L = lookups(map);
  const lines = [];
  if (state.ready) lines.push(`${plural(state.ready, 'tile')} to claim`);
  if (state.cards.length) lines.push(`${plural(state.cards.length, 'card')} to place`);
  if (state.golden.on) lines.push(`Golden age · ${state.golden.run} days`);
  for (const name of new Set(state.camps.map((c) => L.byId.get(c.target)?.name ?? 'the centre'))) lines.push(`Barbarians heading for ${name}`);
  lines.push(`Next tile ${state.pool}/${state.cost}`);
  return { title: map.name, number: String(state.owned.size), caption: 'tiles', lines, open: `${site}?big=map` };
}

// Reads the map files through a { read(path) → { text } | null } store (claude/files.js).
export async function readMaps(files, validMap) {
  const index = await files.read('map/index.json');
  if (!index) return [];
  let ids = [];
  try { ids = JSON.parse(index.text).cities ?? []; } catch { return []; }
  const maps = [];
  for (const id of ids) {
    try { const f = await files.read(`map/${id}.json`); const m = f && JSON.parse(f.text); if (validMap(m) && m.id === id) maps.push(m); } catch { /* skip a bad one */ }
  }
  return maps;
}

