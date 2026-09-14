process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, done, amount } from './helpers.js';
import { shortId, resolveId } from '../claude/ids.js';
import { q, dayName, when, toDay, repeatText, amountText } from '../claude/text.js';
import { header, READS } from '../claude/read.js';
import { clockLabel } from '../js/calendar.js';

const TODAY = '2026-09-13'; // a Sunday

const doc = () => fixture({
  items: [
    { id: 't1', type: 'task', title: 'Email Sarah', date: TODAY, source: 'claude' },
    { id: 't2', type: 'task', title: 'Update CV', date: '2026-09-10' },
    { id: 't3', type: 'task', title: 'Book flights', date: '2026-09-20', area: 'Travel' },
    { id: 'h1', type: 'habit', title: 'Read 20 pages', repeat: { kind: 'daily' }, goalId: 'g1' },
    { id: 'h2', type: 'habit', title: 'Hebrew', repeat: { kind: 'daily' } },
    { id: 'q1', type: 'quota', title: 'Applications', target: 5, unit: 'count', unitLabel: 'applications' },
    { id: 's1', type: 'task', title: 'Book dentist', date: '2026-09-15', status: 'suggested', source: 'claude' },
    { id: 'x1', type: 'task', title: 'Old CV idea', date: TODAY, status: 'dismissed' },
  ],
  logs: [
    done('h1', '2026-09-11'), done('h1', '2026-09-12'), done('h2', TODAY),
    amount('a1', 'q1', '2026-09-08', 2),
  ],
  goals: [
    { id: 'g1', title: 'Research job', targetDate: '2026-12-01', target: null },
    { id: 'g2', title: 'NatCen application', status: 'suggested', source: 'claude', target: null },
  ],
  milestones: [
    { id: 'm1', goalId: 'g1', title: 'CV updated', done: true, order: 1 },
    { id: 'm2', goalId: 'g1', title: 'Apply to 5', done: false, order: 2 },
  ],
  journal: [
    { id: 'digest:2026-09-07', kind: 'digest', day: '2026-09-07', summary: 'A good week.', wins: ['CV'], slipped: ['Gym'], focus: 'Apply', source: 'gemini' },
    { id: 'checkin:2026-09-12', kind: 'checkin', day: '2026-09-12', questions: ['How did it go?'], answers: ['Fine'], feedback: 'Nice work.', source: 'gemini' },
  ],
  flags: [{ id: 'f1', text: 'Button too small', updated: '2026-09-12T10:00:00.000Z' }],
  changes: [
    { id: 'c1', at: '2026-09-12T13:02:00.000Z', summary: 'Added task "Email Sarah" for today', edits: [], undoneAt: null, pruned: false, source: 'claude' },
    { id: 'c2', at: '2026-09-11T09:00:00.000Z', summary: 'Archived task "X"', edits: [], undoneAt: '2026-09-11T10:00:00.000Z', pruned: false, source: 'claude' },
  ],
});

test('shortId shortens random ids only; resolveId finds one record by id or prefix', () => {
  assert.equal(shortId('a1b2c3d4-e5f6-4789-9abc-def012345678'), 'a1b2c3d4');
  assert.equal(shortId('checkin:2026-09-13'), 'checkin:2026-09-13');
  const d = fixture({ items: [{ id: 'abcd1234-0000-4000-8000-000000000000', type: 'task', title: 'A', date: TODAY },
    { id: 'abcd9999-0000-4000-8000-000000000000', type: 'task', title: 'B', date: TODAY }] });
  assert.equal(resolveId(d, '#abcd12').rec.title, 'A');
  assert.equal(resolveId(d, 'abcd1234-0000-4000-8000-000000000000').map, 'items');
  assert.throws(() => resolveId(d, 'abc'), /too short/);
  assert.throws(() => resolveId(d, 'abcd'), /abcd matches 2 records/);
  assert.throws(() => resolveId(d, 'ffff'), /Nothing has the id ffff/);
  assert.throws(() => resolveId(d, 'abcd12', ['goals']), /Nothing has the id abcd12/);
});

test('the wording helpers', () => {
  assert.equal(q('Email Sarah'), '"Email Sarah"');
  assert.equal(q('x'.repeat(80)).length, 72);
  assert.equal(dayName(TODAY, TODAY), 'today');
  assert.equal(dayName('2026-09-18', TODAY), 'Fri 18 Sep');
  assert.equal(when('2026-09-12T13:02:00.000Z'), 'Sat 12 Sep, 14:02');
  assert.equal(toDay('today', TODAY), TODAY);
  assert.equal(toDay('Tomorrow', TODAY), '2026-09-14');
  assert.equal(toDay('yesterday', TODAY), '2026-09-12');
  assert.equal(toDay('2026-09-30', TODAY), '2026-09-30');
  assert.throws(() => toDay('2026-02-30', TODAY), /isn't a date/);
  assert.throws(() => toDay('fri', TODAY), /use YYYY-MM-DD, today, tomorrow or yesterday/);
  assert.equal(repeatText({ kind: 'daily' }), 'every day');
  assert.equal(repeatText({ kind: 'weekdays', days: [1, 3] }), 'on Mon, Wed');
  assert.equal(repeatText({ kind: 'perWeek', n: 3 }), '3× a week');
  assert.equal(repeatText({ kind: 'weekly', day: 5 }), 'every Fri');
  assert.equal(repeatText({ kind: 'monthly', date: 1 }), 'monthly on the 1st');
  assert.equal(repeatText({ kind: 'monthly', date: 22 }), 'monthly on the 22nd');
  assert.equal(repeatText({ kind: 'monthly', date: 12 }), 'monthly on the 12th');
  assert.equal(amountText(45, 'minutes'), '45m');
  assert.equal(amountText(90, 'minutes'), '1.5h');
  assert.equal(amountText(5, 'count', 'applications'), '5 applications');
});

test("every read starts with the date and the day's count", () => {
  assert.equal(header(doc(), TODAY), 'Today is Sunday 13 September (2026-09-13) · 1 of 4 done');
  for (const [name, read] of Object.entries(READS)) {
    assert.match(read(doc(), TODAY, name === 'day' || name === 'talk' ? 'today' : 'cv'), /^Today is Sunday 13 September/, name);
  }
});

test('today: suggestions, then to do, then done, each with its id', () => {
  const text = READS.today(doc(), TODAY);
  const lines = text.split('\n');
  const at = (s) => lines.indexOf(s);
  assert.ok(at('Suggested (waiting for ✓/✕ in the app):') > 0);
  assert.ok(at('Suggested (waiting for ✓/✕ in the app):') < at('To do:'));
  assert.ok(at('To do:') < at('Done:'));
  assert.ok(lines.includes('  ? task "Book dentist" #s1 · for Tue · by Claude'), text);
  assert.ok(lines.includes('  [ ] task "Email Sarah" #t1 · by Claude'), text);
  assert.ok(lines.includes('  [ ] task "Update CV" #t2 · from Thu'), text);
  assert.ok(lines.includes('  [ ] habit "Read 20 pages" #h1 · streak 2'), text);
  assert.ok(lines.includes('  [ ] weekly target "Applications" #q1 · 2 / 5 applications this week'), text);
  assert.ok(lines.includes('  [x] habit "Hebrew" #h2'), text);
  assert.doesNotMatch(text, /Old CV idea|Book flights/);
});

test('week, goals and list', () => {
  const week = READS.week(doc(), TODAY);
  assert.match(week, /^This week \(from Mon 7 Sep\):$/m);
  assert.match(week, /^ {2}target "Applications" #q1 · 2 \/ 5 applications$/m);
  const goals = READS.goals(doc(), TODAY);
  assert.match(goals, /^\? suggested goal "NatCen application" #g2 · 0 of 0 milestones \(0%\) · by Claude$/m);
  assert.match(goals, /^goal "Research job" #g1 · 1 of 2 milestones \(50%\) · by Tue 1 Dec$/m);
  assert.match(goals, /^ {2}\[x\] milestone "CV updated" #m1$/m);
  assert.match(goals, /^ {2}\[ \] milestone "Apply to 5" #m2$/m);
  assert.match(goals, /^ {2}· habit "Read 20 pages" #h1$/m);
  const list = READS.list(doc(), TODAY);
  assert.match(list, /^Upcoming tasks:\n {2}task "Book flights" #t3 · Sun 20 Sep · Travel$/m);
  assert.match(list, /^ {2}habit "Hebrew" #h2 · every day$/m);
  assert.match(list, /^ {2}target "Applications" #q1 · 5 applications a week$/m);
});

test('find, day and history', () => {
  const found = READS.find(doc(), TODAY, 'cv');
  assert.match(found, /^ {2}task "Update CV" #t2 · Thu 10 Sep$/m);
  assert.match(found, /^ {2}milestone "CV updated" #m1$/m);
  assert.doesNotMatch(found, /Old CV idea/);
  assert.throws(() => READS.find(doc(), TODAY, ''), /find needs some words/);
  const day = READS.day(doc(), TODAY, '2026-09-08');
  assert.match(day, /^Tuesday 8 September \(2026-09-08\)/m);
  assert.match(day, /^ {2}logged 2 applications on "Applications" #a1$/m);
  const hist = READS.history(doc(), TODAY).split('\n');
  assert.equal(hist.length, 5);
  assert.match(hist[2], /^ {2}w\/c Mon 24 Aug: Mon /);
  assert.match(hist[4], /Sun 1\/4$/);
});

test('journal, flags and changes', () => {
  const journal = READS.journal(doc(), TODAY);
  assert.match(journal, /^Weekly digest, week of Mon 7 Sep:\n {2}A good week\.$/m);
  assert.match(journal, /^ {2}Went well: CV$/m);
  assert.match(journal, /^ {2}Focus: Apply$/m);
  assert.match(journal, /^Check-in, Sat 12 Sep:\n {2}Q: How did it go\?\n {2}A: Fine\n {2}Coach: Nice work\.$/m);
  assert.match(READS.flags(doc(), TODAY), /^ {2}"Button too small" #f1 · Sat 12 Sep, 11:00$/m);
  const changes = READS.changes(doc(), TODAY);
  assert.match(changes, /^ {2}#c1 · Sat 12 Sep, 14:02 · Added task "Email Sarah" for today$/m);
  assert.match(changes, /^ {2}#c2 · .* · Archived task "X" · undone$/m);
  assert.match(READS.changes(doc(), TODAY, '1'), /Claude's last 1 changes/);
});

test("planner: its settings, when it last ran, its notes; week shows what it booked", () => {
  const empty = doc();
  assert.match(READS.planner(empty, TODAY), /^Calendar planner: hasn't run yet\.$/m);
  assert.match(READS.week(empty, TODAY), /^Calendar: the planner hasn't booked anything yet\.$/m);
  const d = doc();
  const block = (title, start, end, state) => ({ key: 'k', title, start, end, state, items: ['t1'] });
  d.calendar = {
    status: { id: 'status', status: 'active', lastRun: '2026-09-13T13:02:00.000Z', lastError: null, version: 'b1', paused: false },
    'day:7': { id: 'day:7', status: 'active', day: TODAY, skipped: [], missed: [], notes: ['Moved Gym to 09:30 (Learn Hebrew)'],
      blocks: [block('Job search ×2', '2026-09-13T12:15:00.000Z', '2026-09-13T13:15:00.000Z', 'exact')] },
    'day:2': { id: 'day:2', status: 'active', day: '2026-09-15', skipped: [], missed: [], notes: [],
      blocks: [block('~ Read the pack', '2026-09-15T08:00:00.000Z', '2026-09-15T08:30:00.000Z', 'rough')] },
  };
  const planner = READS.planner(d, TODAY);
  assert.match(planner, /^Calendar planner: last ran Sun 13 Sep, \d\d:\d\d · build b1$/m);
  assert.match(planner, /^Settings: hours 09:00–19:00 · gapMinutes 15 · defaultMinutes 30 · maxBlockMinutes 150 · days 7 · exactDays 2 · firmUpHour 20$/m);
  assert.match(planner, /^ {2}areaCalendars: Job search → Application, Assessment centre → Application, Health → Gym, Challenger → Challenger · defaultCalendar: main$/m);
  assert.match(planner, /^Its notes today:\n {2}Moved Gym to 09:30 \(Learn Hebrew\)$/m);
  const week = READS.week(d, TODAY);
  const span = (s, e) => `${clockLabel(s)}–${clockLabel(e)}`;
  assert.ok(week.includes('Calendar, as the planner booked it (~ = rough):'), week);
  assert.ok(week.includes(`  today: ${span('2026-09-13T12:15:00.000Z', '2026-09-13T13:15:00.000Z')} Job search ×2`), week);
  assert.ok(week.includes(`  Tue 15 Sep: ~${span('2026-09-15T08:00:00.000Z', '2026-09-15T08:30:00.000Z')} Read the pack`), week);
});

test("directing in the reads: the brief, time off, ★ and notes on today; attention; the planner's new settings", () => {
  const d = doc();
  d.items.t1 = { ...d.items.t1, priority: true, notes: 'Say hi from George' };
  d.journal[`brief:${TODAY}`] = { id: `brief:${TODAY}`, kind: 'brief', day: TODAY, text: 'Applications first.', status: 'active', source: 'claude' };
  d.calendar = {
    'off:2026-09-13': { id: 'off:2026-09-13', status: 'active', source: 'claude', start: TODAY, end: '2026-09-14', areas: ['Travel'], reason: 'Away' },
    config: { id: 'config', status: 'active', priorityAreas: ['Travel'], areaColors: { Travel: 'Grape' } },
  };
  const today = READS.today(d, TODAY);
  assert.match(today, /^Claude's brief: Applications first\.$/m);
  assert.match(today, /^Time off — Away · Travel$/m);
  assert.ok(today.includes('  [ ] ★ task "Email Sarah" #t1 · by Claude\n      note: Say hi from George'), today);
  const week = READS.week(d, TODAY);
  assert.match(week, /^Time off coming:\n {2}Sun 13 Sep – Mon 14 Sep — Away · Travel #off:2026-09-13$/m);
  const list = READS.list(d, TODAY);
  assert.match(list, /^ {2}task "Book flights" #t3 · Sun 20 Sep · Travel · ★$/m);
  const planner = READS.planner(d, TODAY);
  assert.match(planner, /^ {2}priorityAreas: Travel · areaColors: Travel → Grape$/m);
  assert.match(planner, /^ {2}Colours George's calendars take \(not for areas\): not known until the planner runs$/m);
  const attn = READS.attention(d, TODAY);
  assert.match(attn, /^Needs attention:$/m);
  assert.match(attn, /^ {2}"Update CV" has carried over since Thu 10 Sep$/m);
});
