// What the Coach may look up and change, and the gate on it: changes only to today and tomorrow.
// Each change goes through the store like one of Claude's and is logged as the Coach's (a change
// with source 'coach'), so ⚙ → Claude → Changes lists it with Undo. A refusal goes back to Gemini
// as { ok: false, error } in words it can pass on; hand_to_claude and finish are handed to the
// panel (js/ui/coach.js), which keeps them with the conversation.

import { addDays, daysBetween } from './dates.js';
import { rowsForDay } from './schedule.js';
import { checkTimeOff, nextOffId } from './calendar.js';
import { parseLength, parseClock, checkNotes, formatAmount } from './parse.js';
import { diffDocs } from './changes.js';
import { clip } from './coach.js';
import { findItem, dayText, gymText, findText, journalText, cleanEntry, cleanHandoff } from './talk.js';

const S = (description) => ({ type: 'STRING', description });
const decl = (name, description, properties = {}, required = []) => ({ name, description, parameters: { type: 'OBJECT', properties, required } });
const DAY = S('"today", "tomorrow", or a date as YYYY-MM-DD');
const ID = S("the item's 8-character id from the lists");

export const TOOL_DECLARATIONS = [
  decl('get_day', "A day's list, calendar, time off, gym sessions and journal, from 30 days back to 7 ahead.", { day: DAY }, ['day']),
  decl('get_gym', "His training from Hevy: each key lift's estimated 1RM, pace and PRs, and the last 14 days' sessions; or one lift.", { lift: S('a lift by its Hevy name, e.g. "Squat (Barbell)"; leave out for every key lift') }),
  decl('find', 'Tasks, habits, weekly targets and goals whose title or notes contain the words.', { words: S('what to look for') }, ['words']),
  decl('get_journal', 'His saved journal entries, newest first.', { days: { type: 'INTEGER', description: 'how many days back, 1 to 30 (default 7)' } }),
  decl('add_task', 'Add a task for today or tomorrow.', {
    title: S('a few words'), day: DAY, minutes: S('its length, like "45m" or "2h"'), time: S('a set start, like "14:00"'),
    area: S('an area already in use, like "Job search"'), notes: S('detail behind the title'),
  }, ['title', 'day']),
  decl('move_task', "Move a task on today's or tomorrow's list to the other of the two days.", { id: ID, day: DAY }, ['id', 'day']),
  decl('skip', "Skip something on today's list: a task moves to tomorrow; a habit is let off today, its streak safe.", { id: ID, reason: S('why, in a few words') }, ['id']),
  decl('set_task', "Set a length, a time or notes on a task on today's or tomorrow's list. Notes replace any it has; \"\" clears a field.", {
    id: ID, minutes: S('its length, like "45m" or "2h"'), time: S('a set start, like "14:00"'), notes: S('the notes'),
  }, ['id']),
  decl('tick', "Tick off a task or habit on today's list that he says he has done.", { id: ID }, ['id']),
  decl('untick', "Take the tick off something on today's list.", { id: ID }, ['id']),
  decl('block_hours', "Block out hours today or tomorrow when he's busy, so the calendar plans round them.", {
    day: DAY, start: S('like "13:00"'), end: S('like "17:00"'), reason: S('a few words'),
  }, ['day', 'start', 'end']),
  decl('hand_to_claude', "Pass something to Claude: anything you can't do (goals, habits, weekly targets, whole days off, anything after tomorrow), or anything Claude should know.", {
    text: S('what George wants, in a sentence or two'),
  }, ['text']),
  decl('finish', 'End the conversation with its journal entry.', {
    feeling: S('how he is feeling, in a few words'), text: S("what's on his mind, at most 600 characters"),
    pointers: { type: 'ARRAY', items: { type: 'STRING' }, description: 'up to 5 short pointers he gave' },
  }, ['text']),
];

class Refusal extends Error {}
const refuse = (message) => { throw new Refusal(message); };
const LATER = 'The Coach can only change today and tomorrow — hand anything else to Claude with hand_to_claude';

export function coachTools({ store, onHandoff = () => {}, onFinish = () => {} }) {
  const today = () => store.today();
  const tomorrow = () => addDays(today(), 1);
  const dayName = (d) => (d === today() ? 'today' : 'tomorrow');

  function dayOf(v) {
    const s = String(v ?? '').trim().toLowerCase();
    const d = s === 'today' ? today() : s === 'tomorrow' ? tomorrow() : s;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || addDays(d, 0) !== d) refuse(`"${v}" isn't a day — use today, tomorrow or YYYY-MM-DD`);
    return d;
  }
  const gated = (v) => { const d = dayOf(v); if (d !== today() && d !== tomorrow()) refuse(LATER); return d; };
  const item = (ref) => { try { return findItem(store.doc(), ref); } catch (e) { return refuse(e.message); } };
  const onList = (it, day) => rowsForDay(store.doc(), day).some((r) => r.item.id === it.id);
  const task = (ref) => {
    const it = item(ref);
    if (it.type !== 'task') refuse(`"${it.title}" is a ${it.type === 'quota' ? 'weekly target' : it.type}, not a task`);
    if (it.status !== 'active' || (!onList(it, today()) && !onList(it, tomorrow()))) refuse(`"${it.title}" isn't on today's or tomorrow's list`);
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
    const rec = edits.length ? store.addChange({ summary, edits, source: 'coach' }) : null;
    return { ok: true, did: summary, change: rec?.id ?? null };
  }

  function tick(ref, on) {
    const it = item(ref);
    if (it.type === 'quota') refuse(`"${it.title}" is a weekly target — he logs his time or count on it himself`);
    const row = rowsForDay(store.doc(), today()).find((r) => r.item.id === it.id);
    if (!row) refuse(`"${it.title}" isn't on today's list`);
    if (row.done === on) return { ok: true, did: `"${it.title}" was already ${on ? 'ticked' : 'unticked'}` };
    return change(`${on ? 'Ticked' : 'Unticked'} "${it.title}"`, () => store.toggleDone(it.id, today(), 'coach'));
  }

  const TOOLS = {
    get_day: ({ day }) => {
      const d = dayOf(day);
      const n = daysBetween(today(), d);
      if (n < -30 || n > 7) refuse('get_day looks from 30 days back to 7 days ahead');
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
    move_task: ({ id, day }) => {
      const it = task(id);
      const d = gated(day);
      if (it.date === d) return { ok: true, did: `"${it.title}" was already on ${dayName(d)}'s list` };
      return change(`Moved "${it.title}" to ${dayName(d)}`, () => store.updateItem(it.id, { date: d }));
    },
    skip: ({ id, reason }) => {
      const it = item(id);
      if (it.status !== 'active' || !onList(it, today())) refuse(`"${it.title}" isn't on today's list`);
      if (it.type === 'task') return change(`Moved "${it.title}" to tomorrow`, () => store.updateItem(it.id, { date: tomorrow() }));
      if (it.type !== 'habit') refuse(`"${it.title}" is a weekly target — it can't be skipped`);
      const why = clip(typeof reason === 'string' ? reason : '', 120);
      return change(`Let "${it.title}" off today${why ? ` — ${why}` : ''}`, () => store.skipItem(it.id, today(), why, 'coach'));
    },
    set_task: (a) => {
      const it = task(a.id);
      const changes = {};
      const said = [];
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
