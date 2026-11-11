import test from 'node:test';
import assert from 'node:assert/strict';
import { closeModel, closeDue, closeLine, closedLine, closedId, closedRecord, CLOSE_FROM_HOUR } from '../js/close.js';
import { dayClosed } from '../js/plan-state.js';
import { makeStore, clock } from './helpers.js';

function setup() {
  const now = clock(new Date(2026, 10, 11, 21, 30));
  const store = makeStore({ now });
  const a = store.addItem({ type: 'task', title: 'Wash up', date: '2026-11-11' });
  const b = store.addItem({ type: 'task', title: 'Raise dish rack', date: '2026-11-11' });
  store.toggleDone(a.id, '2026-11-11');
  return { now, store, a, b };
}

test('closing shows what is open and what is done, and the card comes in the evening', () => {
  const { store, b } = setup();
  const doc = store.doc();
  const m = closeModel(doc, '2026-11-11');
  assert.deepEqual(m.tickable.map((r) => r.item.id), [b.id]);
  assert.equal(m.done, 1);
  assert.ok(m.notDone.includes('Raise dish rack'));
  assert.match(closeLine(m), /^1 of \d done · \d not done · 0 of 3 meals$/);
  assert.equal(CLOSE_FROM_HOUR, 19);
  assert.equal(closeDue(doc, '2026-11-11', '2026-11-11', new Date(2026, 10, 11, 18, 59)), false);
  assert.equal(closeDue(doc, '2026-11-11', '2026-11-11', new Date(2026, 10, 11, 19, 0)), true);
  // A past day not yet closed asks at any hour; a day with nothing on it never does.
  assert.equal(closeDue(doc, '2026-11-11', '2026-11-12', new Date(2026, 10, 12, 9, 0)), true);
});

test('a closed day names what was not done, and the planner sees it as closed', () => {
  const { store } = setup();
  store.putCalendar(closedId('2026-11-11'), { day: '2026-11-11', closed: true, at: new Date(2026, 10, 11, 21, 40).toISOString() }, 'me');
  const doc = store.doc();
  assert.ok(closedRecord(doc, '2026-11-11'));
  assert.equal(dayClosed(doc, '2026-11-11'), true);
  assert.equal(closeDue(doc, '2026-11-11', '2026-11-11', new Date(2026, 10, 11, 22, 0)), false);
  const line = closedLine(closeModel(doc, '2026-11-11'));
  assert.match(line, /^Day closed at 21:40 · 1 of \d done · not done: .*Raise dish rack/);
});
