import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA_KEY } from '../js/data.js';
import { MAPS, emptyDoc, isDoc, stableStringify } from '../js/doc.js';
import { mergeDocs, sameDoc } from '../js/merge.js';
import {
  FLAG_TEXT_MAX, FLAG_CTX_MAX, LAST_SYNCED_KEY, APP_VERSION, capContext, flagContext, shortAgent, flagAbout,
  openFlags, addressedCount, waitingFlags, flagSyncLine, readLastSynced, writeLastSynced, scrubText,
} from '../js/flags.js';
import { MemoryStorage, FullStorage, clock, makeStore, fixture } from './helpers.js';

const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

// ---- the map -----------------------------------------------------------------------------------

test('flags is a known map; documents from before it are still documents', () => {
  assert.deepEqual(MAPS, ['items', 'goals', 'milestones', 'logs', 'journal', 'flags', 'changes']);
  assert.deepEqual(emptyDoc(), { schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {}, flags: {}, changes: {} });
  assert.equal(isDoc({ schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {} }), true);
  assert.equal(isDoc({ schema: 1, items: {}, flags: {} }), true);
  assert.equal(isDoc({ schema: 1, items: {}, flags: [] }), false);
  assert.equal(isDoc({ schema: 1, items: {}, flags: 'x' }), false);
  assert.throws(() => makeStore().importJson('{"schema":1,"items":{},"flags":[1]}'), /backup/);
});

test('a document saved before flags existed loads with none', () => {
  const storage = new MemoryStorage({ [DATA_KEY]: JSON.stringify({ schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {} }) });
  const store = makeStore({ storage });
  assert.deepEqual(store.doc().flags, {});
  assert.equal(store.loadError(), null);
});

// ---- the store ---------------------------------------------------------------------------------

test('addFlag writes a normal record with the text and a copy of the context', () => {
  const storage = new MemoryStorage();
  const now = clock(new Date(2026, 8, 12, 18, 4));
  const store = makeStore({ storage, now });
  const reasons = [];
  store.subscribe((r) => reasons.push(r));
  const ctx = { at: now().toISOString(), look: 'night', layout: { columns: [['coach'], []], hidden: [] } };
  const rec = store.addFlag('  The streak should say which habit  ', ctx);
  assert.deepEqual(rec, {
    id: 'id1', text: 'The streak should say which habit', ctx: { at: now().toISOString(), look: 'night', layout: { columns: [['coach'], []], hidden: [] } },
    source: 'me', status: 'active', created: '2026-09-12', archivedOn: null, updated: now().toISOString(),
  });
  assert.deepEqual(reasons, ['local']);
  assert.deepEqual(JSON.parse(storage.getItem(DATA_KEY)).flags.id1, rec);
  ctx.look = 'changed later';
  ctx.layout.hidden.push('x');
  assert.equal(store.doc().flags.id1.ctx.look, 'night');
  assert.deepEqual(store.doc().flags.id1.ctx.layout.hidden, []);
});

test('addFlag caps the text at 1000 characters and refuses a blank one', () => {
  const store = makeStore();
  assert.equal(FLAG_TEXT_MAX, 1000);
  assert.equal(store.addFlag('x'.repeat(1500)).text.length, 1000);
  assert.equal(store.addFlag('é'.repeat(1001)).text, 'é'.repeat(1000));
  assert.equal(store.addFlag('No context').ctx, null);
  assert.throws(() => store.addFlag('   '), /needs some text/);
  assert.throws(() => store.addFlag(null), /needs some text/);
  assert.equal(Object.keys(store.doc().flags).length, 3);
});

test('addFlag caps the context at 4 KB, whoever built it', () => {
  const store = makeStore();
  const rec = store.addFlag('Too much context', {
    day: '2026-09-12', note: 'y'.repeat(10000), list: Array.from({ length: 2000 }, (_, i) => `w${i}`),
  });
  assert.ok(bytes(rec.ctx) <= FLAG_CTX_MAX, `${bytes(rec.ctx)} bytes`);
  assert.equal(rec.ctx.truncated, true);
  assert.equal(rec.ctx.day, '2026-09-12');
  assert.equal('list' in rec.ctx, false);
});

test('addressFlag archives the flag — never deleted — and addressing it again changes nothing', () => {
  const now = clock(new Date(2026, 8, 12, 18, 4));
  const store = makeStore({ now });
  const flag = store.addFlag('Fix the bar colour');
  now.set(new Date(2026, 8, 14, 9, 0));
  const reasons = [];
  store.subscribe((r) => reasons.push(r));
  const done = store.addressFlag(flag.id);
  assert.equal(done.status, 'archived');
  assert.equal(done.archivedOn, '2026-09-14');
  assert.ok(done.updated > flag.updated);
  assert.equal(done.text, 'Fix the bar colour');
  assert.deepEqual(reasons, ['local']);
  now.advance(60000);
  assert.equal(store.addressFlag(flag.id), store.doc().flags[flag.id]);
  assert.equal(store.doc().flags[flag.id].updated, done.updated);
  assert.deepEqual(reasons, ['local']);
  assert.throws(() => store.addressFlag('missing'), /No flags record missing/);
});

// ---- merging -----------------------------------------------------------------------------------

const openFlag = {
  id: 'f1', text: 'Fix it', ctx: null, source: 'me', status: 'active',
  created: '2026-09-12', archivedOn: null, updated: '2026-09-12T17:04:00.000Z',
};

test('a flag addressed on one device wins over the open copy on the other, in either order', () => {
  const addressed = { ...openFlag, status: 'archived', archivedOn: '2026-09-13', updated: '2026-09-13T08:00:00.000Z' };
  const laptop = { ...emptyDoc(), flags: { f1: openFlag } };
  const phone = { ...emptyDoc(), flags: { f1: addressed } };
  assert.deepEqual(mergeDocs(laptop, phone).flags.f1, addressed);
  assert.deepEqual(mergeDocs(phone, laptop).flags.f1, addressed);
  assert.equal(stableStringify(mergeDocs(laptop, phone)), stableStringify(mergeDocs(phone, laptop)));
});

test('merging keeps every flag, and repairs one archived without an archivedOn', () => {
  const other = { ...openFlag, id: 'f2', text: 'Another' };
  const broken = { id: 'f3', text: 'Hand-made', status: 'archived', created: '2026-09-10', updated: '2026-09-11T09:00:00.000Z' };
  const merged = mergeDocs({ ...emptyDoc(), flags: { f1: openFlag, f3: broken } }, { ...emptyDoc(), flags: { f2: other } });
  assert.deepEqual(Object.keys(merged.flags), ['f1', 'f2', 'f3']);
  assert.equal(merged.flags.f3.archivedOn, '2026-09-10');
});

test('a document from before flags existed merges cleanly with one that has them', () => {
  const old = { schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {} };
  assert.deepEqual(mergeDocs(old, null).flags, {});
  assert.equal(mergeDocs(old, { ...emptyDoc(), flags: { f1: openFlag } }).flags.f1.text, 'Fix it');
  assert.equal(sameDoc(old, emptyDoc()), true);
});

// ---- flagContext -------------------------------------------------------------------------------

const SECRET_TOKEN = 'github_pat_11ABCDEFG0123456789';
const SECRET_GEMINI = 'AIzaSyD-0123456789abcdefghij';

// What Task 7 hands flagContext when the ⚑ panel opens (see the plan's Shared interfaces).
function sampleState(overrides = {}) {
  return {
    now: new Date(2026, 8, 12, 18, 4, 30),
    today: '2026-09-12',
    settings: {
      token: SECRET_TOKEN, repo: 'George-Wightman/dashboard-sync', dayStartHour: 4,
      geminiKey: SECRET_GEMINI, checkinHour: 18, look: 'auto',
    },
    look: 'night',
    window: { width: 1912, height: 1000 },
    columns: 2,
    layout: { v: 1, columns: [['coach', 'week'], ['goals']], hidden: ['history'] },
    arranging: false,
    day: { done: 3, total: 8 },
    expandedGoals: 1,
    historyDay: null,
    coach: { checkin: 'questions', busy: '', shapeBusy: false, digestBusy: false, error: '', shapeError: '', digestError: '' },
    sync: { state: 'ok', error: null, lastSynced: new Date(2026, 8, 12, 18, 4) },
    hebrewKey: true,
    version: 'dash-v3',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    ...overrides,
  };
}

test('flagContext captures the moment, the page and the app as plain data', () => {
  assert.deepEqual(flagContext(sampleState()), {
    at: new Date(2026, 8, 12, 18, 4, 30).toISOString(),
    day: '2026-09-12',
    look: 'night',
    lookSetting: 'auto',
    checkinHour: 18,
    dayStartHour: 4,
    window: { width: 1912, height: 1000 },
    columns: 2,
    layout: { columns: [['coach', 'week'], ['goals']], hidden: ['history'] },
    arranging: false,
    today: { done: 3, total: 8 },
    expandedGoals: 1,
    historyDay: null,
    coach: { checkin: 'questions', busy: '', shapeBusy: false, digestBusy: false, error: '', shapeError: '', digestError: '' },
    sync: { state: 'ok', error: null, lastSynced: new Date(2026, 8, 12, 18, 4).toISOString() },
    set: { repo: true, token: true, geminiKey: true, hebrewKey: true },
    version: 'dash-v3',
    ua: 'Chrome 128 · Windows',
  });
});

test('flagContext holds booleans for the keys, never their values — even when passed in by mistake', () => {
  const leaky = sampleState({
    token: SECRET_TOKEN,
    geminiKey: SECRET_GEMINI,
    today: SECRET_TOKEN,
    sync: { state: 'failing', error: `GitHub 401 for ${SECRET_TOKEN}`, lastSynced: null },
    coach: { checkin: 'due', busy: '', error: `${'x'.repeat(295)}${SECRET_GEMINI}`, shapeError: SECRET_GEMINI, digestError: '' },
    layout: { v: 1, columns: [[SECRET_TOKEN], []], hidden: [] },
    version: SECRET_GEMINI,
    userAgent: `Mozilla ${SECRET_TOKEN}`,
  });
  const ctx = flagContext(leaky);
  const json = JSON.stringify(ctx);
  for (const secret of [SECRET_TOKEN, SECRET_GEMINI]) {
    assert.ok(!json.includes(secret), 'the whole value');
    assert.ok(!json.includes(secret.slice(0, 10)), 'nor the start of it');
  }
  assert.deepEqual(ctx.set, { repo: true, token: true, geminiKey: true, hebrewKey: true });
  assert.match(ctx.sync.error, /^GitHub 401 for \[hidden\]$/);
  const none = { ...sampleState().settings, token: '', geminiKey: '', repo: '' };
  assert.deepEqual(flagContext(sampleState({ settings: none, hebrewKey: false })).set, { repo: false, token: false, geminiKey: false, hebrewKey: false });
});

test('flagContext is capped at 4 KB, keeping the moment and the day', () => {
  assert.equal(FLAG_CTX_MAX, 4096);
  const huge = sampleState({
    layout: { v: 1, columns: [Array.from({ length: 400 }, (_, i) => `widget-${i}`), []], hidden: [] },
    sync: { state: 'failing', error: 'e'.repeat(5000), lastSynced: null },
  });
  const ctx = flagContext(huge);
  assert.ok(bytes(ctx) <= FLAG_CTX_MAX, `${bytes(ctx)} bytes`);
  assert.equal(ctx.truncated, true);
  assert.equal(ctx.day, '2026-09-12');
  assert.equal(ctx.at, huge.now.toISOString());
  const small = flagContext(sampleState());
  assert.equal('truncated' in small, false);
  assert.ok(bytes(small) < 1500, `${bytes(small)} bytes`);
});

test('flagContext never changes its input, and copes with a bare state', () => {
  const state = sampleState();
  const before = structuredClone(state);
  flagContext(state);
  assert.deepEqual(state, before);
  const bare = flagContext({});
  assert.equal(bare.at, null);
  assert.equal(bare.ua, null);
  assert.equal(bare.arranging, false);
  assert.deepEqual(bare.layout, { columns: [], hidden: [] });
  assert.deepEqual(bare.set, { repo: false, token: false, geminiKey: false, hebrewKey: false });
  assert.doesNotThrow(() => flagContext());
});

test('shortAgent: browser and system, briefly', () => {
  assert.equal(shortAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'), 'Chrome 128 · Windows');
  assert.equal(shortAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.2739.42'), 'Edge 128 · Windows');
  assert.equal(shortAgent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'), 'Chrome 128 · Android');
  assert.equal(shortAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'), 'Safari 17 · iPhone');
  assert.equal(shortAgent('Node.js/24'), 'Node.js/24');
  assert.equal(shortAgent(''), null);
  assert.equal(shortAgent(undefined), null);
});

test('flagAbout: the About line, from the captured context', () => {
  assert.equal(flagAbout(flagContext(sampleState())), 'Today · Night look · 3 of 8 done · Coach: check-in waiting · synced 18:04');
  assert.equal(flagAbout(flagContext(sampleState({
    arranging: true, look: 'paper', day: { done: 0, total: 0 },
    coach: { checkin: 'due', busy: 'questions' }, sync: { state: 'off', error: null, lastSynced: null },
  }))), 'Arranging widgets · Paper look · nothing on today · Coach: thinking · sync off');
  assert.equal(flagAbout(flagContext(sampleState({
    coach: { checkin: 'early', error: "Gemini didn't answer — try again" }, sync: { state: 'failing', error: 'GitHub 500', lastSynced: null },
  }))), 'Today · Night look · 3 of 8 done · Coach: showing an error · sync failing');
  assert.equal(flagAbout({}), 'Today');
  assert.equal(flagAbout(null), 'Today');
});

// ---- reading the flags -------------------------------------------------------------------------

const someFlags = () => fixture({
  flags: [
    { id: 'a', text: 'A', updated: '2026-09-12T09:00:00.000Z' },
    { id: 'b', text: 'B', updated: '2026-09-12T11:00:00.000Z' },
    { id: 'c', text: 'C', status: 'archived', archivedOn: '2026-09-12', updated: '2026-09-12T12:00:00.000Z' },
    { id: 'd', text: 'D', updated: '2026-09-12T10:00:00.000Z' },
  ],
});

test('openFlags newest first; addressedCount counts the rest', () => {
  const doc = someFlags();
  assert.deepEqual(openFlags(doc).map((f) => f.id), ['b', 'd', 'a']);
  assert.equal(addressedCount(doc), 1);
  assert.deepEqual(openFlags(emptyDoc()), []);
  assert.equal(addressedCount({ schema: 1, items: {} }), 0);
});

test('a flag is waiting while its updated is later than the last successful sync', () => {
  const doc = someFlags();
  assert.deepEqual(waitingFlags(doc, null).map((f) => f.id).sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(waitingFlags(doc, '2026-09-12T10:30:00.000Z').map((f) => f.id).sort(), ['b', 'c']);
  assert.deepEqual(waitingFlags(doc, '2026-09-12T12:00:00.000Z'), []);
});

test('flagSyncLine: the three lines at the foot of the panel', () => {
  assert.equal(flagSyncLine(false, 3), 'Sync is off — flags stay on this device until you add the sync repo in ⚙');
  assert.equal(flagSyncLine(true, 0), 'All flags have reached GitHub');
  assert.equal(flagSyncLine(true, 1), "1 flag hasn't reached GitHub yet");
  assert.equal(flagSyncLine(true, 2), "2 flags haven't reached GitHub yet");
});

test('the last successful sync is kept on the device, and failures never throw', () => {
  assert.equal(LAST_SYNCED_KEY, 'dash_last_synced');
  assert.equal(APP_VERSION, 'dash-v5');
  const storage = new MemoryStorage();
  assert.equal(readLastSynced(storage), null);
  assert.equal(writeLastSynced(storage, '2026-09-12T17:04:00.000Z'), true);
  assert.equal(storage.getItem('dash_last_synced'), '2026-09-12T17:04:00.000Z');
  assert.equal(readLastSynced(storage), '2026-09-12T17:04:00.000Z');
  assert.equal(writeLastSynced(new FullStorage(), '2026-09-12T17:04:00.000Z'), false);
  class DeniedRead extends MemoryStorage { getItem() { throw new Error('denied'); } }
  assert.equal(readLastSynced(new DeniedRead()), null);
});

test('scrubText replaces the token and Gemini key with the same [hidden] marker flagContext uses, before a flag is stored', () => {
  const secrets = [SECRET_TOKEN, SECRET_GEMINI];
  assert.equal(
    scrubText(`Please remove ${SECRET_TOKEN} and ${SECRET_GEMINI} from the log`, secrets),
    'Please remove [hidden] and [hidden] from the log');
  assert.equal(scrubText('Nothing secret here', secrets), 'Nothing secret here');
  assert.equal(scrubText('short', ['abc']), 'short'); // below SECRET_MIN, left alone
  const store = makeStore();
  const rec = store.addFlag(scrubText(`The key ${SECRET_GEMINI} leaked into a note`, secrets));
  assert.equal(rec.text, 'The key [hidden] leaked into a note');
});

test('capContext copies plain data, refuses what is not an object, and never throws', () => {
  assert.equal(capContext(null), null);
  assert.equal(capContext('x'), null);
  assert.equal(capContext([1]), null);
  const cyclic = { a: 1 };
  cyclic.self = cyclic;
  assert.equal(capContext(cyclic), null);
  assert.equal(capContext({ n: 10n }), null);
  assert.deepEqual(capContext({ when: new Date(Date.UTC(2026, 8, 12)), fn: () => 1, n: 1 }), { when: '2026-09-12T00:00:00.000Z', n: 1 });
});
