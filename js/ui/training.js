// Two training widgets beside the Gym panel (js/gym.js does the numbers). Muscles: a radar of
// working sets per broad muscle group over the last 7 days, and the three groups longest since
// they were trained. Cardio trend: cardio minutes a week for eight weeks, against the target.
// Both say nothing until Hevy has sent a workout.

import { h } from './dom.js';
import { svg } from './gym.js';
import { workouts, muscleWeek, longestRested, cardioWeeks, templatesOf } from '../gym.js';
import { shortDate } from '../dates.js';

const round = (n) => Math.round(n * 10) / 10;

// The radar's outer ring in sets: at least 10 (a fair week for a group), else the top week
// rounded up to a 5.
export function radarScale(values) {
  const top = Math.max(0, ...values);
  return top <= 10 ? 10 : Math.ceil(top / 5) * 5;
}

// Where everything goes, as plain numbers: each axis's outer end (the first straight up, then
// clockwise), the shape's corners, four rings, and a label just beyond each axis with the side
// its text hangs from.
export function radarGeometry(values, scale, { cx, cy, r }) {
  const n = values.length;
  const at = (i, len) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [round(cx + len * Math.cos(a)) + 0, round(cy + len * Math.sin(a)) + 0];
  };
  const labels = values.map((_, i) => {
    const cos = Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / n);
    const [x, y] = at(i, r + 12);
    return { x, y, anchor: Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end' };
  });
  return {
    axes: values.map((_, i) => at(i, r)),
    points: values.map((v, i) => at(i, (Math.min(v, scale) / scale) * r)),
    rings: [1, 2, 3, 4].map((k) => values.map((_, i) => at(i, (r * k) / 4))),
    labels,
  };
}

export const restText = (days) => (days == null ? 'not yet' : days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days`);

const pts = (list) => list.map((p) => p.join(',')).join(' ');

function radar(week) {
  const values = week.map((g) => g.sets);
  const scale = radarScale(values);
  const g = radarGeometry(values, scale, { cx: 170, cy: 112, r: 72 });
  const said = week.map((x) => `${x.name} ${x.sets}`).join(', ');
  return svg('svg', { class: 'radar', viewBox: '0 0 340 222', role: 'img', 'aria-label': `Working sets in the last 7 days: ${said}` },
    g.rings.map((ring) => svg('polygon', { class: 'ring', points: pts(ring) })),
    g.axes.map(([x, y]) => svg('line', { class: 'axis', x1: 170, y1: 112, x2: x, y2: y })),
    svg('polygon', { class: 'shape', points: pts(g.points) }),
    g.points.map(([x, y], i) => (values[i] ? svg('circle', { class: 'dot', cx: x, cy: y, r: 2.5 }) : null)),
    week.map((x, i) => {
      const l = g.labels[i];
      // the top label sits above its axis and the bottom one below; the rest centre on it
      const dy = l.anchor === 'middle' ? (l.y < 112 ? -6 : 10) : 0;
      const text = svg('text', { class: x.sets ? 'label' : 'label none', x: l.x, y: l.y + dy, 'text-anchor': l.anchor });
      text.append(document.createTextNode(`${x.name} `));
      const n = svg('tspan', { class: 'n' });
      n.textContent = String(x.sets);
      text.append(n);
      return text;
    }),
    svg('text', { class: 'scale', x: 176, y: round(112 - 72) + 10 }, document.createTextNode(String(scale))));
}

export function renderMuscles(ctx) {
  const doc = ctx.store.doc();
  if (!workouts(doc).length) return null;
  const today = ctx.store.today();
  const known = Object.keys(templatesOf(doc)).length > 0;
  const rested = longestRested(doc, today);
  return h('section', { class: 'panel muscles' },
    h('h2', {}, 'Muscles', h('span', { class: 'count' }, 'sets, last 7 days')),
    known ? radar(muscleWeek(doc, today)) : h('p', { class: 'muted' }, "Waiting for Hevy's exercise list — the planner sends it on its next run."),
    known ? h('div', { class: 'rested' },
      h('span', { class: 'muted' }, 'Longest rested'),
      rested.map((x) => h('span', { class: 'rest' }, h('strong', {}, x.name), ` ${restText(x.days)}`))) : null);
}

// Bar heights (in a box `h` tall) against the larger of the target and the top week, and the
// target's height from the top of the box (null without one).
export function cardioBars(weeks, target, { h: height }) {
  const scale = Math.max(target ?? 0, ...weeks.map((w) => w.minutes));
  const y = (v) => (scale ? round((v / scale) * height) : 0);
  return {
    heights: weeks.map((w) => y(w.minutes)),
    targetY: target ? round(height - y(target)) : null,
  };
}

const BAR_TOP = 12;
const BAR_H = 80;
const SLOT = 40;

function bars(weeks, target) {
  const b = cardioBars(weeks, target, { h: BAR_H });
  const base = BAR_TOP + BAR_H;
  return svg('svg', { class: 'cardio-bars', viewBox: `0 0 ${SLOT * weeks.length} ${base + 16}`, 'aria-hidden': 'true' },
    svg('line', { class: 'base', x1: 0, x2: SLOT * weeks.length, y1: base, y2: base }),
    weeks.map((w, i) => {
      const x = i * SLOT + 8;
      const height = b.heights[i];
      const cls = ['bar', target && w.minutes >= target && 'met', w.current && 'current'].filter(Boolean).join(' ');
      return [
        height ? svg('rect', { class: cls, x, y: base - height, width: SLOT - 16, height, rx: 2 }) : null,
        w.minutes ? svg('text', { class: 'val', x: x + (SLOT - 16) / 2, y: base - height - 3, 'text-anchor': 'middle' }, document.createTextNode(String(w.minutes))) : null,
        svg('text', { class: 'wk', x: x + (SLOT - 16) / 2, y: base + 12, 'text-anchor': 'middle' },
          document.createTextNode(w.current ? 'Now' : shortDate(w.monday))),
      ];
    }),
    b.targetY != null ? svg('line', { class: 'target', x1: 0, x2: SLOT * weeks.length, y1: BAR_TOP + b.targetY, y2: BAR_TOP + b.targetY }) : null);
}

export function renderCardioTrend(ctx) {
  const doc = ctx.store.doc();
  if (!workouts(doc).length) return null;
  const { weeks, target } = cardioWeeks(doc, ctx.store.today());
  const full = weeks.filter((w) => !w.current);
  const average = Math.round(full.reduce((m, w) => m + w.minutes, 0) / full.length);
  const parts = [`Average ${average} min a week`];
  if (target) parts.push(`target ${target}`, `met ${full.filter((w) => w.minutes >= target).length} of the last ${full.length} weeks`);
  const label = weeks.map((w) => `${w.current ? 'this week so far' : `week of ${shortDate(w.monday)}`}: ${w.minutes} min`).join(', ');
  return h('section', { class: 'panel cardio-trend' },
    h('h2', {}, 'Cardio trend', h('span', { class: 'count' }, 'minutes a week')),
    h('div', { role: 'img', 'aria-label': `Cardio ${label}` }, bars(weeks, target)),
    h('p', { class: 'gym-note' }, parts.join(' · ')));
}
