// The list: everything on today, one row each, and the add box beneath it.

import { h } from './dom.js';
import { todayRows, streak, doneBetween } from '../schedule.js';
import { carryLabel, addDays, weekStart } from '../dates.js';
import { formatProgress } from '../parse.js';

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

// Replaced in Task 10 with the + button and the amount input.
function quotaControls(row) {
  return [h('span', { class: 'count' }, quotaLabel(row))];
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

export function renderToday(ctx) {
  const list = document.getElementById('list');
  const rows = todayRows(ctx.store.doc(), ctx.store.today());
  if (!rows.length) {
    list.replaceChildren(h('li', { class: 'empty' }, 'Nothing on today. Add a task below, or set up a habit.'));
    return;
  }
  list.replaceChildren(...rows.map((row) => renderRow(row, ctx)));
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
