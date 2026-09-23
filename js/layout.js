// The widget arrangement: which widgets sit in which of the two columns, in what order, and which
// are hidden. Device-local (localStorage['dash_layout']) and never synced, so the laptop and the
// phone keep their own. Pure functions over { v: 3, columns: [[ids], [ids]], hidden: [ids] }:
// each returns a new layout and never changes the one it was given. After normalizeLayout every
// known widget id is in exactly one place — one of the columns, or hidden — and every other
// function keeps it that way.
//
// v 2 (2026-09-14): the weekly targets moved to the foot of Today's list, so This week started
// hidden. v 3 (2026-09-23): they left the list again — each now shows in its own widget, and This
// week holds only the ones no other widget shows — so a saved v 1 or v 2 layout is read once more
// with This week back at the end of the first column and everything else where it was.

export const LAYOUT_KEY = 'dash_layout';

// Gym (2026-09-14) sits under Last 3 weeks; Muscles and Cardio trend (2026-09-17) under Goals;
// Hebrew (2026-09-23) above Gym. On a device with a saved arrangement each arrives at the end of
// the first column, like any new widget.
export const DEFAULT_LAYOUT = Object.freeze({
  v: 3,
  columns: Object.freeze([Object.freeze(['coach', 'agenda', 'goals', 'week', 'muscles', 'cardio']), Object.freeze(['history', 'hebrew', 'gym'])]),
  hidden: Object.freeze([]),
});

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

function copy(layout) {
  return { v: 3, columns: [[...layout.columns[0]], [...layout.columns[1]]], hidden: [...layout.hidden] };
}

// A copy with `id` taken out of wherever it is.
function without(layout, id) {
  const out = copy(layout);
  out.columns = out.columns.map((c) => c.filter((x) => x !== id));
  out.hidden = out.hidden.filter((x) => x !== id);
  return out;
}

const inColumns = (layout, id) => layout.columns.some((c) => c.includes(id));

// A saved layout made safe to use: unknown ids, non-strings and repeats dropped (an id both placed
// and hidden stays hidden), exactly two columns, and any known id found nowhere — a new widget —
// added to the end of the first column. A v 1 or v 2 layout comes out as v 3 with This week shown.
// Anything that isn't { v: 1, 2 or 3, columns: [...] } is unreadable and gives the default.
export function normalizeLayout(saved, knownIds) {
  const readable = isPlainObject(saved) && [1, 2, 3].includes(saved.v) && Array.isArray(saved.columns);
  const source = readable ? saved : DEFAULT_LAYOUT;
  const known = new Set(knownIds);
  const seen = new Set();
  const keep = (ids) => list(ids).filter((id) => {
    if (typeof id !== 'string' || !known.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const hidden = keep(source.hidden); // first, so hidden wins over placed
  const columns = [keep(source.columns[0]), keep(source.columns.slice(1).flatMap(list))];
  for (const id of knownIds) {
    if (!seen.has(id)) {
      seen.add(id);
      columns[0].push(id);
    }
  }
  const out = { v: 3, columns, hidden };
  return source.v < 3 && hidden.includes('week') ? showWidget(out, 'week') : out;
}

// What to draw: for 2 columns, the two columns without the hidden ids; for 1, column 0 then
// column 1 as one list.
export function visibleColumns(layout, count) {
  const hidden = new Set(layout.hidden);
  const [first, second] = layout.columns.map((c) => c.filter((id) => !hidden.has(id)));
  return count >= 2 ? [first, second] : [[...first, ...second]];
}

// Drag and drop: `id` goes just before `beforeId` in column `toColumn`, or at its end when
// `beforeId` is null or isn't in that column. A hidden widget that is moved is shown.
export function moveWidget(layout, id, toColumn, beforeId = null) {
  const known = inColumns(layout, id) || layout.hidden.includes(id);
  if (id === beforeId || !known || (toColumn !== 0 && toColumn !== 1)) return copy(layout);
  const out = without(layout, id);
  const column = out.columns[toColumn];
  const at = beforeId == null ? -1 : column.indexOf(beforeId);
  if (at === -1) column.push(id);
  else column.splice(at, 0, id);
  return out;
}

// ↑ (-1) and ↓ (+1): one step in the one-column order (column 0, then column 1). Crossing the
// boundary moves it into the other column at the matching end: down from the bottom of column 0
// to the top of column 1, up from the top of column 1 to the bottom of column 0.
export function nudgeWidget(layout, id, dir) {
  const out = copy(layout);
  if (dir !== -1 && dir !== 1) return out;
  const [first, second] = out.columns;
  const swap = (column, a, b) => { [column[a], column[b]] = [column[b], column[a]]; };
  const i = first.indexOf(id);
  const j = second.indexOf(id);
  if (i !== -1) {
    if (dir === -1 && i > 0) swap(first, i, i - 1);
    else if (dir === 1 && i < first.length - 1) swap(first, i, i + 1);
    else if (dir === 1) {
      first.splice(i, 1);
      second.unshift(id);
    }
  } else if (j !== -1) {
    if (dir === 1 && j < second.length - 1) swap(second, j, j + 1);
    else if (dir === -1 && j > 0) swap(second, j, j - 1);
    else if (dir === -1) {
      second.splice(j, 1);
      first.push(id);
    }
  }
  return out;
}

// Hide: out of its column, onto the end of `hidden`.
export function hideWidget(layout, id) {
  if (!inColumns(layout, id)) return copy(layout);
  const out = without(layout, id);
  out.hidden.push(id);
  return out;
}

// Show: out of `hidden`, onto the end of column 0.
export function showWidget(layout, id) {
  if (!layout.hidden.includes(id)) return copy(layout);
  const out = without(layout, id);
  out.columns[0].push(id);
  return out;
}

// The saved arrangement, normalised against the widgets this version knows. Nothing saved, or
// storage that can't be read or parsed, gives the default.
export function loadLayout(storage, knownIds) {
  let saved = null;
  try {
    const raw = storage.getItem(LAYOUT_KEY);
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  return normalizeLayout(saved, knownIds);
}

// Saves the arrangement; false (never a throw) when storage is full or blocked.
export function saveLayout(storage, layout) {
  try {
    storage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}
