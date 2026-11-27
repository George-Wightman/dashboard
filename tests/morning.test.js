import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { morningId, morningRecord, morningModel, morningDue, morningLine, mealTimeFor, finishMorning, claudeMorningUrl } from '../js/morning.js';
import { closedRecord } from '../js/close.js';
import { mealsOn } from '../js/food.js';
import { closedId } from '../js/close.js';
import { makeStore, clock } from './helpers.js';

// Thursday 12 Nov 2026, 08:10. Yesterday (Wednesday) had two tasks, one ticked, and two meals.
function setup() {
  const now = clock(new Date(2026, 10, 11, 20, 0));
  const store = makeStore({ now });
  const a = store.addItem({ type: 'task', title: 'Wash up', date: '2026-11-11' });
  const b = store.addItem({ type: 'task', title: 'Raise dish rack', date: '2026-11-11' });
  store.toggleDone(a.id, '2026-11-11');
  store.addMeal({ at: new Date(2026, 10, 11, 8, 30), text: '5 eggs, 2 pittas' });
  store.addMeal({ at: new Date(2026, 10, 11, 13, 0), text: 'chicken wrap' });
  now.set(new Date(2026, 10, 12, 8, 10));
  return { now, store, a, b };
}

test('the morning: back unanswered, yesterday open, yesterday\'s meals', () => {
  const { store, b } = setup();
  const m = morningModel(store.doc(), '2026-11-12');
  assert.equal(m.day, '2026-11-12');
  assert.equal(m.yesterday, '2026-11-11');
  assert.equal(m.back, null);
  assert.deepEqual(m.close.tickable.map((r) => r.item.id), [b.id]);
  assert.equal(m.meals.length, 2);
  assert.equal(m.done, null);
  assert.equal(morningDue(store.doc(), '2026-11-12'), true);
});

test('the back is read from today\'s answer, whichever device gave it', () => {
  const { store } = setup();
  store.setBack('2026-11-12', 1);
  assert.deepEqual(morningModel(store.doc(), '2026-11-12').back, { score: 1, word: 'stiff' });
});

test('done once the morning record is there; its line names the misses', () => {
  const { store } = setup();
  store.setBack('2026-11-12', 0);
  store.putCalendar(closedId('2026-11-11'), { day: '2026-11-11', closed: true, at: new Date(2026, 10, 12, 8, 12).toISOString() }, 'me');
  store.putCalendar(morningId('2026-11-12'), { day: '2026-11-12', done: true, at: new Date(2026, 10, 12, 8, 14).toISOString(), skipped: [] }, 'me');
  const doc = store.doc();
  assert.equal(morningId('2026-11-12'), 'morning:2026-11-12');
  assert.ok(morningRecord(doc, '2026-11-12'));
  assert.equal(morningDue(doc, '2026-11-12'), false);
  const line = morningLine(morningModel(doc, '2026-11-12'));
  assert.match(line, /^Morning done at 08:14 · back fine · Wed closed: 1 of \d done · not done: .*Raise dish rack.* · 2 meals logged$/);
});

test('a skipped part is said, not hidden', () => {
  const { store } = setup();
  store.putCalendar(morningId('2026-11-12'), { day: '2026-11-12', done: true, at: new Date(2026, 10, 12, 8, 14).toISOString(), skipped: ['back', 'food'] }, 'me');
  const line = morningLine(morningModel(store.doc(), '2026-11-12'));
  assert.match(line, /back skipped/);
  assert.match(line, /food skipped/);
  assert.match(line, /Wed not closed/);
});

test('an archived morning record does not count', () => {
  const { store } = setup();
  store.putCalendar(morningId('2026-11-12'), { day: '2026-11-12', done: true, at: 'x', skipped: [] }, 'me');
  store.putCalendar(morningId('2026-11-12'), { status: 'archived' }, 'me');
  assert.equal(morningRecord(store.doc(), '2026-11-12'), null);
});

test('a row time goes on the day it belongs to: after midnight is still that day', () => {
  assert.equal(mealTimeFor('2026-11-11', '13:05', 4).getTime(), new Date(2026, 10, 11, 13, 5).getTime());
  assert.equal(mealTimeFor('2026-11-11', '01:30', 4).getTime(), new Date(2026, 10, 12, 1, 30).getTime());
});

test('Done closes yesterday, leaves the note for Claude and says what was skipped', () => {
  const { store } = setup();
  const at = new Date(2026, 10, 12, 8, 14);
  finishMorning(store, { today: '2026-11-12', note: 'slept badly', at, flagState: {}, doing: null });
  const doc = store.doc();
  assert.ok(closedRecord(doc, '2026-11-11'));
  const rec = morningRecord(doc, '2026-11-12');
  assert.deepEqual(rec.skipped, ['back']);
  assert.ok(Object.values(doc.flags).some((f) => /slept badly/.test(f.text) && f.kind === 'claude'));
});

test('Done never reopens a day already closed, and with nothing logged food counts as skipped', () => {
  const now = clock(new Date(2026, 10, 12, 8, 0));
  const store = makeStore({ now });
  store.setBack('2026-11-12', 0);
  store.putCalendar(closedId('2026-11-11'), { day: '2026-11-11', closed: true, at: 'earlier' }, 'me');
  finishMorning(store, { today: '2026-11-12', note: '', at: new Date(2026, 10, 12, 8, 1), flagState: {}, doing: null });
  assert.equal(store.doc().calendar[closedId('2026-11-11')].at, 'earlier');
  assert.deepEqual(morningRecord(store.doc(), '2026-11-12').skipped, ['food']);
});

test('the way out to Claude is a new chat with the morning asked for', () => {
  assert.equal(claudeMorningUrl(), `https://claude.ai/new?q=${encodeURIComponent("/dashboard Start my day with me: back, yesterday's ticks and food.")}`);
});

test('Today leads with the card, holds the back row until the morning is done, and offers Close today in the evening', () => {
  const tl = readFileSync(new URL('../js/ui/timeline.js', import.meta.url), 'utf8');
  assert.match(tl, /const morning = past \? null : renderMorningCard\(ctx\)/);
  assert.match(tl, /past \|\| morningDue\(doc, today\) \? null : renderBackRow\(ctx\)/);
  assert.match(tl, /closeLinkDue\(doc, today, today, new Date\(\)\)/);
  const ui = readFileSync(new URL('../js/ui/morning.js', import.meta.url), 'utf8');
  assert.match(ui, /rowUsuals\(doc, slot, today\)/);
  assert.match(ui, /Your list is kept/);
  assert.doesNotMatch(ui, /micButton|DAY_SPLIT/);
});

test('a day with nothing on it is not reported as closed 0 of 0', () => {
  const now = clock(new Date(2026, 10, 12, 8, 0));
  const store = makeStore({ now });
  finishMorning(store, { today: '2026-11-12', at: new Date(2026, 10, 12, 8, 1), flagState: {} });
  const line = morningLine(morningModel(store.doc(), '2026-11-12'));
  assert.doesNotMatch(line, /0 of 0/);
  assert.match(line, /nothing was on Wed/);
});

