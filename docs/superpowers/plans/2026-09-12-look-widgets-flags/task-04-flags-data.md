# Task 4: Flags — the map, the store and the context

Part of [the look, widgets and flags plan](../2026-09-12-look-widgets-flags.md) — read its Global Constraints first.

**Files:**
- Create: `js/flags.js`, `tests/flags.test.js`
- Modify: `js/doc.js` (two exact edits), `js/data.js` (three exact edits), `tests/helpers.js`
  (`fixture`), `tests/data.test.js` (one line), `tests/sync.test.js` (two tests appended)

**Interfaces:**
- Consumes: the store internals in `js/data.js` (`create`, `patch`, `commit('local')` via them, `today`,
  `doc`); `MAPS`, `emptyDoc`, `isDoc`, `stableStringify` from `js/doc.js`; `mergeDocs`, `sameDoc` from
  `js/merge.js`; `MemoryStorage`, `FullStorage`, `clock`, `makeStore`, `fixture` from `tests/helpers.js`;
  `FakeGitHub`, `syncOnce` already in `tests/sync.test.js`.
- Produces (see the plan's Shared interfaces — Task 7 builds the ⚑ panel on exactly these):
  - `js/doc.js`: `MAPS` gains `'flags'`; `emptyDoc()` has `flags: {}`.
  - `js/data.js`: the store gains `addFlag(text, ctx)` and `addressFlag(id)`.
  - `js/flags.js` (pure, no imports): `FLAG_TEXT_MAX` 1000, `FLAG_CTX_MAX` 4096, `LAST_SYNCED_KEY`
    `'dash_last_synced'`, `APP_VERSION` `'dash-v3'`, `capContext(ctx)`, `flagContext(state)`,
    `shortAgent(ua)`, `flagAbout(ctx)`, `openFlags(doc)`, `addressedCount(doc)`,
    `waitingFlags(doc, lastSynced)`, `flagSyncLine(syncOn, waiting)`, `readLastSynced(storage)`,
    `writeLastSynced(storage, iso)`.
  - `tests/helpers.js`: `fixture({ …, flags })`.

**How `flags` fits the existing code** (every consequence of adding it to `MAPS`, checked):
- `emptyDoc()` lists the maps by hand, so it gains `flags: {}` alongside the `MAPS` change.
- `isDoc` loops over `MAPS` (except `items`): a document with no `flags` is still a document; one whose
  `flags` is an array or a string is not (so `importJson`, `absorbStored` and `syncOnce` refuse it).
- `withMaps` in `js/data.js` loops over `MAPS`, so a document saved before this task loads with
  `flags: {}` — no edit.
- `mergeDocs` always includes every `MAPS` key, and normalises records in every known map except
  `logs` with both repairs (`created` from `updated`; `archivedOn` for an archived record). Flags get
  both, like `journal`. Records the store writes always have both fields, so this changes nothing
  for them; a hand-made or truncated one is repaired rather than blanking anything.
- "Addressed anywhere wins" needs no new merge rule: addressing is a `patch`, which stamps a later
  `updated`, and the later `updated` wins per record. There is no un-address, so nothing can ever
  make an open copy newer than the addressed one.
- `sameDoc` merges both sides with `null` first, so a sync file written before flags existed compares
  equal to the same document with `flags: {}`: the first sync after this change pushes nothing
  (tested). Older copies of the app treat `flags` as an unknown map and still merge it per record.
- Existing tests: only `tests/data.test.js` asserts the exact key list of a new document; it gains
  `'flags'`. `tests/merge.test.js` builds its maps from `MAPS`, and everything else goes through
  `emptyDoc()`, so they pick the new map up unchanged.

**The context** (`flagContext(state)`) is built only from the fields the plan's Shared interfaces
list, so anything else in `state` is ignored. Keys and the repo are copied as **booleans only**. Any
string that goes in is first scrubbed of the token's and the Gemini key's values (from
`state.settings`, when 6 characters or longer — replaced with `[hidden]`), then clipped, so even a
secret passed by mistake inside an error message, the user agent or anywhere else can't reach the
flag, not even in part. The result goes through `capContext`, which keeps it at or under 4 KB of
UTF-8 JSON: when it's too big it clips every string to 200 characters, adds `truncated: true`, and
drops the largest fields first until it fits. The store runs `capContext` again on whatever it is
given, so the cap holds for any caller.

- [ ] **Step 1: Write the failing tests**

Create `tests/flags.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA_KEY } from '../js/data.js';
import { MAPS, emptyDoc, isDoc, stableStringify } from '../js/doc.js';
import { mergeDocs, sameDoc } from '../js/merge.js';
import {
  FLAG_TEXT_MAX, FLAG_CTX_MAX, LAST_SYNCED_KEY, APP_VERSION, capContext, flagContext, shortAgent, flagAbout,
  openFlags, addressedCount, waitingFlags, flagSyncLine, readLastSynced, writeLastSynced,
} from '../js/flags.js';
import { MemoryStorage, FullStorage, clock, makeStore, fixture } from './helpers.js';

const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

// ---- the map -----------------------------------------------------------------------------------

test('flags is a known map; documents from before it are still documents', () => {
  assert.deepEqual(MAPS, ['items', 'goals', 'milestones', 'logs', 'journal', 'flags']);
  assert.deepEqual(emptyDoc(), { schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {}, flags: {} });
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
  assert.equal(APP_VERSION, 'dash-v3');
  const storage = new MemoryStorage();
  assert.equal(readLastSynced(storage), null);
  assert.equal(writeLastSynced(storage, '2026-09-12T17:04:00.000Z'), true);
  assert.equal(storage.getItem('dash_last_synced'), '2026-09-12T17:04:00.000Z');
  assert.equal(readLastSynced(storage), '2026-09-12T17:04:00.000Z');
  assert.equal(writeLastSynced(new FullStorage(), '2026-09-12T17:04:00.000Z'), false);
  class DeniedRead extends MemoryStorage { getItem() { throw new Error('denied'); } }
  assert.equal(readLastSynced(new DeniedRead()), null);
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
```

In `tests/helpers.js`, replace the start of `fixture`:

```js
// Build a document by hand for the pure schedule tests.
export function fixture({ items = [], logs = [], goals = [], milestones = [], journal = [] } = {}) {
  const doc = emptyDoc();
  const base = {
    source: 'me', status: 'active', created: '2026-09-01', archivedOn: null,
    updated: '2026-09-01T09:00:00.000Z',
  };
  for (const [map, list] of Object.entries({ items, logs, goals, milestones, journal })) {
```

with:

```js
// Build a document by hand for the pure schedule tests.
export function fixture({ items = [], logs = [], goals = [], milestones = [], journal = [], flags = [] } = {}) {
  const doc = emptyDoc();
  const base = {
    source: 'me', status: 'active', created: '2026-09-01', archivedOn: null,
    updated: '2026-09-01T09:00:00.000Z',
  };
  for (const [map, list] of Object.entries({ items, logs, goals, milestones, journal, flags })) {
```

In `tests/data.test.js`, in the test `a new store is empty, with default settings`, replace:

```js
  assert.deepEqual(Object.keys(store.doc()).sort(), ['goals', 'items', 'journal', 'logs', 'milestones', 'schema']);
```

with:

```js
  assert.deepEqual(Object.keys(store.doc()).sort(), ['flags', 'goals', 'items', 'journal', 'logs', 'milestones', 'schema']);
```

Append to the end of `tests/sync.test.js` (it already has `FakeGitHub`, `syncOnce`, `sameDoc`,
`makeStore` and `clock`):

```js

// ---- flags -------------------------------------------------------------------------------------

test('a sync file written before flags existed is not rewritten just to add them', async () => {
  const gh = new FakeGitHub();
  gh.file = { doc: { schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {} }, sha: 'old' };
  const store = makeStore();
  assert.deepEqual(await syncOnce({ store, client: gh }), { ok: true, pushed: false });
  assert.deepEqual(store.doc().flags, {});
  assert.equal(gh.puts, 0);
});

test('a flag written on one device and addressed on the other comes back addressed', async () => {
  const gh = new FakeGitHub();
  const now = clock(new Date(2026, 8, 12, 18, 4));
  const laptop = makeStore({ prefix: 'L', now });
  const phone = makeStore({ prefix: 'P', now });
  const flag = laptop.addFlag('The coach button is too small', { look: 'night' });
  await syncOnce({ store: laptop, client: gh });
  await syncOnce({ store: phone, client: gh });
  assert.equal(phone.doc().flags[flag.id].text, 'The coach button is too small');
  assert.deepEqual(gh.file.doc.flags[flag.id].ctx, { look: 'night' });
  now.advance(60000);
  phone.addressFlag(flag.id);
  await syncOnce({ store: phone, client: gh });
  await syncOnce({ store: laptop, client: gh });
  assert.equal(laptop.doc().flags[flag.id].status, 'archived');
  assert.ok(sameDoc(laptop.doc(), phone.doc()));
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `npm test`
Expected: FAIL —
- `tests/flags.test.js` doesn't load: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/js/flags.js'`
- `a new store is empty, with default settings` — the key list has no `'flags'`
- `a sync file written before flags existed is not rewritten just to add them` — `flags` is `undefined`
- `a flag written on one device and addressed on the other comes back addressed` — `TypeError: laptop.addFlag is not a function`

- [ ] **Step 3: Create `js/flags.js`**

```js
// Flags: George's notes of something to change, written from inside the app (⚑) together with
// what the app was doing at that moment, and carried to GitHub by the sync. Pure helpers, no
// imports: the store writes the records (addFlag / addressFlag in js/data.js) and js/ui/flags.js
// draws the panel.

export const FLAG_TEXT_MAX = 1000; // characters in a flag's sentence
export const FLAG_CTX_MAX = 4096; // bytes of a flag's context, as UTF-8 JSON
export const LAST_SYNCED_KEY = 'dash_last_synced'; // device-local: when a sync last succeeded
// The app's version as a flag records it: sw.js's CACHE name. Bump the two together
// (tests/sw.test.js, added with the offline-shell change, checks they match).
export const APP_VERSION = 'dash-v3';

// A "secret" shorter than this would blank ordinary words, so it isn't scrubbed.
const SECRET_MIN = 6;

const values = (map) => Object.values(map ?? {});
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const pad = (n) => String(n).padStart(2, '0');

function clip(text, n) {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

// A copy of a JSON value with every string passed through fn.
function mapStrings(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
  }
  return value;
}

// A plain-JSON copy of a context, at most FLAG_CTX_MAX bytes serialised. Too big: every string is
// clipped to 200 characters, `truncated: true` is added, and the largest fields go first until it
// fits. Not a plain object, or not serialisable (a cycle, a BigInt): null. Never throws.
export function capContext(ctx) {
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return null;
  let out;
  try {
    out = JSON.parse(JSON.stringify(ctx));
  } catch {
    return null;
  }
  if (!out || typeof out !== 'object' || Array.isArray(out)) return null;
  if (bytes(out) <= FLAG_CTX_MAX) return out;
  out = mapStrings(out, (s) => clip(s, 200));
  out.truncated = true;
  const largestFirst = Object.keys(out)
    .filter((k) => k !== 'truncated')
    .sort((a, b) => bytes(out[b]) - bytes(out[a]) || (a < b ? -1 : 1));
  for (const key of largestFirst) {
    if (bytes(out) <= FLAG_CTX_MAX) break;
    delete out[key];
  }
  return out;
}

const BROWSERS = [['Edge', /Edg\/(\d+)/], ['Firefox', /Firefox\/(\d+)/], ['Chrome', /Chrome\/(\d+)/], ['Safari', /Version\/(\d+).*Safari/]];
const SYSTEMS = [['Android', /Android/], ['iPhone', /iPhone/], ['iPad', /iPad/], ['Windows', /Windows/], ['ChromeOS', /CrOS/], ['Mac', /Mac OS X/], ['Linux', /Linux/]];

// 'Chrome 128 · Windows' from a full user agent; the first 60 characters if neither is recognised.
export function shortAgent(ua) {
  if (typeof ua !== 'string' || !ua) return null;
  const browser = BROWSERS.map(([name, re]) => [name, ua.match(re)]).find(([, m]) => m);
  const system = SYSTEMS.find(([, re]) => re.test(ua));
  const parts = [browser && `${browser[0]} ${browser[1][1]}`, system && system[0]].filter(Boolean);
  return parts.length ? parts.join(' · ') : clip(ua, 60);
}

// What the app was doing when the ⚑ panel opened, as plain data (the shape is in the plan's
// Shared interfaces). Only the listed fields are read. The repo and the keys go in as booleans
// only; every string is scrubbed of the token's and the Gemini key's values before it is used, so
// they can't reach a flag even if passed in by mistake. Capped at FLAG_CTX_MAX bytes.
export function flagContext(state = {}) {
  const settings = state.settings ?? {};
  const secrets = [settings.token, settings.geminiKey]
    .filter((v) => typeof v === 'string')
    .flatMap((v) => [v, v.trim()])
    .filter((v) => v.length >= SECRET_MIN)
    .sort((a, b) => b.length - a.length);
  const scrub = (text) => secrets.reduce((t, secret) => t.split(secret).join('[hidden]'), text);
  const str = (v, n = 300) => (typeof v === 'string' ? clip(scrub(v), n) : null);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const iso = (v) => {
    const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
  };
  const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => str(x, 40)) : []);
  const coach = state.coach ?? {};
  const sync = state.sync ?? {};
  const layout = state.layout ?? {};
  const out = {
    at: iso(state.now),
    day: str(state.today, 10),
    look: str(state.look, 10),
    lookSetting: str(settings.look, 10),
    checkinHour: num(settings.checkinHour),
    dayStartHour: num(settings.dayStartHour),
    window: { width: num(state.window?.width), height: num(state.window?.height) },
    columns: num(state.columns),
    layout: { columns: Array.isArray(layout.columns) ? layout.columns.map((c) => ids(c)) : [], hidden: ids(layout.hidden) },
    arranging: state.arranging === true,
    today: { done: num(state.day?.done), total: num(state.day?.total) },
    expandedGoals: num(state.expandedGoals),
    historyDay: str(state.historyDay, 10),
    coach: {
      checkin: str(coach.checkin, 20),
      busy: str(coach.busy, 20) ?? '',
      shapeBusy: coach.shapeBusy === true,
      digestBusy: coach.digestBusy === true,
      error: str(coach.error) ?? '',
      shapeError: str(coach.shapeError) ?? '',
      digestError: str(coach.digestError) ?? '',
    },
    sync: { state: str(sync.state, 20), error: str(sync.error), lastSynced: iso(sync.lastSynced) },
    set: { repo: !!settings.repo, token: !!settings.token, geminiKey: !!settings.geminiKey, hebrewKey: !!state.hebrewKey },
    version: str(state.version, 40),
    ua: typeof state.userAgent === 'string' ? shortAgent(scrub(state.userAgent)) : null,
  };
  return capContext(mapStrings(out, scrub));
}

const LOOK_NAMES = { paper: 'Paper', night: 'Night' };
const CHECKIN_WORDS = {
  done: 'check-in done', questions: 'check-in waiting', due: 'check-in due', early: 'check-in later', nokey: 'no Gemini key',
};
const SYNC_WORDS = { off: 'sync off', syncing: 'syncing', offline: 'offline', failing: 'sync failing' };

function hhmm(isoText) {
  const d = new Date(isoText);
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The panel's About line, from a captured context:
// 'Today · Night look · 3 of 8 done · Coach: check-in waiting · synced 18:04'.
export function flagAbout(ctx) {
  const c = ctx ?? {};
  const parts = [c.arranging ? 'Arranging widgets' : 'Today'];
  if (LOOK_NAMES[c.look]) parts.push(`${LOOK_NAMES[c.look]} look`);
  if (c.today && typeof c.today.total === 'number') {
    parts.push(c.today.total ? `${c.today.done} of ${c.today.total} done` : 'nothing on today');
  }
  if (c.coach) {
    const busy = c.coach.busy || c.coach.shapeBusy || c.coach.digestBusy;
    const error = c.coach.error || c.coach.shapeError || c.coach.digestError;
    const word = busy ? 'thinking' : error ? 'showing an error' : CHECKIN_WORDS[c.coach.checkin];
    if (word) parts.push(`Coach: ${word}`);
  }
  if (c.sync) {
    const at = c.sync.state === 'ok' ? hhmm(c.sync.lastSynced) : '';
    if (at) parts.push(`synced ${at}`);
    else if (SYNC_WORDS[c.sync.state]) parts.push(SYNC_WORDS[c.sync.state]);
  }
  return parts.join(' · ');
}

const stampOf = (f) => (typeof f.updated === 'string' ? f.updated : '');

// The open flags, newest first (an open flag is never edited, so `updated` is when it was written).
export function openFlags(doc) {
  return values(doc?.flags)
    .filter((f) => f.status === 'active')
    .sort((a, b) => (stampOf(a) === stampOf(b) ? (a.id < b.id ? 1 : -1) : stampOf(a) < stampOf(b) ? 1 : -1));
}

export function addressedCount(doc) {
  return values(doc?.flags).filter((f) => f.status === 'archived').length;
}

// Flags written or addressed since the last successful sync (an ISO string, or null for never):
// the ones that haven't reached GitHub yet.
export function waitingFlags(doc, lastSynced) {
  const since = typeof lastSynced === 'string' ? lastSynced : '';
  return values(doc?.flags).filter((f) => typeof f.updated === 'string' && f.updated > since);
}

// The line at the foot of the panel. The panel adds ' · Sync now' when sync is on and some wait.
export function flagSyncLine(syncOn, waiting) {
  if (!syncOn) return 'Sync is off — flags stay on this device until you add the sync repo in ⚙';
  if (!waiting) return 'All flags have reached GitHub';
  return waiting === 1 ? "1 flag hasn't reached GitHub yet" : `${waiting} flags haven't reached GitHub yet`;
}

export function readLastSynced(storage) {
  try {
    const value = storage.getItem(LAST_SYNCED_KEY);
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

export function writeLastSynced(storage, iso) {
  try {
    storage.setItem(LAST_SYNCED_KEY, iso);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Add `flags` to `js/doc.js`**

4a. Replace:

```js
export const MAPS = ['items', 'goals', 'milestones', 'logs', 'journal'];

export function emptyDoc() {
  return { schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {} };
}
```

with:

```js
export const MAPS = ['items', 'goals', 'milestones', 'logs', 'journal', 'flags'];

export function emptyDoc() {
  return { schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {}, flags: {} };
}
```

4b. In the comment above `isDoc`, replace:

```js
// other known maps either absent or themselves plain objects (never arrays). A document saved
// before the journal existed has no `journal` and is still a real document.
```

with:

```js
// other known maps either absent or themselves plain objects (never arrays). A document saved
// before the journal or the flags existed has neither and is still a real document.
```

- [ ] **Step 5: `addFlag` and `addressFlag` in `js/data.js`**

5a. The imports — replace:

```js
import { mergeDocs } from './merge.js';
```

with:

```js
import { mergeDocs } from './merge.js';
import { FLAG_TEXT_MAX, capContext } from './flags.js';
```

5b. The two methods, just above `moveBefore` — replace:

```js
  // Move `id` to just before `targetId` within `groupIds` (the on-screen order of the draggable
```

with:

```js
  // ⚑: a note of something to change, with what the app was doing when the panel opened. The text
  // is trimmed and capped at FLAG_TEXT_MAX characters; the context is copied and capped at 4 KB
  // (js/flags.js), whoever built it.
  function addFlag(text, ctx = null) {
    const clean = Array.from(String(text ?? '').trim()).slice(0, FLAG_TEXT_MAX).join('').trim();
    if (!clean) throw new Error('A flag needs some text');
    return create('flags', { text: clean, ctx: capContext(ctx) });
  }

  // "Mark addressed": archived, never deleted, and there is no un-address — so the later write
  // always wins a merge. Addressing one that is already addressed changes nothing.
  function addressFlag(id) {
    const rec = doc.flags[id];
    if (!rec) throw new Error(`No flags record ${id}`);
    if (rec.status === 'archived') return rec;
    return patch('flags', id, { status: 'archived', archivedOn: today() });
  }

  // Move `id` to just before `targetId` within `groupIds` (the on-screen order of the draggable
```

5c. In the returned store object — replace:

```js
    dismissGoalPlan,

    replaceDoc,
```

with:

```js
    dismissGoalPlan,

    addFlag,
    addressFlag,

    replaceDoc,
```

(`js/flags.js` imports nothing, so `js/data.js` importing it makes no cycle.)

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — 250 tests (228 after Task 3, plus 20 in `tests/flags.test.js` and 2 in `tests/sync.test.js`).

Run: `node --check js/flags.js && node --check js/data.js && node --check js/doc.js`
Expected: no output.

- [ ] **Step 7: Check the page still loads** (controller)

Nothing on the page uses flags until Task 7. Serve with `preview_start` `dashboard`, open
`http://localhost:8080/?fakegemini`, reload twice, tick something on Today, then:
`JSON.parse(localStorage.getItem('dash_data')).flags` → `{}`. No console errors apart from the
Browser pane's service-worker refusal.

- [ ] **Step 8: Commit**

```bash
git add js/flags.js js/doc.js js/data.js tests/flags.test.js tests/helpers.js tests/data.test.js tests/sync.test.js
git commit -m "Add flags: the map, addFlag and addressFlag, and the flag context" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
