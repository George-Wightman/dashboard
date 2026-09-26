// The calendar planner's records in the synced document — the `calendar` map — and what the page
// and Claude's tool read from them. Pure. The planner (planner/) writes `day:1` … `day:7` (one per
// weekday, overwritten when that weekday comes round again: the blocks it booked, what George
// deleted or missed, its notes) and `status`; `config` holds its settings, written by Claude or
// seeded by the planner.

import { weekday, shortWeekday, shortDate, addDays, daysBetween } from './dates.js';

export const CALENDAR_DEFAULTS = {
  hours: ['09:00', '19:00'], gapMinutes: 15, defaultMinutes: 30, maxBlockMinutes: 150,
  days: 7, exactDays: 2, firmUpHour: 20,
  ignore: ['University of York', 'MiM Committee Meetings', 'Family', 'PhD', 'Holidays in United Kingdom'],
  areaCalendars: { 'Job search': 'Application', 'Assessment centre': 'Application', Health: 'Gym', Challenger: 'Challenger' },
  defaultCalendar: 'main',
  habitEvents: [{ habit: 'Hebrew', calendar: 'main', title: 'Learn Hebrew' }, { habit: 'Gym', calendar: 'Gym', title: 'Gym' }],
  priorityAreas: [],
  areaColors: {},
  dayHours: {},
};

// Google Calendar's event colours, by the names George sees, and their ids in the API.
export const COLOR_NAMES = {
  Lavender: '1', Sage: '2', Grape: '3', Flamingo: '4', Banana: '5', Tangerine: '6',
  Peacock: '7', Graphite: '8', Blueberry: '9', Basil: '10', Tomato: '11',
};

export const colorName = (id) => Object.keys(COLOR_NAMES).find((n) => COLOR_NAMES[n] === String(id)) ?? null;

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');
const text = (v) => typeof v === 'string' && v.trim() !== '';
const copy = (v) => JSON.parse(JSON.stringify(v));
const norm = (s) => String(s ?? '').trim().toLowerCase();
const realDay = (d) => typeof d === 'string' && DAY.test(d) && addDays(d, 0) === d;

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
  priorityAreas: (v, field) => {
    if (!Array.isArray(v) || !v.every(text)) throw new Error(`${field} should be a list of area names`);
    return v.map((s) => s.trim());
  },
  areaColors: (v, field) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${field} should map each area to a colour, like {"Assessment centre": "Grape"}`);
    const out = {};
    const used = new Map();
    for (const [area, name] of Object.entries(v)) {
      const colour = Object.keys(COLOR_NAMES).find((n) => n.toLowerCase() === norm(name));
      if (!text(area) || !colour) throw new Error(`${field}: "${name}" isn't one of Google's colours — ${Object.keys(COLOR_NAMES).join(', ')}`);
      if (used.has(colour)) throw new Error(`${field} gives ${colour} to both ${used.get(colour)} and ${area.trim()} — each area needs its own colour`);
      used.set(colour, area.trim());
      out[area.trim()] = colour;
    }
    return out;
  },
  dayHours: (v, field) => {
    const ok = v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([d, h]) => realDay(d)
      && Array.isArray(h) && h.length === 2 && clockMinutes(h[0]) != null && clockMinutes(h[1]) != null && clockMinutes(h[0]) < clockMinutes(h[1]));
    if (!ok) throw new Error(`${field} should map a date to two times, like {"2026-09-18": ["09:00", "13:00"]}`);
    return Object.fromEntries(Object.entries(v).map(([d, h]) => [d, [h[0], h[1]]]));
  },
};

// Settings that change one key at a time: a key set to null is removed; the rest are kept.
export const MERGED_SETTINGS = ['areaCalendars', 'areaColors', 'dayHours'];

export function mergeSetting(field, current, value) {
  if (!MERGED_SETTINGS.includes(field) || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = { ...(current ?? {}) };
  for (const [key, v] of Object.entries(value)) {
    const had = Object.keys(out).find((k) => norm(k) === norm(key));
    if (had !== undefined) delete out[had];
    if (v !== null) out[key.trim()] = v;
  }
  return out;
}

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

// ---- Time off, priority, the brief (Claude's controls) -----------------------------------------

// Time off: `off:<start day>` records in the calendar map — whole days (start and end both dates,
// end included) or a stretch of hours (both YYYY-MM-DDTHH:MM, end not included) — covering `areas`,
// or everything when that's empty. Cancelled ones are archived.
export function timeOff(doc) {
  return Object.values(doc?.calendar ?? {})
    .filter((r) => r.status === 'active' && String(r.id).startsWith('off:'))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

const wholeDays = (off) => DAY.test(off.start ?? '') && DAY.test(off.end ?? '');
const inScope = (off, area) => !off.areas?.length || off.areas.some((a) => norm(a) === norm(area));

export const offCovers = (off, day) => wholeDays(off) && off.start <= day && day <= off.end;

// Whether an item is excused on a day: whole-day time off covering its area.
export function excused(doc, item, day, offs = timeOff(doc)) {
  return offs.some((o) => offCovers(o, day) && inScope(o, item.area));
}

function localMs(stamp) {
  const [d, t = '00:00'] = stamp.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, h, min).getTime();
}

// The stretches of hours off that touch a day, in milliseconds.
export function offWindows(doc, day, offs = timeOff(doc)) {
  const from = localMs(day);
  const to = localMs(addDays(day, 1));
  return offs
    .filter((o) => STAMP.test(o.start ?? '') && STAMP.test(o.end ?? ''))
    .map((o) => ({ start: localMs(o.start), end: localMs(o.end), areas: o.areas ?? [] }))
    .filter((w) => w.start < to && w.end > from);
}

// The line Today shows on a day with time off: 'Time off — Maya leaves for Austria · Job search'.
export function offLine(doc, day) {
  const parts = [];
  for (const o of timeOff(doc)) {
    const hours = offWindows(doc, day, [o]).length > 0;
    if (!hours && !offCovers(o, day)) continue;
    const areas = o.areas?.length ? ` · ${o.areas.join(', ')}` : '';
    const when = hours ? ` · ${o.start.slice(11)}–${o.end.slice(11)}` : '';
    parts.push(`${o.reason || 'Time off'}${areas}${when}`);
  }
  return parts.length ? `Time off — ${parts.join('; ')}` : null;
}

// Time off as Claude's tool writes it, checked: plain English when it's wrong.
export function checkTimeOff({ start, end, areas = [], reason = '' } = {}) {
  const s = String(start ?? '').trim();
  const e = String(end ?? start ?? '').trim();
  const days = realDay(s) && realDay(e);
  const stamp = (v) => STAMP.test(v) && realDay(v.slice(0, 10)) && clockMinutes(v.slice(11)) != null;
  const hours = stamp(s) && stamp(e);
  if (!days && !hours) throw new Error('Time off needs start and end as dates (YYYY-MM-DD), or both as a date and time (YYYY-MM-DDTHH:MM)');
  if (days ? e < s : e <= s) throw new Error('Time off has to end after it starts');
  if (!Array.isArray(areas) || !areas.every(text)) throw new Error('areas should be a list of area names, or left out for everything');
  const why = String(reason ?? '').trim();
  if (why.length > 200) throw new Error('The reason can be at most 200 characters');
  return { start: s, end: e, areas: areas.map((a) => a.trim()), reason: why };
}

// 'Wed 16 Sep – Thu 17 Sep — Maya leaves for Austria · Job search' or '… · everything'.
export function offText(o) {
  const dayText = (d) => `${shortWeekday(d)} ${shortDate(d)}`;
  const range = o.start.length === 10
    ? (o.start === o.end ? dayText(o.start) : `${dayText(o.start)} – ${dayText(o.end)}`)
    : `${dayText(o.start.slice(0, 10))}, ${o.start.slice(11)}–${o.end.slice(11)}`;
  return `${range} — ${o.reason || 'Time off'} · ${o.areas?.length ? o.areas.join(', ') : 'everything'}`;
}

export function nextOffId(doc, start) {
  const day = String(start).slice(0, 10);
  let id = `off:${day}`;
  for (let n = 0; doc?.calendar?.[id]; n++) id = `off:${day}${String.fromCharCode(98 + n)}`;
  return id;
}

// ---- Countdowns ---------------------------------------------------------------------------------

// Dates George is counting down to — the assessment centre, a birthday — kept as `count:<day>:<n>`
// records beside the planner's. The Countdown widget shows them and Claude sets them (the
// `countdown` op); the planner books nothing for them.

// A countdown checked: plain English when it's wrong. `day` must be today or later.
export function checkCountdown({ title, day } = {}, today) {
  const t = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (!t) throw new Error('A countdown needs a name');
  if (t.length > 60) throw new Error('A countdown name can be at most 60 characters');
  if (!realDay(String(day ?? ''))) throw new Error('A countdown needs a date as YYYY-MM-DD');
  if (day < today) throw new Error("That date has passed — a countdown is for something still to come");
  return { title: t, day };
}

export function nextCountdownId(doc, day) {
  let n = 1;
  while (doc?.calendar?.[`count:${day}:${n}`]) n++;
  return `count:${day}:${n}`;
}

// The countdowns still to come (today's included), soonest first, with the days left.
export function countdowns(doc, today) {
  return Object.values(doc?.calendar ?? {})
    .filter((r) => r.status === 'active' && String(r.id).startsWith('count:') && realDay(r.day ?? '') && r.day >= today && text(r.title))
    .map((r) => ({ id: r.id, title: r.title, day: r.day, days: daysBetween(today, r.day) }))
    .sort((a, b) => (a.day === b.day ? a.title.localeCompare(b.title) : a.day < b.day ? -1 : 1));
}

// '12 days', 'tomorrow', 'today'.
export const daysLeft = (days) => (days === 0 ? 'today' : days === 1 ? 'tomorrow' : `${days} days`);

// A priority: the item says so, or its area is one of the planner's priority areas.
export function isPriority(doc, item, config = readPlannerConfig(doc).config) {
  return item.priority === true || config.priorityAreas.some((a) => norm(a) === norm(item.area));
}

// Claude's brief for a day (a journal record, kind 'brief').
export function briefFor(doc, day) {
  const rec = doc?.journal?.[`brief:${day}`];
  return rec && rec.status === 'active' && rec.text ? rec.text : null;
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

// What George is doing at `now`, as a few words for a note he leaves Claude: the task whose calendar
// block he's in, else the task he ticked in the last half hour ("just finished …"), else null.
export function doingNow(doc, today, now) {
  const t = now.getTime();
  const title = (id) => (doc.items?.[id]?.title ?? '').trim();
  for (const b of dayRecord(doc, today)?.blocks ?? []) {
    if (!(Date.parse(b.start) <= t && t < Date.parse(b.end))) continue;
    const names = (b.items ?? []).map(title).filter(Boolean);
    const what = names.length ? names.join(', ') : String(b.title ?? '').replace(/^~ /, '').trim();
    if (what) return `${what} (${clockLabel(b.start)}–${clockLabel(b.end)})`.slice(0, 200);
  }
  const recent = Object.values(doc.logs ?? {}).filter((l) => l.status === 'active' && l.kind === 'done' && l.day === today
    && l.at && t - Date.parse(l.at) >= 0 && t - Date.parse(l.at) < 30 * 60000 && title(l.itemId))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  return recent ? `just finished ${title(recent.itemId)}`.slice(0, 200) : null;
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
