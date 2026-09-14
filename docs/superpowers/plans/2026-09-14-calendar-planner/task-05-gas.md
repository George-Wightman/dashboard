# Task 5: The planner in Apps Script

**Files:**
- Create: `planner/tag.js`, `planner/shims.js`, `planner/gas.js`, `tests/planner-apps.js`
- Test: `tests/planner-gas.test.js`

**Interfaces:**
- Consumes: `createStore`, `DATA_KEY`, `SETTINGS_KEY` (`js/data.js`); `emptyDoc`, `isDoc` (`js/doc.js`);
  `createGitHubClient`, `syncOnce` (`js/sync.js`); `readPlannerConfig`, `dayRecordId`, `plannerStatus`,
  `CALENDAR_DEFAULTS` (Task 1); `scrubText` (`js/flags.js`); `MODELS`, `ENDPOINT`, `readReply`
  (`js/gemini.js`); `plan`, `fillIds` (Task 4); `resolveCalendars` (Task 2); `P`, `at` (Task 2);
  `FakeCalendar` and friends (Task 4).
- Produces: `tagPrompt`, `readArea`, `installShims`, `createPlanner` (see *Shared interfaces*); in
  `tests/planner-apps.js`: `FakeRepo`, `fakeUtilities`, `appsScript(opts)`. Task 6 uses all of these.

- [ ] **Step 1: Create the Apps Script fakes** — `tests/planner-apps.js`:

```js
// Apps Script's services in memory, for the planner's tests: a sync repo behind GitHub's Contents
// API, Utilities, script properties, the lock, triggers, the logger, and UrlFetchApp routing
// GitHub and Gemini.

import { installShims } from '../planner/shims.js';

const toSigned = (b) => (b > 127 ? b - 256 : b);

export const fakeUtilities = {
  newBlob: (data) => {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data.map((b) => b & 255));
    return { getBytes: () => Array.from(buf, toSigned), getDataAsString: () => buf.toString('utf8') };
  },
  base64Encode: (bytes) => Buffer.from(bytes.map((b) => b & 255)).toString('base64'),
  base64Decode: (text) => Array.from(Buffer.from(text, 'base64'), toSigned),
  getUuid: (() => { let n = 0; return () => `uuid-${++n}`; })(),
};

// The sync repo `o/r`, with data.json behind the Contents API.
export class FakeRepo {
  constructor(doc = null) {
    this.text = doc ? JSON.stringify(doc) : null;
    this.sha = doc ? 'sha1' : undefined;
    this.n = 1;
    this.puts = 0;
  }

  doc() { return JSON.parse(this.text); }

  handle(method, url, payload) {
    if (!url.startsWith('https://api.github.com/repos/o/r/contents/data.json')) return { status: 404, body: { message: 'Not Found' } };
    if (method === 'get') {
      return this.text == null ? { status: 404, body: { message: 'Not Found' } }
        : { status: 200, body: { content: Buffer.from(this.text).toString('base64'), encoding: 'base64', sha: this.sha } };
    }
    const { content, sha } = JSON.parse(payload);
    if (this.sha !== sha) return { status: 409, body: { message: 'is at a different sha' } };
    this.text = Buffer.from(content, 'base64').toString('utf8');
    this.sha = `sha${++this.n}`;
    this.puts++;
    return { status: 200, body: { content: { sha: this.sha } } };
  }
}

export function appsScript({ cal, repo, props = {}, gemini = null, lockFree = true, failTriggers = [], now }) {
  const calls = [];
  const map = new Map(Object.entries(props));
  const scriptProps = {
    getProperty: (k) => (map.has(k) ? map.get(k) : null),
    setProperty: (k, v) => { map.set(k, String(v)); return scriptProps; },
    deleteProperty: (k) => { map.delete(k); return scriptProps; },
  };
  const UrlFetchApp = {
    fetch(url, opts = {}) {
      const method = String(opts.method ?? 'get').toLowerCase();
      calls.push({ url, method });
      const r = url.startsWith('https://api.github.com/')
        ? repo.handle(method, url, opts.payload)
        : (gemini ? gemini(url, opts) : { status: 500, body: { error: 'no Gemini here' } });
      const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
      return { getResponseCode: () => r.status, getContentText: () => text };
    },
  };
  const triggers = [];
  const made = (spec) => ({ create() { const t = { ...spec, getHandlerFunction: () => spec.fn }; triggers.push(t); return t; } });
  const ScriptApp = {
    getProjectTriggers: () => [...triggers],
    deleteTrigger: (t) => { triggers.splice(triggers.indexOf(t), 1); },
    newTrigger: (fn) => ({
      timeBased: () => ({ everyMinutes: (n) => made({ fn, everyMinutes: n }) }),
      forUserCalendar: (id) => ({
        onEventUpdated: () => (failTriggers.includes(id) ? { create() { throw new Error('Not allowed'); } } : made({ fn, calendar: id })),
      }),
    }),
  };
  const lines = [];
  const g = {};
  installShims(g, { Utilities: fakeUtilities, UrlFetchApp });
  return {
    Calendar: cal.service(),
    UrlFetchApp,
    Utilities: fakeUtilities,
    PropertiesService: { getScriptProperties: () => scriptProps },
    LockService: { getScriptLock: () => ({ tryLock: () => lockFree, releaseLock() {} }) },
    ScriptApp,
    Logger: { log: (t) => lines.push(String(t)) },
    fetch: g.fetch,
    now,
    // for the tests to look at
    props: map, calls, triggers, lines,
  };
}
```

- [ ] **Step 2: Write the failing tests** — create `tests/planner-gas.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlanner } from '../planner/gas.js';
import { installShims } from '../planner/shims.js';
import { tagPrompt, readArea } from '../planner/tag.js';
import { at } from '../planner/time.js';
import { fixture } from './helpers.js';
import { FakeCalendar, ev, MAIN, GYM, WORK } from './planner-fakes.js';
import { FakeRepo, fakeUtilities, appsScript } from './planner-apps.js';

process.env.TZ = 'Europe/London';

const TUE = '2026-09-15';
const TOKEN = 'ghp_dummy_token_1234567890';
const KEYS = { GITHUB_TOKEN: TOKEN, SYNC_REPO: 'o/r' };

function setup({ props = KEYS, items, clock = at(TUE, '08:00'), ...rest } = {}) {
  const doc = fixture({ items: items ?? [
    { id: 'hebrew', type: 'habit', title: 'Hebrew - app plus Duolingo', area: 'Hebrew', repeat: { kind: 'daily' } },
    { id: 'chase', type: 'task', title: 'Chase the GSS outcome', area: 'Job search', date: TUE, order: 1 },
    { id: 'dayout', type: 'task', title: 'Write the day out', area: 'Assessment centre', date: TUE, minutes: 60, order: 2 },
  ] });
  const cal = new FakeCalendar([
    ev(MAIN, 'Learn Hebrew', TUE, '09:30', '10:15'),
    ev(GYM, 'Gym', TUE, '11:00', '13:00'),
    ev(WORK, 'Signify', TUE, '14:00', '16:00'),
  ]);
  const repo = new FakeRepo(doc);
  let t = clock;
  const env = appsScript({ cal, repo, props, now: () => t, ...rest });
  const planner = createPlanner({ ...env, version: 'test1' });
  return { cal, repo, env, planner, setNow: (d) => { t = d; } };
}

test('shims: browser globals over Apps Script, and only where missing', async () => {
  const repo = new FakeRepo({ schema: 1, items: {} });
  const env = appsScript({ cal: new FakeCalendar(), repo });
  const g = {};
  installShims(g, { Utilities: fakeUtilities, UrlFetchApp: env.UrlFetchApp });
  assert.equal(new g.TextDecoder().decode(new g.TextEncoder().encode('Ünïcødé ✓')), 'Ünïcødé ✓');
  const binary = String.fromCharCode(0, 127, 128, 255);
  assert.equal(g.atob(g.btoa(binary)), binary);
  assert.deepEqual(g.structuredClone({ a: [1, { b: 2 }] }), { a: [1, { b: 2 }] });
  assert.match(g.crypto.randomUUID(), /^uuid-\d+$/);
  const res = await g.fetch('https://api.github.com/repos/o/r/contents/data.json', { headers: { Authorization: 'Bearer x' } });
  assert.equal(res.ok, true);
  assert.equal((await res.json()).sha, 'sha1');
  const own = () => 'mine';
  const h = { fetch: own };
  installShims(h, { Utilities: fakeUtilities, UrlFetchApp: env.UrlFetchApp });
  assert.equal(h.fetch, own);
});

test('tagPrompt and readArea: one of the areas, exactly, or none', () => {
  const { system, prompt } = tagPrompt('Email NatCen', ['Hebrew', 'Job search']);
  assert.match(system, /Answer only with JSON/);
  assert.equal(prompt, 'Areas: "Hebrew", "Job search"\nTo-do: "Email NatCen"');
  assert.equal(readArea({ area: 'job search' }, ['Hebrew', 'Job search']), 'Job search');
  assert.equal(readArea({ area: 'Cooking' }, ['Hebrew', 'Job search']), '');
  assert.equal(readArea(null, ['Hebrew']), '');
});

test('run: books the calendar, keeps its memory, and writes its records to the dashboard', async () => {
  const { cal, repo, env, planner } = setup();
  assert.equal(await planner.run(), 'ok');
  assert.equal(cal.mine().length, 2);
  const doc = repo.doc();
  assert.equal(doc.calendar['day:2'].day, TUE);
  assert.equal(doc.calendar['day:2'].blocks.length, 2);
  assert.ok(doc.calendar['day:2'].blocks.every((b) => b.eventId));
  assert.equal(doc.calendar.status.version, 'test1');
  assert.equal(doc.calendar.status.lastError, null);
  assert.equal(doc.calendar.config.source, 'planner');
  assert.equal(JSON.parse(env.props.get('DAYS'))[TUE].blocks.length, 2);
  assert.equal(repo.puts, 1);
});

test('run again: nothing to change, nothing pushed — until the hourly heartbeat', async () => {
  const { cal, repo, planner, setNow } = setup();
  await planner.run();
  const events = cal.all().length;
  assert.equal(await planner.run(), 'ok');
  assert.equal(cal.all().length, events);
  assert.equal(repo.puts, 1);
  setNow(at(TUE, '09:05'));
  await planner.run();
  assert.equal(repo.puts, 2);
  assert.equal(repo.doc().calendar.status.lastRun, at(TUE, '09:05').toISOString());
});

test('paused, busy, and its own echo', async () => {
  assert.equal(await setup({ props: { ...KEYS, PAUSED: '1' } }).planner.run(), 'paused');
  assert.equal(await setup({ lockFree: false }).planner.run(), 'busy');
  const { planner, env } = setup({ props: { ...KEYS, LAST_WRITE: String(at(TUE, '07:59').getTime()) } });
  assert.equal(await planner.run({ calendarId: WORK }), 'echo');
  assert.equal(await planner.run(), 'ok');
  assert.ok(env.props.get('LAST_WRITE'));
});

test('a failure is kept for the dashboard, with the key scrubbed', async () => {
  const none = setup({ props: {} });
  assert.equal(await none.planner.run(), 'failed');
  assert.match(none.env.props.get('LAST_ERROR'), /needs GITHUB_TOKEN and SYNC_REPO/);
  const leaky = setup();
  const planner = createPlanner({ ...leaky.env, fetch: async () => { throw new Error(`boom ${TOKEN}`); } });
  assert.equal(await planner.run(), 'failed');
  assert.doesNotMatch(leaky.env.props.get('LAST_ERROR'), /ghp_dummy/);
  assert.ok(leaky.env.lines.every((l) => !l.includes(TOKEN)));
  const next = setup({ props: { ...KEYS, LAST_ERROR: 'GitHub was down' } });
  await next.planner.run();
  assert.equal(next.repo.doc().calendar.status.lastError, 'GitHub was down');
});

test('a calendar change that fails is reported, and the rest still happen', async () => {
  const { cal, repo, planner } = setup();
  cal.fail = 'insert';
  assert.equal(await planner.run(), 'partly');
  assert.equal(cal.mine().length, 1);
  assert.match(repo.doc().calendar.status.lastError, /^1 calendar change failed — first: insert ".*": Rate Limit Exceeded$/);
});

test('install: every 10 minutes and on calendar changes, then a first run', async () => {
  const { env, planner } = setup({ failTriggers: [WORK] });
  const text = await planner.install();
  assert.match(text, /^Installed: the planner runs every 10 minutes\. Couldn't watch Work for changes — the 10-minute run covers them\. First run: ok\.$/);
  assert.deepEqual(env.triggers.map((t) => t.everyMinutes ?? t.calendar), [10, 'georgewight03@gmail.com', 'application@group', 'gym@group']);
  await planner.install();
  assert.equal(env.triggers.filter((t) => t.everyMinutes).length, 1, 'installing again replaces the triggers');
});

test('removeAll: every future block the planner made goes, and it pauses', async () => {
  const { cal, env, planner } = setup();
  await planner.run();
  const text = await planner.removeAll();
  assert.equal(text, 'Removed 2 planned blocks and paused the planner. Run resume() to start again.');
  assert.equal(cal.mine().length, 0);
  assert.equal(cal.all().length, 3);
  assert.equal(env.props.get('PAUSED'), '1');
  assert.equal(env.props.get('DAYS'), undefined);
  assert.match(await planner.resume(), /^Resumed\. First run: ok\.$/);
});

test('tagging: an untagged task gets an area from Gemini, asked once', async () => {
  let asked = 0;
  const gemini = () => { asked++; return { status: 200, body: { candidates: [{ content: { parts: [{ text: '{"area": "Job search"}' }] } }] } }; };
  const items = [
    { id: 'chase', type: 'task', title: 'Chase the GSS outcome', area: 'Job search', date: TUE, order: 1 },
    { id: 'natcen', type: 'task', title: 'Email NatCen about the deadline', area: '', date: TUE, order: 2 },
  ];
  const { repo, env, planner } = setup({ props: { ...KEYS, GEMINI_KEY: 'gm-dummy-key' }, items, gemini });
  await planner.run();
  assert.equal(repo.doc().items.natcen.area, 'Job search');
  assert.equal(asked, 1);
  assert.deepEqual(JSON.parse(env.props.get('TAGGED')), { natcen: 'Job search' });
  await planner.run();
  assert.equal(asked, 1);
  assert.ok(env.calls.every((c) => !c.url.includes('gm-dummy') || c.url.startsWith('https://generativelanguage.googleapis.com/')));
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `node --test tests/planner-gas.test.js`
Expected: FAIL — `Cannot find module '.../planner/shims.js'`.

- [ ] **Step 4: Create `planner/tag.js`**

```js
// Giving an untagged task an area, so it can share a block: one question to Gemini, answered from
// the dashboard's own areas or not at all. Pure; planner/gas.js makes the call.

export function tagPrompt(title, areas) {
  return {
    system: 'You sort to-do items into areas. Answer only with JSON: {"area": "<one of the areas, exactly as written>"}, or {"area": ""} when none fits.',
    prompt: `Areas: ${areas.map((a) => JSON.stringify(a)).join(', ')}\nTo-do: ${JSON.stringify(title)}`,
  };
}

export function readArea(data, areas) {
  const wanted = String(data?.area ?? '').trim().toLowerCase();
  return areas.find((a) => a.toLowerCase() === wanted) ?? '';
}
```

- [ ] **Step 5: Create `planner/shims.js`**

```js
// The browser globals the app's modules use, for Apps Script, which has none of them. Each is
// installed only where it's missing, over Apps Script's own services: fetch over UrlFetchApp (a
// Promise that is already settled — UrlFetchApp waits), text and base64 over Utilities.

const signed = (b) => (b > 127 ? b - 256 : b);

function binaryString(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.slice(i, i + 8192));
  return s;
}

export function installShims(g, { Utilities, UrlFetchApp }) {
  if (typeof g.TextEncoder !== 'function') {
    g.TextEncoder = class { encode(text) { return Uint8Array.from(Utilities.newBlob(String(text)).getBytes(), (b) => b & 255); } };
  }
  if (typeof g.TextDecoder !== 'function') {
    g.TextDecoder = class { decode(bytes) { return Utilities.newBlob(Array.from(bytes, signed)).getDataAsString('UTF-8'); } };
  }
  if (typeof g.btoa !== 'function') {
    g.btoa = (binary) => Utilities.base64Encode(Array.from(binary, (c) => signed(c.charCodeAt(0))));
  }
  if (typeof g.atob !== 'function') {
    g.atob = (b64) => binaryString(Utilities.base64Decode(b64).map((b) => b & 255));
  }
  if (typeof g.structuredClone !== 'function') {
    g.structuredClone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  }
  if (typeof g.crypto?.randomUUID !== 'function') {
    g.crypto = { ...(g.crypto ?? {}), randomUUID: () => Utilities.getUuid() };
  }
  if (typeof g.fetch !== 'function') {
    g.fetch = (url, init = {}) => {
      const headers = { ...(init.headers ?? {}) };
      let contentType;
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === 'content-type') { contentType = headers[k]; delete headers[k]; }
      }
      const options = { method: String(init.method ?? 'get').toLowerCase(), headers, muteHttpExceptions: true };
      if (init.body !== undefined) options.payload = init.body;
      if (contentType) options.contentType = contentType;
      try {
        const res = UrlFetchApp.fetch(url, options);
        const status = res.getResponseCode();
        const text = res.getContentText();
        return Promise.resolve({ ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) });
      } catch (e) {
        return Promise.reject(e);
      }
    };
  }
}
```

- [ ] **Step 6: Create `planner/gas.js`**

```js
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
import { plan, fillIds } from './plan.js';
import { resolveCalendars } from './calendars.js';
import { P } from './events.js';
import { at } from './time.js';
import { tagPrompt, readArea } from './tag.js';

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
}) {
  const props = () => PropertiesService.getScriptProperties();
  const get = (k) => props().getProperty(k);
  const put = (k, v) => props().setProperty(k, String(v));
  const drop = (k) => props().deleteProperty(k);
  const clean = (text) => scrubText(String(text), [get('GITHUB_TOKEN'), get('GEMINI_KEY')].filter(Boolean));
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
    const asked = JSON.parse(get('TAGGED') || '{}');
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
    put('TAGGED', JSON.stringify(Object.fromEntries(Object.entries(asked).filter(([id]) => live.has(id)))));
  }

  function apply(actions) {
    const byKey = {};
    const errors = [];
    for (const a of actions) {
      try {
        if (a.op === 'insert') byKey[a.key] = Calendar.Events.insert(a.body, a.calendarId).id;
        else if (a.op === 'patch') Calendar.Events.patch(a.body, a.calendarId, a.eventId);
        else Calendar.Events.remove(a.calendarId, a.eventId);
      } catch (err) {
        errors.push(`${a.op} "${a.body?.summary ?? a.eventId}": ${err?.message ?? err}`);
      }
    }
    return { byKey, errors };
  }

  function heartbeat(store, t, lastError) {
    const prev = plannerStatus(store.doc());
    const due = !prev || !prev.lastRun || prev.lastError !== lastError || prev.version !== version || prev.paused
      || t.getTime() - Date.parse(prev.lastRun) > HEARTBEAT_MS;
    if (due) store.putCalendar('status', { lastRun: t.toISOString(), lastError, version, paused: false });
  }

  async function run(e) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) return 'busy';
    try {
      if (get('PAUSED') === '1') return 'paused';
      const t = now();
      if (e && e.calendarId && Number(get('LAST_WRITE') ?? 0) > t.getTime() - ECHO_MS) return 'echo';
      const session = await open();
      const { store } = session;
      tag(store, t);
      const doc = store.doc();
      const { config } = readPlannerConfig(doc);
      const cals = calendars();
      const { watched } = resolveCalendars(cals, config);
      const today = logicalDay(t, dayStartHour());
      const events = listEvents(watched.map((c) => c.id), at(addDays(today, -1), '00:00').toISOString(), at(addDays(today, config.days), '04:00').toISOString());
      const result = plan({
        doc, now: t, dayStartHour: dayStartHour(), calendars: cals, events, eventColors: eventColors(),
        memory: JSON.parse(get('DAYS') || '{}'),
      });
      const { byKey, errors } = apply(result.actions);
      const days = fillIds(result.days, byKey);
      put('DAYS', JSON.stringify(days));
      if (result.actions.length) put('LAST_WRITE', now().getTime());
      for (const [day, rec] of Object.entries(days)) if (day >= today) store.putCalendar(dayRecordId(day), rec);
      if (!doc.calendar?.config) store.putCalendar('config', JSON.parse(JSON.stringify(CALENDAR_DEFAULTS)));
      const problem = errors.length
        ? `${errors.length} calendar change${errors.length === 1 ? '' : 's'} failed — first: ${errors[0]}`
        : get('LAST_ERROR');
      heartbeat(store, t, problem ? clean(problem) : null);
      drop('LAST_ERROR');
      if (session.changed()) {
        const pushed = await syncOnce({ store, client: session.client });
        if (!pushed.ok) {
          put('LAST_ERROR', clean(pushed.error));
          log(`Couldn't save to the dashboard: ${pushed.error}`);
          return 'failed';
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
      s.store.putCalendar('status', { lastRun: prev?.lastRun ?? null, lastError: prev?.lastError ?? null, version, paused: true });
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
    drop('DAYS');
    return `Removed ${n} planned block${n === 1 ? '' : 's'} and paused the planner. Run resume() to start again.`;
  }

  return { run, install, pause, resume, removeAll };
}
```

- [ ] **Step 7: Run the tests**

Run: `node --test tests/planner-gas.test.js` → PASS (10 tests). Then `npm test` → PASS.

- [ ] **Step 8: Commit**

```bash
git add planner/tag.js planner/shims.js planner/gas.js tests/planner-apps.js tests/planner-gas.test.js
git commit -m "Add the planner's Apps Script side: run, install, pause, resume, removeAll, tagging

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
