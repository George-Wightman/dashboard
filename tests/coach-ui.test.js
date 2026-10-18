process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backRowState, soreRun, soreFlagText, nextSession } from '../js/coach.js';
import { makeStore, clock } from './helpers.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const TUE = '2026-10-20';
const at = (hh, mm = 0) => new Date(2026, 9, 20, hh, mm);
const legs = { name: 'Legs A', exercises: [{ name: 'Trap Bar Deadlift', tpl: 'TB', sets: 3, reps: 6, rpe: 7 }] };

test('the back question is asked from the start of the day until 11:00, and only until answered', () => {
  const store = makeStore();
  const doc = () => store.doc();
  assert.deepEqual(backRowState(doc(), TUE, at(7, 30), 4), { state: 'ask' });
  assert.equal(backRowState(doc(), TUE, at(11, 0), 4), null);
  assert.equal(backRowState(doc(), TUE, at(3, 0), 4), null, 'before the day starts it is still yesterday');
  store.setBack(TUE, 1);
  assert.deepEqual(backRowState(doc(), TUE, at(9, 0), 4), { state: 'answered', score: 1, word: 'stiff' });
  assert.equal(backRowState(doc(), TUE, at(11, 5), 4), null);
});

test('two sore mornings running are a run; one, or stiff, is not', () => {
  const store = makeStore();
  store.setBack('2026-10-19', 2);
  assert.equal(soreRun(store.doc(), TUE), false);
  store.setBack(TUE, 1);
  assert.equal(soreRun(store.doc(), TUE), false);
  store.setBack(TUE, 3);
  assert.equal(soreRun(store.doc(), TUE), true);
  assert.equal(soreFlagText(store.doc(), TUE), 'Back sore two mornings running (Mon sore, Tue bad)');
});

test('the next session is the first not yet done, from today on', () => {
  const store = makeStore();
  const a = store.addItem({ type: 'task', title: 'Gym · Legs A', date: TUE });
  store.setSession(a.id, legs);
  const b = store.addItem({ type: 'task', title: 'Gym · Upper A', date: '2026-10-22' });
  store.setSession(b.id, { ...legs, name: 'Upper A' });
  assert.equal(nextSession(store.doc(), TUE).id, a.id);
  store.toggleDone(a.id, TUE);
  assert.equal(nextSession(store.doc(), TUE).id, b.id);
  assert.equal(nextSession(store.doc(), '2026-10-23'), null);
});

test('the timeline asks the back question first and shows a session under its row, with the back warning', () => {
  const tl = read('js/ui/timeline.js');
  assert.match(tl, /renderBackRow\(ctx\)/);
  assert.match(tl, /sessionExtras\(ctx, row\)/);
  const ui = read('js/ui/coach.js');
  assert.match(ui, /How's your back this morning\?/);
  assert.match(ui, /ctx\.store\.setBack\(/);
  assert.match(ui, /soreFlagText\(/);
  assert.match(ui, /addFlag\([^)]*'claude'/);
  assert.match(ui, /backFlag\(/);
});

test('Body shows the next session and the back mornings, and its big view 90 of them with the ready marks', () => {
  const tiles = read('js/ui/tiles.js');
  assert.match(tiles, /renderCoach\(ctx\)/);
  assert.match(tiles, /renderCoachBig\(ctx\)/);
  const ui = read('js/ui/coach.js');
  assert.match(ui, /backCells\(doc, today, 7\)/);
  assert.match(ui, /backCells\(doc, today, 90\)/);
  assert.match(ui, /readyMarks\(/);
  assert.ok(read('sw.js').includes("'js/ui/coach.js'"));
});
