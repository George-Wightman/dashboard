// The map (docs/superpowers/specs/2026-10-22-civ-map-design.md): a Daylight tile with a picture of
// the land and its headline numbers, a morning turn that plays yesterday out once per device, and the
// big view where George claims tiles, places cards, reads the chronicle and watches the era grow.
// The state comes from js/map/engine.js's replay; his choices are written as `game` records.

import { h } from './dom.js';
import { replay, claimable, placeable, makeCityOf, lookups, visibleOf, findName, FIND_VALUE, REPAIR, LEVEL_STEP } from '../map/engine.js';
import { key, unkey, DIRS } from '../map/hex.js';
import {
  S, K, SQ3, DEPTH, ROW, BOTTOM, centre, fromUnits, corners, pts, TERRAIN, CENTRE_TOP, PLAZA, TRACK_COLOUR, seasonOf, seasonTop, groundSvg, clipSvg,
  decoSvg, findSvg, paintedFindSvg, campSvg, smokeSvg, starSvg, plusSvg, levelSvg, roadSvg, bannerSvg, pinSvg, mix,
} from './map-art.js';
import { addDays, shortDate, shortWeekday } from '../dates.js';
import { dayPoints } from '../map/points.js';
import { BASE as PAINT_BASE, SIZE as PAINT_SIZE, SETS as PAINT_SETS } from '../map/terrain-atlas.js';

export const SEEN_KEY = 'dash_map_seen';
const SVGNS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---- which city, and its state ----

export function currentMap(maps, doc, today) {
  if (!maps?.length) return null;
  const here = makeCityOf(doc, maps)(today);
  return maps.find((m) => m.id === here)
    ?? [...maps].filter((m) => m.start <= today).sort((a, b) => (a.start < b.start ? 1 : -1))[0] ?? null;
}

let cached = { key: null, map: null, state: null };
const otherCache = new Map();
// The other cities, each where it really is on this city's board: the pin this map has for it (by
// name) is its centre. A city with no pin here isn't drawn. Pure.
export function neighbourCities(map, maps) {
  const out = [];
  for (const m of maps ?? []) {
    if (m === map || m.id === map.id) continue;
    const pin = (map.pins ?? []).find((p) => p.name === m.name);
    if (pin) out.push({ map: m, pin: pin.name, at: fromUnits(pin.at) });
  }
  return out;
}
function othersFor(ctx, map, today) {
  const maps = ctx.maps?.() ?? [];
  const doc = ctx.store.doc();
  const k = `${ctx.store.revision?.() ?? 0}|${today}|${maps.length}`;
  return neighbourCities(map, maps).filter(({ map: m }) => m.start <= today).map((n) => {
    let c = otherCache.get(n.map.id);
    if (!c || c.key !== k || c.map !== n.map) {
      c = { key: k, map: n.map, state: replay({ doc, map: n.map, today, cityOf: makeCityOf(doc, maps) }) };
      otherCache.set(n.map.id, c);
    }
    return { ...n, state: c.state };
  });
}

function stateFor(ctx) {
  const maps = ctx.maps?.() ?? [];
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const map = currentMap(maps, doc, today);
  if (!map) return null;
  const k = `${ctx.store.revision?.() ?? 0}|${today}|${map.id}|${maps.length}`;
  if (cached.key !== k || cached.map !== map) {
    cached = { key: k, map, state: replay({ doc, map, today, cityOf: makeCityOf(doc, maps), snapshots: true }) };
  }
  return { map, state: cached.state, today };
}

// ---- words ----

// What a tile is, for the hover or tap: null for plain land, so only tiles with something on them say anything.
export function describeTile(state, map, k) {
  const L = lookups(map);
  const t = L.tiles.get(k);
  if (!t) return null;
  const site = L.at.get(k);
  if (!state.visible.has(k)) return site?.kind === 'wonder' ? ['Something on the horizon', 'Get closer to find out'] : null;
  const lines = [];
  let title = k === '0,0' ? (map.centreName ?? map.name) : (TERRAIN[t.terrain]?.name ?? 'Land');
  let special = k === '0,0';
  const built = Object.entries(state.built).find(([, kk]) => kk === k)?.[0];
  if (built) { title = L.byId.get(built).name; lines.push(`Level ${state.levels[built] ?? 1}`); special = true; }
  else if (site?.kind === 'wonder') {
    special = true;
    if (state.wonders.has(site.id)) { title = site.name; lines.push('A wonder'); }
    else { title = 'Something to build here'; lines.push('Finish a goal step to find out what'); }
  } else if (site) { title = site.name; if (site.note) lines.push(site.note); special = true; }
  if (!built) for (const b of L.builds) if (!state.built[b.id] && L.zones[b.id].has(k) && state.zonesSeen.has(b.id)) lines.push(`Good ground for ${b.name}`);
  if (t.find && !state.claimedFinds.has(k)) lines.push(`${findName(map, t.find)}: +${map.finds?.[t.find] ?? FIND_VALUE[t.find] ?? 10} hammers when you claim it`);
  if (state.pillaged.has(k)) lines.push(`Raided: the next ${REPAIR} hammers repair it`);
  const camp = state.camps.find((c) => key(c.q, c.r) === k);
  if (camp) lines.push(`Barbarians, heading for ${L.byId.get(camp.target)?.name ?? 'the centre'}`);
  if (!special && !lines.length) return null;
  return [title, lines];
}

export function tileLines(state, map, points = null) {
  const L = lookups(map);
  const out = [];
  if (points) out.push(`Today +${points.earned}${points.toEarn ? `, +${points.toEarn} to go` : ''}${points.bonus.earned ? ' · finished' : ''}`);
  if (state.ready) out.push(`${plural(state.ready, 'tile')} to claim`);
  if (state.cards.length) out.push(`${plural(state.cards.length, 'card')} to place`);
  if (state.golden.on) out.push(`Golden age: ${state.golden.run} finished days in a row`);
  if (state.camps.length) {
    const names = [...new Set(state.camps.map((c) => L.byId.get(c.target)?.name ?? 'the centre'))];
    out.push(`Barbarians heading for ${names.join(' and ')}`);
  }
  if (state.pillaged.size) out.push(`${plural(state.pillaged.size, 'raided tile')} to repair`);
  return out;
}

// In Salzburg each visit is a chapter (docs/superpowers/specs/2026-10-29-salzburg-era-design.md).
export function chapterLabel(map, state) {
  return map.place === 'salzburg' && state.chapter ? `Chapter ${state.chapter.n} · since ${shortWeekday(state.chapter.start)} ${shortDate(state.chapter.start)}` : null;
}

export function morningLine(entry) {
  if (!entry) return null;
  const notable = entry.events.filter((e) => ['golden', 'golden-end', 'card', 'wonder-card', 'raid', 'camp', 'camp-gone', 'level', 'auto'].includes(e.kind)).map((e) => e.text);
  const head = `Yesterday: ${entry.done} of ${entry.total} done, +${entry.hammers} hammers`;
  return [head, ...notable.slice(0, 2)].join('. ') + '.';
}

// ---- drawing ----

const artHref = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
function artImage(map, id, x, y, scale) {
  const svg = map.art?.[id];
  if (!svg) return '';
  // Every drawing's viewBox is "-80 -115 160 125", ground at y = 0 (dev/build-map.mjs).
  const w = 160 * scale, hgt = 125 * scale;
  return `<image href="${artHref(svg)}" x="${(x - 80 * scale).toFixed(1)}" y="${(y - 115 * scale).toFixed(1)}" width="${w.toFixed(1)}" height="${hgt.toFixed(1)}"/>`;
}
const placeScale = (map, id) => map.places.find((p) => p.id === id)?.scale ?? 0.5;

// ---- painted ground ----

// Which painted season a day takes: autumn to 20 Nov, first snow to 20 Dec, winter to the end of
// February, first snow again (the thaw) through March, then spring and summer to the end of August.
export function paintSeason(day) {
  const md = String(day).slice(5, 10);
  if (md >= '09-01' && md <= '11-20') return 'autumn';
  if (md > '11-20' && md <= '12-20') return 'late';
  if (md > '12-20' || md <= '02-29') return 'winter';
  if (md <= '03-31') return 'late';
  return 'spring';
}
const PAINT_FALLBACK = { winter: ['winter', 'late', 'autumn'], late: ['late', 'autumn'], autumn: ['autumn'], spring: ['spring', 'autumn'] };
// A town, its shops and its works look like where the city is; the land is the same everywhere.
const paintSet = (map, terrain) => (['town', 'shops', 'industry'].includes(terrain) ? `${map.place === 'salzburg' ? 'sz' : 'uk'}-${terrain}` : terrain);
const tileHash = (q, r) => { let a = (q * 73856093) ^ (r * 19349663); a = Math.imul(a ^ (a >>> 15), 2246822519); return ((a ^ (a >>> 13)) >>> 0) / 4294967296; };
// A tile's painted sprite ([x, y, w, h] in the atlas), or null for the drawn one.
export function paintPicker(map, today) {
  const season = paintSeason(today);
  if (!season) return null;
  return (t) => {
    const set = PAINT_SETS[paintSet(map, t.terrain)];
    if (!set) return null;
    const list = PAINT_FALLBACK[season].map((s) => set[s]).find((l) => l?.length);
    return list ? list[Math.floor(tileHash(t.q, t.r) * list.length)] : null;
  };
}
// One sprite out of the atlas: an inner <svg> whose viewBox is the sprite's box, so only it shows.
function paintedSvg([ax, ay, aw, ah], x, y, owned) {
  const w = (S * SQ3 * 1.01 * aw) / PAINT_BASE, hh = (w * ah) / aw;
  return `<polygon points="${pts(corners(x, y))}" fill="transparent"/>`
    + `<svg x="${(x - w / 2).toFixed(1)}" y="${(y + S * BOTTOM + DEPTH - hh).toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}" viewBox="${ax} ${ay} ${aw} ${ah}" preserveAspectRatio="none" overflow="hidden"><image href="icons/terrain.webp" width="${PAINT_SIZE[0]}" height="${PAINT_SIZE[1]}"/></svg>`
    + (owned ? '' : `<polygon points="${pts(corners(x, y))}" fill="#e8dab1" opacity=".3"/>`);
}

// A landmark painted on its own hex: drawn so its hex is a tile wide, standing where the tile does.
function landmarkSvg({ src, w: aw, h: ah, b }, x, y, owned) {
  // `b` is its hex's width in its pixels (dev/build-landmarks.py); older files drew the hex full width.
  const w = (S * SQ3 * 1.01 * aw) / (b > 0 ? b : aw), hh = (w * ah) / aw;
  return `<polygon points="${pts(corners(x, y))}" fill="transparent"/>`
    + `<image href="${src}" x="${(x - w / 2).toFixed(1)}" y="${(y + S * BOTTOM + DEPTH - hh).toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}"/>`
    + (owned ? '' : `<polygon points="${pts(corners(x, y))}" fill="#e8dab1" opacity=".3"/>`);
}

// The land as SVG. `world` adds the sea, the coasts and the pins; `picks` glow to claim, `targets` to
// build on; `fresh` rise in. `id` keeps clip paths unique on the page.
export function mapSvg(state, map, { today, world = false, picks = new Set(), targets = new Set(), fresh = new Set(), id = 'm', others = [], backdrop = true, painted = true, strip = false } = {}) {
  const L = lookups(map);
  const season = seasonOf(today);
  const paint = painted ? paintPicker(map, today) : null;
  const snowy = ['winter', 'late'].includes(paintSeason(today));
  const vis = state.visible;
  const camps = new Map(state.camps.map((c) => [key(c.q, c.r), c]));
  const builtAt = new Map(Object.entries(state.built).map(([b, k]) => [k, b]));
  const w = S * Math.sqrt(3), hh = 2 * ROW;
  const fogHex = (x, y) => `<polygon points="${pts(corners(x, y, S))}" fill="none" stroke="#cdb98a" stroke-width=".9"/>`;
  let defs = `<pattern id="${id}-fog" width="${w.toFixed(3)}" height="${hh.toFixed(3)}" patternUnits="userSpaceOnUse"><rect width="${w.toFixed(3)}" height="${hh.toFixed(3)}" fill="#e8dab1"/>${fogHex(0, 0)}${fogHex(w, 0)}${fogHex(w / 2, hh / 2)}${fogHex(0, hh)}${fogHex(w, hh)}</pattern>`
    + `<filter id="${id}-glow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.2"/></filter>`;
  let back = '', farPins = '';
  if (world) {
    const P = (u) => fromUnits(u).map((n) => n.toFixed(1)).join(' ');
    const ring = (rings) => (rings ?? []).map((r) => 'M' + r.map(P).join('L') + 'Z').join('');
    const europe = ring(map.europe), coast = ring(map.coast);
    defs += `<pattern id="${id}-sea" width="46" height="26" patternUnits="userSpaceOnUse"><rect width="46" height="26" fill="#2f6f8a"/><path d="M6 14 q5 -4 10 0 q5 4 10 0" fill="none" stroke="#4a8aa4" stroke-width="1.3"/></pattern>`;
    back = `<rect x="-40000" y="-40000" width="80000" height="80000" fill="url(#${id}-sea)"/>`
      + `<path d="${europe}" fill="none" stroke="#86c3cf" stroke-width="40" stroke-linejoin="round" opacity=".55"/><path d="${europe}" fill="url(#${id}-fog)" stroke="#8a7652" stroke-width="3"/>`
      + `<path d="${coast}" fill="none" stroke="#86c3cf" stroke-width="26" stroke-linejoin="round" opacity=".55"/><path d="${coast}" fill="url(#${id}-fog)" stroke="#8a7652" stroke-width="2.5"/>`

    // The other cities' land, as it stands, where they are: to look at, not to play.
    back += others.map((o) => `<g transform="translate(${o.at[0].toFixed(1)} ${o.at[1].toFixed(1)})" pointer-events="none">${mapSvg(o.state, o.map, { today, id: `${id}-o-${o.map.id}`, backdrop: false, painted })}</g>`).join('');
    // Zoomed out, a city's land is a speck: every place gets a pin that keeps one size on the screen
    // (showView) and goes once you're close.
    const places = (map.pins ?? []).filter((p) => !others.some((o) => o.pin === p.name)).map((p) => [...fromUnits(p.at), p.name, p.sub]);
    farPins = [[0, 0, map.name, `${state.owned.size} tiles · you're here`], ...others.map((o) => [o.at[0], o.at[1], o.map.name, `${o.state.owned.size} tiles`]), ...places]
      .map(([x, y, name, sub]) => `<g class="map-far" data-at="${x.toFixed(1)} ${y.toFixed(1)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(40)">${pinSvg(0, 0, name, sub, 1)}</g>`).join('');
  } else if (backdrop) {
    back = `<rect x="-40000" y="-40000" width="80000" height="80000" fill="url(#${id}-fog)"/>`;
  }
  let fog = '', ground = '', sprites = '', glow = '', clips = '';
  const sorted = [...L.tiles.values()].sort((a, b) => (a.r - b.r) || (a.q - b.q));
  for (const t of sorted) {
    const k = key(t.q, t.r), [x, y] = centre(t.q, t.r), site = L.at.get(k);
    if (!vis.has(k)) {
      if (site?.kind === 'wonder') fog += `<g data-k="${k}"><polygon points="${pts(corners(x, y))}" fill="transparent"/>${starSvg(x, y, false)}</g>`;
      else if (camps.has(k)) fog += smokeSvg(x, y, '#7a4a3a');
      continue;
    }
    const owned = state.owned.has(k), b = builtAt.get(k), fr = fresh.has(k) ? ' class="fresh"' : '';
    let top = k === '0,0' ? CENTRE_TOP : seasonTop(TERRAIN[t.terrain]?.top ?? '#9cc35a', season, t.terrain);
    if (b) top = PLAZA[L.byId.get(b).track] ?? top;
    if (state.pillaged.has(k)) top = mix(top, '#7a3a2a', 0.35);
    const clip = `${id}-c${t.q + 500}_${t.r + 500}`;
    clips += clipSvg(clip, x, y);
    // Painted ground (js/map/terrain-atlas.js) where there is some for this terrain and time of year;
    // a built tile keeps its track's plaza, and a camp or a raid its drawn ground.
    // A painted landmark (the map file's `paint`) is the whole tile: a building placed here, a wonder
    // built, a place found, or the centre.
    const markId = b ?? (site && (site.kind !== 'wonder' || state.wonders.has(site.id)) ? site.id : k === '0,0' ? 'centre' : null);
    const pm = painted && markId && !camps.has(k) && !state.pillaged.has(k) ? map.paint?.[markId] : null;
    // Under snow from first snow to the thaw, where it was painted that way.
    const mark = pm && snowy ? map.paintWinter?.[markId] ?? pm : pm;
    const art = !mark && !b && !camps.has(k) && !state.pillaged.has(k) ? paint?.(t) : null;
    ground += `<g data-k="${k}"${fr}>${mark ? landmarkSvg(mark, x, y, owned) : art ? paintedSvg(art, x, y, owned) : groundSvg(x, y, top, { faded: !owned })}</g>`;
    const deco = () => (art ? '' : decoSvg(t.terrain, x, y, { q: t.q, r: t.r, season, clip }));
    let sp;
    if (mark) sp = b ? levelSvg(state.levels[b] ?? 1, x, y) : '';
    else if (camps.has(k)) sp = campSvg(x, y + 4);
    else if (b) sp = artImage(map, b, x, y + 7, placeScale(map, b)) + levelSvg(state.levels[b] ?? 1, x, y);
    else if (site?.kind === 'wonder') sp = state.wonders.has(site.id) ? artImage(map, site.id, x, y + 7, placeScale(map, site.id)) : deco() + starSvg(x, y - 2, owned);
    else if (site) sp = artImage(map, site.id, x, y + 7, placeScale(map, site.id)) || deco();
    else if (k === '0,0') sp = artImage(map, 'centre', x, y + 7, map.centreScale ?? 0.5);
    else sp = deco() + (t.find && !state.claimedFinds.has(k) ? (painted ? paintedFindSvg : findSvg)(t.find, x + 9, y + 4) : '');
    if (state.pillaged.has(k)) sp += smokeSvg(x, y);
    sprites += `<g${fr}>${sp}</g>`;
    if (picks.has(k)) glow += `<polygon points="${pts(corners(x, y, S * 0.88))}" fill="rgba(243,210,126,.34)" stroke="#ffd866" stroke-width="2.6"/><g class="map-pick">${plusSvg(x, y)}</g>`;
    if (targets.has(k)) glow += `<polygon points="${pts(corners(x, y, S * 0.88))}" fill="rgba(255,255,255,.32)" stroke="#ffffff" stroke-width="3"/><g class="map-pick">${plusSvg(x, y, '#ffffff')}</g>`;
  }
  // Zones he has seen, not yet built: a faint dashed edge in the track's colour.
  let zones = '';
  for (const bld of L.builds) {
    if (!state.zonesSeen.has(bld.id) || state.built[bld.id]) continue;
    const z = L.zones[bld.id];
    let edge = '';
    for (const k of z) {
      if (!vis.has(k)) continue;
      const [q, r] = unkey(k), [x, y] = centre(q, r), c = corners(x, y, S * 0.9);
      DIRS.forEach(([a, b], i) => { const n = key(q + a, r + b); if (!z.has(n) || !vis.has(n)) edge += `M${c[i][0].toFixed(1)} ${c[i][1].toFixed(1)}L${c[(i + 1) % 6][0].toFixed(1)} ${c[(i + 1) % 6][1].toFixed(1)}`; });
    }
    if (edge) zones += `<path d="${edge}" stroke="${TRACK_COLOUR[bld.track] ?? '#ffffff'}" stroke-width="2" stroke-dasharray="4 3" fill="none"/>`;
  }
  // Rivers and railways, only where he can see.
  const P = (u) => fromUnits(u).map((n) => n.toFixed(1)).join(' ');
  const line = (kind) => (map.lines ?? []).filter((l) => l.kind === kind).flatMap((l) => l.segs).map((s) => 'M' + s.map(P).join('L')).join('');
  const visClip = [...vis].map((k) => { const [x, y] = centre(...unkey(k)); return `<polygon points="${pts(corners(x, y, S))}"/>`; }).join('');
  const river = line('river'), rail = line('rail');
  // The stream: faint, in the painted lakes' colours (icy in winter), so the land under it still shows.
  const ps = paintSeason(today);
  const [water, glint] = ps === 'winter' ? ['#b9d4e0', '#ffffff'] : ps === 'late' ? ['#6f9cb6', '#e4f1f6'] : ['#3a7fb0', '#a9d6ee'];
  const lines = `<g clip-path="url(#${id}-vis)" fill="none" stroke-linecap="round" stroke-linejoin="round"><g opacity=".55"><path d="${river}" stroke="${water}" stroke-width="2.2"/><path d="${river}" stroke="${glint}" stroke-width=".5" stroke-dasharray="2 9"/></g><g opacity=".32"><path d="${rail}" stroke="#5a4a3c" stroke-width="1"/><path d="${rail}" stroke="#5a4a3c" stroke-width="3" stroke-dasharray=".8 2.6"/></g></g>`;
  const roads = roadSvg(state.roads.map(([a, b]) => [centre(...unkey(a)), centre(...unkey(b))]));
  let border = '';
  for (const k of state.owned) {
    const [q, r] = unkey(k), [x, y] = centre(q, r), c = corners(x, y, S * 0.93);
    DIRS.forEach(([a, b], i) => { if (!state.owned.has(key(q + a, r + b))) border += `M${c[i][0].toFixed(1)} ${c[i][1].toFixed(1)}L${c[(i + 1) % 6][0].toFixed(1)} ${c[(i + 1) % 6][1].toFixed(1)}`; });
  }
  const gold = state.golden.on ? '#ffd866' : '#e2b85c';
  const [cx, cy] = centre(0, 0);
  // Everything over the tiles lets a tap through to the tile underneath.
  // The header's horizon (horizonSvg): the land and what stands on it, none of the game's marks.
  if (strip) return `<defs>${defs}${clips}<clipPath id="${id}-vis">${visClip}</clipPath></defs>${ground}<g pointer-events="none">${lines}${roads}${sprites}</g>`;
  return `<defs>${defs}${clips}<clipPath id="${id}-vis">${visClip}</clipPath></defs>${back}${fog}${ground}<g pointer-events="none">${lines}${roads}${zones}`
    + `<path d="${border}" stroke="${gold}" stroke-width="${state.golden.on ? 7 : 5}" opacity=".45" filter="url(#${id}-glow)" fill="none"/><path d="${border}" stroke="${state.golden.on ? '#ffe9a0' : '#f3d27e'}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
    + `${sprites}${glow}${bannerSvg(map.name, state.owned.size, cx, cy - 62, state.golden.on)}${farPins}</g>`;
}

// The box round some tiles, as a 16:9 viewBox.
function boxAround(keys, pad = S * 4.5, ar = 16 / 9) {
  const p = [...keys].map((k) => centre(...unkey(k)));
  let [x0, y0, x1, y1] = [Math.min(...p.map((a) => a[0])) - pad, Math.min(...p.map((a) => a[1])) - pad - 40, Math.max(...p.map((a) => a[0])) + pad, Math.max(...p.map((a) => a[1])) + pad];
  return fit([x0, y0, x1, y1], ar);
}
function fit([x0, y0, x1, y1], ar = 16 / 9) {
  let w = x1 - x0, hgt = y1 - y0;
  if (w / hgt > ar) hgt = w / ar; else w = hgt * ar;
  return [(x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - hgt / 2, w, hgt];
}
// How far the board can zoom: in to a few tiles, out to Europe (or a wide ring round the land when
// the map has no Europe view); and it can't be dragged off that. Pure.
export function viewLimits(europe, land, ar) {
  const [x, y, w, hh] = europe ?? [land[0] - land[2] * 2.5, land[1] - land[3] * 2.5, land[2] * 6, land[3] * 6];
  return { minW: S * 7, maxW: w, bounds: [x, y, x + w, y + hh], ar };
}
export function clampView(v, lim) {
  if (!lim) return v;
  let [x, y, w, hh] = v;
  const ar = w / hh;
  const nw = Math.max(lim.minW, Math.min(lim.maxW, w));
  if (nw !== w) { const cx = x + w / 2, cy = y + hh / 2; w = nw; hh = nw / ar; x = cx - w / 2; y = cy - hh / 2; }
  const [bx0, by0, bx1, by1] = lim.bounds;
  // The view's centre stays over the bounds.
  const cx = Math.max(bx0, Math.min(bx1, x + w / 2)), cy = Math.max(by0, Math.min(by1, y + hh / 2));
  return [cx - w / 2, cy - hh / 2, w, hh];
}

// Closer than this (in board units across), the far pins go.
export const NEAR_WIDTH = 3000;
function showView(svg, v) {
  svg.setAttribute('viewBox', v.map((n) => n.toFixed(1)).join(' '));
  const near = v[2] < NEAR_WIDTH;
  svg.classList.toggle('near', near);
  // Far pins stay the same size on the screen, however far out.
  if (near) return;
  const scale = (0.75 * v[2]) / (svg.clientWidth || 360);
  for (const g of svg.querySelectorAll('.map-far')) g.setAttribute('transform', `translate(${g.dataset.at}) scale(${scale.toFixed(2)})`);
}

function svgEl(viewBox, inner, cls) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', viewBox.map((n) => n.toFixed(1)).join(' '));
  svg.setAttribute('class', cls);
  svg.setAttribute('role', 'img');
  svg.innerHTML = inner;
  return svg;
}

// ---- the tile ----

function readSeen() { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } }
function writeSeen(day) { try { localStorage.setItem(SEEN_KEY, day); } catch { /* this device only */ } }

// The city as the header's horizon (js/ui/sky.js): the tiles he owns in the three rows through the
// middle, painted for the season, nothing of the game on them. A string and its width over its height,
// or null with no map; worked out again only when the land or the day changes.
let horizonCache = { key: null, out: null };
export function horizonSvg(ctx) {
  const got = stateFor(ctx);
  if (!got) return null;
  const { map, state, today } = got;
  const k = `${cached.key}|${today}`;
  if (horizonCache.key === k) return horizonCache.out;
  const band = new Set([...state.owned].filter((t) => { const r = unkey(t)[1]; return r >= -1 && r <= 1; }));
  if (band.size < 3) { horizonCache = { key: k, out: null }; return null; }
  const at = [...band].map((t) => centre(...unkey(t)));
  const x0 = Math.min(...at.map((p) => p[0])) - S, x1 = Math.max(...at.map((p) => p[0])) + S;
  const y0 = Math.min(...at.map((p) => p[1])) - S * 2.2, y1 = Math.max(...at.map((p) => p[1])) + S * BOTTOM + DEPTH + 2;
  const inner = mapSvg({ ...state, visible: band, owned: band, camps: [] }, map, { today, id: 'hz', backdrop: false, strip: true });
  const out = { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0.toFixed(1)} ${y0.toFixed(1)} ${(x1 - x0).toFixed(1)} ${(y1 - y0).toFixed(1)}" preserveAspectRatio="xMidYMax meet">${inner}</svg>`, ratio: (x1 - x0) / (y1 - y0) };
  horizonCache = { key: k, out };
  return out;
}

export function renderMapTile(ctx) {
  const got = stateFor(ctx);
  if (!got) return null;
  const { map, state, today } = got;
  const seen = readSeen();
  // The morning turn: the first time this device shows a new day, yesterday plays out once.
  const morning = seen !== today && state.last;
  const prev = morning ? new Set(state.history.at(-2)?.owned ?? []) : null;
  const fresh = morning ? new Set([...state.owned].filter((k) => !prev.has(k))) : new Set();
  if (morning) setTimeout(() => writeSeen(today), 0);
  const pic = svgEl(boxAround(state.visible, S * 2.5), mapSvg(state, map, { today, fresh, id: 'mt' }), 'map-pic');
  const ham = h('b', { class: 'map-ham' }, `${state.pool}`);
  if (morning && state.last.hammers) countUp(ham, state.pool);
  const lines = tileLines(state, map, dayPoints(ctx.store.doc(), today, map));
  const yesterday = state.last ? morningLine(state.last) : null;
  return h('div', { class: 'map-tile' },
    h('p', { class: 'tile-hero' }, h('span', { class: 'tile-num' }, String(state.owned.size)), h('span', { class: 'tile-cap' }, `tiles of ${map.name}`)),
    h('button', { class: 'map-pic-btn', type: 'button', 'aria-label': `Open the map of ${map.name}`, onclick: () => ctx.openMap?.() }, pic),
    h('div', { class: 'map-next' }, h('span', {}, 'Next tile '), ham, h('span', {}, ` / ${state.cost}`),
      h('span', { class: 'map-bar' }, h('i', { style: `width:${Math.min(100, (state.pool / state.cost) * 100)}%` }))),
    lines.length ? h('ul', { class: 'map-lines' }, lines.map((l) => h('li', {}, l))) : null,
    yesterday ? h('p', { class: `map-morning${morning ? ' fresh-line' : ''}` }, yesterday) : null);
}

function countUp(el, to) {
  if (typeof requestAnimationFrame !== 'function' || matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const t0 = performance.now();
  const step = (now) => { const t = Math.min(1, (now - t0) / 1200); el.textContent = String(Math.round(to * t)); if (t < 1) requestAnimationFrame(step); };
  el.textContent = '0';
  requestAnimationFrame(step);
}

// ---- the big view ----

export function renderMapBig(ctx) {
  const got = stateFor(ctx);
  if (!got) return null;
  const { map, state, today } = got;
  const ui = ctx.ui.map ??= { view: null, zoom: 'land', armed: null };
  if (ui.armed && !state.cards.some((c) => c.kind === ui.armed.kind && (c.kind === 'wonder' || c.id === ui.armed.id))) ui.armed = null;
  const picks = !ui.armed && state.ready > 0 ? new Set(claimable(state)) : new Set();
  const targets = ui.armed ? new Set(placeable(state, ui.armed)) : new Set();
  // The board's shape on this screen (styles/daylight.css: full width, at most 62% of the height).
  const ar = typeof innerWidth === 'number' ? Math.max(0.6, Math.min(2.2, Math.min(innerWidth - 40, 1100) / Math.min(innerHeight * 0.62, 640))) : 16 / 9;
  const views = {
    land: () => boxAround(state.visible, S * (ar < 1 ? 2.5 : 4.5), ar),
    england: map.view?.england ? () => fit([...fromUnits(map.view.england.slice(0, 2)), ...fromUnits(map.view.england.slice(2))], ar) : null,
    country: map.view?.country ? () => fit([...fromUnits(map.view.country.slice(0, 2)), ...fromUnits(map.view.country.slice(2))], ar) : null,
    europe: map.view?.europe ? () => fit([...fromUnits(map.view.europe.slice(0, 2)), ...fromUnits(map.view.europe.slice(2))], ar) : null,
  };
  const others = othersFor(ctx, map, today);
  // Each other city gets a button that flies there.
  const cityViews = Object.fromEntries(others.map((o) => [`city:${o.map.id}`, () => {
    const [x, y, w, hgt] = boxAround(o.state.visible, S * (ar < 1 ? 2.5 : 4.5), ar);
    return [x + o.at[0], y + o.at[1], w, hgt];
  }]));
  const limits = viewLimits(views.europe?.(), views.land(), ar);
  ui.view = clampView(ui.view ?? views.land(), limits);
  const svg = svgEl(ui.view, mapSvg(state, map, { today, world: true, picks, targets, id: 'mb', others }), 'map-board');
  showView(svg, ui.view);
  const tip = h('div', { class: 'map-tip', role: 'status' });
  const box = h('div', { class: 'map-box' }, svg, tip,
    h('p', { class: 'map-hint' }, ui.armed ? 'Pick a glowing tile to build on' : state.ready ? `Pick a glowing tile to claim (${state.ready} waiting)` : 'Finish your day to earn more tiles'));
  wireBoard(ctx, svg, tip, { map, state, today, picks, targets, limits });

  const L = lookups(map);
  const track = (tr, def) => {
    const next = def.list.find(([id]) => !state.earned.has(id));
    const prevNeed = next ? (def.list[def.list.indexOf(next) - 1]?.[1] ?? 0) : null;
    const pts2 = state.track[tr] ?? 0;
    const [label, pct] = next
      ? [`${def.name}: ${pts2} / ${next[1]} → ${L.byId.get(next[0])?.name}`, ((pts2 - prevNeed) / (next[1] - prevNeed)) * 100]
      : [`${def.name}: levelling up, ${(pts2 - (def.list.at(-1)?.[1] ?? 0)) % LEVEL_STEP} / ${LEVEL_STEP}`, (((pts2 - (def.list.at(-1)?.[1] ?? 0)) % LEVEL_STEP) / LEVEL_STEP) * 100];
    return h('div', { class: 'map-track', style: `--track:${TRACK_COLOUR[tr] ?? '#999'}` }, h('span', {}, label), h('span', { class: 'map-bar' }, h('i', { style: `width:${Math.max(0, Math.min(100, pct))}%` })));
  };
  const hud = h('div', { class: 'map-hud' },
    chapterLabel(map, state) ? h('span', { class: 'map-chip' }, chapterLabel(map, state)) : null,
    h('span', { class: 'map-chip' }, `Turn ${state.turn}`),
    h('span', { class: 'map-chip' }, `${state.owned.size} tiles`),
    h('span', { class: `map-chip${state.ready ? ' gold' : ''}` }, `${state.ready} to claim`),
    h('span', { class: 'map-chip' }, `Next tile ${state.pool} / ${state.cost}`),
    state.golden.on ? h('span', { class: 'map-chip gold' }, `Golden age · ${state.golden.run} days`) : null,
    state.camps.length ? h('span', { class: 'map-chip danger' }, `${plural(state.camps.length, 'barbarian camp')}`) : null);
  const tracks = h('div', { class: 'map-tracks' }, Object.entries(map.tracks ?? {}).map(([tr, def]) => track(tr, def)));
  const cards = h('div', { class: 'map-cards' }, state.cards.length ? state.cards.map((c) => {
    const ok = placeable(state, c).length > 0;
    const name = c.kind === 'wonder' ? 'A wonder' : L.byId.get(c.id)?.name;
    const pressed = ui.armed && ui.armed.kind === c.kind && (c.kind === 'wonder' || ui.armed.id === c.id);
    const art = c.kind === 'wonder' ? svgEl([-12, -12, 24, 24], starSvg(0, 0, true), 'map-card-art') : (map.paint?.[c.id] ? h('img', { class: 'map-card-art', alt: '', src: map.paint[c.id].src }) : map.art?.[c.id] ? h('img', { class: 'map-card-art', alt: '', src: artHref(map.art[c.id]) }) : null);
    return h('button', { class: 'map-card', type: 'button', 'aria-pressed': String(!!pressed), disabled: !ok,
      onclick: () => { ui.armed = pressed ? null : c; ctx.render(); } },
    art, h('span', {}, h('b', {}, name), h('small', {}, ok ? (pressed ? 'Now pick a glowing tile' : 'Tap, then pick a tile') : c.kind === 'wonder' ? 'Reach a wonder site first' : 'Reach its zone first')));
  }) : h('p', { class: 'muted' }, 'No cards yet. Each track earns buildings; a goal step earns a wonder.'));
  const cityName = Object.fromEntries(others.map((o) => [`city:${o.map.id}`, o.map.name]));
  const zoom = h('div', { class: 'map-zoom' }, Object.entries({ ...views, ...cityViews }).filter(([, f]) => f).map(([name, f]) =>
    h('button', { class: 'dl-btn', type: 'button', 'aria-pressed': String(ui.zoom === name),
      onclick: (e) => {
        ui.zoom = name;
        for (const b of e.currentTarget.parentElement.querySelectorAll('[aria-pressed]')) b.setAttribute('aria-pressed', String(b === e.currentTarget));
        animateView(ctx, svg, clampView(f(), limits));
      } }, name === 'land' ? map.name : cityName[name] ?? map.viewNames?.[name] ?? { england: 'England', country: 'Country', europe: 'Europe' }[name])),
  h('button', { class: 'dl-btn', type: 'button', onclick: () => playHistory(ctx, svg, { map, state, today, others }) }, 'Watch it grow'));
  return h('div', { class: 'map-big' }, hud, box, zoom, pointsSection(ctx.store.doc(), today, map), h('h3', {}, 'Cards'), cards, tracks, chronicle(state));
}

// Today's checklist (js/map/points.js): every row that counts, what it's worth, and whether it's in.
const POINT_MARK = { earned: '✓', open: '○', optional: '·', pushed: '↷', missed: '✗', released: '–' };
const POINT_STATE = { earned: 'Earned', open: 'Still to do: a miss if not', optional: 'Optional today', pushed: 'Pushed: not counted today', missed: 'A miss', released: 'No longer needed' };
export function pointsSection(doc, today, map) {
  const p = dayPoints(doc, today, map);
  const head = `+${p.earned} so far${p.toEarn ? ` · +${p.toEarn} still to earn` : ''}`;
  const bonus = p.bonus.earned ? `Day finished: +${p.bonus.amount} bonus`
    : p.bonus.possible ? `Finish all ${p.total} for +${p.bonus.amount} (${p.bonus.left} to go)` : 'Fewer than 3 rows count today, so no finished-day bonus';
  return h('section', { class: 'map-points' },
    h('h3', {}, "Today's points"),
    h('p', { class: 'map-points-head' }, h('b', {}, head), h('span', { class: `map-chip${p.bonus.earned ? ' gold' : ''}` }, bonus)),
    h('ul', {}, p.rows.map((r) => h('li', { class: `pt pt-${r.state}`, style: r.track ? `--track:${TRACK_COLOUR[r.track] ?? 'transparent'}` : null, title: POINT_STATE[r.state] },
      h('span', { class: 'pt-mark', 'aria-label': POINT_STATE[r.state] }, POINT_MARK[r.state]),
      h('span', { class: 'pt-title' }, r.title, r.note ? h('small', {}, r.note) : null),
      h('span', { class: 'pt-ham' }, r.hammers ? `+${r.hammers}` : '0')))),
    h('p', { class: 'muted' }, `An hour or more planned is worth 20, anything shorter 10. ${p.cardio.minutes ? `Cardio today: ${p.cardio.minutes} minutes, a road step per ${p.cardio.perStep}. ` : 'Cardio builds roads, a step per 10 minutes. '}Weekly targets don't count; a goal step earns a wonder card.`));
}

function chronicle(state) {
  const entries = [...state.chronicle].reverse().slice(0, 80);
  if (!entries.length) return h('section', { class: 'map-chronicle' }, h('h3', {}, 'Chronicle'), h('p', { class: 'muted' }, 'Your first turn is settled tomorrow.'));
  return h('section', { class: 'map-chronicle' }, h('h3', {}, 'Chronicle'),
    h('ol', {}, entries.map((e) => h('li', {},
      h('b', {}, `Turn ${e.turn} · ${shortDate(e.day)}`),
      h('span', {}, ` ${e.done} of ${e.total} done, +${e.hammers}${e.golden ? ' · golden age' : ''}`),
      e.events.length ? h('span', { class: 'muted' }, `. ${e.events.map((x) => x.text).join('. ')}.`) : null,
      e.quote ? h('q', {}, e.quote) : null))));
}

// Drag to look around, wheel or pinch to zoom, tap to claim or build, hover to read a tile.
function wireBoard(ctx, svg, tip, { map, state, today, picks, targets, limits }) {
  const ui = ctx.ui.map;
  let drag = null;
  const touches = new Map();
  let pinch = null;
  const view = () => ui.view;
  const set = (v) => { ui.view = clampView(v, limits); showView(svg, ui.view); };
  const twoFingers = () => {
    const [a, b] = [...touches.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  svg.addEventListener('pointerdown', (e) => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      // A second finger: pinch from here, and the first finger's drag (and tap) is over.
      pinch = { ...twoFingers(), v: [...view()] };
      drag = { moved: true };
      for (const id of touches.keys()) { try { svg.setPointerCapture?.(id); } catch { /* a finger already gone */ } }
      return;
    }
    if (touches.size > 2) return;
    drag = { x: e.clientX, y: e.clientY, v: [...view()], moved: false };
  });
  const lift = (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
  svg.addEventListener('pointercancel', (e) => { lift(e); if (!touches.size) drag = null; });
  svg.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size >= 2) {
      // The point under the fingers' first midpoint follows them; the spread sets the zoom.
      const t = twoFingers(), r = svg.getBoundingClientRect(), v = pinch.v, f = pinch.d / t.d;
      const mx = v[0] + ((pinch.x - r.left) / r.width) * v[2], my = v[1] + ((pinch.y - r.top) / r.height) * v[3];
      const w = v[2] * f, hh = v[3] * f;
      set([mx - ((t.x - r.left) / r.width) * w, my - ((t.y - r.top) / r.height) * hh, w, hh]);
      return;
    }
    if (!drag) { if (e.pointerType === 'mouse') showTip(e); return; }
    if (drag.x === undefined) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) { drag.moved = true; svg.setPointerCapture?.(e.pointerId); }
    if (!drag.moved) return;
    const k = view()[2] / svg.clientWidth;
    set([drag.v[0] - (e.clientX - drag.x) * k, drag.v[1] - (e.clientY - drag.y) * k, view()[2], view()[3]]);
  });
  svg.addEventListener('pointerup', (e) => {
    lift(e);
    // Until the last finger is up nothing is a tap.
    if (touches.size) { if (drag) drag.moved = true; return; }
    const moved = drag?.moved;
    drag = null;
    if (moved) return;
    const k = e.target.closest?.('[data-k]')?.getAttribute('data-k');
    if (!k) return;
    const [q, r] = unkey(k);
    const at = new Date().toISOString();
    if (ui.armed && targets.has(k)) {
      const site = lookups(map).at.get(k);
      const card = ui.armed.kind === 'wonder' ? site.id : ui.armed.id;
      ui.armed = null;
      ctx.store.putGame(`place:${map.id}:${card}`, { city: map.id, card, q, r, day: today, at });
      return;
    }
    if (picks.has(k)) { ctx.store.putGame(`claim:${map.id}:${k}`, { city: map.id, q, r, day: today, at }); return; }
    showTip(e, true);
  });
  svg.addEventListener('pointerleave', () => { tip.classList.remove('show'); });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const v = view(), f = e.deltaY > 0 ? 1.15 : 1 / 1.15, r = svg.getBoundingClientRect();
    if ((f > 1 && v[2] >= limits.maxW) || (f < 1 && v[2] <= limits.minW)) return;
    const mx = v[0] + ((e.clientX - r.left) / r.width) * v[2], my = v[1] + ((e.clientY - r.top) / r.height) * v[3];
    set([mx - (mx - v[0]) * f, my - (my - v[1]) * f, v[2] * f, v[3] * f]);
  }, { passive: false });
  function showTip(e, hold = false) {
    const k = e.target.closest?.('[data-k]')?.getAttribute('data-k');
    const d = k ? describeTile(state, map, k) : null;
    if (!d) { tip.classList.remove('show'); return; }
    tip.replaceChildren(h('b', {}, d[0]), ...d[1].map((l) => h('span', {}, l)));
    const box = svg.getBoundingClientRect();
    tip.style.left = `${Math.min(box.width - 240, e.clientX - box.left + 14)}px`;
    tip.style.top = `${e.clientY - box.top + 14}px`;
    tip.classList.add('show');
    if (hold) { clearTimeout(showTip.t); showTip.t = setTimeout(() => tip.classList.remove('show'), 2200); }
  }
}

function animateView(ctx, svg, to) {
  const ui = ctx.ui.map, from = ui.view ?? to, t0 = performance.now();
  const reduce = matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const step = (now) => {
    const t = reduce ? 1 : Math.min(1, (now - t0) / 600), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    ui.view = from.map((a, i) => a + (to[i] - a) * e);
    showView(svg, ui.view);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// The time-lapse: the era from the first turn, a tenth of a second a turn.
function playHistory(ctx, svg, { map, state, today, others = [] }) {
  const frames = state.history ?? [];
  if (!frames.length) return;
  clearInterval(ctx.ui.map.playing);
  let i = 0;
  ctx.ui.map.playing = setInterval(() => {
    if (!svg.isConnected || i >= frames.length) { clearInterval(ctx.ui.map.playing); ctx.ui.map.playing = null; if (svg.isConnected) ctx.render(); return; }
    const f = frames[i++];
    const owned = new Set(f.owned);
    const frame = {
      ...state, owned, visible: visibleOf(map, owned), built: f.built, levels: f.levels, wonders: new Set(f.wonders), camps: f.camps,
      pillaged: new Set(f.pillaged), roads: f.roads, golden: { on: f.golden, run: 0 }, found: new Set(f.found), claimedFinds: new Set(f.claimedFinds),
    };
    svg.innerHTML = mapSvg(frame, map, { today: f.day, world: true, id: 'mb', others });
  }, 110);
}
