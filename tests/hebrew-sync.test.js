import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncHebrewProgress, ensureHebrewGoal, HEBREW_IDS, HEBREW_LADDER } from '../js/hebrewSync.js';
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

const envelope = (stats, rest = {}) => envelopeOf({
  hvr_stats: JSON.stringify(stats),
  ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, JSON.stringify(v)])),
});

// An in-memory stand-in for the read-only client (js/sync.js's createGitHubClient shape).
function client(doc) {
  return { async get() { return doc ? { doc, sha: 's' } : null; } };
}

const ms = (store, id) => store.doc().milestones[id];
// A node the Hebrew app has stamped as perfected: its coach graduation carries gold.
const goldNodes = (n) => Object.fromEntries(
  Array.from({ length: n }, (_, i) => [`node-${i}`, { 99: { pct: 100, ts: 1, gold: true } }]),
);

test('no file yet: nothing created, nothing applied', async () => {
  const store = makeStore();
  const result = await syncHebrewProgress({ store, client: client(null) });
  assert.deepEqual(result, { ok: true, words: null });
  assert.equal(Object.keys(store.doc().goals).length, 0);
  assert.equal(Object.keys(store.doc().items).length, 0);
});

test('first sync creates the goal, habit and three weekly targets, and applies each day', async () => {
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
  assert.equal(goal.title, 'Hebrew');
  assert.equal(goal.source, 'hebrew');
  assert.equal(doc.items[HEBREW_IDS.habit].goalId, HEBREW_IDS.goal);
  assert.equal(doc.items[HEBREW_IDS.minutes].target, 90);
  assert.equal(doc.items[HEBREW_IDS.minutes].unit, 'minutes');
  assert.equal(doc.items[HEBREW_IDS.spoken].target, 40);
  assert.equal(doc.items[HEBREW_IDS.spoken].unitLabel, 'reps spoken');
  assert.equal(doc.items[HEBREW_IDS.live].target, 15);
  assert.equal(doc.items[HEBREW_IDS.live].unitLabel, 'words live');

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

test('a key that is missing or unreadable reads as empty rather than failing the sync', async () => {
  const store = makeStore();
  const doc = await envelopeOf({ hvr_stats: JSON.stringify({ '2026-09-08': { sec: 60, sessions: 1 } }), hvr_coachlanded: '{ broken' });
  const result = await syncHebrewProgress({ store, client: client(doc) });
  assert.equal(result.ok, true);
  assert.equal(result.live, 0);
  assert.equal(result.days, 1); // the rest of the snapshot still applied
});

test('the ladder is created once, in order, under the Hebrew goal', () => {
  const store = makeStore();
  ensureHebrewGoal(store);
  ensureHebrewGoal(store);
  const list = Object.values(store.doc().milestones).sort((a, b) => a.order - b.order);
  assert.deepEqual(list.map((m) => m.id), HEBREW_LADDER.map((m) => m.id));
  assert.ok(list.every((m) => m.goalId === HEBREW_IDS.goal && !m.done));
  assert.equal(list.at(-1).title, 'Hold a 10-minute conversation in Hebrew');
});

test('the four tracks read the numbers the Hebrew app decided, not the library size', async () => {
  const store = makeStore();
  const stats = {
    '2026-09-08': { sec: 300, sessions: 1, lib: 4000, bands: { strong: 100, progressing: 9, weak: 8, new: 3000 } },
    '2026-09-09': { sec: 300, sessions: 1, lib: 4200, bands: { strong: 180, progressing: 9, weak: 8, new: 3000 } },
  };
  const landed = { a: 1757000000000, b: 1757000000001, c: 1757000000002 };
  const result = await syncHebrewProgress({ store, client: client(await envelope(stats, { hvr_coachlanded: landed, hvr_pathscores: goldNodes(4) })) });
  assert.equal(result.strong, 180); // the latest day that reports bands, not the library's 4200
  assert.equal(result.live, 3);
  assert.equal(result.gold, 4);
  assert.equal(result.days, 2);
  assert.equal(result.words, 4200);
});

test('a node is only gold when the Hebrew app stamped its graduation as such', async () => {
  const store = makeStore();
  const pathscores = {
    'done-one': { 99: { pct: 100, ts: 1, gold: true } },
    'walked-only': { 99: { pct: 70, ts: 1 } }, // graduated, never perfected
    'early-lessons': { 1: { pct: 100, ts: 1 }, 2: { pct: 100, ts: 1 } },
  };
  const doc = await envelope({ '2026-09-08': { sec: 60, sessions: 1 } }, { hvr_pathscores: pathscores });
  const result = await syncHebrewProgress({ store, client: client(doc) });
  assert.equal(result.gold, 1);
});

test('the ladder calibrates once, against the day it first saw real numbers', async () => {
  const store = makeStore();
  const stats = { '2026-09-08': { sec: 300, sessions: 1, bands: { strong: 200 } } };
  const landed = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`w${i}`, 1757000000000]));
  await syncHebrewProgress({ store, client: client(await envelope(stats, { hvr_coachlanded: landed, hvr_pathscores: goldNodes(6) })) });

  // +50 strong on 200, +25 live on 40, +3 gold on 6, +30 days on 1.
  assert.deepEqual(ms(store, 'hebrew-ms-strong-1').auto, { kind: 'strong', n: 250 });
  assert.equal(ms(store, 'hebrew-ms-strong-1').title, 'Hold 250 Hebrew words strong');
  assert.deepEqual(ms(store, 'hebrew-ms-live-1').auto, { kind: 'live', n: 65 });
  assert.equal(ms(store, 'hebrew-ms-live-1').title, 'Say 65 Hebrew words live in conversation');
  assert.deepEqual(ms(store, 'hebrew-ms-gold-1').auto, { kind: 'gold', n: 9 });
  assert.equal(ms(store, 'hebrew-ms-gold-1').title, 'Perfect 9 nodes on the Hebrew path');
  assert.equal(ms(store, 'hebrew-ms-practised-1').title, 'Practise Hebrew on 31 different days');
  assert.deepEqual(store.doc().goals[HEBREW_IDS.goal].hebrewBaseline, { strong: 200, live: 40, gold: 6, days: 1, at: '2026-09-10' });

  // Nothing calibrated can already be passed, on the sync that set it or on any after it.
  assert.ok(Object.values(store.doc().milestones).every((m) => !m.done));
  await syncHebrewProgress({ store, client: client(await envelope(stats, { hvr_coachlanded: landed, hvr_pathscores: goldNodes(6) })) });
  assert.deepEqual(ms(store, 'hebrew-ms-strong-1').auto, { kind: 'strong', n: 250 });
  assert.ok(Object.values(store.doc().milestones).every((m) => !m.done));
});

test('a snapshot with no practice history at all waits rather than calibrating against zero', async () => {
  const store = makeStore();
  await syncHebrewProgress({ store, client: client(await envelope({})) });
  assert.equal(store.doc().goals[HEBREW_IDS.goal].hebrewBaseline, undefined);
  assert.deepEqual(ms(store, 'hebrew-ms-strong-1').auto, { kind: 'strong', add: 50 });
  assert.equal(ms(store, 'hebrew-ms-strong-1').done, false); // no target yet, so nothing to meet

  await syncHebrewProgress({ store, client: client(await envelope({ '2026-09-08': { sec: 60, sessions: 1, bands: { strong: 12 } } })) });
  assert.deepEqual(ms(store, 'hebrew-ms-strong-1').auto, { kind: 'strong', n: 62 });
});

test('a calibrated step ticks when its number is reached; the conversations never do', async () => {
  const store = makeStore();
  const base = { '2026-09-08': { sec: 300, sessions: 1, bands: { strong: 100 } } };
  await syncHebrewProgress({ store, client: client(await envelope(base)) }); // strong-1 becomes 150
  assert.equal(ms(store, 'hebrew-ms-strong-1').done, false);

  const grown = { ...base, '2026-09-09': { sec: 300, sessions: 1, bands: { strong: 150 } } };
  await syncHebrewProgress({ store, client: client(await envelope(grown)) });
  assert.equal(ms(store, 'hebrew-ms-strong-1').done, true);
  assert.equal(ms(store, 'hebrew-ms-strong-2').done, false); // +150 is still a long way off
  assert.equal(ms(store, 'hebrew-ms-talk-hello').done, false);
  assert.equal(ms(store, 'hebrew-ms-talk-10').done, false);
});

test('a ticked step stays ticked when the count falls back, and an archived one is left alone', async () => {
  const store = makeStore();
  const at = { '2026-09-08': { sec: 300, sessions: 1, bands: { strong: 100 } } };
  await syncHebrewProgress({ store, client: client(await envelope(at)) }); // strong-1 = 150
  store.archiveMilestone('hebrew-ms-strong-1');
  await syncHebrewProgress({ store, client: client(await envelope({ ...at, '2026-09-09': { sec: 300, sessions: 1, bands: { strong: 400 } } })) });
  assert.equal(ms(store, 'hebrew-ms-strong-1').done, false); // archived, so never ticked
  assert.equal(ms(store, 'hebrew-ms-strong-2').done, true); // 100 + 150 = 250, reached

  await syncHebrewProgress({ store, client: client(await envelope({ ...at, '2026-09-09': { sec: 300, sessions: 1, bands: { strong: 5 } } })) });
  assert.equal(ms(store, 'hebrew-ms-strong-2').done, true);
});

test('words landed live are logged on the day they were said, in local time', async () => {
  const store = makeStore();
  // Two words landed on the 8th, one on the 9th, read back as whole days where George is.
  const day8 = new Date(2026, 8, 8, 20, 30).getTime();
  const day9 = new Date(2026, 8, 9, 9, 15).getTime();
  const landed = { a: day8, b: day8, c: day9 };
  const stats = { '2026-09-08': { sec: 60, sessions: 1 }, '2026-09-09': { sec: 60, sessions: 1 } };
  await syncHebrewProgress({ store, client: client(await envelope(stats, { hvr_coachlanded: landed })) });
  const logs = Object.values(store.doc().logs).filter((l) => l.itemId === HEBREW_IDS.live);
  assert.deepEqual(logs.map((l) => [l.day, l.amount]).sort(), [['2026-09-08', 2], ['2026-09-09', 1]]);
  assert.equal(weekTotal(store.doc(), HEBREW_IDS.live, '2026-09-10'), 3);
});

test('the library-counting ladders are retired once, and the rest put in order', () => {
  const store = makeStore();
  store.addGoal({ id: HEBREW_IDS.goal, title: 'Hebrew', source: 'hebrew' });
  for (const n of [50, 500, 1000, 3000]) {
    store.addMilestone(HEBREW_IDS.goal, `Know ${n}`, { id: `hebrew-ms-words-${n}`, auto: { kind: 'words', n }, source: 'hebrew' });
  }
  store.addMilestone(HEBREW_IDS.goal, 'Practise on 45 days', { id: 'hebrew-ms-days-45', auto: { kind: 'days', n: 45 }, source: 'hebrew' });
  ensureHebrewGoal(store);
  for (const id of ['hebrew-ms-words-50', 'hebrew-ms-words-500', 'hebrew-ms-words-1000', 'hebrew-ms-words-3000', 'hebrew-ms-days-45']) {
    assert.equal(ms(store, id).status, 'archived');
  }
  const live = Object.values(store.doc().milestones).filter((m) => m.status === 'active').sort((a, b) => a.order - b.order);
  assert.deepEqual(live.map((m) => m.id), HEBREW_LADDER.map((m) => m.id));
  store.updateMilestone('hebrew-ms-words-50', { status: 'active' }); // the user brings one back
  ensureHebrewGoal(store);
  assert.equal(ms(store, 'hebrew-ms-words-50').status, 'active');
});

test('a conversation step ticked by hand survives the move to the new ladder', () => {
  const store = makeStore();
  store.addGoal({ id: HEBREW_IDS.goal, title: 'Hebrew', source: 'hebrew' });
  store.addMilestone(HEBREW_IDS.goal, 'Greet her and introduce myself in Hebrew', { id: 'hebrew-ms-talk-hello', source: 'hebrew' });
  store.updateMilestone('hebrew-ms-talk-hello', { done: true });
  ensureHebrewGoal(store);
  assert.equal(ms(store, 'hebrew-ms-talk-hello').done, true);
  assert.equal(ms(store, 'hebrew-ms-talk-hello').status, 'active');
});

test('an old-titled goal is renamed once; a title you chose is kept', () => {
  const old = makeStore();
  old.addGoal({ id: HEBREW_IDS.goal, title: 'Hold a 10-minute conversation in Hebrew', source: 'hebrew' });
  ensureHebrewGoal(old);
  assert.equal(old.doc().goals[HEBREW_IDS.goal].title, 'Hebrew');
  const mine = makeStore();
  mine.addGoal({ id: HEBREW_IDS.goal, title: 'Speak Hebrew with Sam', source: 'hebrew' });
  ensureHebrewGoal(mine);
  assert.equal(mine.doc().goals[HEBREW_IDS.goal].title, 'Speak Hebrew with Sam');
});
