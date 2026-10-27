process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncHealth, countedMinutes } from '../planner/health.js';
import { syncHevy } from '../planner/hevy.js';
import { at } from '../planner/time.js';
import { gymStatusLines } from '../js/gym.js';
import { makeStore, clock } from './helpers.js';
import { FakeHevy, HEVY_KEY, hevyWorkout, lift } from './gym-fakes.js';

const WED = '2026-10-21';
const CREDS = { clientId: 'client.apps.googleusercontent.com', clientSecret: 'shh-secret', refreshToken: '1//refresh-token' };

// Google's token endpoint and the exercise list, in memory. The list honours the filter unless
// `refuseFilter`, and pages `pageSize` at a time.
class FakeHealth {
  constructor() { this.points = []; this.calls = []; this.refuseFilter = false; this.tokens = 0; this.grant = 'ok'; }
  add(id, type, day, from, to, extra = {}) {
    this.points.push({
      name: `users/me/dataTypes/exercise/dataPoints/${id}`,
      exercise: { exerciseType: type, interval: { startTime: at(day, from).toISOString(), endTime: at(day, to).toISOString() } },
      dataSource: {}, ...extra,
    });
  }
  remove(id) { this.points = this.points.filter((p) => !p.name.endsWith(`/${id}`)); }
  reply(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }
  fetch = async (url, init = {}) => {
    this.calls.push(url);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      if (this.grant !== 'ok') return this.reply(400, { error: this.grant });
      assert.match(init.body, /refresh_token=1%2F%2Frefresh-token/);
      this.tokens++;
      return this.reply(200, { access_token: `tok${this.tokens}`, expires_in: 3599 });
    }
    if (!/^Bearer tok\d+$/.test(init.headers?.Authorization ?? '')) return this.reply(401, {});
    const u = new URL(url);
    const filter = u.searchParams.get('filter');
    if (filter && this.refuseFilter) return this.reply(400, { error: { message: 'bad filter' } });
    const from = filter ? filter.match(/"(.+)"/)[1] : null;
    const list = this.points.filter((p) => !from || p.exercise.interval.startTime >= new Date(from).toISOString());
    const start = Number(u.searchParams.get('pageToken') ?? 0);
    const page = list.slice(start, start + 25);
    return this.reply(200, { dataPoints: page, ...(start + 25 < list.length ? { nextPageToken: String(start + 25) } : {}) });
  };
}

function setup() {
  const now = clock(at(WED, '20:00'));
  const store = makeStore({ now });
  const target = store.addItem({ type: 'quota', title: 'Cardio', target: 90, unit: 'minutes', created: '2026-10-01' });
  store.putGym('config', { cardioQuota: target.id }, 'claude');
  const health = new FakeHealth();
  let kept = null;
  const cache = { get: () => kept, put: (v) => { kept = v; } };
  const sync = () => syncHealth({ fetch: health.fetch, creds: CREDS, cache, store, now });
  const logs = () => Object.values(store.doc().logs).filter((l) => l.source === 'health' && l.status === 'active');
  return { now, store, target, health, sync, logs };
}

test("a Strava run adds its minutes to the cardio target; walks and strength don't", async () => {
  const { store, target, health, sync, logs } = setup();
  health.add('run1', 'RUNNING', '2026-10-20', '17:00', '17:34');
  health.add('walk1', 'WALKING', '2026-10-20', '12:00', '12:40');
  health.add('lift1', 'STRENGTH_TRAINING', '2026-10-21', '15:40', '16:44');
  const s = await sync();
  assert.equal(s.lastError, null);
  assert.equal(s.startedOn, '2026-10-19');
  assert.equal(s.count, 3);
  const [log] = logs();
  assert.equal(logs().length, 1);
  assert.deepEqual([log.id, log.itemId, log.amount, log.day, log.note], ['health-cardio-run1', target.id, 34, '2026-10-20', 'Run (Google Health)']);
  assert.ok(store.doc().gym['h:walk1']);
});

test('the watch and Strava recording the same run count it once', async () => {
  const { health, sync, logs } = setup();
  health.add('watch', 'RUNNING', '2026-10-20', '17:00', '17:32');
  health.add('strava', 'RUNNING', '2026-10-20', '17:01', '17:34');
  await sync();
  assert.equal(logs().reduce((m, l) => m + l.amount, 0), 34);
});

test("a run already in Hevy isn't counted twice", async () => {
  const { store, health, sync, logs, now } = setup();
  const hevy = new FakeHevy();
  hevy.save(hevyWorkout('hv', '2026-10-20', '17:00', '17:35', [lift('SQ', [60, 5])]), '2026-10-20T17:40:00Z');
  await syncHevy({ fetch: hevy.fetch, key: HEVY_KEY, store, now });
  health.add('run', 'RUNNING', '2026-10-20', '17:02', '17:33');
  health.add('later', 'BIKING', '2026-10-20', '19:00', '19:45');
  await sync();
  assert.deepEqual(logs().map((l) => [l.id, l.amount]), [['health-cardio-later', 45]]);
  assert.deepEqual(countedMinutes(store.doc()), { run: 0, later: 45 });
});

test('last week stays out; a run deleted in Google takes its minutes; a log George removed stays removed', async () => {
  const { store, health, sync, logs, now } = setup();
  health.add('old', 'RUNNING', '2026-10-16', '17:00', '17:30');
  health.add('a', 'RUNNING', '2026-10-19', '07:00', '07:30');
  health.add('b', 'RUNNING', '2026-10-21', '07:00', '07:20');
  await sync();
  assert.deepEqual(logs().map((l) => l.id).sort(), ['health-cardio-a', 'health-cardio-b']);
  health.remove('a');
  store.putLog('health-cardio-b', { status: 'archived' });
  now.advance(60 * 60000);
  await sync();
  assert.deepEqual(logs(), []);
  assert.equal(store.doc().gym['h:a'].status, 'archived');
});

test("a run ticks that day's run task, once, when it happened; a walk doesn't, and a deleted run unticks", async () => {
  const { store, health, sync, now } = setup();
  const easy = store.addItem({ type: 'task', title: 'Easy run', area: 'Health', date: WED, created: '2026-10-19' });
  const long = store.addItem({ type: 'task', title: 'Long run', area: 'Health', date: '2026-10-24', created: '2026-10-19' });
  const email = store.addItem({ type: 'task', title: 'Email the runner', area: 'Admin', date: '2026-10-20', created: '2026-10-19' });
  health.add('walk', 'WALKING', WED, '12:00', '12:40');
  await sync();
  const ticks = () => Object.values(store.doc().logs).filter((l) => l.kind === 'done' && l.status === 'active');
  assert.deepEqual(ticks(), []);
  health.add('run', 'RUNNING', WED, '08:00', '08:13');
  now.advance(60 * 60000);
  await sync();
  assert.deepEqual(ticks().map((l) => [l.id, l.itemId, l.day, l.from, l.at]),
    [['health-done-run', easy.id, WED, at(WED, '08:00').toISOString(), at(WED, '08:13').toISOString()]]);
  assert.ok(!ticks().some((l) => l.itemId === long.id || l.itemId === email.id));
  health.remove('run');
  now.advance(60 * 60000);
  await sync();
  assert.deepEqual(ticks(), []);
});

test('the access token is reused while it lasts; a refused filter is read without one', async () => {
  const { health, sync, logs, now } = setup();
  health.refuseFilter = true;
  health.add('r', 'RUNNING', '2026-10-21', '07:00', '07:30');
  await sync();
  now.advance(30 * 60000);
  await sync();
  assert.equal(health.tokens, 1);
  assert.equal(logs().length, 1);
});

test('a lapsed sign-in is a sentence in the status, with the secrets scrubbed, and the gym read says so', async () => {
  const { store, health } = setup();
  health.grant = 'invalid_grant';
  const s = await syncHealth({ fetch: health.fetch, creds: CREDS, cache: { get: () => null, put() {} }, store,
    now: () => new Date(at(WED, '20:00')), scrub: (t) => t.replaceAll(CREDS.clientSecret, '•••') });
  assert.match(s.lastError, /signed out/);
  const lines = gymStatusLines(store.doc());
  assert.ok(lines.some((l) => l.startsWith('Google Health: last checked never')));
  assert.ok(lines.some((l) => /signed out/.test(l)));
});
