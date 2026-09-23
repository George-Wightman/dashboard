import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countdowns, checkCountdown, nextCountdownId, daysLeft } from '../js/calendar.js';
import { coachTools, TOOL_DECLARATIONS } from '../js/coach-tools.js';
import { prepareCoachTurn } from '../js/coach-session.js';
import { talkContext, TALK_SYSTEM } from '../js/talk.js';
import { goalProgress } from '../js/schedule.js';
import { goalPace } from '../js/ui/side.js';
import { makeStore } from './helpers.js';

// makeStore's clock is Thursday 10 September 2026.
const TODAY = '2026-09-10';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('checkCountdown: a name and a date still to come, in plain English when wrong', () => {
  assert.deepEqual(checkCountdown({ title: '  Assessment   centre ', day: '2026-10-05' }, TODAY), { title: 'Assessment centre', day: '2026-10-05' });
  assert.deepEqual(checkCountdown({ title: 'Today', day: TODAY }, TODAY), { title: 'Today', day: TODAY });
  assert.throws(() => checkCountdown({ title: '', day: '2026-10-05' }, TODAY), /needs a name/);
  assert.throws(() => checkCountdown({ title: 'x'.repeat(61), day: '2026-10-05' }, TODAY), /at most 60/);
  assert.throws(() => checkCountdown({ title: 'AC', day: '2026-02-30' }, TODAY), /date as YYYY-MM-DD/);
  assert.throws(() => checkCountdown({ title: 'AC', day: '2026-09-09' }, TODAY), /has passed/);
});

test('countdowns: still to come, soonest first, with the days left; past and removed ones drop off', () => {
  const store = makeStore();
  const put = (day, title, extra = {}) => store.putCalendar(nextCountdownId(store.doc(), day), { title, day, ...extra }, 'gemini');
  put('2026-10-14', "Maya's birthday");
  put('2026-10-05', 'Assessment centre');
  put('2026-10-05', 'Another thing that day');
  put(TODAY, 'Today itself');
  put('2026-09-01', 'Gone by');
  put('2026-12-01', 'Removed', { status: 'archived' });
  assert.deepEqual(countdowns(store.doc(), TODAY).map((c) => [c.id, c.title, c.days]), [
    ['count:2026-09-10:1', 'Today itself', 0],
    ['count:2026-10-05:2', 'Another thing that day', 25],
    ['count:2026-10-05:1', 'Assessment centre', 25],
    ['count:2026-10-14:1', "Maya's birthday", 34],
  ]);
  assert.deepEqual([0, 1, 2, 25].map(daysLeft), ['today', 'tomorrow', '2 days', '25 days']);
});

test('the Coach adds and removes a countdown, and is told what is counting down', () => {
  const byName = Object.fromEntries(TOOL_DECLARATIONS.map((d) => [d.name, d]));
  assert.deepEqual(byName.add_countdown.parameters.required, ['title', 'day']);
  assert.deepEqual(byName.remove_countdown.parameters.required, ['id']);
  assert.match(TALK_SYSTEM, /add_countdown/);
  const store = makeStore();
  const tools = coachTools({ store });
  const added = tools.run('add_countdown', { title: 'Assessment centre', day: '2026-10-05' });
  assert.equal(added.did, 'Counting down to "Assessment centre" (2026-10-05, 25 days)');
  assert.equal(tools.run('add_countdown', { title: 'Tomorrow thing', day: 'tomorrow' }).did, 'Counting down to "Tomorrow thing" (2026-09-11, tomorrow)');
  assert.match(tools.run('add_countdown', { title: 'Old', day: '2026-09-01' }).error, /has passed/);
  assert.match(tools.run('add_countdown', { title: 'Soon', day: 'next week' }).error, /isn't a day/);
  const line = talkContext(store.doc(), TODAY, new Date(2026, 8, 10, 9)).split('\n').find((l) => l.startsWith('Counting down to:'));
  assert.equal(line, 'Counting down to: count:2026-09-11:1 "Tomorrow thing" 2026-09-11 (tomorrow); count:2026-10-05:1 "Assessment centre" 2026-10-05 (25 days)');
  assert.equal(tools.run('remove_countdown', { id: 'count:2026-09-11:1' }).did, 'Stopped counting down to "Tomorrow thing"');
  assert.match(tools.run('remove_countdown', { id: 'count:2026-09-11:1' }).error, /no countdown/);
  assert.match(tools.run('remove_countdown', { id: 'off:2026-09-11' }).error, /no countdown/);
  assert.deepEqual(countdowns(store.doc(), TODAY).map((c) => c.title), ['Assessment centre']);
});

test('in a turn, the summary says what is counting down', () => {
  const store = makeStore();
  const turn = prepareCoachTurn(store, () => new Date(2026, 8, 10, 9), { message: "count down to Maya's birthday" });
  turn.run('add_countdown', { title: "Maya's birthday", day: '2026-10-14' });
  turn.run('add_countdown', { title: "Maya's birthday", day: '2026-10-14' });
  const out = turn.finish();
  assert.equal(out.summary, 'Counting down to "Maya\'s birthday" (2026-10-14)');
  assert.equal(countdowns(turn.draft.doc(), TODAY).length, 1);
});

test('goalPace: what it takes a day to finish on time, for a goal measured by a number', () => {
  const store = makeStore();
  const book = store.addGoal({ title: 'Reread the book', target: 200, unitLabel: 'pages', targetDate: '2026-09-28' });
  store.logAmount({ goalId: book.id, amount: 20 });
  const pace = (goal) => goalPace(goal, goalProgress(store.doc(), goal), TODAY);
  // 180 pages over 19 days, today included: 9.5, so 10
  assert.equal(pace(store.doc().goals[book.id]), '10 pages a day to finish by Mon 28 Sep');
  const time = store.addGoal({ title: 'Practise', target: 600, unit: 'minutes', targetDate: '2026-09-11' });
  assert.equal(pace(store.doc().goals[time.id]), '5h a day to finish by Fri 11 Sep');
  // no pace for a goal of milestones, one with no date, one past its date, or one that's done
  assert.equal(pace(store.addGoal({ title: 'Milestones', targetDate: '2026-09-28' })), null);
  assert.equal(pace(store.addGoal({ title: 'Undated', target: 10 })), null);
  assert.equal(pace(store.addGoal({ title: 'Late', target: 10, targetDate: '2026-09-09' })), null);
  const done = store.addGoal({ title: 'Done', target: 10, targetDate: '2026-09-28' });
  store.logAmount({ goalId: done.id, amount: 10 });
  assert.equal(pace(store.doc().goals[done.id]), null);
});

test('the Countdown panel is wired in and offline-shelled; widgets can sit under the list', () => {
  assert.match(read('js/ui/widgets.js'), /\{ id: 'countdown', title: 'Countdown', render: renderCountdown \}/);
  assert.match(read('sw.js'), /'js\/ui\/countdown\.js'/);
  const css = read('styles.css');
  for (const sel of ['.under {', '.count-row', '.count-n', '.goal-pace']) assert.ok(css.includes(sel), sel);
  // charts keep a sensible size when a widget is wide
  assert.match(css, /\.radar \{[^}]*max-width: 24rem;/);
  assert.match(css, /\.cardio-bars \{[^}]*max-width: 30rem;/);
});
