// Daylight's day as one timeline (js/timeline.js has the order): the waiting check-in, then each
// row with a calendar time and each calendar commitment in start order with the now line between
// them, then "Any time today", tomorrow's line and the Tell Claude bar. The only place anything is
// ticked. The rows are the classic list's own (js/ui/today.js), so they keep everything they show.

import { h } from './dom.js';
import { timelineModel, tomorrowLine, mealMarkers } from '../timeline.js';
import { slotName } from '../food.js';
import { openSnap } from './snap.js';
import { todayRows } from '../schedule.js';
import { todaySlots, clockLabel, isPriority, readPlannerConfig } from '../calendar.js';
import { scheduleView } from '../plan-state.js';
import { gymHabitId, hevyTick, dayLines } from '../gym.js';
import { renderRow, enableDrag, listRows } from './today.js';
import { renderCheckin } from './checkin.js';
import { renderNote } from './note.js';
import { keptFocus, restoreFocus } from './side.js';

const JUST_DONE_MS = 1200;

// A tick sets ui.justTicked before the store re-renders (a capture listener runs before the
// checkbox's own), so the row comes back with a short gold burst.
function listenForTicks(root, ctx) {
  if (root.dataset.listening) return;
  root.dataset.listening = '1';
  root.addEventListener('change', (e) => {
    const box = e.target;
    if (!(box instanceof HTMLInputElement) || box.type !== 'checkbox' || !box.checked) return;
    const id = box.closest('li.row')?.dataset.id;
    if (!id) return;
    ctx.ui.justTicked = id;
    setTimeout(() => { if (ctx.ui.justTicked === id) ctx.ui.justTicked = null; }, JUST_DONE_MS);
  }, true);
}

export function renderTimeline(ctx) {
  const root = document.getElementById('timeline');
  const kept = keptFocus(root);
  listenForTicks(root, ctx);
  // Arranging moves tiles only: the day can't be ticked or dragged meanwhile (as the classic list).
  root.inert = !!ctx.ui.arranging;
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const rows = listRows(todayRows(doc, today));
  const slots = todaySlots(doc, today);
  const model = timelineModel({ rows, slots, commitments: scheduleView(doc, today).commitments, today, now: new Date(), markers: mealMarkers(doc, today) });
  const { config } = readPlannerConfig(doc);
  const gymId = gymHabitId(doc);

  // One row as the classic list draws it, marked with its area, its gym lines and its open note.
  const rowEls = (row) => {
    const isGym = !row.suggested && row.item.id === gymId;
    const li = renderRow(row, ctx, null, !row.suggested && isPriority(doc, row.item, config), isGym ? hevyTick(doc, gymId, today) : null);
    li.dataset.area = row.item.area || 'none';
    if (row.done && ctx.ui.justTicked === row.item.id) li.classList.add('just-done');
    const extra = [];
    if (isGym) for (const line of dayLines(doc, today)) extra.push(h('li', { class: 'tl-sub' }, line));
    if (row.item.notes && ctx.ui.noteFor === row.item.id) extra.push(h('li', { class: 'tl-sub note-row' }, row.item.notes));
    return { li, extra };
  };
  const clock = (iso, end = null) => h('span', { class: 'tl-time', title: end ? `${clockLabel(iso)}–${clockLabel(end)} in your calendar` : null }, clockLabel(iso));
  const nowLine = () => h('li', { class: 'tl-now', 'aria-label': `Now, ${clockLabel(new Date().toISOString())}` },
    clock(new Date().toISOString()), h('span', { class: 'tl-now-dot' }), h('span', { class: 'tl-now-line' }));

  const timed = [];
  model.timed.forEach((e, i) => {
    if (i === model.nowIndex) timed.push(nowLine());
    if (e.kind === 'meal') {
      timed.push(h('li', { class: 'tl-meal' }, clock(e.start), h('span', { class: 'tl-meal-mark', 'aria-hidden': 'true' }),
        h('button', { class: 'tl-meal-btn', type: 'button', onclick: () => openSnap(ctx, { slot: e.slot, start: e.start }) }, `${slotName(e.slot)}: snap it`)));
      return;
    }
    if (e.kind === 'commitment') {
      timed.push(h('li', { class: 'tl-busy' }, clock(e.start), h('span', { class: 'tl-busy-mark', 'aria-hidden': 'true' }),
        h('span', { class: 'tl-busy-card' }, h('span', {}, e.title), h('span', { class: 'tl-busy-when' }, `until ${clockLabel(e.end)}${e.calendar ? ` · ${e.calendar}` : ''}`))));
      return;
    }
    const { li, extra } = rowEls(e.row);
    li.classList.add('tl-entry');
    li.prepend(clock(e.start, e.end));
    timed.push(li, ...extra);
  });
  if (model.timed.length && model.nowIndex === model.timed.length) timed.push(nowLine());

  const anytime = model.anytime.flatMap((row) => {
    const { li, extra } = rowEls(row);
    if (!row.suggested && !row.blocked) enableDrag(li, row, ctx);
    return [li, ...extra];
  });

  const checkin = renderCheckin(ctx);
  const tomorrow = tomorrowLine(doc, today);
  const note = renderNote(ctx);
  note.classList.add('dl-note');
  root.replaceChildren(...[
    checkin ? h('ul', { class: 'tl-checkin' }, checkin) : null,
    ctx.ui.taskError ? h('p', { class: 'error', role: 'alert' }, ctx.ui.taskError,
      h('button', { class: 'link', type: 'button', onclick: () => { ctx.ui.taskError = null; ctx.render(); } }, 'Dismiss')) : null,
    rows.length ? null : h('p', { class: 'tl-empty' }, 'Nothing on today. Tell Claude what you want to get done.'),
    timed.length ? h('ol', { class: 'tl' }, timed) : null,
    anytime.length ? h('h3', { class: 'tl-any-h' }, 'Any time today') : null,
    anytime.length ? h('ul', { class: 'tl-any' }, anytime) : null,
    tomorrow ? h('p', { class: 'tl-tomorrow' }, `Tomorrow: ${tomorrow}`) : null,
    note,
  ].filter(Boolean));
  restoreFocus(root, kept);
}
