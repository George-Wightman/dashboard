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

// One round trip, abandoned after timeoutMs. Resolves { status, text } or { fail }.
async function post({ fetch, timers, timeoutMs, url, body }) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = timers.setTimeout(() => { controller?.abort(); resolve({ fail: 'timeout' }); }, timeoutMs);
  });
  const work = (async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

  const send = (model, key, plain) => post({
    fetch, timers, timeoutMs, url: `${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(key)}`, body: requestBody(system, prompt, plain),
  });

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

// ---- A conversation with tools ------------------------------------------------------------------

export const TALK_STEPS = 6;

// One turn of a conversation in which Gemini may use tools: `contents` is the conversation so far
// in Gemini's shape, `tools` the declarations, and `run(name, args)` carries out each call — its
// result (a plain object) goes back to Gemini, and a throw goes back as { ok: false, error }. At
// most `steps` rounds of calls; then it's asked for words with no tools. Models and keys are walked
// as askGemini walks them, starting with whichever answered last. Resolves
// { text, calls: [{ name, args, result }], model }.
export async function talkGemini({
  keys, system, contents, tools = [], run = async () => ({}), toolConfig = null, steps = TALK_STEPS,
  fetch = (...args) => globalThis.fetch(...args), timers = globalThis, models = MODELS, timeoutMs = TIMEOUT_MS,
}) {
  const usable = [...new Set((keys ?? []).map((k) => String(k ?? '').trim()).filter(Boolean))];
  if (!usable.length) throw new GeminiError('nokey');
  const sleep = (ms) => new Promise((resolve) => { timers.setTimeout(resolve, ms); });
  let lead = null;

  async function attempt({ model, key }, body) {
    for (let waited = false; ;) {
      const res = await post({ fetch, timers, timeoutMs, url: `${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(key)}`, body });
      if (res.fail) return { fail: res.fail };
      if (res.status >= 200 && res.status < 300) {
        try {
          return { data: JSON.parse(res.text) };
        } catch {
          throw new GeminiError('nonsense');
        }
      }
      if (refusesKey(res.status, res.text)) return { fail: 'badkey' };
      const wait = res.status === 429 ? retryAfterSeconds(res.text) : null;
      if (!waited && wait !== null && wait <= MAX_WAIT_S) {
        waited = true;
        await sleep(Math.ceil(wait * 1000));
        continue;
      }
      return { fail: res.status === 429 ? 'quota' : res.status >= 500 ? 'server' : 'rejected' };
    }
  }

  async function ask(body) {
    const outcomes = [];
    const refused = new Set();
    const tried = new Set();
    const order = [...(lead ? [lead] : []), ...models.flatMap((model) => usable.map((key) => ({ model, key })))];
    for (const pair of order) {
      const tag = `${pair.model}|${pair.key}`;
      if (tried.has(tag) || refused.has(pair.key)) continue;
      tried.add(tag);
      const result = await attempt(pair, body);
      if (result.data) {
        lead = pair;
        return { data: result.data, model: pair.model };
      }
      if (result.fail === 'badkey') refused.add(pair.key);
      outcomes.push(result.fail);
    }
    throw new GeminiError(verdict(outcomes));
  }

  let convo = [...contents];
  const calls = [];
  for (let step = 0; ; step++) {
    const last = step >= steps;
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: convo,
      generationConfig: { temperature: 0.6 },
      ...(tools.length && !last ? { tools: [{ functionDeclarations: tools }], ...(toolConfig ? { toolConfig } : {}) } : {}),
    };
    const { data, model } = await ask(body);
    const parts = Array.isArray(data?.candidates?.[0]?.content?.parts) ? data.candidates[0].content.parts : [];
    const wanted = parts.filter((p) => typeof p?.functionCall?.name === 'string');
    if (wanted.length && !last) {
      const responses = [];
      for (const p of wanted) {
        const { name } = p.functionCall;
        const args = p.functionCall.args && typeof p.functionCall.args === 'object' ? p.functionCall.args : {};
        let result;
        try {
          result = await run(name, args);
        } catch (e) {
          result = { ok: false, error: String(e?.message ?? e) };
        }
        calls.push({ name, args, result });
        responses.push({ functionResponse: { name, response: result ?? {} } });
      }
      // The model's own parts go back as they came (a thinking model's signatures with them).
      convo = [...convo, { role: 'model', parts }, { role: 'user', parts: responses }];
      continue;
    }
    const text = parts.filter((p) => typeof p?.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
    if (!text && !calls.length) throw new GeminiError('nonsense');
    return { text, calls, model };
  }
}
