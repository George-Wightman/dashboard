process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore } from './helpers.js';
import { mergeDocs } from '../js/merge.js';
import { recordProblem } from '../js/doc.js';
import { backScores } from '../js/coach.js';
import { workoutRecord } from '../js/gym.js';
import { TEMPLATES, hevyWorkout, lift } from './gym-fakes.js';

const session = { name: 'Legs A', exercises: [{ name: 'Squat (Barbell)', tpl: 'SQ', sets: 3, reps: 5, kg: 95 }] };

test('a back answer is one record a day; answering again replaces it', () => {
  const store = makeStore();
  store.setBack('2026-10-20', 1);
  store.setBack('2026-10-20', 2);
  const recs = Object.values(store.doc().gym).filter((r) => r.kind === 'back');
  assert.equal(recs.length, 1);
  assert.deepEqual([recs[0].id, recs[0].day, recs[0].score, recs[0].source], ['back:2026-10-20', '2026-10-20', 2, 'me']);
  assert.throws(() => store.setBack('2026-10-20', 4), /fine, stiff, sore or bad/);
  assert.deepEqual(backScores(store.doc(), '2026-10-21', 3), [{ day: '2026-10-20', score: 2 }]);
});

test('the phone and the laptop answering the same morning merge to one answer', () => {
  const phone = makeStore({ prefix: 'p' });
  const laptop = makeStore({ prefix: 'l' });
  phone.setBack('2026-10-20', 0);
  laptop.setBack('2026-10-20', 2);
  const merged = mergeDocs(phone.doc(), laptop.doc());
  assert.equal(Object.values(merged.gym).filter((r) => r.kind === 'back').length, 1);
});

test("a session goes on the task, and its lines into the task's notes for the calendar", () => {
  const store = makeStore();
  const t = store.addItem({ type: 'task', title: 'Gym · Legs A', date: '2026-10-20' });
  store.setSession(t.id, session);
  const item = store.doc().items[t.id];
  assert.deepEqual(item.session, session);
  assert.equal(item.notes, 'Squat (Barbell) 3×5 @ 95 kg');
  assert.equal(recordProblem('items', t.id, item), null);
  store.setSession(t.id, null);
  assert.deepEqual([store.doc().items[t.id].session, store.doc().items[t.id].notes], [null, '']);
});

test("clearing a session leaves notes George wrote himself", () => {
  const store = makeStore();
  const t = store.addItem({ type: 'task', title: 'Gym', date: '2026-10-20' });
  store.setSession(t.id, session);
  store.updateItem(t.id, { notes: 'Bring the belt' });
  store.setSession(t.id, null);
  assert.equal(store.doc().items[t.id].notes, 'Bring the belt');
});

test('a malformed session on an item is an invalid record', () => {
  const base = { id: 'x', type: 'task', title: 'Gym', date: '2026-10-20', status: 'active' };
  assert.match(recordProblem('items', 'x', { ...base, session: { name: 'L' } }), /session/);
  assert.equal(recordProblem('items', 'x', { ...base, session: null }), null);
});

test('a workout keeps the Hevy routine it was started from, and every lift set when it has one', () => {
  const w = hevyWorkout('a1', '2026-10-20', '17:00', '18:00', [lift('ROW', [60, 8], [60, 8])]);
  const plain = workoutRecord(w, TEMPLATES);
  assert.equal(plain.routineId, null);
  assert.equal(plain.exercises[0].sets, undefined);
  const fromRoutine = workoutRecord({ ...w, routine_id: 'r-9' }, TEMPLATES);
  assert.equal(fromRoutine.routineId, 'r-9');
  assert.deepEqual(fromRoutine.exercises[0].sets, [[60, 8, null], [60, 8, null]]);
});
