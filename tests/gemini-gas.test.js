// Gemini from the planner: several questions at once over UrlFetchApp.fetchAll, Flash asked to think
// hard, models switched on the fly, and a day's allowance — per model — respected and remembered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGemini } from '../planner/gemini-gas.js';

const KEY = 'AIzaDummyKey_0123456789';
const MODELS = { think: 'gemini-flash-latest', check: 'gemini-flash-lite-latest' };
const reply = (obj) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } });
const PER_DAY = { status: 429, body: { error: { code: 429, message: 'Quota exceeded for metric: generate_content_free_tier_requests, quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier' } } };
const PER_MINUTE = { status: 429, body: { error: { code: 429, message: 'Quota exceeded, quotaId: GenerateRequestsPerMinutePerProjectPerModel-FreeTier. Please retry in 30s.' } } };
const NO_THINKING = { status: 400, body: { error: { code: 400, message: 'Thinking level is not supported for this model.' } } };

function fakeFetch(handler) {
  const batches = [];
  const respond = (r) => { const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body); return { getResponseCode: () => r.status, getContentText: () => text }; };
  return {
    batches,
    fetchAll(requests) {
      batches.push(requests);
      return requests.map((req) => respond(handler(req.url.split('/models/')[1].split(':')[0], JSON.parse(req.payload), req)));
    },
  };
}

// The day's allowance: `total` calls in all, Flash capped at `flash`.
function budget({ total = 100, flash = 20 } = {}) {
  const used = {};
  const b = {
    left: () => total - Object.values(used).reduce((a, n) => a + n, 0),
    modelLeft: (m) => (m === MODELS.think ? flash - (used[m] ?? 0) : Infinity),
    spend: (m, n) => { used[m] = (used[m] ?? 0) + n; },
    blocked: new Set(), used,
  };
  return b;
}
const make = (UrlFetchApp, b = budget(), extra = {}) => createGemini({ UrlFetchApp, key: KEY, models: MODELS, budget: b, ...extra });

test('several questions go out together, answers come back in order, and each model is counted', async () => {
  const UrlFetchApp = fakeFetch((model, body) => reply({ echo: body.contents[0].parts[0].text, model }));
  const b = budget();
  const out = await make(UrlFetchApp, b).ask([
    { system: 'S', prompt: 'one', model: 'think' }, { system: 'S', prompt: 'two', model: 'check' }, { system: 'S', prompt: 'three', model: 'think' },
  ]);
  assert.equal(UrlFetchApp.batches.length, 1);
  assert.deepEqual(out.map((r) => [r.data.echo, r.model, r.role]), [['one', MODELS.think, 'think'], ['two', MODELS.check, 'check'], ['three', MODELS.think, 'think']]);
  assert.deepEqual(b.used, { [MODELS.think]: 2, [MODELS.check]: 1 });
  const req = UrlFetchApp.batches[0][0];
  assert.equal(req.method, 'post');
  assert.equal(req.muteHttpExceptions, true);
  assert.equal(JSON.parse(req.payload).generationConfig.responseMimeType, 'application/json');
});

test('Flash is asked to think hard; a model that won\'t take it is asked again without, and that isn\'t counted', async () => {
  let n = 0;
  const UrlFetchApp = fakeFetch((model, body) => {
    if (model === MODELS.think && body.generationConfig.thinkingConfig && ++n === 1) return NO_THINKING;
    return reply({ thought: !!body.generationConfig.thinkingConfig });
  });
  const b = budget();
  const g = make(UrlFetchApp, b);
  let [r] = await g.ask([{ system: 'S', prompt: 'deep', model: 'think', think: true }]);
  assert.equal(JSON.parse(UrlFetchApp.batches[0][0].payload).generationConfig.thinkingConfig.thinkingLevel, 'HIGH');
  assert.deepEqual(r.data, { thought: false });
  assert.equal(r.role, 'think');
  assert.equal(b.used[MODELS.think], 1, 'the refused try is free');
  [r] = await g.ask([{ system: 'S', prompt: 'lite', model: 'check', think: true }]);
  assert.equal(JSON.parse(UrlFetchApp.batches.at(-1)[0].payload).generationConfig.thinkingConfig, undefined, 'Lite is never asked to think');
});

test('switching models on the fly: a server error, a busy minute, or Flash capped for the day', async () => {
  // Overloaded once: a pause, and Flash answers after all — and only answers are counted.
  let calls = 0;
  const waits = [];
  let UrlFetchApp = fakeFetch((model) => (model === MODELS.think && ++calls === 1 ? { status: 503, body: 'overloaded' } : reply({ ok: model })));
  const once = budget();
  let g = make(UrlFetchApp, once, { sleep: (ms) => waits.push(ms) });
  let out = await g.ask([{ system: 'S', prompt: 'a', model: 'think' }, { system: 'S', prompt: 'b', model: 'think' }]);
  assert.deepEqual(out.map((r) => [r.data.ok, r.role]), [[MODELS.think, 'think'], [MODELS.think, 'think']]);
  assert.deepEqual(waits, [5000]);
  assert.deepEqual(once.used, { [MODELS.think]: 2 }, 'the 503 cost nothing');
  // Overloaded all day (25 Sep): Lite answers, and the note says why.
  UrlFetchApp = fakeFetch((model) => (model === MODELS.think ? { status: 503, body: { error: { code: 503, message: 'This model is currently experiencing high demand.' } } } : reply({ ok: model })));
  const allDay = budget();
  g = make(UrlFetchApp, allDay);
  out = await g.ask([{ system: 'S', prompt: 'a', model: 'think' }]);
  assert.deepEqual([out[0].data.ok, out[0].role], [MODELS.check, 'check']);
  assert.deepEqual(allDay.used, { [MODELS.check]: 1 }, "Flash's allowance untouched");
  assert.match(g.notes().join(), /gemini-flash-latest was overloaded \(HTTP 503\), so gemini-flash-lite-latest answered/);

  UrlFetchApp = fakeFetch((model) => (model === MODELS.think ? PER_MINUTE : reply({ ok: model })));
  const b = budget();
  g = make(UrlFetchApp, b);
  out = await g.ask([{ system: 'S', prompt: 'a', model: 'think' }]);
  assert.equal(out[0].data.ok, MODELS.check);
  assert.equal(b.blocked.size, 0, 'a busy minute is not the end of the day');
  assert.match(g.notes().join(), /was busy for a minute/);

  const capped = budget({ flash: 0 });
  UrlFetchApp = fakeFetch((model) => reply({ ok: model }));
  g = make(UrlFetchApp, capped);
  assert.equal(g.available('think'), false);
  out = await g.ask([{ system: 'S', prompt: 'a', model: 'think' }]);
  assert.equal(out[0].data.ok, MODELS.check, 'Flash capped: straight to Lite');
  assert.equal(UrlFetchApp.batches[0].length, 1);
});

test("a day's quota used up on one model moves the rest of the day to the other; on both, it stops", async () => {
  let UrlFetchApp = fakeFetch((model) => (model === MODELS.think ? PER_DAY : reply({ ok: model })));
  const b = budget();
  let g = make(UrlFetchApp, b);
  let out = await g.ask([{ system: 'S', prompt: 'a', model: 'think' }]);
  assert.equal(out[0].data.ok, MODELS.check);
  assert.deepEqual([...b.blocked], [MODELS.think]);
  UrlFetchApp.batches.length = 0;
  out = await g.ask([{ system: 'S', prompt: 'b', model: 'think' }]);
  assert.ok(UrlFetchApp.batches[0][0].url.includes(MODELS.check), 'straight to the model that still has quota');
  UrlFetchApp = fakeFetch(() => PER_DAY);
  const b2 = budget();
  g = make(UrlFetchApp, b2);
  assert.deepEqual(await g.ask([{ system: 'S', prompt: 'c', model: 'think' }]), [{ error: 'quota' }]);
  assert.deepEqual([...b2.blocked].sort(), [MODELS.think, MODELS.check].sort());
  assert.deepEqual(await g.ask([{ system: 'S', prompt: 'd', model: 'check' }]), [{ error: 'quota' }]);
});

test('no budget, no key, a refused key, and nonsense back', async () => {
  const UrlFetchApp = fakeFetch(() => reply({ ok: 1 }));
  const three = [1, 2, 3].map((p) => ({ system: 'S', prompt: String(p), model: 'think' }));
  assert.deepEqual(await make(UrlFetchApp, budget({ total: 2 })).ask(three), three.map(() => ({ error: 'budget' })));
  assert.equal(UrlFetchApp.batches.length, 0);
  assert.deepEqual(await createGemini({ UrlFetchApp, key: '', models: MODELS, budget: budget() }).ask(three.slice(0, 1)), [{ error: 'nokey' }]);
  const refused = fakeFetch(() => ({ status: 400, body: { error: { message: 'API key not valid. Please pass a valid API key.' } } }));
  assert.deepEqual(await make(refused).ask(three.slice(0, 1)), [{ error: 'badkey' }]);
  const junk = fakeFetch(() => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: 'not json at all' }] } }] } }));
  assert.deepEqual(await make(junk).ask(three.slice(0, 1)), [{ error: 'nonsense' }], 'nonsense from both models');
});

test('the key never reaches the log', async () => {
  const lines = [];
  const UrlFetchApp = fakeFetch(() => ({ status: 500, body: `boom for key ${KEY}` }));
  await make(UrlFetchApp, budget(), { log: (t) => lines.push(t) }).ask([{ system: 'S', prompt: 'a', model: 'think' }]);
  assert.ok(lines.length > 0);
  assert.ok(lines.every((l) => !l.includes(KEY)));
});
