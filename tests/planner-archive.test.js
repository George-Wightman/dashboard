// The planner's weekly archive step (planner/archive.js; docs/superpowers/specs/2026-11-20-archive-design.md),
// run through the whole planner against the in-memory GitHub and Calendar. Invented records only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlanner } from '../planner/gas.js';
import { at } from '../planner/time.js';
import { ARCHIVE_ID } from '../js/archive.js';
import { mergeDocs } from '../js/merge.js';
import { fixture } from './helpers.js';
import { FakeCalendar, ev, MAIN } from './planner-fakes.js';
import { FakeRepo, appsScript } from './planner-apps.js';

process.env.TZ = 'Europe/London';

const TUE = '2026-09-15';           // the cut is Monday 14 Sep less 28 days: 17 Aug
const NEXT_TUE = '2026-09-22';      // the cut is 24 Aug
const KEYS = { GITHUB_TOKEN: 'ghp_dummy_token_1234567890', SYNC_REPO: 'o/r' };
const log = (id, day, extra = {}) => ({ id, itemId: 'hebrew', goalId: null, kind: 'done', day, ...extra });

function setup() {
  const doc = fixture({
    items: [
      { id: 'hebrew', type: 'habit', title: 'Practise the piano', area: 'Music', repeat: { kind: 'daily' } },
      { id: 'old', type: 'task', title: 'Post the parcel', area: 'Errands', date: '2026-08-03', status: 'archived', archivedOn: '2026-08-03' },
      { id: 'chase', type: 'task', title: 'Water the plants', area: 'Home', date: TUE, order: 1 },
    ],
    logs: [log('l2025', '2025-12-30'), log('l0801', '2026-08-01'), log('l0820', '2026-08-20'), log('recent', '2026-09-14')],
  });
  const cal = new FakeCalendar([ev(MAIN, 'Dentist', TUE, '09:30', '10:15')]);
  const repo = new FakeRepo(doc);
  let t = at(TUE, '08:00');
  const env = appsScript({ cal, repo, props: KEYS, now: () => t });
  const planner = createPlanner({ ...env, version: 'test1' });
  return { repo, env, planner, original: doc, setNow: (d) => { t = d; } };
}

const pointer = (repo) => repo.doc().calendar[ARCHIVE_ID];
const archived = (repo, year) => repo.file(`archive/${year}.json`);

test('the first run writes a file per year, names each by its sha, and data.json leaves those records out', async () => {
  const { repo, planner } = setup();
  assert.equal(await planner.run(), 'ok');
  const logs = repo.doc().logs;
  assert.ok(!logs.l2025 && !logs.l0801, 'the old ones have left data.json');
  assert.ok(logs.l0820 && logs.recent, 'the recent ones stay');
  assert.ok(!repo.doc().items.old, 'an archived task from before the cut leaves too');
  assert.ok(repo.doc().items.hebrew && repo.doc().items.chase, 'live items stay');
  assert.deepEqual(Object.keys(archived(repo, 2025).logs), ['l2025']);
  assert.deepEqual(Object.keys(archived(repo, 2026).logs), ['l0801']);
  assert.deepEqual(Object.keys(archived(repo, 2026).items), ['old']);
  const p = pointer(repo);
  assert.deepEqual(p.files, { 2025: repo.others.get('archive/2025.json').sha, 2026: repo.others.get('archive/2026.json').sha });
  assert.match(p.files['2026'], /^[0-9a-f]{40}$/);
  assert.equal(p.through, '2026-08-17');
  assert.equal(p.lastError, null);
  assert.equal(p.moved, 3);
});

test('nothing is lost: data.json and the archive together hold every record', async () => {
  const { repo, planner, original } = setup();
  await planner.run();
  const whole = mergeDocs(mergeDocs(repo.doc(), archived(repo, 2025)), archived(repo, 2026));
  for (const map of ['items', 'logs']) {
    for (const [id, r] of Object.entries(original[map])) {
      assert.ok(whole[map][id], `${map} ${id}`);
      for (const key of ['title', 'day', 'date', 'status', 'kind']) assert.deepEqual(whole[map][id][key], r[key], `${map} ${id} ${key}`);
    }
  }
});

test('a second run the same week writes no archive file, and the records stay out', async () => {
  const { repo, planner, setNow } = setup();
  await planner.run();
  const puts = repo.archivePuts;
  setNow(at(TUE, '08:30'));
  assert.equal(await planner.run(), 'ok');
  assert.equal(repo.archivePuts, puts);
  assert.ok(!repo.doc().logs.l0801);
});

test('a failed archive write leaves that year named as it was, and drops nothing of it', async () => {
  const { repo, planner } = setup();
  repo.failPut = new Set(['archive/2026.json']);
  assert.equal(await planner.run(), 'ok');
  const p = pointer(repo);
  assert.deepEqual(Object.keys(p.files), ['2025']);
  assert.match(p.lastError, /archive/);
  assert.notEqual(p.through, '2026-08-17');
  assert.ok(repo.doc().logs.l0801, 'the 2026 record stays in data.json');
  assert.ok(repo.doc().items.old);
  assert.ok(!repo.doc().logs.l2025, 'the year that worked has moved');
});

test('a failed read-back leaves that year named as it was, and drops nothing of it', async () => {
  const { repo, planner } = setup();
  repo.failBlob = new Set(['archive/2026.json']);
  assert.equal(await planner.run(), 'ok');
  const p = pointer(repo);
  assert.deepEqual(Object.keys(p.files), ['2025']);
  assert.match(p.lastError, /archive/);
  assert.ok(repo.doc().logs.l0801);
});

test('after a failure it tries again an hour later, not every run', async () => {
  const { repo, planner, setNow } = setup();
  repo.failPut = new Set(['archive/2026.json']);
  await planner.run();
  repo.failPut = null;
  setNow(at(TUE, '08:20'));
  await planner.run();
  assert.ok(!archived(repo, 2026), 'too soon');
  setNow(at(TUE, '09:10'));
  await planner.run();
  assert.deepEqual(Object.keys(archived(repo, 2026).logs), ['l0801']);
  assert.equal(pointer(repo).lastError, null);
  assert.equal(pointer(repo).through, '2026-08-17');
  assert.ok(!repo.doc().logs.l0801);
});

test('a late edit to an archived record comes back into data.json, and moves again the next week', async () => {
  const { repo, planner, setNow } = setup();
  await planner.run();
  // An undo on George's phone: the archived tick, newer, in data.json.
  const doc = repo.doc();
  doc.logs.l0801 = { ...archived(repo, 2026).logs.l0801, status: 'archived', updated: at(TUE, '08:40').toISOString() };
  repo.text = JSON.stringify(doc);
  repo.sha = 'sha-edit';
  setNow(at(TUE, '08:50'));
  await planner.run();
  assert.equal(repo.doc().logs.l0801?.status, 'archived', 'the edit is not swallowed');
  setNow(at(NEXT_TUE, '08:00'));
  assert.equal(await planner.run(), 'ok');
  assert.ok(!repo.doc().logs.l0801, 'gone again');
  assert.equal(archived(repo, 2026).logs.l0801.status, 'archived', 'and the archive has the edit');
  assert.ok(!repo.doc().logs.l0820, 'the next week\'s cut took the next record');
  assert.equal(pointer(repo).through, '2026-08-24');
});

test('the run stops when a named archive file can\'t be read, and writes nothing', async () => {
  const { repo, planner, setNow } = setup();
  await planner.run();
  const puts = repo.puts;
  const text = repo.text;
  repo.failBlob = new Set(['archive/2025.json']);
  setNow(at(TUE, '08:30'));
  assert.equal(await planner.run(), 'failed');
  assert.equal(repo.puts, puts);
  assert.equal(repo.text, text);
});
