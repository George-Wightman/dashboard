// The widgets: the panels beside Today's list, drawn into the columns George arranges. The
// arrangement is device-local (js/layout.js, localStorage['dash_layout']); ctx.layout() is the
// current one and ctx.columnCount() says whether the window shows two widget columns or one.
// Today's list is not a widget: it always stays in the first column.

import { h } from './dom.js';
import { renderCoach } from './coach.js';
import { renderWeek, renderGoals, renderHistory, keptFocus, restoreFocus } from './side.js';
import { visibleColumns } from '../layout.js';

// The registry. A widget's render(ctx) returns its element, or null when it has nothing to show
// (This week with no weekly targets), and is then left out. A new widget is one more line here:
// normalizeLayout puts an id it hasn't seen before at the end of the first column.
export const WIDGETS = [
  { id: 'coach', title: 'Coach', render: renderCoach },
  { id: 'week', title: 'This week', render: renderWeek },
  { id: 'goals', title: 'Goals', render: renderGoals },
  { id: 'history', title: 'Last 3 weeks', render: renderHistory },
];
export const WIDGET_IDS = WIDGETS.map((w) => w.id);
const BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));

// One widget's element, marked with its id; null when it has nothing to show.
function widgetEl(ctx, id) {
  const el = BY_ID.get(id)?.render(ctx) ?? null;
  if (el) el.dataset.widget = id;
  return el;
}

// Redraws the whole widget area (#side) from the arrangement. A text box marked data-focus gets
// its focus and caret back afterwards (its text comes back from ctx.ui), so typing carries on.
export function renderSide(ctx) {
  const side = document.getElementById('side');
  const kept = keptFocus(side);
  const count = ctx.columnCount();
  side.dataset.columns = String(count);
  side.replaceChildren(...visibleColumns(ctx.layout(), count).map((ids, i) =>
    h('div', { class: 'widget-col', 'data-col': i }, ids.map((id) => widgetEl(ctx, id)))));
  restoreFocus(side, kept);
}
