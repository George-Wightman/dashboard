# Task 2: Gemini client

Part of [the Gemini coach plan](../2026-09-11-gemini-coach.md) — read its Global Constraints first.

**Files:**
- Create: `js/gemini.js`
- Test: `tests/gemini.test.js`

**Interfaces:**
- Consumes: `MemoryStorage` from `tests/helpers.js`. Nothing else — `js/gemini.js` imports no other module.
- Produces: `MODELS`, `ENDPOINT`, `TIMEOUT_MS`, `MAX_WAIT_S`, `HEBREW_KEY_NAMES`, `MESSAGES`,
  `GeminiError`, `askGemini`, `readReply`, `retryAfterSeconds`, `hebrewKeys`, `geminiKeys`. The
  signatures and behaviour are in the plan's Shared interfaces.

**The rules, and where each one lives:**

| Design rule | Code | Test |
|---|---|---|
| Lite first, then Flash; `-latest` aliases | `MODELS`; the model-major loop | `the models, lite first, and the endpoint`; `with two keys: …` |
| `POST …/{model}:generateContent?key={key}`, `systemInstruction`, `contents`, `generationConfig { responseMimeType: 'application/json', temperature: 0.6 }`, no thinking config | `send`, `requestBody` | `asks the lite model first with the agreed body…` |
| 400 → same model once, plain body (system prepended, no generationConfig) | `attempt` (`plain`) | `a 400 is retried once…`; `a second 400 moves on…` |
| 429 "retry in N s", N ≤ 20 → wait N s, same model once | `attempt` (`waited`), `retryAfterSeconds`, `MAX_WAIT_S` | `a 429 that says "retry in 7s"…`; `a second short 429…`; `reading the retry hint` |
| Any other 429 → next model; all 429 → "used up" | `attempt`, `verdict` | `a 429 with a long or missing retry hint…`; `every model refusing with 429…` |
| 5xx, network error, 30 s timeout → next model | `send` (race against the timer, abort), `attempt` | `a 5xx from lite…`; `a network error…`; `no answer within 30 seconds…`; `the timeout can be set` |
| Parts joined, fences stripped, `JSON.parse` | `readReply` | `reply text: …`; `a reply that is not JSON…` |
| Key lookup: setting, then `hvr_geminikey`, then `hvr_geminikey2` | `geminiKeys`, `hebrewKeys` | `keys: the dashboard's own first…` |
| The key never appears in errors or logs | `GeminiError` carries only a fixed message and a code; no `console` calls | `the key never appears in an error or on the console` |

The tests use a fake `fetch` and fake timers only. The one real scheduling call in the test file,
`setImmediate` inside `until()`, just lets pending promise callbacks run. It is never passed to the
client.

- [ ] **Step 1: Write the failing test**

`tests/gemini.test.js`:

````js
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
  assert.equal(MESSAGES.nokey, 'The coach needs a Gemini key. Add one in ⚙, or save one in the Hebrew app on this device.');
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
````

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `js/gemini.js`.

- [ ] **Step 3: Implement**

`js/gemini.js`:

````js
// The Gemini client. One call walks the models (lite first) on each key until one answers, and
// returns the reply's JSON. Every failure is a GeminiError carrying one of the plain-English
// messages below. The key only ever goes into the request URL: it is never put in an error, a
// log line, or anything else this module produces.

export const MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
export const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
export const TIMEOUT_MS = 30000;
export const MAX_WAIT_S = 20;
export const HEBREW_KEY_NAMES = ['hvr_geminikey', 'hvr_geminikey2'];

export const MESSAGES = {
  nokey: 'The coach needs a Gemini key. Add one in ⚙, or save one in the Hebrew app on this device.',
  offline: "Can't reach Gemini — check you're online and try again",
  quota: "Gemini's free limit is used up for today — try tomorrow",
  badkey: 'Gemini refused the key — check it in ⚙',
  failed: "Gemini didn't answer — try again",
  nonsense: "Gemini's reply didn't make sense — try again",
};

export class GeminiError extends Error {
  constructor(code) {
    const known = Object.hasOwn(MESSAGES, code) ? code : 'failed';
    super(MESSAGES[known]);
    this.name = 'GeminiError';
    this.code = known;
  }
}

function readKey(storage, name) {
  try {
    const value = storage?.getItem(name);
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

// The Hebrew app's keys on this device (same origin, so the same localStorage), in its order.
export function hebrewKeys(storage) {
  return [...new Set(HEBREW_KEY_NAMES.map((name) => readKey(storage, name)).filter(Boolean))];
}

// Every usable key, in the order to try them: the dashboard's own setting, then the Hebrew app's.
export function geminiKeys(settings, storage) {
  const own = typeof settings?.geminiKey === 'string' ? settings.geminiKey.trim() : '';
  return [...new Set([own, ...hebrewKeys(storage)].filter(Boolean))];
}

function requestBody(system, prompt, plain) {
  if (plain) return { contents: [{ role: 'user', parts: [{ text: `${system}\n\n${prompt}` }] }] };
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.6 },
  };
}

// The JSON inside a 200 reply: the first candidate's text parts joined, ```json fences stripped.
// Throws the "didn't make sense" error for anything else.
export function readReply(bodyText) {
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new GeminiError('nonsense');
  }
  const parts = body?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.filter((p) => typeof p?.text === 'string' && !p.thought).map((p) => p.text).join('').trim()
    : '';
  if (!text) throw new GeminiError('nonsense');
  const bare = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(bare);
  } catch {
    // Without JSON mode (the plain retry) the object can come wrapped in a sentence.
  }
  const from = bare.indexOf('{');
  const to = bare.lastIndexOf('}');
  if (from !== -1 && to > from) {
    try {
      return JSON.parse(bare.slice(from, to + 1));
    } catch {
      // fall through
    }
  }
  throw new GeminiError('nonsense');
}

// Seconds from a 429's "retry in Ns", or null when it has no such hint.
export function retryAfterSeconds(text) {
  const m = String(text ?? '').match(/retry in ([\d.]+)s/i);
  const seconds = m ? Number(m[1]) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

// A key Google won't accept at all: no point trying it again on another model.
function refusesKey(status, text) {
  return status === 401 || status === 403 || (status === 400 && /API[ _]key not valid|API_KEY_INVALID/i.test(text));
}

// What to tell George once every model on every key has failed.
function verdict(outcomes) {
  const rest = outcomes.filter((o) => o !== 'badkey');
  if (!rest.length) return 'badkey';
  if (rest.every((o) => o === 'quota')) return 'quota';
  if (rest.every((o) => o === 'network')) return 'offline';
  return 'failed';
}

export async function askGemini({
  keys,
  system,
  prompt,
  fetch = (...args) => globalThis.fetch(...args),
  timers = globalThis,
  models = MODELS,
  timeoutMs = TIMEOUT_MS,
}) {
  const usable = [...new Set((keys ?? []).map((k) => String(k ?? '').trim()).filter(Boolean))];
  if (!usable.length) throw new GeminiError('nokey');

  const sleep = (ms) => new Promise((resolve) => { timers.setTimeout(resolve, ms); });

  // One round trip, abandoned after timeoutMs. Resolves { status, text } or { fail }.
  async function send(model, key, plain) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = timers.setTimeout(() => { controller?.abort(); resolve({ fail: 'timeout' }); }, timeoutMs);
    });
    const work = (async () => {
      const res = await fetch(`${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody(system, prompt, plain)),
        signal: controller?.signal,
      });
      return { status: res.status, text: await res.text() };
    })().catch(() => ({ fail: 'network' }));
    try {
      return await Promise.race([work, timeout]);
    } finally {
      timers.clearTimeout(timer);
    }
  }

  // One model on one key. The plain-body retry after a 400 and the short wait after a 429 each
  // happen at most once. Resolves { data } or { fail }; a 200 that isn't JSON throws.
  async function attempt(model, key) {
    let plain = false;
    let waited = false;
    for (;;) {
      const res = await send(model, key, plain);
      if (res.fail) return { fail: res.fail };
      if (res.status >= 200 && res.status < 300) return { data: readReply(res.text) };
      if (refusesKey(res.status, res.text)) return { fail: 'badkey' };
      if (res.status === 400 && !plain) { plain = true; continue; }
      if (res.status === 429) {
        const wait = retryAfterSeconds(res.text);
        if (!waited && wait !== null && wait <= MAX_WAIT_S) {
          waited = true;
          await sleep(Math.ceil(wait * 1000));
          continue;
        }
        return { fail: 'quota' };
      }
      return { fail: res.status >= 500 ? 'server' : 'rejected' };
    }
  }

  // Lite on every key before Flash on any: the Hebrew app shares these keys and needs Flash.
  const outcomes = [];
  const refused = new Set();
  for (const model of models) {
    for (const key of usable) {
      if (refused.has(key)) continue;
      const result = await attempt(model, key);
      if ('data' in result) return { data: result.data, model };
      if (result.fail === 'badkey') refused.add(key);
      outcomes.push(result.fail);
    }
  }
  throw new GeminiError(verdict(outcomes));
}
````

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — 148 tests (21 new).

- [ ] **Step 5: Commit**

```bash
git add js/gemini.js tests/gemini.test.js
git commit -m "Add the Gemini client" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
