// The Sunday letter (js/letter.js), as a page: opened from its notification (?big=letter) or from
// the week-in-review tile. The newest letter in full, the plan it proposes (nothing is booked until
// he says so), a button that opens Claude with it, and the earlier ones folded away.

import { h } from './dom.js';
import { openBig, bigSection } from './big.js';
import { latestLetter, letterFresh, replyUrl } from '../letter.js';
import { shortWeekday, shortDate } from '../dates.js';

const paras = (text) => text.split(/\n{2,}/).map((p) => h('p', { class: 'letter-p' }, p));

export function renderLetterBig(ctx) {
  const file = ctx.letters?.() ?? null;
  const l = latestLetter(file);
  if (!l) return h('p', { class: 'muted' }, 'No letter yet. Claude writes one on Sunday evenings.');
  const older = file.letters.slice(1);
  return h('div', { class: 'big letter' },
    h('p', { class: 'letter-title' }, l.title),
    h('p', { class: 'letter-when' }, `${shortWeekday(l.id)} ${shortDate(l.id)}`),
    l.parts.map((p) => bigSection(p.head, ...paras(p.text))),
    l.plan.length ? bigSection('Proposed for next week',
      h('ul', { class: 'letter-plan' }, l.plan.map((x) => h('li', {}, x))),
      h('p', { class: 'letter-note' }, 'Nothing is booked until you say so.')) : null,
    h('a', { class: 'dl-btn primary letter-reply', href: replyUrl(l.id), target: '_blank', rel: 'noopener' }, 'Reply in Claude'),
    older.length ? bigSection('Earlier letters', older.map((o) => h('details', { class: 'letter-old' },
      h('summary', {}, `${shortDate(o.id)}: ${o.title}`),
      o.parts.map((p) => h('div', {}, h('h4', {}, p.head), ...paras(p.text))),
      o.plan.length ? h('ul', { class: 'letter-plan' }, o.plan.map((x) => h('li', {}, x))) : null))) : null);
}

export const LETTER_VIEW = { id: 'letter', title: 'Your week', big: renderLetterBig };

export function openLetter(ctx) { openBig(ctx, LETTER_VIEW); }

// For the week-in-review tile: a button while the newest letter is still news, else nothing.
export function letterButton(ctx) {
  const l = latestLetter(ctx.letters?.() ?? null);
  if (!l || !letterFresh(l, ctx.store.today())) return null;
  return h('button', { class: 'dl-btn review-letter', type: 'button', onclick: () => openLetter(ctx) }, 'Read Sunday\'s letter');
}
