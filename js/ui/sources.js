// Who added something, shown as a small mark in its row: Claude's spark or Gemini's four-point
// star. The shapes follow the companies' marks; the colour is the app's muted ink (currentColor),
// because teal and gold already mean "act on this" and "you did this". The words — "added by
// Claude" — are the hover text and what a screen reader hears. A new source gets a logo here, not
// words in the row; only a source the app doesn't know falls back to them.

import { h } from './dom.js';

export const SOURCE_NAMES = { claude: 'Claude', gemini: 'Gemini', hebrew: 'Hebrew app', notion: 'Notion', workflow: 'a follow-up rule' };

const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
const RAYS = [[12, 2.5], [18.5, 4.5], [21.5, 10], [20, 17.5], [14, 21.5], [7, 20.5], [2.5, 15], [3, 7.5], [7.5, 3]];

export const LOGOS = {
  claude: svg(`<g stroke="currentColor" stroke-width="2.1" stroke-linecap="round">${
    RAYS.map(([x, y]) => `<line x1="12" y1="12" x2="${x}" y2="${y}"/>`).join('')}</g>`),
  gemini: svg('<path fill="currentColor" d="M12 1.5C12.6 7.2 16.8 11.4 22.5 12 16.8 12.6 12.6 16.8 12 22.5 11.4 16.8 7.2 12.6 1.5 12 7.2 11.4 11.4 7.2 12 1.5Z"/>'),
  // The Hebrew app's own mark: a shin (ש) and the full stop beside it, drawn as strokes.
  hebrew: svg('<g fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M3.5 4.5 7 19h9.5V4.5M10 4.5l2 9.5M2.5 4.5h2.4M9 4.5h2.4M15.3 4.5h2.4"/></g>'
    + '<circle cx="21" cy="18" r="1.6" fill="currentColor"/>'),
  notion: svg('<rect x="3.5" y="3" width="17" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>'
    + '<path d="M8.5 16.5v-9l7 9v-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  workflow: svg('<path d="M5 5h9a5 5 0 0 1 0 10H5m4-4-4 4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
};

// "added by Claude", "suggested by Gemini". Null for your own things ('me') and for an added thing
// from a source the app doesn't know; a suggestion always says who it's from.
export function sourceLabel(source, verb = 'added') {
  const name = SOURCE_NAMES[source] ?? (verb === 'suggested' && source ? source : null);
  return name ? `${verb} by ${name}` : null;
}

// The mark for a row: the logo with its words on hover, the words alone when there's no logo, or
// null when there's nothing to say.
export function sourceMark(source, verb = 'added') {
  const label = sourceLabel(source, verb);
  if (!label) return null;
  if (!LOGOS[source]) return h('span', { class: 'by' }, label);
  const el = h('span', { class: 'src', title: label, role: 'img', 'aria-label': label });
  el.innerHTML = LOGOS[source]; // a fixed string from this file, never data
  return el;
}
