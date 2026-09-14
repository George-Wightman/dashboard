// Finding time. Pure. Times are milliseconds; a window is { start, end }, busy is [{ start, end }].
// Starts fall on the quarter hour, and a block keeps `gap` clear of everything busy.

export const QUARTER = 15 * 60000;

export const ceilQuarter = (ms) => Math.ceil(ms / QUARTER) * QUARTER;

export function fits(start, end, busy, gap) {
  return busy.every((b) => end + gap <= b.start || start >= b.end + gap);
}

export function earliestFit(length, window, busy, gap) {
  for (let s = ceilQuarter(window.start); s + length <= window.end; s += QUARTER) {
    if (fits(s, s + length, busy, gap)) return s;
  }
  return null;
}

// The free start nearest `want`; the earlier one on a tie.
export function nearestFit(length, want, window, busy, gap) {
  let best = null;
  for (let s = ceilQuarter(window.start); s + length <= window.end; s += QUARTER) {
    if (!fits(s, s + length, busy, gap)) continue;
    if (best == null || Math.abs(s - want) < Math.abs(best - want)) best = s;
  }
  return best;
}
