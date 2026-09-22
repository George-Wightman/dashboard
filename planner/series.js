// A series: tasks that only make sense in order, such as Role play 1 to 7. They share a `series`
// name and run in `order`. The planner books them in that order (planner/plan.js); Claude's tool
// warns when dates put them out of it (claude/ops.js). Pure.

// The series a task belongs to, compared without case or surrounding space; null for none.
export function seriesOf(item) {
  if (item?.type !== 'task' || typeof item.series !== 'string') return null;
  const s = item.series.trim().toLowerCase();
  return s || null;
}

// Where a task sits in its series: its order, then the part of a task split over several blocks.
export const compareRank = (a, b) => a[0] - b[0] || a[1] - b[1];

// `list` with each series' members rearranged into series order across the places they already
// hold, so everything else keeps its position. `rankOf(x)` is { series, rank } or null.
export function inSeriesOrder(list, rankOf) {
  const out = [...list];
  const bySeries = new Map();
  list.forEach((x, i) => {
    const r = rankOf(x);
    if (!r) return;
    const g = bySeries.get(r.series) ?? [];
    g.push({ x, i, rank: r.rank });
    bySeries.set(r.series, g);
  });
  for (const g of bySeries.values()) {
    const slots = g.map((m) => m.i);
    [...g].sort((a, b) => compareRank(a.rank, b.rank)).forEach((m, n) => { out[slots[n]] = m.x; });
  }
  return out;
}
