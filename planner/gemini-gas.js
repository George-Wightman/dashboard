// Gemini for the Mind, from inside Apps Script (docs/superpowers/specs/2026-09-25-coach-mind-design.md).
// The page's client (js/gemini.js) waits on timers Apps Script doesn't have; this one sends every
// question of a step at once with UrlFetchApp.fetchAll, answers in JSON, and switches models on the
// fly. Two roles: `think` (Flash, asked to think hard — one call however long it thinks) and `check`
// (Flash-Lite). The Mind's project allows Flash about 20 calls a day, so `budget` keeps count per
// model: `left()` is the day's total left, `modelLeft(model)` what a capped model has left,
// `spend(model, n)` records calls, and `blocked` (a Set kept in mind.json) holds any model Google has
// said is used up for the day. A question for a model that's used up, capped, busy for the minute or
// failing goes to the other one; `notes` collects what happened in plain English for the status line.

import { ENDPOINT, readReply } from '../js/gemini.js';

const PER_DAY = /PerDay/i;
const THINKING = /thinking/i;

export function createGemini({ UrlFetchApp, key, models, budget, log = () => {} }) {
  const scrub = (text) => String(text).split(key || '\u0000').join('…');
  const other = (role) => (role === 'think' ? 'check' : 'think');
  const noThinking = new Set();
  const notes = new Set();
  const usable = (role) => !budget.blocked.has(models[role]) && (budget.modelLeft?.(models[role]) ?? Infinity) > 0;

  // The role a question should go to now: its own, or the other one.
  const route = (role) => (usable(role) ? role : usable(other(role)) ? other(role) : null);

  function body(q, role) {
    const generationConfig = { responseMimeType: 'application/json', temperature: 0.5 };
    if (q.think && role === 'think' && !noThinking.has(models.think)) generationConfig.thinkingConfig = { thinkingLevel: 'HIGH' };
    return {
      systemInstruction: { parts: [{ text: q.system }] },
      contents: [{ role: 'user', parts: [{ text: q.prompt }] }],
      generationConfig,
    };
  }

  function send(batch) {
    const requests = batch.map((b) => ({
      url: `${ENDPOINT}/${models[b.role]}:generateContent?key=${encodeURIComponent(key)}`,
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify(body(b.q, b.role)),
    }));
    const responses = UrlFetchApp.fetchAll(requests);
    batch.forEach((b, i) => { if (!(responses[i].getResponseCode() === 400 && THINKING.test(responses[i].getContentText()))) budget.spend(models[b.role], 1); });
    return responses;
  }

  // One answer: { data, model } or { error, retry }. `retry` asks for the other model; `again` for the
  // same one without its thinking setting (a model that doesn't take it).
  function read(res, role) {
    const status = res.getResponseCode();
    const text = res.getContentText();
    const model = models[role];
    if (status >= 200 && status < 300) {
      try { return { data: readReply(text), model }; } catch { return { error: 'nonsense', retry: true }; }
    }
    if (status === 400 && THINKING.test(text) && !noThinking.has(model)) { noThinking.add(model); return { error: 'rejected', again: true }; }
    if (status === 401 || status === 403 || (status === 400 && /API[ _]key not valid|API_KEY_INVALID/i.test(text))) return { error: 'badkey' };
    if (status === 429) {
      if (PER_DAY.test(text)) {
        budget.blocked.add(model);
        notes.add(`${model} has used its free allowance for today`);
        return { error: 'quota', retry: true };
      }
      notes.add(`${model} was busy for a minute`);
      return { error: 'busy', retry: true };
    }
    log(`Gemini ${model} answered ${status}: ${scrub(text).slice(0, 200)}`);
    return { error: status >= 500 ? 'server' : 'rejected', retry: status >= 500 };
  }

  // questions: [{ system, prompt, model: 'think'|'check', think?: true }] → answers in the same order.
  async function ask(questions) {
    if (!key) return questions.map(() => ({ error: 'nokey' }));
    if (budget.left() < questions.length) return questions.map(() => ({ error: 'budget' }));
    const out = new Array(questions.length).fill(null);
    let batch = [];
    questions.forEach((q, i) => {
      const role = route(q.model);
      if (role) batch.push({ q, i, role, tried: new Set([role]) });
      else out[i] = { error: budget.blocked.has(models[q.model]) || budget.blocked.has(models[other(q.model)]) ? 'quota' : 'budget' };
    });
    // At most three rounds: the first answers, then a model without thinking or the other model, then
    // the other model once more.
    for (let round = 0; batch.length && round < 3; round++) {
      const answers = send(batch);
      const next = [];
      batch.forEach((b, n) => {
        const r = read(answers[n], b.role);
        if (r.data) { out[b.i] = { ...r, role: b.role }; return; }
        if (r.again && budget.left() > next.length) { next.push(b); return; }
        const alt = other(b.role);
        if (r.retry && !b.tried.has(alt) && usable(alt) && budget.left() > next.length) {
          if (r.error !== 'quota') notes.add(`switched to ${models[alt]} for a moment`);
          next.push({ ...b, role: alt, tried: new Set([...b.tried, alt]) });
          return;
        }
        out[b.i] = { error: r.error };
      });
      batch = next;
    }
    batch.forEach((b) => { out[b.i] ??= { error: 'failed' }; });
    return out;
  }

  return {
    ask,
    // Whether a role's own model can take a question now (so a caller can choose how to ask).
    available: (role) => usable(role),
    notes: () => [...notes],
  };
}
