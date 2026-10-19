// Daylight's week in review (js/review.js): Saturday to Monday at the top of the tiles. Done against
// planned, every miss named with its day, what was pushed after the lock, the targets with numbers,
// and a hand-over to Claude to plan the next week. Opened big: the week day by day.

import { h } from './dom.js';
import { reviewWeek, PLAN_URL } from '../review.js';
import { shortWeekday, shortDate } from '../dates.js';
import { bigSection } from './big.js';

const hours = (m) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;

function stats(r) {
  return [
    r.hebrew ? `Hebrew ${hours(r.hebrew.minutes)} of ${Number((r.hebrew.target / 60).toFixed(1))} h` : null,
    r.cardio ? `Cardio ${r.cardio.minutes} of ${r.cardio.target} min` : null,
    r.protein ? `Protein on target ${r.protein.onTarget} of ${r.protein.days} days` : null,
    r.sessions ? `Sessions ${r.sessions.done} of ${r.sessions.planned}` : null,
    r.back ? `Back: ${r.back.sore ? `${r.back.sore} sore morning${r.back.sore === 1 ? '' : 's'}` : 'no sore mornings'}` : null,
  ].filter(Boolean);
}

const plan = () => h('a', { class: 'dl-btn primary review-plan', href: PLAN_URL, target: '_blank', rel: 'noopener' }, 'Plan next week with Claude');

export function renderReview(ctx) {
  const r = reviewWeek(ctx.store.doc(), ctx.store.today());
  if (!r || !r.total) return null;
  const shown = r.misses.slice(0, 6);
  return h('div', { class: 'review' },
    h('p', { class: 'tile-hero' }, h('span', { class: 'tile-num' }, `${r.done}/${r.total}`),
      h('span', { class: 'tile-cap' }, `done, ${shortWeekday(r.start)} ${shortDate(r.start)} to ${shortWeekday(r.end)}`)),
    r.misses.length
      ? h('p', { class: 'review-misses' }, h('strong', {}, 'Missed: '),
        shown.map((m) => `${m.title} (${shortWeekday(m.day)})`).join(', '), r.misses.length > shown.length ? `, and ${r.misses.length - shown.length} more` : '')
      : h('p', { class: 'review-misses' }, 'Nothing missed.'),
    r.pushed.length ? h('p', { class: 'review-pushed' }, h('strong', {}, 'Pushed after the lock: '),
      r.pushed.slice(0, 4).map((p) => `${p.title} (${shortWeekday(p.day)})`).join(', ')) : null,
    stats(r).length ? h('ul', { class: 'review-stats' }, stats(r).map((s) => h('li', {}, s))) : null,
    plan());
}

export function renderReviewBig(ctx) {
  const r = reviewWeek(ctx.store.doc(), ctx.store.today());
  if (!r) return null;
  return h('div', { class: 'big review' },
    bigSection('Day by day', h('table', { class: 'big-table' },
      h('tbody', {}, r.days.map((d) => h('tr', {},
        h('td', {}, `${shortWeekday(d.day)} ${shortDate(d.day)}`),
        h('td', { class: 'num' }, `${d.done} of ${d.total}`),
        h('td', {}, d.missed.length ? `missed ${d.missed.join(', ')}` : '')))))),
    stats(r).length ? bigSection('The targets', h('ul', { class: 'review-stats' }, stats(r).map((s) => h('li', {}, s)))) : null,
    plan());
}
