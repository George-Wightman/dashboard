// Daylight's day as one timeline (js/timeline.js has the order): the waiting check-in, then each
// row with a calendar time and each calendar commitment in start order with the now line between
// them, then "Any time today", tomorrow's line and the Tell Claude bar. The only place anything is
// ticked. The rows are the classic list's own (js/ui/today.js), so they keep everything they show.
// ‹ on the heading goes back to a past day, up to a week, to tick what didn't get ticked then: the
// day as it was booked, with no now line, no dragging and nothing of today's (suggestions, the back
// question, tomorrow's line).

import { h } from './dom.js';
import { timelineModel, tomorrowLine, mealMarkers, movedSlot, stepDay, dayHeading } from '../timeline.js';
import { slotName } from '../food.js';
import { openSnap } from './snap.js';
import { todayRows } from '../schedule.js';
import { todaySlots, clockLabel, isPriority, readPlannerConfig } from '../calendar.js';
import { scheduleView } from '../plan-state.js';
import { gymHabitId, hevyTick, dayLines } from '../gym.js';
import { renderRow, listRows, renderMealsRow } from './today.js';
import { enableTimeDrag } from './timedrag.js';
import { renderCheckin, dayOf } from './checkin.js';
import { renderBackRow, sessionExtras } from './coach.js';
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

// The heading: ‹ Today ›, and "Back to today" while a past day shows.
function renderHeading(ctx, day, today) {
  const el = document.getElementById('dl-today-h');
  if (!el) return;
  const go = (by) => { ctx.ui.viewDay = by ? stepDay(ctx.ui.viewDay, today, by) : null; ctx.render(); };
  const back = stepDay(ctx.ui.viewDay, today, -1);
  const label = dayHeading(day, today);
  el.replaceChildren(...[
    h('button', { class: 'day-step', type: 'button', disabled: !back || back === day, title: 'The day before', 'aria-label': 'Show the day before', onclick: () => go(-1) }, '‹'),
    h('span', { class: 'day-name' }, label),
    day < today ? h('button', { class: 'day-step', type: 'button', title: 'The day after', 'aria-label': 'Show the day after', onclick: () => go(1) }, '›') : null,
    day < today ? h('button', { class: 'link day-today', type: 'button', onclick: () => go(0) }, 'Back to today') : null,
  ].filter(Boolean));
  document.getElementById('dl-today')?.classList.toggle('past', day < today);
}

export function renderTimeline(ctx) {
  const root = document.getElementById('timeline');
  // Mid-drag the rows stay put; the drop redraws.
  if (ctx.ui.timelineDrag) return;
  const kept = keptFocus(root);
  listenForTicks(root, ctx);
  enableTimeDrag(root, ctx);
  // Arranging moves tiles only: the day can't be ticked or dragged meanwhile (as the classic list).
  root.inert = !!ctx.ui.arranging;
  const doc = ctx.store.doc();
  // `today` is the day showing: a past day when ‹ has gone back to one.
  const today = dayOf(ctx);
  const past = today < ctx.store.today();
  renderHeading(ctx, today, ctx.store.today());
  // A past day: its own rows as they were, without today's suggestions.
  const rows = listRows(todayRows(doc, today)).filter((r) => !(past && r.suggested));
  // A task moved here (a drag, or Claude) shows at its new time before the planner books it there.
  const slots = new Map(todaySlots(doc, today));
  for (const row of rows) {
    if (row.suggested) continue;
    const s = movedSlot(row.item, slots.get(row.item.id), today);
    if (s) slots.set(row.item.id, s);
  }
  const draggable = (row) => !past && !row.suggested && !row.blocked && !row.done;
  const model = timelineModel({ rows, slots, commitments: scheduleView(doc, today).commitments, today, now: new Date(), markers: mealMarkers(doc, today) });
  const { config } = readPlannerConfig(doc);
  const gymId = gymHabitId(doc);

  // One row as the classic list draws it, marked with its area, its gym lines, a coach's session
  // (its exercises, and the sore-back warning) and its open note.
  const rowEls = (row) => {
    const isGym = !row.suggested && row.item.id === gymId;
    const via = isGym ? hevyTick(doc, gymId, today) : row.item.session ? hevyTick(doc, row.item.id, today) : null;
    const li = renderRow(row, ctx, null, !row.suggested && isPriority(doc, row.item, config), via);
    li.dataset.area = row.item.area || 'none';
    if (row.done && ctx.ui.justTicked === row.item.id) li.classList.add('just-done');
    const extra = [];
    if (isGym) for (const line of dayLines(doc, today)) extra.push(h('li', { class: 'tl-sub' }, line));
    extra.push(...sessionExtras(ctx, row));
    if (row.item.notes && ctx.ui.noteFor === row.item.id) extra.push(h('li', { class: 'tl-sub note-row' }, row.item.notes));
    return { li, extra };
  };
  const clock = (iso, end = null) => h('span', { class: 'tl-time', title: end ? `${clockLabel(iso)}–${clockLabel(end)} in your calendar` : null }, clockLabel(iso));
  const nowLine = () => h('li', { class: 'tl-now', 'aria-label': `Now, ${clockLabel(new Date().toISOString())}` },
    clock(new Date().toISOString()), h('span', { class: 'tl-now-dot' }), h('span', { class: 'tl-now-line' }));

  const timed = [];
  model.timed.forEach((e, i) => {
    if (!past && i === model.nowIndex) timed.push(nowLine());
    if (e.kind === 'meal') {
      timed.push(h('li', { class: 'tl-meal' }, clock(e.start), h('span', { class: 'tl-meal-mark', 'aria-hidden': 'true' }),
        h('button', { class: 'tl-meal-btn', type: 'button', onclick: () => openSnap(ctx, { slot: e.slot, start: e.start }) }, `${slotName(e.slot)}: log it`)));
      return;
    }
    if (e.kind === 'commitment') {
      timed.push(h('li', { class: 'tl-busy', 'data-start': e.start, 'data-end': e.end }, clock(e.start), h('span', { class: 'tl-busy-mark', 'aria-hidden': 'true' }),
        h('span', { class: 'tl-busy-card' }, h('span', {}, e.title), h('span', { class: 'tl-busy-when' }, `until ${clockLabel(e.end)}${e.calendar ? ` · ${e.calendar}` : ''}`))));
      return;
    }
    const { li, extra } = rowEls(e.row);
    li.classList.add('tl-entry');
    Object.assign(li.dataset, { start: e.start, end: e.end });
    if (e.row.item.type === 'task' && draggable(e.row)) li.dataset.drag = '1';
    const moving = slots.get(e.row.item.id)?.state === 'moving';
    if (moving) li.classList.add('tl-moving');
    const time = clock(e.start, e.end);
    if (moving) time.title = 'Moved here: its calendar block follows within 10 minutes';
    li.prepend(time);
    timed.push(li, ...extra);
  });
  if (!past && model.timed.length && model.nowIndex === model.timed.length) timed.push(nowLine());

  const anytime = model.anytime.flatMap((row) => {
    const { li, extra } = rowEls(row);
    if (draggable(row)) li.dataset.drag = '1';
    return [li, ...extra];
  });
  const meals = renderMealsRow(ctx);
  if (meals) anytime.push(meals);

  const back = past ? null : renderBackRow(ctx);
  const checkin = renderCheckin(ctx);
  const tomorrow = past ? null : tomorrowLine(doc, today);
  root.replaceChildren(...[
    back ? h('ul', { class: 'tl-checkin tl-backq' }, back) : null,
    checkin ? h('ul', { class: 'tl-checkin' }, checkin) : null,
    ctx.ui.taskError ? h('p', { class: 'error', role: 'alert' }, ctx.ui.taskError,
      h('button', { class: 'link', type: 'button', onclick: () => { ctx.ui.taskError = null; ctx.render(); } }, 'Dismiss')) : null,
    rows.length ? null : h('p', { class: 'tl-empty' }, past ? 'Nothing was on that day.' : 'Nothing on today. Tell Claude what you want to get done.'),
    timed.length ? h('ol', { class: 'tl' }, timed) : null,
    anytime.length ? h('h3', { class: 'tl-any-h' }, past ? 'Any time that day' : 'Any time today') : null,
    anytime.length ? h('ul', { class: 'tl-any' }, anytime) : null,
    tomorrow ? h('p', { class: 'tl-tomorrow' }, `Tomorrow: ${tomorrow}`) : null,
  ].filter(Boolean));
  restoreFocus(root, kept);
}
