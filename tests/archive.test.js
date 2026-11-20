// The archive's rule (js/archive.js; docs/superpowers/specs/2026-11-20-archive-design.md). Invented
// records only: the repo is public.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHIVE_ID, archiveCut, aboutDay, archiveFiles, covered, slimDoc, coldRecords, yearDoc,
  createArchiveLoader, archiveCache,
} from '../js/archive.js';
import { emptyDoc, isDoc, stableStringify as S } from '../js/doc.js';
import { mergeDocs, sameDoc } from '../js/merge.js';

const T = (day, time = '09:00') => `${day}T${time}:00.000Z`;
const rec = (id, day, extra = {}) => ({ id, status: 'active', source: 'me', created: day, archivedOn: null, updated: T(day), ...extra });
const log = (id, day, extra = {}) => rec(id, day, { itemId: 'h1', goalId: null, kind: 'done', day, ...extra });
const docWith = (maps) => ({ ...emptyDoc(), ...Object.fromEntries(Object.entries(maps).map(([m, list]) => [m, Object.fromEntries(list.map((r) => [r.id, r]))])) });
const SHA1 = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);

test('archiveCut: the Monday of the week less 28 days', () => {
  assert.equal(archiveCut('2026-11-20'), '2026-10-19');
  assert.equal(archiveCut('2026-11-16'), '2026-10-19');
  assert.equal(archiveCut('2026-11-22'), '2026-10-19');
  assert.equal(archiveCut('2026-11-23'), '2026-10-26');
});

test('aboutDay follows the table', () => {
  const D = '2026-09-03';
  const cases = [
    ['items', 'x', { type: 'task', status: 'archived', archivedOn: '2026-09-01', date: D }, '2026-09-01'],
    ['items', 'x', { type: 'task', status: 'dismissed', archivedOn: '2026-09-02', date: D }, '2026-09-02'],
    ['items', 'x', { type: 'task', status: 'active', date: D }, D],
    ['items', 'x', { type: 'habit', status: 'active', repeat: { kind: 'daily' } }, null],
    ['items', 'x', { type: 'quota', status: 'active', target: 3 }, null],
    ['items', 'x', { type: 'task', status: 'suggested', date: D }, null],
    ['goals', 'x', { status: 'archived', archivedOn: D }, D],
    ['goals', 'x', { status: 'active', archivedOn: null }, null],
    ['milestones', 'x', { status: 'dismissed', archivedOn: D }, D],
    ['milestones', 'x', { status: 'active', archivedOn: null }, null],
    ['flags', 'x', { status: 'archived', archivedOn: D }, D],
    ['flags', 'x', { status: 'active', archivedOn: null }, null],
    ['logs', 'x', { day: D }, D],
    ['logs', 'x', { day: 'yesterday' }, null],
    ['journal', 'x', { day: D }, D],
    ['gym', 'w:1', { day: D }, D],
    ['gym', 'h:1', { day: D }, D],
    ['gym', 'back:1', { day: D }, D],
    ['gym', 'config', { day: D }, null],
    ['gym', 'routines', {}, null],
    ['meals', 'meal:1', { kind: 'meal', day: D }, D],
    ['meals', 'usual:shake', { kind: 'usual' }, null],
    ['game', `day:${D}`, { day: D }, D],
    ['game', 'claim:1', { day: D }, null],
    ['calendar', 'hours:1', { day: D }, D],
    ['calendar', 'work:1', { day: D }, D],
    ['calendar', `eu:${D}`, { day: D }, D],
    ['calendar', `commit:${D}`, { day: D }, D],
    ['calendar', `closed:${D}`, { day: D }, D],
    ['calendar', 'count:1', { day: D }, D],
    ['calendar', 'conflict:1', { day: D }, D],
    ['calendar', 'conflict:2', { open: true }, null],
    ['calendar', 'off:1', { start: '2026-09-01', end: D }, D],
    ['calendar', 'off:2', { start: T('2026-09-01'), end: T(D) }, D],
    ['calendar', 'payslip:1', { from: '2026-08-01', to: '2026-08-31' }, '2026-08-31'],
    ['calendar', 'day:1', { day: D }, null],
    ['calendar', 'usage:phone:2026-08-31', { week: '2026-08-31' }, null],
    ['calendar', 'hebrew:status', { day: D }, null],
    ['calendar', 'work-status', { startedOn: D }, null],
    ['changes', 'c1', { at: T(D), day: D }, null],
    ['outcomes', 'o1', { day: D }, null],
  ];
  for (const [map, id, r, want] of cases) assert.equal(aboutDay(map, id, { id, ...r }), want, `${map} ${id} ${JSON.stringify(r)}`);
});

test('archiveFiles reads the active pointer, and only well-formed years and shas', () => {
  const pointer = (extra) => ({ ...emptyDoc(), calendar: { [ARCHIVE_ID]: { id: ARCHIVE_ID, status: 'active', ...extra } } });
  assert.deepEqual(archiveFiles(pointer({ files: { 2026: SHA1, 2025: SHA2, bad: SHA1, 2024: 'nothex' } })), { 2025: SHA2, 2026: SHA1 });
  assert.equal(archiveFiles(pointer({ files: {} })), null);
  assert.equal(archiveFiles(pointer({ files: { 2026: SHA1 }, status: 'dismissed' })), null);
  assert.equal(archiveFiles(emptyDoc()), null);
  assert.equal(archiveFiles(null), null);
});

test('covered: an exact or older copy is, a newer edit or a record the archive lacks is not', () => {
  const archived = log('l1', '2026-09-03', { updated: T('2026-09-05') });
  assert.equal(covered('logs', archived, archived), true);
  assert.equal(covered('logs', { ...archived, updated: T('2026-09-04'), status: 'archived' }, archived), true);
  assert.equal(covered('logs', { ...archived, updated: T('2026-09-06'), status: 'archived' }, archived), false);
  assert.equal(covered('logs', archived, undefined), false);
  assert.equal(covered('logs', undefined, archived), false);
});

test('covered: per-field stamps make no difference when the content is the same', () => {
  const t = T('2026-09-05');
  const plain = rec('x', '2026-09-03', { type: 'task', title: 'A', date: '2026-09-03', updated: t });
  const stamped = { ...plain, _sync: { version: t, fields: { title: t, date: T('2026-09-03') } } };
  assert.equal(covered('items', stamped, plain), true);
  assert.equal(covered('items', plain, stamped), true);
  const edited = { ...plain, title: 'B', updated: T('2026-09-06'), _sync: { version: T('2026-09-06'), fields: { title: T('2026-09-06') } } };
  assert.equal(covered('items', edited, stamped), false);
});

test('covered: two unstamped versions with the same time go by the merge\'s own tie-break', () => {
  const a = rec('x', '2026-09-03', { type: 'task', title: 'A', date: '2026-09-03' });
  const b = { ...a, title: 'B' };
  // pickWinner keeps the larger serialisation: B's.
  assert.equal(covered('items', a, b), true);
  assert.equal(covered('items', b, a), false);
});

test('slimDoc leaves out covered records only, and leaves other maps as they are', () => {
  const a = log('a', '2026-09-01');
  const b = log('b', '2026-09-02');
  const x = rec('x', '2026-09-01', { type: 'habit', title: 'H', repeat: { kind: 'daily' } });
  const doc = docWith({ logs: [a, b], items: [x] });
  const archive = docWith({ logs: [a] });
  const slim = slimDoc(doc, archive);
  assert.deepEqual(Object.keys(slim.logs), ['b']);
  assert.equal(slim.items, doc.items);
  assert.deepEqual(Object.keys(doc.logs), ['a', 'b']);
  assert.equal(slimDoc(doc, null), doc);
});

test('an old full copy merged back after a cut changes nothing', () => {
  const oldA = log('a', '2026-09-01');
  const newA = { ...oldA, status: 'archived', updated: T('2026-09-10') };
  const b = log('b', '2026-11-02');
  const archive = mergeDocs(docWith({ logs: [newA] }), null);
  const full = mergeDocs(docWith({ logs: [newA, b] }), null);
  const slim = slimDoc(full, archive);
  assert.deepEqual(Object.keys(slim.logs), ['b']);
  const oldFull = docWith({ logs: [oldA, b] });
  assert.equal(S(slimDoc(mergeDocs(slim, oldFull), archive)), S(slim));
  assert.equal(S(mergeDocs(full, oldFull)), S(full));
  // An old copy merged into the slim file alone (no archive yet on that client) comes out again too.
  assert.equal(S(slimDoc(mergeDocs(mergeDocs(slim, oldFull), archive), archive)), S(slim));
});

test('the slim file plus the archive is the whole, record for record', () => {
  const recs = [log('a', '2025-12-30'), log('b', '2026-09-01'), log('c', '2026-11-10')];
  const item = rec('t', '2026-09-01', { type: 'task', title: 'Old', date: '2026-09-01', status: 'archived', archivedOn: '2026-09-02' });
  const full = mergeDocs(docWith({ logs: recs, items: [item] }), null);
  const { years } = coldRecords(full, null, '2026-10-19');
  const archive = mergeDocs(yearDoc(years['2025']), yearDoc(years['2026']));
  const slim = slimDoc(full, archive);
  assert.deepEqual(Object.keys(slim.logs), ['c']);
  assert.deepEqual(Object.keys(slim.items), []);
  assert.ok(sameDoc(mergeDocs(slim, archive), full));
});

test('coldRecords picks by the cut and the year, and skips what the archive already covers', () => {
  const l2025 = log('l1', '2025-12-30');
  const covered2026 = log('l2', '2026-10-01');
  const recent = log('l3', '2026-11-10');
  const habit = rec('h1', '2025-01-01', { type: 'habit', title: 'H', repeat: { kind: 'daily' } });
  const old = rec('t1', '2026-09-01', { type: 'task', title: 'T', date: '2026-09-01', status: 'archived', archivedOn: '2026-09-01' });
  const doc = docWith({ logs: [l2025, covered2026, recent], items: [habit, old] });
  const archive = docWith({ logs: [covered2026] });
  const { years, count } = coldRecords(doc, archive, '2026-10-19');
  assert.equal(count, 2);
  assert.deepEqual(Object.keys(years).sort(), ['2025', '2026']);
  assert.deepEqual(Object.keys(years['2025']), ['logs']);
  assert.deepEqual(Object.keys(years['2025'].logs), ['l1']);
  assert.deepEqual(Object.keys(years['2026']), ['items']);
  assert.deepEqual(Object.keys(years['2026'].items), ['t1']);
  assert.equal(coldRecords(doc, archive, '2025-01-01').count, 0);
});

test('yearDoc is an ordinary document', () => {
  const d = yearDoc({ logs: { l1: log('l1', '2026-09-01') } });
  assert.ok(isDoc(d));
  assert.deepEqual(Object.keys(d.logs), ['l1']);
  assert.ok(isDoc(yearDoc({})));
});

// ---- the loader ------------------------------------------------------------------------------

function memoryCache() {
  const map = new Map();
  const cache = archiveCache({
    get: async (k) => map.get(k),
    put: async (k, v) => { map.set(k, v); },
    del: async (k) => { map.delete(k); },
  });
  return { cache, map };
}

const fileText = (logs) => JSON.stringify(yearDoc({ logs: Object.fromEntries(logs.map((l) => [l.id, l])) }));

test('the loader reads each sha once, prefers its cache, and is fresh once per key', async () => {
  const blobs = { [SHA1]: fileText([log('a', '2025-12-30')]), [SHA2]: fileText([log('b', '2026-09-01')]) };
  const reads = [];
  const readBlob = async (sha) => { reads.push(sha); return blobs[sha]; };
  const { cache, map } = memoryCache();
  const loader = createArchiveLoader({ cache });
  const files = { 2025: SHA1, 2026: SHA2 };
  const first = await loader.load(files, readBlob);
  assert.deepEqual(Object.keys(first.doc.logs).sort(), ['a', 'b']);
  assert.equal(first.fresh, true);
  assert.equal(reads.length, 2);
  assert.ok(map.has(`archive:${SHA1}`) && map.has(`archive:${SHA2}`));
  loader.merged(first.key);
  const again = await loader.load(files, readBlob);
  assert.equal(again.fresh, false);
  assert.equal(reads.length, 2);
  // A new page load: a new loader over the same cache downloads nothing, and merges once.
  const next = createArchiveLoader({ cache });
  const third = await next.load(files, readBlob);
  assert.equal(third.fresh, true);
  assert.equal(reads.length, 2);
  // The pointer moves on: only the new sha is read, and the old one leaves the cache.
  const SHA3 = 'c'.repeat(40);
  blobs[SHA3] = fileText([log('b', '2026-09-01'), log('c', '2026-09-02')]);
  const moved = await next.load({ 2025: SHA1, 2026: SHA3 }, readBlob);
  assert.equal(moved.fresh, true);
  assert.deepEqual(reads, [SHA1, SHA2, SHA3]);
  assert.deepEqual(Object.keys(moved.doc.logs).sort(), ['a', 'b', 'c']);
  assert.ok(!map.has(`archive:${SHA2}`));
});

test('the loader throws when a file can\'t be read, isn\'t JSON or isn\'t a document', async () => {
  const loader = createArchiveLoader();
  await assert.rejects(loader.load({ 2026: SHA1 }, async () => { throw new Error('GitHub 500'); }), /GitHub 500/);
  await assert.rejects(loader.load({ 2026: SHA1 }, async () => 'not json'), /archive\/2026\.json/);
  await assert.rejects(loader.load({ 2026: SHA1 }, async () => JSON.stringify({ schema: 2 })), /archive\/2026\.json/);
});

test('a cached copy that is damaged is downloaded again', async () => {
  const { cache, map } = memoryCache();
  map.set(`archive:${SHA1}`, 'garbage');
  const loader = createArchiveLoader({ cache });
  const got = await loader.load({ 2026: SHA1 }, async () => fileText([log('a', '2026-09-01')]));
  assert.deepEqual(Object.keys(got.doc.logs), ['a']);
  assert.notEqual(map.get(`archive:${SHA1}`), 'garbage');
});

test('prime spares a download of a file just written and read back', async () => {
  const loader = createArchiveLoader();
  loader.prime(SHA1, fileText([log('a', '2026-09-01')]));
  const got = await loader.load({ 2026: SHA1 }, async () => { throw new Error('should not download'); });
  assert.deepEqual(Object.keys(got.doc.logs), ['a']);
});

test('archiveCache keeps only the named shas, and fails soft', async () => {
  const { cache, map } = memoryCache();
  await cache.put(SHA1, 'one');
  await cache.put(SHA2, 'two');
  await cache.keep([SHA2]);
  assert.equal(await cache.get(SHA1), undefined);
  assert.equal(await cache.get(SHA2), 'two');
  assert.ok(!map.has(`archive:${SHA1}`));
  const broken = archiveCache({ get: async () => { throw new Error('x'); }, put: async () => { throw new Error('x'); }, del: async () => { throw new Error('x'); } });
  assert.equal(await broken.get(SHA1), undefined);
  await broken.put(SHA1, 'x');
  await broken.keep([SHA1]);
});

test('an archive failure shows in the attention list (⚙ → Claude, and Claude\'s attention read)', async () => {
  const { attention } = await import('../js/attention.js');
  const doc = { ...emptyDoc(), calendar: { [ARCHIVE_ID]: { id: ARCHIVE_ID, status: 'active', files: {}, through: null, lastRun: T('2026-11-16'), lastError: "The archive couldn't be written, so those records stay in data.json (2026: GitHub 500)", moved: 0 } } };
  assert.ok(attention(doc, '2026-11-16').some((l) => /archive couldn't be written/.test(l)));
  doc.calendar[ARCHIVE_ID].lastError = null;
  assert.ok(!attention(doc, '2026-11-16').some((l) => /archive/.test(l)));
});
