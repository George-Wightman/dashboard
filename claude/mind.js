// Claude as the Coach's deep mind (docs/superpowers/specs/2026-09-25-coach-mind-design.md): the
// context pack a deep run reads (`mind`), and the ops it answers with — `picture` (its standing
// understanding of George), `say` (a message in the Coach), `propose` (plan changes George applies with
// one tap), `handled` (what it has looked at) — plus `mind`, Claude's control over the Mind's settings.
// Run with `apply --mind`, a deep run may only use these (and brief, guide, flag): a guard
// against a wrong turn, not a security boundary.

import { randomUUID } from 'node:crypto';
import { addDays, longDate } from '../js/dates.js';
import { clockLabel } from '../js/calendar.js';
import { talkContext } from '../js/talk.js';
import {
  picture, mindConfig, mindStatus, checkMessage, checkMindSetting, nextMindSlot, isMindMessage, MESSAGE_MAX, PICTURE_MAX,
} from '../js/mind.js';
import { budget, unhandled } from '../js/mind-state.js';
import { createStore, DATA_KEY, SETTINGS_KEY } from '../js/data.js';
import { emptyDoc } from '../js/doc.js';
import { netEdits, describeEdits } from '../js/coach-session.js';
import { READS } from './read.js';
import { q, toDay, dayName } from './text.js';

// No handoff: its file is written straight to main, which a routine can't reach (claude/branch.js). A flag does the job.
export const MIND_MODE_OPS = ['picture', 'say', 'propose', 'brief', 'guide', 'flag', 'handled'];
export const MIND_LIMITS = { picture: 1, say: 2, propose: 1, handled: 1 };
const PROPOSE_OPS = ['task', 'edit', 'archive'];
const MAX_PROPOSED = 12;

// The config a cloud routine runs with: no file, just its environment. DASHBOARD_TOKEN if it's set;
// otherwise the cloud session's own GitHub credential (GITHUB_TOKEN reads "proxy-injected" there, and
// the GitHub proxy swaps in George's connection for repos attached to the routine).
export function configFromEnv(env) {
  const token = String(env.DASHBOARD_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN || '').trim();
  if (!token) throw new Error("DASHBOARD_TOKEN isn't set in this environment, and there's no GitHub credential either, so the dashboard can't be reached");
  return {
    token,
    repo: String(env.DASHBOARD_REPO ?? 'George-Wightman/dashboard-sync').trim(),
    dayStartHour: env.DASHBOARD_DAY_START === undefined ? 4 : Number(env.DASHBOARD_DAY_START),
    timeZone: String(env.DASHBOARD_TZ ?? 'Europe/London'),
  };
}

// Before anything runs: in mind mode, only the Mind's ops, and only so many of each.
export function checkMindBatch(ops) {
  const counts = {};
  for (const op of ops) {
    const name = op?.op;
    if (!MIND_MODE_OPS.includes(name)) {
      throw new Error(`In mind mode only ${MIND_MODE_OPS.join(', ')} are allowed — ${JSON.stringify(name)} isn't. Nothing was changed.`);
    }
    counts[name] = (counts[name] ?? 0) + 1;
    if (MIND_LIMITS[name] && counts[name] > MIND_LIMITS[name]) {
      throw new Error(`A deep run has at most ${MIND_LIMITS[name]} ${name}${MIND_LIMITS[name] === 1 ? '' : 's'}. Nothing was changed.`);
    }
  }
}

// ---- The context pack ------------------------------------------------------------------------------

const hhmm = (iso) => (iso ? clockLabel(iso) : '—');

function eventBlock(e) {
  const lines = [`[${e.level}] ${e.kind} · ${e.id} · ${String(e.at).slice(0, 16).replace('T', ' ')} UTC${e.by && e.by !== 'me' ? ` · by ${e.by}` : ''}`, `    ${e.text}`];
  for (const f of e.facts ?? []) lines.push(`    · ${f}`);
  if (e.health) lines.push(`    · Health: ${e.health.label ?? ''}${e.health.detail ? ` ${JSON.stringify(e.health.detail)}` : ''}`);
  if (e.reflex) lines.push(`    · The Reflexes looked at this at ${hhmm(e.reflex)}`);
  for (const a of e.artefacts ?? []) lines.push(`    --- ${a.path} (changed ${String(a.modified).slice(0, 16).replace('T', ' ')} UTC)`, ...String(a.text).split('\n').map((l) => `    ${l}`));
  return lines.join('\n');
}

function conversations(doc, today) {
  const talks = Object.values(doc.journal ?? {})
    .filter((t) => t.kind === 'talk' && t.status === 'active' && t.day >= addDays(today, -2) && t.messages?.length)
    .sort((a, b) => String(a.messages[0].at ?? '').localeCompare(String(b.messages[0].at ?? '')));
  if (!talks.length) return 'No conversations in the last three days.';
  return talks.map((t) => [`${t.day} · ${t.slot}${t.done ? ' (finished)' : ''}${t.proposal ? ' · has a proposal waiting' : ''}`,
    ...t.messages.map((m) => `  ${hhmm(m.at)} ${m.who === 'george' ? 'George' : isMindMessage(m) ? `Coach [mind · ${m.by}]` : 'Coach'}: ${m.text}`)].join('\n')).join('\n\n');
}

export function mindPack(doc, mind, now, today) {
  const config = mindConfig(doc);
  const status = mindStatus(doc);
  const b = budget(mind, today);
  const pic = picture(doc);
  const pending = unhandled(mind, 'deep');
  const lastDeep = Object.values(mind.runs ?? {}).filter((r) => r.engine === 'deep').map((r) => r.at).sort().at(-1);
  const section = (title, body) => `## ${title}\n\n${String(body).trim()}`;
  return [
    `# The Coach's deep mind — ${longDate(today)}, ${hhmm(now.toISOString())}`,
    `Your last deep run: ${lastDeep ? `${String(lastDeep).slice(0, 16).replace('T', ' ')} UTC` : 'none yet — this is the first'}.`,
    section('Your picture of George', pic
      ? `${pic.text}\n\n(Opener on file: ${pic.opener ? `${pic.opener.day}: "${pic.opener.text}"` : 'none'}; written ${String(pic.at ?? '').slice(0, 16)})`
      : 'None yet. Write the first one this run.'),
    section('Settings and today', [
      `The Mind is ${config.enabled ? 'on' : 'OFF (the planner senses, but nothing is said until Claude switches it on)'}. Morning opener ${config.morningAt}, evening ${config.checkinAt}, quiet ${config.quietFrom}–${config.quietUntil}.`,
      `Today so far: ${b.messages} of ${config.messagesPerDay} background messages, ${b.pings} of ${config.pingsPerDay} pings, ${b.gemini} of ${config.geminiPerDay} Gemini calls, ${b.deep} of ${config.deepPerDay} triggered deep runs.${(b.geminiBlocked ?? []).length ? ` Out of Gemini quota: ${b.geminiBlocked.join(', ')}.` : ''}`,
      status?.lastError ? `Last problem: ${status.lastError}` : 'No problems reported.',
    ].join('\n')),
    section(`What happened since your last deep run (${pending.length})`, pending.length ? pending.map(eventBlock).join('\n\n') : 'Nothing new.'),
    section('Today, as the Coach sees it', talkContext(doc, today, now, { first: true })),
    section('The week as booked', READS.week(doc, today)),
    section('Goals', READS.goals(doc, today)),
    section('Needs attention', READS.attention(doc, today)),
    section('Conversations, the last three days', conversations(doc, today)),
    section('Journal', READS.journal(doc, today)),
    section('Open flags', READS.flags(doc, today, '')),
    section('How to answer', [
      "One `apply --mind` with at most: one picture, two say, one propose, a brief, a guide, flags — and exactly one handled, last.",
      '{"op": "picture", "text": "Now: …\\nPatterns: …\\nRisks: …\\nOpen threads: …\\nHow to talk to him: …", "opener": {"day": "tomorrow", "text": "…"}}',
      '{"op": "say", "text": "…", "notify": true}',
      '{"op": "propose", "text": "why, in a sentence or two", "ops": [{"op": "edit", "id": "…", "set": {"date": "2026-09-27"}}]}',
      '{"op": "handled", "events": "all", "summary": "one paragraph: what you saw, what you did, what you are watching"}',
    ].join('\n')),
  ].join('\n\n');
}

// ---- The ops -------------------------------------------------------------------------------------

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const recentCoach = (doc, today) => Object.values(doc.journal ?? {})
  .filter((t) => t.kind === 'talk' && t.status === 'active' && t.day >= addDays(today, -1))
  .flatMap((t) => (t.messages ?? []).filter((m) => m.who === 'coach'))
  .sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')))
  .slice(-5).map((m) => m.text);

function checked(store, text) {
  const t = str(text);
  if (!t) throw new Error('A message needs text');
  if (t.length > MESSAGE_MAX) throw new Error(`A message can be at most ${MESSAGE_MAX} characters`);
  const today = store.today();
  const r = checkMessage(store.doc(), { today, now: store.now(), text: t, recent: recentCoach(store.doc(), today) });
  if (!r.ok) throw new Error(`That message doesn't stand up: ${r.problems.join('; ')}`);
  return t;
}

function message(store, text, op) {
  const ref = Array.isArray(op.ref) ? op.ref.filter((r) => typeof r === 'string').slice(0, 20) : [];
  return { who: 'coach', text, at: store.now().toISOString(), from: 'mind', by: 'claude', notify: op.notify === true, ...(ref.length ? { ref } : {}) };
}

// The ops, given the tool's own runOp so `propose` can run plan ops on a copy.
export function makeMindOps(runOp) {
  return {
    picture(store, op) {
      const text = str(op.text);
      if (!text) throw new Error('A picture needs text');
      if (text.length > PICTURE_MAX) throw new Error(`A picture can be at most ${PICTURE_MAX} characters — it is ${text.length}`);
      let opener = null;
      if (op.opener != null) {
        const otext = str(op.opener.text);
        if (!otext || otext.length > MESSAGE_MAX) throw new Error(`An opener needs text, at most ${MESSAGE_MAX} characters`);
        opener = { day: toDay(op.opener.day ?? 'tomorrow', store.today()), text: otext };
      }
      store.putCalendar('mind:picture', { text, opener, by: 'claude', at: store.now().toISOString() }, 'claude');
      return `Picture of George updated (${text.length} characters)${opener ? `, with an opener for ${dayName(opener.day, store.today())}` : ''}`;
    },

    say(store, op) {
      const text = checked(store, op.text);
      const today = store.today();
      const slot = nextMindSlot(store.doc(), today, 'deep');
      store.saveJournal({ kind: 'talk', day: today, slot, messages: [message(store, text, op)] }, 'claude');
      return `Said to George (${slot}${op.notify === true ? ', with a ping' : ''}): ${q(text, 80)}`;
    },

    propose(store, op) {
      const text = checked(store, op.text);
      const inner = Array.isArray(op.ops) ? op.ops : [];
      if (!inner.length || inner.length > MAX_PROPOSED) throw new Error(`propose needs ops: 1 to ${MAX_PROPOSED} of ${PROPOSE_OPS.join(', ')}`);
      for (const o of inner) if (!PROPOSE_OPS.includes(o?.op)) throw new Error(`A proposal can only ${PROPOSE_OPS.join(', ')} — not ${JSON.stringify(o?.op)}`);
      const before = structuredClone(store.doc());
      const values = new Map([[DATA_KEY, JSON.stringify(before)], [SETTINGS_KEY, JSON.stringify(store.settings())]]);
      const draft = createStore({
        storage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) },
        now: () => store.now(), newId: randomUUID,
      });
      for (const o of inner) runOp(draft, o);
      const edits = netEdits(before, draft.doc()).filter((e) => ['items', 'goals', 'milestones'].includes(e.map));
      if (!edits.length) throw new Error('That proposal changes nothing');
      const sparseBefore = emptyDoc();
      const sparseAfter = emptyDoc();
      for (const e of edits) {
        if (e.before) sparseBefore[e.map][e.id] = e.before;
        if (e.after) sparseAfter[e.map][e.id] = e.after;
      }
      const summary = describeEdits(edits, draft.doc()).join(' · ');
      const today = store.today();
      const slot = nextMindSlot(store.doc(), today, 'deep');
      store.saveJournal({
        kind: 'talk', day: today, slot, messages: [message(store, text, op)],
        proposal: { before: sparseBefore, after: sparseAfter, summary, id: randomUUID() },
      }, 'claude');
      return `Proposed to George (${slot}): ${summary}`;
    },

    // Marks what this deep run looked at. The record in data.json says when; mind.json (the events'
    // stamps and the run's summary) is written by the tool once the rest has been saved.
    handled(store, op) {
      const summary = str(op.summary);
      if (!summary) throw new Error('handled needs a summary: what you saw, what you did, what you are watching');
      if (summary.length > 1500) throw new Error('A summary can be at most 1,500 characters');
      if (op.events !== 'all' && !(Array.isArray(op.events) && op.events.every((e) => typeof e === 'string'))) {
        throw new Error('handled needs events: "all", or a list of event ids');
      }
      store.putCalendar('mind:status', { lastDeep: store.now().toISOString() }, 'claude');
      return `Deep run recorded: ${q(summary, 80)}`;
    },

    // The Mind's settings, for Claude in any chat.
    mind(store, op) {
      const changes = {};
      for (const [k, v] of Object.entries(op)) if (k !== 'op') changes[k] = checkMindSetting(k, v);
      if (!Object.keys(changes).length) throw new Error('mind needs at least one setting, e.g. {"op": "mind", "enabled": true}');
      const existing = store.doc().calendar?.['mind:config'];
      const keep = existing?.status === 'active' ? Object.fromEntries(Object.entries(existing).filter(([k]) => !['id', 'status', 'source', 'created', 'updated', 'archivedOn', '_sync'].includes(k))) : {};
      if (changes.models) changes.models = { ...(keep.models ?? {}), ...changes.models };
      store.putCalendar('mind:config', { ...keep, ...changes }, 'claude');
      return `The Mind's settings: ${Object.entries(changes).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(', ')}`;
    },
  };
}

// What a batch's `handled` op means for mind.json: the events stamped `deep` and the run recorded.
export function applyHandled(mind, op, now, trigger = 'scheduled') {
  const at = now.toISOString();
  const ids = op.events === 'all'
    ? unhandled(mind, 'deep').filter((e) => e.at <= at).map((e) => e.id)
    : op.events.filter((id) => mind.events[id]);
  for (const id of ids) mind.events[id] = { ...mind.events[id], deep: at };
  const id = `deep:${at}`;
  mind.runs[id] = { id, at, engine: 'deep', trigger, events: ids, summary: String(op.summary).trim().slice(0, 1500) };
  return ids.length;
}
