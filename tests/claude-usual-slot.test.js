import test from 'node:test';
import assert from 'node:assert/strict';
import { makeStore } from './helpers.js';
import { runOp } from '../claude/ops.js';

test('a usual meal Claude saves can name its home meal, and a wrong one is refused', () => {
  const s = makeStore();
  assert.equal(runOp(s, { op: 'meal', usual: { name: '6 eggs in pittas', protein: 50, kcal: 900, slot: 'lunch' } }),
    'Saved the usual meal "6 eggs in pittas": 50 g, 900 kcal, offered at lunch on Start the day');
  assert.equal(s.doc().meals['usual:6-eggs-in-pittas'].slot, 'lunch');
  assert.throws(() => runOp(s, { op: 'meal', usual: { name: 'x', protein: 1, kcal: 1, slot: 'brunch' } }), /breakfast, lunch, dinner or snack/);
});

test('a meal Claude logs can say which meal it was, so a late dinner is not a snack', () => {
  const s = makeStore();
  runOp(s, { op: 'meal', log: 'chicken thighs and rice', day: 'yesterday', time: '21:45', slot: 'dinner' });
  const m = Object.values(s.doc().meals).find((x) => x.text === 'chicken thighs and rice');
  assert.equal(m.slot, 'dinner');
  runOp(s, { op: 'meal', log: 'a protein bar', day: 'yesterday', time: '21:50' });
  assert.equal(Object.values(s.doc().meals).find((x) => x.text === 'a protein bar').slot, 'snack');
  assert.throws(() => runOp(s, { op: 'meal', log: 'x', day: 'yesterday', time: '12:00', slot: 'brunch' }), /breakfast, lunch, dinner or snack/);
});
