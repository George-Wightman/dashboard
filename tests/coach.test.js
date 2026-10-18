import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionLines, sessionText, checkSession, routineBody, isHinge, backFlag, readyMarks } from '../js/coach.js';

const TEMPLATES = {
  T1: ['Squat (Barbell)', 'weight_reps', 'quadriceps'],
  T2: ['Trap Bar Deadlift', 'weight_reps', 'glutes'],
  T3: ['Bulgarian Split Squat', 'weight_reps', 'quadriceps'],
  T4: ['Chest Supported Incline Row (Dumbbell)', 'weight_reps', 'upper_back'],
  T5: ['Plank', 'duration', 'abdominals'],
  T6: ['Bench Press (Barbell)', 'weight_reps', 'chest'],
};

const legs = {
  name: 'Legs A',
  note: 'Brace before each rep.',
  exercises: [
    { name: 'Squat (Barbell)', sets: 3, reps: 5, kg: 95 },
    { name: 'Trap Bar Deadlift', sets: 3, reps: 6, rpe: 7 },
    { name: 'Bulgarian Split Squat', sets: 3, reps: 8, kg: 16, each: true },
    { name: 'Chest Supported Incline Row (Dumbbell)', sets: 3, repRange: [8, 12], kg: 22.5, rpe: 8, note: 'pause at the top' },
  ],
  cardio: { kind: 'Bike', minutes: 25, hr: [118, 138] },
};

test('a session reads as one line per exercise, the note first and the cardio last', () => {
  assert.deepEqual(sessionLines(legs), [
    'Brace before each rep.',
    'Squat (Barbell) 3×5 @ 95 kg',
    'Trap Bar Deadlift 3×6 @ RPE 7',
    'Bulgarian Split Squat 3×8 each @ 16 kg',
    'Chest Supported Incline Row (Dumbbell) 3×8–12 @ 22.5 kg, RPE 8 (pause at the top)',
    'Bike 25 min, 118–138 bpm',
  ]);
  assert.equal(sessionText({ name: 'X', exercises: [{ name: 'Plank', sets: 3, reps: 1 }] }), 'Plank 3×1');
  assert.equal(sessionText({ name: 'X', exercises: [{ name: 'Plank', sets: 2, reps: 1 }], cardio: { kind: 'Walk', minutes: 30 } }), 'Plank 2×1\nWalk 30 min');
});

test('checking a session finds each exercise in Hevy, ignoring case, and keeps its template', () => {
  const s = checkSession({ name: 'Legs', exercises: [{ name: 'squat (barbell)', sets: 3, reps: 5, kg: 95 }] }, TEMPLATES);
  assert.equal(s.exercises[0].tpl, 'T1');
  assert.equal(s.exercises[0].name, 'Squat (Barbell)');
  assert.equal(s.name, 'Legs');
});

test("an exercise Hevy doesn't have is refused, naming the closest ones", () => {
  assert.throws(() => checkSession({ name: 'L', exercises: [{ name: 'Barbell Squat', sets: 3, reps: 5 }] }, TEMPLATES),
    /"Barbell Squat" isn't one of Hevy's exercises\. Closest: Squat \(Barbell\)/);
  assert.throws(() => checkSession({ name: 'L', exercises: [{ name: 'Zercher Carry', sets: 3, reps: 5 }] }, TEMPLATES),
    /"Zercher Carry" isn't one of Hevy's exercises\.$/);
});

test('a malformed session is refused with a sentence', () => {
  const bad = [
    [{ exercises: [{ name: 'Plank', sets: 3, reps: 1 }] }, /name/],
    [{ name: 'L', exercises: [] }, /at least one exercise/],
    [{ name: 'L', exercises: [{ name: 'Plank', sets: 0, reps: 1 }] }, /sets/],
    [{ name: 'L', exercises: [{ name: 'Plank', sets: 3 }] }, /reps/],
    [{ name: 'L', exercises: [{ name: 'Plank', sets: 3, reps: 5, repRange: [5, 8] }] }, /reps or repRange/],
    [{ name: 'L', exercises: [{ name: 'Plank', sets: 3, repRange: [8, 5] }] }, /repRange/],
    [{ name: 'L', exercises: [{ name: 'Plank', sets: 3, reps: 5, kg: -1 }] }, /kg/],
    [{ name: 'L', exercises: [{ name: 'Plank', sets: 3, reps: 5, rpe: 11 }] }, /rpe/],
    [{ name: 'L', exercises: [{ name: 'Plank', sets: 3, reps: 5 }], cardio: { kind: 'Bike' } }, /minutes/],
    [{ name: 'L', exercises: [{ name: 'Plank', sets: 3, reps: 5 }], cardio: { kind: 'Bike', minutes: 20, hr: [150, 120] } }, /hr/],
  ];
  for (const [s, re] of bad) assert.throws(() => checkSession(s, TEMPLATES), re, JSON.stringify(s));
});

test("the Hevy routine is exactly Hevy's shape", () => {
  const s = checkSession(legs, TEMPLATES);
  const body = routineBody(s, { title: 'Legs A · Tue 20 Oct', folderId: 42 });
  assert.deepEqual(body.routine.title, 'Legs A · Tue 20 Oct');
  assert.equal(body.routine.folder_id, 42);
  assert.equal(body.routine.notes, 'Brace before each rep.\nBike 25 min, 118–138 bpm');
  assert.deepEqual(body.routine.exercises[0], {
    exercise_template_id: 'T1', superset_id: null, rest_seconds: null, notes: '',
    sets: [1, 2, 3].map(() => ({ type: 'normal', weight_kg: 95, reps: 5, distance_meters: null, duration_seconds: null, custom_metric: null, rep_range: null })),
  });
  assert.equal(body.routine.exercises[1].notes, 'RPE 7');
  assert.equal(body.routine.exercises[1].sets[0].weight_kg, null);
  assert.equal(body.routine.exercises[2].notes, 'each side');
  assert.equal(body.routine.exercises[3].notes, 'RPE 8 · pause at the top');
  assert.deepEqual(body.routine.exercises[3].sets[0].rep_range, { start: 8, end: 12 });
  assert.equal(body.routine.exercises[3].sets[0].reps, null);
  // An update leaves the folder out.
  assert.equal('folder_id' in routineBody(s, { title: 't' }).routine, false);
});

test('hinges are deadlifts, good mornings and Romanian deadlifts', () => {
  for (const n of ['Trap Bar Deadlift', 'Romanian Deadlift (Barbell)', 'Good Morning (Barbell)', 'RDL']) assert.ok(isHinge(n), n);
  for (const n of ['Squat (Barbell)', 'Back Extension', 'Hip Thrust (Barbell)']) assert.ok(!isHinge(n), n);
});

test("the back flag: a sore morning before a hinge or a heavy squat, never a light day", () => {
  const e1 = (name) => (name === 'Squat (Barbell)' ? 120 : null);
  assert.match(backFlag(legs, 2, e1), /^Back's sore: swap the trap bar deadlift for back extensions, or drop the load\.$/);
  assert.equal(backFlag(legs, 1, e1), null);
  assert.equal(backFlag(legs, null, e1), null);
  const heavySquat = { name: 'S', exercises: [{ name: 'Squat (Barbell)', sets: 3, reps: 3, kg: 105 }] }; // 105 ≥ 85% of 120
  assert.match(backFlag(heavySquat, 3, e1), /^Back's (bad|sore): go lighter on the squat, or swap it for split squats\.$/);
  const hardSquat = { name: 'S', exercises: [{ name: 'Squat (Barbell)', sets: 3, reps: 5, rpe: 8 }] };
  assert.ok(backFlag(hardSquat, 2, () => null));
  const light = { name: 'L', exercises: [{ name: 'Squat (Barbell)', sets: 3, reps: 5, kg: 80 }, { name: 'Bulgarian Split Squat', sets: 3, reps: 8, rpe: 9 }] };
  assert.equal(backFlag(light, 3, e1), null);
});

test('ready to add weight: every set at the top of the reps, at the weight', () => {
  const s = checkSession(legs, TEMPLATES);
  const w = { exercises: [
    { name: 'Squat (Barbell)', tpl: 'T1', kind: 'lift', sets: [[95, 5, null], [95, 5, null], [95, 6, null]] },
    { name: 'Bulgarian Split Squat', tpl: 'T3', kind: 'lift', sets: [[16, 8, null], [16, 7, null], [16, 8, null]] },
    { name: 'Chest Supported Incline Row (Dumbbell)', tpl: 'T4', kind: 'lift', sets: [[22.5, 12, null], [22.5, 12, null], [24, 12, null]] },
  ] };
  assert.deepEqual(readyMarks(s, w), ['Squat (Barbell)', 'Chest Supported Incline Row (Dumbbell)']);
  // Fewer sets than prescribed isn't ready; no kg prescribed is never ready.
  assert.deepEqual(readyMarks(s, { exercises: [{ tpl: 'T1', sets: [[95, 5, null], [95, 5, null]] }, { tpl: 'T2', sets: [[100, 6], [100, 6], [100, 6]] }] }), []);
  assert.deepEqual(readyMarks(s, { exercises: [] }), []);
});
