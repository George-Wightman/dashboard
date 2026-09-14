// The widgets: the panels beside Today's list, drawn into the columns George arranges. The
// arrangement is device-local (js/layout.js, localStorage['dash_layout']); ctx.layout() is the
// current one and ctx.columnCount() says whether the window shows two widget columns or one.
// Today's list is not a widget: it always stays in the first column.
//
// Arrange mode (ctx.ui.arranging, toggled by setArranging): every visible widget gets a dashed
// frame with a grip (or ↑ ↓ on touch and in the one-column view) and Hide; hidden ones wait below
// as "+ Title" chips. Dragging follows js/ui/today.js's row drag and drop.

import { h } from './dom.js';
import { renderCoach } from './coach.js';
import { renderWeek, renderGoals, renderHistory, keptFocus, restoreFocus } from './side.js';
import { renderGym } from './gym.js';
import { visibleColumns, moveWidget, nudgeWidget, hideWidget, showWidget } from '../layout.js';

// The registry. A widget's render(ctx) returns its element, or null when it has nothing to show
// (This week with no weekly targets), and is then left out (outside Arrange mode, which shows a
// placeholder instead so an empty widget can still be moved). A new widget is one more line here:
// normalizeLayout puts an id it hasn't seen before at the end of the first column.
export const WIDGETS = [
  { id: 'coach', title: 'Coach', render: renderCoach },
  { id: 'week', title: 'This week', render: renderWeek },
  { id: 'goals', title: 'Goals', render: renderGoals },
  { id: 'history', title: 'Last 3 weeks', render: renderHistory },
  { id: 'gym', title: 'Gym', render: renderGym },
];
export const WIDGET_IDS = WIDGETS.map((w) => w.id);
const BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));
const titleOf = (id) => BY_ID.get(id)?.title ?? id;

// One widget's element, marked with its id; null when it has nothing to show.
function widgetEl(ctx, id) {
  const el = BY_ID.get(id)?.render(ctx) ?? null;
  if (el) el.dataset.widget = id;
  return el;
}

// Turns Arrange mode on or off (the header's Arrange/Done link, and Escape).
export function setArranging(ctx, on) {
  ctx.ui.arranging = on;
  ctx.render();
}

// ---- Arrange mode -------------------------------------------------------------------------------

// ↑ ↓ replace the grip on a touch device, and whenever only one widget column shows — a window
// under 1500px, where dragging between "columns" would have nothing to land on. matchMedia is
// read lazily (not every environment that imports this module has one, e.g. the Node tests).
const isCoarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const useNudge = (ctx) => ctx.columnCount() === 1 || isCoarsePointer();

// A frame is a drop target: dragover accepts a widget being dragged (and only that), drop moves
// it to just before this frame in `col`. Mirrors js/ui/today.js's row drag and drop.
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
function dropZone(ctx, col) {
  const zone = h('div', { class: 'drop-zone', 'data-col': col }, 'Drop here');
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

// ---- Normal mode and the shared entry point ------------------------------------------------------

// Redraws the whole widget area (#side) from the arrangement. A text box marked data-focus gets
// its focus and caret back afterwards (its text comes back from ctx.ui), so typing carries on.
export function renderSide(ctx) {
  const side = document.getElementById('side');
  const kept = keptFocus(side);
  const count = ctx.columnCount();
  side.dataset.columns = String(count);
  if (ctx.ui.arranging) {
    renderArranging(ctx, side, count);
  } else {
    side.replaceChildren(...visibleColumns(ctx.layout(), count).map((ids, i) =>
      h('div', { class: 'widget-col', 'data-col': i }, ids.map((id) => widgetEl(ctx, id)))));
  }
  restoreFocus(side, kept);
}
