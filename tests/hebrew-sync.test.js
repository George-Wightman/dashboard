import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncHebrewProgress, ensureHebrewGoal, HEBREW_IDS } from '../js/hebrewSync.js';
import { weekTotal } from '../js/schedule.js';
import { makeStore, clock } from './helpers.js';

// A fake of the Hebrew app's own sync file: gzip+base64 of { keys: { hvr_stats: '<json>' } }, the
// same envelope shape js/hebrewSync.js reads from the real repo.
async function envelopeOf(keys) {
  const inner = JSON.stringify({ keys });
  const stream = new Blob([new TextEncoder().encode(inner)]).stream().pipeThrough(new CompressionStream('gzip'));
  const body = Buffer.from(await new Response(stream).arrayBuffer()).toString('base64');
  return { enc: 'gzip', body };
}

const envelope = (stats) => envelopeOf({ hvr_stats: JSON.stringify(stats) });

// An in-memory stand-in for the read-only client (js/sync.js's createGitHubClient shape).
function client(doc) {
  return { async get() { return doc ? { doc, sha: 's' } : null; } };
}

test('no file yet: nothing created, nothing applied', async () => {
  const store = makeStore();
  const result = await syncHebrewProgress({ store, client: client(null) });
  assert.deepEqual(result, { ok: true, words: null });
  assert.equal(Object.keys(store.doc().goals).length, 0);
  assert.equal(Object.keys(store.doc().items).length, 0);
});

test('first sync creates the goal, habit and two weekly targets, and applies each day', async () => {
  const store = makeStore();
  const stats = {
    '2026-09-08': { sec: 600, sessions: 3, spoken: 10, lib: 500 },
    '2026-09-09': { sec: 300, sessions: 1, spoken: 4, lib: 520 },
  };
  const result = await syncHebrewProgress({ store, client: client(await envelope(stats)) });
  assert.equal(result.ok, true);
  assert.equal(result.words, 520);

  const doc = store.doc();
  const goal = doc.goals[HEBREW_IDS.goal];
  assert.equal(goal.title, 'Hold a 10-minute conversation in Hebrew');
  assert.equal(goal.source, 'hebrew');
  assert.equal(doc.items[HEBREW_IDS.habit].goalId, HEBREW_IDS.goal);
  assert.equal(doc.items[HEBREW_IDS.minutes].target, 90);
  assert.equal(doc.items[HEBREW_IDS.minutes].unit, 'minutes');
  assert.equal(doc.items[HEBREW_IDS.spoken].target, 40);
  assert.equal(doc.items[HEBREW_IDS.spoken].unitLabel, 'reps spoken');

  assert.equal(weekTotal(doc, HEBREW_IDS.minutes, '2026-09-10'), 15); // 600s + 300s = 15 minutes
  assert.equal(weekTotal(doc, HEBREW_IDS.spoken, '2026-09-10'), 14);
  const doneDays = Object.values(doc.logs).filter((l) => l.itemId === HEBREW_IDS.habit && l.kind === 'done').map((l) => l.day).sort();
  assert.deepEqual(doneDays, ['2026-09-08', '2026-09-09']);
});

test('re-syncing the same numbers does not duplicate or touch existing logs', async () => {
  const store = makeStore();
  const stats = { '2026-09-08': { sec: 600, sessions: 2, spoken: 5, lib: 500 } };
  await syncHebrewProgress({ store, client: client(await envelope(stats)) });
  const before = JSON.stringify(store.doc().logs);
  await syncHebrewProgress({ store, client: client(await envelope(stats)) });
  assert.equal(JSON.stringify(store.doc().logs), before);
});

test("a day's total rising later just overwrites the same log, not a second one", async () => {
  const store = makeStore();
  await syncHebrewProgress({ store, client: client(await envelope({ '2026-09-08': { sec: 300, sessions: 1, spoken: 2 } })) });
  await syncHebrewProgress({ store, client: client(await envelope({ '2026-09-08': { sec: 900, sessions: 2, spoken: 6 } })) });
  const doc = store.doc();
  const minuteLogs = Object.values(doc.logs).filter((l) => l.itemId === HEBREW_IDS.minutes);
  assert.equal(minuteLogs.length, 1);
  assert.equal(minuteLogs[0].amount, 15);
  assert.equal(weekTotal(doc, HEBREW_IDS.spoken, '2026-09-10'), 6);
});

test('ensureHebrewGoal never resets a record the user has since edited', async () => {
  const store = makeStore();
  ensureHebrewGoal(store);
  store.updateItem(HEBREW_IDS.minutes, { target: 200, title: 'My Hebrew time' });
  ensureHebrewGoal(store);
  const item = store.doc().items[HEBREW_IDS.minutes];
  assert.equal(item.target, 200);
  assert.equal(item.title, 'My Hebrew time');
});

test('an archived target is left alone: its sibling still gets logged', async () => {
  const store = makeStore();
  ensureHebrewGoal(store);
  store.archiveItem(HEBREW_IDS.minutes);
  await syncHebrewProgress({ store, client: client(await envelope({ '2026-09-08': { sec: 600, sessions: 1, spoken: 3 } })) });
  const doc = store.doc();
  assert.equal(Object.values(doc.logs).some((l) => l.itemId === HEBREW_IDS.minutes), false);
  assert.equal(weekTotal(doc, HEBREW_IDS.spoken, '2026-09-10'), 3);
});

test('a day beyond today is never applied', async () => {
  const store = makeStore(); // clock() starts 2026-09-10
  await syncHebrewProgress({ store, client: client(await envelope({ '2026-09-30': { sec: 600, sessions: 1, spoken: 3 } })) });
  assert.equal(Object.keys(store.doc().logs).length, 0);
});

test('a short burst under a minute still logs a positive amount, never zero', async () => {
  const store = makeStore();
  await syncHebrewProgress({ store, client: client(await envelope({ '2026-09-08': { sec: 15, sessions: 1, spoken: 0 } })) });
  const log = Object.values(store.doc().logs).find((l) => l.itemId === HEBREW_IDS.minutes);
  assert.ok(log.amount > 0);
});

test('a file that is not the Hebrew app\'s gzip envelope is refused, not applied', async () => {
  const store = makeStore();
  const result = await syncHebrewProgress({ store, client: client({ some: 'other shape' }) });
  assert.equal(result.ok, false);
  assert.match(result.error, /Not a Hebrew app sync file/);
  assert.equal(Object.keys(store.doc().goals).length, 0);
});

test('a read failure is reported and never throws', async () => {
  const store = makeStore();
  const result = await syncHebrewProgress({ store, client: { async get() { throw new Error('offline'); } } });
  assert.deepEqual(result, { ok: false, error: 'offline' });
});

test('missing hvr_stats key (a brand new Hebrew app) applies nothing, still reports ok', async () => {
  const store = makeStore();
  const result = await syncHebrewProgress({ store, client: client(await envelopeOf({ hvr_level: '{}' })) });
  assert.equal(result.ok, true);
  assert.equal(result.words, null);
  assert.ok(store.doc().goals[HEBREW_IDS.goal]); // still connects the goal, ready for real data later
});
