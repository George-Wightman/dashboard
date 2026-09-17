process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MUSCLE_GROUPS, muscleGroupOf, muscleWeek, longestRested, cardioWeeks, workoutRecord } from '../js/gym.js';
import { radarGeometry, radarScale, restText, cardioBars } from '../js/ui/training.js';
import { fixture } from './helpers.js';
import { TEMPLATES, hevyWorkout, lift, cardio } from './gym-fakes.js';

const THU = '2026-09-17';
const MORE = {
  ...TEMPLATES,
  CURL: ['Bicep Curl (Dumbbell)', 'weight_reps', 'biceps'],
  WRIST: ['Wrist Curl', 'weight_reps', 'forearms'],
  PULL: ['Pull Up', 'reps_only', 'lats'],
  RDL: ['Romanian Deadlift', 'weight_reps', 'hamstrings'],
  ODD: ['Farmer Walk', 'weight_reps', 'full_body'],
};

function docWith(list, { items = [], logs = [], config = null } = {}) {
  const doc = fixture({ items, logs });
  for (const w of list) {
    const rec = workoutRecord(w, MORE);
    doc.gym[`w:${rec.hevyId}`] = { id: `w:${rec.hevyId}`, status: 'active', source: 'hevy', ...rec };
  }
  doc.gym.templates = { id: 'templates', status: 'active', source: 'hevy', list: MORE };
  if (config) doc.gym.config = { id: 'config', status: 'active', source: 'claude', ...config };
  return doc;
}

test('muscle groups: broad ones, trained together; the odd ones fold in or drop out', () => {
  assert.deepEqual(MUSCLE_GROUPS.map((g) => g.name),
    ['Chest', 'Shoulders', 'Triceps', 'Biceps', 'Back', 'Core', 'Glutes & hams', 'Quads']);
  assert.equal(muscleGroupOf('forearms'), 'Biceps');
  assert.equal(muscleGroupOf('traps'), 'Back');
  assert.equal(muscleGroupOf('upper_back'), 'Back');
  assert.equal(muscleGroupOf('calves'), 'Quads');
  assert.equal(muscleGroupOf('adductors'), 'Glutes & hams');
  assert.equal(muscleGroupOf('abdominals'), 'Core');
  for (const m of ['cardio', 'full_body', 'other', '', undefined]) assert.equal(muscleGroupOf(m), null, String(m));
  // every Hevy muscle the planner can send lands somewhere or is deliberately left out
  const all = MUSCLE_GROUPS.flatMap((g) => g.muscles);
  assert.equal(new Set(all).size, all.length, 'no muscle in two groups');
});

test('muscleWeek: working sets per group over the last 7 days, warm-ups and cardio left out', () => {
  const doc = docWith([
    hevyWorkout('a', '2026-09-10', '18:00', '19:00', [lift('BP', [60, 8])]), // 8 days ago: out
    hevyWorkout('b', '2026-09-11', '18:00', '19:00', [lift('BP', [40, 10, 'warmup'], [70, 8], [70, 8])]),
    hevyWorkout('c', THU, '07:00', '08:00', [
      lift('CURL', [12, 10], [12, 10], [12, 10]), lift('WRIST', [10, 15]),
      { tpl: 'PULL', sets: [{ type: 'normal', reps: 8 }, { type: 'normal', reps: 6 }] },
      lift('ODD', [30, 1]), cardio('WK', 600),
    ]),
    hevyWorkout('d', '2026-09-18', '07:00', '08:00', [lift('SQ', [100, 5])]), // tomorrow: out
  ]);
  const week = muscleWeek(doc, THU);
  assert.deepEqual(week.map((g) => [g.name, g.sets]), [
    ['Chest', 2], ['Shoulders', 0], ['Triceps', 0], ['Biceps', 4], ['Back', 2], ['Core', 0], ['Glutes & hams', 0], ['Quads', 0],
  ]);
});

test('muscleWeek: an exercise whose template the app has never seen counts for nothing', () => {
  const doc = docWith([hevyWorkout('a', THU, '07:00', '08:00', [lift('NEW', [50, 5])])]);
  assert.ok(muscleWeek(doc, THU).every((g) => g.sets === 0));
});

test('longestRested: the three groups longest since a working set, never-trained ones first', () => {
  const doc = docWith([
    hevyWorkout('a', '2026-09-01', '18:00', '19:00', [lift('RDL', [80, 8])]),
    hevyWorkout('b', '2026-09-08', '18:00', '19:00', [lift('ROW', [60, 8])]),
    hevyWorkout('c', '2026-09-14', '18:00', '19:00', [lift('BP', [70, 8]), lift('CURL', [12, 10])]),
    hevyWorkout('d', THU, '18:00', '19:00', [lift('SQ', [100, 5], [40, 5, 'warmup'])]),
    hevyWorkout('e', '2026-09-18', '18:00', '19:00', [lift('RDL', [80, 8])]), // after today: ignored
  ]);
  const rested = longestRested(doc, THU);
  assert.deepEqual(rested.slice(0, 3), [
    { name: 'Shoulders', days: null }, { name: 'Triceps', days: null }, { name: 'Core', days: null },
  ]);
  assert.deepEqual(longestRested(doc, THU, 8).slice(3), [
    { name: 'Glutes & hams', days: 16 }, { name: 'Back', days: 9 }, { name: 'Chest', days: 3 },
    { name: 'Biceps', days: 3 }, { name: 'Quads', days: 0 },
  ]);
  assert.equal(longestRested(doc, THU).length, 3);
});

test('restText: days since, in words', () => {
  assert.equal(restText(null), 'not yet');
  assert.equal(restText(0), 'today');
  assert.equal(restText(1), 'yesterday');
  assert.equal(restText(9), '9 days');
});

test('cardioWeeks: eight weeks of cardio minutes, oldest first, this week so far last', () => {
  const doc = docWith([
    hevyWorkout('a', '2026-07-26', '18:00', '19:00', [cardio('WK', 1200)]), // the Sunday before: out
    hevyWorkout('a2', '2026-07-27', '18:00', '19:00', [cardio('WK', 480)]),
    hevyWorkout('b', '2026-08-03', '18:00', '19:00', [cardio('TM', 1800, 5000)]),
    hevyWorkout('c', '2026-09-14', '18:00', '19:00', [cardio('WK', 900)]),
    hevyWorkout('d', THU, '18:00', '19:00', [cardio('WK', 600), lift('SQ', [100, 5])]),
    hevyWorkout('e', '2026-09-19', '18:00', '19:00', [cardio('WK', 3000)]), // later this week: not yet
  ]);
  const weeks = cardioWeeks(doc, THU);
  assert.equal(weeks.target, null);
  assert.deepEqual(weeks.weeks.map((w) => [w.monday, w.minutes, w.current]), [
    ['2026-07-27', 8, false], ['2026-08-03', 30, false], ['2026-08-10', 0, false], ['2026-08-17', 0, false],
    ['2026-08-24', 0, false], ['2026-08-31', 0, false], ['2026-09-07', 0, false], ['2026-09-14', 25, true],
  ]);
});

test('cardioWeeks: with a cardio target, its weekly totals and its target', () => {
  const items = [{ id: 'cardio', type: 'quota', title: 'Cardio', unit: 'minutes', target: 60 }];
  const logs = [
    { id: 'l1', itemId: 'cardio', kind: 'amount', amount: 45, day: '2026-09-09' },
    { id: 'l2', itemId: 'cardio', kind: 'amount', amount: 70, day: '2026-09-15' },
  ];
  const doc = docWith([], { items, logs, config: { cardioQuota: 'cardio' } });
  const weeks = cardioWeeks(doc, THU);
  assert.equal(weeks.target, 60);
  assert.deepEqual(weeks.weeks.slice(-2).map((w) => w.minutes), [45, 70]);
});

test('radarScale: at least 10 sets, else the top rounded up to a 5', () => {
  assert.equal(radarScale([0, 0]), 10);
  assert.equal(radarScale([3, 9]), 10);
  assert.equal(radarScale([11, 2]), 15);
  assert.equal(radarScale([20]), 20);
});

test('radarGeometry: the first axis points straight up, values scale from the centre', () => {
  const g = radarGeometry([10, 0, 5, 0], 10, { cx: 100, cy: 100, r: 50 });
  assert.deepEqual(g.axes[0], [100, 50]);
  assert.deepEqual(g.axes[1], [150, 100]);
  assert.deepEqual(g.points, [[100, 50], [100, 100], [100, 125], [100, 100]]);
  assert.equal(g.rings.length, 4);
  assert.deepEqual(g.rings[3][2], [100, 150]);
  assert.equal(g.labels[1].anchor, 'start');
  assert.equal(g.labels[3].anchor, 'end');
  assert.equal(g.labels[0].anchor, 'middle');
});

test('cardioBars: heights against the larger of the target and the top week', () => {
  const b = cardioBars([{ minutes: 30 }, { minutes: 0 }, { minutes: 90 }], 60, { h: 100 });
  assert.deepEqual(b.heights, [33.3, 0, 100]);
  assert.equal(b.targetY, 33.3);
  const c = cardioBars([{ minutes: 30 }], 60, { h: 100 });
  assert.deepEqual(c.heights, [50]);
  assert.equal(c.targetY, 0);
  assert.equal(cardioBars([{ minutes: 0 }], null, { h: 100 }).targetY, null);
});
