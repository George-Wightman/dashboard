import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coachTools, TOOL_DECLARATIONS } from '../js/coach-tools.js';
import { prepareCoachTurn } from '../js/coach-session.js';
import { weekTotal, todayRows } from '../js/schedule.js';
import { talkContext, TALK_SYSTEM } from '../js/talk.js';
import { HEBREW_IDS, ensureHebrewGoal } from '../js/hebrewSync.js';
import { makeStore } from './helpers.js';

// The Coach is the one way in for new work, so it logs what he did against a weekly target and
// suggests new habits and weekly targets (the list's + buttons and the add box are gone).
// makeStore's clock is Thursday 10 September 2026; the week began on Monday the 7th.

const TODAY = '2026-09-10';

function setup() {
  const store = makeStore({ prefix: 'item-' });
  const apps = store.addItem({ type: 'quota', title: 'Applications', target: 4, unitLabel: 'applications', area: 'Job search' });
  const reading = store.addItem({ type: 'quota', title: 'Reading time', target: 120, unit: 'minutes' });
  const cardio = store.addItem({ type: 'quota', title: 'Cardio', target: 60, unit: 'minutes' });
  store.putGym('config', { cardioQuota: cardio.id });
  const task = store.addItem({ type: 'task', title: 'Email Sarah', date: TODAY });
  return { store, tools: coachTools({ store }), apps, reading, cardio, task };
}

test('the three new tools are declared, each with what it needs', () => {
  const byName = Object.fromEntries(TOOL_DECLARATIONS.map((d) => [d.name, d]));
  assert.deepEqual(byName.log.parameters.required, ['id', 'amount']);
  assert.deepEqual(byName.suggest_habit.parameters.required, ['title']);
  assert.deepEqual(byName.suggest_target.parameters.required, ['title', 'target']);
  assert.match(TALK_SYSTEM, /suggest_habit and suggest_target/);
  assert.doesNotMatch(TALK_SYSTEM, /Hand app bugs, habits, weekly targets/);
});

test('log: a count, a time, and an earlier day this week', () => {
  const { store, tools, apps, reading } = setup();
  const r = tools.run('log', { id: apps.id, amount: '2' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.did, 'Logged 2 applications on "Applications"');
  assert.equal(tools.run('log', { id: apps.id, amount: '1 application', day: 'yesterday', note: 'NatCen' }).ok, true);
  assert.equal(weekTotal(store.doc(), apps.id, TODAY), 3);
  const yesterday = Object.values(store.doc().logs).find((l) => l.day === '2026-09-09');
  assert.equal(yesterday.note, 'NatCen');
  assert.equal(yesterday.source, 'gemini');
  assert.equal(tools.run('log', { id: reading.id, amount: '1h30' }).did, 'Logged 1.5h on "Reading time"');
  assert.equal(weekTotal(store.doc(), reading.id, TODAY), 90);
});

test('log refuses what it should: not a target, filled by an app, the future, last week, nonsense', () => {
  const { store, tools, apps, cardio, task } = setup();
  ensureHebrewGoal(store);
  const refused = (args) => {
    const r = tools.run('log', args);
    assert.equal(r.ok, false, JSON.stringify(args));
    return r.error;
  };
  assert.match(refused({ id: task.id, amount: '1' }), /isn't a weekly target — tick it instead/);
  assert.match(refused({ id: HEBREW_IDS.minutes, amount: '20m' }), /fills itself from the Hebrew app/);
  assert.match(refused({ id: cardio.id, amount: '20m' }), /fills itself from his Hevy workouts/);
  assert.match(refused({ id: apps.id, amount: '1', day: '2026-09-11' }), /already done/);
  assert.match(refused({ id: apps.id, amount: '1', day: '2026-09-06' }), /Only this week/);
  assert.match(refused({ id: apps.id, amount: 'lots' }), /number above 0/);
  assert.match(refused({ id: apps.id, amount: '0' }), /number above 0/);
  assert.equal(weekTotal(store.doc(), apps.id, TODAY), 0);
  // tick points at log now, rather than saying he must do it himself
  assert.match(tools.run('tick', { id: apps.id }).error, /log an amount on it instead/);
});

test('suggest_habit: a suggestion at the top of Today, with the repeat as he said it', () => {
  const cases = [
    [undefined, { kind: 'daily' }],
    ['daily', { kind: 'daily' }],
    ['Mon Wed Fri', { kind: 'weekdays', days: [1, 3, 5] }],
    ['monday, thursday and saturday', { kind: 'weekdays', days: [1, 4, 6] }],
    ['weekdays', { kind: 'weekdays', days: [1, 2, 3, 4, 5] }],
    ['3 a week', { kind: 'perWeek', n: 3 }],
    ['twice a week', { kind: 'perWeek', n: 2 }],
    ['4 times per week', { kind: 'perWeek', n: 4 }],
  ];
  for (const [repeat, want] of cases) {
    const { store, tools } = setup();
    const r = tools.run('suggest_habit', { title: '  Stretch  ', repeat, area: 'Health' });
    assert.equal(r.ok, true, `${repeat}: ${r.error}`);
    const habit = Object.values(store.doc().items).find((i) => i.type === 'habit');
    assert.deepEqual([habit.title, habit.status, habit.source, habit.area, habit.repeat], ['Stretch', 'suggested', 'gemini', 'Health', want], String(repeat));
  }
  const { store, tools } = setup();
  tools.run('suggest_habit', { title: 'Stretch' });
  const row = todayRows(store.doc(), TODAY).find((x) => x.item.title === 'Stretch');
  assert.equal(row.suggested, true);
  assert.match(tools.run('suggest_habit', { title: 'X', repeat: 'whenever' }).error, /A habit repeats/);
  assert.match(tools.run('suggest_habit', { title: ' ' }).error, /needs a title/);
});

test('suggest_target: a count or a time a week, as a suggestion', () => {
  const { store, tools } = setup();
  const count = tools.run('suggest_target', { title: 'Coffee chats', target: '2', unitLabel: 'chats', area: 'Job search' });
  assert.equal(count.did, 'Suggested the weekly target "Coffee chats" (2 chats a week)');
  const time = tools.run('suggest_target', { title: 'Deep work', target: '5h' });
  assert.equal(time.did, 'Suggested the weekly target "Deep work" (5h a week)');
  const made = Object.values(store.doc().items).filter((i) => i.status === 'suggested')
    .map((i) => [i.title, i.type, i.target, i.unit, i.unitLabel, i.area ?? '']);
  assert.deepEqual(made, [
    ['Coffee chats', 'quota', 2, 'count', 'chats', 'Job search'],
    ['Deep work', 'quota', 300, 'minutes', '', ''],
  ]);
  assert.match(tools.run('suggest_target', { title: 'Nothing', target: '0' }).error, /amount above 0/);
  assert.match(tools.run('suggest_target', { title: '', target: '3' }).error, /needs a title/);
});

test('in a turn, a repeated log is kept once and the summary says what was suggested', () => {
  const { store, apps } = setup();
  const turn = prepareCoachTurn(store, () => new Date(2026, 8, 10, 9, 0), { message: 'sent two applications and add stretching' });
  turn.run('log', { id: apps.id, amount: '2' });
  turn.run('log', { id: apps.id, amount: '2' });
  turn.run('suggest_habit', { title: 'Stretch', repeat: 'daily' });
  const out = turn.finish();
  assert.equal(out.proposal, false);
  assert.equal(weekTotal(turn.draft.doc(), apps.id, TODAY), 2);
  assert.match(out.summary, /Suggested the habit "Stretch"/);
});

test("the Coach is told the weekly targets with their ids, which fill themselves, and not the paused ones", () => {
  const { store, apps, cardio } = setup();
  ensureHebrewGoal(store);
  const paused = store.addItem({ type: 'quota', title: 'Roles logged', target: 6, area: 'Paused area' });
  store.putCalendar('off:2026-09-08', { start: '2026-09-08', end: '2026-09-20', areas: ['Paused area'], reason: 'Focus' });
  const line = talkContext(store.doc(), TODAY, new Date(2026, 8, 10, 9, 0)).split('\n').find((l) => l.startsWith("This week's targets:"));
  assert.ok(line.includes(`${apps.id.slice(0, 8)} "Applications" 0 of 4`), line);
  assert.ok(line.includes('"Cardio" 0m of 1h (from Hevy)'), line);
  assert.ok(line.includes('"Hebrew learning time" 0m of 1.5h (from the Hebrew app)'), line);
  assert.ok(!line.includes(paused.title), line);
  assert.ok(cardio);
});
