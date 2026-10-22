// The map (docs/superpowers/specs/2026-10-22-civ-map-design.md): a Daylight tile with a picture of
// the land and its headline numbers, a morning turn that plays yesterday out once per device, and the
// big view where George claims tiles, places cards, reads the chronicle and watches the era grow.
// The state comes from js/map/engine.js's replay; his choices are written as `game` records.

import { h } from './dom.js';
import { replay, claimable, placeable, makeCityOf, lookups, visibleOf, FIND_NAME, FIND_VALUE, REPAIR, LEVEL_STEP } from '../map/engine.js';
import { key, unkey, DIRS } from '../map/hex.js';
import {
  S, centre, fromUnits, corners, pts, TERRAIN, CENTRE_TOP, PLAZA, TRACK_COLOUR, seasonOf, seasonTop, groundSvg, clipSvg,
  decoSvg, findSvg, campSvg, smokeSvg, starSvg, plusSvg, levelSvg, roadSvg, bannerSvg, pinSvg, mix,
} from './map-art.js';
import { addDays, shortDate } from '../dates.js';

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
  if (t.find && !state.claimedFinds.has(k)) lines.push(`${FIND_NAME[t.find] ?? 'A find'}: +${map.finds?.[t.find] ?? FIND_VALUE[t.find] ?? 10} hammers when you claim it`);
  if (state.pillaged.has(k)) lines.push(`Raided: the next ${REPAIR} hammers repair it`);
  const camp = state.camps.find((c) => key(c.q, c.r) === k);
  if (camp) lines.push(`Barbarians, heading for ${L.byId.get(camp.target)?.name ?? 'the centre'}`);
  if (!special && !lines.length) return null;
  return [title, lines];
}

export function tileLines(state, map) {
  const L = lookups(map);
  const out = [];
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

// The land as SVG. `world` adds the sea, the coasts and the pins; `picks` glow to claim, `targets` to
// build on; `fresh` rise in. `id` keeps clip paths unique on the page.
export function mapSvg(state, map, { today, world = false, picks = new Set(), targets = new Set(), fresh = new Set(), id = 'm' } = {}) {
  const L = lookups(map);
  const season = seasonOf(today);
  const vis = state.visible;
  const camps = new Map(state.camps.map((c) => [key(c.q, c.r), c]));
  const builtAt = new Map(Object.entries(state.built).map(([b, k]) => [k, b]));
  const w = S * Math.sqrt(3), hh = 3 * S * 0.74;
  const fogHex = (x, y) => `<polygon points="${pts(corners(x, y, S))}" fill="none" stroke="#cdb98a" stroke-width=".9"/>`;
  let defs = `<pattern id="${id}-fog" width="${w.toFixed(3)}" height="${hh.toFixed(3)}" patternUnits="userSpaceOnUse"><rect width="${w.toFixed(3)}" height="${hh.toFixed(3)}" fill="#e8dab1"/>${fogHex(0, 0)}${fogHex(w, 0)}${fogHex(w / 2, hh / 2)}${fogHex(0, hh)}${fogHex(w, hh)}</pattern>`
    + `<filter id="${id}-glow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.2"/></filter>`;
  let back = '';
  if (world) {
    const P = (u) => fromUnits(u).map((n) => n.toFixed(1)).join(' ');
    const ring = (rings) => (rings ?? []).map((r) => 'M' + r.map(P).join('L') + 'Z').join('');
    const europe = ring(map.europe), coast = ring(map.coast);
    defs += `<pattern id="${id}-sea" width="46" height="26" patternUnits="userSpaceOnUse"><rect width="46" height="26" fill="#2f6f8a"/><path d="M6 14 q5 -4 10 0 q5 4 10 0" fill="none" stroke="#4a8aa4" stroke-width="1.3"/></pattern>`;
    back = `<rect x="-40000" y="-40000" width="80000" height="80000" fill="url(#${id}-sea)"/>`
      + `<path d="${europe}" fill="none" stroke="#86c3cf" stroke-width="40" stroke-linejoin="round" opacity=".55"/><path d="${europe}" fill="url(#${id}-fog)" stroke="#8a7652" stroke-width="3"/>`
      + `<path d="${coast}" fill="none" stroke="#86c3cf" stroke-width="26" stroke-linejoin="round" opacity=".55"/><path d="${coast}" fill="url(#${id}-fog)" stroke="#8a7652" stroke-width="2.5"/>`
      + (map.pins ?? []).map((p) => { const [x, y] = fromUnits(p.at); return pinSvg(x, y, p.name, p.sub, p.scale ?? 3); }).join('');
  } else {
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
    ground += `<g data-k="${k}"${fr}>${groundSvg(x, y, top, { faded: !owned })}</g>`;
    let sp;
    if (camps.has(k)) sp = campSvg(x, y + 4);
    else if (b) sp = artImage(map, b, x, y + 7, placeScale(map, b)) + levelSvg(state.levels[b] ?? 1, x, y);
    else if (site?.kind === 'wonder') sp = state.wonders.has(site.id) ? artImage(map, site.id, x, y + 7, placeScale(map, site.id)) : decoSvg(t.terrain, x, y, { q: t.q, r: t.r, season, clip }) + starSvg(x, y - 2, owned);
    else if (site) sp = artImage(map, site.id, x, y + 7, placeScale(map, site.id)) || decoSvg(t.terrain, x, y, { q: t.q, r: t.r, season, clip });
    else if (k === '0,0') sp = artImage(map, 'centre', x, y + 7, map.centreScale ?? 0.5);
    else sp = decoSvg(t.terrain, x, y, { q: t.q, r: t.r, season, clip }) + (t.find && !state.claimedFinds.has(k) ? findSvg(t.find, x + 9, y + 4) : '');
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
  const lines = `<g clip-path="url(#${id}-vis)" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${river}" stroke="#3f97c4" stroke-width="3.6"/><path d="${river}" stroke="#8fd2ec" stroke-width="1.1"/><g opacity=".32"><path d="${rail}" stroke="#5a4a3c" stroke-width="1"/><path d="${rail}" stroke="#5a4a3c" stroke-width="3" stroke-dasharray=".8 2.6"/></g></g>`;
  const roads = roadSvg(state.roads.map(([a, b]) => [centre(...unkey(a)), centre(...unkey(b))]));
  let border = '';
  for (const k of state.owned) {
    const [q, r] = unkey(k), [x, y] = centre(q, r), c = corners(x, y, S * 0.93);
    DIRS.forEach(([a, b], i) => { if (!state.owned.has(key(q + a, r + b))) border += `M${c[i][0].toFixed(1)} ${c[i][1].toFixed(1)}L${c[(i + 1) % 6][0].toFixed(1)} ${c[(i + 1) % 6][1].toFixed(1)}`; });
  }
  const gold = state.golden.on ? '#ffd866' : '#e2b85c';
  const [cx, cy] = centre(0, 0);
  // Everything over the tiles lets a tap through to the tile underneath.
  return `<defs>${defs}${clips}<clipPath id="${id}-vis">${visClip}</clipPath></defs>${back}${fog}${ground}<g pointer-events="none">${lines}${roads}${zones}`
    + `<path d="${border}" stroke="${gold}" stroke-width="${state.golden.on ? 7 : 5}" opacity=".45" filter="url(#${id}-glow)" fill="none"/><path d="${border}" stroke="${state.golden.on ? '#ffe9a0' : '#f3d27e'}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
    + `${sprites}${glow}${bannerSvg(map.name, state.owned.size, cx, cy - 62, state.golden.on)}</g>`;
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
  const lines = tileLines(state, map);
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
    europe: map.view?.europe ? () => fit([...fromUnits(map.view.europe.slice(0, 2)), ...fromUnits(map.view.europe.slice(2))], ar) : null,
  };
  ui.view ??= views.land();
  const svg = svgEl(ui.view, mapSvg(state, map, { today, world: true, picks, targets, id: 'mb' }), 'map-board');
  const tip = h('div', { class: 'map-tip', role: 'status' });
  const box = h('div', { class: 'map-box' }, svg, tip,
    h('p', { class: 'map-hint' }, ui.armed ? 'Pick a glowing tile to build on' : state.ready ? `Pick a glowing tile to claim (${state.ready} waiting)` : 'Finish your day to earn more tiles'));
  wireBoard(ctx, svg, tip, { map, state, today, picks, targets });

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
    const art = c.kind === 'wonder' ? svgEl([-12, -12, 24, 24], starSvg(0, 0, true), 'map-card-art') : (map.art?.[c.id] ? h('img', { class: 'map-card-art', alt: '', src: artHref(map.art[c.id]) }) : null);
    return h('button', { class: 'map-card', type: 'button', 'aria-pressed': String(!!pressed), disabled: !ok,
      onclick: () => { ui.armed = pressed ? null : c; ctx.render(); } },
    art, h('span', {}, h('b', {}, name), h('small', {}, ok ? (pressed ? 'Now pick a glowing tile' : 'Tap, then pick a tile') : c.kind === 'wonder' ? 'Reach a wonder site first' : 'Reach its zone first')));
  }) : h('p', { class: 'muted' }, 'No cards yet. Hebrew, the gym and reading earn buildings; a goal step earns a wonder.'));
  const zoom = h('div', { class: 'map-zoom' }, Object.entries(views).filter(([, f]) => f).map(([name, f]) =>
    h('button', { class: 'dl-btn', type: 'button', 'aria-pressed': String(ui.zoom === name),
      onclick: (e) => {
        ui.zoom = name;
        for (const b of e.currentTarget.parentElement.querySelectorAll('[aria-pressed]')) b.setAttribute('aria-pressed', String(b === e.currentTarget));
        animateView(ctx, svg, f());
      } }, name === 'land' ? map.name : name === 'england' ? 'England' : 'Europe')),
  h('button', { class: 'dl-btn', type: 'button', onclick: () => playHistory(ctx, svg, { map, state, today }) }, 'Watch it grow'));
  return h('div', { class: 'map-big' }, hud, box, zoom, h('h3', {}, 'Cards'), cards, tracks, chronicle(state));
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

// Drag to look around, wheel to zoom, tap to claim or build, hover to read a tile.
function wireBoard(ctx, svg, tip, { map, state, today, picks, targets }) {
  const ui = ctx.ui.map;
  let drag = null;
  const view = () => ui.view;
  const set = (v) => { ui.view = v; svg.setAttribute('viewBox', v.map((n) => n.toFixed(1)).join(' ')); };
  svg.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, v: [...view()], moved: false }; });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) { if (e.pointerType === 'mouse') showTip(e); return; }
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) { drag.moved = true; svg.setPointerCapture?.(e.pointerId); }
    if (!drag.moved) return;
    const k = view()[2] / svg.clientWidth;
    set([drag.v[0] - (e.clientX - drag.x) * k, drag.v[1] - (e.clientY - drag.y) * k, view()[2], view()[3]]);
  });
  svg.addEventListener('pointerup', (e) => {
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
    svg.setAttribute('viewBox', ui.view.map((n) => n.toFixed(1)).join(' '));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// The time-lapse: the era from the first turn, a tenth of a second a turn.
function playHistory(ctx, svg, { map, state, today }) {
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
    svg.innerHTML = mapSvg(frame, map, { today: f.day, world: true, id: 'mb' });
  }, 110);
}
