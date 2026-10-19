// Daylight's Needs you tile: what needs a decision, in plain words (js/needs.js), with the choice
// spelled out on its buttons. Resolving goes through the classic Upcoming's own path. Shows nothing
// when nothing needs George.

import { h } from './dom.js';
import { needsEntries, needsCopy } from '../needs.js';
import { resolveConflict, openTaskCard } from './agenda.js';
import { zoneWarning } from '../travel.js';
import { plannerStatus } from '../calendar.js';

const SHOWN = 5;

export function renderNeeds(ctx) {
  const doc = ctx.store.doc();
  const needs = needsEntries(doc, ctx.store.today());
  // The planner booking in another time zone from this device's (after a move): every block is out.
  const zone = zoneWarning({ plannerZone: plannerStatus(doc)?.timeZone, deviceZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  if (!needs.length && !ctx.ui.needsError && !zone) return null;
  const shown = ctx.ui.needsExpanded ? needs : needs.slice(0, SHOWN);
  return h('div', { class: 'needs' },
    ctx.ui.needsError ? h('p', { class: 'error', role: 'status' }, ctx.ui.needsError) : null,
    zone ? h('p', { class: 'needs-text needs-zone', role: 'status' }, zone) : null,
    shown.map((e) => {
      const { text, choices } = needsCopy(e, doc);
      return h('div', { class: 'needs-entry', 'data-task': e.item.id },
        h('p', { class: 'needs-text' }, text, ' ',
          h('button', { class: 'link needs-open', type: 'button', onclick: () => openTaskCard(ctx, e.item.id) }, 'Open')),
        choices.length ? h('div', { class: 'needs-choices' }, choices.map(({ choice, label }, i) => h('button', {
          class: i === 0 ? 'dl-btn primary' : 'dl-btn', type: 'button',
          onclick: () => {
            try { resolveConflict(ctx, e.item.id, choice); ctx.ui.needsError = ''; }
            catch (error) { ctx.ui.needsError = error.message; }
            ctx.render();
          },
        }, label))) : null);
    }),
    needs.length > SHOWN ? h('button', { class: 'link', type: 'button', onclick: () => { ctx.ui.needsExpanded = !ctx.ui.needsExpanded; ctx.render(); } },
      ctx.ui.needsExpanded ? 'Show fewer' : `${needs.length - SHOWN} more need you`) : null);
}
