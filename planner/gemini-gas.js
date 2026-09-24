// Gemini for the Mind, from inside Apps Script (docs/superpowers/specs/2026-09-25-coach-mind-design.md).
// The page's client (js/gemini.js) waits on timers Apps Script doesn't have; this one sends every
// question of a step at once with UrlFetchApp.fetchAll, answers in JSON, and keeps to a day's
// allowance: `budget.left()` says how many calls remain, `spend(n)` records them, and `blocked` (a Set,
// kept by the caller in mind.json) holds any model whose free quota for the day is gone. A model out of
// quota hands its questions to the other; a per-minute limit is only a pause for this run.

import { ENDPOINT, readReply } from '../js/gemini.js';

const PER_DAY = /PerDay/i;

function body(system, prompt) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.5 },
  };
}

export function createGemini({ UrlFetchApp, key, models, budget, log = () => {} }) {
  const scrub = (text) => String(text).split(key || '\u0000').join('…');
  const other = (name) => (name === 'think' ? 'check' : 'think');

  // Which model a question should go to now: its own, or the other if its own is out for the day.
  const route = (name) => {
    if (!budget.blocked.has(models[name])) return name;
    return budget.blocked.has(models[other(name)]) ? null : other(name);
  };

  function send(batch) {
    const requests = batch.map(({ q, name }) => ({
      url: `${ENDPOINT}/${models[name]}:generateContent?key=${encodeURIComponent(key)}`,
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify(body(q.system, q.prompt)),
    }));
    budget.spend(requests.length);
    return UrlFetchApp.fetchAll(requests);
  }

  // One answer: { data, model } or { error, retry }.
  function read(res, name) {
    const status = res.getResponseCode();
    const text = res.getContentText();
    if (status >= 200 && status < 300) {
      try { return { data: readReply(text), model: models[name] }; } catch { return { error: 'nonsense' }; }
    }
    if (status === 401 || status === 403 || (status === 400 && /API[ _]key not valid|API_KEY_INVALID/i.test(text))) return { error: 'badkey' };
    if (status === 429) {
      if (PER_DAY.test(text)) {
        budget.blocked.add(models[name]);
        return { error: 'quota', retry: true };
      }
      return { error: 'busy' };
    }
    log(`Gemini ${models[name]} answered ${status}: ${scrub(text).slice(0, 200)}`);
    return { error: status >= 500 ? 'server' : 'rejected', retry: status >= 500 };
  }

  async function ask(questions) {
    if (!key) return questions.map(() => ({ error: 'nokey' }));
    if (budget.left() < questions.length) return questions.map(() => ({ error: 'budget' }));
    const out = new Array(questions.length).fill(null);
    let batch = [];
    questions.forEach((q, i) => {
      const name = route(q.model);
      if (!name) out[i] = { error: 'quota' };
      else batch.push({ q, i, name });
    });
    if (batch.length) {
      const answers = send(batch);
      const again = [];
      batch.forEach((b, n) => {
        const r = read(answers[n], b.name);
        const alt = r.retry ? route(other(b.name)) : null;
        if (r.retry && alt && alt !== b.name && budget.left() > again.length) again.push({ ...b, name: alt });
        else out[b.i] = r.retry && r.error === 'quota' ? { error: 'quota' } : r.data ? r : { error: r.error };
      });
      batch = again;
      if (batch.length) {
        const second = send(batch);
        batch.forEach((b, n) => {
          const r = read(second[n], b.name);
          out[b.i] = r.data ? r : { error: r.error };
        });
      }
    }
    return out;
  }

  return { ask };
}
