import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore } from './helpers.js';
import { OPS, UNLOGGED, runOp, fieldWarnings } from '../claude/ops.js';
import { diffDocs } from '../js/changes.js';

// ids rec-1, rec-2, …; the helpers' clock makes today Thursday 10 Sep 2026.
const fresh = () => makeStore({ prefix: 'rec-' });
const pick = (r) => ({ type: r.type, title: r.title, date: r.date, status: r.status, source: r.source });

test("runOp refuses what isn't an op", () => {
  const s = fresh();
  assert.throws(() => runOp(s, null), /Each op is an object/);
  assert.throws(() => runOp(s, { op: 'fly' }),
    /Unknown op "fly" — ops: task, habit, target, goal, milestone, plan, done, undone, log, edit, archive, accept, dismiss, flag, handoff, undo, planner, off, brief/);
  assert.throws(() => runOp(s, { op: 'toString' }), /Unknown op "toString"/);
  assert.deepEqual(Object.keys(OPS), ['task', 'habit', 'target', 'goal', 'milestone', 'plan', 'done', 'undone', 'log', 'edit', 'archive', 'accept', 'dismiss', 'flag', 'handoff', 'undo', 'planner', 'off', 'brief', 'gym', 'guide', 'details', 'rule', 'report', 'review', 'picture', 'say', 'propose', 'handled', 'mind']);
  assert.deepEqual([...UNLOGGED], ['undo', 'handoff', 'handled']);
});

test('task: active and from Claude by default, a suggestion when asked, checked before anything is written', () => {
  const s = fresh();
  assert.equal(runOp(s, { op: 'task', title: ' Email Sarah ' }), 'Added task "Email Sarah" for today · #rec-1');
  assert.deepEqual(pick(s.doc().items['rec-1']), { type: 'task', title: 'Email Sarah', date: '2026-09-10', status: 'active', source: 'claude' });
  assert.equal(runOp(s, { op: 'task', title: 'Dentist', date: 'tomorrow', suggest: true }), 'Suggested task "Dentist" for Fri 11 Sep · #rec-2');
  assert.equal(s.doc().items['rec-2'].status, 'suggested');
  const before = JSON.stringify(s.doc());
  assert.throws(() => runOp(s, { op: 'task', title: '  ' }), /A task needs a title/);
  assert.throws(() => runOp(s, { op: 'task', title: 'x', date: 'friday' }), /isn't a date/);
  assert.throws(() => runOp(s, { op: 'task', title: 'x', goal: 'nope' }), /Nothing has the id nope/);
  assert.equal(JSON.stringify(s.doc()), before);
});

test('habit and target', () => {
  const s = fresh();
  assert.equal(runOp(s, { op: 'habit', title: 'Gym', repeat: { kind: 'weekdays', days: [5, 1, 3] } }), 'Added habit "Gym" (on Mon, Wed, Fri) · #rec-1');
  assert.deepEqual(s.doc().items['rec-1'].repeat, { kind: 'weekdays', days: [1, 3, 5] });
  assert.equal(runOp(s, { op: 'habit', title: 'Read' }), 'Added habit "Read" (every day) · #rec-2');
  assert.throws(() => runOp(s, { op: 'habit', title: 'x', repeat: { kind: 'perWeek', n: 9 } }), /perWeek needs n/);
  assert.throws(() => runOp(s, { op: 'habit', title: 'x', repeat: { kind: 'hourly' } }), /Unknown repeat kind "hourly"/);
  assert.equal(runOp(s, { op: 'target', title: 'Hebrew', target: '5h', unit: 'minutes' }), 'Added weekly target "Hebrew" (5h a week) · #rec-3');
  assert.equal(s.doc().items['rec-3'].target, 300);
  assert.equal(runOp(s, { op: 'target', title: 'Applications', target: 5, unitLabel: 'applications' }),
    'Added weekly target "Applications" (5 applications a week) · #rec-4');
  assert.throws(() => runOp(s, { op: 'target', title: 'x', target: 0 }), /target needs a number above 0/);
  assert.throws(() => runOp(s, { op: 'target', title: 'x', target: '5h', unit: 'hours' }), /unit is "count" or "minutes"/);
});

test('goal, milestone and plan', () => {
  const s = fresh();
  assert.equal(runOp(s, { op: 'goal', title: 'Research job', targetDate: '2026-12-01', milestones: ['CV', 'Apply'] }),
    'Added goal "Research job" with 2 milestones · #rec-1');
  assert.equal(s.doc().goals['rec-1'].source, 'claude');
  assert.deepEqual(Object.values(s.doc().milestones).map((m) => [m.title, m.goalId, m.source, m.status]),
    [['CV', 'rec-1', 'claude', 'active'], ['Apply', 'rec-1', 'claude', 'active']]);
  assert.equal(runOp(s, { op: 'milestone', goal: 'rec-1', title: 'Interview' }), 'Added milestone "Interview" on "Research job" · #rec-4');
  assert.throws(() => runOp(s, { op: 'milestone', title: 'x' }), /A milestone needs goal/);
  assert.throws(() => runOp(s, { op: 'goal', title: 'x', milestones: 'CV' }), /milestones should be a list/);
  const plan = runOp(s, {
    op: 'plan', goal: { title: 'NatCen application', targetDate: '2026-10-01' },
    milestones: ['Research', 'Draft', 'Submit'], tasks: [{ title: 'Read the job pack', date: 'tomorrow' }],
  });
  assert.match(plan, /^Suggested plan: goal "NatCen application", 3 milestones, 1 task · #rec-\d+$/);
  const planGoal = Object.values(s.doc().goals).find((g) => g.title === 'NatCen application');
  assert.equal(planGoal.status, 'suggested');
  assert.equal(planGoal.source, 'claude');
  assert.equal(Object.values(s.doc().items).find((i) => i.title === 'Read the job pack').date, '2026-09-11');
  assert.throws(() => runOp(s, { op: 'plan' }), /A plan needs a goal or at least one habit, target or task/);
  assert.match(runOp(s, { op: 'goal', title: 'Maybe', suggest: true, milestones: ['one'] }), /^Suggested goal "Maybe" with 1 milestone · #/);
});

test('done and undone tick tasks, habits and milestones, and say when there was nothing to do', () => {
  const s = fresh();
  const t = s.addItem({ type: 'task', title: 'CV' });
  assert.equal(runOp(s, { op: 'done', id: t.id }), 'Ticked "CV" for today');
  assert.equal(Object.values(s.doc().logs)[0].source, 'claude');
  assert.equal(runOp(s, { op: 'done', id: t.id }), '"CV" was already ticked for today');
  assert.equal(runOp(s, { op: 'undone', id: t.id }), 'Unticked "CV" for today');
  assert.equal(runOp(s, { op: 'undone', id: t.id }), '"CV" was already unticked for today');
  const h = s.addItem({ type: 'habit', title: 'Read' });
  assert.equal(runOp(s, { op: 'done', id: h.id, day: 'yesterday' }), 'Ticked "Read" for Wed 9 Sep');
  const quota = s.addItem({ type: 'quota', title: 'Apps', target: 3 });
  assert.throws(() => runOp(s, { op: 'done', id: quota.id }), /is a weekly target — use log/);
  const g = s.addGoal({ title: 'G' });
  const m = s.addMilestone(g.id, 'M');
  assert.equal(runOp(s, { op: 'done', id: m.id }), 'Ticked milestone "M"');
  assert.equal(s.doc().milestones[m.id].done, true);
  assert.equal(runOp(s, { op: 'done', id: m.id }), 'milestone "M" was already ticked');
});

test('log adds an amount to a weekly target, or to a goal measured by a number', () => {
  const s = fresh();
  const heb = s.addItem({ type: 'quota', title: 'Hebrew', target: 300, unit: 'minutes' });
  assert.equal(runOp(s, { op: 'log', id: heb.id, amount: '45m' }), 'Logged 45m on "Hebrew" for today');
  const log = Object.values(s.doc().logs)[0];
  assert.deepEqual([log.amount, log.source, log.itemId], [45, 'claude', heb.id]);
  assert.equal(runOp(s, { op: 'log', id: heb.id, amount: '1h30', day: 'yesterday', note: 'podcast' }), 'Logged 1.5h on "Hebrew" for Wed 9 Sep');
  const apps = s.addItem({ type: 'quota', title: 'Apps', target: 5, unitLabel: 'applications' });
  assert.equal(runOp(s, { op: 'log', id: apps.id, amount: 2 }), 'Logged 2 applications on "Apps" for today');
  const saved = s.addGoal({ title: 'Savings', target: 1000, unitLabel: '£' });
  assert.equal(runOp(s, { op: 'log', id: saved.id, amount: 50 }), 'Logged 50 £ on "Savings" for today');
  const habit = s.addItem({ type: 'habit', title: 'Read' });
  assert.throws(() => runOp(s, { op: 'log', id: habit.id, amount: 1 }), /is a habit — use done/);
  assert.throws(() => runOp(s, { op: 'log', id: heb.id, amount: 'lots' }), /amount needs a time/);
  const plain = s.addGoal({ title: 'Plain' });
  assert.throws(() => runOp(s, { op: 'log', id: plain.id, amount: 1 }), /measured by milestones/);
});

test('edit changes the fields it knows, refuses the rest, and says what it changed', () => {
  const s = fresh();
  const t = s.addItem({ type: 'task', title: 'CV' });
  const g = s.addGoal({ title: 'Job' });
  assert.equal(runOp(s, { op: 'edit', id: t.id, set: { title: 'Update CV', date: '2026-09-18', goalId: g.id } }),
    'Edited task "CV": title → "Update CV", date → Fri 18 Sep, goalId → goal "Job"');
  assert.equal(s.doc().items[t.id].title, 'Update CV');
  assert.throws(() => runOp(s, { op: 'edit', id: t.id, set: { repeat: { kind: 'daily' } } }), /Only a habit repeats/);
  assert.throws(() => runOp(s, { op: 'edit', id: t.id, set: { status: 'archived' } }),
    /Can't edit status on a task — editable: title, date, area, goalId, repeat, target, unitLabel, order, minutes, time, notes, priority/);
  assert.throws(() => runOp(s, { op: 'edit', id: t.id, set: {} }), /edit needs set/);
  const m = s.addMilestone(g.id, 'M');
  assert.equal(runOp(s, { op: 'edit', id: m.id, set: { done: true } }), 'Edited milestone "M": done → true');
  assert.equal(runOp(s, { op: 'edit', id: g.id, set: { targetDate: null, why: 'Money' } }), 'Edited goal "Job": targetDate → none, why → "Money"');
});

test('archive, accept and dismiss', () => {
  const s = fresh();
  const t = s.addItem({ type: 'task', title: 'Old' });
  assert.equal(runOp(s, { op: 'archive', id: t.id }), 'Archived task "Old"');
  assert.equal(s.doc().items[t.id].status, 'archived');
  assert.equal(runOp(s, { op: 'archive', id: t.id }), 'task "Old" was already archived');
  const f = s.addFlag('Too small');
  assert.equal(runOp(s, { op: 'archive', id: f.id }), 'Marked flag "Too small" addressed');
  const quota = s.addItem({ type: 'quota', title: 'Apps', target: 3, unitLabel: 'applications' });
  const l = s.logAmount({ itemId: quota.id, amount: 2 });
  assert.equal(runOp(s, { op: 'archive', id: l.id }), 'Removed the log of 2 applications on "Apps" for today');
  const plan = s.addPlan({ goal: { title: 'G' }, milestones: ['M'], tasks: [{ title: 'T' }], source: 'claude' });
  assert.equal(runOp(s, { op: 'accept', id: plan.items[0].id }), 'Accepted suggested task "T"');
  assert.equal(runOp(s, { op: 'accept', id: plan.goal.id }), 'Accepted suggested goal "G" and its milestones');
  assert.equal(s.doc().milestones[plan.milestones[0].id].status, 'active');
  assert.throws(() => runOp(s, { op: 'accept', id: t.id }), /isn't a suggestion \(it's archived\)/);
  const p2 = s.addPlan({ tasks: [{ title: 'U' }], source: 'claude' });
  assert.equal(runOp(s, { op: 'dismiss', id: p2.items[0].id }), 'Dismissed suggested task "U"');
  assert.equal(s.doc().items[p2.items[0].id].status, 'dismissed');
});

test('flag and undo', () => {
  const s = fresh();
  assert.equal(runOp(s, { op: 'flag', text: 'The week bars overlap' }), 'Flagged "The week bars overlap" as Note · #rec-1');
  assert.equal(s.doc().flags['rec-1'].kind, 'note');
  assert.match(runOp(s, { op: 'flag', text: 'Add a dark calendar', kind: 'feature' }), /^Flagged "Add a dark calendar" as Feature/);
  assert.throws(() => runOp(s, { op: 'flag', text: 'x', kind: 'wish' }), /kind is one of: feature, bug, claude, note/);
  assert.equal(s.doc().flags['rec-1'].source, 'claude');
  const before = structuredClone(s.doc());
  runOp(s, { op: 'task', title: 'A' });
  const c = s.addChange({ summary: 'Added task "A" for today', edits: diffDocs(before, s.doc()) });
  assert.equal(runOp(s, { op: 'undo', change: c.id }), 'Undone. (Added task "A" for today)');
  assert.equal(runOp(s, { op: 'undo', change: c.id }), 'Already undone, or too old to undo. (Added task "A" for today)');
  assert.throws(() => runOp(s, { op: 'undo', change: 'rec-1' }), /Nothing has the id rec-1/);
});

test('lengths, times, and the planner settings', () => {
  const s = fresh();
  assert.equal(runOp(s, { op: 'task', title: 'Draft cover letter', minutes: '2h', time: '09:30', date: 'tomorrow' }),
    'Added task "Draft cover letter" for Fri 11 Sep (2h, at 09:30) · #rec-1');
  assert.equal(s.doc().items['rec-1'].minutes, 120);
  assert.equal(runOp(s, { op: 'habit', title: 'Read', minutes: 20 }), 'Added habit "Read" (every day, 20m) · #rec-2');
  assert.throws(() => runOp(s, { op: 'task', title: 'x', minutes: 'ages' }), /minutes needs a length from 5m to 12h/);
  assert.throws(() => runOp(s, { op: 'task', title: 'x', time: '2pm' }), /time needs a time of day like "14:00"/);
  assert.equal(runOp(s, { op: 'habit', title: 'x', time: '09:00' }), 'Added habit "x" (every day, at 09:00) · #rec-3');
  assert.equal(runOp(s, { op: 'edit', id: 'rec-1', set: { minutes: '90m', time: null } }), 'Edited task "Draft cover letter": minutes → 1.5h, time → none');
  assert.match(runOp(s, { op: 'edit', id: 'rec-2', set: { time: '10:00' } }), /time → 10:00/);
  assert.equal(runOp(s, { op: 'planner', hours: ['08:30', '18:00'], gapMinutes: 10 }), "Changed the planner's settings: hours → 08:30–18:00, gapMinutes → 10");
  const config = s.doc().calendar.config;
  assert.deepEqual([config.hours, config.gapMinutes, config.days, config.source], [['08:30', '18:00'], 10, 7, 'claude']);
  assert.throws(() => runOp(s, { op: 'planner' }), /planner needs a setting to change/);
  assert.throws(() => runOp(s, { op: 'planner', colour: 'red' }), /no setting "colour"/);
});

test('a task can be pinned to its slot and let go again from here', () => {
  const s = fresh();
  runOp(s, { op: 'task', title: 'Draft the Motivational Fit answer', area: 'Assessment centre', time: '09:00' });
  runOp(s, { op: 'edit', id: 'rec-1', set: { pinned: true } });
  assert.equal(s.doc().items['rec-1'].pinned, true);
  // Letting it go hands the slot back to the planner.
  runOp(s, { op: 'edit', id: 'rec-1', set: { pinned: false } });
  assert.equal(s.doc().items['rec-1'].pinned, false);
  assert.throws(() => runOp(s, { op: 'edit', id: 'rec-1', set: { pinned: 'yes' } }), /pinned is true or false/);
});

test('directing: notes and priority, time off, the brief, one-key planner settings and colour clashes', () => {
  const s = fresh();
  assert.equal(runOp(s, { op: 'task', title: 'Email York Careers', area: 'Job search', notes: ' Say the date is 5 Oct ', priority: true }),
    'Added task "Email York Careers" for today ★ · #rec-1');
  assert.deepEqual([s.doc().items['rec-1'].notes, s.doc().items['rec-1'].priority], ['Say the date is 5 Oct', true]);
  assert.throws(() => runOp(s, { op: 'task', title: 'x', priority: 'yes' }), /priority is true or false/);
  assert.equal(runOp(s, { op: 'edit', id: 'rec-1', set: { notes: 'Ask for the earliest slot', priority: false } }),
    'Edited task "Email York Careers": notes → "Ask for the earliest slot", priority → false');
  runOp(s, { op: 'target', title: 'AC prep', target: '5h', unit: 'minutes', area: 'Assessment centre' });

  assert.equal(runOp(s, { op: 'off', start: '2026-09-16', end: '2026-09-17', areas: ['job search'], reason: 'Maya leaves for Austria' }),
    'Time off: Wed 16 Sep – Thu 17 Sep — Maya leaves for Austria · job search · #off:2026-09-16');
  assert.equal(runOp(s, { op: 'off', start: 'tomorrow', reason: 'Sick' }), 'Time off: Fri 11 Sep — Sick · everything · #off:2026-09-11');
  assert.equal(runOp(s, { op: 'off', start: '2026-09-18T13:00', end: '2026-09-18T19:00', reason: 'Dentist' }),
    'Time off: Fri 18 Sep, 13:00–19:00 — Dentist · everything · #off:2026-09-18');
  assert.throws(() => runOp(s, { op: 'off', start: '2026-09-20', areas: ['Work'] }), /No item has the area "Work" — areas: Job search, Assessment centre/);
  assert.equal(runOp(s, { op: 'off', cancel: 'off:2026-09-16' }), 'Cancelled time off: Wed 16 Sep – Thu 17 Sep — Maya leaves for Austria · job search');
  assert.equal(s.doc().calendar['off:2026-09-16'].status, 'archived');
  assert.match(runOp(s, { op: 'off', cancel: 'off:2026-09-16' }), /was already cancelled/);

  assert.equal(runOp(s, { op: 'brief', text: 'AC prep first; the rest after lunch.' }), 'Brief for today: "AC prep first; the rest after lunch."');
  assert.deepEqual([s.doc().journal['brief:2026-09-10'].text, s.doc().journal['brief:2026-09-10'].source], ['AC prep first; the rest after lunch.', 'claude']);
  assert.throws(() => runOp(s, { op: 'brief', text: ' ' }), /A brief needs text/);

  assert.equal(runOp(s, { op: 'planner', areaCalendars: { 'Assessment centre': 'Tasks' } }),
    'Changed the planner\'s settings: areaCalendars → {"Assessment centre":"Tasks"}');
  assert.deepEqual(s.doc().calendar.config.areaCalendars, { 'Job search': 'Application', Health: 'Gym', Challenger: 'Challenger', 'Assessment centre': 'Tasks' });
  s.putCalendar('status', { lastRun: '2026-09-10T08:00:00.000Z', takenColors: ['Basil', 'Lavender', 'Tomato'] });
  assert.throws(() => runOp(s, { op: 'planner', areaColors: { 'Job search': 'Tomato' } }),
    /Tomato is already used by one of George's calendars — taken: Basil, Lavender, Tomato; free: Sage, Grape, Flamingo, Banana, Tangerine, Peacock, Graphite, Blueberry/);
  assert.equal(runOp(s, { op: 'planner', areaColors: { 'Assessment centre': 'grape' }, priorityAreas: ['Assessment centre'] }),
    'Changed the planner\'s settings: areaColors → {"Assessment centre":"grape"}, priorityAreas → Assessment centre');
  assert.deepEqual(s.doc().calendar.config.areaColors, { 'Assessment centre': 'Grape' });
});

test('a flag over the cap is refused with the limit named, and nothing is written', () => {
  const s = fresh();
  assert.throws(() => runOp(s, { op: 'flag', text: 'x'.repeat(1001) }), /at most 1000 characters/);
  assert.throws(() => runOp(s, { op: 'flag', text: 'x'.repeat(1001) }), /use handoff instead/);
  assert.equal(Object.keys(s.doc().flags).length, 0, 'refused, not written and cut');
  assert.match(runOp(s, { op: 'flag', text: 'x'.repeat(1000) }), /^Flagged "x+…" as Note · #rec-1$/);
  assert.equal(s.doc().flags['rec-1'].text.length, 1000, 'right on the cap is kept whole');
});

test('fieldWarnings: a field the op really reads is silent', () => {
  assert.deepEqual(fieldWarnings({ op: 'task', title: 'x', minutes: '2h', area: 'Job', suggest: true }), []);
  assert.deepEqual(fieldWarnings({ op: 'off', start: 'today', areas: ['Job'], reason: 'x' }), []);
  assert.deepEqual(fieldWarnings({ op: 'handoff', title: 'x', text: 'y' }), []);
});

test('fieldWarnings: an unknown field says so and names what the op does take', () => {
  const [note] = fieldWarnings({ op: 'task', title: 'x', length: '2h' });
  assert.match(note, /"length" isn't a field on task/);
  assert.match(note, /ignored/);
  assert.match(note, /title, date, area, goal, minutes, time, notes, priority, series, suggest/);
});

test("fieldWarnings: a plan retains its task's detailed controls", () => {
  const notes = fieldWarnings({ op: 'plan', tasks: [{ title: 'x', date: 'today', minutes: '2h', area: 'Job' }] });
  assert.deepEqual(notes, []);
});

test("fieldWarnings: a plan's goal, habits and targets are checked against what they read", () => {
  assert.deepEqual(fieldWarnings({ op: 'plan', goal: { title: 'g', targetDate: 'x', why: 'y' } }), []);
  assert.deepEqual(fieldWarnings({ op: 'plan', habits: [{ title: 'h', repeat: {}, minutes: '20m' }] }), []);
  assert.deepEqual(fieldWarnings({ op: 'plan', targets: [{ title: 't', target: 5, area: 'Job' }] }), []);
  const [note] = fieldWarnings({ op: 'plan', tasks: [{ title: 't', magic: true }] });
  assert.match(note, /"magic" isn't a field/);
});

test('fieldWarnings: ops that check their own fields are left alone, and so is anything odd', () => {
  assert.deepEqual(fieldWarnings({ op: 'planner', hours: ['09:00', '17:00'] }), []);
  assert.deepEqual(fieldWarnings({ op: 'gym', cardioQuota: 'Cardio' }), []);
  assert.deepEqual(fieldWarnings({ op: 'fly', anything: 1 }), []);
  assert.deepEqual(fieldWarnings(null), []);
  assert.deepEqual(fieldWarnings({ op: 'plan', tasks: 'not a list' }), []);
});

test('an op with an unknown field still does its job', () => {
  const s = fresh();
  assert.equal(runOp(s, { op: 'task', title: 'Gym', length: '2h' }), 'Added task "Gym" for today · #rec-1');
  assert.equal(s.doc().items['rec-1'].minutes, undefined, 'the field really was dropped');
});

test('a habit can have a set time, on the way in and on an edit', () => {
  const s = fresh();
  assert.equal(runOp(s, { op: 'habit', title: 'Hebrew', minutes: '45m', time: '09:30' }),
    'Added habit "Hebrew" (every day, 45m at 09:30) · #rec-1');
  assert.equal(s.doc().items['rec-1'].time, '09:30');
  assert.equal(runOp(s, { op: 'habit', title: 'Read' }), 'Added habit "Read" (every day) · #rec-2');
  assert.match(runOp(s, { op: 'edit', id: 'rec-2', set: { time: '21:00' } }), /time → 21:00/);
  assert.equal(s.doc().items['rec-2'].time, '21:00');
  assert.match(runOp(s, { op: 'edit', id: 'rec-2', set: { time: null } }), /time → none/);
  assert.equal(s.doc().items['rec-2'].time ?? null, null, 'cleared');
  assert.throws(() => runOp(s, { op: 'habit', title: 'x', time: 'half nine' }), /time needs a time of day/);
});

// ---- series: tasks that only make sense in order ----------------------------------------------

test('series: set on a task or by edit, cleared with null, and only on a task', () => {
  const s = fresh();
  runOp(s, { op: 'task', title: 'Role play 1', date: '2026-09-16', series: 'Role plays' });
  assert.equal(s.doc().items['rec-1'].series, 'Role plays');
  runOp(s, { op: 'task', title: 'Role play 2', date: '2026-09-17' });
  assert.match(runOp(s, { op: 'edit', id: 'rec-2', set: { series: 'Role plays' } }), /series → "Role plays"/);
  runOp(s, { op: 'edit', id: 'rec-2', set: { series: null } });
  assert.equal(s.doc().items['rec-2'].series ?? null, null);
  runOp(s, { op: 'habit', title: 'Walk' });
  assert.throws(() => runOp(s, { op: 'edit', id: 'rec-3', set: { series: 'x' } }), /Only a task/);
  assert.deepEqual(fieldWarnings({ op: 'task', title: 'x', series: 'y' }), []);
});

test('series: a date that puts one before an earlier one comes back with a warning', () => {
  const s = fresh();
  runOp(s, { op: 'task', title: 'Role play 1', date: '2026-09-16', series: 'Role plays' });
  runOp(s, { op: 'task', title: 'Role play 2', date: '2026-09-16', series: 'Role plays' });
  runOp(s, { op: 'task', title: 'Role play 3', date: '2026-09-17', series: 'Role plays' });
  const out = runOp(s, { op: 'edit', id: 'rec-1', set: { date: '2026-09-18' } });
  assert.match(out, /Note: "Role play 1" is now dated after "Role play 2" and "Role play 3" in its series/);
  assert.doesNotMatch(runOp(s, { op: 'edit', id: 'rec-1', set: { date: '2026-09-15' } }), /Note:/);
});

test('series: a later one pinned earlier in the same day than an earlier one is warned about', () => {
  const s = fresh();
  runOp(s, { op: 'task', title: 'Role play 1', date: '2026-09-16', time: '14:00', series: 'Role plays' });
  runOp(s, { op: 'task', title: 'Role play 2', date: '2026-09-16', series: 'Role plays' });
  assert.match(runOp(s, { op: 'edit', id: 'rec-2', set: { time: '09:00' } }), /Note: "Role play 2" is now before "Role play 1"/);
});
