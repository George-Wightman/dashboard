import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  askGemini, geminiKeys, hebrewKeys, readReply, retryAfterSeconds, GeminiError, MESSAGES, MODELS, ENDPOINT,
} from '../js/gemini.js';
import { MemoryStorage } from './helpers.js';

const KEY = 'AIzaSy-test-SECRET-123';
const LITE = 'gemini-flash-lite-latest';
const FLASH = 'gemini-flash-latest';

// ---- fakes -------------------------------------------------------------------------------------

function response(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text };
}

// A 200 whose one text part is `value` (a string as is, anything else as JSON).
const reply = (value) => response(200, {
  candidates: [{ content: { parts: [{ text: typeof value === 'string' ? value : JSON.stringify(value) }] } }],
});

const failure = (status, message) => response(status, { error: { code: status, message } });

// Answers each request with the next step of the script: a response, 'network' (it never reaches
// Google) or 'hang' (no answer until the request is aborted). Records every request.
function fakeFetch(...script) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    calls.push({
      url, init, body: JSON.parse(init.body),
      model: u.pathname.split('/').pop().split(':')[0], key: u.searchParams.get('key'),
    });
    const step = script[calls.length - 1];
    if (step === undefined) throw new Error(`unexpected request ${calls.length}`);
    if (step === 'network') throw new TypeError('Failed to fetch');
    if (step === 'hang') {
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      });
    }
    return step;
  };
  fetch.calls = calls;
  return fetch;
}

// Timers that only fire when the test says so. `history` is every delay ever asked for.
function fakeTimers() {
  let next = 1;
  const pending = new Map();
  const history = [];
  return {
    history,
    setTimeout(fn, ms) { const id = next++; pending.set(id, { fn, ms }); history.push(ms); return id; },
    clearTimeout(id) { pending.delete(id); },
    delays() { return [...pending.values()].map((t) => t.ms); },
    fire(ms) {
      for (const [id, t] of pending) {
        if (t.ms === ms) { pending.delete(id); t.fn(); return true; }
      }
      return false;
    },
  };
}

// Let pending promise callbacks run (no real timers involved) until `ready()` is true.
async function until(ready, what) {
  for (let i = 0; i < 100; i++) {
    if (ready()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`never saw ${what}`);
}

const ask = (fetch, timers = fakeTimers(), extra = {}) =>
  askGemini({ keys: [KEY], system: 'SYS', prompt: 'PROMPT', fetch, timers, ...extra });

const rejectsWith = (promise, code) => assert.rejects(promise, (e) => {
  assert.ok(e instanceof GeminiError, `not a GeminiError: ${e}`);
  assert.equal(e.code, code);
  assert.equal(e.message, MESSAGES[code]);
  return true;
});

// ---- the request -------------------------------------------------------------------------------

test('the models, lite first, and the endpoint', () => {
  assert.deepEqual(MODELS, [LITE, FLASH]);
  assert.equal(ENDPOINT, 'https://generativelanguage.googleapis.com/v1beta/models');
});

test('asks the lite model first with the agreed body, and returns the JSON and the model', async () => {
  const timers = fakeTimers();
  const fetch = fakeFetch(reply({ questions: ['How did the CV go?'] }));
  const out = await ask(fetch, timers);
  assert.deepEqual(out, { data: { questions: ['How did the CV go?'] }, model: LITE });
  const [call] = fetch.calls;
  assert.equal(call.url, `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${KEY}`);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(call.body, {
    systemInstruction: { parts: [{ text: 'SYS' }] },
    contents: [{ role: 'user', parts: [{ text: 'PROMPT' }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.6 },
  });
  assert.ok(!call.init.body.includes('thinking'));
  assert.deepEqual(timers.delays(), []); // the 30 s timeout was cleared
});

test('no key: refuses at once without a request', async () => {
  const fetch = fakeFetch();
  await rejectsWith(askGemini({ keys: ['', '  '], system: 'S', prompt: 'P', fetch }), 'nokey');
  await rejectsWith(askGemini({ system: 'S', prompt: 'P', fetch }), 'nokey');
  assert.equal(fetch.calls.length, 0);
  assert.equal(MESSAGES.nokey, 'No Gemini key. Add one in ⚙, or save one in the Hebrew app on this device.');
});

// ---- falling back ------------------------------------------------------------------------------

test('a 5xx from lite falls back to flash', async () => {
  const fetch = fakeFetch(failure(503, 'The model is overloaded.'), reply({ ok: 1 }));
  const out = await ask(fetch);
  assert.deepEqual(fetch.calls.map((c) => c.model), [LITE, FLASH]);
  assert.deepEqual(out, { data: { ok: 1 }, model: FLASH });
});

test('a network error falls back to the next model', async () => {
  const fetch = fakeFetch('network', reply({ ok: 1 }));
  assert.equal((await ask(fetch)).model, FLASH);
});

test('no answer within 30 seconds: the request is abandoned for the next model', async () => {
  const timers = fakeTimers();
  const fetch = fakeFetch('hang', reply({ ok: 1 }));
  const pending = ask(fetch, timers);
  await until(() => timers.delays().includes(30000), 'the timeout');
  timers.fire(30000);
  const out = await pending;
  assert.equal(out.model, FLASH);
  assert.equal(fetch.calls[0].init.signal.aborted, true);
});

test('the timeout can be set', async () => {
  const timers = fakeTimers();
  const fetch = fakeFetch('hang', reply({ ok: 1 }));
  const pending = ask(fetch, timers, { timeoutMs: 5000 });
  await until(() => timers.delays().includes(5000), 'a 5 s timeout');
  timers.fire(5000);
  assert.equal((await pending).model, FLASH);
});

test('a 400 is retried once on the same model with a plain body', async () => {
  const fetch = fakeFetch(failure(400, 'Invalid JSON payload received.'), reply('```json\n{"ok":1}\n```'));
  const out = await ask(fetch);
  assert.deepEqual(out, { data: { ok: 1 }, model: LITE });
  assert.deepEqual(fetch.calls.map((c) => c.model), [LITE, LITE]);
  assert.deepEqual(fetch.calls[1].body, { contents: [{ role: 'user', parts: [{ text: 'SYS\n\nPROMPT' }] }] });
});

test('a second 400 moves on to the next model, with the full body again', async () => {
  const fetch = fakeFetch(failure(400, 'Bad'), failure(400, 'Still bad'), reply({ ok: 1 }));
  const out = await ask(fetch);
  assert.deepEqual(fetch.calls.map((c) => c.model), [LITE, LITE, FLASH]);
  assert.deepEqual(fetch.calls[2].body.generationConfig, { responseMimeType: 'application/json', temperature: 0.6 });
  assert.equal(out.model, FLASH);
});

// ---- 429s --------------------------------------------------------------------------------------

test('a 429 that says "retry in 7s" waits 7 seconds and retries the same model once', async () => {
  const timers = fakeTimers();
  const fetch = fakeFetch(failure(429, 'Quota exceeded. Please retry in 7s.'), reply({ ok: 1 }));
  const pending = ask(fetch, timers);
  await until(() => timers.delays().includes(7000), 'the 7 s wait');
  assert.equal(fetch.calls.length, 1); // nothing is sent during the wait
  timers.fire(7000);
  const out = await pending;
  assert.deepEqual(fetch.calls.map((c) => c.model), [LITE, LITE]);
  assert.equal(out.model, LITE);
});

test('a second short 429 on the same model moves on to the next model', async () => {
  const timers = fakeTimers();
  const fetch = fakeFetch(failure(429, 'Please retry in 7s.'), failure(429, 'Please retry in 7s.'), reply({ ok: 1 }));
  const pending = ask(fetch, timers);
  await until(() => timers.delays().includes(7000), 'the wait');
  timers.fire(7000);
  const out = await pending;
  assert.deepEqual(fetch.calls.map((c) => c.model), [LITE, LITE, FLASH]);
  assert.equal(out.model, FLASH);
  assert.equal(timers.history.filter((ms) => ms === 7000).length, 1);
});

test('a 429 with a long or missing retry hint moves straight on to the next model', async () => {
  const timers = fakeTimers();
  const long = fakeFetch(failure(429, 'Please retry in 45s.'), reply({ ok: 1 }));
  assert.equal((await ask(long, timers)).model, FLASH);
  assert.deepEqual(long.calls.map((c) => c.model), [LITE, FLASH]);
  assert.ok(!timers.history.includes(45000));
  const none = fakeFetch(failure(429, 'Resource has been exhausted (e.g. check quota).'), reply({ ok: 1 }));
  assert.equal((await ask(none)).model, FLASH);
});

test('every model refusing with 429 means the free limit is used up', async () => {
  const fetch = fakeFetch(failure(429, 'Resource has been exhausted.'), failure(429, 'Resource has been exhausted.'));
  await rejectsWith(ask(fetch), 'quota');
  assert.equal(MESSAGES.quota, "Gemini's free limit is used up for today — try tomorrow");
});

test('reading the retry hint', () => {
  assert.equal(retryAfterSeconds('Please retry in 12.5s.'), 12.5);
  assert.equal(retryAfterSeconds('{"message":"Please Retry In 3s"}'), 3);
  assert.equal(retryAfterSeconds('Resource has been exhausted'), null);
});

// ---- when nothing works ------------------------------------------------------------------------

test('mixed failures mean Gemini did not answer; all network errors mean offline', async () => {
  await rejectsWith(ask(fakeFetch(failure(429, 'x'), failure(503, 'y'))), 'failed');
  await rejectsWith(ask(fakeFetch(failure(404, 'models/x is not found'), 'network')), 'failed');
  await rejectsWith(ask(fakeFetch('network', 'network')), 'offline');
  assert.equal(MESSAGES.failed, "Gemini didn't answer — try again");
});

test('with two keys: lite on each key, then flash on each key', async () => {
  const fetch = fakeFetch(failure(503, 'a'), failure(503, 'b'), failure(503, 'c'), failure(503, 'd'));
  await rejectsWith(askGemini({ keys: ['k1', 'k2', 'k1'], system: 'S', prompt: 'P', fetch, timers: fakeTimers() }), 'failed');
  assert.deepEqual(fetch.calls.map((c) => [c.model, c.key]), [[LITE, 'k1'], [LITE, 'k2'], [FLASH, 'k1'], [FLASH, 'k2']]);
});

test('a refused key is skipped from then on, without the plain retry', async () => {
  const invalid = () => failure(400, 'API key not valid. Please pass a valid API key.');
  const good = fakeFetch(invalid(), reply({ ok: 1 }));
  const out = await askGemini({ keys: ['bad', 'good'], system: 'S', prompt: 'P', fetch: good, timers: fakeTimers() });
  assert.equal(out.model, LITE);
  assert.deepEqual(good.calls.map((c) => [c.model, c.key]), [[LITE, 'bad'], [LITE, 'good']]);

  const later = fakeFetch(invalid(), failure(503, 'busy'), reply({ ok: 1 }));
  await askGemini({ keys: ['bad', 'good'], system: 'S', prompt: 'P', fetch: later, timers: fakeTimers() });
  assert.deepEqual(later.calls.map((c) => [c.model, c.key]), [[LITE, 'bad'], [LITE, 'good'], [FLASH, 'good']]);

  const only = fakeFetch(failure(403, 'Permission denied.'));
  await rejectsWith(ask(only), 'badkey');
  assert.equal(only.calls.length, 1);
});

// ---- the reply ---------------------------------------------------------------------------------

test('reply text: parts joined, fences stripped, thoughts ignored, a wrapped object found', () => {
  const body = (parts) => JSON.stringify({ candidates: [{ content: { parts } }] });
  assert.deepEqual(readReply(body([{ text: '```json\n{"a":' }, { text: '1}\n```' }])), { a: 1 });
  assert.deepEqual(readReply(body([{ text: 'Thinking it over', thought: true }, { text: '{"a":2}' }])), { a: 2 });
  assert.deepEqual(readReply(body([{ text: 'Here it is: {"a":3} Hope that helps.' }])), { a: 3 });
  for (const bad of ['not json', JSON.stringify({ candidates: [] }), body([{ text: 'no object here' }]), body([])]) {
    assert.throws(() => readReply(bad), (e) => e instanceof GeminiError && e.code === 'nonsense');
  }
});

test('a reply that is not JSON is nonsense at once, with no fallback', async () => {
  const fetch = fakeFetch(reply('I would love to help with that!'));
  await rejectsWith(ask(fetch), 'nonsense');
  assert.equal(fetch.calls.length, 1);
  assert.equal(MESSAGES.nonsense, "Gemini's reply didn't make sense — try again");
});

test('the key never appears in an error or on the console', async () => {
  const logged = [];
  const saved = {};
  for (const name of ['log', 'info', 'warn', 'error', 'debug']) {
    saved[name] = console[name];
    console[name] = (...args) => logged.push(args.join(' '));
  }
  try {
    const scenarios = [
      fakeFetch(failure(429, `Quota exceeded for ${KEY}`), failure(429, KEY)),
      fakeFetch(failure(503, `down for ${KEY}`), 'network'),
      fakeFetch('network', 'network'),
      fakeFetch(failure(400, `API key not valid: ${KEY}`)),
      fakeFetch(reply(`not json ${KEY}`)),
    ];
    for (const fetch of scenarios) {
      const err = await ask(fetch).then(() => null, (e) => e);
      assert.ok(err instanceof GeminiError);
      assert.ok(!err.message.includes(KEY));
      assert.ok(!String(err.stack).includes(KEY));
      assert.ok(!JSON.stringify(err).includes(KEY));
      assert.equal(err.cause, undefined);
    }
  } finally {
    Object.assign(console, saved);
  }
  assert.deepEqual(logged, []);
});

// ---- where the key comes from ------------------------------------------------------------------

test("keys: the dashboard's own first, then the Hebrew app's two, trimmed and without repeats", () => {
  const storage = new MemoryStorage({ hvr_geminikey: ' hebrew1 ', hvr_geminikey2: 'hebrew2' });
  assert.deepEqual(geminiKeys({ geminiKey: 'mine' }, storage), ['mine', 'hebrew1', 'hebrew2']);
  assert.deepEqual(geminiKeys({ geminiKey: '' }, storage), ['hebrew1', 'hebrew2']);
  assert.deepEqual(geminiKeys({ geminiKey: 'hebrew1' }, storage), ['hebrew1', 'hebrew2']);
  assert.deepEqual(geminiKeys({ geminiKey: '' }, new MemoryStorage()), []);
  assert.deepEqual(hebrewKeys(new MemoryStorage({ hvr_geminikey2: 'only-the-backup' })), ['only-the-backup']);
  class Denied extends MemoryStorage { getItem() { throw new Error('denied'); } }
  assert.deepEqual(geminiKeys({ geminiKey: 'mine' }, new Denied()), ['mine']);
});
