import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeDigest } from '../js/ui/coach.js';
import { GeminiError } from '../js/gemini.js';
import { makeStore } from './helpers.js';

// The digest (the conversation's flows are in tests/coach-talk.test.js).

// ---- test doubles -------------------------------------------------------------------------------

function coachUi() {
  return {
    talk: null, draft: '', talkBusy: '', talkError: '', editing: null, sheet: false, tried: {},
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

// Lets pending microtasks (the fake ask() resolving, consult()'s own await) drain before we
// inspect state, without resolving whatever the test itself is holding back.
const tick = () => new Promise((r) => { setTimeout(r, 0); });

// ---- C2: land coach replies only when nothing is being typed -----------------------------------

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

