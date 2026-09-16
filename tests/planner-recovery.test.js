import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlanner } from '../planner/gas.js';
import { readProperty, writeProperty } from '../planner/properties.js';
import { FakeCalendar } from './planner-fakes.js';
import { FakeRepo, appsScript } from './planner-apps.js';
import { fixture } from './helpers.js';
import { at } from '../planner/time.js';

process.env.TZ = 'Europe/London';
function setup(n = 1) {
  const doc = fixture({ items: Array.from({ length: n }, (_, i) => ({
    id: `aabbccdd-1111-2222-3333-${String(i).padStart(12, '0')}`, type: 'habit',
    title: `Daily habit ${i}`, area: `Area ${i}`, repeat: { kind: 'daily' },
  })) });
  const cal = new FakeCalendar(), repo = new FakeRepo(doc);
  let now = at('2026-09-16', '08:00');
  const env = appsScript({ cal, repo, props: { GITHUB_TOKEN: 'dummy', SYNC_REPO: 'o/r' }, now: () => now });
  return { cal, repo, env, planner: createPlanner(env), setNow: (t) => { now = t; } };
}

test('35 bookings fit within real Script Property limits and survive another run', async () => {
  const { cal, env, repo, planner } = setup(5);
  assert.equal(await planner.run(), 'ok');
  assert.equal(cal.mine().length, 35);
  assert.equal(repo.puts, 1);
  assert.equal(JSON.parse(env.props.get('DAYS')).chunked, 1);
  assert.equal(Object.values(readProperty(env.PropertiesService.getScriptProperties(), 'DAYS')).flatMap((d) => d.blocks).length, 35);
  assert.equal(await planner.run(), 'ok');
  assert.equal(cal.mine().length, 35);
  assert.equal(repo.puts, 1);
});

test('interrupted chunk writes preserve the last complete generation, including Unicode', () => {
  const { env } = setup();
  const props = env.PropertiesService.getScriptProperties();
  const first = { text: '🙂א'.repeat(4000) }, next = { text: '🙂ב'.repeat(4500) };
  writeProperty(props, 'DAYS', first);
  const set = props.setProperty;
  props.setProperty = (k, v) => { if (k === 'DAYS:b:1') throw new Error('interrupted'); return set(k, v); };
  assert.throws(() => writeProperty(props, 'DAYS', next), /interrupted/);
  assert.deepEqual(readProperty(props, 'DAYS'), first);
  props.setProperty = set;
  writeProperty(props, 'DAYS', next);
  assert.deepEqual(readProperty(props, 'DAYS'), next);
  writeProperty(props, 'DAYS', { small: true });
  assert.deepEqual(readProperty(props, 'DAYS'), { small: true });
});

test('failed deletion prevents replacement, preserves actual state, and recovers next run', async () => {
  const { cal, env, repo, planner, setNow } = setup();
  await planner.run();
  const victim = cal.mine().find((e) => e.extendedProperties.private.dashKey.startsWith('2026-09-18'));
  const remove = env.Calendar.Events.remove;
  env.Calendar.Events.remove = (cid, id) => { if (id === victim.id) throw new Error('delete failed'); return remove(cid, id); };
  setNow(at('2026-09-16', '20:00'));
  assert.equal(await planner.run(), 'partly');
  const key = victim.extendedProperties.private.dashKey;
  assert.equal(cal.mine().filter((e) => e.extendedProperties.private.dashKey === key).length, 1);
  assert.equal(repo.doc().calendar['day:5'].blocks[0].state, 'rough');
  env.Calendar.Events.remove = remove;
  assert.equal(await planner.run(), 'ok');
  assert.equal(cal.mine().filter((e) => e.extendedProperties.private.dashKey === key).length, 1);
  assert.equal(repo.doc().calendar['day:5'].blocks[0].state, 'exact');
});

test('failed inserts are not advertised as bookings and are retried', async () => {
  const { cal, repo, planner } = setup(2);
  cal.fail = 'insert';
  assert.equal(await planner.run(), 'partly');
  assert.equal(repo.doc().calendar['day:3'].blocks.length, 1);
  assert.equal(await planner.run(), 'ok');
  assert.equal(repo.doc().calendar['day:3'].blocks.length, 2);
});

test('duplicate keys from an earlier partial run are reconciled', async () => {
  const { cal, planner } = setup();
  await planner.run();
  const original = cal.mine()[0];
  cal.add({ ...structuredClone(original), id: 'duplicate' });
  assert.equal(cal.mine().length, 8);
  assert.equal(await planner.run(), 'ok');
  assert.equal(cal.mine().length, 7);
  assert.equal(await planner.run(), 'ok');
  assert.equal(cal.mine().length, 7);
});
