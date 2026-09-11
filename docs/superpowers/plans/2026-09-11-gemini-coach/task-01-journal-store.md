# Task 1: Journal map, settings and store methods

Part of [the Gemini coach plan](../2026-09-11-gemini-coach.md) — read its Global Constraints first.

**Files:**
- Modify: `js/doc.js` (replaced in full), `js/data.js` (seven exact edits), `js/merge.js` (one comment line), `tests/helpers.js` (`fixture`), `tests/data.test.js` (one line), `tests/merge.test.js` and `tests/sync.test.js` (tests appended)
- Create: `tests/journal.test.js`

**Interfaces:**
- Consumes: `addDays`, `weekStart` from `js/dates.js`; the store internals in `js/data.js` (`create`,
  `commit('local')`, `nextOrder`, `requireTitle`, `stamp`, `today`, `newId`); `mergeDocs`, `sameDoc` from
  `js/merge.js`; `MemoryStorage`, `clock`, `ids`, `makeStore` from `tests/helpers.js`;
  `FakeGitHub`, `syncOnce` already in `tests/sync.test.js`.
- Produces (see the plan's Shared interfaces for the full contract):
  - `js/doc.js`: `MAPS` gains `'journal'`; `emptyDoc()` has `journal: {}`; `isDoc` checks every known
    map except `items` the same way (absent, or a plain object); new `journalId(kind, day)`.
  - `js/data.js`: `DEFAULT_SETTINGS` gains `geminiKey: ''` and `checkinHour: 18`; the store gains
    `saveJournal(record)`, `addPlan(plan)`, `acceptGoalPlan(goalId)`, `dismissGoalPlan(goalId)`.
    Internally, `create` is split into `build` (write without saving) + `commit`, and `addItem` /
    `addGoal` into `itemFields` / `goalFields` (check + defaults, nothing written), so `addPlan` can
    validate every record first and commit once.
  - `tests/helpers.js`: `fixture({ items, logs, goals, milestones, journal })`.

**How `journal` fits the existing code** (why these edits are all that is needed):
- `withMaps` in `js/data.js` loops over `MAPS`, so a document saved before this task loads with
  `journal: {}`. No edit needed there.
- `mergeDocs` always includes every `MAPS` key and normalises records in known maps (repairs a missing
  `created`, and `archivedOn` on archived records — `journal` isn't `logs`, so it gets both repairs).
  Journal records written by the store always have both fields, so normalising changes nothing.
  Older copies of the app treat `journal` as an unknown map and still merge it per record, as the
  design says.
- `sameDoc` merges both sides with `null` first, so a sync file written before the journal existed
  compares equal to the same document with `journal: {}`. The first sync after this change pushes
  nothing (tested below).
- `isDoc` (used by `importJson`, `absorbStored` and `syncOnce`) must accept a document with no
  `journal` and refuse one whose `journal` is an array.
- Existing tests: only `tests/data.test.js` asserts the exact key list of a new document. It gains
  `'journal'`. Everything else that builds documents goes through `emptyDoc()`, so it picks up the
  new map without changes.

- [ ] **Step 1: Write the failing tests**

Create `tests/journal.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, DEFAULT_SETTINGS, DATA_KEY, SETTINGS_KEY } from '../js/data.js';
import { MAPS, emptyDoc, isDoc, journalId, stableStringify } from '../js/doc.js';
import { MemoryStorage, clock, ids, makeStore } from './helpers.js';

// ---- the journal map and the new settings ------------------------------------------------------

test('journal is a known map with deterministic ids', () => {
  assert.ok(MAPS.includes('journal'));
  assert.deepEqual(emptyDoc().journal, {});
  assert.equal(journalId('checkin', '2026-09-10'), 'checkin:2026-09-10');
  assert.equal(journalId('digest', '2026-09-07'), 'digest:2026-09-07');
});

test('isDoc accepts a document from before the journal, and refuses a journal that is not a map', () => {
  assert.equal(isDoc({ schema: 1, items: {}, goals: {}, milestones: {}, logs: {} }), true);
  assert.equal(isDoc({ schema: 1, items: {}, journal: {} }), true);
  assert.equal(isDoc({ schema: 1, items: {}, journal: [] }), false);
  assert.equal(isDoc({ schema: 1, items: {}, journal: 'x' }), false);
  const store = makeStore();
  assert.throws(() => store.importJson('{"schema":1,"items":{},"journal":[1]}'), /backup/);
});

test('a document saved before the journal existed loads with an empty journal', () => {
  const storage = new MemoryStorage({ [DATA_KEY]: JSON.stringify({ schema: 1, items: {}, goals: {}, milestones: {}, logs: {} }) });
  const store = makeStore({ storage });
  assert.deepEqual(store.doc().journal, {});
  assert.equal(store.loadError(), null);
});

test('settings gain geminiKey and checkinHour; older saved settings pick up the defaults', () => {
  assert.deepEqual(DEFAULT_SETTINGS, { token: '', repo: '', dayStartHour: 4, geminiKey: '', checkinHour: 18 });
  const storage = new MemoryStorage({ [SETTINGS_KEY]: JSON.stringify({ token: 't', repo: 'o/r', dayStartHour: 5 }) });
  const store = makeStore({ storage });
  assert.equal(store.settings().geminiKey, '');
  assert.equal(store.settings().checkinHour, 18);
  assert.equal(store.settings().dayStartHour, 5);
  store.updateSettings({ geminiKey: 'AIza-secret' });
  store.addItem({ type: 'task', title: 'Saves the document too' });
  assert.equal(JSON.parse(storage.getItem(SETTINGS_KEY)).geminiKey, 'AIza-secret');
  assert.ok(!storage.getItem(DATA_KEY).includes('AIza-secret'));
});

// ---- saveJournal -------------------------------------------------------------------------------

test('saveJournal creates a check-in under its deterministic id, with empty content filled in', () => {
  const storage = new MemoryStorage();
  const now = clock(new Date(2026, 8, 10, 19, 0));
  const store = makeStore({ storage, now });
  const reasons = [];
  store.subscribe((r) => reasons.push(r));
  const rec = store.saveJournal({
    kind: 'checkin', day: '2026-09-10', questions: ['How did the CV go?'], model: 'gemini-flash-lite-latest',
  });
  assert.deepEqual(rec, {
    id: 'checkin:2026-09-10', kind: 'checkin', day: '2026-09-10',
    questions: ['How did the CV go?'], answers: [], feedback: '', tomorrowIds: [], model: 'gemini-flash-lite-latest',
    source: 'gemini', status: 'active', created: '2026-09-10', archivedOn: null, updated: now().toISOString(),
  });
  assert.deepEqual(reasons, ['local']);
  assert.deepEqual(JSON.parse(storage.getItem(DATA_KEY)).journal['checkin:2026-09-10'], rec);
});

test('saveJournal on the same day overwrites only the fields given, and copies them', () => {
  const now = clock(new Date(2026, 8, 10, 19, 0));
  const store = makeStore({ now });
  const first = store.saveJournal({ kind: 'checkin', day: '2026-09-10', questions: ['Q1', 'Q2'], model: 'gemini-flash-lite-latest' });
  now.advance(60000);
  const answers = ['Finished it', 'Apply to NatCen'];
  const second = store.saveJournal({
    kind: 'checkin', day: '2026-09-10', answers, feedback: 'Good work.', tomorrowIds: ['t1'], model: 'gemini-flash-latest',
  });
  answers.push('typed after sending');
  const journal = store.doc().journal;
  assert.deepEqual(Object.keys(journal), ['checkin:2026-09-10']);
  assert.deepEqual(second.questions, ['Q1', 'Q2']);
  assert.deepEqual(second.answers, ['Finished it', 'Apply to NatCen']);
  assert.equal(second.feedback, 'Good work.');
  assert.deepEqual(second.tomorrowIds, ['t1']);
  assert.equal(second.model, 'gemini-flash-latest');
  assert.equal(second.created, first.created);
  assert.ok(second.updated > first.updated);
});

test('saveJournal files a digest under its Monday and drops fields it does not know', () => {
  const store = makeStore();
  const rec = store.saveJournal({
    kind: 'digest', day: '2026-08-31', summary: 'A steady week.', wins: ['Three applications'], slipped: ['Gym'],
    focus: 'Start by nine.', model: 'gemini-flash-lite-latest', mood: 'great',
  });
  assert.equal(rec.id, 'digest:2026-08-31');
  assert.equal(rec.summary, 'A steady week.');
  assert.equal('mood' in rec, false);
});

test('saveJournal refuses a bad kind, a bad day, a digest off its Monday, or a mismatched id', () => {
  const store = makeStore();
  assert.throws(() => store.saveJournal({ kind: 'note', day: '2026-09-10' }), /Unknown journal kind/);
  assert.throws(() => store.saveJournal({ kind: 'checkin', day: '10 Sep' }), /real day/);
  assert.throws(() => store.saveJournal({ kind: 'checkin', day: '2026-02-30' }), /real day/);
  assert.throws(() => store.saveJournal({ kind: 'digest', day: '2026-09-08' }), /Monday/);
  assert.throws(() => store.saveJournal({ id: 'checkin:2026-09-09', kind: 'checkin', day: '2026-09-10' }), /has the id checkin:2026-09-10/);
  assert.deepEqual(store.doc().journal, {});
});

// ---- addPlan -----------------------------------------------------------------------------------

test('addPlan writes a suggested goal, its milestones and linked habits and targets in one commit', () => {
  const store = makeStore();
  store.addGoal({ title: 'Existing goal' });
  const reasons = [];
  store.subscribe((r) => reasons.push(r));
  const out = store.addPlan({
    goal: { title: 'Run a 10k', targetDate: '2026-11-01', why: 'He wants a race by winter.' },
    milestones: ['Run 3k', 'Run 5k', 'Run 10k'],
    habits: [{ title: 'Stretch', repeat: { kind: 'weekdays', days: [1, 3, 5] } }],
    targets: [{ title: 'Running', target: 90, unit: 'minutes', unitLabel: '' }],
  });
  assert.deepEqual(reasons, ['local']);
  const doc = store.doc();
  const goal = doc.goals[out.goal.id];
  assert.equal(goal.title, 'Run a 10k');
  assert.equal(goal.status, 'suggested');
  assert.equal(goal.source, 'gemini');
  assert.equal(goal.targetDate, '2026-11-01');
  assert.equal(goal.why, 'He wants a race by winter.');
  assert.equal(goal.target, null);
  assert.equal(goal.order, 2);
  assert.deepEqual(out.milestones.map((m) => [m.title, m.status, m.source, m.goalId, m.done]), [
    ['Run 3k', 'suggested', 'gemini', goal.id, false],
    ['Run 5k', 'suggested', 'gemini', goal.id, false],
    ['Run 10k', 'suggested', 'gemini', goal.id, false],
  ]);
  assert.deepEqual(out.milestones.map((m) => m.order), [1, 2, 3]);
  assert.deepEqual(out.items.map((i) => [i.type, i.title, i.status, i.source, i.goalId]), [
    ['habit', 'Stretch', 'suggested', 'gemini', goal.id],
    ['quota', 'Running', 'suggested', 'gemini', goal.id],
  ]);
  assert.deepEqual(doc.items[out.items[0].id].repeat, { kind: 'weekdays', days: [1, 3, 5] });
  assert.equal(doc.items[out.items[1].id].target, 90);
  assert.equal(doc.items[out.items[1].id].unit, 'minutes');
});

test("addPlan writes tomorrow's tasks as suggestions on that day", () => {
  const store = makeStore();
  const { goal, milestones, items } = store.addPlan({ tasks: [{ title: 'Email Sarah', date: '2026-09-11' }] });
  assert.equal(goal, null);
  assert.deepEqual(milestones, []);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'task');
  assert.equal(items[0].date, '2026-09-11');
  assert.equal(items[0].status, 'suggested');
  assert.equal(items[0].source, 'gemini');
  assert.equal(items[0].goalId, null);
});

test('addPlan checks every record first, so a bad one writes nothing', () => {
  const store = makeStore();
  store.addItem({ type: 'task', title: 'Already here' });
  const before = stableStringify(store.doc());
  const reasons = [];
  store.subscribe((r) => reasons.push(r));
  assert.throws(() => store.addPlan({ goal: { title: 'G' }, milestones: ['Fine', '   '] }), /milestone needs a title/);
  assert.throws(() => store.addPlan({ goal: { title: 'G' }, targets: [{ title: 'T', target: 0, unit: 'count' }] }), /target above 0/);
  assert.throws(() => store.addPlan({ goal: { title: '  ' } }), /goal needs a title/);
  assert.throws(() => store.addPlan({ milestones: ['Orphan'] }), /need a goal/);
  assert.equal(stableStringify(store.doc()), before);
  assert.deepEqual(reasons, []);
});

test('addPlan with nothing in it writes nothing', () => {
  const store = makeStore();
  const reasons = [];
  store.subscribe((r) => reasons.push(r));
  assert.deepEqual(store.addPlan({}), { goal: null, milestones: [], items: [] });
  assert.deepEqual(reasons, []);
});

// ---- accepting and dismissing a plan -----------------------------------------------------------

function planned() {
  const now = clock();
  const store = createStore({ storage: new MemoryStorage(), now, newId: ids() });
  const out = store.addPlan({
    goal: { title: 'Run a 10k' },
    milestones: ['Run 3k', 'Run 5k'],
    habits: [{ title: 'Stretch', repeat: { kind: 'daily' } }],
    targets: [{ title: 'Running', target: 90, unit: 'minutes' }],
  });
  return { now, store, out };
}

test('acceptGoalPlan makes the goal and its suggested milestones live from today, in one commit', () => {
  const { now, store, out } = planned();
  store.dismissSuggestion('milestones', out.milestones[1].id);
  now.set(new Date(2026, 8, 12, 9, 0));
  const reasons = [];
  store.subscribe((r) => reasons.push(r));
  store.acceptGoalPlan(out.goal.id);
  assert.deepEqual(reasons, ['local']);
  const doc = store.doc();
  assert.equal(doc.goals[out.goal.id].status, 'active');
  assert.equal(doc.goals[out.goal.id].created, '2026-09-12');
  assert.equal(doc.milestones[out.milestones[0].id].status, 'active');
  assert.equal(doc.milestones[out.milestones[0].id].created, '2026-09-12');
  assert.equal(doc.milestones[out.milestones[1].id].status, 'dismissed'); // already turned down
  for (const item of out.items) assert.equal(doc.items[item.id].status, 'suggested'); // accepted one by one on Today
});

test('dismissGoalPlan dismisses the goal, its suggested milestones and suggested linked items only', () => {
  const { store, out } = planned();
  const [habit, target] = out.items;
  store.acceptSuggestion('items', habit.id);
  const other = store.addPlan({ goal: { title: 'Other goal' }, habits: [{ title: 'Other habit' }] });
  const loose = store.addPlan({ tasks: [{ title: 'Unrelated suggestion' }] });
  const reasons = [];
  store.subscribe((r) => reasons.push(r));
  store.dismissGoalPlan(out.goal.id);
  assert.deepEqual(reasons, ['local']);
  const doc = store.doc();
  assert.equal(doc.goals[out.goal.id].status, 'dismissed');
  for (const m of out.milestones) assert.equal(doc.milestones[m.id].status, 'dismissed');
  assert.equal(doc.items[target.id].status, 'dismissed');
  assert.equal(doc.items[habit.id].status, 'active');
  assert.equal(doc.goals[other.goal.id].status, 'suggested');
  assert.equal(doc.items[other.items[0].id].status, 'suggested');
  assert.equal(doc.items[loose.items[0].id].status, 'suggested');
});

test('accepting or dismissing a goal that does not exist throws', () => {
  const store = makeStore();
  assert.throws(() => store.acceptGoalPlan('missing'), /No goals record missing/);
  assert.throws(() => store.dismissGoalPlan('missing'), /No goals record missing/);
});
```

In `tests/data.test.js`, in the test `a new store is empty, with default settings`, replace:

```js
  assert.deepEqual(Object.keys(store.doc()).sort(), ['goals', 'items', 'logs', 'milestones', 'schema']);
```

with:

```js
  assert.deepEqual(Object.keys(store.doc()).sort(), ['goals', 'items', 'journal', 'logs', 'milestones', 'schema']);
```

Append to the end of `tests/merge.test.js` (it already imports `mergeDocs`, `sameDoc`, `emptyDoc`
and defines `S`):

```js

// ---- the journal (Gemini coach) ---------------------------------------------------------------

const checkin = (fields) => ({
  id: 'checkin:2026-09-10', kind: 'checkin', day: '2026-09-10', questions: ['How did it go?'], answers: [],
  feedback: '', tomorrowIds: [], model: 'gemini-flash-lite-latest', source: 'gemini', status: 'active',
  created: '2026-09-10', archivedOn: null, updated: '2026-09-10T18:00:00.000Z', ...fields,
});

test('journal records merge like any other record: one per id, later updated wins', () => {
  const asked = checkin();
  const answered = checkin({ answers: ['Well'], feedback: 'Good.', updated: '2026-09-10T18:05:00.000Z' });
  const a = { ...emptyDoc(), journal: { [asked.id]: asked } };
  const b = { ...emptyDoc(), journal: { [answered.id]: answered } };
  assert.equal(mergeDocs(a, b).journal[asked.id].feedback, 'Good.');
  assert.equal(S(mergeDocs(a, b)), S(mergeDocs(b, a)));
  assert.deepEqual(Object.keys(mergeDocs(a, b).journal), [asked.id]);
});

test('a document from before the journal merges cleanly with one that has it', () => {
  const old = { schema: 1, items: {}, goals: {}, milestones: {}, logs: {} };
  const rec = checkin({ feedback: 'Kept.' });
  assert.deepEqual(mergeDocs(old, null).journal, {});
  assert.equal(mergeDocs(old, { ...emptyDoc(), journal: { [rec.id]: rec } }).journal[rec.id].feedback, 'Kept.');
  assert.equal(sameDoc(old, emptyDoc()), true);
});
```

Append to the end of `tests/sync.test.js` (it already has `FakeGitHub`, `syncOnce`, `makeStore` and
`clock`):

```js

// ---- the journal (Gemini coach) ---------------------------------------------------------------

test('a sync file written before the journal existed is not rewritten just to add it', async () => {
  const gh = new FakeGitHub();
  gh.file = { doc: { schema: 1, items: {}, goals: {}, milestones: {}, logs: {} }, sha: 'old' };
  const store = makeStore();
  assert.deepEqual(await syncOnce({ store, client: gh }), { ok: true, pushed: false });
  assert.deepEqual(store.doc().journal, {});
  assert.equal(gh.puts, 0);
});

test('a check-in saved on one device reaches the other', async () => {
  const gh = new FakeGitHub();
  const now = clock(new Date(2026, 8, 10, 19, 0));
  const laptop = makeStore({ prefix: 'L', now });
  const phone = makeStore({ prefix: 'P', now });
  laptop.saveJournal({ kind: 'checkin', day: '2026-09-10', questions: ['How did the CV go?'], model: 'gemini-flash-lite-latest' });
  await syncOnce({ store: laptop, client: gh });
  await syncOnce({ store: phone, client: gh });
  assert.deepEqual(phone.doc().journal['checkin:2026-09-10'].questions, ['How did the CV go?']);
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `npm test`
Expected: FAIL —
- `tests/journal.test.js` doesn't load: `SyntaxError: The requested module '../js/doc.js' does not provide an export named 'journalId'`
- `a new store is empty, with default settings` — the key list has no `'journal'`
- `a document from before the journal merges cleanly with one that has it` — `journal` is `undefined`
- `a sync file written before the journal existed is not rewritten just to add it` — `journal` is `undefined`
- `a check-in saved on one device reaches the other` — `TypeError: laptop.saveJournal is not a function`

(`journal records merge like any other record` already passes, because unknown maps merge per record. It stays as a guard.)

- [ ] **Step 3: Replace `js/doc.js`**

```js
// The shape of the synced document, shared by the store and the merge.

export const MAPS = ['items', 'goals', 'milestones', 'logs', 'journal'];

export function emptyDoc() {
  return { schema: 1, items: {}, goals: {}, milestones: {}, logs: {}, journal: {} };
}

// One check-in per logical day and one digest per week (filed under that week's Monday), on
// every device: the id is the kind and the day, so two devices writing the same one merge into
// one record.
export function journalId(kind, day) {
  return `${kind}:${day}`;
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// A real dashboard document: a plain object with a numeric schema, an items map, and any of the
// other known maps either absent or themselves plain objects (never arrays). A document saved
// before the journal existed has no `journal` and is still a real document.
export function isDoc(value) {
  if (!isPlainObject(value)) return false;
  if (typeof value.schema !== 'number') return false;
  if (!isPlainObject(value.items)) return false;
  return MAPS.filter((k) => k !== 'items').every((k) => value[k] === undefined || isPlainObject(value[k]));
}

// JSON with object keys sorted at every depth, so two equal documents always serialise the same.
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
```

- [ ] **Step 4: Change `js/data.js`**

Make these seven replacements. Each old block appears exactly once.

4a. The imports at the top — replace:

```js
import { logicalDay } from './dates.js';
import { MAPS, emptyDoc, stableStringify, isDoc } from './doc.js';
```

with:

```js
import { logicalDay, addDays, weekStart } from './dates.js';
import { MAPS, emptyDoc, stableStringify, isDoc, journalId } from './doc.js';
```

4b. The settings defaults — replace:

```js
export const DEFAULT_SETTINGS = { token: '', repo: '', dayStartHour: 4 };
```

with:

```js
export const DEFAULT_SETTINGS = { token: '', repo: '', dayStartHour: 4, geminiKey: '', checkinHour: 18 };
```

4c. Just below it — replace:

```js
const ITEM_TYPES = ['task', 'habit', 'quota'];
```

with:

```js
const ITEM_TYPES = ['task', 'habit', 'quota'];

// The content each kind of journal record carries, with its empty values.
const JOURNAL_FIELDS = {
  checkin: { questions: [], answers: [], feedback: '', tomorrowIds: [], model: '' },
  digest: { summary: '', wins: [], slipped: [], focus: '', model: '' },
};
```

4d. Inside `createStore`, split `create` — replace:

```js
  function create(map, fields) {
    const rec = {
      source: 'me', status: 'active', created: today(), archivedOn: null,
      ...fields,
      id: fields.id ?? newId(),
      updated: stamp(),
    };
    doc[map][rec.id] = rec;
    commit('local');
    return rec;
  }
```

with:

```js
  // Writes a record into the document without saving, for callers that write several records
  // and then commit once.
  function build(map, fields) {
    const rec = {
      source: 'me', status: 'active', created: today(), archivedOn: null,
      ...fields,
      id: fields.id ?? newId(),
      updated: stamp(),
    };
    doc[map][rec.id] = rec;
    return rec;
  }

  function create(map, fields) {
    const rec = build(map, fields);
    commit('local');
    return rec;
  }
```

4e. Split `addItem` — replace:

```js
  function addItem(fields) {
    if (!ITEM_TYPES.includes(fields.type)) throw new Error(`Unknown item type ${fields.type}`);
    const title = requireTitle(fields.title, 'An item');
    if (fields.type === 'quota' && !(fields.target > 0)) throw new Error('A quota needs a target above 0');
    const defaults = { area: '', goalId: null, order: nextOrder('items') };
    if (fields.type === 'task') defaults.date = today();
    if (fields.type === 'habit') defaults.repeat = { kind: 'daily' };
    if (fields.type === 'quota') Object.assign(defaults, { unit: 'count', unitLabel: '' });
    return create('items', { ...defaults, ...fields, title });
  }
```

with:

```js
  // An item's fields, checked and with the defaults filled in. Nothing is written.
  function itemFields(fields) {
    if (!ITEM_TYPES.includes(fields.type)) throw new Error(`Unknown item type ${fields.type}`);
    const title = requireTitle(fields.title, 'An item');
    if (fields.type === 'quota' && !(fields.target > 0)) throw new Error('A quota needs a target above 0');
    const defaults = { area: '', goalId: null, order: nextOrder('items') };
    if (fields.type === 'task') defaults.date = today();
    if (fields.type === 'habit') defaults.repeat = { kind: 'daily' };
    if (fields.type === 'quota') Object.assign(defaults, { unit: 'count', unitLabel: '' });
    return { ...defaults, ...fields, title };
  }

  function addItem(fields) {
    return create('items', itemFields(fields));
  }
```

4f. Split `addGoal`, keep `addMilestone`, and add the four new methods after it — replace:

```js
  function addGoal(fields) {
    const title = requireTitle(fields.title, 'A goal');
    const defaults = { targetDate: null, target: null, unit: 'count', unitLabel: '', order: nextOrder('goals') };
    return create('goals', { ...defaults, ...fields, title });
  }

  function addMilestone(goalId, title) {
    return create('milestones', {
      goalId, title: requireTitle(title, 'A milestone'), done: false, order: nextOrder('milestones'),
    });
  }
```

with:

```js
  // A goal's fields, checked and with the defaults filled in. Nothing is written.
  function goalFields(fields) {
    const title = requireTitle(fields.title, 'A goal');
    const defaults = { targetDate: null, target: null, unit: 'count', unitLabel: '', order: nextOrder('goals') };
    return { ...defaults, ...fields, title };
  }

  function addGoal(fields) {
    return create('goals', goalFields(fields));
  }

  function addMilestone(goalId, title) {
    return create('milestones', {
      goalId, title: requireTitle(title, 'A milestone'), done: false, order: nextOrder('milestones'),
    });
  }

  // A check-in or a digest. The id comes from the kind and the day, so there is only ever one
  // check-in per day and one digest per week, whichever device writes it. Creates the record, or
  // overwrites just the content fields given on the existing one (so saving the answers keeps
  // the questions). Content is copied in, never shared with the caller.
  function saveJournal(record) {
    const kind = record?.kind;
    const fields = JOURNAL_FIELDS[kind];
    if (!fields) throw new Error(`Unknown journal kind ${kind}`);
    const day = record.day;
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || addDays(day, 0) !== day) {
      throw new Error(`A journal record needs a real day, not ${day}`);
    }
    if (kind === 'digest' && weekStart(day) !== day) throw new Error("A digest is filed under its week's Monday");
    const id = journalId(kind, day);
    if (record.id != null && record.id !== id) throw new Error(`A ${kind} for ${day} has the id ${id}`);
    const content = {};
    for (const key of Object.keys(fields)) {
      if (record[key] !== undefined) content[key] = structuredClone(record[key]);
    }
    const existing = doc.journal[id];
    if (!existing) return create('journal', { source: 'gemini', ...structuredClone(fields), ...content, id, kind, day });
    doc.journal[id] = { ...existing, ...content, id, kind, day, updated: stamp() };
    commit('local');
    return doc.journal[id];
  }

  // Everything one Gemini reply proposes, written as suggestions in one commit: a goal with its
  // milestones and the habits and weekly targets linked to it, and tasks for a given day. Every
  // record is checked before any is written, so one bad record leaves the document untouched.
  function addPlan({ goal = null, milestones = [], habits = [], targets = [], tasks = [] } = {}) {
    if (milestones.length && !goal) throw new Error('Milestones need a goal');
    const suggested = { status: 'suggested', source: 'gemini' };
    const goalRec = goal
      ? goalFields({ title: goal.title, targetDate: goal.targetDate ?? null, why: goal.why ?? '', ...suggested })
      : null;
    const goalId = goalRec ? newId() : null;
    const firstMilestone = nextOrder('milestones');
    const milestoneRecs = milestones.map((title, i) => ({
      goalId, title: requireTitle(title, 'A milestone'), done: false, order: firstMilestone + i, ...suggested,
    }));
    const firstItem = nextOrder('items');
    const itemRecs = [
      ...habits.map((h) => itemFields({
        type: 'habit', title: h.title, repeat: h.repeat ?? { kind: 'daily' }, goalId, ...suggested,
      })),
      ...targets.map((t) => itemFields({
        type: 'quota', title: t.title, target: t.target, unit: t.unit ?? 'count', unitLabel: t.unitLabel ?? '', goalId, ...suggested,
      })),
      ...tasks.map((t) => itemFields({ type: 'task', title: t.title, date: t.date ?? today(), goalId: null, ...suggested })),
    ].map((fields, i) => ({ ...fields, order: firstItem + i }));
    if (!goalRec && !itemRecs.length) return { goal: null, milestones: [], items: [] };
    const out = {
      goal: goalRec ? build('goals', { ...goalRec, id: goalId }) : null,
      milestones: milestoneRecs.map((fields) => build('milestones', fields)),
      items: itemRecs.map((fields) => build('items', fields)),
    };
    commit('local');
    return out;
  }

  // ✓ on a suggested goal: the goal and its still-suggested milestones go live from today. Its
  // proposed habits and targets stay suggestions on Today, to be accepted one by one.
  function acceptGoalPlan(goalId) {
    const goal = doc.goals[goalId];
    if (!goal) throw new Error(`No goals record ${goalId}`);
    const live = { status: 'active', created: today(), updated: stamp() };
    if (goal.status === 'suggested') doc.goals[goalId] = { ...goal, ...live };
    for (const [id, m] of Object.entries(doc.milestones)) {
      if (m.goalId === goalId && m.status === 'suggested') doc.milestones[id] = { ...m, ...live };
    }
    commit('local');
    return doc.goals[goalId];
  }

  // ✕ on a suggested goal: the goal, its still-suggested milestones and any still-suggested items
  // linked to it are dismissed. Anything already accepted is left alone.
  function dismissGoalPlan(goalId) {
    const goal = doc.goals[goalId];
    if (!goal) throw new Error(`No goals record ${goalId}`);
    const gone = { status: 'dismissed', updated: stamp() };
    if (goal.status === 'suggested') doc.goals[goalId] = { ...goal, ...gone };
    for (const map of ['milestones', 'items']) {
      for (const [id, rec] of Object.entries(doc[map])) {
        if (rec.goalId === goalId && rec.status === 'suggested') doc[map][id] = { ...rec, ...gone };
      }
    }
    commit('local');
  }
```

4g. In the returned store object, add the four methods after `archiveMilestone` — replace:

```js
    archiveMilestone: (id) => patch('milestones', id, { status: 'archived', archivedOn: today() }),
```

with:

```js
    archiveMilestone: (id) => patch('milestones', id, { status: 'archived', archivedOn: today() }),

    saveJournal,
    addPlan,
    acceptGoalPlan,
    dismissGoalPlan,
```

- [ ] **Step 5: Update the merge comment and the test fixture**

In `js/merge.js`, inside `mergeDocs`, replace the comment line:

```js
    // The four known maps are always record maps; any other key is one too if the side(s) that
```

with:

```js
    // The known maps (MAPS) are always record maps; any other key is one too if the side(s) that
```

In `tests/helpers.js`, replace the start of `fixture`:

```js
export function fixture({ items = [], logs = [], goals = [], milestones = [] } = {}) {
  const doc = emptyDoc();
  const base = {
    source: 'me', status: 'active', created: '2026-09-01', archivedOn: null,
    updated: '2026-09-01T09:00:00.000Z',
  };
  for (const [map, list] of Object.entries({ items, logs, goals, milestones })) {
```

with:

```js
export function fixture({ items = [], logs = [], goals = [], milestones = [], journal = [] } = {}) {
  const doc = emptyDoc();
  const base = {
    source: 'me', status: 'active', created: '2026-09-01', archivedOn: null,
    updated: '2026-09-01T09:00:00.000Z',
  };
  for (const [map, list] of Object.entries({ items, logs, goals, milestones, journal })) {
```

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — 127 tests (108 before, plus 15 in `journal.test.js`, 2 in `merge.test.js` and 2 in `sync.test.js`).

- [ ] **Step 7: Commit**

```bash
git add js/doc.js js/data.js js/merge.js tests/helpers.js tests/journal.test.js tests/data.test.js tests/merge.test.js tests/sync.test.js
git commit -m "Add the journal map, coach settings and plan store methods" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
