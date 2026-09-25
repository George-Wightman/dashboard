// mind.json: the Mind's own file beside data.json — its events, runs, push ledger and budget.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeGitHub } from './helpers.js';
import { ConflictError } from '../js/sync.js';
import {
  emptyMind, isMind, mergeMind, pruneMind, budget, spend, unhandled, saveMind, loadMind,
} from '../js/mind-state.js';

const ev = (id, at, extra = {}) => ({ id, at, kind: 'tick', level: 3, by: 'me', day: at.slice(0, 10), refs: {}, text: id, facts: [], reflex: null, deep: null, ...extra });

test('emptyMind and isMind', () => {
  const m = emptyMind();
  assert.equal(isMind(m), true);
  assert.equal(m.cursor, null);
  assert.equal(isMind({ schema: 2 }), false);
  assert.equal(isMind({ ...m, events: [] }), false);
  assert.equal(isMind(null), false);
});

test('mergeMind: events union, each stamp the later, and the cursor from the side that owns it', () => {
  const a = emptyMind();
  const b = emptyMind();
  a.cursor = { at: 'A' };
  b.cursor = { at: 'B' };
  a.events.x = ev('x', '2026-09-24T18:00:00.000Z', { reflex: '2026-09-24T18:10:00.000Z' });
  b.events.x = ev('x', '2026-09-24T18:00:00.000Z', { deep: '2026-09-24T20:30:00.000Z', artefacts: [{ name: 'd.md', text: 'hi' }] });
  b.events.y = ev('y', '2026-09-24T19:00:00.000Z');
  a.runs.r1 = { id: 'r1', at: '2026-09-24T18:10:00.000Z', engine: 'reflex' };
  b.runs.r2 = { id: 'r2', at: '2026-09-24T20:30:00.000Z', engine: 'deep' };
  a.pushed.k = { at: '2026-09-24T18:11:00.000Z', state: 'failed', tries: 1 };
  b.pushed.k = { at: '2026-09-24T18:21:00.000Z', state: 'sent', tries: 2 };
  a.fired = [{ at: '2026-09-24T18:12:00.000Z', reason: 'ask', events: ['y'] }];
  b.fired = [{ at: '2026-09-24T18:12:00.000Z', reason: 'ask', events: ['y'] }, { at: '2026-09-24T19:12:00.000Z', reason: 'risk', events: [] }];
  const m = mergeMind(a, b);
  assert.deepEqual(Object.keys(m.events).sort(), ['x', 'y']);
  assert.equal(m.events.x.reflex, '2026-09-24T18:10:00.000Z');
  assert.equal(m.events.x.deep, '2026-09-24T20:30:00.000Z');
  assert.equal(m.events.x.artefacts.length, 1, 'the fuller record keeps its artefacts');
  assert.deepEqual(Object.keys(m.runs).sort(), ['r1', 'r2']);
  assert.equal(m.pushed.k.state, 'sent');
  assert.equal(m.fired.length, 2);
  assert.deepEqual(m.cursor, { at: 'A' });
  assert.deepEqual(mergeMind(a, b, { cursorFrom: 'remote' }).cursor, { at: 'B' });
  // Apart from whose cursor it takes, the order doesn't matter.
  const other = mergeMind(b, a, { cursorFrom: 'remote' });
  assert.deepEqual({ ...other, cursor: null }, { ...m, cursor: null });
});

test('mergeMind: the budget is the larger count on the same day, and the later day otherwise', () => {
  const a = emptyMind();
  const b = emptyMind();
  a.budget = { day: '2026-09-24', gemini: 10, messages: 2, pings: 1, deep: 0, lastSaid: '2026-09-24T10:00:00.000Z', geminiBlocked: [], byModel: { flash: 3, lite: 7 } };
  b.budget = { day: '2026-09-24', gemini: 4, messages: 3, pings: 1, deep: 1, lastSaid: '2026-09-24T11:00:00.000Z', geminiBlocked: ['gemini-flash-latest'], byModel: { flash: 4 } };
  assert.deepEqual(mergeMind(a, b).budget, { day: '2026-09-24', gemini: 10, messages: 3, pings: 1, deep: 1, lastSaid: '2026-09-24T11:00:00.000Z', geminiBlocked: ['gemini-flash-latest'], byModel: { flash: 4, lite: 7 } });
  b.budget = { ...b.budget, day: '2026-09-25', gemini: 1 };
  assert.equal(mergeMind(a, b).budget.day, '2026-09-25');
  assert.equal(mergeMind(a, b).budget.gemini, 1);
});

test('budget and spend reset on a new day', () => {
  const m = emptyMind();
  spend(m, '2026-09-24', 'gemini', 3);
  spend(m, '2026-09-24', 'pings');
  assert.equal(budget(m, '2026-09-24').gemini, 3);
  assert.equal(budget(m, '2026-09-24').pings, 1);
  assert.equal(budget(m, '2026-09-25').gemini, 0);
  spend(m, '2026-09-25', 'deep');
  assert.equal(m.budget.day, '2026-09-25');
  assert.equal(m.budget.deep, 1);
  assert.equal(m.budget.gemini, 0);
});

test('unhandled: what an engine has yet to look at, oldest first', () => {
  const m = emptyMind();
  m.events.b = ev('b', '2026-09-24T19:00:00.000Z');
  m.events.a = ev('a', '2026-09-24T18:00:00.000Z', { deep: '2026-09-24T20:00:00.000Z' });
  m.events.c = ev('c', '2026-09-24T17:00:00.000Z', { reflex: '2026-09-24T17:05:00.000Z' });
  assert.deepEqual(unhandled(m, 'reflex').map((e) => e.id), ['a', 'b']);
  assert.deepEqual(unhandled(m, 'deep').map((e) => e.id), ['c', 'b']);
});

test('pruneMind: fourteen days, 300 events, 12,000 characters of artefacts', () => {
  const now = new Date('2026-09-24T12:00:00.000Z');
  const m = emptyMind();
  m.events.old = ev('old', '2026-09-09T11:00:00.000Z');
  m.events.keep = ev('keep', '2026-09-11T13:00:00.000Z', { artefacts: [{ name: 'a', text: 'x'.repeat(10000) }, { name: 'b', text: 'y'.repeat(5000) }] });
  m.runs.old = { id: 'old', at: '2026-09-09T11:00:00.000Z' };
  m.runs.new = { id: 'new', at: '2026-09-24T11:00:00.000Z' };
  m.pushed.old = { at: '2026-09-01T11:00:00.000Z', state: 'sent' };
  m.fired = [{ at: '2026-09-21T11:00:00.000Z' }, { at: '2026-09-24T11:00:00.000Z' }];
  pruneMind(m, now);
  assert.deepEqual(Object.keys(m.events), ['keep']);
  assert.equal(m.events.keep.artefacts.map((f) => f.text).join('').length, 12000);
  assert.deepEqual(Object.keys(m.runs), ['new']);
  assert.deepEqual(m.pushed, {});
  assert.equal(m.fired.length, 1);
  for (let i = 0; i < 305; i++) {
    const at = new Date(now.getTime() - i * 60000).toISOString();
    m.events[`e${i}`] = ev(`e${i}`, at);
  }
  pruneMind(m, now);
  assert.equal(Object.keys(m.events).length, 300);
  assert.ok(m.events.e0 && !m.events.keep, 'the newest are kept');
});

test('saveMind: merges with what is there, retries a conflict, skips an unchanged file', async () => {
  const gh = new FakeGitHub();
  const mine = emptyMind();
  mine.cursor = { at: 'planner' };
  mine.events.a = ev('a', '2026-09-24T18:00:00.000Z');
  let r = await saveMind({ client: gh, mind: mine });
  assert.equal(r.ok, true);
  assert.equal(gh.puts, 1);
  r = await saveMind({ client: gh, mind: mine });
  assert.equal(gh.puts, 1, 'nothing new, nothing written');
  // Another writer lands between the read and the write.
  const theirs = emptyMind();
  theirs.events.b = ev('b', '2026-09-24T19:00:00.000Z');
  let raced = false;
  const racing = {
    get: () => gh.get(),
    put: async (doc, sha) => {
      if (!raced) { raced = true; await gh.put(mergeMind((await gh.get()).doc, theirs), (await gh.get()).sha); throw new ConflictError('GitHub 409'); }
      return gh.put(doc, sha);
    },
  };
  mine.events.c = ev('c', '2026-09-24T20:00:00.000Z');
  r = await saveMind({ client: racing, mind: mine });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(gh.file.doc.events).sort(), ['a', 'b', 'c']);
  assert.deepEqual(gh.file.doc.cursor, { at: 'planner' });
});

test('loadMind: missing is empty, garbage is empty with a problem, a failed read says so', async () => {
  const gh = new FakeGitHub();
  let r = await loadMind(gh);
  assert.deepEqual(r.mind, emptyMind());
  assert.equal(r.problem, null);
  gh.file = { doc: { schema: 7 }, sha: 's' };
  r = await loadMind(gh);
  assert.deepEqual(r.mind, emptyMind());
  assert.match(r.problem, /mind\.json/);
  r = await loadMind({ get: async () => { throw new Error('GitHub sync timed out — will retry'); } });
  assert.equal(r.failed, true);
  assert.match(r.problem, /timed out/);
});
