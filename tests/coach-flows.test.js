import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startCheckin, sendCheckin, shapeGoal, writeDigest } from '../js/ui/coach.js';
import { checkinOf } from '../js/coach.js';
import { GeminiError } from '../js/gemini.js';
import { makeStore } from './helpers.js';

// ---- test doubles -------------------------------------------------------------------------------

function coachUi() {
  return {
    busy: '', error: '', answers: [], notNow: '', feedbackOpen: true,
    shapeOpen: false, shapeText: '', shapeBusy: false, shapeError: '',
    digestOpen: false, digestBusy: false, digestError: '', digestTried: false,
  };
}

// A stub ctx driving the real flow functions in js/ui/coach.js: a real store, page-only ui state
// shaped like js/app.js's, a no-op render, and a fake Gemini that resolves/rejects on command.
function makeCtx({ store, ask, keys = () => ['fake-key'], syncNow, whenIdle } = {}) {
  const renders = [];
  const ctx = {
    store,
    ui: { coach: coachUi() },
    render: () => { renders.push(1); },
    renders,
    syncNow: syncNow ?? (async () => {}),
    whenIdle: whenIdle ?? (async () => {}),
    coach: { fake: null, keys, ask },
  };
  return ctx;
}

// A promise this test controls: resolve it whenever the scenario calls for the Gemini reply (or
// ctx.whenIdle) to land.
function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

const day = (store) => store.today();

function finishedCheckinRecord(today, { answers = ['done'], feedback = 'Nice work today.' } = {}) {
  return {
    id: `checkin:${today}`, kind: 'checkin', day: today, source: 'gemini', status: 'active',
    created: today, archivedOn: null, updated: '2026-09-10T20:00:00.000Z',
    questions: ['Original question?'], answers, feedback, tomorrowIds: [], model: 'gemini-flash-lite-latest',
  };
}

// ---- C1: never overwrite a check-in another device already moved on ----------------------------

test('startCheckin: a check-in finished on another device while Gemini is thought about is left untouched', async () => {
  const store = makeStore();
  const today = day(store);
  const gate = deferred();
  const ctx = makeCtx({ store, ask: () => gate.promise });

  const p = startCheckin(ctx);
  // Another device's finished check-in arrives mid-flight, via a sync merge.
  const finished = { ...store.doc(), journal: { [`checkin:${today}`]: finishedCheckinRecord(today) } };
  store.replaceDoc(finished);

  gate.resolve({ data: { questions: ['New q1?', 'New q2?'] }, model: 'gemini-flash-lite-latest' });
  await p;

  const rec = checkinOf(store.doc(), today);
  assert.deepEqual(rec.answers, ['done']);
  assert.equal(rec.feedback, 'Nice work today.');
  assert.equal(ctx.ui.coach.error, '');
});

test("sendCheckin: feedback arriving from another device while Gemini is thought about is not overwritten, and no tomorrow tasks are added", async () => {
  const store = makeStore();
  const today = day(store);
  store.saveJournal({ kind: 'checkin', day: today, questions: ['How did today go?'], model: 'gemini-flash-lite-latest' });
  const gate = deferred();
  const ctx = makeCtx({ store, ask: () => gate.promise });
  ctx.ui.coach.answers = ['Went fine'];

  const p = sendCheckin(ctx);
  const finished = {
    ...store.doc(),
    journal: { [`checkin:${today}`]: finishedCheckinRecord(today, { answers: ['Went fine'], feedback: 'Already answered elsewhere.' }) },
  };
  store.replaceDoc(finished);

  gate.resolve({ data: { feedback: 'Feedback from this device.', tomorrow: [{ title: 'Should not land' }] }, model: 'gemini-flash-lite-latest' });
  await p;

  const rec = checkinOf(store.doc(), today);
  assert.equal(rec.feedback, 'Already answered elsewhere.');
  assert.equal(ctx.ui.coach.error, "This check-in was changed on another device — here's what it says now.");
  assert.equal(Object.values(store.doc().items).length, 0);
});

test('the normal path still saves questions, then answers + feedback + tomorrowIds', async () => {
  const store = makeStore();
  const today = day(store);
  const ctx = makeCtx({ store, ask: async () => ({ data: { questions: ['Q1?', 'Q2?'] }, model: 'gemini-flash-lite-latest' }) });

  await startCheckin(ctx);
  let rec = checkinOf(store.doc(), today);
  assert.deepEqual(rec.questions, ['Q1?', 'Q2?']);
  assert.deepEqual(rec.answers, []);
  assert.equal(rec.feedback, '');

  ctx.ui.coach.answers = ['Good progress', 'Rest'];
  ctx.coach.ask = async () => ({
    data: { feedback: 'Solid day.', tomorrow: [{ title: 'Follow up' }] }, model: 'gemini-flash-lite-latest',
  });
  await sendCheckin(ctx);
  rec = checkinOf(store.doc(), today);
  assert.deepEqual(rec.questions, ['Q1?', 'Q2?']);
  assert.deepEqual(rec.answers, ['Good progress', 'Rest']);
  assert.equal(rec.feedback, 'Solid day.');
  assert.equal(rec.tomorrowIds.length, 1);
  assert.equal(ctx.ui.coach.error, '');
});

// ---- D2: sync before sending a check-in ---------------------------------------------------------

test('sendCheckin: syncNow is called before ctx.coach.ask', async () => {
  const store = makeStore();
  const today = day(store);
  store.saveJournal({ kind: 'checkin', day: today, questions: ['How did today go?'], model: 'gemini-flash-lite-latest' });
  const order = [];
  const ctx = makeCtx({
    store,
    ask: async () => { order.push('ask'); return { data: { feedback: 'Solid day.', tomorrow: [] }, model: 'gemini-flash-lite-latest' }; },
    syncNow: async () => { order.push('sync'); },
  });
  ctx.ui.coach.answers = ['Went fine'];

  await sendCheckin(ctx);

  assert.deepEqual(order, ['sync', 'ask']);
});

// ---- D3: don't wait more than 5 seconds for sync before asking ---------------------------------

test('startCheckin: a sync that never resolves does not stop the request being asked (ctx.coach.syncWaitMs shortens the cap)', async () => {
  const store = makeStore();
  const today = day(store);
  const ctx = makeCtx({
    store,
    ask: async () => ({ data: { questions: ['Q1?', 'Q2?'] }, model: 'gemini-flash-lite-latest' }),
    syncNow: () => new Promise(() => {}), // never resolves
  });
  ctx.coach.syncWaitMs = 15;

  await startCheckin(ctx);

  assert.deepEqual(checkinOf(store.doc(), today)?.questions, ['Q1?', 'Q2?']);
});

// ---- C2: land coach replies only when nothing is being typed -----------------------------------

// Lets pending microtasks (the fake ask() resolving, consult()'s own await) drain before we
// inspect state, without resolving whatever the test itself is holding back.
const tick = () => new Promise((r) => { setTimeout(r, 0); });

test('startCheckin: the store write waits for ctx.whenIdle before landing', async () => {
  const store = makeStore();
  const today = day(store);
  const gate = deferred();
  const ctx = makeCtx({
    store,
    ask: async () => ({ data: { questions: ['Q1?', 'Q2?'] }, model: 'gemini-flash-lite-latest' }),
    whenIdle: () => gate.promise,
  });

  const p = startCheckin(ctx);
  await tick();
  assert.equal(checkinOf(store.doc(), today), null);

  gate.resolve();
  await p;
  assert.deepEqual(checkinOf(store.doc(), today)?.questions, ['Q1?', 'Q2?']);
});

test("writeDigest: a quiet failure still re-renders once, to clear 'Writing…', but only after ctx.whenIdle resolves", async () => {
  const store = makeStore();
  const gate = deferred();
  const ctx = makeCtx({
    store,
    ask: async () => { throw new GeminiError('failed'); },
    whenIdle: () => gate.promise,
  });

  const p = writeDigest(ctx, { quiet: true });
  await tick();
  const rendersBeforeIdle = ctx.renders.length;

  gate.resolve();
  await p;
  assert.ok(ctx.renders.length > rendersBeforeIdle);
  assert.equal(ctx.ui.coach.digestError, ''); // quiet: still no error line
  assert.equal(ctx.ui.coach.digestBusy, false);
});

// ---- C5: keep text typed while a goal is being shaped -------------------------------------------

test('shapeGoal: closes the box and clears the text when nothing was typed meanwhile', async () => {
  const store = makeStore();
  const ctx = makeCtx({ store, ask: async () => ({ data: { title: 'Run a 10k' }, model: 'gemini-flash-lite-latest' }) });
  ctx.ui.coach.shapeOpen = true;
  ctx.ui.coach.shapeText = 'Get fit for a 10k';

  await shapeGoal(ctx, 'Get fit for a 10k');

  assert.equal(ctx.ui.coach.shapeOpen, false);
  assert.equal(ctx.ui.coach.shapeText, '');
  assert.equal(Object.values(store.doc().goals).length, 1);
});

test('shapeGoal: keeps the box open with the new text if he kept typing while it was being shaped', async () => {
  const store = makeStore();
  const gate = deferred();
  const ctx = makeCtx({ store, ask: () => gate.promise });
  ctx.ui.coach.shapeOpen = true;
  ctx.ui.coach.shapeText = 'Get fit for a 10k';

  const p = shapeGoal(ctx, 'Get fit for a 10k');
  await tick();
  ctx.ui.coach.shapeText = 'Actually, learn Spanish';
  gate.resolve({ data: { title: 'Run a 10k' }, model: 'gemini-flash-lite-latest' });
  await p;

  assert.equal(ctx.ui.coach.shapeOpen, true);
  assert.equal(ctx.ui.coach.shapeText, 'Actually, learn Spanish');
  assert.equal(Object.values(store.doc().goals).length, 1); // the goal is still added
});
