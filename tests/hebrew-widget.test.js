import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syncHebrewProgress, hebrewSummary, ensureHebrewGoal, HEBREW_IDS, RECENT_DAYS } from '../js/hebrewSync.js';
import { hebrewWeek, weekAccuracy, nextRung, shade } from '../js/ui/hebrew.js';
import { weekTargets } from '../js/ui/side.js';
import { attention } from '../js/attention.js';
import { makeStore } from './helpers.js';

// makeStore's clock is Thursday 10 September 2026; the week began on Monday the 7th.
const TODAY = '2026-09-10';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

async function envelopeOf(keys) {
  const inner = JSON.stringify({ keys: Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, JSON.stringify(v)])) });
  const stream = new Blob([new TextEncoder().encode(inner)]).stream().pipeThrough(new CompressionStream('gzip'));
  return { enc: 'gzip', body: Buffer.from(await new Response(stream).arrayBuffer()).toString('base64') };
}
const client = (doc) => ({ async get() { return { doc, sha: 's' }; } });
const at = (d, h = 12) => new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8)), h).getTime();

const STATS = {
  '2026-08-01': { sec: 900, sessions: 2, spoken: 10, spokenOk: 5, bands: { strong: 1, progressing: 1, weak: 1, new: 1 } },
  '2026-09-07': { sec: 600, sessions: 2, spoken: 20, spokenOk: 15, cards: 30, clean: 25, bands: { strong: 70, progressing: 15, weak: 40, new: 100 } },
  '2026-09-08': { sec: 0, sessions: 0 },
  '2026-09-09': { sec: 1200.4, sessions: 3, spoken: 20, spokenOk: 19, hints: 2, bands: { strong: 79, progressing: 17, weak: 42, new: 103, extra: 9 } },
};
const LANDED = { שלום: at('2026-09-09', 20), תודה: at('2026-09-09', 21), בוקר: at('2026-09-01'), 'not-a-time': 'x' };

test('hebrewSummary: the ladder numbers, the latest bands, two weeks of days and the latest words said live', () => {
  const s = hebrewSummary({ stats: STATS, landed: LANDED }, { strong: 79, live: 3, gold: 2, days: 3 }, TODAY);
  assert.deepEqual(s, {
    strong: 79, live: 3, gold: 2, days: 3,
    bands: { strong: 79, progressing: 17, weak: 42, new: 103 },
    // only days with a session, and only the last RECENT_DAYS
    daily: {
      '2026-09-07': { sec: 600, spoken: 20, spokenOk: 15, cards: 30, clean: 25 },
      '2026-09-09': { sec: 1200, spoken: 20, spokenOk: 19 },
    },
    recent: [{ word: 'תודה', day: '2026-09-09' }, { word: 'שלום', day: '2026-09-09' }, { word: 'בוקר', day: '2026-09-01' }],
  });
  assert.equal(RECENT_DAYS, 14);
  assert.deepEqual(hebrewSummary({ stats: {}, landed: {} }, { strong: 0, live: 0, gold: 0, days: 0 }, TODAY),
    { strong: 0, live: 0, gold: 0, days: 0, bands: null, daily: {}, recent: [] });
});

test('a sync keeps the summary on the goal, and a sync that finds nothing new writes nothing', async () => {
  const store = makeStore();
  const doc = await envelopeOf({ hvr_stats: STATS, hvr_coachlanded: LANDED });
  await syncHebrewProgress({ store, client: client(doc) });
  const now = store.doc().goals[HEBREW_IDS.goal].hebrewNow;
  assert.deepEqual(now.bands, { strong: 79, progressing: 17, weak: 42, new: 103 });
  assert.equal(now.live, 4); // the app's ledger, as the ladder counts it: every word in it
  const updated = store.doc().goals[HEBREW_IDS.goal].updated;
  await syncHebrewProgress({ store, client: client(doc) });
  assert.equal(store.doc().goals[HEBREW_IDS.goal].updated, updated);
});

test('the widget: the week by minutes, the share said right, and the next rung with how far along', async () => {
  const store = makeStore();
  await syncHebrewProgress({ store, client: client(await envelopeOf({ hvr_stats: STATS, hvr_coachlanded: LANDED })) });
  const doc = store.doc();
  assert.deepEqual(hebrewWeek(doc, TODAY).map((c) => [c.day.slice(8), Math.round(c.minutes), c.today, c.future]), [
    ['07', 10, false, false], ['08', 0, false, false], ['09', 20, false, false], ['10', 0, true, false],
    ['11', 0, false, true], ['12', 0, false, true], ['13', 0, false, true],
  ]);
  assert.deepEqual([0, 3, 10, 20, 45].map(shade), [0, 1, 2, 3, 4]);
  // 34 of the 40 reps this week were right; the August day is last week's business
  assert.equal(weekAccuracy(doc.goals[HEBREW_IDS.goal].hebrewNow, TODAY), 85);
  assert.equal(weekAccuracy(null, TODAY), null);
  // The first rung is a conversation: only he can tick it.
  assert.deepEqual(nextRung(doc), { title: 'Greet her and introduce myself in Hebrew', have: null, n: null, byHand: true });
  store.toggleMilestone('hebrew-ms-talk-hello');
  // The next counts words said live: calibrated at 4 + 25 the day it first saw numbers.
  assert.deepEqual(nextRung(store.doc()), { title: 'Say 29 Hebrew words live in conversation', have: 4, n: 29, byHand: false });
});

test('This week shows only the targets no other widget does, and none that are paused', () => {
  const store = makeStore();
  ensureHebrewGoal(store);
  const apps = store.addItem({ type: 'quota', title: 'Applications', target: 1, area: 'Job search' });
  const cardio = store.addItem({ type: 'quota', title: 'Cardio', target: 60, unit: 'minutes', area: 'Health' });
  store.putGym('config', { cardioQuota: cardio.id });
  const ids = (hidden) => weekTargets(store.doc(), TODAY, hidden).map((q) => q.title);
  const hebrew = ['Hebrew learning time', 'Hebrew speaking practice', 'Hebrew words said live'];
  // Hebrew shows its own; Gym has no workouts yet, so Cardio stays here
  assert.deepEqual(ids([]), ['Applications', 'Cardio']);
  store.putGym('w:1', { day: TODAY, start: `${TODAY}T08:00:00.000Z`, end: `${TODAY}T09:00:00.000Z`, title: 'Upper A', exercises: [] });
  assert.deepEqual(ids([]), ['Applications']);
  // a hidden widget sends its targets back here
  assert.deepEqual(ids(['gym', 'hebrew']), [...hebrew, 'Applications', 'Cardio']);
  // time off for Job search pauses Applications: not shown, and not "behind" either
  assert.ok(attention(store.doc(), TODAY).some((l) => l.startsWith('"Applications" is behind')));
  store.putCalendar('off:2026-09-08', { start: '2026-09-08', end: '2026-10-06', areas: ['Job search'], reason: 'AC prep' });
  assert.deepEqual(ids([]), []);
  assert.ok(!attention(store.doc(), TODAY).some((l) => l.includes('Applications')));
  assert.ok(apps);
});

test('the panel is wired in: registered, offline-shelled, and styled from the palette', () => {
  assert.match(read('js/ui/widgets.js'), /\{ id: 'hebrew', title: 'Hebrew', render: renderHebrew, big: renderHebrewBig \}/);
  assert.match(read('sw.js'), /'js\/ui\/hebrew\.js'/);
  const css = read('styles.css');
  for (const sel of ['.heb-week', '.heb-cell.lvl4', '.heb-stats', '.heb-band-bar', '.band.strong', '.heb-said']) assert.ok(css.includes(sel), sel);
  // the words said live are Hebrew, right to left
  assert.match(read('js/ui/hebrew.js'), /lang: 'he', dir: 'rtl'/);
});
