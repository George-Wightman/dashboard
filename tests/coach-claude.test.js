process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { READS } from '../claude/read.js';
import { runOp, FIELDS } from '../claude/ops.js';
import { sessionTasks, sessionWorkout, checkSession } from '../js/coach.js';
import { makeStore, clock } from './helpers.js';

const TODAY = '2026-10-20';
const TEMPLATES = {
  SQ: ['Squat (Barbell)', 'weight_reps', 'quadriceps'],
  TB: ['Trap Bar Deadlift', 'weight_reps', 'glutes'],
  BP: ['Bench Press (Barbell)', 'weight_reps', 'chest'],
};
const legs = { name: 'Legs A', exercises: [{ name: 'squat (barbell)', sets: 3, reps: 5, kg: 95 }, { name: 'Trap Bar Deadlift', sets: 3, reps: 6, rpe: 7 }] };

// A session on a day already gone (the op only writes today or later), as if written then.
function pastSession(store, date, s = legs) {
  const t = store.addItem({ type: 'task', title: `Gym · ${s.name}`, date, area: 'Health', source: 'claude' });
  store.setSession(t.id, checkSession(s, TEMPLATES));
  return t;
}

function coachStore() {
  const store = makeStore({ now: clock(new Date(2026, 9, 20, 8, 0)), prefix: 'a1b2c3d4e5f6-' });
  store.putGym('templates', { list: TEMPLATES });
  return store;
}

test('the session op makes a gym task with the session on it, as Hevy names the exercises', () => {
  const store = coachStore();
  const line = runOp(store, { op: 'session', date: '2026-10-21', time: '17:30', session: legs });
  assert.match(line, /^Added session "Legs A" on Wed 21 Oct at 17:30 \(2 exercises\) · #/);
  const [t] = sessionTasks(store.doc(), TODAY, '2026-10-26');
  assert.deepEqual([t.title, t.date, t.time, t.area, t.minutes, t.source], ['Gym · Legs A', '2026-10-21', '17:30', 'Health', 75, 'claude']);
  assert.equal(t.session.exercises[0].name, 'Squat (Barbell)');
  assert.equal(t.session.exercises[0].tpl, 'SQ');
  assert.equal(t.notes, 'Squat (Barbell) 3×5 @ 95 kg\nTrap Bar Deadlift 3×6 @ RPE 7');
});

test('the session op puts a session on a task that exists, and null clears it', () => {
  const store = coachStore();
  const task = store.addItem({ type: 'task', title: 'Gym', date: TODAY });
  assert.match(runOp(store, { op: 'session', id: task.id, session: legs }), /^Set session "Legs A" on "Gym" today \(2 exercises\)/);
  assert.equal(store.doc().items[task.id].session.name, 'Legs A');
  assert.match(runOp(store, { op: 'session', id: task.id, session: null }), /^Cleared the session on "Gym"/);
  assert.equal(store.doc().items[task.id].session, null);
});

test('the session op refuses what Hevy has no exercise for, a habit, and an empty exercise list', () => {
  const store = coachStore();
  assert.throws(() => runOp(store, { op: 'session', date: TODAY, session: { name: 'L', exercises: [{ name: 'Barbell Squat', sets: 3, reps: 5 }] } }),
    /"Barbell Squat" isn't one of Hevy's exercises\. Closest: Squat \(Barbell\)/);
  const habit = store.addItem({ type: 'habit', title: 'Gym', repeat: { kind: 'daily' } });
  assert.throws(() => runOp(store, { op: 'session', id: habit.id, session: legs }), /a dated task/);
  assert.throws(() => runOp(store, { op: 'session', session: legs }), /date or an id/);
  const bare = makeStore({ now: clock(new Date(2026, 9, 20, 8, 0)) });
  assert.throws(() => runOp(bare, { op: 'session', date: TODAY, session: legs }), /Hevy's exercise list isn't on the dashboard yet/);
  assert.deepEqual(FIELDS.session, ['id', 'date', 'time', 'title', 'session']);
});

test('the back read lists each morning, and the summary counts them', () => {
  const store = coachStore();
  store.setBack('2026-10-18', 0);
  store.setBack('2026-10-19', 2);
  store.setBack(TODAY, 1);
  const text = READS.back(store.doc(), TODAY, '');
  assert.match(text, /Sun 18 Oct: fine\n {2}Mon 19 Oct: sore\n {2}today: stiff/);
  assert.match(text, /3 of 14 mornings answered: fine 1, stiff 1, sore 1/);
  assert.match(READS.back(makeStore().doc(), TODAY, ''), /No back answers in the last 14 days/);
});

test("the gym read shows the week's sessions, whether each is in Hevy, and lifts ready for more weight", () => {
  const store = coachStore();
  runOp(store, { op: 'session', date: TODAY, session: legs });
  runOp(store, { op: 'session', date: '2026-10-23', session: { name: 'Upper A', exercises: [{ name: 'Bench Press (Barbell)', sets: 3, reps: 5, kg: 80 }] } });
  const [legsTask, upper] = sessionTasks(store.doc(), TODAY, '2026-10-26');
  store.putGym('routines', { folderId: 7, byRoutine: { 'r-1': { taskId: legsTask.id, day: TODAY, hash: 'h' } }, lastError: null });
  store.putGym('w:h1', {
    hevyId: 'h1', title: 'Legs A', day: TODAY, start: '2026-10-20T16:00:00.000Z', end: '2026-10-20T17:00:00.000Z', minutes: 60, routineId: 'r-1',
    exercises: [{ name: 'Squat (Barbell)', tpl: 'SQ', kind: 'lift', n: 3, sets: [[95, 5, null], [95, 5, null], [95, 5, null]], best: [95, 5], e1rm: 110.8 }],
  });
  assert.equal(sessionWorkout(store.doc(), store.doc().items[legsTask.id]).hevyId, 'h1');
  const text = READS.gym(store.doc(), TODAY, '');
  assert.match(text, /Sessions you've planned \(next 7 days\):/);
  assert.match(text, new RegExp(`today: "Legs A" #${legsTask.id.slice(0, 8)}[^\\n]* · in Hevy · trained \\(Hevy workout\\)`));
  assert.match(text, /Fri 23 Oct: "Upper A" [^\n]* · waiting for the planner to put it into Hevy/);
  assert.match(text, /Ready for more weight: Squat \(Barbell\) \(today, 95 kg\)/);
  store.putGym('routines', { lastError: "Hevy refused the key" });
  assert.match(READS.gym(store.doc(), TODAY, ''), /Putting sessions into Hevy failed: Hevy refused the key/);
  assert.ok(upper);
});

test('the catch-up says how the back has been and how many sessions were done', () => {
  const store = coachStore();
  store.setBack('2026-10-19', 2);
  store.setBack(TODAY, 2);
  pastSession(store, '2026-10-19');
  const text = READS.catchup(store.doc(), TODAY, '2');
  assert.match(text, /Back: sore 2 \(sore Mon, today\) · sessions done 0 of 1/);
});

test('final review: a session done earlier is still found once its routine is reused, so its ready marks stay', () => {
  const store = coachStore();
  pastSession(store, '2026-10-19');
  const [mon] = sessionTasks(store.doc(), '2026-10-19', '2026-10-19');
  store.putGym('w:h1', {
    hevyId: 'h1', title: 'Legs A', day: '2026-10-19', start: '2026-10-19T16:00:00.000Z', end: '2026-10-19T17:00:00.000Z', minutes: 60, routineId: 'r-1',
    exercises: [{ name: 'Squat (Barbell)', tpl: 'SQ', kind: 'lift', n: 3, sets: [[95, 5, null], [95, 5, null], [95, 5, null]] }],
  });
  store.putLog('hevy-session-h1', { itemId: mon.id, kind: 'done', day: '2026-10-19', source: 'hevy' });
  // The routine has since gone to another session.
  store.putGym('routines', { folderId: 7, byRoutine: { 'r-1': { taskId: 'someone-else', day: '2026-10-26', hash: 'h' } }, lastError: null });
  assert.equal(sessionWorkout(store.doc(), store.doc().items[mon.id])?.hevyId, 'h1');
  assert.match(READS.gym(store.doc(), TODAY, ''), /Ready for more weight: Squat \(Barbell\) \(Mon 19 Oct, 95 kg\)/);
});

test('review minors: a session waiting for Hevy while reading Hevy fails says why it is waiting', () => {
  const store = coachStore();
  runOp(store, { op: 'session', date: '2026-10-22', session: legs });
  const waiting = /Thu 22 Oct: "Legs A" [^\n]* · waiting for the planner to put it into Hevy$/m;
  assert.match(READS.gym(store.doc(), TODAY, ''), waiting);
  store.putGym('status', { lastSync: null, lastError: "Couldn't reach Hevy", since: '2026-10-19T08:00:00.000Z', backfillPage: null, startedOn: '2026-10-19', count: 0 });
  const text = READS.gym(store.doc(), TODAY, '');
  assert.match(text, /Thu 22 Oct: "Legs A" [^\n]* · not in Hevy: the planner puts sessions in only after reading Hevy, and that is failing \(Couldn't reach Hevy\)/);
});

test('review minors: the session op refuses a past date, and a date or time beside an id', () => {
  const store = coachStore();
  assert.throws(() => runOp(store, { op: 'session', date: '2026-10-19', session: legs }), /Mon 19 Oct is in the past — a session goes on today or a day ahead/);
  assert.equal(sessionTasks(store.doc(), '2026-10-01', '2026-10-31').length, 0);
  const task = store.addItem({ type: 'task', title: 'Gym', date: TODAY });
  assert.throws(() => runOp(store, { op: 'session', id: task.id, date: '2026-10-22', session: legs }),
    /With an id the session goes on that task as it is — move the task with \{"op": "edit", "id": "[^"]+", "set": \{"date": "2026-10-22"\}\} first/);
  assert.throws(() => runOp(store, { op: 'session', id: task.id, time: '18:00', session: legs }), /"set": \{"time": "18:00"\}/);
  assert.equal(store.doc().items[task.id].session, undefined);
});
