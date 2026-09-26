process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  e1rm, kgText, shortLift, workoutRecord, exerciseKind, liftSummary, weekStrip, sessionLine, dayLines, trainingWeek,
  gymConfig, gymHabitId, cardioQuotaId, gymStatusLines, roughDate, cardioOf, hevyTick,
} from '../js/gym.js';
import { fixture, amount } from './helpers.js';
import { TEMPLATES, hevyWorkout, lift, cardio } from './gym-fakes.js';

const THU = '2026-09-17';

// A document with these Hevy workouts in its gym map, as the planner's script writes them.
function docWith(list, { items = [], logs = [], config = null } = {}) {
  const doc = fixture({ items, logs });
  for (const w of list) {
    const rec = workoutRecord(w, TEMPLATES);
    doc.gym[`w:${rec.hevyId}`] = { id: `w:${rec.hevyId}`, status: 'active', source: 'hevy', ...rec };
  }
  if (config) doc.gym.config = { id: 'config', status: 'active', source: 'claude', ...config };
  return doc;
}

// Squat every Thursday from 30 Jul, 85 kg × 5 going up 2.5 kg a week to 100 kg on 10 Sep.
const SQUATS = ['2026-07-30', '2026-08-06', '2026-08-13', '2026-08-20', '2026-08-27', '2026-09-03', '2026-09-10']
  .map((day, i) => hevyWorkout(`sq${i}`, day, '18:00', '19:00', [lift('SQ', [60, 8, 'warmup'], [85 + 2.5 * i, 5], [80, 5])]));

test('e1rm, kilograms and lift names', () => {
  assert.equal(Math.round(e1rm(100, 5) * 100) / 100, 116.67);
  assert.equal(e1rm(100, 13), null, 'more than 12 reps says nothing about a single');
  assert.equal(e1rm(0, 5), null);
  assert.equal(kgText(116.67), '116.5');
  assert.equal(kgText(80), '80');
  assert.equal(shortLift('Squat (Barbell)'), 'Squat');
  assert.equal(shortLift('Bench Press (Barbell)'), 'Bench Press');
  assert.equal(roughDate('2026-10-25'), 'late Oct');
  assert.equal(roughDate('2026-10-03'), 'early Oct');
});

test("a Hevy workout as the gym map keeps it: warm-ups out, key-lift sets kept, cardio counted", () => {
  const w = hevyWorkout('a1', THU, '17:40', '18:38', [
    lift('SQ', [60, 8, 'warmup'], [100, 5, 'normal', 8], [100, 4]),
    lift('ROW', [60, 10]),
    cardio('WK', 900, 1234),
  ]);
  const rec = workoutRecord(w, TEMPLATES);
  assert.equal(rec.day, THU);
  assert.equal(rec.minutes, 58);
  const [sq, row, walk] = rec.exercises;
  assert.deepEqual(sq, { name: 'Squat (Barbell)', tpl: 'SQ', kind: 'lift', n: 2, best: [100, 5], e1rm: 116.7, volume: 900, sets: [[100, 5, 8], [100, 4, null]] });
  assert.deepEqual(row, { name: 'Bent Over Row (Barbell)', tpl: 'ROW', kind: 'lift', n: 1, best: [60, 10], e1rm: 80, volume: 600 });
  assert.deepEqual(walk, { name: 'Walking', tpl: 'WK', kind: 'cardio', n: 1, minutes: 15, km: 1.23 });
  assert.deepEqual(cardioOf(rec), { minutes: 15, km: 1.23 });
  const late = workoutRecord(hevyWorkout('a2', THU, '01:30', '02:30', [lift('BP', [80, 5])]), TEMPLATES);
  assert.equal(late.day, '2026-09-16', 'before the day starts (4am) it counts for the day before');
  assert.throws(() => workoutRecord({ id: 'x' }, TEMPLATES), /didn't make sense/);
  assert.equal(exerciseKind(undefined, [{ duration_seconds: 600 }]), 'cardio');
  assert.equal(exerciseKind(['Pull Up', 'bodyweight_reps', 'lats'], [{ reps: 8 }]), 'other');
});

test('a key lift: estimated 1RM, PR, pace, and when it reaches its target', () => {
  const doc = docWith(SQUATS, { config: { liftTargets: { 'Squat (Barbell)': 120 } } });
  const s = liftSummary(doc, 'Squat (Barbell)', THU);
  assert.equal(s.name, 'Squat');
  assert.equal(s.e1rm, 116.7);
  assert.equal(s.pr, true);
  assert.equal(s.prDay, '2026-09-10');
  assert.deepEqual(s.last, { kg: 100, reps: 5, day: '2026-09-10' });
  assert.equal(s.pace, 2.9);
  assert.deepEqual(s.projection, { reached: false, day: '2026-09-25', label: 'late Sep' });
  assert.equal(s.points.length, 7);
  assert.equal(s.repNote, null);
  assert.equal(liftSummary(doc, 'Bench Press (Barbell)', THU), null, 'never done');
  const few = docWith(SQUATS.slice(-3));
  assert.equal(liftSummary(few, 'Squat (Barbell)', THU).pace, null, 'fewer than 4 sessions in 8 weeks: no pace');
  const reached = docWith(SQUATS, { config: { liftTargets: { 'squat (barbell)': 110 } } });
  assert.deepEqual(liftSummary(reached, 'Squat (Barbell)', THU).projection, { reached: true });
});

test('a rep PR: more reps than ever at the same weight', () => {
  const doc = docWith([
    hevyWorkout('b1', '2026-09-08', '18:00', '19:00', [lift('BP', [80, 5])], 'Upper A'),
    hevyWorkout('b2', '2026-09-15', '18:00', '19:00', [lift('BP', [80, 6])], 'Upper A'),
  ]);
  assert.equal(liftSummary(doc, 'Bench Press (Barbell)', THU).repNote, '+1 rep');
  const again = docWith([
    hevyWorkout('b1', '2026-09-08', '18:00', '19:00', [lift('BP', [80, 6])]),
    hevyWorkout('b2', '2026-09-15', '18:00', '19:00', [lift('BP', [80, 6])]),
  ]);
  assert.equal(liftSummary(again, 'Bench Press (Barbell)', THU).repNote, null);
});

test('the week, a session in a line, and what the Coach is told', () => {
  const cardioTarget = { id: 'cardio', type: 'quota', title: 'Cardio', target: 150, unit: 'minutes' };
  const doc = docWith([
    ...SQUATS,
    hevyWorkout('m1', '2026-09-14', '17:40', '18:40', [lift('SQ', [100, 6]), lift('ROW', [60, 10]), cardio('WK', 900, 1200)]),
    hevyWorkout('w1', '2026-09-16', '07:00', '07:20', [cardio('TM', 1200, 3000)], 'Run'),
  ], { items: [cardioTarget], logs: [amount('c1', 'cardio', '2026-09-14', 15), amount('c2', 'cardio', '2026-09-16', 20)], config: { cardioQuota: 'cardio' } });
  const strip = weekStrip(doc, THU);
  assert.deepEqual(strip.map((c) => [c.day.slice(8), c.lifted, c.cardio, c.future]), [
    ['14', true, 15, false], ['15', false, 0, false], ['16', false, 20, false], ['17', false, 0, false],
    ['18', false, 0, true], ['19', false, 0, true], ['20', false, 0, true],
  ]);
  assert.deepEqual(dayLines(doc, '2026-09-14'), ['Legs A · 60 min · Squat 100 × 6 PR · 1 other exercise · Walking 15 min, 1.2 km']);
  assert.equal(sessionLine(doc, doc.gym['w:w1']), 'Run · 20 min · Treadmill 20 min, 3 km');
  assert.equal(trainingWeek(doc, THU), '2 sessions; cardio 35 of 150 min; Squat est. 1RM 120 (PR Mon), +3 kg/wk');
});

test('settings, the habit and the target Hevy fills, the tick, and the status lines', () => {
  const items = [
    { id: 'gym', type: 'habit', title: 'Gym', repeat: { kind: 'daily' } },
    { id: 'heb', type: 'habit', title: 'Learn Hebrew', repeat: { kind: 'daily' } },
    { id: 'cardio', type: 'quota', title: 'Cardio', target: 150, unit: 'minutes' },
    { id: 'apps', type: 'quota', title: 'Applications', target: 5, unit: 'count' },
  ];
  const doc = docWith([], { items, logs: [{ id: 'hevy-done-a1', itemId: 'gym', kind: 'done', day: THU, source: 'hevy', from: 'F', at: 'A' }] });
  assert.deepEqual(gymConfig(doc), { keyLifts: ['Squat (Barbell)', 'Bench Press (Barbell)'], liftTargets: {}, cardioQuota: null, habit: 'Gym' });
  assert.equal(gymHabitId(doc), 'gym');
  assert.equal(cardioQuotaId(doc), null);
  assert.equal(cardioQuotaId(doc, { ...gymConfig(doc), cardioQuota: 'cardio' }), 'cardio');
  assert.equal(cardioQuotaId(doc, { ...gymConfig(doc), cardioQuota: 'apps' }), null, 'a count target takes no minutes');
  assert.deepEqual(hevyTick(doc, 'gym', THU), { from: 'F', at: 'A' });
  assert.equal(hevyTick(doc, 'gym', '2026-09-16'), null);
  assert.match(gymStatusLines(doc)[0], /isn't connected — the planner script needs the key as HEVY_KEY/);
  doc.gym.status = { id: 'status', status: 'active', lastSync: '2026-09-17T17:00:00.000Z', count: 212, backfillPage: 7, lastError: 'Hevy refused the key' };
  assert.deepEqual(gymStatusLines(doc, () => '18:00'), ['Hevy: last checked 18:00 · 212 workouts', 'Still copying your Hevy history — page 7 next', 'Problem: Hevy refused the key']);
});
