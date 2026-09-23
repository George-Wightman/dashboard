// The Gym panel: George's training from Hevy (js/gym.js does the numbers). The week as seven cells
// — teal where he lifted, a lighter line for cardio minutes — the Cardio target, a card for each key
// lift (estimated 1RM, PR, a sparkline with its projection dashed on, pace), and today's session.
// Nothing until Hevy has sent a workout.

import { h } from './dom.js';
import { workouts, weekStrip, liftSummary, dayLines, gymConfig, cardioQuotaId, kgText } from '../gym.js';
import { weekTotal } from '../schedule.js';
import { shortWeekday, shortDate, daysBetween } from '../dates.js';

const SVG = 'http://www.w3.org/2000/svg';
const W = 140;
const H = 44;
const PAD = 4;
const round = (n) => Math.round(n * 10) / 10;

// An SVG element (js/ui/training.js draws with it too).
export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children.flat(Infinity)) if (c) el.append(c);
  return el;
}

// Where the sparkline's points go in its 140 × 44 box, the target's height, and where the dashed
// projection ends — plain numbers, so they can be tested. The line takes the left three quarters
// when there's a projection to draw.
export function sparkGeometry(points, target = null, projection = null) {
  const ahead = !!(target && projection && !projection.reached);
  const top = Math.max(...points, target ?? -Infinity);
  const bottom = Math.min(...points);
  const width = ahead ? W * 0.75 : W;
  const x = (i) => (points.length === 1 ? width / 2 : PAD + (i * (width - 2 * PAD)) / (points.length - 1));
  // All one value (one session, or no change): along the middle.
  const y = (v) => (top === bottom ? H / 2 : PAD + ((top - v) * (H - 2 * PAD)) / (top - bottom));
  return {
    line: points.map((v, i) => [round(x(i)), round(y(v))]),
    targetY: target ? round(y(target)) : null,
    ahead: ahead ? [W - PAD, round(y(target))] : null,
  };
}

function sparkline(s) {
  const g = sparkGeometry(s.points, s.target, s.projection);
  const [lx, ly] = g.line.at(-1);
  return svg('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    g.targetY != null ? svg('line', { class: 'target', x1: 0, x2: W, y1: g.targetY, y2: g.targetY }) : null,
    g.line.length > 1 ? svg('polyline', { class: 'line', points: g.line.map((p) => p.join(',')).join(' ') }) : null,
    g.ahead ? svg('polyline', { class: 'ahead', points: `${lx},${ly} ${g.ahead.join(',')}` }) : null,
    svg('circle', { class: s.pr ? 'dot pr' : 'dot', cx: lx, cy: ly, r: 3 }));
}

const when = (day, today) => (daysBetween(day, today) <= 6 ? shortWeekday(day) : shortDate(day));

function paceLine(s) {
  const parts = [s.pace != null ? `${s.pace >= 0 ? '+' : ''}${s.pace} kg/wk` : 'pace after 4 sessions'];
  if (s.projection?.reached) parts.push(`${kgText(s.target)} reached`);
  else if (s.projection) parts.push(`${kgText(s.target)} by ~${s.projection.label}`);
  return parts.join(' · ');
}

function liftCard(s, today) {
  const badge = s.pr ? 'PR' : s.repNote;
  return h('div', { class: 'lift-card' },
    h('div', {}, `${s.name} · est. 1RM`),
    h('div', { class: 'big' },
      h('span', { class: 'num' }, kgText(s.e1rm)), h('span', {}, 'kg'),
      badge ? h('span', { class: 'pr' }, badge) : null),
    sparkline(s),
    h('div', {}, paceLine(s)),
    h('div', {}, `Last: ${kgText(s.last.kg)} × ${s.last.reps} · ${when(s.last.day, today)}`));
}

// The key is on hover, not a line of its own: teal where he lifted, the lower line cardio.
function weekCells(doc, today) {
  return h('div', { class: 'gym-week', title: 'Teal: lifted · line: cardio minutes' }, weekStrip(doc, today).map((c) => {
    const said = [c.lifted ? 'lifted' : null, c.cardio ? `${Math.round(c.cardio)} min cardio` : null].filter(Boolean).join(', ');
    const label = `${shortWeekday(c.day)}: ${c.future ? 'to come' : said || 'no session'}`;
    return h('div', { class: c.day === today ? 'gym-day today' : 'gym-day', title: label, 'aria-label': label, role: 'img' },
      h('span', { class: 'dow' }, shortWeekday(c.day)[0]),
      h('span', { class: ['gym-cell', c.lifted && 'lift', c.future && 'future'].filter(Boolean).join(' ') },
        c.cardio ? h('span', { class: 'gym-cardio', style: `width:${Math.min(100, Math.round((c.cardio / 60) * 100))}%` }) : null));
  }));
}

function cardioRow(doc, today, config, strip) {
  const quota = cardioQuotaId(doc, config);
  if (!quota) {
    const minutes = Math.round(strip.reduce((m, c) => m + c.cardio, 0));
    return minutes ? h('p', { class: 'gym-note' }, `Cardio: ${minutes} min this week`) : null;
  }
  const q = doc.items[quota];
  const total = weekTotal(doc, quota, today);
  const met = total >= q.target;
  const pct = Math.min(100, Math.round((total / q.target) * 100));
  return h('div', { class: 'bar-row' },
    h('div', { class: 'bar-label' }, h('span', {}, q.title), h('span', { class: met ? 'met' : 'muted' }, `${Math.round(total)} / ${Math.round(q.target)} min`)),
    h('div', { class: met ? 'bar met' : 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': q.title },
      h('span', { style: `width:${pct}%` })));
}

export function renderGym(ctx) {
  const doc = ctx.store.doc();
  if (!workouts(doc).length) return null;
  const today = ctx.store.today();
  const config = gymConfig(doc);
  const strip = weekStrip(doc, today);
  const sessions = strip.reduce((n, c) => n + c.sessions, 0);
  const lifts = config.keyLifts.map((l) => liftSummary(doc, l, today, config)).filter(Boolean);
  const todays = dayLines(doc, today);
  return h('section', { class: 'panel gym' },
    h('h2', {}, 'Gym', h('span', { class: 'count' }, `${sessions} session${sessions === 1 ? '' : 's'} this week`)),
    weekCells(doc, today),
    cardioRow(doc, today, config, strip),
    lifts.length ? h('div', { class: 'gym-lifts' }, lifts.map((s) => liftCard(s, today))) : null,
    todays.length ? h('div', { class: 'gym-today' }, h('strong', {}, 'Today'), todays.map((l) => h('p', {}, l))) : null);
}
