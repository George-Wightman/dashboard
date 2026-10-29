// Builds a city's map file for the map (docs/superpowers/specs/2026-10-22-civ-map-design.md) from a
// private places file, a private drawings module and OpenStreetMap. Run on the laptop:
//
//   node dev/build-map.mjs <places.json> <art.mjs> <out.json> [osm cache] [coastline cache]
//
// The places file says where the city and its places are, and how the land should reach out to them;
// the drawings module exports { art: { [placeId]: () => '<svg …>' } }. Nothing personal lives here:
// the inputs and the result belong in the private sync repo's map/ folder.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [placesPath, artPath, outPath, osmPath = 'map-osm.json', landPath = 'land-50m.json'] = process.argv.slice(2);
if (!placesPath || !artPath || !outPath) {
  console.error('Usage: node dev/build-map.mjs <places.json> <art.mjs> <out.json> [osm cache] [coastline cache]');
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(placesPath, 'utf8'));
const { art } = await import(pathToFileURL(artPath).href);

// ---- scales ----
const C = cfg.centre;
const mPerLat = 111320, mPerLon = 111320 * Math.cos(C.lat * Math.PI / 180);
const toM = (lat, lon) => [(lon - C.lon) * mPerLon, (C.lat - lat) * mPerLat];
// The land: true to scale at `kmPerTile`, with the middle opened out by `openOut` tiles.
const KM = cfg.kmPerTile ?? 1, OPEN = cfg.openOut ?? 1.4;
const tilesAt = (d) => d / 1000 / KM + OPEN * (1 - Math.exp(-d / 350));
const local = ([x, y]) => { const d = Math.hypot(x, y); if (!d) return [0, 0]; const t = tilesAt(d); return [x / d * t, y / d * t]; };
const unlocal = ([u, v]) => { const t = Math.hypot(u, v); if (!t) return [0, 0]; let lo = 0, hi = 80000; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (tilesAt(m) < t) lo = m; else hi = m; } return [u / t * lo, v / t * lo]; };
// The world around it: a plain scale, so England and Europe look like themselves.
const WORLD_KM = cfg.worldKmPerTile ?? 3;
const world = ([x, y]) => [x / 1000 / WORLD_KM, y / 1000 / WORLD_KM];

// ---- hexes ----
const SQ3 = Math.sqrt(3), size = 1 / SQ3;
function hexOf([u, v]) {
  const q = (SQ3 / 3 * u - v / 3) / size, r = (2 / 3 * v) / size, s = -q - r;
  let rq = Math.round(q), rr = Math.round(r); const rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}
const unitOf = (q, r) => [q + r / 2, r * 1.5 * size];
const hd = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[0] + a[1] - b[0] - b[1]));
const key = (q, r) => `${q},${r}`;
function rng(seed) { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hash = (q, r, s = 0) => rng((q * 73856093) ^ (r * 19349663) ^ (s * 83492791))();

// ---- places: each on its own tile, a clear tile apart unless they're real neighbours ----
const taken = new Map([[key(0, 0), 'centre']]);
const near = new Set((cfg.neighbours ?? []).flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
const places = [];
for (const p of cfg.places) {
  const u = local(toM(p.lat, p.lon)), want = hexOf(u);
  const base = { id: p.id, name: p.name, kind: p.kind, ...(p.note ? { note: p.note } : {}), ...(p.track ? { track: p.track } : {}), ...(p.scale ? { scale: p.scale } : {}) };
  if (p.kind === 'build') { places.push({ ...base, q: want[0], r: want[1] }); continue; }
  let best = null;
  for (let rad = 0; rad < 6 && !best; rad++) {
    const ring = [];
    for (let dq = -rad; dq <= rad; dq++) for (let dr = -rad; dr <= rad; dr++) if (hd([0, 0], [dq, dr]) === rad) ring.push([want[0] + dq, want[1] + dr]);
    ring.sort((a, b) => Math.hypot(...unitOf(...a).map((v, i) => v - u[i])) - Math.hypot(...unitOf(...b).map((v, i) => v - u[i])));
    best = ring.find((h) => !taken.has(key(...h)) && !(p.kind === 'wonder' && hd(h, [0, 0]) < 3)
      && (p.kind !== 'found' || [...taken].every(([k2, id2]) => { const [a, b] = k2.split(',').map(Number); return hd(h, [a, b]) >= 2 || near.has(`${p.id}|${id2}`); })));
  }
  taken.set(key(...best), p.id);
  places.push({ ...base, q: best[0], r: best[1] });
}

// ---- the land: a lumpy disc with a lobe out to every place ----
const tiles = new Map();
const wobble = (a) => 1.6 * Math.sin(a * 3 + 1.3) + 1.1 * Math.sin(a * 5 + 4.1) + 0.7 * Math.sin(a * 7 + 2.2);
const anchors = places.map((p) => { const [u, v] = unitOf(p.q, p.r); return { a: Math.atan2(v, u), d: Math.hypot(u, v) + (p.kind === 'wonder' ? 3 : 2) }; });
const R = Math.ceil(Math.max(...anchors.map((a) => a.d)) + 4);
for (let q = -2 * R; q <= 2 * R; q++) for (let r = -2 * R; r <= 2 * R; r++) {
  const [u, v] = unitOf(q, r), a = Math.atan2(v, u), d = Math.hypot(u, v);
  let env = (cfg.landRadius ?? 8.5) + wobble(a);
  for (const an of anchors) { const da = Math.abs(((a - an.a) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI); env = Math.max(env, an.d * Math.max(0, Math.cos(Math.min(da * 2.2, Math.PI / 2)))); }
  if (d <= env) tiles.set(key(q, r), { q, r });
}
for (let pass = 0; pass < 3; pass++) {
  const cand = new Map();
  for (const t of tiles.values()) for (const [a, b] of [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]) { const k = key(t.q + a, t.r + b); if (!tiles.has(k)) cand.set(k, (cand.get(k) ?? 0) + 1); }
  for (const [k, n] of cand) if (n >= 3) { const [q, r] = k.split(',').map(Number); tiles.set(k, { q, r }); }
}

// ---- OpenStreetMap: land use for the ground, rivers and railways ----
let bbox = cfg.osmBox;
if (!bbox) {
  const lats = cfg.places.map((p) => p.lat).concat(C.lat), lons = cfg.places.map((p) => p.lon).concat(C.lon);
  bbox = [Math.min(...lats) - 0.03, Math.min(...lons) - 0.05, Math.max(...lats) + 0.03, Math.max(...lons) + 0.05];
}
let osm;
if (existsSync(osmPath)) osm = JSON.parse(readFileSync(osmPath, 'utf8'));
else {
  const [S, W, N, E] = bbox, b = `${S},${W},${N},${E}`;
  const q = `[out:json][timeout:180];(way["landuse"](${b});relation["landuse"](${b});way["natural"~"wood|water|heath|scrub"](${b});relation["natural"~"wood|water"](${b});way["leisure"~"park|golf_course|nature_reserve|pitch|recreation_ground"](${b});way["waterway"="river"](${b});way["railway"="rail"](${b});${cfg.mountains ? `node["natural"="peak"](${b});way["natural"~"bare_rock|scree|cliff"](${b});` : ''});out geom;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'User-Agent': 'dashboard-map-builder' } });
  osm = await res.json();
  writeFileSync(osmPath, JSON.stringify(osm));
}
function category(t) {
  if (['bare_rock', 'scree', 'cliff'].includes(t.natural)) return 'mountain';
  if (t.natural === 'water' || t.landuse === 'reservoir' || t.landuse === 'basin') return 'water';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'forest';
  if (['industrial', 'quarry', 'landfill', 'brownfield'].includes(t.landuse)) return 'industry';
  if (t.landuse === 'retail' || t.landuse === 'commercial') return 'shops';
  if (t.landuse === 'residential') return 'town';
  if (t.leisure || ['grass', 'recreation_ground', 'cemetery', 'allotments'].includes(t.landuse)) return 'park';
  if (['farmland', 'farmyard', 'orchard'].includes(t.landuse)) return 'farm';
  if (t.landuse === 'meadow' || t.natural === 'heath' || t.natural === 'scrub') return 'meadow';
  return null;
}
const RANK = ['water', 'mountain', 'forest', 'industry', 'shops', 'town', 'park', 'farm', 'meadow'];
const areas = [], lines = [], peaks = [];
for (const el of osm.elements ?? []) {
  const t = el.tags ?? {};
  if (el.type === 'node') { if (t.natural === 'peak') peaks.push({ at: toM(el.lat, el.lon), ele: parseFloat(t.ele) || 0 }); continue; }
  let segs = [];
  if (el.type === 'way' && el.geometry) segs = [el.geometry.map((p) => toM(p.lat, p.lon))];
  else if (el.type === 'relation') segs = (el.members ?? []).filter((m) => m.geometry && m.role !== 'inner').map((m) => m.geometry.map((p) => toM(p.lat, p.lon)));
  if (!segs.length) continue;
  if (t.waterway || t.railway) { lines.push({ kind: t.waterway ? 'river' : 'rail', segs }); continue; }
  const cat = category(t); if (!cat) continue;
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of segs) for (const [x, y] of s) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
  areas.push({ cat, segs, box: b });
}
function inside(a, x, y) {
  if (x < a.box[0] || x > a.box[2] || y < a.box[1] || y > a.box[3]) return false;
  let c = false;
  for (const s of a.segs) for (let i = 0, j = s.length - 1; i < s.length; j = i++) {
    const [xi, yi] = s[i], [xj, yj] = s[j];
    if (i === 0 && (xi !== xj || yi !== yj)) continue;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const catAt = (x, y) => { let best = null; for (const a of areas) if (inside(a, x, y) && (best === null || RANK.indexOf(a.cat) < RANK.indexOf(best))) best = a.cat; return best; };
const [bx0, by0] = toM(bbox[2], bbox[1]), [bx1, by1] = toM(bbox[0], bbox[3]);
const smooth = (q, r) => { const [u, v] = unitOf(q, r); return Math.sin(u * 0.55 + 1.7) * Math.cos(v * 0.62 - 0.4) + 0.6 * Math.sin(u * 1.3 - v * 0.9 + 2.1); };
const forestSide = cfg.forestSide ?? null; // e.g. { u: 6 } thickens forest east of u = 6
for (const t of tiles.values()) {
  const [x, y] = unlocal(unitOf(t.q, t.r)), d = hd([t.q, t.r], [0, 0]), h = hash(t.q, t.r, 1);
  let cat = x > bx0 && x < bx1 && y > by0 && y < by1 ? catAt(x, y) : null;
  if (!cat) cat = h < 0.38 ? 'farm' : h < 0.62 ? 'meadow' : h < 0.8 ? 'forest' : h < 0.93 ? 'hills' : 'town';
  if (cat === 'town' && d > 3 && h < 0.45) cat = h < 0.2 ? 'meadow' : h < 0.32 ? 'farm' : 'park';
  if (cat === 'shops' && d > 2) cat = 'town';
  if (['meadow', 'farm'].includes(cat) && smooth(t.q, t.r) > 0.95) cat = 'hills';
  if (forestSide && unitOf(t.q, t.r)[0] > forestSide.u && hash(t.q, t.r, 2) < 0.5 && !['water', 'town'].includes(cat)) cat = 'forest';
  // Peaks (cfg.mountains): high ones make mountain round them, lower ones hills.
  if (cat !== 'water') for (const pk of peaks) {
    const near = Math.hypot(x - pk.at[0], y - pk.at[1]);
    if (pk.ele >= (cfg.mountainEle ?? 900) && near < (cfg.peakReach ?? 700)) cat = 'mountain';
    else if (pk.ele >= 450 && near < 350 && cat !== 'mountain') cat = 'hills';
  }
  t.terrain = cat;
}
for (const p of cfg.places) if (p.terrain) { const pl = places.find((x) => x.id === p.id); const t = tiles.get(key(pl.q, pl.r)); if (t) t.terrain = p.terrain; }
const FIND_DEFAULT = { forest: ['deer', 'deer', 'stone'], farm: ['wheat', 'wheat', 'horses'], meadow: ['sheep', 'sheep', 'horses'], hills: ['coal', 'stone', 'sheep'], town: ['pub', 'pub', 'pitwheel'], industry: ['coal', 'pitwheel'], water: ['fish'], park: [], shops: [] };
const FIND = { ...FIND_DEFAULT, ...(cfg.findsByTerrain ?? {}) };
for (const t of tiles.values()) {
  if (taken.has(key(t.q, t.r)) || hd([t.q, t.r], [0, 0]) <= 1) continue;
  let list = FIND[t.terrain] ?? [];
  if (cfg.coalSide && unitOf(t.q, t.r)[0] > cfg.coalSide.u && ['hills', 'meadow', 'industry'].includes(t.terrain) && hash(t.q, t.r, 4) < 0.5) list = ['coal'];
  if (list.length && hash(t.q, t.r, 3) < (cfg.findRate ?? 0.1)) t.find = list[Math.floor(hash(t.q, t.r, 5) * list.length)];
}
const thin = (s) => { const out = [s[0]]; for (const p of s) { const l = out[out.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 60) out.push(p); } out.push(s[s.length - 1]); return out; };
const outLines = lines.map((l) => ({ kind: l.kind, segs: l.segs.map((s) => thin(s).map((p) => local(p).map((n) => +n.toFixed(2)))).filter((s) => s.length > 1) })).filter((l) => l.segs.length);

// ---- coasts: the home island in detail, the rest of Europe simpler ----
let land;
if (existsSync(landPath)) land = JSON.parse(readFileSync(landPath, 'utf8'));
else {
  land = await (await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-50m.json')).json();
  writeFileSync(landPath, JSON.stringify(land));
}
const arcs = land.arcs.map((a) => { let x = 0, y = 0; return a.map(([dx, dy]) => [(x += dx) * land.transform.scale[0] + land.transform.translate[0], (y += dy) * land.transform.scale[1] + land.transform.translate[1]]); });
const ringOf = (idx) => idx.flatMap((i, n) => { const a = i < 0 ? [...arcs[~i]].reverse() : arcs[i]; return n ? a.slice(1) : a; });
function dp(pts, eps) {
  if (pts.length < 3) return pts;
  let idx = 0, max = 0; const [a, b] = [pts[0], pts[pts.length - 1]];
  for (let i = 1; i < pts.length - 1; i++) { const p = pts[i]; const d = Math.abs((b[1] - a[1]) * p[0] - (b[0] - a[0]) * p[1] + b[0] * a[1] - b[1] * a[0]) / (Math.hypot(b[1] - a[1], b[0] - a[0]) || 1); if (d > max) { max = d; idx = i; } }
  return max > eps ? [...dp(pts.slice(0, idx + 1), eps).slice(0, -1), ...dp(pts.slice(idx), eps)] : [a, b];
}
const simplify = (p, eps) => { let far = 0, fd = 0; p.forEach((q, i) => { const d = Math.hypot(q[0] - p[0][0], q[1] - p[0][1]); if (d > fd) { fd = d; far = i; } }); return [...dp(p.slice(0, far + 1), eps).slice(0, -1), ...dp(p.slice(far), eps).slice(0, -1)]; };
const chaikin = (p) => { const out = []; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } return out; };
function clipRing(ring, box) {
  let out = ring;
  const lx = (a, b, x) => [x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])], ly = (a, b, y) => [a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y];
  for (const [ins, cut] of [[(p) => p[0] >= box[0], (a, b) => lx(a, b, box[0])], [(p) => p[0] <= box[2], (a, b) => lx(a, b, box[2])], [(p) => p[1] >= box[1], (a, b) => ly(a, b, box[1])], [(p) => p[1] <= box[3], (a, b) => ly(a, b, box[3])]]) {
    const res = [];
    for (let i = 0; i < out.length; i++) { const cur = out[i], prev = out[(i + out.length - 1) % out.length]; if (ins(cur)) { if (!ins(prev)) res.push(cut(prev, cur)); res.push(cur); } else if (ins(prev)) res.push(cut(prev, cur)); }
    out = res; if (!out.length) break;
  }
  return out;
}
const areaOf = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const x = p[i], y = p[(i + 1) % p.length]; a += x[0] * y[1] - y[0] * x[1]; } return Math.abs(a / 2); };
const home = cfg.homeIsland ?? [-6.5, 49.8, 2, 59]; // lon/lat box of the home island's rings
const coast = [], europe = [];
for (const g of land.objects.land.geometries) for (const poly of (g.type === 'Polygon' ? [g.arcs] : g.arcs)) for (const r of poly) {
  const pts = ringOf(r);
  const isHome = cfg.coast !== false && pts.every(([lon, lat]) => lon > home[0] && lon < home[2] && lat > home[1] && lat < home[3]);
  const clipped = isHome ? pts : clipRing(pts, cfg.europeBox ?? [-13, 41, 24, 63]);
  if (clipped.length < 4) continue;
  let p = clipped.map(([lon, lat]) => world(toM(lat, lon)));
  if (areaOf(p) < (isHome ? 10 : 60)) continue;
  p = isHome ? chaikin(chaikin(simplify(p, 0.9))) : chaikin(simplify(p, 2.2));
  if (p.length > 3) (isHome ? coast : europe).push(p.map((q) => q.map((n) => +n.toFixed(isHome ? 2 : 1))));
}
// Keep the land on its island.
const inRing = (ring, [x, y]) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const main = coast.reduce((a, b) => (b.length > a.length ? b : a), []);
if (cfg.coast !== false && main.length) for (const [k, t] of tiles) if (!inRing(main, unitOf(t.q, t.r))) tiles.delete(k);

const pins = (cfg.pins ?? []).map((p) => ({ name: p.name, sub: p.sub ?? '', at: world(toM(p.lat, p.lon)).map((n) => +n.toFixed(2)), scale: p.scale ?? 3 }));
const view = {};
if (cfg.views?.england) view.england = [...world(toM(cfg.views.england[2], cfg.views.england[1])), ...world(toM(cfg.views.england[0], cfg.views.england[3]))].map((n) => +n.toFixed(1));
if (cfg.views?.country) view.country = [...world(toM(cfg.views.country[2], cfg.views.country[1])), ...world(toM(cfg.views.country[0], cfg.views.country[3]))].map((n) => +n.toFixed(1));
if (cfg.views?.europe) view.europe = [...world(toM(cfg.views.europe[2], cfg.views.europe[1])), ...world(toM(cfg.views.europe[0], cfg.views.europe[3]))].map((n) => +n.toFixed(1));

// ---- drawings: each a standalone SVG, ground at y = 0 ----
const ART_BOX = '-80 -115 160 125';
const drawings = {};
for (const [id, draw] of Object.entries(art)) drawings[id] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ART_BOX}">${draw()}</svg>`;

const out = {
  id: cfg.id, name: cfg.name, place: cfg.place, start: cfg.start, end: cfg.end ?? null, home: cfg.home ?? null,
  centreName: cfg.centreName ?? cfg.name, centreScale: cfg.centreScale ?? 0.5,
  tracks: cfg.tracks, finds: cfg.finds ?? undefined, findNames: cfg.findNames ?? undefined, viewNames: cfg.viewNames ?? undefined,
  tiles: [...tiles.values()], places, lines: outLines, coast, europe, pins, view, art: drawings,
};
const text = JSON.stringify(out);
writeFileSync(outPath, text);
const counts = {}; for (const t of tiles.values()) counts[t.terrain] = (counts[t.terrain] ?? 0) + 1;
console.log(`${cfg.name}: ${tiles.size} tiles, ${places.length} places, ${Object.keys(drawings).length} drawings, ${(text.length / 1024).toFixed(0)} KB`);
console.log(counts);
