// The widget arrangement: which widgets sit under Today's list, which in each of the two columns
// beside it, in what order, and which are hidden. Device-local (localStorage['dash_layout']) and
// never synced, so the laptop and the phone keep their own. Pure functions over
// { v: 4, under: [ids], columns: [[ids], [ids]], hidden: [ids] }: each returns a new layout and
// never changes the one it was given. After normalizeLayout every known widget id is in exactly
// one place — under the list, one of the columns, or hidden — and every other function keeps it
// that way.
//
// v 2 (2026-09-14): the weekly targets moved to the foot of Today's list, so This week started
// hidden. v 3 (2026-09-23): they left the list again — each now shows in its own widget, and This
// week holds only the ones no other widget shows — so a saved v 1 or v 2 layout is read once more
// with This week back at the end of the first column and everything else where it was.
// v 4 (2026-09-24): the space under Today's list takes widgets too. A saved layout older than that
// is read once more with Goals and Upcoming moved under the list, and Countdown (new then) at the
// top of the first column.

export const LAYOUT_KEY = 'dash_layout';

// Gym (2026-09-14) sits under Last 3 weeks; Muscles and Cardio trend (2026-09-17) under Goals;
// Hebrew (2026-09-23) above Gym. On a device with a saved arrangement a new widget arrives at the
// end of the first column.
export const DEFAULT_LAYOUT = Object.freeze({
  v: 4,
  under: Object.freeze(['goals', 'agenda']),
  columns: Object.freeze([
    Object.freeze(['note', 'countdown', 'week', 'muscles', 'cardio']),
    Object.freeze(['history', 'hebrew', 'gym']),
  ]),
  hidden: Object.freeze([]),
});

// Where a widget can be put: under Today's list, or column 0 or 1 beside it.
export const UNDER = 'under';

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

function copy(layout) {
  return {
    v: 4, under: [...(layout.under ?? [])], columns: [[...layout.columns[0]], [...layout.columns[1]]], hidden: [...layout.hidden],
  };
}

// The places a widget can sit, in reading order: under the list, then the two columns.
const places = (layout) => [layout.under, layout.columns[0], layout.columns[1]];
const placeOf = (layout, where) => (where === UNDER ? layout.under : layout.columns[where] ?? null);

// A copy with `id` taken out of wherever it is.
function without(layout, id) {
  const out = copy(layout);
  out.under = out.under.filter((x) => x !== id);
  out.columns = out.columns.map((c) => c.filter((x) => x !== id));
  out.hidden = out.hidden.filter((x) => x !== id);
  return out;
}

const placed = (layout, id) => places(layout).some((c) => c.includes(id));

// A saved layout made safe to use: unknown ids, non-strings and repeats dropped (an id both placed
// and hidden stays hidden), exactly two columns, and any known id found nowhere — a new widget —
// added to the end of the first column. Older versions are brought up to v 4 (see the top).
// Anything that isn't { v: 1–4, columns: [...] } is unreadable and gives the default.
export function normalizeLayout(saved, knownIds) {
  const readable = isPlainObject(saved) && [1, 2, 3, 4].includes(saved.v) && Array.isArray(saved.columns);
  const source = readable ? saved : DEFAULT_LAYOUT;
  const known = new Set(knownIds);
  const seen = new Set();
  const keep = (ids) => list(ids).filter((id) => {
    if (typeof id !== 'string' || !known.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const hidden = keep(source.hidden); // first, so hidden wins over placed
  const under = keep(source.under);
  const columns = [keep(source.columns[0]), keep(source.columns.slice(1).flatMap(list))];
  const arrived = knownIds.filter((id) => !seen.has(id));
  columns[0].push(...arrived);
  let out = { v: 4, under, columns, hidden };
  if (source.v < 3 && hidden.includes('week')) out = showWidget(out, 'week');
  if (source.v < 4) {
    for (const id of ['goals', 'agenda']) if (out.columns.some((c) => c.includes(id))) out = moveWidget(out, id, UNDER);
    if (arrived.includes('countdown')) out = moveWidget(out, 'countdown', 0, out.columns[0][0]);
  }
  // The note for Claude (2026-09-26) arrives at the top of the first column, not the end.
  if (arrived.includes('note') && readable) out = moveWidget(out, 'note', 0, out.columns[0][0]);
  return out;
}

// What to draw beside the list: for 2 columns, the two columns without the hidden ids; for 1,
// column 0 then column 1 as one list.
export function visibleColumns(layout, count) {
  const hidden = new Set(layout.hidden);
  const [first, second] = layout.columns.map((c) => c.filter((id) => !hidden.has(id)));
  return count >= 2 ? [first, second] : [[...first, ...second]];
}

// What to draw under Today's list.
export function visibleUnder(layout) {
  const hidden = new Set(layout.hidden);
  return (layout.under ?? []).filter((id) => !hidden.has(id));
}

// Drag and drop: `id` goes just before `beforeId` in `to` (UNDER, 0 or 1), or at its end when
// `beforeId` is null or isn't there. A hidden widget that is moved is shown.
export function moveWidget(layout, id, to, beforeId = null) {
  const known = placed(layout, id) || layout.hidden.includes(id);
  if (id === beforeId || !known || (to !== UNDER && to !== 0 && to !== 1)) return copy(layout);
  const out = without(layout, id);
  const place = placeOf(out, to);
  const at = beforeId == null ? -1 : place.indexOf(beforeId);
  if (at === -1) place.push(id);
  else place.splice(at, 0, id);
  return out;
}

// ↑ (-1) and ↓ (+1): one step in reading order — under the list, then column 0, then column 1.
// Crossing into the next place puts it at the matching end: down from the bottom of one to the
// top of the next, up from the top of one to the bottom of the one before. The very top and
// bottom stay put.
export function nudgeWidget(layout, id, dir) {
  const out = copy(layout);
  if (dir !== -1 && dir !== 1) return out;
  const all = places(out);
  const p = all.findIndex((c) => c.includes(id));
  if (p === -1) return out;
  const here = all[p];
  const i = here.indexOf(id);
  const j = i + dir;
  if (j >= 0 && j < here.length) {
    [here[i], here[j]] = [here[j], here[i]];
    return out;
  }
  const next = all[p + dir];
  if (!next) return out;
  here.splice(i, 1);
  if (dir === 1) next.unshift(id);
  else next.push(id);
  return out;
}

// Hide: out of where it sits, onto the end of `hidden`.
export function hideWidget(layout, id) {
  if (!placed(layout, id)) return copy(layout);
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
