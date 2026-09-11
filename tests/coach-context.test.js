import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coachContext, weekStats, checkinOf, digestOf, digestDue, checkinState, proposedItems, clip, CONTEXT_CAP,
} from '../js/coach.js';
import { fixture, done, amount } from './helpers.js';

const TODAY = '2026-09-11'; // a Friday

const checkin = (day, fields = {}) => ({
  id: `checkin:${day}`, kind: 'checkin', day, questions: ['Q'], answers: [], feedback: '', tomorrowIds: [],
  source: 'gemini', ...fields,
});

// George's Friday: a 6-day Hebrew streak, a task carried from Wednesday, two weekly targets, a goal.
function friday() {
  return fixture({
    items: [
      { id: 'heb', type: 'habit', title: 'Hebrew practice', area: 'Hebrew', repeat: { kind: 'daily' }, order: 1 },
      { id: 'sarah', type: 'task', title: 'Email Sarah', area: 'Job', date: '2026-09-09', order: 2 },
      { id: 'js', type: 'quota', title: 'Job search', target: 360, unit: 'minutes', unitLabel: '', order: 3 },
      { id: 'apps', type: 'quota', title: 'Applications', target: 5, unit: 'count', unitLabel: '', order: 4 },
      { id: 'idea', type: 'task', title: 'Only a suggestion', date: TODAY, status: 'suggested', source: 'gemini', order: 5 },
    ],
    logs: [
      ...['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'].map((d) => done('heb', d)),
      amount('js1', 'js', '2026-09-08', 90), amount('js2', 'js', '2026-09-10', 120),
      amount('ap1', 'apps', '2026-09-07', 1), amount('ap2', 'apps', '2026-09-09', 2),
    ],
    goals: [{ id: 'role', title: 'Land an analyst role', targetDate: '2026-11-10', target: null, unit: 'count', unitLabel: '', order: 1 }],
    milestones: [
      { id: 'm1', goalId: 'role', title: 'CV finished', done: true, order: 1 },
      { id: 'm2', goalId: 'role', title: 'Five applications sent', done: false, order: 2 },
      { id: 'm3', goalId: 'role', title: 'First interview', done: false, order: 3 },
    ],
    journal: [
      checkin('2026-09-10', { answers: ['Sent two applications', '', 'Start earlier'], feedback: 'Good.' }),
      checkin('2026-09-07', { answers: ['Four days ago, so left out'] }),
      checkin(TODAY, { answers: ["Today's own answers go in the feedback prompt"] }),
    ],
  });
}

// ---- the context block -------------------------------------------------------------------------

test('the context names the real items, numbers and recent answers', () => {
  assert.equal(coachContext(friday(), TODAY), [
    'Today: Friday 11 September 2026',
    "Today's list:",
    '✓ Hebrew practice [Hebrew] — 6-day streak',
    '✗ Email Sarah [Job] — carried from Wed',
    "This week's targets:",
    'Job search: 3.5h of 6h',
    'Applications: 3 of 5',
    'Last 7 days: Fri 1/2 · Thu 1/2 · Wed 1/2 · Tue 1/1 · Mon 1/1 · Sun 1/1 · Sat 0/1',
    'Goals:',
    'Land an analyst role — 33%, target 10 Nov; next: Five applications sent, First interview',
    'Recent check-ins (his answers):',
    'Thu: Sent two applications / Start earlier',
  ].join('\n'));
});

test('the context of an empty document says so plainly', () => {
  assert.equal(coachContext(fixture(), TODAY), [
    'Today: Friday 11 September 2026',
    "Today's list: nothing scheduled",
    "This week's targets: none",
    'Last 7 days: Fri 0/0 · Thu 0/0 · Wed 0/0 · Tue 0/0 · Mon 0/0 · Sun 0/0 · Sat 0/0',
    'Goals: none',
  ].join('\n'));
});

test('the context stays under its size cap however much there is', () => {
  const long = 'x'.repeat(500);
  const items = Array.from({ length: 300 }, (_, i) => ({
    id: `h${i}`, type: 'habit', title: `${long}${i}`, area: long, repeat: { kind: 'daily' }, order: i,
  }));
  const goals = Array.from({ length: 50 }, (_, i) => ({ id: `g${i}`, title: long, order: i }));
  const journal = [checkin('2026-09-10', { answers: [long, long, long] })];
  const text = coachContext(fixture({ items, goals, journal }), TODAY);
  assert.ok(text.length <= CONTEXT_CAP, `${text.length} characters`);
  assert.ok(text.startsWith('Today: Friday 11 September 2026\n'));
  assert.match(text, /…and 275 more/);
});

test('clip collapses whitespace and marks a cut', () => {
  assert.equal(clip('  two\n  lines ', 80), 'two lines');
  assert.equal(clip('abcdefghij', 5), 'abcd…');
  assert.equal(clip(undefined, 5), '');
});

// ---- a week's numbers --------------------------------------------------------------------------

// The week of Monday 31 August 2026.
function lastWeek() {
  const since = { created: '2026-08-25' };
  return fixture({
    items: [
      { id: 'heb', type: 'habit', title: 'Hebrew', repeat: { kind: 'daily' }, order: 1, ...since },
      { id: 'gym', type: 'habit', title: 'Gym', repeat: { kind: 'weekdays', days: [1, 3, 5] }, order: 2, ...since },
      { id: 'run', type: 'habit', title: 'Run', repeat: { kind: 'perWeek', n: 2 }, order: 3, ...since },
      { id: 'cv', type: 'task', title: 'CV', date: '2026-08-30', order: 4, ...since },
      { id: 'call', type: 'task', title: 'Call', date: '2026-09-04', order: 5, ...since },
      { id: 'later', type: 'task', title: 'Later', date: '2026-09-07', order: 6, ...since },
      { id: 'apps', type: 'quota', title: 'Apps', target: 5, unit: 'count', unitLabel: 'applications', order: 7, ...since },
    ],
    logs: [
      done('heb', '2026-08-31'), done('heb', '2026-09-01'), done('heb', '2026-09-03'),
      done('gym', '2026-09-02'), done('run', '2026-09-01'), done('cv', '2026-09-02'),
      amount('a1', 'apps', '2026-09-01', 2), amount('a2', 'apps', '2026-09-06', 1), amount('a3', 'apps', '2026-09-07', 4),
    ],
    goals: [{ id: 'job', title: 'Job', target: null, unit: 'count', unitLabel: '', order: 1, ...since }],
    milestones: [
      { id: 'm1', goalId: 'job', title: 'A', done: true, order: 1 },
      { id: 'm2', goalId: 'job', title: 'B', done: false, order: 2 },
    ],
  });
}

test('weekStats counts habits, tasks, targets, goals and days for one Monday–Sunday week', () => {
  assert.deepEqual(weekStats(lastWeek(), '2026-08-31'), {
    monday: '2026-08-31',
    sunday: '2026-09-06',
    days: [
      { day: '2026-08-31', done: 1, total: 4 },
      { day: '2026-09-01', done: 2, total: 3 },
      { day: '2026-09-02', done: 2, total: 4 },
      { day: '2026-09-03', done: 1, total: 2 },
      { day: '2026-09-04', done: 0, total: 4 },
      { day: '2026-09-05', done: 0, total: 3 },
      { day: '2026-09-06', done: 0, total: 3 },
    ],
    habits: [
      { id: 'heb', title: 'Hebrew', done: 3, scheduled: 7 },
      { id: 'gym', title: 'Gym', done: 1, scheduled: 3 },
      { id: 'run', title: 'Run', done: 1, scheduled: 2 },
    ],
    tasks: { done: 1, total: 2 },
    targets: [{ id: 'apps', title: 'Apps', total: 3, target: 5, unit: 'count', unitLabel: 'applications' }],
    goals: [{ id: 'job', title: 'Job', pct: 50, done: 1, total: 2, numeric: false, unit: 'count', week: 0 }],
    amounts: 2,
    empty: false,
  });
});

test('weekStats takes any day of the week, and knows an empty week', () => {
  const doc = lastWeek();
  assert.deepEqual(weekStats(doc, '2026-09-03'), weekStats(doc, '2026-08-31'));
  assert.equal(weekStats(doc, '2026-08-17').empty, true);
  const onlyAnAmount = fixture({ logs: [amount('x', 'apps', '2026-08-18', 1)] });
  assert.equal(weekStats(onlyAnAmount, '2026-08-17').empty, false);
});

// ---- readers -----------------------------------------------------------------------------------

test('checkinOf and digestOf find the one record for a day or week', () => {
  const doc = fixture({
    journal: [
      checkin('2026-09-10', { feedback: 'Good.' }),
      { id: 'digest:2026-08-31', kind: 'digest', day: '2026-08-31', summary: 'S', wins: [], slipped: [], focus: 'F' },
    ],
  });
  assert.equal(checkinOf(doc, '2026-09-10').feedback, 'Good.');
  assert.equal(checkinOf(doc, '2026-09-11'), null);
  assert.equal(digestOf(doc, '2026-08-31').summary, 'S');
  assert.equal(digestOf(doc, '2026-09-02').summary, 'S'); // any day of that week
  assert.equal(digestOf(doc, '2026-09-07'), null);
});

test("digestDue: last week's Monday until its digest exists, and never for an empty week", () => {
  const doc = lastWeek();
  assert.equal(digestDue(doc, '2026-09-08'), '2026-08-31');
  assert.equal(digestDue(doc, '2026-09-13'), '2026-08-31'); // still last week's on the Sunday
  doc.journal['digest:2026-08-31'] = {
    id: 'digest:2026-08-31', kind: 'digest', day: '2026-08-31', summary: 'S', wins: [], slipped: [], focus: 'F',
    source: 'gemini', status: 'active', created: '2026-09-07', archivedOn: null, updated: '2026-09-07T09:00:00.000Z',
  };
  assert.equal(digestDue(doc, '2026-09-08'), null);
  assert.equal(digestDue(doc, '2026-08-26'), null); // the week of 17 Aug had nothing in it
});

test('checkinState: early, due, questions, done, and no key', () => {
  const base = { today: TODAY, dayStartHour: 4, checkinHour: 18, hasKey: true };
  const at = (hour) => new Date(2026, 8, 11, hour, 0);
  const none = fixture();
  assert.equal(checkinState({ ...base, doc: none, now: at(17) }), 'early');
  assert.equal(checkinState({ ...base, doc: none, now: at(18) }), 'due');
  assert.equal(checkinState({ ...base, doc: none, now: at(12), checkinHour: 12 }), 'due');
  assert.equal(checkinState({ ...base, doc: none, now: new Date(2026, 8, 12, 1, 0) }), 'due'); // 1am is still Friday evening
  assert.equal(checkinState({ ...base, doc: none, now: at(20), hasKey: false }), 'nokey');
  const asked = fixture({ journal: [checkin(TODAY, { questions: ['How did it go?'] })] });
  assert.equal(checkinState({ ...base, doc: asked, now: at(10) }), 'questions');
  const answered = fixture({ journal: [checkin(TODAY, { answers: ['Well'], feedback: 'Good.' })] });
  assert.equal(checkinState({ ...base, doc: answered, now: at(20), hasKey: false }), 'done');
  const yesterday = fixture({ journal: [checkin('2026-09-10', { feedback: 'Old.' })] });
  assert.equal(checkinState({ ...base, doc: yesterday, now: at(20) }), 'due');
});

test('proposedItems lists the still-suggested items linked to a goal, in order', () => {
  const doc = fixture({
    items: [
      { id: 'b', type: 'quota', title: 'B', target: 1, goalId: 'g', status: 'suggested', order: 2 },
      { id: 'a', type: 'habit', title: 'A', goalId: 'g', status: 'suggested', order: 1 },
      { id: 'taken', type: 'habit', title: 'Taken', goalId: 'g', order: 3 },
      { id: 'other', type: 'habit', title: 'Other', goalId: 'h', status: 'suggested', order: 4 },
    ],
  });
  assert.deepEqual(proposedItems(doc, 'g').map((i) => i.id), ['a', 'b']);
});
