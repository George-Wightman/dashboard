// The list: everything on today, one row each, and the add box beneath it.

import { h } from './dom.js';
import { todayRows, streak, doneBetween } from '../schedule.js';
import { carryLabel, addDays, weekStart, shortWeekday } from '../dates.js';
import { formatProgress, formatAmount, parseAmount } from '../parse.js';

export const SOURCE_NAMES = { claude: 'Claude', gemini: 'Gemini', hebrew: 'Hebrew app', notion: 'Notion' };

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

function quotaControls(row, ctx) {
  const { store, ui } = ctx;
  const { item } = row;
  const count = h('span', {
    class: 'count', title: "Show this week's entries",
    onclick: () => { ui.entriesFor = ui.entriesFor === item.id ? null : item.id; ctx.render(); },
  }, quotaLabel(row));
  if (ui.amountFor === item.id) return [count, amountInput(item, ctx)];

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
  return [count, plus];
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

function renderMeta(row, ctx) {
  const doc = ctx.store.doc();
  const today = ctx.store.today();
  const { item } = row;
  const meta = h('span', { class: 'meta' });
  if (row.carriedFrom) meta.append(h('span', { class: 'carry' }, carryLabel(row.carriedFrom, today)));
  if (SOURCE_NAMES[item.source]) meta.append(h('span', { class: 'by' }, `added by ${SOURCE_NAMES[item.source]}`));
  if (item.area) meta.append(h('span', { class: 'tag' }, item.area));
  if (item.type !== 'task') {
    const s = streak(doc, item, today);
    const text = streakText(item, s);
    if (text) meta.append(h('span', { title: `Best: ${s.best}` }, text));
  }
  if (item.repeat?.kind === 'perWeek') {
    const ticks = doneBetween(doc, item.id, weekStart(today), addDays(today, 1));
    meta.append(h('span', {}, `${ticks} of ${item.repeat.n} this week`));
  }
  if (row.kind === 'quota') meta.append(...quotaControls(row, ctx));
  return meta;
}

function renderSuggestion(row, ctx) {
  const { store } = ctx;
  const { item } = row;
  return h('li', { class: 'row suggested', 'data-id': item.id },
    h('button', { class: 'accept', type: 'button', title: 'Add it', 'aria-label': `Accept ${item.title}`,
      onclick: () => store.acceptSuggestion('items', item.id) }, '✓'),
    h('span', { class: 'title' }, item.title),
    h('span', { class: 'meta' }, h('span', { class: 'by' }, `suggested by ${SOURCE_NAMES[item.source] ?? item.source}`)),
    h('button', { class: 'dismiss', type: 'button', title: 'Not for me', 'aria-label': `Dismiss ${item.title}`,
      onclick: () => store.dismissSuggestion('items', item.id) }, '✕'));
}

function renderRow(row, ctx) {
  if (row.suggested) return renderSuggestion(row, ctx);
  const { store } = ctx;
  const { item } = row;
  const li = h('li', { class: row.done ? 'row done' : 'row', 'data-id': item.id });
  li.append(row.kind === 'quota'
    ? h('span', { class: 'spacer' })
    : h('input', { type: 'checkbox', checked: row.done, 'aria-label': `Done: ${item.title}`,
      onchange: () => store.toggleDone(item.id, store.today()) }));
  li.append(h('span', { class: 'title', onclick: () => ctx.openEditor({ map: 'items', id: item.id }) }, item.title));
  li.append(renderMeta(row, ctx));
  return li;
}

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
    const ids = [...document.querySelectorAll('#list li.row[draggable="true"]')].map((el) => el.dataset.id);
    ctx.store.moveBefore(dragged, row.item.id, ids);
  });
}

export function renderToday(ctx) {
  const list = document.getElementById('list');
  const rows = todayRows(ctx.store.doc(), ctx.store.today());
  if (!rows.length) {
    list.replaceChildren(h('li', { class: 'empty' }, 'Nothing on today. Add a task below, or set up a habit.'));
    return;
  }
  const els = [];
  for (const row of rows) {
    const li = renderRow(row, ctx);
    if (!row.suggested) enableDrag(li, row, ctx);
    els.push(li);
    if (row.kind === 'quota' && ctx.ui.entriesFor === row.item.id) els.push(entriesList(row, ctx));
  }
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
    ctx.store.addItem({ type: 'task', title: text, date: day });
    title.value = '';
    title.focus();
  }

  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  });
  document.getElementById('add').addEventListener('submit', (e) => { e.preventDefault(); add(); });
  document.getElementById('add-more').addEventListener('click', () => ctx.openEditor({ map: 'items', type: 'habit' }));
}
