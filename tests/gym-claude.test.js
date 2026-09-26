process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { READS } from '../claude/read.js';
import { runOp } from '../claude/ops.js';
import { workoutRecord } from '../js/gym.js';
import { sparkGeometry } from '../js/ui/gym.js';
import { gymLines } from '../js/ui/claude.js';
import { at } from '../planner/time.js';
import { makeStore, clock } from './helpers.js';
import { TEMPLATES, hevyWorkout, lift, cardio } from './gym-fakes.js';

const THU = '2026-09-17';

// A store on Thursday evening with a Gym habit, two targets, and two workouts from Hevy.
function setup() {
  const store = makeStore({ now: clock(at(THU, '20:00')) });
  store.addItem({ type: 'habit', title: 'Gym', created: '2026-09-01' });
  const cardioT = store.addItem({ type: 'quota', title: 'Cardio', target: 150, unit: 'minutes', created: '2026-09-01' });
  const apps = store.addItem({ type: 'quota', title: 'Applications', target: 5, unit: 'count', created: '2026-09-01' });
  for (const w of [
    hevyWorkout('m1', '2026-09-14', '17:40', '18:40', [lift('SQ', [100, 6])]),
    hevyWorkout('w1', '2026-09-16', '07:00', '07:20', [cardio('TM', 1200, 3000)], 'Run'),
  ]) {
    const rec = workoutRecord(w, TEMPLATES);
    store.putGym(`w:${rec.hevyId}`, rec);
  }
  store.putGym('status', { lastSync: at(THU, '19:50').toISOString(), lastError: null, count: 2, backfillPage: null });
  return { store, cardioT, apps };
}

test("Claude's gym read: the connection, key lifts, cardio, the last 14 days, the settings", () => {
  const { store } = setup();
  const out = READS.gym(store.doc(), store.today());
  assert.match(out, /^Today is Thursday 17 September/);
  assert.match(out, /Hevy: last checked .* · 2 workouts/);
  assert.match(out, /  Squat \(Barbell\): est\. 1RM 120 kg · last 100 × 6 .* · no PR yet · pace: needs 4 sessions in 8 weeks · 1 session/);
  assert.match(out, /  Bench Press \(Barbell\): no sessions yet/);
  assert.match(out, /Cardio: no target linked/);
  assert.match(out, /From Hevy: this week 20 min/);
  assert.match(out, /Last 14 days:\n  .*: Run · 20 min · Treadmill 20 min, 3 km\n  .*: Legs A · 60 min · Squat 100 × 6/);
  assert.match(out, /Settings: keyLifts Squat \(Barbell\), Bench Press \(Barbell\) · liftTargets none · habit "Gym" #/);
});

test("the gym op: a Cardio target in minutes, lift targets one at a time, key lifts, the habit", () => {
  const { store, cardioT, apps } = setup();
  assert.equal(runOp(store, { op: 'gym', cardioQuota: 'cardio' }), 'Changed the gym settings: cardio minutes → "Cardio"');
  assert.equal(store.doc().gym.config.cardioQuota, cardioT.id);
  assert.equal(store.doc().gym.config.source, 'claude');
  assert.match(READS.gym(store.doc(), store.today()), /Cardio target "Cardio" #\w+ · 0 \/ 2\.5h this week/);
  assert.throws(() => runOp(store, { op: 'gym', cardioQuota: apps.title }), /"Applications" isn't a live weekly target in minutes/);
  assert.equal(runOp(store, { op: 'gym', liftTargets: { 'Squat (Barbell)': 120 } }), 'Changed the gym settings: Squat (Barbell) target → 120 kg');
  assert.deepEqual(store.doc().gym.config.liftTargets, { 'Squat (Barbell)': 120 });
  assert.throws(() => runOp(store, { op: 'gym', liftTargets: { A: 1, B: 2 } }), /one lift at a time/);
  assert.throws(() => runOp(store, { op: 'gym', liftTargets: { A: 'heavy' } }), /estimated 1RM in kg/);
  runOp(store, { op: 'gym', liftTargets: { 'squat (barbell)': null } });
  assert.deepEqual(store.doc().gym.config.liftTargets, {});
  runOp(store, { op: 'gym', keyLifts: ['Squat (Barbell)', 'Deadlift (Barbell)'] });
  assert.deepEqual(store.doc().gym.config.keyLifts, ['Squat (Barbell)', 'Deadlift (Barbell)']);
  assert.throws(() => runOp(store, { op: 'gym', keyLifts: [] }), /list of Hevy exercise names/);
  assert.throws(() => runOp(store, { op: 'gym', habit: 'Hebrew' }), /No single live habit is "Hebrew"/);
  assert.throws(() => runOp(store, { op: 'gym', routine: 'Push day' }), /Unknown gym setting routine/);
  assert.throws(() => runOp(store, { op: 'gym' }), /gym needs a setting/);
});

test('the sparkline: points across the box, a target line, and the dashed projection to it', () => {
  assert.deepEqual(sparkGeometry([100, 110, 120]), { line: [[4, 40], [70, 22], [136, 4]], targetY: null, ahead: null });
  const g = sparkGeometry([100, 110, 120], 130, { reached: false, day: '2026-10-01', label: 'early Oct' });
  assert.deepEqual(g.line.at(-1), [101, 16]);
  assert.equal(g.targetY, 4);
  assert.deepEqual(g.ahead, [136, 4]);
  assert.deepEqual(sparkGeometry([90]).line, [[70, 22]], 'one session: a dot in the middle');
});

test('⚙ → Claude → Gym: the connection, the key lifts, the Cardio target', () => {
  const { store } = setup();
  runOp(store, { op: 'gym', cardioQuota: 'Cardio' });
  runOp(store, { op: 'gym', liftTargets: { 'Squat (Barbell)': 120 } });
  const lines = gymLines(store.doc(), at(THU, '20:00'));
  assert.match(lines[0], /^Hevy: last checked 19:50 · 2 workouts$/);
  assert.deepEqual(lines.slice(1), ['Key lifts: Squat, Bench Press', 'Cardio minutes count towards "Cardio"', 'Squat target: 120 kg estimated 1RM']);
});
