// The Countdown panel: the dates George is counting down to (js/calendar.js's countdowns), soonest
// first — the days left big, then what and when. He adds and removes them by telling the Coach.
// Nothing when there are none.

import { h } from './dom.js';
import { countdowns, daysLeft } from '../calendar.js';
import { shortWeekday, shortDate } from '../dates.js';

const SHOWN = 5;

export function renderCountdown(ctx) {
  const list = countdowns(ctx.store.doc(), ctx.store.today()).slice(0, SHOWN);
  if (!list.length) return null;
  return h('section', { class: 'panel countdown' },
    h('h2', {}, 'Countdown'),
    h('ul', { class: 'count-list' }, list.map((c) => {
      const [n, unit] = c.days > 1 ? [String(c.days), 'days'] : ['', daysLeft(c.days)];
      return h('li', { class: c.days <= 7 ? 'count-row soon' : 'count-row', title: `${c.title}: ${daysLeft(c.days)}` },
        h('span', { class: 'count-left' }, n ? h('span', { class: 'count-n' }, n) : null, h('span', { class: 'count-unit' }, unit)),
        h('span', { class: 'count-what' }, c.title),
        h('span', { class: 'count-when' }, `${shortWeekday(c.day)} ${shortDate(c.day)}`));
    })));
}
