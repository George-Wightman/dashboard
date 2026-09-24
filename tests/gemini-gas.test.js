// Gemini from the planner: several questions at once over UrlFetchApp.fetchAll, a fallback model,
// and a day's allowance that is respected and remembered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGemini } from '../planner/gemini-gas.js';

const KEY = 'AIzaDummyKey_0123456789';
const MODELS = { think: 'gemini-flash-latest', check: 'gemini-flash-lite-latest' };
const reply = (obj) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } });
const PER_DAY = { status: 429, body: { error: { code: 429, message: 'Quota exceeded for metric: generate_content_free_tier_requests, quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier' } } };
const PER_MINUTE = { status: 429, body: { error: { code: 429, message: 'Quota exceeded, quotaId: GenerateRequestsPerMinutePerProjectPerModel-FreeTier. Please retry in 30s.' } } };

function fakeFetch(handler) {
  const batches = [];
  const respond = (r) => { const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body); return { getResponseCode: () => r.status, getContentText: () => text }; };
  return {
    batches,
    fetchAll(requests) {
      batches.push(requests);
      return requests.map((req) => respond(handler(req.url.split('/models/')[1].split(':')[0], JSON.parse(req.payload), req)));
    },
    fetch() { throw new Error('use fetchAll'); },
  };
}

function budget(left = 100) {
  const b = { left: () => left, spend: (n) => { left -= n; b.spent += n; }, blocked: new Set(), spent: 0 };
  return b;
}

test('several questions go out together, and the answers come back in order', async () => {
  const UrlFetchApp = fakeFetch((model, body) => reply({ echo: body.contents[0].parts[0].text, model }));
  const b = budget();
  const gemini = createGemini({ UrlFetchApp, key: KEY, models: MODELS, budget: b });
  const out = await gemini.ask([
    { system: 'S', prompt: 'one', model: 'think' },
    { system: 'S', prompt: 'two', model: 'check' },
    { system: 'S', prompt: 'three', model: 'think' },
  ]);
  assert.equal(UrlFetchApp.batches.length, 1);
  assert.equal(UrlFetchApp.batches[0].length, 3);
  assert.deepEqual(out.map((r) => r.data.echo), ['one', 'two', 'three']);
  assert.deepEqual(out.map((r) => r.model), [MODELS.think, MODELS.check, MODELS.think]);
  assert.equal(b.spent, 3);
  const req = UrlFetchApp.batches[0][0];
  assert.equal(req.method, 'post');
  assert.equal(req.muteHttpExceptions, true);
  const body = JSON.parse(req.payload);
  assert.equal(body.systemInstruction.parts[0].text, 'S');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
});

test('a server error on the thinking model is asked again on the other one', async () => {
  let n = 0;
  const UrlFetchApp = fakeFetch((model) => (model === MODELS.think && ++n === 1 ? { status: 503, body: 'overloaded' } : reply({ ok: model })));
  const gemini = createGemini({ UrlFetchApp, key: KEY, models: MODELS, budget: budget() });
  const out = await gemini.ask([{ system: 'S', prompt: 'a', model: 'think' }, { system: 'S', prompt: 'b', model: 'think' }]);
  assert.equal(UrlFetchApp.batches.length, 2);
  assert.equal(UrlFetchApp.batches[1].length, 1);
  assert.deepEqual(out.map((r) => r.data.ok), [MODELS.check, MODELS.think]);
});

test("a day's quota used up on one model moves the rest of the day to the other; on both, it stops", async () => {
  const UrlFetchApp = fakeFetch((model) => (model === MODELS.think ? PER_DAY : reply({ ok: model })));
  const b = budget();
  const gemini = createGemini({ UrlFetchApp, key: KEY, models: MODELS, budget: b });
  let out = await gemini.ask([{ system: 'S', prompt: 'a', model: 'think' }]);
  assert.equal(out[0].data.ok, MODELS.check);
  assert.deepEqual([...b.blocked], [MODELS.think]);
  UrlFetchApp.batches.length = 0;
  out = await gemini.ask([{ system: 'S', prompt: 'b', model: 'think' }]);
  assert.equal(UrlFetchApp.batches[0][0].url.includes(MODELS.check), true, 'straight to the model that still has quota');
  const none = fakeFetch(() => PER_DAY);
  const b2 = budget();
  out = await createGemini({ UrlFetchApp: none, key: KEY, models: MODELS, budget: b2 }).ask([{ system: 'S', prompt: 'c', model: 'think' }]);
  assert.deepEqual(out, [{ error: 'quota' }]);
  assert.deepEqual([...b2.blocked].sort(), [MODELS.think, MODELS.check].sort());
  assert.deepEqual(await createGemini({ UrlFetchApp: none, key: KEY, models: MODELS, budget: b2 }).ask([{ system: 'S', prompt: 'd', model: 'check' }]), [{ error: 'quota' }]);
});

test('a per-minute limit is only a pause, not the end of the day', async () => {
  const UrlFetchApp = fakeFetch(() => PER_MINUTE);
  const b = budget();
  const out = await createGemini({ UrlFetchApp, key: KEY, models: MODELS, budget: b }).ask([{ system: 'S', prompt: 'a', model: 'check' }]);
  assert.deepEqual(out, [{ error: 'busy' }]);
  assert.equal(b.blocked.size, 0);
});

test('no budget, no key, or nonsense back', async () => {
  const UrlFetchApp = fakeFetch(() => reply({ ok: 1 }));
  const three = [1, 2, 3].map((p) => ({ system: 'S', prompt: String(p), model: 'think' }));
  assert.deepEqual(await createGemini({ UrlFetchApp, key: KEY, models: MODELS, budget: budget(2) }).ask(three), three.map(() => ({ error: 'budget' })));
  assert.equal(UrlFetchApp.batches.length, 0);
  assert.deepEqual(await createGemini({ UrlFetchApp, key: '', models: MODELS, budget: budget() }).ask(three.slice(0, 1)), [{ error: 'nokey' }]);
  const junk = fakeFetch(() => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: 'not json at all' }] } }] } }));
  assert.deepEqual(await createGemini({ UrlFetchApp: junk, key: KEY, models: MODELS, budget: budget() }).ask(three.slice(0, 1)), [{ error: 'nonsense' }]);
  const refused = fakeFetch(() => ({ status: 400, body: { error: { message: 'API key not valid. Please pass a valid API key.' } } }));
  assert.deepEqual(await createGemini({ UrlFetchApp: refused, key: KEY, models: MODELS, budget: budget() }).ask(three.slice(0, 1)), [{ error: 'badkey' }]);
});

test('the key never reaches the log', async () => {
  const lines = [];
  const UrlFetchApp = fakeFetch(() => ({ status: 500, body: `boom for key ${KEY}` }));
  await createGemini({ UrlFetchApp, key: KEY, models: MODELS, budget: budget(), log: (t) => lines.push(t) }).ask([{ system: 'S', prompt: 'a', model: 'think' }]);
  assert.ok(lines.length > 0);
  assert.ok(lines.every((l) => !l.includes(KEY)));
});
