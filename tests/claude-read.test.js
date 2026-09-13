process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, done, amount } from './helpers.js';
import { shortId, resolveId } from '../claude/ids.js';
import { q, dayName, when, toDay, repeatText, amountText } from '../claude/text.js';
import { header, READS } from '../claude/read.js';

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
    assert.match(read(doc(), TODAY, name === 'day' ? 'today' : 'cv'), /^Today is Sunday 13 September/, name);
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
