process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  workoutRecord, liftSummary, keyLiftsNow, sessionLine, trainingWeek, prBoard, cardioOf, weekStrip, measureText, setText, paceText, RECORD_SHAPE,
} from '../js/gym.js';
import { fixture } from './helpers.js';
import { TEMPLATES, hevyWorkout, lift, cardio, reps, hold } from './gym-fakes.js';

const THU = '2026-11-19';

function docWith(list, { config = null } = {}) {
  const doc = fixture();
  for (const w of list) {
    const rec = workoutRecord(w, TEMPLATES);
    doc.gym[`w:${rec.hevyId}`] = { id: `w:${rec.hevyId}`, status: 'active', source: 'hevy', ...rec };
  }
  if (config) doc.gym.config = { id: 'config', status: 'active', source: 'claude', ...config };
  return doc;
}

// Barbell squats and bench in a gym until early November, then the bars in a park from the 9th.
const GYM = [
  hevyWorkout('g1', '2026-10-23', '17:00', '18:00', [lift('SQ', [100, 3])]),
  hevyWorkout('g2', '2026-11-02', '17:00', '18:00', [lift('BP', [120, 1])]),
  hevyWorkout('g3', '2026-11-03', '17:00', '18:00', [lift('SQ', [100, 5])]),
];
const BARS = [
  hevyWorkout('p1', '2026-11-09', '11:00', '11:31', [cardio('TM', 400, 900), reps('PU', 8, 7, 6), hold('LS', 15, 12)], 'Bars A · Pull'),
  hevyWorkout('p2', '2026-11-11', '11:00', '11:40', [reps('DIP', 12, 10), hold('LS', 20)], 'Bars B · Dip'),
  hevyWorkout('p3', '2026-11-13', '11:00', '11:30', [reps('PU', 9, 8), reps('DIP', 13)], 'Bars A · Pull'),
  hevyWorkout('p4', '2026-11-16', '11:00', '11:38', [reps('DIP', 14, 12)], 'Bars B · Dip'),
  hevyWorkout('p5', '2026-11-17', '11:00', '11:06', [reps('PU', 10, 9, 8)], 'Bars A · Pull'),
  hevyWorkout('p6', '2026-11-19', '15:00', '15:11', [reps('PU', [5, 6], 9), reps('DIP', 15)], 'Workout'),
];

test('bodyweight exercises keep their reps, and holds their seconds, not cardio minutes', () => {
  const rec = workoutRecord(BARS[0], TEMPLATES);
  assert.equal(rec.shape, RECORD_SHAPE);
  const [run, pull, lsit] = rec.exercises;
  assert.equal(run.kind, 'cardio');
  assert.deepEqual(pull, { name: 'Pull Up', tpl: 'PU', kind: 'reps', n: 3, best: [0, 8], top: 8, reps: 21 });
  assert.deepEqual(lsit, { name: 'L-Sit Hold', tpl: 'LS', kind: 'hold', n: 2, sec: 15, secs: 27 });
  assert.deepEqual(cardioOf(rec), { minutes: 6.7, km: 0.9 }, 'the run only: holds are not cardio');
  // From a routine (his Bars A and B are), the sets are kept too.
  const fromRoutine = workoutRecord({ ...BARS[0], routine_id: 'r1' }, TEMPLATES);
  assert.deepEqual(fromRoutine.exercises[1].sets, [[0, 8, null], [0, 7, null], [0, 6, null]]);
  assert.deepEqual(fromRoutine.exercises[2].sets, [[0, 15, null], [0, 12, null]]);
  // Weight added: the set with the most reps leads, the heavier on a tie.
  const weighted = workoutRecord(hevyWorkout('x', THU, '10:00', '10:30', [reps('PU', [5, 6], 9, [10, 9])]), TEMPLATES).exercises[0];
  assert.deepEqual(weighted.best, [10, 9]);
  assert.equal(weighted.top, 9);
});

test('a bodyweight key lift: best reps, PR, pace in reps a week, and a target in reps', () => {
  const doc = docWith([...GYM, ...BARS], { config: { keyLifts: ['Squat (Barbell)', 'Bench Press (Barbell)'], liftTargets: { 'Pull Up': 15 } } });
  const s = liftSummary(doc, 'Pull Up', THU);
  assert.equal(s.unit, 'reps');
  assert.equal(s.value, 9, 'the latest session: 9 at bodyweight beats 6 with 5 kg on, by reps');
  assert.equal(s.e1rm, null);
  assert.equal(s.pr, false);
  assert.equal(s.prDay, '2026-11-17');
  assert.equal(s.last.text, '9 reps');
  assert.equal(s.target, 15);
  assert.equal(s.points.join(','), '8,9,10,9');
  assert.equal(s.repNote, null);
  const dip = liftSummary(doc, 'Chest Dip', THU);
  assert.equal(dip.value, 15);
  assert.equal(dip.pr, true);
  assert.ok(dip.pace > 0);
  const lsit = liftSummary(doc, 'L-Sit Hold', THU);
  assert.equal(lsit.unit, 's');
  assert.equal(lsit.value, 20);
});

test('the key lifts follow what he trains now, and the set ones come back with a gym', () => {
  const config = { keyLifts: ['Squat (Barbell)', 'Bench Press (Barbell)'] };
  // Early November: still in the gym, so the set ones.
  assert.deepEqual(keyLiftsNow(docWith(GYM, { config }), '2026-11-04'), ['Squat (Barbell)', 'Bench Press (Barbell)']);
  // Mid November: squat and bench were done inside the last four weeks, so they still lead.
  assert.deepEqual(keyLiftsNow(docWith([...GYM, ...BARS], { config }), THU), ['Squat (Barbell)', 'Bench Press (Barbell)']);
  // A month after the last gym session: the bars, the most trained and most recent first.
  assert.deepEqual(keyLiftsNow(docWith([...GYM, ...BARS], { config }), '2026-12-05'), ['Chest Dip', 'Pull Up']);
  // With nothing set (the defaults aside, which he isn't doing): straight to the bars.
  assert.deepEqual(keyLiftsNow(docWith(BARS), THU), ['Chest Dip', 'Pull Up']);
  // Nothing at all in four weeks: whatever was set, so the last numbers still show.
  assert.deepEqual(keyLiftsNow(docWith(GYM, { config }), '2027-02-01'), ['Squat (Barbell)', 'Bench Press (Barbell)']);
  // Back in a gym: one barbell session puts squat back first, beside what he's still doing.
  const back = [...GYM, ...BARS, hevyWorkout('g9', '2026-12-07', '17:00', '18:00', [lift('SQ', [90, 5])])];
  assert.deepEqual(keyLiftsNow(docWith(back, { config }), '2026-12-08'), ['Squat (Barbell)', 'Chest Dip']);
  // Weeks later, with only that one lift in the last four weeks, it shows alone.
  assert.deepEqual(keyLiftsNow(docWith(back, { config }), '2027-01-02'), ['Squat (Barbell)']);
});

test('a bars session in a line, the week, the PR board and the strip all count bodyweight work', () => {
  const doc = docWith(BARS);
  const w = Object.values(doc.gym).find((r) => r.hevyId === 'p6');
  assert.equal(sessionLine(doc, w), 'Workout · 11 min · Chest Dip 15 reps PR · Pull Up 9 reps');
  assert.match(trainingWeek(doc, THU), /Chest Dip best 15 reps \(PR Thu\), \+[\d.]+ reps\/wk/);
  const board = prBoard(doc, THU);
  assert.deepEqual(board.map((r) => [r.name, r.unit, r.value]), [['Chest Dip', 'reps', 15], ['Pull Up', 'reps', 10], ['L-Sit Hold', 's', 20]]);
  assert.ok(weekStrip(doc, THU).find((c) => c.day === '2026-11-16').lifted, 'a dip session is strength work');
});

test('the words: units, sets and pace', () => {
  assert.equal(measureText(124, 'kg'), '124 kg');
  assert.equal(measureText(1, 'reps'), '1 rep');
  assert.equal(measureText(45, 's'), '45 s');
  assert.equal(measureText(80, 's'), '1:20');
  assert.equal(setText('kg', [100, 5], 116.7), '100 × 5');
  assert.equal(setText('reps', [10, 6], 6), '+10 kg × 6');
  assert.equal(setText('reps', [-20, 8], 8), '-20 kg × 8');
  assert.equal(setText('reps', [0, 12], 12), '12 reps');
  assert.equal(paceText(1, 'reps'), '+1 rep/wk');
  assert.equal(paceText(-0.5, 'kg'), '-0.5 kg/wk');
  assert.equal(paceText(3, 's'), '+3 s/wk');
});
