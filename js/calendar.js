// The calendar planner's records in the synced document — the `calendar` map — and what the page
// and Claude's tool read from them. Pure. The planner (planner/) writes `day:1` … `day:7` (one per
// weekday, overwritten when that weekday comes round again: the blocks it booked, what George
// deleted or missed, its notes) and `status`; `config` holds its settings, written by Claude or
// seeded by the planner.

import { weekday, shortWeekday, shortDate } from './dates.js';

export const CALENDAR_DEFAULTS = {
  hours: ['09:00', '19:00'], gapMinutes: 15, defaultMinutes: 30, maxBlockMinutes: 150,
  days: 7, exactDays: 2, firmUpHour: 20,
  ignore: ['University of York', 'MiM Committee Meetings', 'Family', 'PhD', 'Holidays in United Kingdom'],
  areaCalendars: { 'Job search': 'Application', 'Assessment centre': 'Application', Health: 'Gym', Challenger: 'Challenger' },
  defaultCalendar: 'main',
  habitEvents: [{ habit: 'Hebrew', calendar: 'main', title: 'Learn Hebrew' }, { habit: 'Gym', calendar: 'Gym', title: 'Gym' }],
};

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const pad = (n) => String(n).padStart(2, '0');
const text = (v) => typeof v === 'string' && v.trim() !== '';
const copy = (v) => JSON.parse(JSON.stringify(v));

export function clockMinutes(hhmm) {
  const m = CLOCK.exec(String(hhmm ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function wholeNumber(lo, hi) {
  return (v, field) => {
    if (!(Number.isInteger(v) && v >= lo && v <= hi)) throw new Error(`${field} should be a whole number from ${lo} to ${hi}`);
    return v;
  };
}

// Each setting's check: the value to keep, or a plain-English reason.
export const CONFIG_CHECKS = {
  hours: (v, field) => {
    const ok = Array.isArray(v) && v.length === 2 && clockMinutes(v[0]) != null && clockMinutes(v[1]) != null
      && clockMinutes(v[0]) < clockMinutes(v[1]);
    if (!ok) throw new Error(`${field} should be two times like ["09:00", "19:00"], the first earlier`);
    return [v[0], v[1]];
  },
  gapMinutes: wholeNumber(0, 60),
  defaultMinutes: wholeNumber(5, 240),
  maxBlockMinutes: wholeNumber(30, 480),
  days: wholeNumber(1, 14),
  exactDays: wholeNumber(1, 7),
  firmUpHour: wholeNumber(12, 23),
  ignore: (v, field) => {
    if (!Array.isArray(v) || !v.every(text)) throw new Error(`${field} should be a list of calendar names`);
    return v.map((s) => s.trim());
  },
  areaCalendars: (v, field) => {
    const ok = v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([a, c]) => text(a) && text(c));
    if (!ok) throw new Error(`${field} should map each area to a calendar name, like {"Job search": "Application"}`);
    return Object.fromEntries(Object.entries(v).map(([a, c]) => [a.trim(), c.trim()]));
  },
  defaultCalendar: (v, field) => {
    if (!text(v)) throw new Error(`${field} should be a calendar name, or "main"`);
    return v.trim();
  },
  habitEvents: (v, field) => {
    const ok = Array.isArray(v) && v.every((l) => l && typeof l === 'object' && text(l.habit) && text(l.calendar) && text(l.title));
    if (!ok) throw new Error(`${field} should be a list like [{"habit": "Gym", "calendar": "Gym", "title": "Gym"}]`);
    return v.map((l) => ({ habit: l.habit.trim(), calendar: l.calendar.trim(), title: l.title.trim() }));
  },
};

export function checkConfigField(field, value) {
  const check = Object.hasOwn(CONFIG_CHECKS, field) ? CONFIG_CHECKS[field] : null;
  if (!check) throw new Error(`The planner has no setting "${field}" — settings: ${Object.keys(CONFIG_CHECKS).join(', ')}`);
  return check(value, field);
}

// The planner's settings: the defaults, with every good saved field over them. A bad saved field
// keeps its default and is named in `problems`.
export function readPlannerConfig(doc) {
  const config = copy(CALENDAR_DEFAULTS);
  const problems = [];
  const saved = doc?.calendar?.config;
  if (saved && saved.status === 'active') {
    for (const field of Object.keys(CONFIG_CHECKS)) {
      if (saved[field] === undefined) continue;
      try {
        config[field] = checkConfigField(field, saved[field]);
      } catch (e) {
        problems.push(`The planner setting ${field} isn't usable (${e.message}), so it's using the default`);
      }
    }
  }
  return { config, problems };
}

export const dayRecordId = (day) => `day:${weekday(day)}`;

export function dayRecord(doc, day) {
  const rec = doc?.calendar?.[dayRecordId(day)];
  return rec && rec.status === 'active' && rec.day === day ? rec : null;
}

export function plannerStatus(doc) {
  const rec = doc?.calendar?.status;
  return rec && rec.status === 'active' ? rec : null;
}

// Today's planned times by item, from today's exact, fixed, done and part-done blocks (rough ones
// never show on the list). An item in two blocks (the rest of a part-done one) shows the later.
export function todaySlots(doc, today) {
  const slots = new Map();
  for (const b of dayRecord(doc, today)?.blocks ?? []) {
    if (b.state === 'rough') continue;
    for (const id of b.items ?? []) {
      const had = slots.get(id);
      if (!had || Date.parse(b.start) > Date.parse(had.start)) slots.set(id, { start: b.start, end: b.end, state: b.state, title: b.title });
    }
  }
  return slots;
}

export const plannerNotes = (doc, today) => [...(dayRecord(doc, today)?.notes ?? [])];

// The notes the header shows: newest first, at most two, without the ones hidden on this device
// today (hidden keys are "<day>|<note>").
export function visibleNotes(notes, hiddenKeys, today) {
  const hidden = new Set(hiddenKeys);
  return notes.filter((n) => !hidden.has(`${today}|${n}`)).reverse().slice(0, 2);
}

export function clockLabel(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const localDayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 'HH:MM' for a moment today; 'Mon 14 Sep, 12:00' for any other day.
export function momentLabel(iso, now) {
  const d = new Date(iso);
  const day = localDayOf(d);
  return day === localDayOf(now) ? clockLabel(iso) : `${shortWeekday(day)} ${shortDate(day)}, ${clockLabel(iso)}`;
}

// When the planner last ran, if that's more than `minutes` ago; null while it's running, before it
// has ever run, and while it's paused.
export function staleSince(doc, now, minutes = 70) {
  const s = plannerStatus(doc);
  if (!s?.lastRun || s.paused) return null;
  return now.getTime() - Date.parse(s.lastRun) > minutes * 60000 ? momentLabel(s.lastRun, now) : null;
}

// Today's rows in the day's order: suggestions stay on top; then undone rows with a time, earliest
// first; then every other row in the order it came (undone, then done).
export function timedOrder(rows, slots) {
  const timed = (r) => !r.suggested && !r.done && slots.has(r.item.id);
  const start = (r) => Date.parse(slots.get(r.item.id).start);
  return [
    ...rows.filter((r) => r.suggested),
    ...rows.filter(timed).sort((a, b) => start(a) - start(b)),
    ...rows.filter((r) => !r.suggested && !timed(r)),
  ];
}

// ⚙ → Calendar planner: the folded line and what's inside.
export function plannerSummary(doc, now) {
  const { config } = readPlannerConfig(doc);
  const exact = config.exactDays === 1 ? 'today exact' : config.exactDays === 2 ? 'today and tomorrow exact' : `the first ${config.exactDays} days exact`;
  const lines = [`Plans ${config.hours[0]}–${config.hours[1]}, ${config.days} days ahead: ${exact}, rough after that.`];
  const s = plannerStatus(doc);
  if (!s) return { summary: 'not set up', lines: [...lines, "It hasn't run yet — the README says how to set it up."] };
  lines.push(`Last ran ${momentLabel(s.lastRun, now)}${s.version ? ` · build ${s.version}` : ''}.`);
  if (s.lastError) lines.push(`Last problem: ${s.lastError}`);
  lines.push('To change its settings, ask Claude — for example "plan between 8:30 and 6".');
  return { summary: s.paused ? 'paused' : `last ran ${momentLabel(s.lastRun, now)}`, lines };
}
