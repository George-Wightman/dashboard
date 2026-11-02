import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createPlanner } from '../planner/gas.js';
import { at } from '../planner/time.js';
import { clockLabel } from '../js/calendar.js';
import { fixture, done } from './helpers.js';
import { FakeCalendar } from './planner-fakes.js';
import { FakeRepo, appsScript } from './planner-apps.js';

process.env.TZ = 'Europe/London';

const MON = '2026-09-14';
const TUE = '2026-09-15';
const URL = 'https://script.google.com/macros/s/abc123/exec';
const KEYS = { GITHUB_TOKEN: 'ghp_dummy_token_1234567890', SYNC_REPO: 'o/r' };
const hmacHex = (text, key) => createHmac('sha256', key).update(text).digest('hex');
const span = (e) => `${clockLabel(e.start.dateTime)}–${clockLabel(e.end.dateTime)}`;

function setup({ props = KEYS, logs = [] } = {}) {
  const doc = fixture({ items: [
    { id: 'story', type: 'habit', title: "Maya's storybook", area: 'Maya', minutes: 120, repeat: { kind: 'daily' }, order: 1 },
    { id: 'email', type: 'task', title: 'Email Sarah', area: 'Job search', date: TUE, order: 2 },
  ], logs });
  const cal = new FakeCalendar([]);
  const repo = new FakeRepo(doc);
  let t = at(TUE, '08:00');
  const env = appsScript({ cal, repo, props, now: () => t });
  const planner = createPlanner({ ...env, version: 't', hmacHex, newSecret: () => 'secret' });
  return { cal, repo, planner, setNow: (d) => { t = d; } };
}

const storyBlocks = (cal) => cal.mine().filter((e) => e.summary.includes('storybook'));

// 2 Nov 2026: George dragged the storybook back to the afternoon he'd done it; the planner called the
// day missed, deleted the block and booked another today, over and over.
test('a block dragged to when he did it ticks it for that day and stays there', async () => {
  const { cal, repo, planner, setNow } = setup();
  assert.equal(await planner.run(), 'ok');
  const first = storyBlocks(cal).find((e) => e.start.dateTime.startsWith(TUE));
  cal.move(first.id, MON, '15:00', '17:00');
  setNow(at(TUE, '10:00'));
  assert.equal(await planner.run(), 'ok');
  const log = repo.doc().logs['calendar-done-story-' + MON];
  assert.equal(log.status, 'active');
  assert.equal(log.day, MON);
  assert.equal(log.source, 'calendar');
  const record = storyBlocks(cal).find((e) => e.start.dateTime.startsWith(MON));
  assert.equal(record.summary, "✓ Maya's storybook");
  assert.equal(span(record), '15:00–17:00');
  // Tuesday's own go is still to do, and booked once.
  assert.equal(storyBlocks(cal).filter((e) => e.start.dateTime.startsWith(TUE)).length, 1);
  setNow(at(TUE, '10:10'));
  await planner.run();
  assert.ok(cal.byTitle("✓ Maya's storybook"));
});

test('dragged to a time still to come, it is just a move', async () => {
  const { cal, repo, planner, setNow } = setup();
  await planner.run();
  const first = storyBlocks(cal).find((e) => e.start.dateTime.startsWith(TUE));
  cal.move(first.id, TUE, '16:00', '18:00');
  setNow(at(TUE, '10:00'));
  await planner.run();
  assert.ok(!Object.keys(repo.doc().logs ?? {}).some((id) => id.startsWith('calendar-done-')));
  assert.equal(span(storyBlocks(cal).find((e) => e.start.dateTime.startsWith(TUE))), '16:00–18:00');
});

test('a tick he took off in the app stays off when the block is dragged again', async () => {
  const off = { ...done('story', MON), id: 'calendar-done-story-' + MON, status: 'archived', source: 'calendar' };
  const { cal, repo, planner, setNow } = setup({ logs: [off] });
  await planner.run();
  cal.move(storyBlocks(cal).find((e) => e.start.dateTime.startsWith(TUE)).id, MON, '15:00', '17:00');
  setNow(at(TUE, '10:00'));
  await planner.run();
  assert.equal(repo.doc().logs['calendar-done-story-' + MON].status, 'archived');
});

test('each block carries a signed ✓ link that ticks it in one tap', async () => {
  const { cal, repo, planner } = setup({ props: { ...KEYS, WEB_APP_URL: URL } });
  await planner.run();
  const block = cal.byTitle('Email Sarah');
  const line = block.description.split('\n').find((l) => l.startsWith('✓ Done? Tap: '));
  assert.ok(line, block.description);
  const link = new globalThis.URL(line.slice('✓ Done? Tap: '.length));
  assert.equal(link.origin + link.pathname, URL);
  const parameter = Object.fromEntries(link.searchParams);
  assert.deepEqual({ tick: parameter.tick, day: parameter.day }, { tick: 'email', day: TUE });

  assert.match(await planner.tick({ parameter: { ...parameter, sig: 'f'.repeat(32) } }), /isn't one the planner made/);
  assert.ok(!Object.values(repo.doc().logs ?? {}).some((l) => l.itemId === 'email'));

  assert.match(await planner.tick({ parameter }), /^✓ Ticked "Email Sarah" for Tue 15 Sep/);
  assert.equal(repo.doc().logs['calendar-done-email-' + TUE].status, 'active');
  assert.match(await planner.tick({ parameter }), /already ticked/);
});

test('no web app address: no link, and nothing else changes', async () => {
  const { cal, planner } = setup();
  await planner.run();
  assert.ok(!cal.byTitle('Email Sarah').description.includes('✓'));
});
