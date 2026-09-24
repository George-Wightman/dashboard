// The planner inside Google Apps Script. George's calendars come through the Calendar advanced
// service, the dashboard through the app's own GitHub client and sync, and the planner's memory of
// its last run lives in script properties. Every Apps Script service comes in as a parameter, so the
// tests run all of this in Node against fakes; planner/entry.js hands in the real ones.

import { createStore, DATA_KEY, SETTINGS_KEY } from '../js/data.js';
import { emptyDoc, isDoc } from '../js/doc.js';
import { createGitHubClient, syncOnce } from '../js/sync.js';
import { readPlannerConfig, dayRecordId, plannerStatus, CALENDAR_DEFAULTS } from '../js/calendar.js';
import { scrubText } from '../js/flags.js';
import { MODELS, ENDPOINT, readReply } from '../js/gemini.js';
import { addDays, logicalDay } from '../js/dates.js';
import { taskInput } from '../js/plan-state.js';
import { reconcileCalendar } from './reconcile.js';
import { adoptEvents } from './adopt.js';
import { ensureCommitment } from '../js/commit.js';
import { plan, fillIds } from './plan.js';
import { resolveCalendars } from './calendars.js';
import { P, atText } from './events.js';
import { at } from './time.js';
import { tagPrompt, readArea } from './tag.js';
import { syncHevy } from './hevy.js';
import { readProperty, writeProperty, deleteProperty, propertyParts } from './properties.js';
import { processWorkflows } from '../js/workflow.js';
import { runGoalReviews } from './reviews.js';
import { createMind } from './mind.js';

const HEARTBEAT_MS = 55 * 60000;
const ECHO_MS = 2 * 60000;
const TAG_PER_RUN = 5;

class MemoryStorage {
  constructor(initial = {}) { this.map = new Map(Object.entries(initial)); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

export function createPlanner({
  Calendar, UrlFetchApp, PropertiesService, LockService, ScriptApp, Logger = { log() {} },
  fetch = (...args) => globalThis.fetch(...args), now = () => new Date(), version = 'dev',
  DriveApp = null, Utilities = null, mindCrypto = null, clockMs = () => Date.now(),
}) {
  const props = () => PropertiesService.getScriptProperties();
  const get = (k) => props().getProperty(k);
  const put = (k, v) => props().setProperty(k, String(v));
  const drop = (k) => props().deleteProperty(k);
  const clean = (text) => scrubText(String(text), [get('GITHUB_TOKEN'), get('GEMINI_KEY'), get('HEVY_KEY'), get('MIND_ROUTINE_TOKEN'), get('VAPID_PRIVATE')].filter(Boolean));
  const log = (text) => Logger.log(clean(text));
  const dayStartHour = () => {
    const n = Number(get('DAY_START_HOUR') ?? 4);
    return Number.isInteger(n) && n >= 0 && n <= 12 ? n : 4;
  };

  function calendars() {
    const out = [];
    let pageToken;
    do {
      const res = Calendar.CalendarList.list({ maxResults: 250, pageToken });
      for (const c of res.items ?? []) {
        out.push({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: !!c.primary, backgroundColor: c.backgroundColor, accessRole: c.accessRole });
      }
      pageToken = res.nextPageToken;
    } while (pageToken);
    return out;
  }

  function eventColors() {
    return Object.fromEntries(Object.entries(Calendar.Colors.get().event ?? {}).map(([id, c]) => [id, c.background]));
  }

  function listEvents(ids, timeMin, timeMax, extra = {}) {
    const out = [];
    for (const calendarId of ids) {
      let pageToken;
      do {
        const res = Calendar.Events.list(calendarId, { timeMin, timeMax, singleEvents: true, showDeleted: false, maxResults: 2500, pageToken, ...extra });
        for (const e of res.items ?? []) out.push({ ...e, calendarId });
        pageToken = res.nextPageToken;
      } while (pageToken);
    }
    return out;
  }

  // A missing window result may have been dragged outside the window. Ask by
  // event identity before treating absence as deletion; an API error stops the pass.
  function resolveMissing(events, memory, watchedIds, t) {
    if (!Calendar.Events.get) return [];
    const present = new Set(events.map((e) => e.calendarId + '|' + e.id));
    const removed = [];
    for (const b of Object.values(memory).flatMap((d) => d.blocks ?? [])) {
      const key = b.calendarId + '|' + b.eventId;
      if (!b.eventId || present.has(key) || !watchedIds.includes(b.calendarId)
        || Date.parse(b.end) < t.getTime() || ['done', 'partial'].includes(b.state)) continue;
      present.add(key);
      let raw;
      try { raw = Calendar.Events.get(b.calendarId, b.eventId); }
      catch (error) {
        if (!/404|410|not found|gone/i.test(String(error?.message ?? error))) throw error;
      }
      if (raw && raw.status !== 'cancelled') events.push({ ...raw, calendarId: b.calendarId });
      else removed.push({ id: b.eventId, calendarId: b.calendarId, status: 'cancelled',
        extendedProperties: { private: { [P.mine]: '1', [P.items]: b.items.join(','), [P.state]: b.state,
          [P.key]: b.key, [P.title]: b.title, ...(b.start && b.end ? { [P.at]: atText(b.start, b.end) } : {}),
          ...(b.input ? { [P.input]: JSON.stringify(b.input) } : {}) } } });
    }
    return removed;
  }

  // The dashboard, in a store over memory, as the Claude tool opens it.
  async function open() {
    const token = get('GITHUB_TOKEN');
    const repo = get('SYNC_REPO');
    if (!token || !repo) throw new Error('The planner needs GITHUB_TOKEN and SYNC_REPO in its script properties');
    const client = createGitHubClient({ token, repo, fetch });
    const remote = await client.get();
    if (remote && !isDoc(remote.doc)) throw new Error("The sync file isn't a dashboard document — nothing was changed");
    const storage = new MemoryStorage({
      [DATA_KEY]: JSON.stringify(remote?.doc ?? emptyDoc()),
      [SETTINGS_KEY]: JSON.stringify({ dayStartHour: dayStartHour() }),
    });
    const store = createStore({ storage, now });
    let changed = false;
    store.subscribe((reason) => { if (reason === 'local') changed = true; });
    return { client, store, changed: () => changed };
  }

  function askArea(key, title, areas) {
    const { system, prompt } = tagPrompt(title, areas);
    const payload = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    });
    for (const model of MODELS) {
      try {
        const res = UrlFetchApp.fetch(`${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(key)}`,
          { method: 'post', contentType: 'application/json', payload, muteHttpExceptions: true });
        if (res.getResponseCode() === 200) return readArea(readReply(res.getContentText()), areas);
      } catch {
        // the next model
      }
    }
    return '';
  }

  // Untagged tasks in the window get an area, at most TAG_PER_RUN a run; each is asked about once.
  function tag(store, t) {
    const key = get('GEMINI_KEY');
    if (!key) return;
    const active = Object.values(store.doc().items ?? {}).filter((i) => i.status === 'active');
    const areas = [...new Set(active.map((i) => String(i.area ?? '').trim()).filter(Boolean))].sort();
    if (!areas.length) return;
    const asked = readProperty(props(), 'TAGGED');
    const last = addDays(logicalDay(t, dayStartHour()), 6);
    const todo = active
      .filter((i) => i.type === 'task' && !String(i.area ?? '').trim() && i.date <= last && !Object.hasOwn(asked, i.id))
      .slice(0, TAG_PER_RUN);
    if (!todo.length) return;
    for (const item of todo) {
      const area = askArea(key, item.title, areas);
      asked[item.id] = area;
      if (area) store.updateItem(item.id, { area });
    }
    const live = new Set(active.map((i) => i.id));
    writeProperty(props(), 'TAGGED', Object.fromEntries(Object.entries(asked).filter(([id]) => live.has(id)).slice(-500)));
  }

  // Hevy first, so a workout's tick is planned around in the same run. With no HEVY_KEY it's
  // skipped; its problems go in the gym's status for the dashboard and never stop the planner.
  async function hevy(store) {
    const key = get('HEVY_KEY');
    if (!key) return;
    const s = await syncHevy({ fetch, key, store, now, dayStartHour: dayStartHour(), scrub: clean });
    if (s.lastError) log(`Hevy: ${s.lastError}`);
  }

  function apply(actions, events) {
    const byKey = {};
    const errors = [];
    const eventKey = (calendarId, id) => `${calendarId}|${id}`;
    const actual = new Map(events.map((e) => [eventKey(e.calendarId, e.id), e]));
    const deleted = new Set();
    for (const a of actions) {
      if (a.afterDelete && !deleted.has(eventKey(a.afterDeleteCalendar ?? a.calendarId, a.afterDelete))) continue;
      try {
        if (a.op === 'insert') {
          const event = Calendar.Events.insert(a.body, a.calendarId);
          byKey[a.key] = event.id;
          actual.set(eventKey(a.calendarId, event.id), { ...a.body, ...event, calendarId: a.calendarId });
        } else if (a.op === 'patch') {
          const event = Calendar.Events.patch(a.body, a.calendarId, a.eventId);
          const key = eventKey(a.calendarId, a.eventId);
          actual.set(key, { ...actual.get(key), ...a.body, ...event, calendarId: a.calendarId });
        } else {
          Calendar.Events.remove(a.calendarId, a.eventId);
          const key = eventKey(a.calendarId, a.eventId);
          deleted.add(key);
          actual.delete(key);
        }
      } catch (err) {
        errors.push(`${a.op} "${a.body?.summary ?? a.eventId}": ${err?.message ?? err}`);
      }
    }
    return { byKey, errors, actual: [...actual.values()] };
  }

  // Publish only confirmed calendar state, including an old block whose deletion failed.
  function confirmedDays(planned, actual, cals) {
    const days = Object.fromEntries(Object.entries(planned).map(([d, rec]) => [d, { ...rec, blocks: [] }]));
    for (const ev of actual) {
      const p = ev.extendedProperties?.private;
      if (ev.status === 'cancelled' || p?.[P.mine] !== '1' || !ev.start?.dateTime || !ev.end?.dateTime) continue;
      let input = null;
      try { input = JSON.parse(p[P.input] || 'null'); } catch {}
      const day = logicalDay(new Date(ev.start.dateTime), 0);
      if (!days[day]) days[day] = { day, blocks: [], skipped: [], missed: [], notes: [] };
      days[day].blocks.push({ key: p[P.key], eventId: ev.id, calendarId: ev.calendarId,
        calendar: cals.find((c) => c.id === ev.calendarId)?.name ?? '', title: ev.summary ?? '',
        start: new Date(ev.start.dateTime).toISOString(), end: new Date(ev.end.dateTime).toISOString(),
        state: p[P.state], ...(input ? { input } : {}), items: String(p[P.items] ?? '').split(',').filter(Boolean) });
    }
    for (const rec of Object.values(days)) rec.blocks.sort((a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key));
    return days;
  }

  // The planner's status for the dashboard, at most hourly unless something in it changed. It
  // carries the colours George's calendars take, so Claude's tool can refuse a clashing area colour,
  // and the calendars themselves — the planner sees them every ten minutes, and without them written
  // down anyone reading the dashboard has to guess what George's calendars are even called. A whole
  // session once decided the planner was broken after looking at one calendar out of seven.
  const calendarList = (cals, watchedIds) => cals
    .map((c) => ({ name: String(c.name), watched: watchedIds.has(c.id), primary: !!c.primary }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  function heartbeat(store, t, lastError, takenColors = [], calendars = []) {
    const prev = plannerStatus(store.doc());
    const same = JSON.stringify(prev?.calendars ?? []) === JSON.stringify(calendars);
    const due = !prev || !prev.lastRun || prev.lastError !== lastError || prev.version !== version || prev.paused
      || (prev.takenColors ?? []).join() !== takenColors.join() || !same
      || t.getTime() - Date.parse(prev.lastRun) > HEARTBEAT_MS;
    if (due) store.putCalendar('status', { lastRun: t.toISOString(), lastError, version, paused: false, takenColors, calendars });
  }

  // How long the planner's runs have taken today, so the Mind's status can show it against Apps
  // Script's daily allowance.
  function countRunTime(startedMs) {
    try {
      const day = logicalDay(now(), dayStartHour());
      const prev = JSON.parse(get('RUN_MS') ?? 'null');
      put('RUN_MS', JSON.stringify({ day, ms: (prev?.day === day ? prev.ms : 0) + Math.max(0, clockMs() - startedMs) }));
    } catch { /* only a measurement */ }
  }

  async function run(e) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) return 'busy';
    const startedMs = clockMs();
    let mind = null;
    try {
      if (get('PAUSED') === '1') return 'paused';
      const t = now();
      if (e && e.calendarId && Number(get('LAST_WRITE') ?? 0) > t.getTime() - ECHO_MS) return 'echo';
      const session = await open();
      const { store } = session;
      await hevy(store);
      processWorkflows(store);
      const reviewKey = get('GEMINI_KEY');
      try {
        await runGoalReviews({ store, props: props(), request: reviewKey ? async ({ system, prompt }) => {
        // One call, no fallback loop: the review budget counts actual requests.
        const response = UrlFetchApp.fetch(`${ENDPOINT}/${MODELS[0]}:generateContent?key=${encodeURIComponent(reviewKey)}`, {
          method: 'post', contentType: 'application/json', muteHttpExceptions: true,
          payload: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }),
        });
        if (response.getResponseCode() !== 200) throw new Error('Goal review request failed');
        return readReply(response.getContentText());
        } : null });
        if (store.doc().calendar['review-status']?.lastError) store.putCalendar('review-status', { lastError: null });
      } catch (error) {
        log(`Goal reviews paused: ${error?.message ?? error}`);
        store.putCalendar('review-status', { lastError: 'Goal reviews could not run; calendar planning continues. Check the planner logs.' });
      }
      tag(store, t);
      let doc = store.doc();
      const { config } = readPlannerConfig(doc);
      const cals = calendars();
      const { watched } = resolveCalendars(cals, config);
      const today = logicalDay(t, dayStartHour());
      const events = listEvents(watched.map((c) => c.id), at(addDays(today, -1), '00:00').toISOString(), at(addDays(today, config.days), '04:00').toISOString());
      const memory = readProperty(props(), 'DAYS');
      const removed = resolveMissing(events, memory, watched.map((c) => c.id), t);
      reconcileCalendar(store, events, removed);
      adoptEvents(store, events, { calendars: cals, config, today, lastDay: addDays(today, config.days - 1) });
      // The 11:00 fallback for locking the day's list, when the app hasn't (js/commit.js).
      ensureCommitment(store, today, t);
      // Persist inbound edits before making outbound Calendar changes. Never
      // export from a draft that failed to reach the other interfaces.
      if (session.changed()) {
        const saved = await syncOnce({ store, client: session.client });
        if (!saved.ok) throw new Error('Could not save incoming calendar edits: ' + saved.error);
      }
      doc = store.doc();
      const result = plan({
        doc, now: t, dayStartHour: dayStartHour(), calendars: cals, events, eventColors: eventColors(),
        memory,
      });
      // Check the storage budget before mutating Calendar; reserve room for Google's event IDs.
      propertyParts(fillIds(result.days, Object.fromEntries(result.actions.filter((a) => a.key).map((a) => [a.key, 'x'.repeat(128)]))));
      const { errors, actual } = apply(result.actions, events);
      const days = confirmedDays(result.days, actual, cals);
      for (const c of Object.values(store.doc().calendar).filter((c) => c.resolution)) {
        const ev = actual.find((e) => e.status !== 'cancelled' && e.extendedProperties?.private?.[P.mine] === '1'
            && (e.id === c.eventId && e.calendarId === c.calendarId || String(e.extendedProperties.private[P.items] ?? '').split(',').includes(c.itemId))
            && e.extendedProperties.private[P.input] === JSON.stringify(taskInput(store.doc().items[c.itemId] ?? {})));
        let baseline = null;
        try { baseline = JSON.parse(ev?.extendedProperties?.private?.[P.input] || 'null'); } catch {}
        const item = store.doc().items[c.itemId];
        if (baseline && item && JSON.stringify(baseline) === JSON.stringify(taskInput(item))) store.putCalendar(c.id, { resolution: null });
      }
      writeProperty(props(), 'DAYS', days);
      store.putCalendar('agenda', { from: today, through: addDays(today, config.days - 1),
        syncedAt: t.toISOString(), busy: events.filter((e) => e.extendedProperties?.private?.[P.mine] !== '1' && e.status !== 'cancelled' && e.transparency !== 'transparent')
          .flatMap((e) => {
            const common = { title: e.summary || 'Busy', calendar: cals.find(c => c.id === e.calendarId)?.name ?? '' };
            if (e.start?.dateTime && e.end?.dateTime) return [{ ...common, start: e.start.dateTime, end: e.end.dateTime }];
            const out = [];
            if (e.start?.date && e.end?.date) for (let d = e.start.date < today ? today : e.start.date; d < e.end.date && d < addDays(today, config.days); d = addDays(d, 1)) {
              out.push({ ...common, allDay: true, start: at(d, '00:00').toISOString(), end: at(addDays(d, 1), '00:00').toISOString() });
            }
            return out;
          }), blocks: Object.values(days).filter((d) => d.day >= today).flatMap((d) => d.blocks) });
      if (result.actions.length) put('LAST_WRITE', now().getTime());
      // Day records are keyed by weekday (day:1 … day:7) and everything that reads them — the app's
      // list, the Coach, Claude's week — looks seven days at most. Writing a longer plan into them
      // put two dates in every slot and the second week won, so the days that actually matter read
      // as nothing booked. The planner's own memory is the DAYS property, not these, so keeping them
      // to the week costs it nothing.
      const lastRecorded = addDays(today, 7);
      for (const [day, rec] of Object.entries(days)) {
        if (day >= today && day < lastRecorded) store.putCalendar(dayRecordId(day), rec);
      }
      if (!doc.calendar?.config) store.putCalendar('config', JSON.parse(JSON.stringify(CALENDAR_DEFAULTS)));
      // The Coach's Mind (planner/mind.js): sense, react, call Claude in. It can never stop planning.
      try {
        mind = createMind({ UrlFetchApp, DriveApp, Utilities, props: { get, put }, log, fetch, now, token: get('GITHUB_TOKEN'), repo: get('SYNC_REPO'),
          dayStartHour: dayStartHour(), startedMs, crypto: mindCrypto, clockMs });
        await mind.think({ store, calEvents: events });
      } catch (err) {
        mind = null;
        const message = clean(`The Mind stopped: ${err?.message ?? err}`);
        log(message);
        try { store.putCalendar('mind:status', { lastRun: t.toISOString(), lastError: message.slice(0, 500) }); } catch { /* the planner carries on */ }
      }
      const problem = errors.length
        ? `${errors.length} calendar change${errors.length === 1 ? '' : 's'} failed — first: ${errors[0]}`
        : get('LAST_ERROR');
      heartbeat(store, t, problem ? clean(problem) : null, result.takenColors ?? [], calendarList(cals, new Set(watched.map((c) => c.id))));
      drop('LAST_ERROR');
      if (session.changed()) {
        const pushed = await syncOnce({ store, client: session.client });
        if (!pushed.ok) {
          put('LAST_ERROR', clean(pushed.error));
          log(`Couldn't save to the dashboard: ${pushed.error}`);
          return 'failed';
        }
      }
      // Pings and mind.json only once data.json holds the messages they're about.
      if (mind) {
        try {
          const after = await mind.after({ store });
          if (after.changed) await syncOnce({ store, client: session.client });
        } catch (err) {
          log(clean(`The Mind couldn't finish: ${err?.message ?? err}`));
        }
      }
      if (errors.length) log(problem);
      return errors.length ? 'partly' : 'ok';
    } catch (err) {
      const message = clean(err?.message ?? err);
      put('LAST_ERROR', message);
      log(`The planner stopped: ${message}`);
      return 'failed';
    } finally {
      countRunTime(startedMs);
      lock.releaseLock();
    }
  }

  async function install() {
    for (const tr of ScriptApp.getProjectTriggers()) if (tr.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(tr);
    ScriptApp.newTrigger('run').timeBased().everyMinutes(10).create();
    let config = CALENDAR_DEFAULTS;
    try {
      config = readPlannerConfig((await open()).store.doc()).config;
    } catch (err) {
      throw new Error(clean(err?.message ?? err));
    }
    const unwatched = [];
    for (const c of resolveCalendars(calendars(), config).watched) {
      try {
        ScriptApp.newTrigger('run').forUserCalendar(c.id).onEventUpdated().create();
      } catch {
        unwatched.push(c.name.trim());
      }
    }
    drop('PAUSED');
    const first = await run();
    const also = unwatched.length
      ? ` Couldn't watch ${unwatched.join(', ')} for changes — the 10-minute run covers them.`
      : ' It also runs whenever one of your calendars changes.';
    return `Installed: the planner runs every 10 minutes.${also} First run: ${first}.`;
  }

  async function pause() {
    put('PAUSED', '1');
    try {
      const s = await open();
      const prev = plannerStatus(s.store.doc());
      s.store.putCalendar('status', { lastRun: prev?.lastRun ?? null, lastError: prev?.lastError ?? null, version, paused: true, takenColors: prev?.takenColors ?? [] });
      if (s.changed()) await syncOnce({ store: s.store, client: s.client });
    } catch (err) {
      log(`Paused, but couldn't tell the dashboard: ${err?.message ?? err}`);
    }
    return 'Paused. Run resume() to start again.';
  }

  async function resume() {
    drop('PAUSED');
    return `Resumed. First run: ${await run()}.`;
  }

  // Every future event the planner made goes, and it pauses (nothing it made in the past is touched).
  async function removeAll() {
    put('PAUSED', '1');
    const t = now();
    let config = CALENDAR_DEFAULTS;
    try { config = readPlannerConfig((await open()).store.doc()).config; } catch { /* the defaults will do */ }
    const today = logicalDay(t, dayStartHour());
    const found = listEvents(resolveCalendars(calendars(), config).watched.map((c) => c.id),
      at(today, '00:00').toISOString(), at(addDays(today, 60), '00:00').toISOString(), { privateExtendedProperty: `${P.mine}=1` });
    let n = 0;
    for (const ev of found) {
      if (!(Date.parse(ev.start?.dateTime ?? '') > t.getTime())) continue;
      try {
        Calendar.Events.remove(ev.calendarId, ev.id);
        n++;
      } catch (err) {
        log(`Couldn't remove "${ev.summary}": ${err?.message ?? err}`);
      }
    }
    deleteProperty(props(), 'DAYS');
    return `Removed ${n} planned block${n === 1 ? '' : 's'} and paused the planner. Run resume() to start again.`;
  }

  return { run, install, pause, resume, removeAll };
}
