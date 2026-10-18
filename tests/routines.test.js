process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncRoutines, routineTitle } from '../planner/routines.js';
import { syncHevy } from '../planner/hevy.js';
import { at } from '../planner/time.js';
import { routinesOf, checkSession } from '../js/coach.js';
import { makeStore, clock } from './helpers.js';
import { FakeHevy, HEVY_KEY, TEMPLATES, hevyWorkout, lift } from './gym-fakes.js';

const TUE = '2026-10-20';
const legs = checkSession({ name: 'Legs A', note: 'Brace.', exercises: [{ name: 'Squat (Barbell)', sets: 3, reps: 5, kg: 95 }] }, TEMPLATES);
const upper = checkSession({ name: 'Upper A', exercises: [{ name: 'Bench Press (Barbell)', sets: 3, reps: 5, kg: 80 }] }, TEMPLATES);

function setup() {
  const now = clock(at(TUE, '08:00'));
  const store = makeStore({ now });
  store.putGym('templates', { list: TEMPLATES });
  const hevy = new FakeHevy();
  const sync = () => syncRoutines({ fetch: hevy.fetch, key: HEVY_KEY, store, now });
  const session = (date, s) => {
    const t = store.addItem({ type: 'task', title: `Gym · ${s.name}`, date });
    store.setSession(t.id, s);
    return t;
  };
  return { now, store, hevy, sync, session };
}

test('a routine title says the session and its day', () => {
  assert.equal(routineTitle(legs, TUE), 'Legs A · Tue 20 Oct');
});

test('the first sync makes the Dashboard folder and a routine in it with exactly the session', async () => {
  const { store, hevy, sync, session } = setup();
  const t = session(TUE, legs);
  await sync();
  assert.deepEqual(hevy.writes.map(([m, p]) => `${m} ${p}`), ['POST /v1/routine_folders', 'POST /v1/routines']);
  assert.deepEqual(hevy.writes[0][2], { routine_folder: { title: 'Dashboard' } });
  const body = hevy.writes[1][2].routine;
  assert.equal(body.title, 'Legs A · Tue 20 Oct');
  assert.equal(body.folder_id, 100);
  assert.equal(body.notes, 'Brace.');
  assert.equal(body.exercises[0].exercise_template_id, 'SQ');
  const state = routinesOf(store.doc());
  assert.equal(state.folderId, 100);
  assert.deepEqual(Object.entries(state.byRoutine).map(([id, v]) => [id, v.taskId, v.day]), [['rt-1', t.id, TUE]]);
  assert.equal(state.lastError, null);
});

test('a folder called Dashboard that already exists is used', async () => {
  const { store, hevy, sync, session } = setup();
  hevy.folders.push({ id: 7, index: 0, title: 'Mine' }, { id: 8, index: 1, title: 'Dashboard' });
  session(TUE, legs);
  await sync();
  assert.deepEqual(hevy.writes.map(([m, p]) => `${m} ${p}`), ['POST /v1/routines']);
  assert.equal(routinesOf(store.doc()).folderId, 8);
});

test('nothing changed, nothing written; a changed session is a PUT without the folder', async () => {
  const { store, hevy, sync, session, now } = setup();
  const t = session(TUE, legs);
  await sync();
  const docBefore = JSON.stringify(store.doc().gym.routines);
  now.advance(10 * 60000);
  await sync();
  assert.equal(hevy.writes.length, 2);
  assert.equal(JSON.stringify(store.doc().gym.routines), docBefore);
  store.setSession(t.id, { ...legs, exercises: [{ ...legs.exercises[0], kg: 97.5 }] });
  await sync();
  const [method, path, body] = hevy.writes.at(-1);
  assert.equal(`${method} ${path}`, 'PUT /v1/routines/rt-1');
  assert.equal('folder_id' in body.routine, false);
  assert.equal(body.routine.exercises[0].sets[0].weight_kg, 97.5);
});

test('a moved session keeps its routine, retitled', async () => {
  const { store, hevy, sync, session } = setup();
  const t = session(TUE, legs);
  await sync();
  store.updateItem(t.id, { date: '2026-10-22' });
  await sync();
  const [method, path, body] = hevy.writes.at(-1);
  assert.equal(`${method} ${path}`, 'PUT /v1/routines/rt-1');
  assert.equal(body.routine.title, 'Legs A · Thu 22 Oct');
  assert.equal(routinesOf(store.doc()).byRoutine['rt-1'].day, '2026-10-22');
});

test("a passed or archived session's routine is reused for the next, since Hevy can't delete", async () => {
  const { store, hevy, sync, session, now } = setup();
  const a = session(TUE, legs);
  await sync();
  store.archiveItem(a.id);
  session('2026-10-23', upper);
  await sync();
  const [method, path, body] = hevy.writes.at(-1);
  assert.equal(`${method} ${path}`, 'PUT /v1/routines/rt-1');
  assert.equal(body.routine.title, 'Upper A · Fri 23 Oct');
  assert.equal(hevy.routines.size, 1);
  // A day later the Friday session is still in the window; a second new one needs a second routine.
  now.advance(24 * 3600000);
  session('2026-10-24', legs);
  await sync();
  assert.equal(hevy.routines.size, 2);
});

test("an exercise Hevy no longer has is a sentence in the status, and the other sessions still sync", async () => {
  const { store, hevy, sync, session } = setup();
  const bad = session(TUE, legs);
  store.setSession(bad.id, { ...legs, exercises: [{ ...legs.exercises[0], tpl: 'GONE', name: 'Old Squat' }] });
  session('2026-10-21', upper);
  await sync();
  const state = routinesOf(store.doc());
  assert.match(state.lastError, /"Legs A" \(Tue 20 Oct\): Old Squat isn't in Hevy's exercise list any more — write the session again/);
  assert.equal(hevy.routines.size, 1);
});

test('Hevy refusing the key or a routine is a sentence, never a throw, and the key never shows', async () => {
  const { store, hevy, session, now } = setup();
  session(TUE, legs);
  const wrong = new FakeHevy({ key: 'other' });
  await syncRoutines({ fetch: wrong.fetch, key: HEVY_KEY, store, now, scrub: (s) => s.replaceAll(HEVY_KEY, '…') });
  assert.match(routinesOf(store.doc()).lastError, /Hevy refused the key/);
  hevy.refuse = { status: 400, body: { error: `bad routine ${HEVY_KEY}` } };
  await syncRoutines({ fetch: hevy.fetch, key: HEVY_KEY, store, now, scrub: (s) => s.replaceAll(HEVY_KEY, '…') });
  const msg = routinesOf(store.doc()).lastError;
  assert.match(msg, /Hevy wouldn't take/);
  assert.doesNotMatch(msg, new RegExp(HEVY_KEY));
});

test('no sessions and no routines: Hevy is not called at all', async () => {
  const { hevy, sync } = setup();
  await sync();
  assert.equal(hevy.calls.length, 0);
});

test("a workout saved from a session's routine ticks the session; one that wasn't doesn't", async () => {
  const { store, hevy, sync, session, now } = setup();
  const t = session(TUE, legs);
  await sync();
  now.set(at(TUE, '19:30'));
  const fromRoutine = { ...hevyWorkout('h1', TUE, '17:30', '18:30', [lift('SQ', [95, 5], [95, 5], [95, 5])]), routine_id: 'rt-1' };
  const other = hevyWorkout('h2', TUE, '06:00', '06:30', [lift('BP', [60, 8])]);
  hevy.save(fromRoutine, at(TUE, '18:30').toISOString());
  hevy.save(other, at(TUE, '06:30').toISOString());
  await syncHevy({ fetch: hevy.fetch, key: HEVY_KEY, store, now });
  const logs = Object.values(store.doc().logs).filter((l) => l.itemId === t.id && l.status === 'active');
  assert.deepEqual(logs.map((l) => [l.id, l.kind, l.day, l.source]), [['hevy-session-h1', 'done', TUE, 'hevy']]);
  // Deleted in Hevy: the tick goes with it.
  hevy.remove('h1', at(TUE, '19:40').toISOString());
  now.set(at(TUE, '19:50'));
  await syncHevy({ fetch: hevy.fetch, key: HEVY_KEY, store, now });
  assert.equal(store.doc().logs['hevy-session-h1'].status, 'archived');
});

test('final review: a routine Hevy made but the planner never recorded is taken back into the pool, not made again', async () => {
  const { store, hevy, sync, session } = setup();
  session(TUE, legs);
  hevy.folders.push({ id: 8, index: 0, title: 'Dashboard' });
  hevy.routines.set('lost-1', { id: 'lost-1', title: 'Old · Mon 19 Oct', folder_id: 8, exercises: [] });
  hevy.routines.set('his-own', { id: 'his-own', title: 'Push day', folder_id: null, exercises: [] });
  await sync();
  assert.deepEqual(hevy.writes.map(([m, p]) => `${m} ${p}`), ['PUT /v1/routines/lost-1']);
  assert.equal(hevy.routines.size, 2);
});

test('final review: a Dashboard folder deleted in Hevy is looked up again, not used forever', async () => {
  const { store, hevy, sync, session } = setup();
  session(TUE, legs);
  store.putGym('routines', { folderId: 999, byRoutine: {}, lastError: null }, 'planner');
  hevy.refuseFolder = 999;
  await sync();
  assert.match(routinesOf(store.doc()).lastError, /Hevy wouldn't take/);
  assert.equal(routinesOf(store.doc()).folderId, null);
  hevy.refuseFolder = null;
  await sync();
  assert.equal(routinesOf(store.doc()).lastError, null);
  assert.equal(hevy.routines.size, 1);
});

test('review minors: a routine moved to a second session the same day ticks it only with workouts started after the move', async () => {
  const { store, hevy, sync, session, now } = setup();
  const a = session(TUE, legs);
  await sync();
  store.toggleDone(a.id, TUE); // ticked by hand, so rt-1 is free for the next session
  now.set(at(TUE, '12:00'));
  const b = session(TUE, upper);
  await sync();
  assert.equal(routinesOf(store.doc()).byRoutine['rt-1'].taskId, b.id);
  // Started from rt-1 at 11:00, while it was still the first session's.
  hevy.save({ ...hevyWorkout('h1', TUE, '11:00', '11:50', [lift('SQ', [95, 5])]), routine_id: 'rt-1' }, at(TUE, '12:05').toISOString());
  now.set(at(TUE, '12:10'));
  await syncHevy({ fetch: hevy.fetch, key: HEVY_KEY, store, now });
  assert.equal(store.doc().logs['hevy-session-h1'], undefined);
  hevy.save({ ...hevyWorkout('h2', TUE, '18:00', '19:00', [lift('BP', [80, 5])]), routine_id: 'rt-1' }, at(TUE, '19:00').toISOString());
  now.set(at(TUE, '19:10'));
  await syncHevy({ fetch: hevy.fetch, key: HEVY_KEY, store, now });
  assert.equal(store.doc().logs['hevy-session-h2']?.itemId, b.id);
});

test('review minors: a routine deleted in Hevy is noticed the next day and made again, though its session is unchanged', async () => {
  const { store, hevy, sync, session, now } = setup();
  const t = session('2026-10-22', legs);
  await sync();
  hevy.routines.delete('rt-1');
  now.advance(10 * 60000);
  await sync();
  assert.equal(hevy.calls.filter((c) => c.endsWith('/v1/routines/rt-1')).length, 0, 'checked once a day, not every run');
  now.set(at('2026-10-21', '08:00'));
  await sync();
  assert.equal(hevy.calls.filter((c) => c.endsWith('/v1/routines/rt-1')).length, 1);
  const state = routinesOf(store.doc());
  assert.deepEqual(Object.entries(state.byRoutine).map(([id, v]) => [id, v.taskId]), [['rt-2', t.id]]);
  assert.equal(hevy.routines.size, 1);
  assert.equal(state.lastError, null);
});

test("review minors: a 404 that doesn't say the routine is gone keeps it; one that does forgets it", async () => {
  const { store, hevy, sync, session } = setup();
  const t = session(TUE, legs);
  await sync();
  store.setSession(t.id, { ...legs, exercises: [{ ...legs.exercises[0], kg: 97.5 }] });
  hevy.refuse = { status: 404, body: { error: 'Not found' } };
  await sync();
  let state = routinesOf(store.doc());
  assert.equal(state.byRoutine['rt-1']?.taskId, t.id);
  assert.match(state.lastError, /Hevy wouldn't take the routine for "Legs A" \(Tue 20 Oct\) \(it answered 404: Not found\)/);
  hevy.refuse = null;
  await sync();
  assert.deepEqual(hevy.writes.at(-1).slice(0, 2), ['PUT', '/v1/routines/rt-1']);
  assert.equal(routinesOf(store.doc()).lastError, null);
  hevy.routines.delete('rt-1');
  store.setSession(t.id, { ...legs, exercises: [{ ...legs.exercises[0], kg: 100 }] });
  await sync();
  state = routinesOf(store.doc());
  assert.equal(state.byRoutine['rt-1'], undefined);
});
