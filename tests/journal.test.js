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
  assert.deepEqual(DEFAULT_SETTINGS, { token: '', repo: '', dayStartHour: 4, geminiKey: '', checkinHour: 18, look: 'auto' });
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
