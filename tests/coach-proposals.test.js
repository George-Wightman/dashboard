import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposalLine } from '../js/coach.js';

test('proposalLine: one line per habit or weekly target a plan proposes', () => {
  const habit = (repeat) => ({ type: 'habit', title: 'Stretch', repeat });
  assert.equal(proposalLine(habit({ kind: 'weekdays', days: [1, 3, 5] })), 'Habit: Stretch · Mon, Wed, Fri');
  assert.equal(proposalLine(habit({ kind: 'perWeek', n: 3 })), 'Habit: Stretch · 3 times a week');
  assert.equal(proposalLine(habit({ kind: 'perWeek', n: 1 })), 'Habit: Stretch · once a week');
  assert.equal(proposalLine(habit({ kind: 'daily' })), 'Habit: Stretch · every day');
  assert.equal(proposalLine(habit(undefined)), 'Habit: Stretch · every day');
  assert.equal(proposalLine(habit({ kind: 'weekly', day: 7 })), 'Habit: Stretch · every Sun');
  assert.equal(proposalLine(habit({ kind: 'monthly', date: 1 })), 'Habit: Stretch · on day 1 of the month');
  assert.equal(proposalLine({ type: 'quota', title: 'Running', target: 90, unit: 'minutes', unitLabel: '' }), 'Weekly target: Running · 1.5h');
  assert.equal(proposalLine({ type: 'quota', title: 'Running', target: 45, unit: 'minutes' }), 'Weekly target: Running · 45m');
  assert.equal(proposalLine({ type: 'quota', title: 'Parkruns', target: 2, unit: 'count', unitLabel: 'runs' }), 'Weekly target: Parkruns · 2 runs');
  assert.equal(proposalLine({ type: 'quota', title: 'Apps', target: 5, unit: 'count', unitLabel: '' }), 'Weekly target: Apps · 5');
  assert.equal(proposalLine({ type: 'task', title: 'Email Sarah' }), 'Email Sarah');
});
