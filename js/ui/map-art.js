// The map's generic art (js/ui/map.js): cartoon hex tiles with depth, their decoration, finds,
// barbarian camps, wonder stars, roads, level marks and the city banner, all as SVG strings. The real
// buildings are drawings in the private map file, never here. The land follows the real season:
// autumn colours, snow, blossom. Pure.

export const S = 24;            // a hex's corner radius, in SVG units
export const K = 0.74;          // the board's tilt: vertical squash
export const DEPTH = 6;         // the hex's visible side
export const SQ3 = Math.sqrt(3);

export const centre = (q, r) => [S * SQ3 * (q + r / 2), S * 1.5 * r * K];
export const fromUnits = ([u, v]) => [u * S * SQ3, v * S * SQ3 * K];
export const corners = (x, y, s = S * 0.965) => Array.from({ length: 6 }, (_, i) => {
  const a = Math.PI / 180 * (60 * i - 30);
  return [x + s * Math.cos(a), y + s * Math.sin(a) * K];
});
export const pts = (c) => c.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
const n1 = (v) => v.toFixed(1);

// ---- colour ----
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => v + (B[i] - v) * t)); };
export const dark = (c, t = 0.3) => mix(c, '#000000', t);

export function seasonOf(day) {
  const m = Number(String(day).slice(5, 7));
  if (m >= 9 && m <= 11) return 'autumn';
  if (m === 12 || m <= 2) return 'winter';
  if (m >= 3 && m <= 5) return 'spring';
  return 'summer';
}

export const TERRAIN = {
  meadow: { name: 'Grassland', top: '#9cc35a' },
  farm: { name: 'Farmland', top: '#cdbf62' },
  forest: { name: 'Forest', top: '#5a9443' },
  hills: { name: 'Hills', top: '#a8c066' },
  park: { name: 'Park', top: '#8fd06a' },
  water: { name: 'Lake', top: '#4ea7d2' },
  town: { name: 'Town', top: '#b9c48e' },
  shops: { name: 'Market', top: '#d3c3a4' },
  industry: { name: 'Works', top: '#aeaa9d' },
};
export const CENTRE_TOP = '#d8c9a4';
export const PLAZA = { learning: '#b4c8dc', sport: '#cfa595', culture: '#c5b1d2' };
export const TRACK_COLOUR = { learning: '#7fb0e6', sport: '#e48a7c', culture: '#c09ad8' };
export const SNOW = '#eef3f6';

export function seasonTop(top, season, terrain = '') {
  if (terrain === 'water') return season === 'winter' ? mix(top, '#cfe6ef', 0.35) : top;
  if (season === 'winter') return mix(top, SNOW, 0.55);
  if (season === 'autumn' && ['meadow', 'park', 'hills', 'forest'].includes(terrain)) return mix(top, '#c9a54a', 0.22);
  if (season === 'spring' && ['meadow', 'park', 'hills'].includes(terrain)) return mix(top, '#a6e06a', 0.15);
  return top;
}

const CANOPY = {
  summer: ['#3f7d36', '#5c9e45', '#86c25e'],
  autumn: ['#b0582a', '#d98b2b', '#f2bf55'],
  winter: ['#6f7d6a', '#b9c4bd', '#ffffff'],
  spring: ['#4f9440', '#6fb556', '#a9d96f'],
};

// A seeded random, so a tile always looks the same.
export function rng(q, r) {
  let a = (q * 73856093) ^ (r * 19349663) ^ 0x5bd1e995;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function scatter(rand, n, spread = 0.5) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * spread * S; out.push([Math.cos(a) * d, Math.sin(a) * d * K]); }
  return out.sort((a, b) => a[1] - b[1]);
}

// ---- pieces ----
export function tree(x, y, sc = 1, season = 'summer') {
  const [c1, c2, c3] = CANOPY[season];
  let g = `<ellipse cx="${n1(x + 1)}" cy="${n1(y)}" rx="${4 * sc}" ry="${1.6 * sc}" fill="rgba(0,0,0,.22)"/>`
    + `<rect x="${n1(x - 0.8 * sc)}" y="${n1(y - 4 * sc)}" width="${1.6 * sc}" height="${4 * sc}" fill="#6b4a2b"/>`
    + `<circle cx="${n1(x)}" cy="${n1(y - 7.5 * sc)}" r="${4.6 * sc}" fill="${c1}"/>`
    + `<circle cx="${n1(x - 1.3 * sc)}" cy="${n1(y - 8.8 * sc)}" r="${2.8 * sc}" fill="${c2}"/>`
    + `<circle cx="${n1(x - 2 * sc)}" cy="${n1(y - 9.8 * sc)}" r="${1.1 * sc}" fill="${c3}"/>`;
  if (season === 'spring') g += [[1.6, -8], [-2.6, -6.4], [0.4, -10.6]].map(([dx, dy]) => `<circle cx="${n1(x + dx * sc)}" cy="${n1(y + dy * sc)}" r="${0.9 * sc}" fill="#f5b7cf"/>`).join('');
  return g;
}
export function pine(x, y, sc = 1, season = 'summer') {
  const a = season === 'winter' ? '#3c6a4a' : '#2f6a3b', b = season === 'winter' ? '#4b7d58' : '#3b8048';
  let g = `<ellipse cx="${n1(x + 1)}" cy="${n1(y)}" rx="${3.4 * sc}" ry="${1.4 * sc}" fill="rgba(0,0,0,.22)"/>`
    + `<rect x="${n1(x - 0.7 * sc)}" y="${n1(y - 3 * sc)}" width="${1.4 * sc}" height="${3 * sc}" fill="#5c3f25"/>`
    + `<polygon points="${n1(x - 4 * sc)},${n1(y - 2.5 * sc)} ${n1(x)},${n1(y - 10 * sc)} ${n1(x + 4 * sc)},${n1(y - 2.5 * sc)}" fill="${a}"/>`
    + `<polygon points="${n1(x - 3.2 * sc)},${n1(y - 7 * sc)} ${n1(x)},${n1(y - 14 * sc)} ${n1(x + 3.2 * sc)},${n1(y - 7 * sc)}" fill="${b}"/>`;
  if (season === 'winter') g += `<polygon points="${n1(x - 1.6 * sc)},${n1(y - 10.5 * sc)} ${n1(x)},${n1(y - 14 * sc)} ${n1(x + 1.6 * sc)},${n1(y - 10.5 * sc)}" fill="${SNOW}"/>`;
  return g;
}
export function house(x, y, sc = 1, roof = '#c4553f', wall = '#efe1c4', season = 'summer') {
  const X = (v) => n1(x + v * sc), Y = (v) => n1(y + v * sc), r = season === 'winter' ? SNOW : roof;
  return `<ellipse cx="${X(2)}" cy="${Y(0)}" rx="${7 * sc}" ry="${2 * sc}" fill="rgba(0,0,0,.2)"/>`
    + `<rect x="${X(-4)}" y="${Y(-6)}" width="${8 * sc}" height="${6 * sc}" fill="${wall}"/>`
    + `<polygon points="${X(4)},${Y(0)} ${X(8)},${Y(-2.5)} ${X(8)},${Y(-8.5)} ${X(4)},${Y(-6)}" fill="${dark(wall, 0.22)}"/>`
    + `<polygon points="${X(-4.6)},${Y(-6)} ${X(0)},${Y(-10.5)} ${X(4.6)},${Y(-6)}" fill="${dark(wall, 0.08)}"/>`
    + `<polygon points="${X(0)},${Y(-10.5)} ${X(4.6)},${Y(-6)} ${X(8.6)},${Y(-8.5)} ${X(4)},${Y(-13)}" fill="${r}"/>`
    + `<rect x="${X(-1.2)}" y="${Y(-3.6)}" width="${2.4 * sc}" height="${3.6 * sc}" fill="#5b4636"/>`;
}
function church(x, y, sc = 1, season = 'summer') {
  const X = (v) => n1(x + v * sc), Y = (v) => n1(y + v * sc);
  return `<ellipse cx="${X(2)}" cy="${Y(0)}" rx="${8 * sc}" ry="${2 * sc}" fill="rgba(0,0,0,.2)"/><rect x="${X(-6)}" y="${Y(-6)}" width="${9 * sc}" height="${6 * sc}" fill="#d8cdb4"/>`
    + `<polygon points="${X(-6.6)},${Y(-6)} ${X(-1.5)},${Y(-9.5)} ${X(3.6)},${Y(-6)}" fill="${season === 'winter' ? SNOW : '#7a6a5e'}"/>`
    + `<rect x="${X(3)}" y="${Y(-11)}" width="${4 * sc}" height="${11 * sc}" fill="#cfc3a8"/><polygon points="${X(2.6)},${Y(-11)} ${X(5)},${Y(-19)} ${X(7.4)},${Y(-11)}" fill="#6f6a66"/>`;
}
const tuft = (x, y, c = '#6f9a3a') => `<path d="M${n1(x - 2)} ${n1(y)} q1 -3 1.6 0 q.6 -4 1.4 0 q.8 -3 1.4 0" fill="none" stroke="${c}" stroke-width=".9" stroke-linecap="round"/>`;
function shed(x, y, sc = 1) {
  const X = (v) => n1(x + v * sc), Y = (v) => n1(y + v * sc);
  let saw = `M${X(-8)} ${Y(-6)}`;
  for (let i = 0; i < 5; i++) saw += ` l${2.3 * sc} ${-3 * sc} v${3 * sc}`;
  return `<ellipse cx="${X(2)}" cy="${Y(0)}" rx="${10 * sc}" ry="${2.2 * sc}" fill="rgba(0,0,0,.2)"/><rect x="${X(-8)}" y="${Y(-6)}" width="${14 * sc}" height="${6 * sc}" fill="#d7d2c4"/>`
    + `<polygon points="${X(6)},${Y(0)} ${X(10)},${Y(-2.4)} ${X(10)},${Y(-8.4)} ${X(6)},${Y(-6)}" fill="#aaa597"/><path d="${saw} l${2.5 * sc} ${-3 * sc} v${3 * sc} l${4 * sc} ${-2.4 * sc} v${-3 * sc} z" fill="#7e909b"/>`
    + `<rect x="${X(-12)}" y="${Y(-17)}" width="${2.6 * sc}" height="${17 * sc}" fill="#8f5a43"/><circle cx="${X(-10.5)}" cy="${Y(-20)}" r="${2.2 * sc}" fill="#fff" opacity=".7"/>`;
}
function shop(x, y, sc = 1) {
  const X = (v) => n1(x + v * sc), Y = (v) => n1(y + v * sc);
  let stripes = '';
  for (let i = 0; i < 6; i++) stripes += `<polygon points="${X(-8 + i * 2.5)},${Y(-6)} ${X(-5.5 + i * 2.5)},${Y(-6)} ${X(-5 + i * 2.5)},${Y(-3.6)} ${X(-7.5 + i * 2.5)},${Y(-3.6)}" fill="${i % 2 ? '#ffffff' : '#d9534f'}"/>`;
  return `<ellipse cx="${X(2)}" cy="${Y(0)}" rx="${10 * sc}" ry="${2.2 * sc}" fill="rgba(0,0,0,.2)"/><rect x="${X(-7)}" y="${Y(-11)}" width="${14 * sc}" height="${11 * sc}" fill="#ece4d2"/>`
    + `<polygon points="${X(7)},${Y(0)} ${X(10.5)},${Y(-2.2)} ${X(10.5)},${Y(-13.2)} ${X(7)},${Y(-11)}" fill="#c2b8a2"/><polygon points="${X(-7)},${Y(-11)} ${X(7)},${Y(-11)} ${X(10.5)},${Y(-13.2)} ${X(-3.5)},${Y(-13.2)}" fill="#8b7f6c"/>`
    + `<rect x="${X(-5)}" y="${Y(-9.4)}" width="${10 * sc}" height="${2.4 * sc}" fill="#4d6c80"/>${stripes}`;
}

// ---- tiles ----
export function groundSvg(x, y, top, { faded = false } = {}) {
  const c = corners(x, y);
  return `<polygon points="${pts(c.map(([a, b]) => [a, b + DEPTH]))}" fill="${dark(top, 0.32)}"/><polygon points="${pts(c)}" fill="${top}"/>`
    + `<polygon points="${pts(corners(x, y, S * 0.9))}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1"/>`
    + (faded ? `<polygon points="${pts(c)}" fill="#e8dab1" opacity=".28"/>` : '');
}
export function clipSvg(id, x, y) { return `<clipPath id="${id}"><polygon points="${pts(corners(x, y))}"/></clipPath>`; }

// What stands on a tile of plain land. `clip` is the id of the tile's clipPath (farm stripes need it).
export function decoSvg(terrain, x, y, { q = 0, r = 0, season = 'summer', clip = null } = {}) {
  const rand = rng(q, r);
  const roofs = ['#c4553f', '#a74a36', '#6f6a66', '#b8643d'];
  let g = '';
  if (terrain === 'forest') {
    for (const [dx, dy] of scatter(rand, 5, 0.5)) g += rand() < 0.55 ? pine(x + dx, y + dy + 3, 0.9, season) : tree(x + dx, y + dy + 3, 0.85, season);
  } else if (terrain === 'meadow') {
    for (const [dx, dy] of scatter(rand, 3, 0.5)) g += tuft(x + dx, y + dy, season === 'winter' ? '#9fb0a2' : '#6f9a3a');
    if (rand() < 0.3) g += tree(x + (rand() - 0.5) * S * 0.5, y + 3, 0.8, season);
  } else if (terrain === 'hills') {
    for (const [dx, dy, w] of [[-8, 3, 11], [7, -1, 12]]) {
      g += `<path d="M${n1(x + dx - w)} ${n1(y + dy)} q${w} ${-w * 1.1} ${w * 2} 0 z" fill="${season === 'winter' ? '#e4ebee' : '#8daa52'}"/>`
        + `<path d="M${n1(x + dx - w * 0.45)} ${n1(y + dy - w * 0.42)} q${w * 0.45} ${-w * 0.5} ${w * 0.9} 0" fill="none" stroke="${season === 'winter' ? '#ffffff' : '#c3d98a'}" stroke-width="1.4" stroke-linecap="round"/>`;
    }
  } else if (terrain === 'park') {
    g += `<ellipse cx="${n1(x - 5)}" cy="${n1(y + 3)}" rx="6" ry="${n1(6 * K * 0.55)}" fill="${season === 'winter' ? '#cfe6ef' : '#6cc3df'}"/><path d="M${n1(x - 14)} ${n1(y - 4)} q8 6 26 2" fill="none" stroke="#e9dfb8" stroke-width="1.6"/>`
      + tree(x + 6, y + 1, 0.85, season) + tree(x - 8, y - 4, 0.7, season);
  } else if (terrain === 'farm') {
    const ang = rand() * 60 - 30;
    const bands = season === 'winter' ? ['#dfe6e2', '#eef3f6', '#d3dbd5'] : season === 'autumn' ? ['#c99a45', '#dcb76a', '#b98a3e'] : ['#c2b452', '#dccf7c', '#a8b45a'];
    let s = '';
    for (let i = -4; i <= 4; i++) s += `<rect x="${n1(x - 40)}" y="${n1(y + i * 6 - 3)}" width="80" height="6" fill="${bands[(i + 9) % 3]}"/>`;
    g += clip ? `<g clip-path="url(#${clip})"><g transform="rotate(${ang.toFixed(0)} ${n1(x)} ${n1(y)})">${s}</g></g>` : '';
    g += `<path d="M${n1(x - 18)} ${n1(y + 2)} L${n1(x + 18)} ${n1(y - 2)}" stroke="#6d8c3c" stroke-width="1.8" stroke-dasharray="2.5 1"/>`;
    if (rand() < 0.3) g += house(x + 6, y + 4, 0.8, '#8b3a2e', '#d9b88f', season);
  } else if (terrain === 'water') {
    for (let i = 0; i < 3; i++) g += `<path d="M${n1(x - 8 + i * 5)} ${n1(y - 4 + i * 4)} q2 -2 4 0 q2 2 4 0" fill="none" stroke="#b6e2f3" stroke-width="1"/>`;
  } else if (terrain === 'town') {
    scatter(rand, 3, 0.45).forEach(([dx, dy], i) => {
      const pick = rand();
      g += i === 1 && pick < 0.3 ? church(x + dx, y + dy + 3, 0.9, season)
        : i === 2 && pick < 0.45 ? tree(x + dx, y + dy + 3, 0.8, season)
          : house(x + dx, y + dy + 3, 0.85, roofs[Math.floor(rand() * 4)], rand() < 0.5 ? '#efe1c4' : '#e3c39a', season);
    });
  } else if (terrain === 'shops') {
    g += house(x - 9, y - 3, 0.75, '#6f6a66', '#efe1c4', season) + shop(x + 2, y + 5, 1);
  } else if (terrain === 'industry') {
    g += shed(x + 2, y + 4, 1.05);
  }
  return g;
}

// ---- things on tiles ----
export function findSvg(f, x, y) {
  const X = (v) => n1(x + v), Y = (v) => n1(y + v);
  const badge = `<ellipse cx="${X(0)}" cy="${Y(1)}" rx="9" ry="3.4" fill="rgba(0,0,0,.18)"/>`;
  switch (f) {
    case 'coal': return badge + `<polygon points="${X(-7)},${Y(1)} ${X(-4)},${Y(-4)} ${X(0)},${Y(-6)} ${X(4)},${Y(-3)} ${X(7)},${Y(1)}" fill="#2b2b2e"/><polygon points="${X(-3)},${Y(-3)} ${X(0)},${Y(-6)} ${X(2)},${Y(-3)}" fill="#55575c"/><path d="M${X(3)} ${Y(-11)} l7 7 M${X(1)} ${Y(-8)} q4 -5 8 -1" stroke="#7a5634" stroke-width="1.6" fill="none"/>`;
    case 'wheat': return badge + [-4, 0, 4].map((d) => `<path d="M${X(d)} ${Y(1)} v-9" stroke="#b08a2e" stroke-width="1"/><ellipse cx="${X(d)}" cy="${Y(-9)}" rx="1.8" ry="3.6" fill="#e9bf4a"/>`).join('');
    case 'sheep': return badge + [[-4, 0], [4, -2]].map(([a, b]) => `<ellipse cx="${X(a)}" cy="${Y(b - 3)}" rx="4" ry="3" fill="#f6f4ee"/><circle cx="${X(a + 3.6)}" cy="${Y(b - 4)}" r="1.4" fill="#2b2b2b"/>`).join('');
    case 'deer': case 'horses': {
      const c = f === 'deer' ? '#a0693c' : '#5c3b26';
      return badge + `<ellipse cx="${X(0)}" cy="${Y(-5)}" rx="5" ry="2.6" fill="${c}"/><path d="M${X(-3.5)} ${Y(-3)} v4 M${X(-1.5)} ${Y(-3)} v4 M${X(2)} ${Y(-3)} v4 M${X(3.6)} ${Y(-3)} v4" stroke="${c}" stroke-width="1"/><path d="M${X(4)} ${Y(-6)} l2.6 -4" stroke="${c}" stroke-width="2"/><circle cx="${X(7)}" cy="${Y(-10.6)}" r="1.6" fill="${c}"/>`
        + (f === 'deer' ? `<path d="M${X(6.4)} ${Y(-12)} l-1 -3 M${X(7.8)} ${Y(-12)} l1.6 -2.6" stroke="#6b4a2b" stroke-width=".8"/>` : '');
    }
    case 'pub': return badge + `<rect x="${X(-6)}" y="${Y(-7)}" width="10" height="7" fill="#efe1c4"/><polygon points="${X(-7)},${Y(-7)} ${X(-1)},${Y(-11)} ${X(5)},${Y(-7)}" fill="#7a3a28"/><path d="M${X(5)} ${Y(-8)} h4 v2" stroke="#3d2c25" stroke-width=".8" fill="none"/><rect x="${X(7.4)}" y="${Y(-6)}" width="3.4" height="4" fill="#c0302b"/>`;
    case 'pitwheel': return badge + `<path d="M${X(-6)} ${Y(1)} l6 -14 l6 14" stroke="#7b7d5c" stroke-width="1.6" fill="none"/><circle cx="${X(0)}" cy="${Y(-13)}" r="4" fill="none" stroke="#c9cba6" stroke-width="1.4"/>`;
    case 'stone': return badge + `<polygon points="${X(-7)},${Y(1)} ${X(-5)},${Y(-4)} ${X(-1)},${Y(-5)} ${X(1)},${Y(1)}" fill="#a3a39a"/><polygon points="${X(0)},${Y(1)} ${X(2)},${Y(-6)} ${X(6)},${Y(-4)} ${X(7)},${Y(1)}" fill="#8b8b83"/>`;
    case 'fish': return `<path d="M${X(-5)} ${Y(-3)} q5 -4 9 0 q-4 4 -9 0 z M${X(4)} ${Y(-3)} l4 -3 v6 z" fill="#f2a65a"/>`;
    default: return '';
  }
}
export function campSvg(x, y) {
  const X = (v) => n1(x + v), Y = (v) => n1(y + v);
  return `<ellipse cx="${X(1)}" cy="${Y(1)}" rx="14" ry="3.2" fill="rgba(0,0,0,.25)"/>`
    + `<polygon points="${X(-11)},${Y(0)} ${X(-3)},${Y(-13)} ${X(5)},${Y(0)}" fill="#5a3a2a"/><polygon points="${X(-3)},${Y(-13)} ${X(5)},${Y(0)} ${X(0)},${Y(0)}" fill="#3e271c"/><polygon points="${X(-4.5)},${Y(0)} ${X(-3)},${Y(-6)} ${X(-1.5)},${Y(0)}" fill="#1d120c"/>`
    + `<rect x="${X(8)}" y="${Y(-22)}" width="1.2" height="22" fill="#3e271c"/><path d="M${X(9.2)} ${Y(-22)} h9 l-2.5 3 l2.5 3 h-9 z" fill="#b52a2a"/>`
    + `<path d="M${X(9)} ${Y(1)} q1.5 -5 3 0 z" fill="#f39a2b"/>`;
}
export const smokeSvg = (x, y, colour = '#4a4a4a') => `<path d="M${n1(x - 4)} ${n1(y)} q-4 -8 2 -14 q6 -6 0 -14 M${n1(x + 6)} ${n1(y + 2)} q-3 -6 1 -10" stroke="${colour}" stroke-width="2.4" fill="none" opacity=".55" stroke-linecap="round"/>`;
export function starSvg(x, y, mine = false) {
  const pen = mine ? '#3a2a06' : '#6f5b3c';
  return `<circle cx="${n1(x)}" cy="${n1(y)}" r="${mine ? 10 : 8.5}" fill="${mine ? '#ffd866' : '#efe3c3'}" stroke="${mine ? '#7a5a12' : pen}" stroke-width="1.4"/>`
    + `<path d="M${n1(x)} ${n1(y - 5.5)} l1.6 3.6 l3.9 .4 l-2.9 2.6 l.9 3.8 l-3.5 -2 l-3.5 2 l.9 -3.8 l-2.9 -2.6 l3.9 -.4 z" fill="${pen}"/>`;
}
export function plusSvg(x, y, colour = '#ffd866') {
  return `<circle cx="${n1(x)}" cy="${n1(y - 2)}" r="6" fill="${colour}" stroke="#7a5a12" stroke-width="1.2"/><path d="M${n1(x - 3)} ${n1(y - 2)} h6 M${n1(x)} ${n1(y - 5)} v6" stroke="#3a2a06" stroke-width="2" stroke-linecap="round"/>`;
}
// Level 2: pennants either side; level 3: a gold crown above.
export function levelSvg(level, x, y) {
  if (level < 2) return '';
  let g = [-1, 1].map((s) => `<path d="M${n1(x + s * 15)} ${n1(y + 2)} v-16" stroke="#5b4636" stroke-width="1"/><path d="M${n1(x + s * 15)} ${n1(y - 14)} l${s * 6} 2 l${-s * 6} 2 z" fill="#e2b85c"/>`).join('');
  if (level >= 3) g += `<path d="M${n1(x - 6)} ${n1(y - 30)} l2 -6 l4 4 l4 -4 l2 6 z" fill="#ffd866" stroke="#7a5a12" stroke-width=".8"/>`;
  return g;
}
export function roadSvg(segments) {
  const d = segments.map(([a, b]) => `M${n1(a[0])} ${n1(a[1])}L${n1(b[0])} ${n1(b[1])}`).join('');
  return d ? `<path d="${d}" stroke="#8a6a44" stroke-width="5.5" stroke-linecap="round" opacity=".55" fill="none"/><path d="${d}" stroke="#e7d3a1" stroke-width="3.2" stroke-linecap="round" fill="none"/>` : '';
}
export function bannerSvg(name, count, x, y, golden = false) {
  const safe = String(name).replace(/[<>&"]/g, '');
  const w = Math.max(96, safe.length * 9 + 40);
  return `<g transform="translate(${n1(x)} ${n1(y)})" opacity=".78"><rect x="${-w / 2}" y="-11" width="${w}" height="22" rx="4" fill="#16324a" fill-opacity=".7" stroke="${golden ? '#ffd866' : '#e2b85c'}" stroke-width="${golden ? 2.4 : 1.5}"/>`
    + `<circle cx="${-w / 2 + 12}" cy="0" r="8.5" fill="#e2b85c"/><text x="${-w / 2 + 12}" y="3.6" text-anchor="middle" font-family="Nunito, system-ui, sans-serif" font-weight="800" font-size="9.5" fill="#2a1d05">${Number(count) || 0}</text>`
    + `<text x="10" y="4.5" text-anchor="middle" font-family="Cinzel, Georgia, serif" font-weight="700" font-size="12" letter-spacing="1.5" fill="#eaf0f4">${safe.toUpperCase()}</text></g>`;
}
export function pinSvg(x, y, title, sub, scale = 1) {
  const t = String(title).replace(/[<>&"]/g, ''), s = String(sub ?? '').replace(/[<>&"]/g, '');
  return `<g transform="translate(${n1(x)} ${n1(y)}) scale(${scale})"><path d="M0 0 C-12 -16 -15 -24 -15 -30 a15 15 0 0 1 30 0 c0 6 -3 14 -15 30z" fill="#7d8f9c" stroke="#16324a" stroke-width="2"/><circle cx="0" cy="-30" r="6" fill="#16324a"/>`
    + `<text x="22" y="-26" font-family="Caveat, cursive" font-weight="700" font-size="40" fill="#6f5b3c">${t}</text><text x="22" y="2" font-family="Caveat, cursive" font-weight="700" font-size="26" fill="#8a7652">${s}</text></g>`;
}
