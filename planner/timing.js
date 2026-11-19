// Where a planner run's time goes, step by step. Google gives the planner 90 minutes of Apps Script a
// day and on 19 Nov 2026 it had used 74.5 by 19:07, at about 48 s a run, with nothing to say which steps
// took it. Each run laps a stopwatch after each step (planner/gas.js); the day's totals by step ride in
// the RUN_MS script property, and the check-ins status carries them to Claude hourly. Pure.

const NAME = /^[A-Za-z]{1,24}$/;

// `clock()` is milliseconds. lap(name) adds the time since the last lap (or the start) to `name`.
export function stopwatch(clock) {
  let last = clock();
  const phases = {};
  return {
    lap(name) {
      const t = clock();
      if (NAME.test(name)) phases[name] = (phases[name] ?? 0) + Math.max(0, t - last);
      last = t;
    },
    phases: () => ({ ...phases }),
  };
}

// The day so far plus one run's laps, whole milliseconds; anything that isn't a step name and a
// number is dropped, so a damaged property can't grow or break the count.
export function addPhases(prev, next) {
  const out = {};
  for (const src of [prev, next]) {
    if (!src || typeof src !== 'object') continue;
    for (const [k, v] of Object.entries(src)) {
      if (NAME.test(k) && Number.isFinite(v) && v >= 0) out[k] = Math.round((out[k] ?? 0) + v);
    }
  }
  return out;
}
