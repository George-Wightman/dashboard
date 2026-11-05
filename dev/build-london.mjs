// Builds London's private area file (docs/superpowers/specs/2026-11-05-hours-money-london-design.md)
// and uploads it to the sync repo as london/areas.json. Run on the laptop:
//
//   node dev/build-london.mjs [--upload]
//
// Inputs, all outside the repo in ~/.dashboard-london/: seed.json (the SpareRoom areas: name, line,
// side, station minutes, typical walk, rooms, median rent, rent with bills; the prices' date) and
// private.json (the office, his salary and budget defaults). Each area's station is found with TfL's
// StopPoint search and its borough with postcodes.io; journeys come from TfL's Journey Planner (free,
// no key needed at this volume); neighbourhood counts from OpenStreetMap (Overpass) and street crime
// from police.uk. Every response is cached in ~/.dashboard-london/cache, so a rerun is quick and the
// numbers only change when the cache is cleared. Nothing here goes to the public repo.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validLondon } from '../js/london.js';

const HOME = join(homedir(), '.dashboard-london');
const CACHE = join(HOME, 'cache');
const UA = 'dashboard-london-build (personal, low volume)';

// West London placements could be anywhere in zones 1 to 3 west: a few points across that patch.
export const WEST = [
  { name: 'Paddington', lat: 51.5154, lon: -0.1755 },
  { name: 'Hammersmith', lat: 51.4927, lon: -0.2240 },
  { name: 'Acton Town', lat: 51.5028, lon: -0.2801 },
  { name: 'Ealing Broadway', lat: 51.5150, lon: -0.3017 },
];
export const KINGS_CROSS = { lat: 51.5308, lon: -0.1238 };
export const ST_PANCRAS = { lat: 51.5322, lon: -0.1270 };
export const STANSTED = { lat: 51.8890, lon: 0.2626 };

// Beyond London, from the timetables (read Oct 2026): LNER King's Cross to Newark Northgate then a lift;
// EMR St Pancras to Mansfield with a change at Nottingham.
export const RAIL = {
  newark: { label: "King's Cross → Newark Northgate, then a lift", short: 'the train to Newark and a lift', mins: 80 + 40, note: 'LNER direct about 1 h 20, around 29 a weekday, Advance from about £17 before Railcard, then about 40 min by car' },
  nottingham: { label: 'St Pancras → Mansfield via Nottingham', short: 'the train via Nottingham', mins: 146, note: 'East Midlands Railway, one change at Nottingham, seen from £22 to £64 before Railcard' },
};

async function cached(url, init = {}) {
  mkdirSync(CACHE, { recursive: true });
  const key = createHash('sha1').update(url + (init.body ?? '')).digest('hex');
  const file = join(CACHE, `${key}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers ?? {}) } });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
    if (!res.ok) { const out = { error: res.status }; writeFileSync(file, JSON.stringify(out)); return out; }
    const out = await res.json();
    writeFileSync(file, JSON.stringify(out));
    await new Promise((r) => setTimeout(r, 300));
    return out;
  }
  return { error: 'gave up' };
}

// The next Tuesday at least a few days out, as TfL wants it (YYYYMMDD).
export function nextTuesday(from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 3));
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

const MODES = 'tube,overground,dlr,elizabeth-line,national-rail';
async function station(name) {
  const q = encodeURIComponent(name.replace('&', 'and'));
  const r = await cached(`https://api.tfl.gov.uk/StopPoint/Search/${q}?modes=${MODES}&maxResults=5`);
  const m = r?.matches?.[0];
  return m ? { lat: m.lat, lon: m.lon, tfl: m.name } : null;
}

async function borough({ lat, lon }) {
  const r = await cached(`https://api.postcodes.io/postcodes?lon=${lon}&lat=${lat}&radius=800&limit=1`);
  return r?.result?.[0]?.admin_district ?? null;
}

// The shortest TfL journey in minutes, and when it leaves.
export function bestJourney(r, { latestDeparture = false } = {}) {
  const js = (r?.journeys ?? []).filter((j) => Number.isFinite(j.duration));
  if (!js.length) return null;
  const pick = latestDeparture ? [...js].sort((a, b) => b.startDateTime.localeCompare(a.startDateTime))[0] : [...js].sort((a, b) => a.duration - b.duration)[0];
  return { mins: pick.duration, leave: pick.startDateTime?.slice(11, 16) ?? null, route: (pick.legs ?? []).map((l) => l.routeOptions?.[0]?.name || l.mode?.name).filter(Boolean).join(' → ') };
}

async function journey(from, to, { date, time, arriving }) {
  const url = `https://api.tfl.gov.uk/Journey/JourneyResults/${from.lat},${from.lon}/to/${to.lat},${to.lon}?date=${date}&time=${time}&timeIs=${arriving ? 'Arriving' : 'Departing'}&journeyPreference=leasttime&walkingSpeed=average`;
  return cached(url);
}

async function overpassCounts({ lat, lon }, radius = 900) {
  const a = `(around:${radius},${lat},${lon})`;
  const q = `[out:json][timeout:60];
(nwr["leisure"="fitness_centre"]${a};nwr["leisure"="sports_centre"]["sport"~"fitness"]${a};);out count;
(nwr["leisure"="park"]${a};nwr["leisure"="garden"]["access"!~"private"]${a};nwr["landuse"="recreation_ground"]${a};);out count;
(nwr["amenity"~"^(restaurant|cafe|pub|bar)$"]${a};);out count;`;
  const r = await cached('https://overpass-api.de/api/interpreter', { method: 'POST', body: `data=${encodeURIComponent(q)}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const counts = (r?.elements ?? []).map((e) => Number(e.tags?.total ?? 0));
  return counts.length === 3 ? { gyms: counts[0], green: counts[1], eat: counts[2] } : null;
}

// Street crime within a mile, averaged over the three months police.uk has most recently published.
async function crime({ lat, lon }) {
  const avail = await cached('https://data.police.uk/api/crimes-street-dates');
  const months = (Array.isArray(avail) ? avail : []).map((m) => m.date).sort().slice(-3);
  const counts = [];
  for (const m of months) {
    const r = await cached(`https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lon}&date=${m}`);
    if (Array.isArray(r)) counts.push(r.length);
  }
  return counts.length ? Math.round(counts.reduce((t, n) => t + n, 0) / counts.length) : null;
}

const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function buildArea(row, ctx) {
  const [name, line, side, stn, walk, rooms, rent, allin] = row;
  const st = await station(name);
  if (!st) throw new Error(`TfL couldn't find a station for ${name}`);
  const date = ctx.date;
  const office = bestJourney(await journey(st, ctx.office, { date, time: '0830', arriving: true }));
  const west = [];
  for (const w of WEST) { const j = bestJourney(await journey(st, w, { date, time: '0830', arriving: true })); if (j) west.push(j.mins); }
  const kx = bestJourney(await journey(st, KINGS_CROSS, { date, time: '1000', arriving: false }));
  const stp = bestJourney(await journey(st, ST_PANCRAS, { date, time: '1000', arriving: false }));
  const early = bestJourney(await journey(st, STANSTED, { date, time: '0530', arriving: true }), { latestDeparture: true });
  // A "journey" that leaves the evening before isn't a way to make a 7 am flight.
  const stansted = early && early.mins <= 180 && early.leave >= '02:00' ? early : null;
  const near = { ...(await overpassCounts(st) ?? {}), crime: await crime(st) };
  return {
    id: slug(name), name, borough: await borough(st), side, line, lat: st.lat, lon: st.lon, walk, rooms, rent, allin,
    j: { office: office?.mins ?? stn, west, kx: kx?.mins ?? null, stp: stp?.mins ?? null, stansted, officeRoute: office?.route ?? null },
    near,
  };
}

async function main() {
  const seed = JSON.parse(readFileSync(join(HOME, 'seed.json'), 'utf8'));
  const priv = JSON.parse(readFileSync(join(HOME, 'private.json'), 'utf8'));
  const ctx = { office: priv.office, date: nextTuesday() };
  const areas = [];
  for (const row of seed.areas) {
    process.stdout.write(`${row[0]}… `);
    areas.push(await buildArea(row, ctx));
    console.log('ok');
  }
  const out = {
    v: 1, prices: seed.prices, built: new Date().toISOString().slice(0, 10), journeysOn: ctx.date,
    office: priv.office, rail: RAIL, travelcard: { monthly: 175, note: 'Zones 1–3 annual Travelcard through a season ticket loan' },
    defaults: priv.defaults ?? {}, areas,
  };
  if (!validLondon(out)) throw new Error('The built file fails validLondon');
  writeFileSync(join(HOME, 'areas.json'), JSON.stringify(out, null, 1));
  console.log(`Wrote ${areas.length} areas to ${join(HOME, 'areas.json')}`);
  if (process.argv.includes('--upload')) {
    const { createFileStore } = await import('../claude/files.js');
    const cfg = JSON.parse(readFileSync(join(homedir(), '.dashboard-skill', 'config.json'), 'utf8'));
    await createFileStore({ token: cfg.token, repo: cfg.repo }).write('london/areas.json', `${JSON.stringify(out)}\n`, 'london: areas');
    console.log('Uploaded london/areas.json to the sync repo.');
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('build-london.mjs')) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
