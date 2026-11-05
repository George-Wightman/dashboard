// London (docs/superpowers/specs/2026-11-05-hours-money-london-design.md): where to look for a room. The
// areas are SpareRoom's (median rent, rooms listed, typical walk to the station) with real journeys
// from TfL and neighbourhood counts from OpenStreetMap and police.uk, all built offline by
// dev/build-london.mjs into `london/areas.json` in the private sync repo. Each area gets one monthly
// money figure, "what living here really costs you": rent, bills and travel, plus his commute and
// trips priced at what an hour is worth to him, plus any shortfall against his savings goal, plus or
// minus what the neighbourhood is worth to him. Lower is better, and the parts are the explanation.
// Settings are one synced record. Amounts here are pounds a month. Pure.

export const LONDON_PATH = 'london/areas.json';
export const LONDON_KEY = 'dash_london';
export const SETTINGS_ID = 'london:settings';
export const WORK_DAYS = 21.7;
export const WALK_CAP = 10;
export const NEAR = [
  { id: 'gyms', label: 'Gyms', high: 'lots of gyms nearby' },
  { id: 'green', label: 'Green space', high: 'plenty of parks nearby' },
  { id: 'eat', label: 'Places to eat and drink', high: 'lots of cafés, restaurants and pubs' },
  { id: 'safety', label: 'Safety', high: 'little reported street crime' },
];
export const WEIGHTS = ["Don't care", 'A bit', 'Matters', 'Really matters'];

export const DEFAULTS = Object.freeze({
  year: 0, salaries: [null, null, null], ceilingPct: 50, savings: 300, everythingElse: null,
  hourValue: 10, maxCommute: 45, west: 0.33, mansfieldTrips: 1, salzburgTrips: 1, mansfieldRoute: 'newark',
  trust: 4, cab: 40, stepValue: 25, near: Object.freeze({ gyms: 1, green: 1, eat: 1, safety: 1 }),
});

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const finOrNull = (v) => v == null || fin(v);

export function validLondon(d) {
  if (!d || typeof d !== 'object' || d.v !== 1 || !Array.isArray(d.areas) || !d.areas.length) return false;
  return d.areas.every((a) => a && typeof a.id === 'string' && typeof a.name === 'string' && fin(a.lat) && fin(a.lon)
    && fin(a.rent) && a.rent > 0 && fin(a.allin) && Number.isInteger(a.rooms) && fin(a.walk)
    && a.j && fin(a.j.office) && finOrNull(a.j.kx) && finOrNull(a.j.stp) && (a.j.west == null || (Array.isArray(a.j.west) && a.j.west.every(fin))));
}

// --- Take-home: 2026/27 rules (frozen to 2030), Civil Service pension tiers, Plan 2 loan. ---------------
export function pensionRate(salary) {
  return salary <= 36199 ? 0.046 : salary <= 56000 ? 0.0545 : 0.0735;
}
export function takeHome(salary) {
  if (!fin(salary) || salary <= 0) return null;
  const pen = salary * pensionRate(salary);
  const taxable = salary - pen;
  const tax = Math.max(0, Math.min(taxable, 50270) - 12570) * 0.2 + Math.max(0, taxable - 50270) * 0.4;
  const ni = Math.max(0, Math.min(salary, 50270) - 12570) * 0.08 + Math.max(0, salary - 50270) * 0.02;
  const loan = Math.max(0, salary - 29385) * 0.09;
  return (salary - pen - tax - ni - loan) / 12;
}

// --- Settings ----------------------------------------------------------------------------------------
export function londonSettings(doc, data) {
  const r = doc?.calendar?.[SETTINGS_ID];
  const saved = r?.status === 'active' ? r : {};
  const fileDefaults = data?.defaults ?? {};
  const pick = (k) => (saved[k] ?? fileDefaults[k] ?? DEFAULTS[k]);
  const given = [0, 1, 2].map((i) => (fin(saved.salaries?.[i]) ? saved.salaries[i] : fin(fileDefaults.salaries?.[i]) ? fileDefaults.salaries[i] : null));
  // Years not given are a guess: a 5% rise, then the same rise again.
  const salaries = [...given];
  if (salaries[1] == null && salaries[0] != null) salaries[1] = Math.round((salaries[0] * 1.05) / 100) * 100;
  if (salaries[2] == null && salaries[1] != null) salaries[2] = salaries[1] + (salaries[1] - (salaries[0] ?? salaries[1]));
  const guessed = given.map((v) => v == null);
  return {
    year: [0, 1, 2].includes(saved.year) ? saved.year : 0,
    salaries, guessed,
    ceilingPct: pick('ceilingPct'), savings: pick('savings'), everythingElse: pick('everythingElse') ?? 0,
    hourValue: pick('hourValue'), maxCommute: pick('maxCommute'), west: pick('west'),
    mansfieldTrips: pick('mansfieldTrips'), salzburgTrips: pick('salzburgTrips'),
    mansfieldRoute: ['newark', 'nottingham'].includes(saved.mansfieldRoute) ? saved.mansfieldRoute : 'newark',
    trust: pick('trust'), cab: pick('cab'), stepValue: pick('stepValue'),
    near: { ...DEFAULTS.near, ...(fileDefaults.near ?? {}), ...(saved.near ?? {}) },
  };
}

// --- Ranking -----------------------------------------------------------------------------------------
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs) => (xs.length ? xs.reduce((t, v) => t + v, 0) / xs.length : null);

// A few cheap rooms can't top the list on their own: rent is pulled towards the typical rent of its
// side of London, harder the fewer rooms were listed. `k` is how many rooms' worth of trust the side gets.
export const shrunk = (value, rooms, prior, k) => (prior == null || k <= 0 ? value : (rooms * value + k * prior) / (rooms + k));

// 0 (worst) to 1 (best) by rank among the areas: the area with the most gyms is 1, the fewest 0.
export function rankScores(areas, get, higherIsBetter = true) {
  const vals = areas.map((a) => get(a)).filter(fin);
  const out = new Map();
  if (vals.length < 2) { for (const a of areas) out.set(a.id, 0.5); return out; }
  const sorted = [...vals].sort((x, y) => x - y);
  for (const a of areas) {
    const v = get(a);
    if (!fin(v)) { out.set(a.id, 0.5); continue; }
    const lo = sorted.indexOf(v), hi = sorted.lastIndexOf(v);
    const r = ((lo + hi) / 2) / (sorted.length - 1);
    out.set(a.id, higherIsBetter ? r : 1 - r);
  }
  return out;
}

export function context(data, s) {
  const areas = data.areas;
  const priors = {};
  for (const side of new Set(areas.map((a) => a.side))) priors[side] = median(areas.filter((a) => a.side === side).map((a) => a.allin));
  const near = {
    gyms: rankScores(areas, (a) => a.near?.gyms),
    green: rankScores(areas, (a) => a.near?.green),
    eat: rankScores(areas, (a) => a.near?.eat),
    safety: rankScores(areas, (a) => a.near?.crime, false),
  };
  const salary = s.salaries[s.year];
  return { priors, near, takeHome: takeHome(salary), travelcard: data.travelcard?.monthly ?? 175, rail: data.rail ?? {} };
}

const walkOf = (a) => Math.min(a.walk ?? 0, WALK_CAP);

// Door-to-door minutes, one way.
export function journeys(a, s) {
  const walk = walkOf(a);
  const office = a.j.office + walk;
  const westMean = a.j.west?.length ? mean(a.j.west) + walk : null;
  const weekday = westMean == null ? office : (1 - s.west) * office + s.west * westMean;
  const kx = a.j.kx == null ? null : a.j.kx + walk;
  const stp = a.j.stp == null ? null : a.j.stp + walk;
  return { office, west: westMean, weekday, kx, stp, stansted: a.j.stansted ?? null };
}

export function scoreArea(a, s, ctx) {
  const j = journeys(a, s);
  const rentAllIn = shrunk(a.allin, a.rooms, ctx.priors[a.side], s.trust);
  const bills = a.allin - a.rent;
  const rent = rentAllIn - bills;
  const travel = ctx.travelcard;
  const allIn = rentAllIn + travel;
  const commuteHours = (2 * j.weekday * WORK_DAYS) / 60;
  const commute = commuteHours * s.hourValue;
  const home = s.mansfieldRoute === 'nottingham' ? j.stp : j.kx;
  const tripHours = (home == null ? 0 : (2 * home * s.mansfieldTrips) / 60) + (j.stansted?.mins != null ? (2 * j.stansted.mins * s.salzburgTrips) / 60 : 0);
  const noEarlyFlight = a.j.stansted === null;
  const trips = tripHours * s.hourValue + (noEarlyFlight ? s.cab * s.salzburgTrips : 0);
  const leftover = ctx.takeHome == null ? null : ctx.takeHome - allIn - s.everythingElse;
  const shortfall = leftover == null ? 0 : Math.max(0, s.savings - leftover);
  let near = 0;
  const nearParts = {};
  for (const n of NEAR) {
    const score = ctx.near[n.id].get(a.id) ?? 0.5;
    nearParts[n.id] = score;
    near += (s.near[n.id] ?? 0) * s.stepValue * 2 * (0.5 - score);
  }
  const total = allIn + commute + trips + shortfall + near;
  return {
    total,
    parts: { rent, bills, travel, commute, trips, shortfall, near },
    allIn, leftover, commuteHours, tripHours, journeys: j, nearScores: nearParts,
    flags: {
      stretch: ctx.takeHome != null && allIn > (s.ceilingPct / 100) * ctx.takeHome,
      overCommute: j.weekday > s.maxCommute,
      thin: a.rooms <= 5,
      noEarlyFlight,
    },
  };
}

// Every area, best first: within the commute limit before over it, within budget before stretch,
// then by the monthly figure.
export function rankAreas(data, s) {
  const ctx = context(data, s);
  const scored = data.areas.map((area) => ({ area, score: scoreArea(area, s, ctx) }));
  scored.sort((x, y) => (x.score.flags.overCommute - y.score.flags.overCommute)
    || (x.score.flags.stretch - y.score.flags.stretch) || (x.score.total - y.score.total));
  scored.forEach((r, i) => { r.rank = i + 1; });
  return { ctx, ranked: scored };
}

// SpareRoom near the station with his filters (the room finder's search).
export function spareRoomLink(name, maxRent = 1150) {
  const q = new URLSearchParams({
    flatshare_type: 'offered', location_type: 'area', search: `${name.replace('&', 'and')} station`, miles_from_max: '1',
    showme_rooms: 'Y', max_rent: String(maxRent), per: 'pcm', room_types: 'double', living_room: 'shared', max_beds: '4',
    share_type: 'P', days_of_wk_available: '7 days a week', posted_by: 'live_out', searchtype: 'advanced', action: 'search',
  });
  return `https://www.spareroom.co.uk/flatshare/search.pl?${q}`;
}

// Saves a change to the settings (a partial patch), merged into the synced record.
export function setLondonSettings(store, patch) {
  const had = store.doc().calendar?.[SETTINGS_ID];
  const base = had?.status === 'active' ? had : {};
  const next = { ...base, ...patch, near: { ...(base.near ?? {}), ...(patch.near ?? {}) } };
  if (patch.salaries) next.salaries = patch.salaries;
  delete next.id; delete next._sync;
  store.putCalendar(SETTINGS_ID, { ...next, status: 'active' }, 'me');
}

export const pounds = (v) => (v == null || !fin(v) ? '—' : `${v < 0 ? '−' : ''}£${Math.round(Math.abs(v)).toLocaleString('en-GB')}`);
