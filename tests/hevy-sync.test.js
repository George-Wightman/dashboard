process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncHevy } from '../planner/hevy.js';
import { createPlanner } from '../planner/gas.js';
import { at } from '../planner/time.js';
import { workouts, gymStatus } from '../js/gym.js';
import { makeStore, clock, fixture, done } from './helpers.js';
import { FakeHevy, HEVY_KEY, hevyWorkout, lift, cardio } from './gym-fakes.js';
import { FakeCalendar, GYM, ev, step } from './planner-fakes.js';
import { FakeRepo, appsScript } from './planner-apps.js';

const THU = '2026-09-17';

// A store at 20:00 on Thursday 17 Sep, with the Gym habit and a Cardio target.
function setup() {
  const now = clock(at(THU, '20:00'));
  const store = makeStore({ now });
  const gym = store.addItem({ type: 'habit', title: 'Gym', created: '2026-09-01' });
  const target = store.addItem({ type: 'quota', title: 'Cardio', target: 150, unit: 'minutes', created: '2026-09-01' });
  const hevy = new FakeHevy();
  const sync = (extra = {}) => syncHevy({ fetch: hevy.fetch, key: HEVY_KEY, store, now, ...extra });
  return { now, store, gym, target, hevy, sync };
}

test('the first runs copy the whole history, a few pages a run; templates are fetched once', async () => {
  const { store, hevy, sync, now } = setup();
  for (let i = 0; i < 25; i++) hevy.save(hevyWorkout(`h${i}`, `2026-08-${String(i + 1).padStart(2, '0')}`, '18:00', '19:00', [lift('SQ', [80 + i, 5])]), '2026-08-31T10:00:00Z');
  const first = await sync({ pages: 2 });
  assert.equal(first.backfillPage, 3);
  assert.equal(first.lastError, null);
  assert.equal(workouts(store.doc()).length, 20);
  now.advance(10 * 60000);
  const second = await sync({ pages: 2 });
  assert.equal(second.backfillPage, null);
  assert.equal(second.count, 25);
  assert.equal(second.startedOn, '2026-09-14');
  assert.equal(hevy.calls.filter((u) => u.includes('/exercise_templates')).length, 1);
  assert.equal(hevy.calls.filter((u) => u.includes('/workouts?')).length, 3);
});

test("this week's workouts tick Gym and add their cardio minutes; older ones only feed the trends", async () => {
  const { store, gym, target, hevy, sync } = setup();
  store.putGym('config', { cardioQuota: target.id }, 'claude');
  hevy.save(hevyWorkout('old', '2026-09-10', '18:00', '19:00', [lift('SQ', [95, 5]), cardio('WK', 600)]), '2026-09-10T18:00:00Z');
  hevy.save(hevyWorkout('mon', '2026-09-14', '17:40', '18:38', [lift('SQ', [100, 5]), cardio('WK', 900, 1200)]), '2026-09-14T18:00:00Z');
  await sync();
  const logs = store.doc().logs;
  assert.equal(logs['hevy-done-old'], undefined);
  assert.equal(logs['hevy-cardio-old'], undefined);
  const tick = logs['hevy-done-mon'];
  assert.deepEqual([tick.itemId, tick.kind, tick.day, tick.source, tick.status], [gym.id, 'done', '2026-09-14', 'hevy', 'active']);
  assert.deepEqual([tick.from, tick.at], [at('2026-09-14', '17:40').toISOString(), at('2026-09-14', '18:38').toISOString()]);
  const mins = logs['hevy-cardio-mon'];
  assert.deepEqual([mins.itemId, mins.kind, mins.amount, mins.day, mins.note], [target.id, 'amount', 15, '2026-09-14', 'Legs A']);
});

test('edits in Hevy follow; a deleted workout takes its tick and minutes with it', async () => {
  const { store, target, hevy, sync, now } = setup();
  store.putGym('config', { cardioQuota: target.id }, 'claude');
  hevy.save(hevyWorkout('tue', '2026-09-15', '07:00', '07:30', [cardio('TM', 1200, 3000)], 'Run'), '2026-09-15T07:30:00Z');
  await sync({ pages: 5 });
  assert.equal(store.doc().logs['hevy-cardio-tue'].amount, 20);
  now.advance(10 * 60000);
  hevy.save(hevyWorkout('tue', '2026-09-15', '07:00', '07:40', [cardio('TM', 1800, 4500)], 'Run'), now().toISOString());
  now.advance(10 * 60000);
  await sync();
  assert.equal(store.doc().logs['hevy-cardio-tue'].amount, 30);
  assert.equal(store.doc().gym['w:tue'].minutes, 40);
  hevy.remove('tue', now().toISOString());
  now.advance(10 * 60000);
  await sync();
  assert.equal(store.doc().gym['w:tue'].status, 'archived');
  assert.equal(store.doc().logs['hevy-done-tue'].status, 'archived');
  assert.equal(store.doc().logs['hevy-cardio-tue'].status, 'archived');
});

test("a tick George takes off stays off, and a quiet check writes nothing", async () => {
  const { store, gym, hevy, sync, now } = setup();
  hevy.save(hevyWorkout('wed', '2026-09-16', '18:00', '19:00', [lift('BP', [80, 6])], 'Upper A'), '2026-09-16T19:00:00Z');
  await sync();
  store.toggleDone(gym.id, '2026-09-16');
  assert.equal(store.doc().logs['hevy-done-wed'].status, 'archived');
  now.advance(10 * 60000);
  let writes = 0;
  store.subscribe((r) => { if (r === 'local') writes++; });
  await sync();
  assert.equal(store.doc().logs['hevy-done-wed'].status, 'archived', 'not put back');
  assert.equal(writes, 0, 'nothing new within the hour: nothing written, nothing to push');
  now.advance(60 * 60000);
  await sync();
  assert.equal(writes, 1, 'an hour on, the status says it is still checking');
});

test("a workout naming a template the dashboard doesn't know fetches the templates again", async () => {
  const { store, hevy, sync, now } = setup();
  await sync();
  hevy.templates.DL = ['Deadlift (Barbell)', 'weight_reps', 'hamstrings'];
  hevy.save(hevyWorkout('dl', '2026-09-17', '18:00', '19:00', [lift('DL', [140, 3])]), now().toISOString());
  now.advance(10 * 60000);
  await sync();
  assert.equal(store.doc().gym['w:dl'].exercises[0].kind, 'lift');
  assert.equal(hevy.calls.filter((u) => u.includes('/exercise_templates')).length, 2);
});

test("a check that finds nothing new can come back with no list at all: nothing new, not nonsense", async () => {
  const { store, hevy, sync, now } = setup();
  await sync();
  now.advance(10 * 60000);
  const real = hevy.handle.bind(hevy);
  hevy.handle = (url, headers) => (url.includes('/workouts/events') ? { status: 200, body: { page: 1, page_count: 0 } } : real(url, headers));
  const s = await sync();
  assert.equal(s.lastError, null);
  assert.equal(gymStatus(store.doc()).lastError, null);
});

test('a refused key and a reply that makes no sense are kept as sentences', async () => {
  const { store, sync, hevy } = setup();
  const refused = await syncHevy({ fetch: hevy.fetch, key: 'not-the-key', store, now: () => at(THU, '20:00') });
  assert.equal(refused.lastError, "Hevy refused the key — check HEVY_KEY in the planner script's properties");
  assert.equal(gymStatus(store.doc()).lastError, refused.lastError);
  hevy.fail = { status: 200, body: { page: 1, page_count: 1, workouts: 'nope', exercise_templates: [] } };
  const odd = await sync();
  assert.equal(odd.lastError, "Hevy's reply didn't make sense (workouts was string)", 'saying which part');
  hevy.fail = { status: 502, body: {} };
  assert.equal((await sync()).lastError, "Couldn't reach Hevy (it answered 502)");
});

test('the planner run: Hevy first when the key is set, skipped without it, the key never shown', async () => {
  const doc = fixture({ items: [{ id: 'gym', type: 'habit', title: 'Gym', repeat: { kind: 'daily' }, created: '2026-09-01' }] });
  const hevy = new FakeHevy();
  hevy.save(hevyWorkout('thu', THU, '17:00', '18:00', [lift('SQ', [100, 5])]), '2026-09-17T17:00:00Z');
  const route = (url, opts) => hevy.handle(url, opts.headers ?? {});
  const props = { GITHUB_TOKEN: 'ghp_dummy_token', SYNC_REPO: 'o/r' };
  const repo = new FakeRepo(doc);
  const withKey = appsScript({ cal: new FakeCalendar(), repo, gemini: route, props: { ...props, HEVY_KEY }, now: () => at(THU, '19:00') });
  assert.equal(await createPlanner({ ...withKey, version: 't' }).run(), 'ok');
  const saved = repo.doc();
  assert.deepEqual(saved.gym['w:thu'].exercises[0].best, [100, 5]);
  assert.equal(saved.logs['hevy-done-thu'].status, 'active');
  assert.equal(saved.gym.status.lastError, null);
  assert.ok(!repo.text.includes(HEVY_KEY), 'the key is never written to the dashboard');

  hevy.key = 'a-different-key-altogether';
  const refused = new FakeRepo(doc);
  const bad = appsScript({ cal: new FakeCalendar(), repo: refused, gemini: route, props: { ...props, HEVY_KEY }, now: () => at(THU, '19:00') });
  assert.equal(await createPlanner({ ...bad, version: 't' }).run(), 'ok', "Hevy failing doesn't stop the planner");
  assert.match(refused.doc().gym.status.lastError, /Hevy refused the key/);
  assert.ok(bad.lines.some((l) => /^Hevy: Hevy refused the key/.test(l)));
  // While it's failing, Hevy is tried every half hour, not every run.
  let t = at(THU, '19:10');
  const again = appsScript({ cal: new FakeCalendar(), repo: refused, gemini: route, props: { ...props, HEVY_KEY, HEVY_TRIED: String(at(THU, '19:00').getTime()) }, now: () => t });
  const planner = createPlanner({ ...again, version: 't' });
  const before = hevy.calls.length;
  await planner.run();
  assert.equal(hevy.calls.length, before, 'ten minutes after a failure: not asked');
  t = at(THU, '19:31');
  await planner.run();
  assert.ok(hevy.calls.length > before, 'half an hour on: asked again');

  const without = appsScript({ cal: new FakeCalendar(), repo: new FakeRepo(doc), gemini: route, props, now: () => at(THU, '19:00') });
  const calls = hevy.calls.length;
  await createPlanner({ ...without, version: 't' }).run();
  assert.equal(hevy.calls.length, calls, 'no key: Hevy is never asked');
});

test("a Hevy tick moves the Gym block to when he trained", () => {
  const TUE = '2026-09-15';
  const doc = fixture({
    items: [{ id: 'gym', type: 'habit', title: 'Gym', area: 'Health', repeat: { kind: 'daily' }, created: '2026-09-01' }],
    logs: [done('gym', TUE, { source: 'hevy', from: at(TUE, '17:10').toISOString(), at: at(TUE, '18:05').toISOString() })],
  });
  const cal = new FakeCalendar([ev(GYM, 'Gym', TUE, '19:00', '20:00')]);
  step(cal, doc, at(TUE, '20:30'));
  const block = cal.byTitle('Gym');
  assert.deepEqual([block.start.dateTime, block.end.dateTime], [at(TUE, '17:10').toISOString(), at(TUE, '18:05').toISOString()]);
  assert.equal(block.extendedProperties.private.dashState, 'done');
});
