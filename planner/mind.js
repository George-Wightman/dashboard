// The Mind's part of each planner run (docs/superpowers/specs/2026-09-25-coach-mind-design.md).
// think(), after the calendar has been written: load mind.json, sense what changed, read the Drive
// files behind finished work, turn George's questions into events, then — when the Mind is switched
// on — write the day's openers, run the Reflexes, and call Claude's routine in when something needs
// real thought. after(), once data.json has been saved: send the pings the new messages asked for,
// prune, and save mind.json. Nothing here can stop the planner: every failure becomes a line in
// mind:status.

import { createGitHubClient } from '../js/sync.js';
import { logicalDay, addDays } from '../js/dates.js';
import { mindConfig, mindStatus, isQuiet, openAsks, pushSubscriptions, mindMessages, messageKey } from '../js/mind.js';
import { loadMind, saveMind, pruneMind, budget, spend } from '../js/mind-state.js';
import { stableStringify } from '../js/doc.js';
import { sense, planRisk } from './senses.js';
import { readArtefacts } from './drive.js';
import { createGemini } from './gemini-gas.js';
import { runReflexes, backgroundOpenerDue, writeOpener } from './reflex.js';
import { pushRequest, makeVapidKeys, gasCrypto, vapidAuthorization, fromB64url } from './webpush.js';
import { bytesToBig } from './p256.js';

export const MIND_SECONDS = 150;
export const FIRE_WAIT_MINUTES = 40;
export const PUSH_MAX_AGE_HOURS = 6;
export const PUSH_TRIES = 3;
const HEARTBEAT_MS = 55 * 60000;
const ROUTINE_PREFIX = 'https://api.anthropic.com/v1/claude_code/routines/';
export const VAPID_SUBJECT = 'https://george-wightman.github.io/dashboard/';
const FINAL = new Set(['sent', 'quiet', 'gone', 'given-up', 'capped']);

const latest = (runs, engines) => Object.values(runs).filter((r) => engines.includes(r.engine)).map((r) => r.at).sort().at(-1) ?? null;

export function createMind({
  UrlFetchApp, DriveApp = null, Utilities = null, props, log = () => {}, fetch, now, token, repo, dayStartHour = 4,
  startedMs = Date.now(), crypto = null, clockMs = () => Date.now(),
}) {
  const client = createGitHubClient({ token, repo, path: 'mind.json', fetch });
  const tools = crypto ?? (Utilities ? gasCrypto(Utilities) : null);
  let mind = null;
  let loadedAs = null;
  const problems = [];
  // mind.json as it was read, less the cursor's clock: a run that saw nothing new writes nothing.
  const fingerprint = (m) => stableStringify({ ...m, cursor: m.cursor ? { ...m.cursor, at: null } : null });
  const note = (text) => { problems.push(text); log(`Mind: ${text}`); };

  function vapid(store) {
    if (!tools) return null;
    let privateKey = props.get('VAPID_PRIVATE');
    let publicKey = props.get('VAPID_PUBLIC');
    if (!privateKey || !publicKey) {
      ({ privateKey, publicKey } = makeVapidKeys(tools.randomBytes));
      props.put('VAPID_PRIVATE', privateKey);
      props.put('VAPID_PUBLIC', publicKey);
    }
    if (store && store.doc().calendar?.['push-config']?.publicKey !== publicKey) store.putCalendar('push-config', { publicKey }, 'planner');
    return { privateKey, publicKey };
  }

  function writeStatus(store, t, today, speaking = false) {
    const prev = mindStatus(store.doc());
    const b = mind ? budget(mind, today) : null;
    const runMs = (() => { try { const r = JSON.parse(props.get('RUN_MS') ?? 'null'); return r?.day === today ? r.ms : 0; } catch { return 0; } })();
    const content = {
      lastRun: t.toISOString(),
      // Whether the background can actually speak (switched on, with a Gemini key): only then does
      // the page leave the openers to it (js/mind.js's mindAlive).
      speaking,
      lastReflex: mind ? latest(mind.runs, ['reflex', 'opener']) : prev?.lastReflex ?? null,
      lastDeep: mind ? latest(mind.runs, ['deep']) : prev?.lastDeep ?? null,
      lastError: problems.length ? problems.join('; ').slice(0, 500) : null,
      today: b ? { day: today, gemini: b.gemini, messages: b.messages, pings: b.pings, deep: b.deep, runMs } : prev?.today ?? null,
    };
    const due = !prev || prev.lastError !== content.lastError || prev.speaking !== content.speaking || prev.lastReflex !== content.lastReflex || prev.lastDeep !== content.lastDeep
      || prev.today?.messages !== content.today?.messages || t.getTime() - Date.parse(prev.lastRun ?? 0) > HEARTBEAT_MS;
    if (due) store.putCalendar('mind:status', content, 'planner');
  }

  // Claude's routine, for what needs real thought: George's questions first (one of the day's runs is
  // kept for them), then re-plans a Reflex asked for and plans at risk. Never while one is outstanding.
  function fire(store, t, today, config, escalate) {
    const url = props.get('MIND_ROUTINE_URL');
    const key = props.get('MIND_ROUTINE_TOKEN');
    if (!url || !key) return;
    if (!url.startsWith(ROUTINE_PREFIX)) { note('MIND_ROUTINE_URL is not a Claude routine address'); return; }
    const fired = new Set(mind.fired.flatMap((f) => f.events ?? []));
    const open = (e) => !e.deep && !fired.has(e.id);
    const asks = Object.values(mind.events).filter((e) => e.kind === 'ask' && open(e));
    const others = [...new Set([...escalate, ...Object.values(mind.events).filter((e) => e.kind === 'risk' && open(e)).map((e) => e.id)])]
      .filter((id) => mind.events[id] && open(mind.events[id]));
    if (!asks.length && !others.length) return;
    const last = mind.fired.at(-1);
    const lastDeep = latest(mind.runs, ['deep']);
    if (last && t.getTime() - Date.parse(last.at) < FIRE_WAIT_MINUTES * 60000 && !(lastDeep && lastDeep > last.at)) return;
    const b = budget(mind, today);
    const quiet = isQuiet(store.doc(), t, dayStartHour);
    const useAsks = asks.length && b.deep < config.deepPerDay;
    const useOthers = !useAsks && others.length && !quiet && b.deep < config.deepPerDay - 1;
    if (!useAsks && !useOthers) return;
    const reason = useAsks ? 'ask' : others.some((id) => mind.events[id].kind === 'risk') ? 'risk' : 'escalate';
    const ids = useAsks ? asks.map((e) => e.id) : others;
    const res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: `Bearer ${key}`, 'anthropic-beta': 'experimental-cc-routine-2026-04-01', 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({ text: `${reason}: ${ids.join(' ')}` }),
    });
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) {
      mind.fired.push({ at: t.toISOString(), reason, events: ids });
      spend(mind, today, 'deep');
    } else note(`Couldn't start Claude's review (HTTP ${code})`);
  }

  async function think({ store, calEvents = [] }) {
    const t = now();
    const today = logicalDay(t, dayStartHour);
    const loaded = await loadMind(client);
    if (loaded.failed) {
      note(`Couldn't read mind.json: ${loaded.problem}`);
      writeStatus(store, t, today);
      return;
    }
    mind = loaded.mind;
    loadedAs = loaded.sha ? fingerprint(mind) : null;
    if (loaded.problem) note(loaded.problem);
    const config = mindConfig(store.doc());
    try { vapid(store); } catch (e) { note(`Couldn't make the notification keys: ${e?.message ?? e}`); }

    const { cursor, events } = sense({ doc: store.doc(), cursor: mind.cursor, calEvents, now: t, dayStartHour });
    mind.cursor = cursor;
    for (const e of events) {
      if (mind.events[e.id]) continue;
      if (e.paths?.length && e.level >= 2) {
        const r = readArtefacts({ DriveApp, paths: e.paths, now: t });
        if (r.files.length) e.artefacts = r.files;
        if (r.problem) note(`Drive: ${r.problem}`);
      }
      mind.events[e.id] = e;
    }
    for (const a of openAsks(store.doc())) store.putCalendar(a.id, { status: 'archived', archivedOn: today }, 'planner');
    for (const r of planRisk(store.doc(), Object.values(mind.events), today, t)) if (!mind.events[r.id]) mind.events[r.id] = r;

    const key = props.get('GEMINI_KEY');
    let escalate = [];
    if (config.enabled && key) {
      const blocked = new Set(budget(mind, today).geminiBlocked ?? []);
      const gemini = createGemini({
        UrlFetchApp, key, models: config.models, log,
        budget: { left: () => config.geminiPerDay - budget(mind, today).gemini, spend: (n) => spend(mind, today, 'gemini', n), blocked },
      });
      const timeLeft = () => clockMs() - startedMs < MIND_SECONDS * 1000;
      const quiet = isQuiet(store.doc(), t, dayStartHour);
      const slot = backgroundOpenerDue({ doc: store.doc(), now: t, config, dayStartHour, quiet });
      if (slot && timeLeft()) {
        const o = await writeOpener({ gemini, store, slot, now: t, config, quiet, dayStartHour });
        mind.runs[`opener:${o.m.at}:${slot}`] = { id: `opener:${o.m.at}:${slot}`, at: o.m.at, engine: 'opener', trigger: slot, events: [], said: true, summary: `by ${o.m.by}` };
      }
      const r = await runReflexes({ gemini, store, mind, now: t, config, timeLeft, quiet, dayStartHour });
      escalate = r.escalate;
      mind.budget = { ...budget(mind, today), geminiBlocked: [...blocked].sort() };
      if (blocked.size >= 2) note("Gemini's free allowance is used up for today");
    }
    fire(store, t, today, config, escalate);
    writeStatus(store, t, today, !!(config.enabled && key));
  }

  // The pings the Mind's new messages asked for, to every device that turned notifications on; then
  // mind.json. Only called once data.json has been saved, so every ping opens a message that's there.
  // Returns { changed } — true when a device's subscription was retired and data.json needs saving again.
  async function after({ store }) {
    if (!mind) return { changed: false };
    const t = now();
    const today = logicalDay(t, dayStartHour);
    const doc = store.doc();
    const config = mindConfig(doc);
    let changed = false;
    const pending = mindMessages(doc, addDays(today, -1)).filter((x) => x.m.notify === true
      && t.getTime() - Date.parse(x.m.at) < PUSH_MAX_AGE_HOURS * 3600000 && !FINAL.has(mind.pushed[messageKey(x.talkId, x.m)]?.state));
    const subs = pushSubscriptions(doc);
    const keys = tools ? vapid(null) : null;
    if (pending.length && subs.length && keys) {
      const quiet = isQuiet(doc, t, dayStartHour);
      const auth = new Map();
      const authFor = (endpoint) => {
        const origin = (/^(https:\/\/[^/]+)/.exec(endpoint) ?? [])[1] ?? endpoint;
        if (!auth.has(origin)) {
          auth.set(origin, vapidAuthorization({ ...tools, endpoint, now: t, subject: VAPID_SUBJECT,
            privateKey: bytesToBig(fromB64url(keys.privateKey)), publicKey: fromB64url(keys.publicKey) }));
        }
        return auth.get(origin);
      };
      const gone = new Set();
      for (const x of pending) {
        const k = messageKey(x.talkId, x.m);
        const before = mind.pushed[k];
        if (quiet) { mind.pushed[k] = { at: t.toISOString(), state: 'quiet' }; continue; }
        if (!before && budget(mind, today).pings >= config.pingsPerDay) { mind.pushed[k] = { at: t.toISOString(), state: 'capped' }; continue; }
        const live = subs.filter((s) => !gone.has(s.id));
        if (!live.length) break;
        const message = { title: 'Coach', body: x.m.text.slice(0, 140), url: `./?coach=${x.talkId}`, tag: x.talkId };
        let responses;
        try {
          // A body of bytes goes as a Blob: a plain array could be taken for form fields.
          const asBlob = (req) => (Utilities ? { ...req, payload: Utilities.newBlob(req.payload, 'application/octet-stream') } : req);
          responses = UrlFetchApp.fetchAll(live.map((sub) => asBlob(pushRequest({ ...tools, sub, message, vapid: keys, now: t, subject: VAPID_SUBJECT, authorization: authFor(sub.endpoint) }))));
        } catch (e) {
          note(`Couldn't send a ping: ${e?.message ?? e}`);
          break;
        }
        let sent = false;
        responses.forEach((res, i) => {
          const code = res.getResponseCode();
          if (code >= 200 && code < 300) sent = true;
          else if (code === 404 || code === 410) gone.add(live[i].id);
          else note(`A ping to the ${live[i].label ?? 'device'} failed (HTTP ${code})`);
        });
        if (!before) spend(mind, today, 'pings');
        const tries = (before?.tries ?? 0) + 1;
        mind.pushed[k] = sent ? { at: t.toISOString(), state: 'sent' }
          : live.every((s) => gone.has(s.id)) ? { at: t.toISOString(), state: 'gone' }
          : { at: t.toISOString(), state: tries >= PUSH_TRIES ? 'given-up' : 'failed', tries };
      }
      for (const id of gone) { store.putCalendar(id, { status: 'archived', archivedOn: today }, 'planner'); changed = true; }
    }
    pruneMind(mind, t);
    if (loadedAs !== fingerprint(mind)) {
      const saved = await saveMind({ client, mind });
      if (!saved.ok) log(`Mind: couldn't save mind.json: ${saved.error}`);
    }
    return { changed };
  }

  return { think, after, problems: () => [...problems] };
}
