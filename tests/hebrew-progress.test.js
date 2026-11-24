// The planner reading the Hebrew app's sync file itself (planner/hebrew-progress.js), on invented data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readHebrewProgress, readHebrewPhrases, tickHebrew } from '../planner/hebrew-progress.js';
import { makeStore, clock } from './helpers.js';

const gunzip = (b64) => gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
const envelope = (keys) => JSON.stringify({ app: 'hebrew-reader', enc: 'gzip', body: gzipSync(Buffer.from(JSON.stringify({ keys }))).toString('base64') });
const KEYS = {
  hvr_stats: JSON.stringify({
    '2026-09-07': { sec: 600, sessions: 1, bands: { strong: 40 } },
    '2026-09-15': { sec: 1300, sessions: 2, bands: { strong: 46 } },
    notaday: { sec: 5 },
  }),
  hvr_library: JSON.stringify({ מטבח: { tr: 'mitbakh', en: 'kitchen' }, כלב: { tr: 'kelev', en: 'dog' }, חדש: { tr: 'khadash', en: 'new' } }),
  hvr_srs: JSON.stringify({ מטבח: { prod: { n: 3, stab: 8, diff: 4, miss: 0 } }, כלב: { prod: { n: 2, stab: 2, diff: 7, miss: 1 } } }),
  hvr_level: JSON.stringify({ at: 2, lv: {} }),
  hvr_coachlanded: JSON.stringify({ שלום: new Date(2026, 8, 15, 12).getTime(), תודה: new Date(2026, 7, 1).getTime() }),
  // Said to her (the Hebrew app's "I said it"): its words count as said live; an undone day doesn't.
  hvr_irl: JSON.stringify({
    '2026-09-14': { he: 'שלום מטבח', words: ['שלום', 'מטבח'], at: new Date(2026, 8, 14, 21).getTime() },
    '2026-09-15': { off: true, at: new Date(2026, 8, 15, 22).getTime() },
  }),
  hvr_week: JSON.stringify({ week: '2026-09-11', written: 'x', partner: ' Ana ', say: [{ he: 'בוקר טוב', tr: 'boker tov', en: 'good morning' }, { tr: 'no hebrew' }] }),
  hvr_push: JSON.stringify({
    ph1: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'P', auth: 'A', ts: 1 },
    lap: { off: true, ts: 2 },
  }),
};
const serve = (status, text) => {
  const seen = [];
  return { seen, request: (url, init) => { seen.push({ url, init }); return { status, text }; } };
};

test('reads the days, the strong words gained this week and the devices that turned reminders on', () => {
  const gh = serve(200, envelope(KEYS));
  const p = readHebrewProgress({ request: gh.request, token: 'T', gunzip, today: '2026-09-16' });
  assert.equal(p.ok, true);
  assert.deepEqual(p.days, { '2026-09-07': { sec: 600, sessions: 1 }, '2026-09-15': { sec: 1300, sessions: 2 } });
  assert.equal(p.strongGain, 6);
  assert.deepEqual(p.push, [{ id: 'hvr:ph1', endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'P', auth: 'A', label: 'Hebrew app' }]);
  assert.match(gh.seen[0].url, /\/repos\/George-Wightman\/hebrew-reader-sync\/contents\/progress\.json$/);
  assert.equal(gh.seen[0].init.headers.Accept, 'application/vnd.github.raw+json');
  assert.deepEqual(p.words, [{ he: 'מטבח', tr: 'mitbakh', en: 'kitchen', band: 'progressing' }, { he: 'כלב', tr: 'kelev', en: 'dog', band: 'weak' }], 'never-answered words are left out');
  assert.equal(p.level, 2);
  assert.equal(p.liveWeek, 2, 'שלום from the coach, מטבח said to her');
  assert.deepEqual(p.week, { week: '2026-09-11', partner: 'Ana', say: [{ he: 'בוקר טוב', tr: 'boker tov', en: 'good morning' }] });
  assert.deepEqual(p.saidOn, ['2026-09-14'], 'an undone day is not a said day');
});

test("the course phrases come from the Hebrew app's public content, short ones only", () => {
  const text = JSON.stringify({ items: [{ he: 'הרחוב צר', tr: 'harekhov tzar', en: 'the street is narrow', type: 'sentence', lvl: 1 }, { he: 'x', type: 'word' }] });
  assert.deepEqual(readHebrewPhrases({ request: () => ({ status: 200, text }) }), [{ he: 'הרחוב צר', tr: 'harekhov tzar', en: 'the street is narrow', lvl: 1 }]);
  assert.deepEqual(readHebrewPhrases({ request: () => ({ status: 500, text: '' }) }), []);
});

test('a token that cannot see the repo says what to do; a file that is not a sync file says so', () => {
  assert.match(readHebrewProgress({ request: serve(404, '{}').request, token: 'T', gunzip }).error, /HEBREW_TOKEN/);
  assert.match(readHebrewProgress({ request: serve(200, '{"x":1}').request, token: 'T', gunzip }).error, /isn't a sync file/);
  assert.equal(readHebrewProgress({ request: serve(200, '').request, token: null, gunzip }).ok, false);
});

test('no push key yet: no devices, and nothing else breaks', () => {
  const p = readHebrewProgress({ request: serve(200, envelope({ hvr_stats: '{}' })).request, token: 'T', gunzip, today: '2026-09-16' });
  assert.deepEqual([p.ok, p.push, p.days, p.strongGain], [true, [], {}, 0]);
});

test('says which device last wrote the sync file, so the pings can be checked against it', () => {
  const body = JSON.stringify({ app: 'hebrew-reader', enc: 'gzip', device: 'ts4pkg', body: gzipSync(Buffer.from(JSON.stringify({ keys: {} }))).toString('base64') });
  assert.equal(readHebrewProgress({ request: serve(200, body).request, token: 'T', gunzip }).device, 'ts4pkg');
  assert.equal(readHebrewProgress({ request: serve(200, envelope({})).request, token: 'T', gunzip }).device, null);
});

// 24 Nov 2026: the planner ticks the day itself, so a Hebrew session he has done isn't moved or
// removed as missed while the dashboard app stays shut.
test('the planner ticks Hebrew for a day the app shows a session, once, and never over his own', () => {
  const now = clock(new Date(2026, 8, 15, 18, 40));
  const store = makeStore({ now });
  store.addItem({ id: 'hebrew-habit', type: 'habit', title: 'Hebrew practice', area: 'Hebrew', repeat: { kind: 'daily' }, created: '2026-09-01' });
  const progress = { ok: true, days: { '2026-09-15': { sec: 1300, sessions: 2 }, '2026-09-16': { sec: 0, sessions: 0 } } };
  assert.equal(tickHebrew(store, { ok: false, error: 'x' }, '2026-09-15', now()), false);
  assert.equal(tickHebrew(store, progress, '2026-09-16', now()), false);
  assert.equal(tickHebrew(store, progress, '2026-09-15', now()), true);
  const log = store.doc().logs['hebrew:done:2026-09-15'];
  assert.equal(log.kind, 'done');
  assert.equal(log.itemId, 'hebrew-habit');
  assert.equal(log.at, now().toISOString());
  assert.equal(tickHebrew(store, progress, '2026-09-15', now()), false);
});
