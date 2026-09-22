process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, clock, done } from './helpers.js';
import { at } from '../planner/time.js';
import { dayShape, talkContext } from '../js/talk.js';


const SUN = '2026-09-20';
const MON = '2026-09-21';
const SAT = '2026-09-19';

const task = (id, title, date, minutes = 60) => ({ id, type: 'task', title, date, minutes, area: 'Assessment centre' });

// A confirmed booking of `ids` on `day`. Shaped as js/plan-state.js reads it.
const block = (day, from, to, ids, title = 'Assessment centre') => ({
  start: at(day, from).toISOString(), end: at(day, to).toISOString(),
  items: ids, title, calendar: 'Application', state: 'firm',
});

function doc({ items = [], blocks = [], brief = null }) {
  const d = fixture({
    items,
    journal: brief ? [{ id: `brief:${SUN}`, kind: 'brief', day: SUN, text: brief }] : [],
  });
  d.calendar = { ...(d.calendar ?? {}), agenda: { blocks } };
  return d;
}

// The 20 September case: three tasks asked for on Sunday, all booked on Monday instead.
function groundwork() {
  const items = [
    task('g1', 'Reread every application MI5 holds', SUN),
    task('g2', 'Draft the Motivational Fit answer', SUN),
    task('g3', 'Pick a STAR for each interview competency', SUN),
  ];
  const blocks = [block(MON, '09:00', '12:00', ['g1', 'g2', 'g3'])];
  return doc({ items, blocks, brief: 'Groundwork day: reread the applications, draft Motivational Fit, pick the four STARs.' });
}

// ---- dayShape ----------------------------------------------------------------------------------

test('dayShape: work requested today but booked later is moved off, not booked today', () => {
  const shape = dayShape(groundwork(), SUN);
  assert.deepEqual(shape.movedOff.map((m) => m.item.id).sort(), ['g1', 'g2', 'g3']);
  assert.deepEqual(shape.movedOff.map((m) => m.to), [MON, MON, MON]);
  assert.equal(shape.bookedToday.length, 0);
});

test('dayShape: work requested earlier but booked today has arrived', () => {
  const d = doc({
    items: [task('a1', 'Carried thing', SAT)],
    blocks: [block(SUN, '09:00', '10:00', ['a1'])],
  });
  const shape = dayShape(d, SUN);
  assert.deepEqual(shape.arrived.map((e) => e.item.id), ['a1']);
  assert.deepEqual(shape.bookedToday.map((e) => e.item.id), ['a1']);
  assert.equal(shape.movedOff.length, 0);
});

test('dayShape: work requested today with no booking is unscheduled', () => {
  const shape = dayShape(doc({ items: [task('u1', 'Nowhere yet', SUN)] }), SUN);
  assert.deepEqual(shape.unscheduled.map((e) => e.item.id), ['u1']);
  assert.equal(shape.movedOff.length, 0);
});

// ---- significance ------------------------------------------------------------------------------

test('significance: a day stripped of the work asked for it is significant', () => {
  assert.equal(dayShape(groundwork(), SUN).significant, true);
});

test('significance: a day backfilled with other real work is not', () => {
  const d = doc({
    items: [
      task('g1', 'Reread every application MI5 holds', SUN),
      task('g2', 'Draft the Motivational Fit answer', SUN),
      task('g3', 'Pick a STAR for each interview competency', SUN),
      task('b1', 'Brought forward one', SAT),
      task('b2', 'Brought forward two', SAT),
      task('b3', 'Brought forward three', SAT),
    ],
    blocks: [block(MON, '09:00', '12:00', ['g1', 'g2', 'g3']), block(SUN, '09:00', '12:00', ['b1', 'b2', 'b3'])],
  });
  assert.equal(dayShape(d, SUN).significant, false);
});

test('significance: half the asked-for time surviving is not enough', () => {
  const d = doc({
    items: [task('s1', 'Survivor', SUN), task('s2', 'Gone one', SUN), task('s3', 'Gone two', SUN), task('s4', 'Gone three', SUN)],
    blocks: [block(SUN, '09:00', '10:00', ['s1']), block(MON, '09:00', '12:00', ['s2', 's3', 's4'])],
  });
  assert.equal(dayShape(d, SUN).significant, true);
});

test('significance: nothing moved off is never significant', () => {
  const d = doc({ items: [task('k1', 'Kept', SUN)], blocks: [block(SUN, '09:00', '10:00', ['k1'])] });
  assert.equal(dayShape(d, SUN).significant, false);
});

// ---- what the Coach is told --------------------------------------------------------------------

const now = clock(at(SUN, '08:39'));

test('20 September: the context says where the groundwork actually went', () => {
  const text = talkContext(groundwork(), SUN, now());
  assert.match(text, /Requested for today, now booked later:/);
  assert.match(text, /"Reread every application MI5 holds" → Mon 21 Sep/);
  assert.match(text, /"Draft the Motivational Fit answer" → Mon 21 Sep/);
  assert.match(text, /"Pick a STAR for each interview competency" → Mon 21 Sep/);
});

test("20 September: the brief is labelled as intent, not as the day's schedule", () => {
  const text = talkContext(groundwork(), SUN, now());
  assert.match(text, /Today's intent \(Claude — why today matters, not what is scheduled\): Groundwork day:/);
  assert.doesNotMatch(text, /Claude's brief for today:/);
});

test('the significance marker is on the first message only, but the facts always are', () => {
  const first = talkContext(groundwork(), SUN, now(), { first: true });
  const later = talkContext(groundwork(), SUN, now(), { first: false });
  assert.match(first, /significantly different/i);
  assert.doesNotMatch(later, /significantly different/i);
  for (const text of [first, later]) assert.match(text, /"Draft the Motivational Fit answer" → Mon 21 Sep/);
});

test('an ordinary day carries no reconciliation lines at all', () => {
  const d = doc({ items: [task('k1', 'Kept', SUN)], blocks: [block(SUN, '09:00', '10:00', ['k1'])] });
  const text = talkContext(d, SUN, now(), { first: true });
  assert.doesNotMatch(text, /Requested for today, now booked later/);
  assert.doesNotMatch(text, /significantly different/i);
});

// ---- 22 September: what George ticked, not what was booked -------------------------------------

const TUE = '2026-09-22';

// The evening of 22 September: three tasks ticked during the day, and two booked into the evening
// that he hadn't done. The Coach congratulated him on the two he hadn't done.
function tuesdayEvening() {
  const d = fixture({
    items: [
      task('s1', 'Pick a STAR for each interview competency', TUE),
      task('p1', 'Post the PC for spares on Facebook', TUE, 30),
      task('r1', 'Role play 1 - untimed, learn the shape', TUE, 150),
      task('m1', "Figure out Maya's birthday present with Luli", TUE, 30),
    ],
    logs: [done('s1', TUE), done('p1', TUE)],
  });
  d.calendar = { ...(d.calendar ?? {}), agenda: { blocks: [
    block(TUE, '09:00', '11:00', ['s1']),
    block(TUE, '16:00', '18:30', ['r1'], 'Role play 1 - untimed, learn the shape'),
    block(TUE, '18:45', '19:15', ['m1'], "Figure out Maya's birthday present with Luli"),
  ] } };
  return d;
}
const evening = clock(at(TUE, '19:30'));

test("22 September: the Coach is told what he ticked today, even though ticked tasks leave the schedule", () => {
  const text = talkContext(tuesdayEvening(), TUE, evening());
  assert.match(text, /Ticked off today[^\n]*: "Pick a STAR for each interview competency" · "Post the PC for spares on Facebook"/);
});

test('22 September: a block whose time has passed but was never ticked says so', () => {
  const text = talkContext(tuesdayEvening(), TUE, evening());
  assert.match(text, /16:00–18:30 Role play 1 - untimed, learn the shape[^·]*not ticked/);
  assert.match(text, /18:45–19:15 Figure out Maya's birthday present with Luli[^·]*not ticked/);
  assert.doesNotMatch(text, /09:00–11:00 [^·]*not ticked/);
});

test('22 September: with nothing ticked, the context says so rather than leaving it out', () => {
  const d = tuesdayEvening();
  d.logs = {};
  assert.match(talkContext(d, TUE, evening()), /Ticked off today[^\n]*: nothing yet/);
});
