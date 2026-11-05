// London's tile and big view (js/london.js): where to look for a room. Phone first. The big view is a
// real map (Leaflet, vendored in js/vendor/leaflet, loaded the first time it opens; OpenStreetMap tiles) with every area
// pinned at its station and numbered by rank, the settings that rank them (each with a line saying
// what it does), the chosen area's card with why it ranks where it does in pounds, the ranked list,
// cost against commute, and the budget with what Money says he'll have at the start. The map element
// is kept between redraws so dragging a setting re-ranks the pins without rebuilding the map.

import { h } from './dom.js';
import { svg, tip } from './svg.js';
import { bigSection } from './big.js';
import { rankAreas, londonSettings, setLondonSettings, spareRoomLink, pounds, takeHome, NEAR, WEIGHTS } from '../london.js';
import { moneySummary } from '../money.js';

const SIDE = { N: 'North', S: 'South', E: 'East', W: 'West' };
const mins = (m) => (m == null ? '—' : `${Math.round(m)} min`);
const hrs = (m) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}` : `${Math.round(m)} min`);

// The settings, in order: what each does, in his words.
export const CONTROLS = [
  { key: 'ceilingPct', label: "Most I'll spend on room, bills and travel", min: 30, max: 60, step: 1, fmt: (v) => `${v}% of take-home`, help: 'Areas over it sink below the rest and are marked "stretch", but stay on the list.' },
  { key: 'savings', label: 'Savings I want each month', min: 0, max: 1000, step: 25, fmt: (v) => `£${v}`, help: "If what's left falls short of this, the gap is added to that area's monthly figure, so cost bites harder as money gets tight." },
  { key: 'everythingElse', label: 'Everything else each month', min: 300, max: 1500, step: 10, fmt: (v) => `£${v}`, help: 'Food, going out, trips, gym, phone: what you spend outside rent and travel.' },
  { key: 'hourValue', label: 'What an hour of commuting is worth to me', min: 0, max: 30, step: 1, fmt: (v) => `£${v}`, help: "Each area's commuting hours a month × this is added. At £0 the ranking is on money alone." },
  { key: 'maxCommute', label: "Longest commute I'll accept", min: 20, max: 70, step: 1, fmt: (v) => `${v} min`, help: 'Door to door, each way, on a normal weekday. Areas over it are greyed out and ranked last.' },
  { key: 'west', label: 'Time I might spend on West London placements', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, help: "Mixes the office journey with the average to four points across West London (Paddington to Ealing). You won't know until you're on the programme, so it starts at a third." },
  { key: 'mansfieldTrips', label: 'Trips home to Mansfield a month', min: 0, max: 4, step: 1, fmt: (v) => String(v), help: "Each adds the journey to King's Cross (or St Pancras) and back, priced at your hour value." },
  { key: 'salzburgTrips', label: 'Trips to Salzburg a month', min: 0, max: 4, step: 1, fmt: (v) => String(v), help: 'Each adds getting to Stansted for a 7 am flight and back. Areas where that isn\'t possible by public transport add the cost below instead.' },
  { key: 'cab', label: 'A cab or a night before, per early flight', min: 0, max: 120, step: 5, fmt: (v) => `£${v}`, help: "Only for areas that can't reach Stansted by 5:30 am by public transport." },
  { key: 'trust', label: 'Caution with areas that have few rooms', min: 0, max: 15, step: 1, fmt: (v) => (v ? `${v} rooms' worth` : 'trust every price'), help: "Pulls each area's rent towards its side of London's typical rent, harder when few rooms were listed, so two cheap rooms can't top the list." },
  { key: 'stepValue', label: 'What each step of "what\'s around me" is worth', min: 0, max: 60, step: 5, fmt: (v) => `£${v} a month`, help: '"Really matters" is three steps: that many pounds a month between the best area and an average one.' },
];

// --- Leaflet, once ---------------------------------------------------------------------------------
let leaflet = null;
function loadLeaflet(onReady) {
  if (globalThis.L) return Promise.resolve(globalThis.L);
  if (!leaflet) {
    leaflet = new Promise((resolve, reject) => {
      document.head.append(h('link', { rel: 'stylesheet', href: 'js/vendor/leaflet/leaflet.css' }));
      const s = h('script', { src: 'js/vendor/leaflet/leaflet.js' });
      s.onload = () => resolve(globalThis.L);
      s.onerror = () => { leaflet = null; reject(new Error('The map library could not load')); };
      document.head.append(s);
    });
  }
  return leaflet.then((L) => { onReady?.(); return L; });
}

const state = { el: null, map: null, layer: null, tiles: null, fitted: false, pending: false };

function mapBox(ctx, ranked, pick, data) {
  if (!state.el) state.el = h('div', { class: 'lo-map', role: 'application', 'aria-label': 'Map of London with the areas ranked' });
  const L = globalThis.L;
  if (!L) {
    state.el.replaceChildren(h('p', { class: 'lo-map-wait' }, navigator.onLine === false ? 'The map needs a connection. Everything below still works.' : 'Loading the map…'));
    loadLeaflet(() => ctx.render()).catch(() => state.el.replaceChildren(h('p', { class: 'lo-map-wait' }, 'The map couldn\'t load. Everything below still works.')));
    return state.el;
  }
  if (!state.map) {
    // Made once the box is on screen (a map made in a detached box measures itself as 0 × 0).
    if (!state.pending) {
      state.pending = true;
      requestAnimationFrame(() => {
        state.pending = false;
        if (!state.el.isConnected || state.map) return;
        state.el.replaceChildren();
        state.map = L.map(state.el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([51.505, -0.11], 11);
        state.layer = L.layerGroup().addTo(state.map);
        if (typeof ResizeObserver === 'function') new ResizeObserver(() => state.map?.invalidateSize()).observe(state.el);
        ctx.render();
      });
    }
    return state.el;
  }
  // OpenStreetMap's own tiles (light personal use, with attribution); night mode darkens them in CSS.
  if (!state.tiles) {
    state.tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(state.map);
  }
  state.layer.clearLayers();
  if (data.office) {
    L.marker([data.office.lat, data.office.lon], { icon: L.divIcon({ className: 'lo-office', html: '<span>Work</span>', iconSize: [44, 22] }), keyboard: false, title: data.office.name }).addTo(state.layer);
  }
  for (const r of [...ranked].reverse()) {
    const f = r.score.flags;
    const cls = ['lo-pin', f.overCommute ? 'over' : f.stretch ? 'stretch' : 'ok', r.area.id === pick ? 'on' : ''].join(' ');
    L.marker([r.area.lat, r.area.lon], {
      icon: L.divIcon({ className: 'lo-pin-wrap', html: `<span class="${cls}">${r.rank}</span>`, iconSize: [30, 30] }),
      title: `${r.rank}. ${r.area.name}: ${pounds(r.score.total)} a month`, riseOnHover: true, zIndexOffset: r.area.id === pick ? 1000 : -r.rank,
    }).on('click', () => { ctx.ui.londonPick = r.area.id; ctx.render(); }).addTo(state.layer);
  }
  if (!state.fitted) {
    state.map.fitBounds(L.latLngBounds(ranked.map((r) => [r.area.lat, r.area.lon])).pad(0.08));
    state.fitted = true;
  }
  setTimeout(() => state.map?.invalidateSize(), 50);
  return state.el;
}

// --- The tile ------------------------------------------------------------------------------------
export function renderLondonTile(ctx) {
  const data = ctx.london?.() ?? null;
  if (!data) return h('div', { class: 'tile-stack' }, h('p', { class: 'muted' }, 'Where to live when the job starts. Claude is putting the areas together.'));
  const s = londonSettings(ctx.store.doc(), data);
  const { ranked } = rankAreas(data, s);
  const top = ranked[0];
  return h('div', { class: 'tile-stack lo-tile' },
    h('p', { class: 'lo-top' }, h('span', { class: 'lo-rank' }, '1'), h('span', {}, h('b', {}, top.area.name), h('small', {}, [top.area.borough, SIDE[top.area.side]].filter(Boolean).join(' · ')))),
    h('ul', { class: 'mo-facts' },
      h('li', {}, h('b', {}, pounds(top.score.allIn)), ' a month for room, bills and travel'),
      top.score.leftover != null ? h('li', {}, h('b', {}, pounds(top.score.leftover)), ' left after everything else') : null));
}

// --- The big view ----------------------------------------------------------------------------------
function control(ctx, s, c) {
  const out = h('output', {}, c.fmt(s[c.key]));
  const input = h('input', { type: 'range', min: c.min, max: c.max, step: c.step, value: s[c.key], 'aria-describedby': `lo-h-${c.key}` });
  input.addEventListener('input', () => { out.textContent = c.fmt(Number(input.value)); });
  input.addEventListener('change', () => setLondonSettings(ctx.store, { [c.key]: Number(input.value) }));
  return h('div', { class: 'lo-ctl' }, h('label', {}, h('span', {}, c.label), out), input, h('p', { id: `lo-h-${c.key}`, class: 'lo-help' }, c.help));
}

function seg(label, options, current, onPick, help) {
  return h('div', { class: 'lo-ctl' }, h('span', { class: 'lo-ctl-label' }, label),
    h('div', { class: 'mo-seg', role: 'radiogroup', 'aria-label': label }, options.map((o, i) => h('button', { type: 'button', class: 'dl-btn', role: 'radio', 'aria-checked': String(current === o.value ?? i), onclick: () => onPick(o.value) }, o.label))),
    help ? h('p', { class: 'lo-help' }, help) : null);
}

function settingsPanel(ctx, s) {
  const store = ctx.store;
  const salary = (i) => h('label', { class: 'lo-sal' }, h('span', {}, `Year ${i + 1}${s.guessed[i] && i ? ' (a guess)' : ''}`),
    h('input', { type: 'number', inputmode: 'numeric', step: 500, min: 0, value: s.salaries[i] ?? '', onchange: (e) => {
      const next = [...s.salaries.map((v, j) => (s.guessed[j] && j !== i ? null : v))];
      next[i] = Number(e.target.value) || null;
      setLondonSettings(store, { salaries: next });
    } }));
  const th = takeHome(s.salaries[s.year]);
  return h('details', { class: 'lo-settings', open: ctx.ui.londonSettingsOpen ?? true, ontoggle: (e) => { ctx.ui.londonSettingsOpen = e.target.open; } },
    h('summary', {}, 'What matters to you'),
    seg('Year to plan with', [0, 1, 2].map((i) => ({ value: i, label: `Year ${i + 1}` })), s.year, (v) => setLondonSettings(store, { year: v }),
      `Take-home that year: ${pounds(th)} a month, after tax, NI, your student loan and pension.`),
    h('div', { class: 'lo-sals' }, [0, 1, 2].map(salary)),
    CONTROLS.slice(0, 6).map((c) => control(ctx, s, c)),
    CONTROLS.slice(6, 7).map((c) => control(ctx, s, c)),
    seg('Getting home', [{ value: 'newark', label: 'Newark + a lift' }, { value: 'nottingham', label: 'Via Nottingham' }], s.mansfieldRoute, (v) => setLondonSettings(store, { mansfieldRoute: v })),
    CONTROLS.slice(7).map((c) => control(ctx, s, c)),
    h('div', { class: 'lo-near' }, h('span', { class: 'lo-ctl-label' }, "What's around me"),
      NEAR.map((n) => h('label', { class: 'lo-near-row' }, h('span', {}, n.label),
        h('select', { onchange: (e) => setLondonSettings(store, { near: { [n.id]: Number(e.target.value) } }) },
          WEIGHTS.map((w, i) => h('option', { value: i, selected: (s.near[n.id] ?? 0) === i }, w))))),
      h('p', { class: 'lo-help' }, 'Gyms, parks and places to eat are counted from OpenStreetMap within about 10 minutes\' walk of the station; safety is reported street crime within a mile (police.uk).')),
    h('button', { type: 'button', class: 'link', onclick: () => store.putCalendar('london:settings', { status: 'active', salaries: s.salaries.map((v, i) => (s.guessed[i] ? null : v)) }, 'me') }, 'Back to the defaults'));
}

function breakdown(sc) {
  const p = sc.parts;
  const row = (label, v, cls = '') => h('tr', { class: cls }, h('td', {}, label), h('td', { class: 'n' }, v >= 0 ? pounds(v) : `−${pounds(-v)}`));
  return h('table', { class: 'mo-table lo-why' }, h('tbody', {},
    row('Room', p.rent), p.bills ? row('Bills', p.bills) : null, row('Travelcard', p.travel),
    row(`Commute time (${Math.round(sc.commuteHours)} h)`, p.commute),
    row('Trips home and away', p.trips),
    p.shortfall ? row('Short of your savings goal', p.shortfall) : null,
    Math.round(p.near) ? row(p.near < 0 ? "What's around you (worth it)" : "What's around you (missing)", p.near) : null,
    row('Really costs you', sc.total, 'mo-total')));
}

function card(r, s, data) {
  const a = r.area, sc = r.score, j = sc.journeys;
  const f = sc.flags;
  const route = s.mansfieldRoute === 'nottingham' ? data.rail?.nottingham : data.rail?.newark;
  const home = s.mansfieldRoute === 'nottingham' ? j.stp : j.kx;
  return h('article', { class: 'lo-card' },
    h('header', {}, h('span', { class: 'lo-rank' }, String(r.rank)), h('div', {}, h('h4', {}, a.name), h('p', { class: 'muted' }, [a.borough, SIDE[a.side], a.line].filter(Boolean).join(' · '))),
      h('div', { class: 'lo-total' }, h('b', {}, pounds(sc.total)), h('small', {}, 'really costs you a month'))),
    h('div', { class: 'lo-flags' },
      f.overCommute ? h('span', { class: 'lo-flag' }, 'Over your commute limit') : null,
      f.stretch ? h('span', { class: 'lo-flag' }, 'Stretch') : null,
      f.thin ? h('span', { class: 'lo-flag' }, `Few rooms (${a.rooms})`) : null,
      f.noEarlyFlight ? h('span', { class: 'lo-flag' }, 'No early-flight route') : null),
    h('div', { class: 'lo-card-grid' },
      h('div', {}, h('h5', {}, 'Why it ranks here'), breakdown(sc), h('p', { class: 'muted lo-small' }, `Typical room ${pounds(a.rent)}${a.allin > a.rent ? ` + about ${pounds(a.allin - a.rent)} bills` : ', bills included'} · ${a.rooms} rooms listed · prices from ${data.prices}`)),
      h('div', {}, h('h5', {}, 'Getting about'), h('ul', { class: 'lo-j' },
        h('li', {}, h('b', {}, 'Work '), `${mins(j.office)} door to door, arriving 8:30`),
        j.west != null ? h('li', {}, h('b', {}, 'West London '), `${mins(j.west)} on average`) : null,
        h('li', {}, h('b', {}, 'Mansfield '), home == null ? '—' : `${hrs(home + (route?.mins ?? 0))} (${mins(home)} to ${s.mansfieldRoute === 'nottingham' ? 'St Pancras' : "King's Cross"}, then ${route?.short ?? 'the train'})`),
        h('li', {}, h('b', {}, 'Stansted, 7 am flight '), j.stansted ? `leave by ${j.stansted.leave} (${mins(j.stansted.mins)})` : 'not by public transport')),
        h('h5', {}, "What's around"), h('ul', { class: 'lo-near-list' }, NEAR.map((n) => h('li', {}, n.label, h('span', { class: 'lo-meter' }, h('i', { style: `width:${Math.round((sc.nearScores[n.id] ?? 0.5) * 100)}%` }))))))),
    h('a', { class: 'dl-btn lo-sr', href: spareRoomLink(a.name), target: '_blank', rel: 'noopener' }, 'Rooms near this station on SpareRoom ↗'));
}

function scatter(ctx, ranked, s, ceiling) {
  const W = 640, H = 300, L = 56, R = 12, T = 12, B = 34;
  const xs = ranked.map((r) => r.score.journeys.weekday), ys = ranked.map((r) => r.score.allIn);
  const x0 = Math.floor(Math.min(...xs) / 5) * 5, x1 = Math.ceil(Math.max(...xs, s.maxCommute) / 5) * 5;
  const y0 = Math.floor(Math.min(...ys) / 50) * 50, y1 = Math.ceil(Math.max(...ys, ceiling ?? 0) / 50) * 50;
  const X = (v) => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - R);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B);
  const grid = [];
  for (let v = x0; v <= x1; v += 5) grid.push(svg('text', { x: X(v), y: H - B + 16, 'text-anchor': 'middle', class: 'mo-axis' }, String(v)));
  for (let v = y0; v <= y1; v += 100) grid.push(svg('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'mo-grid' }), svg('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'mo-axis' }, `£${v}`));
  return svg('svg', { class: 'mo-chart lo-scatter', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Monthly room, bills and travel against door-to-door commute for each area' },
    grid,
    svg('text', { x: (L + W - R) / 2, y: H - 4, 'text-anchor': 'middle', class: 'mo-axis' }, 'Minutes to work, door to door'),
    ceiling ? svg('line', { x1: L, x2: W - R, y1: Y(ceiling), y2: Y(ceiling), class: 'lo-limit' }) : null,
    svg('line', { x1: X(s.maxCommute), x2: X(s.maxCommute), y1: T, y2: H - B, class: 'lo-limit' }),
    ranked.map((r) => {
      const f = r.score.flags;
      return svg('circle', { cx: X(r.score.journeys.weekday), cy: Y(r.score.allIn), r: 4 + Math.sqrt(r.area.rooms) * 1.3, class: `lo-dot ${f.overCommute ? 'over' : f.stretch ? 'stretch' : 'ok'}${ctx.ui.londonPick === r.area.id ? ' on' : ''}`, onclick: () => { ctx.ui.londonPick = r.area.id; ctx.render(); } },
        tip(`${r.rank}. ${r.area.name}: ${mins(r.score.journeys.weekday)}, ${pounds(r.score.allIn)} a month, ${r.area.rooms} rooms`));
    }),
    ranked.slice(0, 6).filter((r) => !r.score.flags.overCommute).map((r) => svg('text', { x: X(r.score.journeys.weekday) + 9, y: Y(r.score.allIn) + 4, class: 'lo-label' }, r.area.name)));
}

export function renderLondonBig(ctx) {
  const data = ctx.london?.() ?? null;
  if (!data) return h('p', { class: 'muted' }, 'The London areas aren\'t in the sync repo yet.');
  const doc = ctx.store.doc();
  const s = londonSettings(doc, data);
  const { ctx: lctx, ranked } = rankAreas(data, s);
  const pick = ranked.find((r) => r.area.id === ctx.ui.londonPick) ?? ranked[0];
  const ceiling = lctx.takeHome == null ? null : (s.ceilingPct / 100) * lctx.takeHome;
  const pot = moneySummary(ctx.money?.() ?? null, doc, ctx.store.today()).atStart;
  const limit = ctx.ui.londonAll ? ranked.length : 12;
  return h('div', { class: 'big london' },
    h('div', { class: 'lo-layout' },
      h('div', { class: 'lo-main' },
        mapBox(ctx, ranked, pick.area.id, data),
        h('ul', { class: 'mo-legend lo-legend' },
          h('li', {}, h('i', { class: 'lo-key ok' }), 'Within budget'), h('li', {}, h('i', { class: 'lo-key stretch' }), 'Stretch'), h('li', {}, h('i', { class: 'lo-key over' }), 'Over commute limit')),
        card(pick, s, data)),
      settingsPanel(ctx, s)),
    bigSection('All areas, best first',
      h('ol', { class: 'lo-list' }, ranked.slice(0, limit).map((r) => h('li', { class: `${r.score.flags.overCommute ? 'over' : ''}${r.area.id === pick.area.id ? ' on' : ''}` },
        h('button', { type: 'button', onclick: () => { ctx.ui.londonPick = r.area.id; ctx.render(); document.querySelector('#widget-sheet .lo-card')?.scrollIntoView({ block: 'nearest' }); } },
          h('span', { class: 'lo-rank' }, String(r.rank)),
          h('span', { class: 'lo-name' }, h('b', {}, r.area.name), h('small', {}, [r.area.borough, SIDE[r.area.side]].filter(Boolean).join(' · '))),
          h('span', { class: 'lo-nums' }, h('b', {}, pounds(r.score.total)), h('small', {}, `${pounds(r.score.allIn)} · ${mins(r.score.journeys.weekday)}`)))))),
      ranked.length > limit ? h('button', { type: 'button', class: 'dl-btn', onclick: () => { ctx.ui.londonAll = true; ctx.render(); } }, `Show all ${ranked.length}`) : null),
    bigSection('Cost against commute', h('p', { class: 'muted mo-note' }, 'Lower left is best. Dot size is how many rooms were listed; the lines are your budget and commute limit. Tap a dot to open it.'), scatter(ctx, ranked, s, ceiling)),
    bigSection('Your budget',
      h('table', { class: 'mo-table' }, h('tbody', {},
        h('tr', {}, h('td', {}, `Take-home, year ${s.year + 1}`), h('td', { class: 'n' }, pounds(lctx.takeHome))),
        h('tr', {}, h('td', {}, `${pick.area.name}: room, bills and travel`), h('td', { class: 'n' }, `−${pounds(pick.score.allIn)}`)),
        h('tr', {}, h('td', {}, 'Everything else'), h('td', { class: 'n' }, `−${pounds(s.everythingElse)}`)),
        h('tr', { class: 'mo-total' }, h('td', {}, 'Left to save each month'), h('td', { class: 'n' }, pounds(pick.score.leftover))),
        h('tr', {}, h('td', {}, 'From Money: what you\'ll have at the start'), h('td', { class: 'n' }, pot == null ? 'needs statements' : pounds(pot / 100))))),
      h('p', { class: 'muted mo-note' }, `Your starting pot covers a deposit (usually five weeks' rent, about ${pounds((pick.area.rent * 12 * 5) / 52)}) and the first month's rent.`)),
    h('p', { class: 'muted lo-small' }, `Journeys from TfL's planner for ${data.journeysOn ? `${data.journeysOn.slice(6, 8)}/${data.journeysOn.slice(4, 6)}/${data.journeysOn.slice(0, 4)}` : 'a weekday'}; rooms from SpareRoom on ${data.prices}; neighbourhood from OpenStreetMap and police.uk. Claude refreshes the prices before you start looking.`));
}
