// One planning pass: the dashboard and George's calendars in; the calendar changes to make and the
// planner's day records out. Pure — planner/gas.js reads the calendars, applies the changes and
// keeps the records. The rules are the design's (docs/superpowers/specs/2026-09-14-calendar-planner-design.md):
// blocks by area, around fixed events, exact for the first days and rough after; never moved once
// George has moved them; trimmed, or moved to the tick, when he ticks; removed when missed.

import { addDays, logicalDay, daysBetween, shortWeekday } from '../js/dates.js';
import { readPlannerConfig, timeOff, offWindows, offCovers, COLOR_NAMES, colorName } from '../js/calendar.js';
import { at, localDay, iso, MINUTE } from './time.js';
import { P, normEvent, atText, movedByGeorge, habitPinned, linkedIds, roughColor, nearestColor, paleOf } from './events.js';
import { norm, resolveCalendars, calendarFor, habitLinks } from './calendars.js';
import { taskInput, dayClosed } from '../js/plan-state.js';
import { demand, fixedTasks } from './demand.js';
import { fits, earliestFit, nearestFit, ceilQuarter } from './place.js';

const DESCRIPTION_LINE = 'Planned from your dashboard. Move it and it stays where you put it.';
const HISTORY = new Set(['done', 'partial']);
const MIN_BLOCK = 15 * MINUTE;
const MAX_NOTES = 20;
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const splitIds = (s) => String(s ?? '').split(',').filter(Boolean);

export function blockTitle(base, state, done = 0, total = 0) {
  if (state === 'rough') return `~ ${base}`;
  if (state === 'done') return `✓ ${base}`;
  if (done > 0 && done < total) return `${base} · ${done} of ${total} done`;
  return base;
}

// A block as a Google event. `notes` lead the description (the items' notes); the title stays the
// title. `colorId` is the area's colour, or a rough block's pale one; none means the calendar's own.
export function blockBody({ key, base, title, start, end, items, state, colorId = null, pinned = false, notes = [], input = null, parts = 1 }) {
  const rough = state === 'rough';
  const props = {
    [P.mine]: '1', [P.key]: key, [P.items]: items.join(','), [P.title]: base,
    [P.at]: atText(start, end), [P.state]: state,
  };
  if (pinned) props[P.pin] = '1';
  if (input) Object.assign(props, { [P.input]: JSON.stringify(input), [P.summary]: title, [P.parts]: String(parts) });
  return {
    summary: title,
    description: [...notes, ...(items.length === 1 ? ['Open task / mark complete: https://george-wightman.github.io/dashboard/?task=' + encodeURIComponent(items[0])] : []), ...items.map((id) => `dashboard:${id}`), DESCRIPTION_LINE].join('\n'),
    start: { dateTime: iso(start) },
    end: { dateTime: iso(end) },
    ...(colorId ? { colorId } : {}),
    reminders: rough ? { useDefault: false, overrides: [] } : { useDefault: true },
    extendedProperties: { private: props },
  };
}

// Whether an event already is what `body` describes, so nothing needs writing.
function sameAs(ev, body) {
  const want = body.extendedProperties.private;
  return ev.title === body.summary
    && ev.description === body.description
    && ev.start.getTime() === Date.parse(body.start.dateTime)
    && ev.end.getTime() === Date.parse(body.end.dateTime)
    && (body.colorId === undefined || ev.colorId === body.colorId)
    && ev.useDefault === body.reminders.useDefault
    && Object.keys(want).every((k) => ev.props[k] === want[k]);
}

// The day records with the ids Google gave the new events, matched by block key.
export function fillIds(days, byKey) {
  const out = JSON.parse(JSON.stringify(days));
  for (const rec of Object.values(out)) {
    for (const b of rec.blocks) if (!b.eventId && byKey[b.key]) b.eventId = byKey[b.key];
  }
  return out;
}

export function plan({ doc, now, dayStartHour = 4, calendars, events: raw, eventColors = {}, memory = {} }) {
  const { config, problems: configProblems } = readPlannerConfig(doc);
  const problems = new Set(configProblems);
  const notes = [];
  const note = (text) => { if (!notes.includes(text)) notes.push(text); };
  const gap = config.gapMinutes * MINUTE;
  const nowMs = now.getTime();
  const today = logicalDay(now, dayStartHour);
  const yesterday = addDays(today, -1);
  const days = Array.from({ length: config.days }, (_, i) => addDays(today, i));
  const lastDay = days[days.length - 1];
  const onDay = (d) => (d === today ? '' : ` on ${shortWeekday(d)}`);
  const exactDay = (d) => {
    const i = daysBetween(today, d);
    return i < config.exactDays || (i === config.exactDays && now.getHours() >= config.firmUpHour);
  };

  const { watched, find } = resolveCalendars(calendars, config);
  const watchedIds = new Set(watched.map((c) => c.id));
  const calName = (id) => calendars.find((c) => c.id === id)?.name ?? '';
  const links = habitLinks(doc, config, find, problems);
  const items = doc.items ?? {};
  const itemIds = Object.keys(items);
  const bodyFor = (spec) => {
    const item = spec.items?.length === 1 ? items[spec.items[0]] : null;
    return blockBody({ ...spec, input: item?.type === 'task' ? taskInput(item) : null,
      parts: item?.time ? 1 : Math.ceil((item?.minutes ?? config.defaultMinutes) / config.maxBlockMinutes) });
  };
  const offs = timeOff(doc);

  // Colours: each watched calendar takes the event colour nearest its own, so an area can't have it.
  const takenBy = new Map();
  for (const c of watched) {
    const id = nearestColor(c.backgroundColor, eventColors);
    if (id && !takenBy.has(id)) takenBy.set(id, String(c.name).trim());
  }
  const takenColors = [...takenBy.keys()].map(colorName).filter(Boolean).sort();
  const areaColorId = (area) => {
    const key = Object.keys(config.areaColors).find((a) => norm(a) === norm(area));
    if (key === undefined) return null;
    const name = config.areaColors[key];
    const id = COLOR_NAMES[name];
    if (!takenBy.has(id)) return id;
    const used = new Set([...takenBy.keys(), ...Object.values(config.areaColors).map((n) => COLOR_NAMES[n])]);
    const free = Object.keys(COLOR_NAMES).filter((n) => !used.has(COLOR_NAMES[n]));
    problems.add(`${name} is taken by your ${takenBy.get(id)} calendar — free: ${free.join(', ')}`);
    return null;
  };
  const colourFor = (area, state, cal) => {
    const id = areaColorId(area);
    if (state === 'rough') return id ? paleOf(id) : roughColor(cal?.backgroundColor, eventColors);
    return id;
  };
  // A block's area from its key (a task with a time, or a record of a missed one, takes its task's).
  const areaOfKey = (key, ids) => {
    const seg = String(key).split('|')[1] ?? '';
    return key.startsWith('task|') || seg === 'fixed' || seg === 'done' ? String(items[ids[0]]?.area ?? '') : seg;
  };
  // The notes at the top of a block's description: the note alone for one task, "Title — note" for several.
  const noteLines = (ids) => {
    const unique = [...new Set(ids)];
    const withNotes = unique.map((id) => items[id]).filter(Boolean);
    if (unique.length === 1) return withNotes.map((i) => i.notes).filter(Boolean);
    return withNotes.map((i) => `${i.title}${i.notes ? ` — ${i.notes}` : ''}`);
  };
  // Time off as busy time for one area's blocks on a day: its stretches of hours, or the whole day.
  const offBusy = (d, area) => {
    const covers = (areas) => !areas?.length || areas.some((a) => norm(a) === norm(area));
    const out = offWindows(doc, d, offs).filter((w) => covers(w.areas)).map((w) => ({ start: w.start, end: w.end, title: 'time off' }));
    if (offs.some((o) => offCovers(o, d) && covers(o.areas))) {
      out.push({ start: at(d, '00:00').getTime(), end: at(addDays(d, 1), '00:00').getTime(), title: 'time off' });
    }
    return out;
  };

  const candidates = raw.filter((e) => watchedIds.has(e.calendarId)).map((e) => normEvent(e, e.calendarId));
  // A retry after an ambiguous Calendar response can leave two owned events with
  // one planning key. Prefer the user's placement, then the exact replacement.
  const duplicates = [];
  const owned = new Map();
  for (const ev of candidates.filter((e) => e.mine && e.props[P.key]).sort((a, b) =>
    Number(movedByGeorge(b)) - Number(movedByGeorge(a))
      || Number(a.props[P.state] === 'rough') - Number(b.props[P.state] === 'rough')
      || a.id.localeCompare(b.id))) {
    const key = ev.props[P.key];
    if (owned.has(key)) duplicates.push(ev);
    else owned.set(key, ev);
  }
  const duplicateSet = new Set(duplicates);
  const listed = candidates.filter((e) => !duplicateSet.has(e));
  const present = new Set(candidates.map((e) => e.id));
  const timed = listed.filter((e) => !e.cancelled && !e.allDay && e.start && e.end);
  // All-day events used to be skipped outright, so a day George had marked "no work" the obvious way
  // was invisible and the planner booked straight through it. Anything all-day and busy on a watched
  // calendar now holds the days it covers; the ignore list is what keeps Holidays and Family out.
  const replacingAllDay = listed.filter(e => e.mine && e.allDay && !e.cancelled
    && splitIds(e.props[P.items]).some(id => doc.calendar?.['conflict:' + id]?.resolution === 'dashboard'));
  const allDayBusy = listed.filter((e) => e.allDay && !e.cancelled && !e.free && e.dates?.from && !replacingAllDay.includes(e));

  // A task counts as done from the day it's ticked; a habit only on the day ticked. `at` is the
  // latest tick's time, when the log has one; `span` is when it actually happened, from a tick that
  // knows (a Hevy workout's start and end).
  const doneLogs = Object.values(doc.logs ?? {}).filter((l) => l.kind === 'done' && l.status === 'active' && l.itemId);
  function tickOf(id, day) {
    const isTask = items[id]?.type === 'task';
    let finished = false;
    let when = null;
    let span = null;
    for (const l of doneLogs) {
      if (l.itemId !== id || (isTask ? l.day > day : l.day !== day)) continue;
      finished = true;
      const t = Date.parse(l.at ?? '');
      if (Number.isFinite(t) && (when == null || t > when)) when = t;
      const f = Date.parse(l.from ?? '');
      if (Number.isFinite(f) && Number.isFinite(t) && t > f && (span == null || t > span.end)) span = { start: f, end: t };
    }
    return { finished, at: when, span };
  }

  const recs = {};
  const rec = (d) => (recs[d] ??= {
    blocks: [], skipped: new Set(memory[d]?.skipped ?? []), missed: [...(memory[d]?.missed ?? [])],
  });
  const covered = new Map();
  const cover = (d, ids) => { const s = covered.get(d) ?? new Set(); for (const id of ids) s.add(id); covered.set(d, s); };
  const usedKeys = new Map();
  const useKey = (d, k) => { const s = usedKeys.get(d) ?? new Set(); s.add(k); usedKeys.set(d, s); };
  const hard = [];
  const busy = (start, end, title) => hard.push({ start, end, title });
  // A day George has blocked out wholesale, held from midnight to midnight so nothing can be slipped
  // into either end of it.
  for (const ev of allDayBusy) {
    const last = ev.dates.to && ev.dates.to > ev.dates.from ? ev.dates.to : addDays(ev.dates.from, 1);
    for (let d = ev.dates.from; d < last; d = addDays(d, 1)) {
      busy(at(d, '00:00').getTime(), at(addDays(d, 1), '00:00').getTime(), ev.title || 'all day');
    }
  }
  const keep = new Map();
  const actions = duplicates.map((ev) => ({ op: 'delete', calendarId: ev.calendarId, eventId: ev.id }));
  const record = (d, b) => rec(d).blocks.push({
    key: b.key, eventId: b.eventId, calendarId: b.calendarId, calendar: calName(b.calendarId), title: b.title,
    start: iso(b.start), end: iso(b.end), state: b.state, items: b.items, ...(b.items?.length === 1 && items[b.items[0]]?.type === 'task' ? { input: taskInput(items[b.items[0]]) } : {}),
  });

  // An event's new shape: nothing when it's already right; a patch; or, for a rough block becoming
  // anything else, a fresh event (a patch can't be relied on to take the rough colour off).
  function emit(ev, body, key) {
    const toRough = body.extendedProperties.private[P.state] === 'rough';
    if ((ev.props[P.state] === 'rough' && !toRough) || (ev.colorId && body.colorId === undefined)) {
      actions.push({ op: 'delete', calendarId: ev.calendarId, eventId: ev.id });
      actions.push({ op: 'insert', calendarId: ev.calendarId, key, body, afterDelete: ev.id });
      return null;
    }
    if (!sameAs(ev, body)) actions.push({ op: 'patch', calendarId: ev.calendarId, eventId: ev.id, body });
    return ev.id;
  }

  function patchHabit(ev, span, extra, keepAt = false) {
    const props = { ...ev.props, ...extra };
    if (!keepAt) props[P.at] = atText(span.start, span.end);
    const same = span.start === ev.start.getTime() && span.end === ev.end.getTime()
      && Object.keys(props).every((k) => ev.props[k] === props[k]);
    if (same) return;
    actions.push({
      op: 'patch', calendarId: ev.calendarId, eventId: ev.id,
      body: { start: { dateTime: iso(span.start) }, end: { dateTime: iso(span.end) }, extendedProperties: { private: props } },
    });
  }

  // Where finished work goes when it was done outside its block: ending at the tick, as long as the
  // block was, but not starting before whatever came before it that day; at least a quarter hour.
  function recordSpan(tick, length, exceptId) {
    const d = localDay(new Date(tick));
    const before = timed
      .filter((e) => e.id !== exceptId && !e.free && e.end.getTime() <= tick && localDay(e.start) === d)
      .map((e) => e.end.getTime());
    let start = Math.max(tick - length, at(d, '00:00').getTime(), ...before);
    if (tick - start < MIN_BLOCK) start = tick - MIN_BLOCK;
    return { start, end: tick };
  }

  // What George deleted: a block booked last run, not yet over, whose event has gone.
  for (const [d, prev] of Object.entries(memory)) {
    if (d < yesterday) continue;
    for (const b of prev.blocks ?? []) {
      if (!b.eventId || !['rough', 'exact', 'fixed'].includes(b.state)) continue;
      if (present.has(b.eventId) || Date.parse(b.end) <= nowMs) continue;
      const kd = String(b.key).startsWith('task|') ? d : String(b.key).split('|')[0] || d;
      for (const id of b.items ?? []) rec(kd).skipped.add(id);
    }
  }

  // ---- The planner's own events -----------------------------------------------------------------
  const fixedWanted = new Map(fixedTasks({ doc, days, config, links }).map((f) => [f.key, f]));
  for (const ev of timed.filter((e) => e.mine)) {
    const key = ev.props[P.key] ?? '';
    const kd = key.startsWith('task|') ? localDay(ev.start) : key.split('|')[0] || localDay(ev.start);
    const state = fixedWanted.has(key) ? 'fixed' : ev.props[P.state];
    const ids = splitIds(ev.props[P.items]);
    const originalBase = ev.props[P.title] ?? ev.title;
    let base = key.startsWith('task|') && ids.length === 1 && items[ids[0]] ? items[ids[0]].title + (originalBase.match(/ \(\d+ of \d+\)$/)?.[0] ?? '') : originalBase;
    const start = ev.start.getTime();
    const end = ev.end.getTime();
    const currentItem = ids.length === 1 ? items[ids[0]] : null;
    let baseline = null;
    try { baseline = JSON.parse(ev.props[P.input] || 'null'); } catch {}
    const inputChanged = baseline && currentItem && ['date', 'time', 'minutes', 'hold'].some((k) => baseline[k] !== taskInput(currentItem)[k]);
    const pinned = movedByGeorge(ev) && !inputChanged && !ids.some((id) => doc.calendar?.['conflict:' + id]?.resolution === 'dashboard');
    if (pinned && ids.length > 1 && !HISTORY.has(state)) base = ids.map((id) => items[id]?.title ?? id).join(' · ').slice(0, 1000);
    if (ids.some((id) => doc.calendar?.['conflict:' + id]?.open)) {
      busy(start, end, ev.title); cover(kd, ids); useKey(kd, key); fixedWanted.delete(key);
      record(kd, { key, eventId: ev.id, calendarId: ev.calendarId, title: ev.title, start, end, state: 'conflict', items: ids });
      continue;
    }
    if (start > nowMs && ids.length && ids.every((id) => items[id]?.scheduleHold || items[id]?.status !== 'active')) {
      actions.push({ op: 'delete', calendarId: ev.calendarId, eventId: ev.id }); fixedWanted.delete(key); continue;
    }
    const settle = (span, nextState, title, coverIds = ids, nextBase = base) => {
      const colorId = HISTORY.has(state) ? ev.colorId : colourFor(areaOfKey(key, ids), nextState, calendars.find((c) => c.id === ev.calendarId));
      const body = bodyFor({ key, base: nextBase, title, start: span.start, end: span.end, items: ids, state: nextState, pinned, colorId, notes: noteLines(ids) });
      const eventId = emit(ev, body, key);
      const landed = localDay(new Date(span.start));
      busy(span.start, span.end, title);
      // Cover the day the block is actually on, not the day its key names. A block George drags to
      // the next day keeps the key it was made with; covering the key's day told the wrong day it
      // was booked, so the day it landed on booked the same thing again and the day it left lost its
      // own. The key stays claimed on its original day so a replacement there gets a fresh one.
      cover(landed, coverIds);
      useKey(kd, key);
      record(landed, { key, eventId, calendarId: ev.calendarId, title, start: span.start, end: span.end, state: nextState, items: ids });
    };

    if (HISTORY.has(state)) {
      settle({ start, end }, state, ev.title, state === 'done' ? ids : ids.filter((id) => tickOf(id, kd).finished));
      continue;
    }
    // A user placement beyond the automatic horizon remains an actual booking.
    // It must not be mistaken for a task that no longer wants an event.
    if (currentItem?.type === 'task' && currentItem.status === 'active' && currentItem.date > lastDay && !currentItem.scheduleHold) {
      settle({ start, end }, 'fixed', currentItem.title);
      fixedWanted.delete(key);
      continue;
    }
    if (state === 'fixed') {
      const wantedKey = fixedWanted.has(key) ? key : ids.length === 1 ? `task|${ids[0]}|0` : key;
      const want = fixedWanted.get(wantedKey);
      fixedWanted.delete(wantedKey);
      const finished = ids.length > 0 && tickOf(ids[0], kd).finished;
      if (!want && !finished && start > nowMs && !pinned) {
        actions.push({ op: 'delete', calendarId: ev.calendarId, eventId: ev.id });
        continue;
      }
      const span = want && !pinned && start > nowMs ? { start: want.start, end: want.end } : { start, end };
      const name = want?.title ?? base;
      settle(span, 'fixed', finished ? `✓ ${name}` : name, ids, name);
      continue;
    }

    const ticks = ids.map((id) => tickOf(id, kd));
    const doneCount = ticks.filter((t) => t.finished).length;
    const lastTick = ticks.reduce((m, t) => (t.at != null && (m == null || t.at > m) ? t.at : m), null);
    const allDone = ids.length > 0 && doneCount === ids.length;

    if (allDone && lastTick != null) {
      let span = { start, end };
      if (lastTick >= start && lastTick < end) span = { start, end: Math.max(lastTick, start + MIN_BLOCK) };
      else if (lastTick < start || localDay(new Date(lastTick)) === localDay(ev.start)) span = recordSpan(lastTick, end - start, ev.id);
      settle(span, 'done', blockTitle(base, 'done'));
      continue;
    }
    if (allDone) {
      if (start > nowMs && !pinned) {
        actions.push({ op: 'delete', calendarId: ev.calendarId, eventId: ev.id });
        continue;
      }
      settle({ start, end }, 'done', blockTitle(base, 'done'));
      continue;
    }
    if (end <= nowMs) {
      if (doneCount > 0) {
        settle({ start, end }, 'partial', blockTitle(base, 'partial', doneCount, ids.length), ids.filter((_, i) => ticks[i].finished));
      } else if (!ids.length) {
        settle({ start, end }, 'done', base);
      } else {
        actions.push({ op: 'delete', calendarId: ev.calendarId, eventId: ev.id });
        for (const id of ids) {
          if (!rec(kd).missed.some((m) => m.itemId === id)) rec(kd).missed.push({ itemId: id, minutes: items[id]?.minutes ?? config.defaultMinutes });
        }
      }
      continue;
    }
    if (start <= nowMs) {
      const nextState = state === 'rough' ? 'exact' : state;
      settle({ start, end }, nextState, blockTitle(base, nextState, doneCount, ids.length));
      continue;
    }
    if (pinned) {
      const nextState = state === 'rough' && exactDay(kd) ? 'exact' : state;
      settle({ start, end }, nextState, blockTitle(base, nextState, doneCount, ids.length));
      continue;
    }
    keep.set(key, ev);
  }

  // A migration must delete the old generated block successfully before any
  // replacement is inserted. Keep a parent for every child, not just the first.
  const migrationParents = timed.filter((e) => e.mine && !e.props[P.key]?.startsWith('task|')
    && e.start.getTime() > nowMs && !movedByGeorge(e) && !HISTORY.has(e.props[P.state]));
  migrationParents.push(...replacingAllDay);
  const migrationFor = (ids, key) => migrationParents.find((e) => (e.props[P.key] !== key || e.allDay)
    && splitIds(e.props[P.items]).some((id) => ids.includes(id)));
  const migrate = (parent) => {
    if (!parent) return {};
    if (!actions.some((a) => a.op === 'delete' && a.calendarId === parent.calendarId && a.eventId === parent.id)) {
      actions.push({ op: 'delete', calendarId: parent.calendarId, eventId: parent.id });
    }
    keep.delete(parent.props[P.key]);
    return { afterDelete: parent.id, afterDeleteCalendar: parent.calendarId };
  };

  // Tasks with a time that have no event yet.
  for (const f of fixedWanted.values()) {
    if (f.start <= nowMs || tickOf(f.itemId, f.day).finished || rec(f.day).skipped.has(f.itemId)) continue;
    const cal = calendarFor(f.area, config, find, problems);
    if (!cal) continue;
    const migration = migrate(migrationFor([f.itemId], f.key));
    actions.push({ op: 'insert', ...migration, calendarId: cal.id, key: f.key, body: bodyFor({ key: f.key, base: f.title, title: f.title, start: f.start, end: f.end, items: [f.itemId], state: 'fixed', colorId: colourFor(f.area, 'fixed', cal), notes: noteLines([f.itemId]) }) });
    busy(f.start, f.end, f.title);
    cover(f.day, [f.itemId]);
    useKey(f.day, f.key);
    record(f.day, { key: f.key, eventId: null, calendarId: cal.id, title: f.title, start: f.start, end: f.end, state: 'fixed', items: [f.itemId] });
  }

  // ---- Everything else: fixed events, links to tasks, Hebrew and Gym ------------------------------
  const resolveRef = (ref) => {
    if (items[ref]) return ref;
    if (ref.length < 4) return null;
    const hits = itemIds.filter((id) => id.startsWith(ref));
    return hits.length === 1 ? hits[0] : null;
  };
  const movableHabits = [];
  for (const ev of timed.filter((e) => !e.mine)) {
    const start = ev.start.getTime();
    const end = ev.end.getTime();
    const d = localDay(ev.start);
    const link = links.find((l) => l.calendarId === ev.calendarId && norm(l.title) === norm(ev.title));
    if (!link) {
      if (!ev.free) busy(start, end, ev.title);
      const ids = linkedIds(ev.description).map(resolveRef).filter(Boolean);
      if (ids.length) cover(d, ids);
      continue;
    }
    const tick = tickOf(link.habitId, d);
    if (ev.props[P.state] === 'done' || d < today) { busy(start, end, ev.title); continue; }
    if (tick.finished) {
      let span = { start, end };
      if (tick.span && localDay(new Date(tick.span.start)) === d) span = { start: tick.span.start, end: Math.max(tick.span.end, tick.span.start + MIN_BLOCK) };
      else if (tick.at != null && tick.at >= start && tick.at < end) span = { start, end: Math.max(tick.at, start + MIN_BLOCK) };
      else if (tick.at != null && localDay(new Date(tick.at)) === d) span = recordSpan(tick.at, end - start, ev.id);
      patchHabit(ev, span, { [P.state]: 'done', [P.habit]: link.habitId });
      busy(span.start, span.end, ev.title);
      continue;
    }
    const placedByGeorge = habitPinned(ev);
    if (start <= nowMs || placedByGeorge) {
      if (placedByGeorge && ev.props[P.at] && ev.props[P.pin] !== '1') patchHabit(ev, { start, end }, { [P.pin]: '1' }, true);
      busy(start, end, ev.title);
      continue;
    }
    movableHabits.push({ ev, link, day: d });
  }
  movableHabits.sort((a, b) => a.ev.start - b.ev.start);

  // A missed task ticked later today: a record of it, ending at the tick.
  const todayRec = rec(today);
  todayRec.missed = todayRec.missed.filter((m) => {
    const t = tickOf(m.itemId, today);
    if (!t.finished) return true;
    if (t.at == null || covered.get(today)?.has(m.itemId) || !items[m.itemId]) return false;
    const cal = calendarFor(items[m.itemId].area ?? '', config, find, problems);
    if (!cal) return false;
    const key = `${today}|done|${m.itemId}`;
    const span = recordSpan(t.at, m.minutes * MINUTE, null);
    const title = blockTitle(items[m.itemId].title, 'done');
    actions.push({ op: 'insert', calendarId: cal.id, key, body: bodyFor({ key, base: items[m.itemId].title, title, start: span.start, end: span.end, items: [m.itemId], state: 'done', colorId: colourFor(items[m.itemId].area ?? '', 'done', cal), notes: noteLines([m.itemId]) }) });
    busy(span.start, span.end, title);
    cover(today, [m.itemId]);
    useKey(today, key);
    record(today, { key, eventId: null, calendarId: cal.id, title, start: span.start, end: span.end, state: 'done', items: [m.itemId] });
    return false;
  });

  // ---- What needs time, and where it goes ---------------------------------------------------------
  const windowOf = (d) => {
    const [from, to] = config.dayHours[d] ?? config.hours;
    const open = at(d, from).getTime();
    const close = at(d, to).getTime();
    return { open, start: dayClosed(doc, d) ? close : d === today ? Math.max(open, ceilQuarter(nowMs)) : open, end: close };
  };
  const todayWindow = windowOf(today);
  const todayClosed = dayClosed(doc, today) || todayWindow.start + MIN_BLOCK > todayWindow.end;
  for (const d of days) cover(d, rec(d).skipped);
  const { blocks: wanted } = demand({ doc, today, days, config, links, covered, usedKeys, todayClosed });

  const placed = [];
  let overflow = [];
  for (const d of days) {
    const win = windowOf(d);
    for (const { ev, link } of movableHabits.filter((m) => m.day === d)) {
      const start = ev.start.getTime();
      const length = ev.end.getTime() - start;
      const clash = hard.find((h) => start < h.end && h.start < start + length);
      if (!clash) { busy(start, start + length, ev.title); continue; }
      const to = nearestFit(length, start, win, hard, gap);
      if (to == null) {
        note(`${ev.title}${onDay(d)} clashes with ${clash.title} and there's no free time to move it to`);
        busy(start, start + length, ev.title);
        continue;
      }
      patchHabit(ev, { start: to, end: to + length }, { [P.habit]: link.habitId });
      if (exactDay(d)) note(`Moved ${ev.title}${onDay(d)} to ${hhmm(to)} (${clash.title})`);
      busy(to, to + length, ev.title);
    }

    const queue = [...overflow, ...wanted.filter((b) => b.day === d)]
      .sort((a, b) => Number(b.priority) - Number(a.priority) || Number(b.carried) - Number(a.carried)
        || b.minutes - a.minutes || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    overflow = [];
    const taken = [...hard];
    const slot = new Map();
    const take = (b, s) => { slot.set(b.key, s); taken.push({ start: s, end: s + b.minutes * MINUTE, title: b.base }); };
    if (exactDay(d)) {
      for (const b of queue) {
        const ex = keep.get(b.key);
        if (!ex || localDay(ex.start) !== d) continue;
        const s = ex.start.getTime();
        const e = s + b.minutes * MINUTE;
        if (s >= win.open && e <= win.end && fits(s, e, [...taken, ...offBusy(d, b.area)], gap)) take(b, s);
      }
    }
    for (const b of queue) {
      if (slot.has(b.key)) continue;
      const s = earliestFit(b.minutes * MINUTE, win, [...taken, ...offBusy(d, b.area)], gap);
      if (s != null) { take(b, s); continue; }
      const next = addDays(d, 1);
      // Carrying is right for a task — it still needs doing. A habit that repeats already has its own
      // instance on the next day, so carrying it there booked two and left this day with none: one
      // reading habit drifted a day at a time until it appeared twice on a Sunday and not at all on
      // the Friday. A habit that doesn't fit is simply missed that day.
      const allHabits = b.items.length > 0 && b.items.every((id) => items[id]?.type === 'habit');
      if (allHabits) {
        if (exactDay(d) && !(d === today && todayClosed)) note(`Couldn't fit ${b.base}${onDay(d)}`);
      } else if (next <= lastDay) {
        overflow.push({ ...b, carried: true });
        if (exactDay(d) && !(d === today && todayClosed)) note(`Couldn't fit ${b.base}${onDay(d)} — moved to ${shortWeekday(next)}`);
      } else {
        note(`Couldn't fit ${b.base} in the next ${config.days} days`);
      }
    }
    for (const b of queue) if (slot.has(b.key)) placed.push({ b, day: d, start: slot.get(b.key) });
  }

  for (const { b, day, start } of placed) {
    const end = start + b.minutes * MINUTE;
    const state = exactDay(day) ? 'exact' : 'rough';
    const cal = calendarFor(b.area, config, find, problems);
    if (!cal) continue;
    const title = blockTitle(b.base, state);
    const body = bodyFor({ key: b.key, base: b.base, title, start, end, items: b.items, state, colorId: colourFor(b.area, state, cal), notes: noteLines(b.items) });
    const ex = keep.get(b.key);
    const migration = ex ? {} : migrate(migrationFor(b.items, b.key));
    keep.delete(b.key);
    let eventId = null;
    if (ex && ex.calendarId === cal.id) {
      eventId = emit(ex, body, b.key);
      if (state === 'exact' && ex.props[P.state] === 'exact' && ex.start.getTime() !== start) {
        const s0 = ex.start.getTime();
        const e0 = ex.end.getTime();
        const why = hard.find((h) => !fits(s0, e0, [h], gap))?.title;
        note(`Moved ${b.base}${onDay(day)} to ${hhmm(start)}${why ? ` (${why})` : ''}`);
      }
    } else {
      if (ex) actions.push({ op: 'delete', calendarId: ex.calendarId, eventId: ex.id });
      actions.push({ op: 'insert', ...migration, calendarId: cal.id, key: b.key, body, ...(ex ? { afterDelete: ex.id, afterDeleteCalendar: ex.calendarId } : {}) });
    }
    record(day, { key: b.key, eventId, calendarId: cal.id, title, start, end, state, items: b.items });
  }
  for (const ex of keep.values()) actions.push({ op: 'delete', calendarId: ex.calendarId, eventId: ex.id });

  const out = {};
  for (const d of [...new Set([yesterday, ...days, ...Object.keys(recs)])]) {
    const r = rec(d);
    out[d] = {
      day: d,
      blocks: [...r.blocks].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)),
      skipped: [...r.skipped].sort(),
      missed: r.missed,
      notes: [],
    };
  }
  const before = memory[today]?.notes ?? [];
  out[today].notes = [...before, ...[...problems, ...notes].filter((n) => !before.includes(n))].slice(-MAX_NOTES);
  return { actions, days: out, problems: [...problems], takenColors };
}
