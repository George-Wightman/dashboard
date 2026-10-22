// The map (docs/superpowers/specs/2026-10-22-civ-map-design.md): a city's land grows from George's
// honest day score. Nothing about the game is stored: the state is replayed, turn by turn, from the
// shared document, the city's map file and his choices (the `game` records). So every device draws
// the same map, an undo changes the past correctly, and there is nothing to merge. Pure.

import { dayScore, doneIndex } from '../schedule.js';
import { timeOff } from '../calendar.js';
import { cardioQuotaId } from '../gym.js';
import { addDays } from '../dates.js';
import { key, unkey, nbrs, dist, distK } from './hex.js';

export const COST = 40;          // hammers for a tile
export const GOLDEN_COST = 30;   // in a golden age
export const BANK = 5;           // tiles that can wait to be claimed
export const REPAIR = 20;        // hammers to repair a raided tile
export const LEVEL_STEP = 400;   // track points per building level once a track's cards are all earned
export const MAX_LEVEL = 3;
export const GOLDEN_RUN = 3;     // finished days in a row for a golden age
export const ROAD_MINUTES = 10;  // cardio minutes per road step
export const FINISHED_BONUS = 20;
export const MAX_CAMPS = 4;     // past this, a miss raids but sends no more
export const FIND_VALUE = { coal: 20, wheat: 10, sheep: 10, deer: 10, horses: 10, pub: 15, pitwheel: 15, stone: 10, fish: 10 };
export const FIND_NAME = { coal: 'Coal seam', wheat: 'Wheat', sheep: 'Sheep', deer: 'Deer', horses: 'Horses', pub: 'A pub', pitwheel: 'An old pit wheel', stone: 'Stone', fish: 'Fish' };

const values = (o) => Object.values(o ?? {});
const CENTRE = key(0, 0);
export const rowHammers = (row) => ((row.item.minutes ?? 0) >= 60 ? 20 : 10);

// Where George was each day: the `day:` stamps, each lasting until the next. With none yet, the UK.
export function makeCityOf(doc, maps) {
  const stamps = values(doc.game).filter((g) => g.status === 'active' && String(g.id).startsWith('day:'))
    .map((g) => [g.day, g.place]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const placeOn = (day) => {
    let place = 'uk';
    for (const [d, p] of stamps) { if (d > day) break; place = p; }
    return place;
  };
  return (day) => {
    const place = placeOn(day);
    return maps.find((m) => m.place === place && m.start <= day && (!m.end || day <= m.end))?.id ?? null;
  };
}

// The map file's lookups, built once per file.
const prepared = new WeakMap();
function prepare(map) {
  let p = prepared.get(map);
  if (p) return p;
  const tiles = new Map(map.tiles.map((t) => [key(t.q, t.r), t]));
  const at = new Map(map.places.filter((x) => x.kind !== 'build').map((x) => [key(x.q, x.r), x]));
  const builds = map.places.filter((x) => x.kind === 'build');
  const zones = Object.fromEntries(builds.map((b) => [b.id, new Set([key(b.q, b.r), ...nbrs(b.q, b.r)].filter((k) => tiles.has(k)))]));
  const trackOfArea = {};
  for (const [t, def] of Object.entries(map.tracks ?? {})) for (const a of def.areas ?? []) trackOfArea[a] = t;
  p = { tiles, at, builds, zones, trackOfArea, byId: new Map(map.places.map((x) => [x.id, x])) };
  prepared.set(map, p);
  return p;
}

export function visibleOf(map, owned) {
  const { tiles } = prepare(map);
  const v = new Set(owned);
  for (const k of owned) for (const n of nbrs(...unkey(k))) if (tiles.has(n)) v.add(n);
  return v;
}

export function claimable(state) {
  const camps = new Set(state.camps.map((c) => key(c.q, c.r)));
  const out = [];
  for (const k of state.visible) if (!state.owned.has(k) && !camps.has(k)) out.push(k);
  return out.sort();
}

// The tiles a card can go on.
export function placeable(state, card) {
  const P = prepare(state.map);
  const builtTiles = new Set(Object.values(state.built));
  if (card.kind === 'wonder') {
    return [...state.owned].filter((k) => { const p = P.at.get(k); return p?.kind === 'wonder' && !state.wonders.has(p.id); }).sort();
  }
  const zone = P.zones[card.id];
  if (!zone) return [];
  return [...zone].filter((k) => state.owned.has(k) && k !== CENTRE && !P.at.has(k) && !builtTiles.has(k)).sort();
}

// The tile a camp heads for: a placed building, a zone's centre, a place, or the city centre.
function targetTile(state, target) {
  const P = prepare(state.map);
  if (state.built[target]) return state.built[target];
  const p = P.byId.get(target);
  return p ? key(p.q, p.r) : CENTRE;
}

const nearestToCentre = (keys) => [...keys].sort((a, b) => distK(a, CENTRE) - distK(b, CENTRE) || (unkey(a)[0] - unkey(b)[0]) || (unkey(a)[1] - unkey(b)[1]))[0];

export function replay({ doc, map, today, cityOf = () => map.id, snapshots = false }) {
  const P = prepare(map);
  const idx = doneIndex(doc);
  const offs = timeOff(doc);
  const cardioId = cardioQuotaId(doc);
  const owned = new Set([CENTRE, ...nbrs(0, 0)].filter((k) => P.tiles.has(k)));
  const state = {
    map, turn: 0, day: null, owned, visible: visibleOf(map, owned), ready: 1, pool: 0, cost: COST,
    golden: { on: false, run: 0 }, track: Object.fromEntries(Object.keys(map.tracks ?? {}).map((t) => [t, 0])),
    earned: new Set(), cards: [], built: {}, levels: {}, pendingLevels: {}, wonders: new Set(),
    camps: [], pillaged: new Set(), roads: [], roadNet: new Set([CENTRE]), roadSteps: 0, roadCarry: 0,
    found: new Set(), zonesSeen: new Set(), claimedFinds: new Set(),
    chronicle: [], last: null, pending: [], history: snapshots ? [] : null,
  };
  const event = (kind, text, extra = {}) => state.pending.push({ kind, text, ...extra });
  const see = (quiet) => {
    state.visible = visibleOf(map, state.owned);
    for (const k of state.visible) {
      const p = P.at.get(k);
      if (p?.kind === 'found' && !state.found.has(p.id)) { state.found.add(p.id); if (!quiet) event('discovered', `Discovered ${p.name}`, { id: p.id }); }
      for (const b of P.builds) if (P.zones[b.id].has(k) && !state.zonesSeen.has(b.id)) { state.zonesSeen.add(b.id); if (!quiet) event('zone', `Good ground spotted for ${b.name}`, { id: b.id }); }
    }
  };
  see(true);

  const claim = (k, auto = false) => {
    state.owned.add(k);
    const t = P.tiles.get(k);
    if (t.find && !state.claimedFinds.has(k)) {
      state.claimedFinds.add(k);
      const v = map.finds?.[t.find] ?? FIND_VALUE[t.find] ?? 10;
      state.pool += v;
      event('find', `${FIND_NAME[t.find] ?? 'A find'}: +${v} hammers`, { k });
    }
    const p = P.at.get(k);
    if (p?.kind === 'found') event('reached', `${p.name} is yours`, { id: p.id });
    if (p?.kind === 'wonder') event('site', 'A wonder site is yours', { k });
    if (auto) event('auto', 'A tile was claimed for you (five were waiting)', { k });
    see(false);
  };
  const bank = () => {
    while (state.pool >= state.cost) {
      state.pool -= state.cost;
      if (state.ready < BANK) { state.ready++; continue; }
      const k = nearestToCentre(claimable(state));
      if (!k) { state.pool += state.cost; break; }
      claim(k, true);
    }
  };
  const applyLevels = () => {
    for (const [tr, def] of Object.entries(map.tracks ?? {})) {
      while ((state.pendingLevels[tr] ?? 0) > 0) {
        const placed = def.list.map(([id]) => id).filter((id) => state.built[id] && (state.levels[id] ?? 1) < MAX_LEVEL);
        if (!placed.length) break;
        const id = placed.sort((a, b) => (state.levels[a] ?? 1) - (state.levels[b] ?? 1))[0];
        state.levels[id] = (state.levels[id] ?? 1) + 1;
        state.pendingLevels[tr]--;
        event('level', `${P.byId.get(id).name} reaches level ${state.levels[id]}`, { id });
      }
    }
  };
  const layRoads = () => {
    while (state.roadSteps > 0) {
      // Joined-up targets: owned tiles holding a place, a building or a built wonder.
      const builtTiles = new Set(Object.values(state.built));
      const targets = new Set();
      for (const k of state.owned) {
        if (state.roadNet.has(k)) continue;
        const p = P.at.get(k);
        if ((p && (p.kind !== 'wonder' || state.wonders.has(p.id))) || builtTiles.has(k)) targets.add(k);
      }
      if (!targets.size) break;
      // Breadth-first from the network through owned tiles to the nearest target.
      const prev = new Map(); const queue = [...state.roadNet].sort(); let hit = null;
      for (const k of queue) prev.set(k, null);
      for (let i = 0; i < queue.length && !hit; i++) {
        for (const n of nbrs(...unkey(queue[i])).sort()) {
          if (prev.has(n) || !state.owned.has(n)) continue;
          prev.set(n, queue[i]);
          if (targets.has(n)) { hit = n; break; }
          queue.push(n);
        }
      }
      if (!hit) break;
      let step = hit;
      while (prev.get(step) && !state.roadNet.has(prev.get(step))) step = prev.get(step);
      state.roadNet.add(step);
      state.roads.push([prev.get(step), step]);
      state.roadSteps--;
    }
  };

  const applyChoice = (c) => {
    const k = key(c.q, c.r);
    if (String(c.id).startsWith('claim:')) {
      if (state.ready < 1 || !P.tiles.has(k) || state.owned.has(k) || !nbrs(c.q, c.r).some((n) => state.owned.has(n))
        || state.camps.some((x) => x.q === c.q && x.r === c.r)) return;
      state.ready--;
      claim(k);
      bank();
      return;
    }
    // place:<city>:<card>: a building by its id, or a wonder by its site's id.
    const site = P.at.get(k);
    if (site?.kind === 'wonder' && site.id === c.card) {
      const i = state.cards.findIndex((x) => x.kind === 'wonder');
      if (i === -1 || !state.owned.has(k) || state.wonders.has(site.id)) return;
      state.cards.splice(i, 1);
      state.wonders.add(site.id);
      event('wonder', `${site.name} is built`, { id: site.id });
      return;
    }
    const i = state.cards.findIndex((x) => x.kind === 'build' && x.id === c.card);
    if (i === -1 || !placeable(state, state.cards[i]).includes(k)) return;
    state.cards.splice(i, 1);
    state.built[c.card] = k;
    state.levels[c.card] = 1;
    event('built', `${P.byId.get(c.card).name} is built`, { id: c.card });
    applyLevels();
  };

  const choices = values(doc.game)
    .filter((g) => g.status === 'active' && g.city === map.id && (String(g.id).startsWith('claim:') || String(g.id).startsWith('place:')))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  const wonderDays = new Map();
  for (const m of values(doc.milestones)) {
    if (!['active', 'archived'].includes(m.status) || !m.done) continue;
    const d = m.doneOn ?? (typeof m.updated === 'string' ? m.updated.slice(0, 10) : null);
    if (d) wonderDays.set(d, (wonderDays.get(d) ?? 0) + 1);
  }
  const cardio = new Map();
  for (const l of values(doc.logs)) if (l.status === 'active' && l.kind === 'amount' && cardioId && l.itemId === cardioId) cardio.set(l.day, (cardio.get(l.day) ?? 0) + l.amount);
  const quoteOn = (d) => {
    const said = values(doc.journal).filter((j) => String(j.id).startsWith(`reflect:${d}:`) && typeof j.said === 'string' && j.said.trim())
      .sort((a, b) => (a.answeredAt < b.answeredAt ? -1 : 1))[0]?.said.trim();
    if (!said) return null;
    return said.length > 160 ? said.slice(0, 157).trimEnd() + '…' : said;
  };

  const wonderCards = (d) => {
    for (let i = 0; i < (wonderDays.get(d) ?? 0); i++) { state.cards.push({ kind: 'wonder', id: `wonder-${d}-${i}` }); event('wonder-card', 'A goal step: a wonder card'); }
  };
  // Roads from cardio.
  const cardioRoads = (d) => {
    const minutes = (cardio.get(d) ?? 0) + state.roadCarry;
    state.roadSteps += Math.floor(minutes / ROAD_MINUTES);
    state.roadCarry = minutes % ROAD_MINUTES;
    layRoads();
  };
  const wondersAndRoads = (d) => { wonderCards(d); cardioRoads(d); };
  // How far each tile is from his border, out to `max` rings: one search outwards, not every tile
  // against every owned tile.
  const ringsOut = (max) => {
    const far = new Map();
    let edge = [...state.owned];
    for (let n = 1; n <= max && edge.length; n++) {
      const next = [];
      for (const k of edge) for (const nb of nbrs(...unkey(k))) {
        if (!P.tiles.has(nb) || state.owned.has(nb) || far.has(nb)) continue;
        far.set(nb, n);
        next.push(nb);
      }
      edge = next;
    }
    return far;
  };

  const settle = (d) => {
    const score = dayScore(doc, d, idx, offs);
    if (score.total === 0) { wondersAndRoads(d); return; }
    state.turn++;
    state.day = d;
    const finished = score.done === score.total && score.total >= 3;
    const miss = score.done < score.total;
    // Golden age: from the third finished day in a row; a miss ends it.
    const wasGolden = state.golden.on;
    if (finished) state.golden.run++; else if (miss) state.golden.run = 0;
    state.golden.on = state.golden.run >= GOLDEN_RUN;
    state.cost = state.golden.on ? GOLDEN_COST : COST;
    if (state.golden.on && !wasGolden) event('golden', 'A golden age begins');
    if (!state.golden.on && wasGolden) event('golden-end', 'The golden age ends');
    let hammers = 0;
    for (const row of score.doneRows) {
      const h = rowHammers(row);
      hammers += h;
      const tr = P.trackOfArea[row.item.area];
      if (tr) state.track[tr] += h;
    }
    if (finished) hammers += FINISHED_BONUS;
    state.pool += hammers;
    // Raided tiles are repaired first.
    for (const k of [...state.pillaged]) {
      if (state.pool < REPAIR) break;
      state.pool -= REPAIR;
      state.pillaged.delete(k);
      event('repaired', 'A raided tile is repaired', { k });
    }
    bank();
    // Cards, then levels once a track's cards are all earned.
    for (const [tr, def] of Object.entries(map.tracks ?? {})) {
      for (const [id, need] of def.list) {
        if (state.track[tr] >= need && !state.earned.has(id)) {
          state.earned.add(id);
          state.cards.push({ kind: 'build', id });
          event('card', `Card earned: ${P.byId.get(id).name}`, { id });
        }
      }
      const last = def.list.at(-1)?.[1] ?? 0;
      if (def.list.every(([id]) => state.earned.has(id))) {
        const due = Math.floor(Math.max(0, state.track[tr] - last) / LEVEL_STEP);
        const given = state.levelsGiven?.[tr] ?? 0;
        if (due > given) {
          state.pendingLevels[tr] = (state.pendingLevels[tr] ?? 0) + due - given;
          state.levelsGiven = { ...state.levelsGiven, [tr]: due };
        }
      }
    }
    applyLevels();
    wonderCards(d);
    // Barbarians: they creep towards what they're after; on a missed day they raid, and more come.
    const campKeys = () => new Set(state.camps.map((c) => key(c.q, c.r)));
    for (const c of state.camps) {
      const goal = unkey(targetTile(state, c.target));
      const here = dist([c.q, c.r], goal);
      const taken = campKeys();
      const step = nbrs(c.q, c.r).filter((n) => P.tiles.has(n) && !state.owned.has(n) && !taken.has(n))
        .map(unkey).sort((a, b) => dist(a, goal) - dist(b, goal) || a[0] - b[0] || a[1] - b[1])[0];
      if (step && dist(step, goal) < here) [c.q, c.r] = step;
    }
    if (miss) {
      for (const c of state.camps) {
        const goal = unkey(targetTile(state, c.target));
        const victim = nbrs(c.q, c.r).filter((n) => state.owned.has(n) && n !== CENTRE && !state.pillaged.has(n))
          .sort((a, b) => dist(unkey(a), goal) - dist(unkey(b), goal) || (a < b ? -1 : 1))[0];
        if (victim) { state.pillaged.add(victim); event('raid', `Barbarians raid near ${P.byId.get(c.target)?.name ?? 'the centre'}`, { k: victim }); }
      }
      const missedItems = [...score.open.map((r) => r.item), ...score.missed.map((e) => e.item), ...score.dropped.map((e) => e.item)];
      const tr = missedItems.map((it) => P.trackOfArea[it.area]).find(Boolean);
      const target = tr ? (map.tracks[tr].list.map(([id]) => id).find((id) => state.built[id]) ?? map.tracks[tr].list[0][0]) : (map.home && P.byId.has(map.home) ? map.home : 'centre');
      const goal = unkey(targetTile(state, target));
      const taken = campKeys();
      let spot = null;
      const far = ringsOut(4);
      for (const want of [3, 4, 2]) {
        const ring = [...far].filter(([k, n]) => n === want && !taken.has(k)).map(([k]) => k);
        if (ring.length) { spot = ring.sort((a, b) => dist(unkey(a), goal) - dist(unkey(b), goal) || (a < b ? -1 : 1))[0]; break; }
      }
      if (spot && state.camps.length < MAX_CAMPS) {
        const [q, r] = unkey(spot);
        state.camps.push({ q, r, target });
        event('camp', `Barbarians set out for ${P.byId.get(target)?.name ?? 'the centre'}`, { target });
      }
    } else if (finished && state.camps.length) {
      state.camps.sort((a, b) => dist([a.q, a.r], [0, 0]) - dist([b.q, b.r], [0, 0]));
      const gone = state.camps.shift();
      event('camp-gone', `Barbarians driven off`, { target: gone.target });
    }
    cardioRoads(d);
    const entry = { day: d, turn: state.turn, done: score.done, total: score.total, hammers, golden: state.golden.on, events: state.pending, quote: quoteOn(d) };
    state.pending = [];
    state.chronicle.push(entry);
    state.last = entry;
    if (state.history) state.history.push(snapshot(state));
  };

  let ci = 0;
  for (let d = map.start; d <= today; d = addDays(d, 1)) {
    // His choices for the day, in the order he made them; any that aren't legal then are ignored.
    while (ci < choices.length && choices[ci].day <= d) { if (choices[ci].day <= today) applyChoice(choices[ci]); ci++; }
    layRoads();
    if (d < today && (!map.end || d <= map.end) && cityOf(d) === map.id) settle(d);
  }
  state.today = state.pending;
  state.pending = [];
  return state;
}

function snapshot(s) {
  return {
    day: s.day, turn: s.turn, owned: [...s.owned], built: { ...s.built }, levels: { ...s.levels }, wonders: [...s.wonders],
    camps: s.camps.map((c) => ({ ...c })), pillaged: [...s.pillaged], roads: s.roads.map((r) => [...r]), golden: s.golden.on,
    found: [...s.found], claimedFinds: [...s.claimedFinds],
  };
}

// The map file's lookups, for the views: tiles, places by tile, buildings, zones, places by id.
export const lookups = (map) => prepare(map);
