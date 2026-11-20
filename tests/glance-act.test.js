// What a phone widget may change (planner/glance.js, applyGlanceAct), on an invented day.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGlanceAct, ACT_HEBREW_DAY_MAX } from '../planner/glance.js';
import { tickLogId } from '../planner/ticks.js';
import { HEBREW_IDS, ensureHebrewGoal } from '../js/hebrewSync.js';
import { makeStore } from './helpers.js';

const TODAY = '2026-11-20';
const NOW = new Date('2026-11-20T15:00:00Z');

// The items get the store's own ids: shelf, gym, then the Hebrew goal's records.
function store() {
  const s = makeStore();
  const shelf = s.addItem({ type: 'task', title: 'Fix the shelf', date: TODAY });
  const gym = s.addItem({ type: 'habit', title: 'Gym', repeat: { kind: 'daily' } });
  ensureHebrewGoal(s);
  s.ids = { shelf: shelf.id, gym: gym.id };
  return s;
}
const ticks = (s, id) => Object.values(s.doc().logs).filter((l) => l.itemId === id && l.kind === 'done' && l.status === 'active');

test('a row ticks its task or habit for today, once, marked as from the widget', () => {
  const s = store();
  assert.deepEqual(applyGlanceAct(s, { kind: 'tick', item: s.ids.shelf }, { today: TODAY, now: NOW }), { ok: true, text: '✓ Fix the shelf' });
  const [log] = ticks(s, s.ids.shelf);
  assert.deepEqual([log.id, log.day, log.source, log.at], [tickLogId(s.ids.shelf, TODAY), TODAY, 'widget', NOW.toISOString()]);
  assert.deepEqual(applyGlanceAct(s, { kind: 'tick', item: s.ids.shelf }, { today: TODAY, now: NOW }), { ok: true, text: '"Fix the shelf" is already ticked.' });
  assert.equal(ticks(s, s.ids.shelf).length, 1, 'a double tap is one tick');
  assert.equal(applyGlanceAct(s, { kind: 'tick', item: s.ids.gym }, { today: TODAY, now: NOW }).ok, true, 'a habit too');
});

test('nothing that is gone, and an untick in the dashboard stands', () => {
  const s = store();
  assert.equal(applyGlanceAct(s, { kind: 'tick', item: 'nope' }, { today: TODAY, now: NOW }).ok, false);
  applyGlanceAct(s, { kind: 'tick', item: s.ids.shelf }, { today: TODAY, now: NOW });
  s.toggleDone(s.ids.shelf, TODAY);
  const again = applyGlanceAct(s, { kind: 'tick', item: s.ids.shelf }, { today: TODAY, now: NOW });
  assert.equal(again.ok, false);
  assert.match(again.text, /unticked in the dashboard/);
  assert.equal(ticks(s, s.ids.shelf).length, 0);
});

test('Hebrew minutes add up in one log for the day, with a ceiling', () => {
  const s = store();
  assert.deepEqual(applyGlanceAct(s, { kind: 'hebrew', minutes: 15 }, { today: TODAY, now: NOW }), { ok: true, text: '+15 min of Hebrew' });
  applyGlanceAct(s, { kind: 'hebrew', minutes: 15 }, { today: TODAY, now: NOW });
  const log = s.doc().logs[`hebrew:widget:${TODAY}`];
  assert.deepEqual([log.itemId, log.kind, log.amount, log.day, log.source], [HEBREW_IDS.minutes, 'amount', 30, TODAY, 'widget']);
  for (let i = 0; i < 20; i++) applyGlanceAct(s, { kind: 'hebrew', minutes: 15 }, { today: TODAY, now: NOW });
  assert.equal(s.doc().logs[`hebrew:widget:${TODAY}`].amount, ACT_HEBREW_DAY_MAX);
  assert.equal(applyGlanceAct(s, { kind: 'hebrew', minutes: 15 }, { today: TODAY, now: NOW }).ok, false);
  assert.equal(applyGlanceAct(s, { kind: 'hebrew', minutes: 500 }, { today: TODAY, now: NOW }).ok, false);
  assert.equal(applyGlanceAct(s, { kind: 'delete everything' }, { today: TODAY, now: NOW }).ok, false, 'nothing else');
});
