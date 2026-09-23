// What the Coach may look up and change, and the gate on it: changes only to today and tomorrow.
// Each change goes through the store like one of Claude's and is logged as the Coach's (a change
// with source 'coach'), so ⚙ → Claude → Changes lists it with Undo. A refusal goes back to Gemini
// as { ok: false, error } in words it can pass on; hand_to_claude and finish are handed to the
// panel (js/ui/coach.js), which keeps them with the conversation.

import { addDays, daysBetween } from './dates.js';
import { rowsForDay } from './schedule.js';
import { checkTimeOff, nextOffId } from './calendar.js';
import { parseLength, parseClock, checkNotes, formatAmount } from './parse.js';
import { dayClosed } from './plan-state.js';
import { diffDocs, undoLine, canUndo } from './changes.js';
import { clip } from './coach.js';
import { findItem, dayText, gymText, findText, journalText, cleanEntry, cleanHandoff } from './talk.js';

const S = (description) => ({ type: 'STRING', description });
const decl = (name, description, properties = {}, required = []) => ({ name, description, parameters: { type: 'OBJECT', properties, required } });
const DAY = S('"today", "tomorrow", or a date as YYYY-MM-DD');
const ID = S("the item's 8-character id from the lists");

export const TOOL_DECLARATIONS = [
  decl('get_day', "A day's list, calendar, time off, gym sessions and journal, from 30 days back to 365 ahead; confirmed Calendar bookings and unscheduled work.", { day: DAY }, ['day']),
  decl('get_gym', "His training from Hevy: each key lift's estimated 1RM, pace and PRs, and the last 14 days' sessions; or one lift.", { lift: S('a lift by its Hevy name, e.g. "Squat (Barbell)"; leave out for every key lift') }),
  decl('find', 'Tasks, habits, weekly targets and goals whose title or notes contain the words.', { words: S('what to look for') }, ['words']),
  decl('get_journal', 'His saved journal entries, newest first.', { days: { type: 'INTEGER', description: 'how many days back, 1 to 30 (default 7)' } }),
  decl('add_task', 'Add a task on an explicit date, including future weeks. For a flexible weekend choose and state a date, or ask if it matters.', {
    title: S('a few words'), day: DAY, minutes: S('its length, like "45m" or "2h"'), time: S('a set start, like "14:00"'),
    area: S('an area already in use, like "Job search"'), notes: S('detail behind the title'),
  }, ['title', 'day']),
  decl('move_task', 'Move an active task to the specified date. Read its current requested date first.', { id: ID, day: DAY, expectedDay: DAY }, ['id', 'day']),
  decl('skip', "Skip something on today's list: a task moves to tomorrow; a habit is let off today, its streak safe.", { id: ID, reason: S('why, in a few words') }, ['id']),
  decl('set_task', "Set a title, length, time or notes on an active task. Notes replace any it has; \"\" clears a field.", {
    id: ID, title: S('new title, only when asked'), minutes: S('its length, like "45m" or "2h"'), time: S('a set start, like "14:00"'), notes: S('the notes'),
  }, ['id']),
  decl('release_task', "Record that a task he deleted from today after committing to it genuinely isn't needed any more, so it stops counting as missed. Only on his say-so, with his reason.", {
    id: ID, reason: S('why it is no longer needed, in his words'),
  }, ['id', 'reason']),
  decl('tick', "Tick off a task or habit on today's list that he says he has done.", { id: ID }, ['id']),
  decl('untick', "Take the tick off something on today's list.", { id: ID }, ['id']),
  decl('block_hours', "Block out hours on a specified date when he's busy, so the calendar plans round them.", {
    day: DAY, start: S('like "13:00"'), end: S('like "17:00"'), reason: S('a few words'),
  }, ['day', 'start', 'end']),
  decl('hand_to_claude', "Pass something to Claude: anything you can't do (habits, weekly targets, whole days off, app changes), or anything Claude should know.", {
    text: S('what George wants, in a sentence or two'),
  }, ['text']),
  decl('propose_changes', 'Use before inferred planning or a broad calendar review. Changes become one proposal for George to Apply, not immediate edits.'),
  decl('undo_last_action', 'Undo the last Coach action using its saved before/after records. Never improvise reverse moves.'),
  decl('close_day', 'Close today for planning ONLY when George explicitly says he has finished the day or is going to bed.'),
  decl('reopen_day', 'Reopen today for planning ONLY when George explicitly asks to work on today again.'),
  decl('add_goal', 'Draft a goal and optional milestones in this conversation, ready to accept in Goals.', {
    title: S('the goal'), targetDate: DAY, why: S('why it matters'),
    milestones: { type: 'ARRAY', items: { type: 'STRING' }, description: 'up to 8 concrete stages' },
  }, ['title']),
  decl('finish', 'End the conversation with its journal entry.', {
    feeling: S('how he is feeling, in a few words'), text: S("what's on his mind, at most 600 characters"),
    pointers: { type: 'ARRAY', items: { type: 'STRING' }, description: 'up to 5 short pointers he gave' },
  }, ['text']),
];

class Refusal extends Error {}
const refuse = (message) => { throw new Refusal(message); };


export function coachTools({ store, onHandoff = () => {}, onFinish = () => {}, onProposal = () => {}, logChanges = true }) {
  const today = () => store.today();
  const tomorrow = () => addDays(today(), 1);
  const dayName = (d) => (d === today() ? 'today' : d === tomorrow() ? 'tomorrow' : d);

  function dayOf(v) {
    const s = String(v ?? '').trim().toLowerCase();
    const d = s === 'today' ? today() : s === 'tomorrow' ? tomorrow() : s;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || addDays(d, 0) !== d) refuse(`"${v}" isn't a day — use today, tomorrow or YYYY-MM-DD`);
    return d;
  }
  const gated = (v) => { const d = dayOf(v); if (d < today()) refuse('New work cannot be moved into the past'); if (dayClosed(store.doc(), d)) refuse('That day is closed. Capture this on another date, or reopen the day only if George asks.'); return d; };
  const item = (ref) => { try { return findItem(store.doc(), ref); } catch (e) { return refuse(e.message); } };
  const onList = (it, day) => rowsForDay(store.doc(), day).some((r) => r.item.id === it.id);
  const task = (ref) => {
    const it = item(ref);
    if (it.type !== 'task') refuse(`"${it.title}" is a ${it.type === 'quota' ? 'weekly target' : it.type}, not a task`);
    if (it.status !== 'active') refuse('That task is not active');
    return it;
  };
  const lengthOf = (v) => {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? (Number.isInteger(v) && v >= 5 && v <= 720 ? v : null) : parseLength(String(v));
    return n ?? refuse('A length is from 5 minutes to 12 hours, like "45m" or "2h"');
  };
  const clockOf = (v, what = 'A time') => {
    if (v == null || v === '') return null;
    return parseClock(String(v)) ?? refuse(`${what} should look like 14:00`);
  };

  // One change, logged as the Coach's.
  function change(summary, fn) {
    const before = structuredClone(store.doc());
    fn();
    const edits = diffDocs(before, store.doc());
    const rec = logChanges && edits.length ? store.addChange({ summary, edits, source: 'coach' }) : null;
    return { ok: true, did: summary, change: rec?.id ?? null };
  }

  function tick(ref, on) {
    const it = item(ref);
    if (it.type === 'quota') refuse(`"${it.title}" is a weekly target — he logs his time or count on it himself`);
    const row = rowsForDay(store.doc(), today()).find((r) => r.item.id === it.id);
    if (!row && it.type !== 'task') refuse(`"${it.title}" isn't on today's list`);
    const log = it.type === 'task' ? Object.values(store.doc().logs).find((l) => l.kind === 'done' && l.itemId === it.id && l.status === 'active') : null;
    const isDone = it.type === 'task' ? !!log : !!row?.done;
    if (isDone === on) return { ok: true, did: `"${it.title}" was already ${on ? 'ticked' : 'unticked'}` };
    return change(`${on ? 'Ticked' : 'Unticked'} "${it.title}"`, () => store.toggleDone(it.id, !on && log ? log.day : today(), 'coach'));
  }

  const TOOLS = {
    get_day: ({ day }) => {
      const d = dayOf(day);
      const n = daysBetween(today(), d);
      if (n < -30 || n > 365) refuse('get_day looks from 30 days back to 365 days ahead');
      return { ok: true, text: dayText(store.doc(), d, today()) };
    },
    get_gym: ({ lift }) => ({ ok: true, text: gymText(store.doc(), today(), lift ? String(lift) : '') }),
    find: ({ words }) => ({ ok: true, text: findText(store.doc(), words) }),
    get_journal: ({ days }) => ({ ok: true, text: journalText(store.doc(), today(), days) }),

    add_task: (a) => {
      const title = String(a.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!title) refuse('add_task needs a title');
      const day = gated(a.day ?? 'today');
      const minutes = lengthOf(a.minutes);
      const time = clockOf(a.time);
      const notes = a.notes ? checkNotes(String(a.notes)) : '';
      const area = String(a.area ?? '').trim().slice(0, 40);
      return change(`Added "${title}" for ${dayName(day)}`, () => store.addItem({
        type: 'task', title, date: day, area, source: 'gemini',
        ...(minutes ? { minutes } : {}), ...(time ? { time } : {}), ...(notes ? { notes } : {}),
      }));
    },
    move_task: ({ id, day, expectedDay }) => {
      const it = task(id);
      const d = gated(day);
      if (expectedDay && it.date !== dayOf(expectedDay)) refuse('The task date has changed. Read the schedule again.');
      if (it.date === d && !it.scheduleHold) return { ok: true, did: `"${it.title}" was already on ${dayName(d)}'s list` };
      return change(`Moved "${it.title}" to ${dayName(d)}`, () => store.updateItem(it.id, { date: d, ...(it.time ? { time: null } : {}), ...(it.scheduleHold ? { scheduleHold: false } : {}) }));
    },
    skip: ({ id, reason }) => {
      const it = item(id);
      if (it.status !== 'active' || !onList(it, today())) refuse(`"${it.title}" isn't on today's list`);
      if (it.type === 'task') return change(`Moved "${it.title}" to tomorrow`, () => store.updateItem(it.id, { date: gated(tomorrow()), ...(it.time ? { time: null } : {}), ...(it.scheduleHold ? { scheduleHold: false } : {}) }));
      if (it.type !== 'habit') refuse(`"${it.title}" is a weekly target — it can't be skipped`);
      const why = clip(typeof reason === 'string' ? reason : '', 120);
      return change(`Let "${it.title}" off today${why ? ` — ${why}` : ''}`, () => store.skipItem(it.id, today(), why, 'coach'));
    },
    release_task: ({ id, reason }) => {
      const why = clip(typeof reason === 'string' ? reason : '', 120);
      if (!why) refuse('release_task needs his reason');
      const it = item(id);
      if (it.type !== 'task') refuse(`"${it.title}" isn't a task`);
      if (it.status === 'active') refuse(`"${it.title}" is still on his list — only a deleted task can be released`);
      return change(`Released "${it.title}" — ${why}`, () => store.updateItem(it.id, { released: why }));
    },
    set_task: (a) => {
      const it = task(a.id);
      const changes = {};
      const said = [];
      if (a.title !== undefined) { changes.title = String(a.title).trim().slice(0, 120); if (!changes.title) refuse('A task needs a title'); said.push('renamed to ' + changes.title); }
      if (a.minutes !== undefined) { changes.minutes = lengthOf(a.minutes); said.push(changes.minutes ? `length ${formatAmount(changes.minutes, 'minutes')}` : 'no length'); }
      if (a.time !== undefined) { changes.time = clockOf(a.time); said.push(changes.time ? `at ${changes.time}` : 'no set time'); }
      if (a.notes !== undefined) { changes.notes = checkNotes(String(a.notes ?? '')); said.push(changes.notes ? 'new notes' : 'no notes'); }
      if (!said.length) refuse('set_task needs minutes, time or notes');
      return change(`Set "${it.title}": ${said.join(', ')}`, () => store.updateItem(it.id, changes));
    },
    tick: ({ id }) => tick(id, true),
    untick: ({ id }) => tick(id, false),
    block_hours: (a) => {
      const day = gated(a.day);
      const start = clockOf(a.start, 'start') ?? refuse('block_hours needs a start, like "13:00"');
      const end = clockOf(a.end, 'end') ?? refuse('block_hours needs an end, like "17:00"');
      let off;
      try {
        off = checkTimeOff({ start: `${day}T${start}`, end: `${day}T${end}`, areas: [], reason: clip(typeof a.reason === 'string' ? a.reason : '', 200) });
      } catch (e) {
        refuse(e.message);
      }
      const id = nextOffId(store.doc(), off.start);
      return change(`Blocked out ${start}–${end} ${dayName(day)}${off.reason ? ` — ${off.reason}` : ''}`, () => store.putCalendar(id, off, 'coach'));
    },
    propose_changes: () => { onProposal(); return { ok: true, did: 'Preparing a proposal; George will apply it' }; },
    close_day: () => change('Closed today for planning', () => store.putCalendar('closed:' + today(), { day: today(), closed: true }, 'coach')),
    reopen_day: () => change('Reopened today for planning', () => store.putCalendar('closed:' + today(), { day: today(), closed: false }, 'coach')),
    undo_last_action: () => {
      const last = Object.values(store.doc().changes).reverse().filter((c) => c.source === 'coach' && canUndo(c)).sort((a, b) => b.at.localeCompare(a.at))[0];
      if (!last) refuse('There is no Coach action available to undo');
      const result = store.undoChange(last.id, 'coach');
      return { ok: true, did: undoLine(result), change: null };
    },
    add_goal: (a) => {
      const title = String(a.title ?? '').trim().slice(0, 120);
      if (!title) refuse('A goal needs a title');
      const targetDate = a.targetDate ? dayOf(a.targetDate) : null;
      const milestones = Array.isArray(a.milestones) ? a.milestones.slice(0, 8).map(String) : [];
      return change('Drafted goal "' + title + '"', () => store.addPlan({ goal: { title, targetDate, why: String(a.why ?? '').slice(0, 600) }, milestones }));
    },
    hand_to_claude: ({ text }) => {
      const t = cleanHandoff(text);
      onHandoff(t);
      return { ok: true, did: `For Claude: ${t}` };
    },
    finish: (a) => {
      onFinish(cleanEntry(a));
      return { ok: true, did: 'Saved the journal entry' };
    },
  };

  return {
    declarations: TOOL_DECLARATIONS,
    run(name, args) {
      const fn = Object.hasOwn(TOOLS, name) ? TOOLS[name] : null;
      if (!fn) return { ok: false, error: `There's no tool called ${name}` };
      try {
        return fn(args && typeof args === 'object' ? args : {});
      } catch (e) {
        return { ok: false, error: e instanceof Refusal ? e.message : String(e?.message ?? e) };
      }
    },
  };
}
