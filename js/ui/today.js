// The list: everything on today, one row each, and the add box beneath it. Every row fills the
// list's six columns — tick, title, source logo, tag, progress, + — so they line up down the page
// (styles.css). Weekly targets sit at the foot, under "This week".

import { h } from './dom.js';
import { todayRows, streak, doneBetween } from '../schedule.js';
import { carryLabel, addDays, weekStart, shortWeekday, forLabel } from '../dates.js';
import { formatProgress, formatAmount, parseAmount, splitTaskInput } from '../parse.js';
import { SOURCE_NAMES, sourceMark } from './sources.js';
import { todaySlots, timedOrder, clockLabel, isPriority, readPlannerConfig } from '../calendar.js';
import { gymHabitId, hevyTick, dayLines } from '../gym.js';

// Today's rows as the list shows them: everything else first (suggestions stay on top), then the
// weekly targets for the "This week" section, each part in todayRows' order.
export function splitRows(rows) {
  const isWeek = (r) => r.kind === 'quota' && !r.suggested;
  return { main: rows.filter((r) => !isWeek(r)), week: rows.filter(isWeek) };
}

// A weekly habit's dots: one per time a week, filled for each tick so far.
export function pipState(ticks, n) {
  return Array.from({ length: n }, (_, i) => i < ticks);
}

// "0/3", "1.5/5h": a weekly target's count in its row.
export const compactProgress = (total, target, unit) => formatProgress(total, target, unit).replace(' / ', '/');

function streakText(item, s) {
  if (s.current < 2) return null;
  if (item.type === 'quota' || item.repeat?.kind === 'perWeek') return `${s.current}-week streak`;
  if (item.repeat?.kind === 'daily') return `${s.current}-day streak`;
  return `${s.current} in a row`;
}

function quotaLabel(row) {
  const { item } = row;
  const unit = item.unit === 'count' && item.unitLabel ? ` ${item.unitLabel}` : '';
  return `${formatProgress(row.total, item.target, item.unit)}${unit} this week`;
}

// The title, one line; the whole of it on hover, but only when it has been cut short.
function titleEl(item, onclick) {
  return h('span', {
    class: 'title', onclick,
    onmouseenter: (e) => { const el = e.currentTarget; el.title = el.scrollWidth > el.clientWidth ? item.title : ''; },
  }, item.title);
}

function amountInput(item, ctx) {
  const { store, ui } = ctx;
  const minutes = item.unit === 'minutes';
  const input = h('input', {
    class: 'amount-input', type: 'text', inputmode: minutes ? 'text' : 'decimal',
    placeholder: minutes ? '45m · 1.5h' : 'amount', 'aria-label': `Amount for ${item.title}`,
  });
  const close = () => { ui.amountFor = null; ctx.render(); };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const value = parseAmount(input.value, item.unit);
    if (value == null) {
      input.classList.add('invalid');
      input.title = minutes ? 'Try 45m, 1.5h or 1h30' : 'Type a number above 0';
      return;
    }
    ui.amountFor = null;
    store.logAmount({ itemId: item.id, amount: value });
  });
  input.addEventListener('blur', () => { if (ui.amountFor === item.id) close(); });
  queueMicrotask(() => input.focus());
  return input;
}

// A weekly target's progress cell (the count and a thin bar, or the amount box while logging)
// and its + button.
function quotaCells(row, ctx) {
  const { store, ui } = ctx;
  const { item } = row;
  if (ui.amountFor === item.id) return { prog: amountInput(item, ctx), act: null };

  const pct = Math.min(100, Math.round((row.total / item.target) * 100));
  const count = h('span', {
    class: row.done ? 'count met' : 'count', title: `${quotaLabel(row)} · click to see the entries`,
    'aria-label': quotaLabel(row),
    onclick: () => { ui.entriesFor = ui.entriesFor === item.id ? null : item.id; ctx.render(); },
  }, compactProgress(row.total, item.target, item.unit),
  h('span', { class: 'mini-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${pct}%` })));

  const openInput = () => { ui.amountFor = item.id; ctx.render(); };
  const plus = h('button', {
    class: 'plus', type: 'button', 'aria-label': `Add to ${item.title}`,
    title: item.unit === 'minutes' ? 'Log time' : 'Click for +1 · Shift-click to type an amount',
  }, '+');
  plus.addEventListener('click', (e) => {
    if (item.unit === 'minutes' || e.shiftKey) openInput();
    else store.logAmount({ itemId: item.id, amount: 1 });
  });
  let pressTimer = null;
  plus.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && item.unit === 'count') pressTimer = setTimeout(openInput, 500);
  });
  const cancelPress = () => clearTimeout(pressTimer);
  plus.addEventListener('pointerup', cancelPress);
  plus.addEventListener('pointerleave', cancelPress);
  return { prog: count, act: plus };
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

// The progress cell: a streak, then a weekly habit's dots or a weekly target's count. Null when
// there's none of those.
function progressCell(row, ctx, quota) {
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
  if (quota) parts.push(quota.prog);
  return parts.length ? h('span', { class: 'prog' }, parts) : null;
}

function entriesList(row, ctx) {
  const { store } = ctx;
  const doc = store.doc();
  const start = weekStart(store.today());
  const end = addDays(start, 6);
  const logs = Object.values(doc.logs)
    .filter((l) => l.status === 'active' && l.kind === 'amount' && l.itemId === row.item.id && l.day >= start && l.day <= end)
    .sort((a, b) => ((a.at ?? '') < (b.at ?? '') ? -1 : 1));
  const items = logs.length
    ? logs.map((l) => h('li', {},
      h('span', {}, [
        `${shortWeekday(l.day)} · ${formatAmount(l.amount, row.item.unit)}`,
        l.note ? ` · ${l.note}` : '',
        SOURCE_NAMES[l.source] ? ` · ${SOURCE_NAMES[l.source]}` : '',
      ].join('')),
      h('button', { class: 'link', type: 'button', 'aria-label': 'Remove this entry', onclick: () => store.removeLog(l.id) }, 'remove')))
    : [h('li', {}, 'Nothing logged this week yet.')];
  return h('li', { class: 'entries-row' }, h('ul', { class: 'entries' }, items));
}

// Every suggestion shows at the top of Today, whatever its date; one for a later day (tomorrow's
// tasks from the check-in) says which day it's for.
function renderSuggestion(row, ctx) {
  const { store } = ctx;
  const { item } = row;
  const today = store.today();
  return h('li', { class: 'row suggested', 'data-id': item.id },
    h('button', { class: 'accept', type: 'button', title: 'Add it', 'aria-label': `Accept ${item.title}`,
      onclick: () => store.acceptSuggestion('items', item.id) }, '✓'),
    h('span', { class: 'title-cell' },
      titleEl(item, null),
      item.type === 'task' && item.date > today ? h('span', { class: 'for' }, forLabel(item.date, today)) : null),
    h('span', { class: 'meta' },
      sourceMark(item.source, 'suggested'),
      item.area ? h('span', { class: 'tag' }, item.area) : null),
    h('span', { class: 'act' },
      h('button', { class: 'dismiss', type: 'button', title: 'Not for me', 'aria-label': `Dismiss ${item.title}`,
        onclick: () => store.dismissSuggestion('items', item.id) }, '✕')));
}

// A row's notes mark: tap (or hover) to open the note under the row, as a weekly target opens its
// entries.
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
  const quota = row.kind === 'quota' ? quotaCells(row, ctx) : null;
  const cls = ['row', row.done && 'done', quota && 'quota'].filter(Boolean).join(' ');
  return h('li', { class: cls, 'data-id': item.id },
    quota
      ? h('span', { class: 'spacer' })
      : h('input', { type: 'checkbox', checked: row.done, 'aria-label': `Done: ${item.title}`,
        onchange: () => store.toggleDone(item.id, store.today()) }),
    h('span', { class: 'title-cell' },
      slot ? h('span', { class: 'time', title: `${clockLabel(slot.start)}–${clockLabel(slot.end)} in your calendar` }, clockLabel(slot.start)) : null,
      star ? h('span', { class: 'star', title: 'A priority', role: 'img', 'aria-label': 'A priority' }, '★') : null,
      titleEl(item, () => ctx.openEditor({ map: 'items', id: item.id })),
      via?.from && via?.at ? h('span', { class: 'via', title: 'Ticked by your Hevy workout' }, `via Hevy · ${clockLabel(via.from)}–${clockLabel(via.at)}`) : null,
      item.notes ? noteMark(item, ctx) : null,
      row.carriedFrom ? h('span', { class: 'carry' }, carryLabel(row.carriedFrom, store.today())) : null),
    h('span', { class: 'meta' },
      sourceMark(item.source, 'added'),
      item.area ? h('span', { class: 'tag' }, item.area) : null,
      progressCell(row, ctx, quota)),
    quota?.act ? h('span', { class: 'act' }, quota.act) : null);
}

// Dragging reorders within a row's own group: done or not, and the "This week" section or not.
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
    const group = (el) => `${el.classList.contains('done')}/${el.classList.contains('quota')}`;
    const groupIds = [...document.querySelectorAll('#list li.row[draggable="true"]')]
      .filter((el) => group(el) === group(draggedEl))
      .map((el) => el.dataset.id);
    ctx.store.moveBefore(dragged, row.item.id, groupIds);
  });
}

export function renderToday(ctx) {
  const list = document.getElementById('list');
  const rows = todayRows(ctx.store.doc(), ctx.store.today());
  if (!rows.length) {
    list.replaceChildren(h('li', { class: 'empty' }, 'Nothing on today. Add a task below, or set up a habit.'));
    return;
  }
  const { main, week } = splitRows(rows);
  const doc = ctx.store.doc();
  const slots = todaySlots(doc, ctx.store.today());
  const { config } = readPlannerConfig(doc);
  const today = ctx.store.today();
  const gymId = gymHabitId(doc);
  const els = [];
  const add = (row) => {
    const slot = row.suggested ? null : slots.get(row.item.id) ?? null;
    const isGym = !row.suggested && row.item.id === gymId;
    const li = renderRow(row, ctx, slot, !row.suggested && row.kind !== 'quota' && isPriority(doc, row.item, config),
      isGym ? hevyTick(doc, gymId, today) : null);
    // A row with a time follows the day's order, so only the others can be dragged.
    if (!row.suggested && !slot) enableDrag(li, row, ctx);
    els.push(li);
    if (isGym) for (const line of dayLines(doc, today)) els.push(h('li', { class: 'gym-line' }, line));
    if (row.item.notes && ctx.ui.noteFor === row.item.id) els.push(h('li', { class: 'note-row' }, row.item.notes));
    if (row.kind === 'quota' && ctx.ui.entriesFor === row.item.id) els.push(entriesList(row, ctx));
  };
  timedOrder(main, slots).forEach(add);
  if (week.length) els.push(h('li', { class: 'list-section' }, 'This week'));
  week.forEach(add);
  list.replaceChildren(...els);
}

export function initAddBox(ctx) {
  const title = document.getElementById('add-title');
  const when = document.getElementById('add-when');
  const date = document.getElementById('add-date');

  when.addEventListener('change', () => {
    date.hidden = when.value !== 'date';
    if (!date.hidden && !date.value) date.value = addDays(ctx.store.today(), 1);
  });

  function add() {
    const text = title.value.trim();
    if (!text) return;
    const today = ctx.store.today();
    let day = today;
    if (when.value === 'tomorrow') day = addDays(today, 1);
    if (when.value === 'date' && date.value) day = date.value;
    const { title: name, minutes, time } = splitTaskInput(text);
    ctx.store.addItem({ type: 'task', title: name, date: day, ...(minutes ? { minutes } : {}), ...(time ? { time } : {}) });
    title.value = '';
    title.focus();
  }

  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  });
  document.getElementById('add').addEventListener('submit', (e) => { e.preventDefault(); add(); });
  document.getElementById('add-more').addEventListener('click', () => ctx.openEditor({ map: 'items', type: 'habit' }));
}
