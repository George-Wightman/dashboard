// mind.json, the Mind's own file beside data.json in the sync repo
// (docs/superpowers/specs/2026-09-25-coach-mind-design.md): the events the Senses recorded, the runs
// that looked at them, the ledger of pings sent, the fires of Claude's routine and the day's budget.
// Kept out of data.json because every device pulls that whole file on every sync. Two writers — the
// planner every ten minutes and Claude's deep runs — so it merges rather than overwrites. Pure apart
// from saveMind and loadMind, which talk to a { get, put } client like js/sync.js's.

import { ConflictError } from './sync.js';
import { stableStringify } from './doc.js';

export const KEEP_DAYS = 14;
export const MAX_EVENTS = 300;
export const ARTEFACT_CHARS = 12000;
const FIRED_KEEP_DAYS = 2;
const DAY_MS = 86400000;

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const later = (a, b) => (!a ? b ?? null : !b ? a : a > b ? a : b);

export function emptyMind() {
  return {
    schema: 1, cursor: null, events: {}, runs: {}, pushed: {}, fired: [],
    budget: { day: null, gemini: 0, messages: 0, pings: 0, deep: 0, lastSaid: null, geminiBlocked: [], byModel: {} },
  };
}

export function isMind(v) {
  return isPlain(v) && v.schema === 1 && (v.cursor === null || isPlain(v.cursor))
    && isPlain(v.events) && Object.values(v.events).every((e) => isPlain(e) && typeof e.id === 'string' && typeof e.at === 'string')
    && isPlain(v.runs) && isPlain(v.pushed) && Array.isArray(v.fired) && isPlain(v.budget);
}

const FINAL = new Set(['sent', 'quiet', 'gone', 'given-up']);
function mergePushed(a, b) {
  if (!a) return b;
  if (!b) return a;
  const fa = FINAL.has(a.state);
  const fb = FINAL.has(b.state);
  if (fa !== fb) return fa ? a : b;
  if (fa) return a.at <= b.at ? a : b;
  return (a.tries ?? 0) >= (b.tries ?? 0) ? a : b;
}

function mergeEvent(a, b) {
  if (!a) return b;
  if (!b) return a;
  const base = Object.keys(b).length > Object.keys(a).length ? b : a;
  return { ...base, reflex: later(a.reflex, b.reflex), deep: later(a.deep, b.deep) };
}

// The Gemini models whose free quota is gone for the day (an older file may say true/false).
const blockedList = (b) => (Array.isArray(b?.geminiBlocked) ? b.geminiBlocked.filter((m) => typeof m === 'string') : []);

function mergeBudget(a, b) {
  if (!a?.day) return { ...emptyMind().budget, ...(b ?? {}) };
  if (!b?.day) return { ...a };
  if (a.day !== b.day) return a.day > b.day ? { ...a } : { ...b };
  const out = { day: a.day };
  for (const k of ['gemini', 'messages', 'pings', 'deep']) out[k] = Math.max(a[k] ?? 0, b[k] ?? 0);
  if (a.minor != null || b.minor != null) out.minor = Math.max(a.minor ?? 0, b.minor ?? 0);
  out.lastSaid = later(a.lastSaid, b.lastSaid);
  out.geminiBlocked = [...new Set([...blockedList(a), ...blockedList(b)])].sort();
  out.byModel = {};
  for (const m of new Set([...Object.keys(a.byModel ?? {}), ...Object.keys(b.byModel ?? {})])) out.byModel[m] = Math.max(a.byModel?.[m] ?? 0, b.byModel?.[m] ?? 0);
  return out;
}

// Two copies into one. The cursor belongs to the planner: it passes its own copy as `local`; Claude's
// tool, which never senses, takes the remote one (cursorFrom: 'remote').
export function mergeMind(local, remote, { cursorFrom = 'local' } = {}) {
  const a = isMind(local) ? local : emptyMind();
  const b = isMind(remote) ? remote : emptyMind();
  const events = {};
  for (const id of new Set([...Object.keys(a.events), ...Object.keys(b.events)])) events[id] = mergeEvent(a.events[id], b.events[id]);
  const pushed = {};
  for (const k of new Set([...Object.keys(a.pushed), ...Object.keys(b.pushed)])) pushed[k] = mergePushed(a.pushed[k], b.pushed[k]);
  const fired = [];
  const seen = new Set();
  for (const f of [...a.fired, ...b.fired].sort((x, y) => String(x.at).localeCompare(String(y.at)))) {
    const key = `${f.at}|${f.reason}`;
    if (!seen.has(key)) { seen.add(key); fired.push(f); }
  }
  return {
    schema: 1,
    cursor: cursorFrom === 'local' ? a.cursor ?? b.cursor : b.cursor ?? a.cursor,
    events,
    runs: { ...b.runs, ...a.runs },
    pushed,
    fired,
    budget: mergeBudget(a.budget, b.budget),
  };
}

// The budget for `day`: today's counts, or a fresh set once the day has turned.
export function budget(m, day) {
  if (m.budget?.day === day) return m.budget;
  return { day, gemini: 0, messages: 0, pings: 0, deep: 0, lastSaid: m.budget?.lastSaid ?? null, geminiBlocked: [], byModel: {} };
}

export function spend(m, day, field, n = 1) {
  m.budget = { ...budget(m, day) };
  m.budget[field] = (m.budget[field] ?? 0) + n;
  return m.budget;
}

// A Gemini call on one model: the day's total and that model's own count.
export function spendModel(m, day, model, n = 1) {
  spend(m, day, 'gemini', n);
  m.budget.byModel = { ...(m.budget.byModel ?? {}), [model]: (m.budget.byModel?.[model] ?? 0) + n };
  return m.budget;
}

// The events one engine ('reflex' or 'deep') has yet to look at, oldest first.
export function unhandled(m, engine) {
  return Object.values(m.events ?? {}).filter((e) => !e[engine]).sort((a, b) => a.at.localeCompare(b.at));
}

function clipArtefacts(files = []) {
  let left = ARTEFACT_CHARS;
  const out = [];
  for (const f of files) {
    if (left <= 0) break;
    const text = String(f.text ?? '').slice(0, left);
    left -= text.length;
    out.push({ ...f, text });
  }
  return out;
}

// Fourteen days of events and runs, the newest 300 events, 12,000 characters of artefacts an event,
// and two days of fires. Mutates and returns `m`.
export function pruneMind(m, now) {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * DAY_MS).toISOString();
  const fired = new Date(now.getTime() - FIRED_KEEP_DAYS * DAY_MS).toISOString();
  const events = Object.values(m.events).filter((e) => e.at >= cutoff).sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_EVENTS);
  m.events = Object.fromEntries(events.map((e) => [e.id, e.artefacts ? { ...e, artefacts: clipArtefacts(e.artefacts) } : e]));
  m.runs = Object.fromEntries(Object.entries(m.runs).filter(([, r]) => String(r.at) >= cutoff));
  m.pushed = Object.fromEntries(Object.entries(m.pushed).filter(([, p]) => String(p.at) >= cutoff));
  m.fired = m.fired.filter((f) => String(f.at) >= fired);
  return m;
}

// mind.json as it is now. A file that isn't a Mind starts afresh (and says so); a read that failed
// says `failed`, and the caller skips the Mind for this run rather than start from nothing.
export async function loadMind(client) {
  let remote;
  try {
    remote = await client.get();
  } catch (e) {
    return { mind: emptyMind(), sha: null, problem: e?.message ?? String(e), failed: true };
  }
  if (!remote) return { mind: emptyMind(), sha: null, problem: null };
  if (!isMind(remote.doc)) return { mind: emptyMind(), sha: remote.sha, problem: "mind.json wasn't readable, so the Mind started afresh" };
  return { mind: remote.doc, sha: remote.sha, problem: null };
}

// Merge `mind` into what's in the repo and write it back, going round again when someone else wrote
// in between. Nothing is written when there's nothing new.
export async function saveMind({ client, mind, cursorFrom = 'local', maxAttempts = 3 }) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let remote;
    try {
      remote = await client.get();
    } catch (e) {
      return { ok: false, error: e?.message ?? String(e) };
    }
    const theirs = remote && isMind(remote.doc) ? remote.doc : null;
    const merged = theirs ? mergeMind(mind, theirs, { cursorFrom }) : mergeMind(mind, emptyMind(), { cursorFrom: 'local' });
    if (theirs && stableStringify(merged) === stableStringify(theirs)) return { ok: true, mind: merged, pushed: false };
    try {
      await client.put(merged, remote?.sha);
      return { ok: true, mind: merged, pushed: true };
    } catch (e) {
      if (!(e instanceof ConflictError)) return { ok: false, error: e?.message ?? String(e) };
    }
  }
  return { ok: false, error: 'mind.json kept changing underneath — will try again next run' };
}
