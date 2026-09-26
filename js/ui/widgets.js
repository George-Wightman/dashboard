// The widgets: the panels under Today's list (#under) and beside it (#side), drawn where George
// arranges them. The arrangement is device-local (js/layout.js, localStorage['dash_layout']);
// ctx.layout() is the current one and ctx.columnCount() says whether the window shows two widget
// columns beside the list or one. Today's list is not a widget: it always stays in the first column.
//
// Arrange mode (ctx.ui.arranging, toggled by setArranging): every visible widget gets a dashed
// frame with a grip (or ↑ ↓ on touch and in the one-column view) and Hide; hidden ones wait below
// as "+ Title" chips. Dragging follows js/ui/today.js's row drag and drop.

import { h } from './dom.js';
import { renderAgenda } from './agenda.js';
import { renderNote } from './note.js';
import { renderWeek, renderGoals, renderHistory, renderHistoryBig, keptFocus, restoreFocus } from './side.js';
import { renderGym, renderGymBig } from './gym.js';
import { renderMuscles, renderCardioTrend } from './training.js';
import { renderHebrew, renderHebrewBig } from './hebrew.js';
import { openBig, makeOpener } from './big.js';
import { renderCountdown } from './countdown.js';
import { visibleColumns, visibleUnder, moveWidget, nudgeWidget, hideWidget, showWidget, UNDER } from '../layout.js';

// The registry. A widget's render(ctx) returns its element, or null when it has nothing to show
// (This week when every target is shown elsewhere or paused), and is then left out (outside
// Arrange mode, which shows a placeholder instead so an empty widget can still be moved). A new
// widget is one more line here:
// normalizeLayout puts an id it hasn't seen before at the end of the first column.
//
// A widget with more to show than fits has a `big` view (js/ui/big.js): its heading opens it.
export const WIDGETS = [
  { id: 'note', title: 'Note for Claude', render: renderNote },
  { id: 'agenda', title: 'Upcoming', render: renderAgenda },
  { id: 'countdown', title: 'Countdown', render: renderCountdown },
  { id: 'week', title: 'This week', render: renderWeek },
  { id: 'goals', title: 'Goals', render: renderGoals },
  { id: 'history', title: 'Last 3 weeks', render: renderHistory, big: renderHistoryBig },
  { id: 'hebrew', title: 'Hebrew', render: renderHebrew, big: renderHebrewBig },
  { id: 'gym', title: 'Gym', render: renderGym, big: renderGymBig },
  { id: 'muscles', title: 'Muscles', render: renderMuscles },
  { id: 'cardio', title: 'Cardio trend', render: renderCardioTrend },
];
export const WIDGET_IDS = WIDGETS.map((w) => w.id);
const BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));
const titleOf = (id) => BY_ID.get(id)?.title ?? id;

// One widget's element, marked with its id; null when it has nothing to show. Outside Arrange
// mode a widget that opens big has its heading made the way in.
function widgetEl(ctx, id) {
  const w = BY_ID.get(id);
  const el = w?.render(ctx) ?? null;
  if (!el) return null;
  el.dataset.widget = id;
  const open = w.big ? (c) => openBig(c, w) : null;
  if (open && !ctx.ui.arranging) makeOpener(el.querySelector('h2'), w.title, () => open(ctx), { mark: !!w.big });
  return el;
}

// Turns Arrange mode on or off (the header's Arrange/Done link, and Escape).
export function setArranging(ctx, on) {
  ctx.ui.arranging = on;
  ctx.render();
}

// ---- Arrange mode -------------------------------------------------------------------------------

// ↑ ↓ replace the grip on a touch device, and whenever only one widget column shows — a window
// under 1500px, where dragging between "columns" would have nothing to land on. They step through
// the widgets in reading order: under the list, then the columns. matchMedia is
// read lazily (not every environment that imports this module has one, e.g. the Node tests).
const isCoarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const useNudge = (ctx) => ctx.columnCount() === 1 || isCoarsePointer();

// A frame is a drop target: dragover accepts a widget being dragged (and only that), drop moves
// it to just before this frame in `col` (UNDER, 0 or 1). Mirrors js/ui/today.js's row drag and drop.
function enableDropBefore(el, ctx, col, beforeId) {
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/x-widget')) return;
    e.preventDefault();
    el.classList.add('drop-before');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-before'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drop-before');
    const dragged = e.dataTransfer.getData('text/x-widget');
    if (dragged) ctx.setLayout(moveWidget(ctx.layout(), dragged, col, beforeId));
  });
}

// One widget while arranging: a dashed frame with a grip or ↑ ↓, its title and Hide, and its
// content — or a placeholder when it has nothing to show, so it can still be moved.
function widgetFrame(ctx, id, col) {
  const title = titleOf(id);
  const bar = h('div', { class: 'widget-bar' });
  if (useNudge(ctx)) {
    bar.append(
      h('button', {
        class: 'nudge', type: 'button', 'aria-label': `Move ${title} up`,
        onclick: () => ctx.setLayout(nudgeWidget(ctx.layout(), id, -1)),
      }, '↑'),
      h('button', {
        class: 'nudge', type: 'button', 'aria-label': `Move ${title} down`,
        onclick: () => ctx.setLayout(nudgeWidget(ctx.layout(), id, 1)),
      }, '↓'));
  } else {
    const grip = h('span', { class: 'grip', draggable: 'true', title: 'Drag to move' }, '⋮⋮');
    grip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-widget', id);
      e.dataTransfer.effectAllowed = 'move';
    });
    bar.append(grip);
  }
  bar.append(
    h('span', { class: 'widget-title' }, title),
    h('button', { class: 'link', type: 'button', onclick: () => ctx.setLayout(hideWidget(ctx.layout(), id)) }, 'Hide'));
  const content = widgetEl(ctx, id) ?? h('p', { class: 'muted placeholder' }, 'Nothing to show yet');
  // pointer-events: none (styles.css) keeps the mouse off a widget's own controls while it's just
  // being moved; inert keeps Tab off them too. Only the content, never the bar (grip/Hide/arrows).
  content.inert = true;
  const frame = h('div', { class: 'widget-frame', 'data-widget': id }, bar, content);
  enableDropBefore(frame, ctx, col, id);
  return frame;
}

// A column's empty drop zone: dropping here puts the widget at the end of `col`.
function dropZone(ctx, col, text = 'Drop here') {
  const zone = h('div', { class: 'drop-zone', 'data-col': col }, text);
  enableDropBefore(zone, ctx, col, null);
  return zone;
}

// Hidden widgets, as "+ Title" chips that bring one back at the end of column 0. null when none
// are hidden.
function addWidgetRow(ctx) {
  const hidden = ctx.layout().hidden;
  if (!hidden.length) return null;
  return h('div', { class: 'add-widget' },
    h('span', { class: 'muted' }, 'Add a widget:'),
    hidden.map((id) => h('button', {
      class: 'chip', type: 'button', onclick: () => ctx.setLayout(showWidget(ctx.layout(), id)),
    }, `+ ${titleOf(id)}`)));
}

// Two widget columns, each with a trailing drop zone.
function twoColumnFrames(ctx, layout) {
  return visibleColumns(layout, 2).map((ids, col) => h('div', { class: 'widget-col', 'data-col': col },
    ids.map((id) => widgetFrame(ctx, id, col)), dropZone(ctx, col)));
}

// One column: column 0's frames, a divider showing where the second column would start on a wide
// window, then column 1's — always both, so a nudge across the boundary is visible even when a
// side is empty. No drag here (↑ ↓ only), so no drop zones.
function oneColumnFrames(ctx, layout) {
  const [first, second] = visibleColumns(layout, 2);
  return [h('div', { class: 'widget-col', 'data-col': 0 },
    first.map((id) => widgetFrame(ctx, id, 0)),
    h('div', { class: 'column-break', role: 'separator' }, 'Second column on wide windows'),
    second.map((id) => widgetFrame(ctx, id, 1)))];
}

function renderArranging(ctx, side, count) {
  const columns = count >= 2 ? twoColumnFrames(ctx, ctx.layout()) : oneColumnFrames(ctx, ctx.layout());
  const addRow = addWidgetRow(ctx);
  side.replaceChildren(...columns, ...(addRow ? [addRow] : []));
}

// Under the list while arranging: its frames, then somewhere to drop (or, with ↑ ↓, a word on how
// to get a widget here), so the space shows even when it's empty.
function underFrames(ctx) {
  const frames = visibleUnder(ctx.layout()).map((id) => widgetFrame(ctx, id, UNDER));
  const end = useNudge(ctx)
    ? (frames.length ? null : h('div', { class: 'drop-zone' }, 'Under the list: ↑ on the top widget beside it moves it here'))
    : dropZone(ctx, UNDER, 'Drop here to put it under the list');
  return [...frames, ...(end ? [end] : [])];
}

// ---- Normal mode and the shared entry point ------------------------------------------------------

// Redraws both widget areas (#under and #side) from the arrangement. A text box marked data-focus
// gets its focus and caret back afterwards (its text comes back from ctx.ui), so typing carries on.
export function renderSide(ctx) {
  const side = document.getElementById('side');
  const under = document.getElementById('under');
  const kept = keptFocus(side) ?? keptFocus(under);
  const count = ctx.columnCount();
  side.dataset.columns = String(count);
  if (ctx.ui.arranging) {
    renderArranging(ctx, side, count);
    under.replaceChildren(...underFrames(ctx));
  } else {
    side.replaceChildren(...visibleColumns(ctx.layout(), count).map((ids, i) =>
      h('div', { class: 'widget-col', 'data-col': i }, ids.map((id) => widgetEl(ctx, id)))));
    under.replaceChildren(...visibleUnder(ctx.layout()).map((id) => widgetEl(ctx, id)).filter(Boolean));
  }
  under.hidden = !under.children.length;
  restoreFocus(side, kept);
  restoreFocus(under, kept);
}
