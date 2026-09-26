// The list: today's tasks and habits, one row each — the tick, then the title from the left and
// its logo and tag at the right. Nothing is added here: new work comes through Claude. A waiting
// check-in (js/ui/checkin.js) leads the list.
// Weekly targets aren't rows either: each is shown by the widget it belongs to — Cardio in Gym,
// Hebrew's in Hebrew, the rest in This week (js/ui/side.js).

import { h } from './dom.js';
import { todayRows, streak, doneBetween } from '../schedule.js';
import { carryLabel, addDays, weekStart, forLabel } from '../dates.js';
import { sourceMark } from './sources.js';
import { todaySlots, timedOrder, clockLabel, isPriority, readPlannerConfig } from '../calendar.js';
import { gymHabitId, hevyTick, dayLines } from '../gym.js';
import { openOutcome } from './outcome.js';
import { renderCheckin, tickAndAsk } from './checkin.js';

// A weekly habit's dots: one per time a week, filled for each tick so far.
export function pipState(ticks, n) {
  return Array.from({ length: n }, (_, i) => i < ticks);
}

function streakText(item, s) {
  if (s.current < 2) return null;
  if (item.repeat?.kind === 'perWeek') return `${s.current}-week streak`;
  if (item.repeat?.kind === 'daily') return `${s.current}-day streak`;
  return `${s.current} in a row`;
}

// The title, one line; the whole of it on hover, but only when it has been cut short.
function titleEl(item, onclick) {
  return h('span', {
    class: 'title', onclick,
    onmouseenter: (e) => { const el = e.currentTarget; el.title = el.scrollWidth > el.clientWidth ? item.title : ''; },
  }, item.title);
}

// A weekly habit's dots (teal as ticked, all gold once met); a count for more than seven a week.
function weekDots(doc, item, today) {
  const { n } = item.repeat;
  const ticks = doneBetween(doc, item.id, weekStart(today), addDays(today, 1));
  const label = `${ticks} of ${n} this week`;
  const met = ticks >= n;
  if (!(Number.isInteger(n) && n >= 1 && n <= 7)) return h('span', { class: met ? 'met' : null, title: label }, `${ticks}/${n}`);
  return h('span', { class: met ? 'pips met' : 'pips', title: label, role: 'img', 'aria-label': label },
    pipState(ticks, n).map((on) => h('i', { class: on ? 'pip on' : 'pip' })));
}

// A habit's streak and weekly dots, which sit just left of its logo and tag. Null when it has
// neither.
function progressCell(row, ctx) {
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const { item } = row;
  const parts = [];
  if (item.type !== 'task') {
    const s = streak(doc, item, today);
    const text = streakText(item, s);
    if (text) parts.push(h('span', { class: 'streak', title: `Best: ${s.best}` }, text));
  }
  if (item.repeat?.kind === 'perWeek') parts.push(weekDots(doc, item, today));
  return parts.length ? h('span', { class: 'prog' }, parts) : null;
}

// Every suggestion shows at the top of Today, whatever its date; one for a later day (tomorrow's
// tasks from the check-in) says which day it's for.
function renderSuggestion(row, ctx) {
  const { store } = ctx;
  const { item } = row;
  const today = store.today();
  return h('li', { class: 'row suggested no-prog', 'data-id': item.id },
    h('button', { class: 'accept', type: 'button', title: 'Add it', 'aria-label': `Accept ${item.title}`,
      onclick: () => store.acceptSuggestion('items', item.id) }, '✓'),
    mainCell(
      h('span', { class: 'title-cell' },
        titleEl(item, null),
        item.type === 'task' && item.date > today ? h('span', { class: 'for' }, forLabel(item.date, today)) : null),
      sourceMark(item.source, 'suggested'), item.area),
    h('span', { class: 'act' },
      h('button', { class: 'dismiss', type: 'button', title: 'Not for me', 'aria-label': `Dismiss ${item.title}`,
        onclick: () => store.dismissSuggestion('items', item.id) }, '✕')));
}

// A row's second cell: the title (from the left), then its logo and tag (at the right). A habit's
// streak and weekly dots (`lead`) sit just left of the logo, so every tag ends on the same line.
function mainCell(titleCell, mark, area, lead = null) {
  const meta = lead || mark || area ? h('span', { class: 'meta' }, lead, mark, area ? h('span', { class: 'tag' }, area) : null) : null;
  return h('span', { class: 'main' }, titleCell, meta);
}

// A row's notes mark: tap (or hover) to open the note under the row.
function noteMark(item, ctx) {
  const open = ctx.ui.noteFor === item.id;
  return h('button', {
    class: 'note-mark', type: 'button', title: item.notes, 'aria-label': `Notes: ${item.title}`, 'aria-expanded': String(open),
    onclick: () => { ctx.ui.noteFor = open ? null : item.id; ctx.render(); },
  }, '≡');
}

// `via` is a Hevy workout's tick ({ from, at }): the row says when he trained.
function renderRow(row, ctx, slot = null, star = false, via = null) {
  if (row.suggested) return renderSuggestion(row, ctx);
  const { store } = ctx;
  const { item } = row;
  const cls = ['row', row.done && 'done', 'no-prog', 'bare'].filter(Boolean).join(' ');
  return h('li', { class: cls, 'data-id': item.id },
    h('input', { type: 'checkbox', checked: row.done, disabled: !!row.blocked, 'aria-label': `Done: ${item.title}`,
        onchange: (e) => {
          if (!row.done && item.details?.outcomeForm?.length) { e.target.checked = false; openOutcome(ctx, item.id, true); return; }
          try { tickAndAsk(ctx, item.id); }
          catch (error) { ctx.ui.taskError = error.message; ctx.render(); }
        } }),
    mainCell(h('span', { class: 'title-cell' },
      slot ? h('span', { class: 'time', title: `${clockLabel(slot.start)}–${clockLabel(slot.end)} in your calendar` }, clockLabel(slot.start)) : null,
      star ? h('span', { class: 'star', title: 'A priority', role: 'img', 'aria-label': 'A priority' }, '★') : null,
      item.pinned ? h('span', { class: 'pin', title: 'Pinned to this slot — take the pin off its calendar block to let it move again', role: 'img', 'aria-label': 'Pinned to this slot' }, '📌') : null,
      titleEl(item, () => ctx.openEditor({ map: 'items', id: item.id })),
      via?.from && via?.at ? h('span', { class: 'via', title: 'Ticked by your Hevy workout' }, `via Hevy · ${clockLabel(via.from)}–${clockLabel(via.at)}`) : null,
      item.notes ? noteMark(item, ctx) : null,
      row.blocked ? h('span', { class: 'carry', title: row.blocked.join('; ') }, 'Waiting') : null,
      item.details?.deadline ? h('span', { class: 'carry', title: 'Target deadline (does not reschedule automatically)' }, `by ${item.details.deadline}`) : null,
      row.carriedFrom ? h('span', { class: 'carry' }, carryLabel(row.carriedFrom, store.today())) : null),
    sourceMark(item.source, 'added'), item.area, progressCell(row, ctx)));
}

// Dragging reorders within a row's own group: done or not.
function enableDrag(li, row, ctx) {
  li.draggable = true;
  li.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', row.item.id);
    e.dataTransfer.effectAllowed = 'move';
    li.classList.add('dragging');
  });
  li.addEventListener('dragend', () => li.classList.remove('dragging'));
  li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('drop-before'); });
  li.addEventListener('dragleave', () => li.classList.remove('drop-before'));
  li.addEventListener('drop', (e) => {
    e.preventDefault();
    li.classList.remove('drop-before');
    const dragged = e.dataTransfer.getData('text/plain');
    if (!dragged || dragged === row.item.id) return;
    const draggedEl = [...document.querySelectorAll('#list li.row')].find((el) => el.dataset.id === dragged);
    if (!draggedEl) return;
    const group = (el) => el.classList.contains('done');
    const groupIds = [...document.querySelectorAll('#list li.row[draggable="true"]')]
      .filter((el) => group(el) === group(draggedEl))
      .map((el) => el.dataset.id);
    ctx.store.moveBefore(dragged, row.item.id, groupIds);
  });
}

// Today's rows as the list shows them: everything but a weekly target that has been taken on (a
// suggested one still waits here for ✓ or ✕).
export const listRows = (rows) => rows.filter((r) => r.kind !== 'quota' || r.suggested);

export function renderToday(ctx) {
  const list = document.getElementById('list');
  const rows = listRows(todayRows(ctx.store.doc(), ctx.store.today()));
  const checkin = renderCheckin(ctx);
  if (!rows.length) {
    list.replaceChildren(...[checkin, h('li', { class: 'empty' }, 'Nothing on today. Tell Claude what you want to get done.')].filter(Boolean));
    return;
  }
  const doc = ctx.store.doc();
  const slots = todaySlots(doc, ctx.store.today());
  const { config } = readPlannerConfig(doc);
  const today = ctx.store.today();
  const gymId = gymHabitId(doc);
  const els = checkin ? [checkin] : [];
  if (ctx.ui.taskError) els.push(h('li', { class: 'note-row error', role: 'alert' }, ctx.ui.taskError,
    h('button', { class: 'link', type: 'button', onclick: () => { ctx.ui.taskError = null; ctx.render(); } }, 'Dismiss')));
  const add = (row) => {
    const slot = row.suggested ? null : slots.get(row.item.id) ?? null;
    const isGym = !row.suggested && row.item.id === gymId;
    const li = renderRow(row, ctx, slot, !row.suggested && isPriority(doc, row.item, config),
      isGym ? hevyTick(doc, gymId, today) : null);
    // A row with a time follows the day's order, so only the others can be dragged.
    if (!row.suggested && !slot && !row.blocked) enableDrag(li, row, ctx);
    els.push(li);
    if (isGym) for (const line of dayLines(doc, today)) els.push(h('li', { class: 'gym-line' }, line));
    if (row.item.notes && ctx.ui.noteFor === row.item.id) els.push(h('li', { class: 'note-row' }, row.item.notes));
  };
  timedOrder(rows, slots).forEach(add);
  list.replaceChildren(...els);
}
