import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDoc, stableStringify, emptyDoc } from '../js/doc.js';
import { DATA_KEY, BACKUP_KEY, CORRUPT_KEY } from '../js/data.js';
import { mergeDocs } from '../js/merge.js';
import { createGitHubClient, createSyncScheduler, syncOnce, mergeStoredEvents } from '../js/sync.js';
import { makeStore, MemoryStorage, FakeGitHub, clock } from './helpers.js';
import { editedFields } from '../js/ui/edit.js';

function copies() {
  const now = clock();
  const a = makeStore({ now, prefix: 'a' });
  const item = a.addItem({ type: 'task', title: 'Original' });
  const b = makeStore({ now, prefix: 'b', storage: new MemoryStorage({ [DATA_KEY]: a.exportJson() }) });
  return { a, b, item, now };
}

test('concurrent rename and reschedule both survive sync through GitHub', async () => {
  const { a, b, item, now } = copies();
  now.advance(60000); a.updateItem(item.id, { title: 'Renamed' });
  now.advance(60000); b.updateItem(item.id, { date: '2026-09-11' });
  const repo = new FakeGitHub();
  await syncOnce({ store: a, client: repo }); await syncOnce({ store: b, client: repo }); await syncOnce({ store: a, client: repo });
  assert.equal(a.doc().items[item.id].title, 'Renamed');
  assert.equal(a.doc().items[item.id].date, '2026-09-11');
  assert.deepEqual(a.doc(), b.doc());
});

test('field merges are associative, commutative, and idempotent across three concurrent writers', () => {
  const { a, b, item, now } = copies();
  const c = makeStore({ now, storage: new MemoryStorage({ [DATA_KEY]: a.exportJson() }) });
  a.updateItem(item.id, { title: 'A', notes: 'one' });
  b.updateItem(item.id, { title: 'B', date: '2026-09-11' });
  c.updateItem(item.id, { priority: true, notes: 'two' });
  const docs = [a.doc(), b.doc(), c.doc()];
  const expected = stableStringify(mergeDocs(mergeDocs(...docs.slice(0, 2)), docs[2]));
  for (const x of docs) for (const y of docs) {
    assert.equal(stableStringify(mergeDocs(x, y)), stableStringify(mergeDocs(y, x)));
    assert.equal(stableStringify(mergeDocs(mergeDocs(x, y), y)), stableStringify(mergeDocs(x, y)));
  }
  for (const order of [[0, 1, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    assert.equal(stableStringify(mergeDocs(docs[order[0]], mergeDocs(docs[order[1]], docs[order[2]]))), expected);
  }
});

test('an edit after observing a fast clock wins, including edits in one millisecond', () => {
  const { a, item, now } = copies();
  now.advance(3600000); a.updateItem(item.id, { title: 'Fast clock' });
  const before = structuredClone(a.doc());
  now.advance(-3600000); a.updateItem(item.id, { title: 'Deliberate newer edit' });
  assert.equal(mergeDocs(a.doc(), before).items[item.id].title, 'Deliberate newer edit');
});

test('concurrent conversation appends survive, removals stay removed, and pruning clears retained text', () => {
  const { a, b, now } = copies();
  const fields = { kind: 'talk', day: a.today(), slot: 'morning' };
  const first = { who: 'coach', text: 'Hello', at: now().toISOString() };
  a.saveJournal({ ...fields, messages: [first] }); b.importJson(a.exportJson());
  const one = { who: 'george', text: 'Laptop', at: now().toISOString() };
  const two = { who: 'george', text: 'Phone', at: now().toISOString() };
  a.saveJournal({ ...fields, messages: [first, one] }); b.saveJournal({ ...fields, messages: [first, two] });
  a.replaceDoc(mergeDocs(a.doc(), b.doc()));
  const id = 'talk:' + fields.day + ':morning';
  assert.deepEqual(a.doc().journal[id].messages.map((m) => m.text).sort(), ['Hello', 'Laptop', 'Phone']);
  a.saveJournal({ ...fields, messages: a.doc().journal[id].messages.filter((m) => m.text !== 'Laptop') });
  assert.equal(mergeDocs(a.doc(), b.doc()).journal[id].messages.some((m) => m.text === 'Laptop'), false);
  const old = structuredClone(a.doc());
  now.advance(40 * 86400000); a.pruneTalks();
  const merged = mergeDocs(a.doc(), old);
  assert.deepEqual(merged.journal[id].messages, []);
  assert.equal(JSON.stringify(merged.journal[id]._sync).includes('Laptop'), false);
});

test('malformed imports and remote records are rejected before changing the working document', async () => {
  const { a } = copies();
  const before = a.exportJson();
  for (const bad of [
    { ...emptyDoc(), items: { broken: null } },
    { ...emptyDoc(), schema: 999 },
    { ...emptyDoc(), items: { x: { id: 'x', type: 'habit', title: 'x', repeat: { kind: 'weekdays', days: 'oops' } } } },
    JSON.parse('{"schema":1,"items":{"__proto__":{"id":"__proto__"}}}'),
  ]) {
    assert.equal(isDoc(bad), false);
    assert.throws(() => a.importJson(JSON.stringify(bad)), /backup/);
    const result = await syncOnce({ store: a, client: { get: async () => ({ doc: bad, sha: 's' }), put: () => assert.fail('must not write') } });
    assert.equal(result.ok, false);
    assert.equal(a.exportJson(), before);
  }
  assert.throws(() => a.updateItem('a1', { date: '2026-02-31' }), /real date/);
  assert.equal(a.exportJson(), before);
});

test('local recovery retains valid records and preserves the original damaged document', () => {
  const { a } = copies();
  const damaged = a.doc(); damaged.items.broken = null;
  const raw = JSON.stringify(damaged);
  const storage = new MemoryStorage({ [DATA_KEY]: raw });
  const recovered = makeStore({ storage });
  assert.equal(recovered.doc().items.a1.title, 'Original');
  assert.equal(recovered.doc().items.broken, undefined);
  assert.equal(storage.getItem(CORRUPT_KEY), raw);
  assert.ok(recovered.loadError());
  const backupStorage = new MemoryStorage({ [DATA_KEY]: '{broken', [BACKUP_KEY]: recovered.exportJson() });
  assert.equal(makeStore({ storage: backupStorage }).doc().items.a1.title, 'Original');
});

test('saving settings cannot hide a failed data save', () => {
  class Limited extends MemoryStorage {
    setItem(k, v) { if (k === DATA_KEY) throw new Error('full'); super.setItem(k, v); }
  }
  const store = makeStore({ storage: new Limited() });
  store.addItem({ type: 'task', title: 'Unsaved' });
  store.updateSettings({ look: 'paper' });
  assert.equal(store.saveError(), 'full');
});

test('the recovery backup yields space to a primary save when storage is full', () => {
  class Limited extends MemoryStorage {
    setItem(k, v) {
      if (k === DATA_KEY && this.getItem(BACKUP_KEY) !== null) throw new DOMException('full', 'QuotaExceededError');
      super.setItem(k, v);
    }
  }
  const storage = new Limited();
  const store = makeStore({ storage });
  store.addItem({ type: 'task', title: 'Original' });
  const next = JSON.parse(store.exportJson());
  next.items.id1.title = 'Received from another device';
  store.replaceDoc(next);
  assert.equal(store.saveError(), null);
  assert.equal(JSON.parse(storage.getItem(DATA_KEY)).items.id1.title, 'Received from another device');
  assert.equal(storage.getItem(BACKUP_KEY), null);
});

test('saving an editor keeps untouched fields received since the editor opened', () => {
  const { a, item } = copies();
  const initial = { title: item.title, date: item.date, notes: '' };
  a.updateItem(item.id, { date: '2026-09-15', notes: 'Arrived during editing' });
  a.updateItem(item.id, editedFields(initial, { ...initial, title: 'My draft' }));
  assert.equal(a.doc().items[item.id].title, 'My draft');
  assert.equal(a.doc().items[item.id].date, '2026-09-15');
  assert.equal(a.doc().items[item.id].notes, 'Arrived during editing');
});

test('pruning also clears deleted conversation text when no visible messages remain', () => {
  const { a, now } = copies();
  const fields = { kind: 'talk', day: a.today(), slot: 'morning' };
  a.saveJournal({ ...fields, messages: [{ who: 'coach', text: 'Removed private text', at: now().toISOString() }] });
  a.saveJournal({ ...fields, messages: [] });
  now.advance(40 * 86400000);
  assert.equal(a.pruneTalks(), 1);
  assert.equal(a.exportJson().includes('Removed private text'), false);
  assert.equal(a.pruneTalks(), 0);
});

test('held cross-tab events accumulate independent saves', () => {
  const a = makeStore({ prefix: 'a' }), b = makeStore({ prefix: 'b' });
  a.addItem({ type: 'task', title: 'A' }); b.addItem({ type: 'task', title: 'B' });
  const merged = mergeStoredEvents(mergeStoredEvents(null, a.exportJson()), b.exportJson());
  assert.deepEqual(Object.keys(JSON.parse(merged).items), ['a1', 'b1']);
  assert.equal(mergeStoredEvents(merged, 'bad'), merged);
});

test('timeouts cover stalled fetch and stalled body, and a later request can succeed', async () => {
  for (const fetch of [() => new Promise(() => {}), async () => ({ ok: true, json: () => new Promise(() => {}) })]) {
    const client = createGitHubClient({ token: 'dummy', repo: 'o/r', timeoutMs: 5, fetch });
    await assert.rejects(client.get(), /timed out/);
  }
  const repo = new FakeGitHub(), store = makeStore();
  store.addItem({ type: 'task', title: 'A' });
  let first = true;
  const client = createGitHubClient({ token: 'dummy', repo: 'o/r', timeoutMs: 5,
    fetch: async (_, init) => {
      if (init.method === 'PUT') {
        const body = JSON.parse(init.body);
        await repo.put(JSON.parse(Buffer.from(body.content, 'base64').toString()), body.sha);
        if (first) { first = false; return new Promise(() => {}); }
      }
      const remote = await repo.get();
      return { ok: true, status: 200, json: async () => remote
        ? { content: Buffer.from(JSON.stringify(remote.doc)).toString('base64'), sha: remote.sha }
        : {} };
    } });
  // Seed a remote document so this also exercises an ambiguous PUT outcome.
  await repo.put(emptyDoc());
  assert.equal((await syncOnce({ store, client })).ok, false);
  assert.equal((await syncOnce({ store, client })).ok, true);
  assert.equal(repo.puts, 2, 'the timed-out write was read back, not blindly repeated');
});

test('visible idle polling uses backoff, pauses while editing, and recovers', async () => {
  let time = 0, visible = true, idle = true, runs = 0, ok = false;
  const scheduler = createSyncScheduler({ run: async () => { runs++; return { ok }; }, clock: () => time,
    canPoll: () => visible, canRun: () => idle, pollMs: 100, maxPollMs: 800 });
  time = 100; await scheduler.poll(); assert.equal(runs, 1);
  time = 200; await scheduler.poll(); assert.equal(runs, 1);
  time = 300; visible = false; await scheduler.poll(); assert.equal(runs, 1);
  visible = true; idle = false; await scheduler.poll(); assert.equal(runs, 1);
  idle = true; ok = true; await scheduler.poll(); assert.equal(runs, 2);
  time = 400; await scheduler.poll(); assert.equal(runs, 3);
});
