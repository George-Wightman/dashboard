// An honest day score (docs/superpowers/specs/2026-09-23-honest-day-score-design.md): what George
// committed to after the morning check-in still counts when it's moved or deleted, and a
// times-a-week habit only counts on the days he needs it.

process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, done, makeStore, clock } from './helpers.js';
import { at } from '../planner/time.js';
import { dayScore, dayCompletion } from '../js/schedule.js';
import { lockDue, ensureCommitment, commitKey } from '../js/commit.js';

const MON = '2026-09-21', TUE = '2026-09-22', WED = '2026-09-23', THU = '2026-09-24';

const walk = { id: 'walk', type: 'habit', title: 'Morning walk', repeat: { kind: 'daily' }, created: '2026-09-01', order: 1 };
const gym = { id: 'gym', type: 'habit', title: 'Gym', repeat: { kind: 'perWeek', n: 5 }, created: '2026-09-01', order: 2 };
const task = (id, date, extra = {}) => ({ id, type: 'task', title: id, date, order: 10, ...extra });
const commit = (day, tasks) => ({ [commitKey(day)]: { id: commitKey(day), day, at: at(day, '09:00').toISOString(), tasks } });

function doc({ items = [], logs = [], commits = {} } = {}) {
  const d = fixture({ items, logs });
  d.calendar = { ...(d.calendar ?? {}), ...commits };
  return d;
}
const ids = (list) => list.map((r) => r.item?.id ?? r.id).sort();

// ---- Habits ------------------------------------------------------------------------------------

test('a daily habit not done counts against the day', () => {
  const s = dayScore(doc({ items: [walk] }), WED);
  assert.deepEqual([s.done, s.total], [0, 1]);
});

test('a times-a-week habit on pace is optional: a rest day, not a miss', () => {
  // Gym twice by Tuesday: three to go, five days left.
  const s = dayScore(doc({ items: [walk, gym], logs: [done('gym', MON), done('gym', TUE)] }), WED);
  assert.deepEqual([s.done, s.total], [0, 1]);
  assert.deepEqual(ids(s.optional), ['gym']);
});

test('a times-a-week habit counts once the week needs it every remaining day', () => {
  // Nothing by Wednesday: five to go, five days left.
  const s = dayScore(doc({ items: [gym] }), WED);
  assert.deepEqual([s.done, s.total], [0, 1]);
  assert.deepEqual(s.optional, []);
});

test('doing an optional habit still counts', () => {
  const s = dayScore(doc({ items: [gym], logs: [done('gym', MON), done('gym', TUE), done('gym', WED)] }), WED);
  assert.deepEqual([s.done, s.total], [1, 1]);
});

// ---- Committed tasks ---------------------------------------------------------------------------

test('moving a committed task to another day is pushed: out of the score, but listed', () => {
  const s = dayScore(doc({ items: [task('a', WED, { date: THU }), task('b', WED)], logs: [done('b', WED)], commits: commit(WED, ['a', 'b']) }), WED);
  assert.deepEqual([s.done, s.total], [1, 1]);
  assert.deepEqual(ids(s.pushed), ['a']);
});

test('a task pushed on a second day counts as missed', () => {
  const d = doc({ items: [task('a', THU)], commits: { ...commit(TUE, ['a']), ...commit(WED, ['a']) } });
  const wed = dayScore(d, WED);
  assert.deepEqual([wed.done, wed.total], [0, 1]);
  assert.deepEqual(ids(wed.missed), ['a']);
  assert.deepEqual(wed.pushed, []);
  assert.deepEqual(ids(dayScore(d, TUE).pushed), ['a']);
});

test('deleting a committed task is a miss, unless it was released as no longer needed', () => {
  const dropped = task('a', WED, { status: 'archived', archivedOn: WED });
  const s = dayScore(doc({ items: [dropped], commits: commit(WED, ['a']) }), WED);
  assert.deepEqual([s.done, s.total], [0, 1]);
  assert.deepEqual(ids(s.dropped), ['a']);
  const released = dayScore(doc({ items: [{ ...dropped, released: 'Recruiter cancelled it' }], commits: commit(WED, ['a']) }), WED);
  assert.deepEqual([released.done, released.total], [0, 0]);
  assert.deepEqual(ids(released.released), ['a']);
});

test('a task the planner carried to a later day, still dated today, is left out', () => {
  const d = doc({ items: [task('a', WED)], commits: commit(WED, ['a']) });
  d.calendar.agenda = { from: WED, blocks: [{ start: at(THU, '09:00').toISOString(), end: at(THU, '10:00').toISOString(), items: ['a'], state: 'rough' }] };
  const s = dayScore(d, WED);
  assert.deepEqual([s.done, s.total], [0, 0]);
  assert.deepEqual(s.pushed, []);
});

test('without a commitment a day scores from its list, as before', () => {
  const s = dayScore(doc({ items: [task('a', WED), task('b', WED)], logs: [done('a', WED)] }), WED);
  assert.deepEqual([s.done, s.total], [1, 2]);
});

test('dayCompletion is the score as two numbers', () => {
  const d = doc({ items: [walk, task('a', THU)], commits: commit(WED, ['a']) });
  assert.deepEqual(dayCompletion(d, WED), { done: 0, total: 1 });
});

// ---- The lock ----------------------------------------------------------------------------------

const talk = (messages) => ({ id: `talk:${WED}:morning`, kind: 'talk', day: WED, slot: 'morning', status: 'active', messages });
const msg = (who, hhmm) => ({ who, text: '…', at: at(WED, hhmm).toISOString() });

test('the lock: after the morning exchange, or 11:00', () => {
  const d = doc();
  assert.equal(lockDue(d, WED, at(WED, '09:00')), false);
  d.journal[`talk:${WED}:morning`] = talk([msg('coach', '08:00'), msg('george', '08:30')]);
  assert.equal(lockDue(d, WED, at(WED, '08:31')), false, 'waiting for the Coach to answer');
  d.journal[`talk:${WED}:morning`] = talk([msg('coach', '08:00'), msg('george', '08:30'), msg('coach', '08:31')]);
  assert.equal(lockDue(d, WED, at(WED, '08:32')), true);
  assert.equal(lockDue(doc(), WED, at(WED, '11:00')), true);
});

test('ensureCommitment: the day as it stands at the lock, written once', () => {
  const store = makeStore({ now: clock(at(WED, '11:05')), prefix: 'x-' });
  const a = store.addItem({ type: 'task', title: 'Role play 1', date: WED });
  const b = store.addItem({ type: 'task', title: 'Role play 2', date: WED });
  store.addItem({ type: 'task', title: 'Tomorrow', date: THU });
  assert.equal(ensureCommitment(store, WED, at(WED, '10:00')), null);
  const rec = ensureCommitment(store, WED, at(WED, '11:05'));
  assert.deepEqual([...rec.tasks].sort(), [a.id, b.id].sort());
  store.updateItem(b.id, { date: THU });
  assert.equal(ensureCommitment(store, WED, at(WED, '12:00')), null);
  assert.deepEqual([...store.doc().calendar[commitKey(WED)].tasks].sort(), [a.id, b.id].sort());
  const s = dayScore(store.doc(), WED);
  assert.deepEqual(ids(s.pushed), [b.id]);
});

// ---- The Coach ---------------------------------------------------------------------------------

import { talkContext, TALK_SYSTEM, OPENERS } from '../js/talk.js';
import { coachTools } from '../js/coach-tools.js';

test('the Coach is told what was committed, pushed, deleted and optional', () => {
  const store = makeStore({ now: clock(at(WED, '19:30')), prefix: 'score-' });
  const kept = store.addItem({ type: 'task', title: 'Role play 1', date: WED });
  const moved = store.addItem({ type: 'task', title: 'Role play 2', date: WED });
  const gone = store.addItem({ type: 'task', title: 'Scenario primer', date: WED });
  const g = store.addItem({ ...gym, id: undefined });
  store.toggleDone(g.id, MON);
  store.toggleDone(g.id, TUE);
  ensureCommitment(store, WED, at(WED, '11:00'));
  store.updateItem(moved.id, { date: THU });
  store.archiveItem(gone.id);
  const text = talkContext(store.doc(), WED, at(WED, '19:30'));
  assert.match(text, /Today's list locked at 11:00 with 3 tasks/);
  assert.match(text, /Today's score so far: 0 of 2 done/);
  assert.match(text, new RegExp(`Committed and not done yet: ${kept.id.slice(0, 8)} "Role play 1"$`, 'm'));
  assert.match(text, /Pushed off today after committing[^\n]*"Role play 2" → Thu/);
  assert.match(text, /Deleted after committing[^\n]*"Scenario primer"/);
  assert.match(text, /Optional today[^\n]*"Gym"/);
  assert.match(TALK_SYSTEM, /Hold George to what he committed to/);
  assert.match(OPENERS.evening, /pushed, deleted or missed, ask about it/);
});

test('release_task: only a deleted task, only with his reason, and it stops counting', () => {
  const store = makeStore({ now: clock(at(WED, '19:30')), prefix: 'release-' });
  const gone = store.addItem({ type: 'task', title: 'Scenario primer', date: WED });
  const live = store.addItem({ type: 'task', title: 'Role play 1', date: WED });
  ensureCommitment(store, WED, at(WED, '11:00'));
  store.archiveItem(gone.id);
  const t = coachTools({ store });
  assert.equal(t.run('release_task', { id: live.id, reason: 'x' }).ok, false);
  assert.equal(t.run('release_task', { id: gone.id }).ok, false);
  assert.equal(dayScore(store.doc(), WED).total, 2);
  const r = t.run('release_task', { id: gone.id, reason: 'Covered it in the role play' });
  assert.equal(r.did, 'Released "Scenario primer" — Covered it in the role play');
  assert.equal(dayScore(store.doc(), WED).total, 1);
});
