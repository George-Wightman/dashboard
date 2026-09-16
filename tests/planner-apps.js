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
    setProperty: (k, v) => {
      if (Buffer.byteLength(String(v), 'utf8') > 9 * 1024) throw new Error('Property value exceeds 9 KB');
      map.set(k, String(v));
      return scriptProps;
    },
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
