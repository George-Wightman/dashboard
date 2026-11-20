// Apps Script's services in memory, for the planner's tests: a sync repo behind GitHub's Contents
// API, Utilities, script properties, the lock, triggers, the logger, and UrlFetchApp routing
// GitHub and Gemini.

import crypto from 'node:crypto';
import { installShims } from '../planner/shims.js';

const toSigned = (b) => (b > 127 ? b - 256 : b);

export const fakeUtilities = {
  newBlob: (data) => {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data.map((b) => b & 255));
    return { getBytes: () => Array.from(buf, toSigned), getDataAsString: () => buf.toString('utf8') };
  },
  // Bytes, or (like Apps Script) a string in a given charset.
  base64Encode: (data, charset) => (typeof data === 'string'
    ? Buffer.from(data, charset === 'UTF-8' ? 'utf8' : 'latin1').toString('base64')
    : Buffer.from(data.map((b) => b & 255)).toString('base64')),
  Charset: { UTF_8: 'UTF-8', US_ASCII: 'US-ASCII' },
  base64Decode: (text) => Array.from(Buffer.from(text, 'base64'), toSigned),
  getUuid: (() => { let n = 0; return () => `uuid-${++n}`; })(),
  DigestAlgorithm: { SHA_256: 'sha256' },
  computeDigest: (alg, bytes) => Array.from(crypto.createHash(alg).update(Buffer.from(bytes.map((b) => b & 255))).digest(), toSigned),
  computeHmacSha256Signature: (value, key) => Array.from(crypto.createHmac('sha256', Buffer.from(key.map((b) => b & 255))).update(Buffer.from(value.map((b) => b & 255))).digest(), toSigned),
};

// The sync repo `o/r`, with data.json behind the Contents API — and any other file beside it.
export class FakeRepo {
  constructor(doc = null) {
    this.text = doc ? JSON.stringify(doc) : null;
    this.sha = doc ? 'sha1' : undefined;
    this.n = 1;
    this.puts = 0;
    this.others = new Map();
    // Claude's branches (planner/branches.js): name → { sha, files: { path: text } }.
    this.branches = new Map();
  }

  doc() { return JSON.parse(this.text); }
  file(path) { const f = this.others.get(path); return f ? JSON.parse(f.text) : null; }

  handle(method, url, payload, headers = {}) {
    if (url === 'https://api.github.com/repos/o/r/git/matching-refs/heads/claude/') {
      return { status: 200, body: [...this.branches].map(([name, b]) => ({ ref: `refs/heads/${name}`, object: { sha: b.sha } })) };
    }
    const path = url.startsWith('https://api.github.com/repos/o/r/contents/') ? url.slice('https://api.github.com/repos/o/r/contents/'.length).split('?')[0] : null;
    const ref = /[?&]ref=([^&]+)/.exec(url)?.[1];
    if (path && ref) {
      const text = [...this.branches.values()].find((b) => b.sha === decodeURIComponent(ref))?.files[path];
      return text == null ? { status: 404, body: { message: 'Not Found' } } : { status: 200, body: { content: Buffer.from(text).toString('base64'), encoding: 'base64', sha: `${ref}-${path}` } };
    }
    if (path && path !== 'data.json') {
      const f = this.others.get(path);
      if (method === 'get') return f ? { status: 200, body: { content: Buffer.from(f.text).toString('base64'), encoding: 'base64', sha: f.sha } } : { status: 404, body: { message: 'Not Found' } };
      if (this.failPut?.has(path)) return { status: 500, body: { message: 'Server Error' } };
      const { content, sha } = JSON.parse(payload);
      if ((f?.sha ?? undefined) !== sha) return { status: 409, body: { message: 'is at a different sha' } };
      const text = Buffer.from(content, 'base64').toString('utf8');
      // The archive's files (js/archive.js) are named by their blob sha, so they get real-looking ones:
      // git's, of the content.
      const next = path.startsWith('archive/')
        ? crypto.createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex')
        : `${path}-sha${++this.n}`;
      if (path.startsWith('archive/')) this.archivePuts = (this.archivePuts ?? 0) + 1;
      this.others.set(path, { text, sha: next });
      return { status: 200, body: { content: { sha: next } } };
    }
    // A data.json over 1 MB (`big`): the Contents API leaves the content out and it's read as a blob,
    // raw when asked for raw, GitHub's base64 JSON otherwise.
    const blob = /^https:\/\/api\.github\.com\/repos\/o\/r\/git\/blobs\/(.+)$/.exec(url);
    if (blob) {
      this.blobReads = (this.blobReads ?? 0) + 1;
      // Any other file's version, by its sha (the archive's year files); `failBlob` names files whose read fails.
      const other = [...this.others].find(([, f]) => f.sha === blob[1]);
      if (other) {
        if (this.failBlob?.has(other[0])) return { status: 502, body: { message: 'Bad Gateway' } };
        return headers.Accept === 'application/vnd.github.raw+json' ? { status: 200, body: other[1].text }
          : { status: 200, body: { sha: blob[1], content: Buffer.from(other[1].text).toString('base64'), encoding: 'base64' } };
      }
      if (blob[1] !== this.sha || this.text == null) return { status: 404, body: { message: 'Not Found' } };
      return headers.Accept === 'application/vnd.github.raw+json' ? { status: 200, body: this.text }
        : { status: 200, body: { sha: this.sha, content: Buffer.from(this.text).toString('base64'), encoding: 'base64' } };
    }
    if (this.big && method === 'get' && url === 'https://api.github.com/repos/o/r/contents/data.json' && this.text != null) {
      return { status: 200, body: { content: '', encoding: 'none', sha: this.sha } };
    }
    if (!url.startsWith('https://api.github.com/repos/o/r/contents/data.json')) return { status: 404, body: { message: 'Not Found' } };
    if (method === 'get' && headers.Accept === 'application/vnd.github.raw+json') {
      return this.text == null ? { status: 404, body: { message: 'Not Found' } } : { status: 200, body: this.text };
    }
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

export function appsScript({ cal, repo, props = {}, gemini = null, push = () => ({ status: 201, body: '' }), routine = () => ({ status: 200, body: { type: 'routine_fire' } }),
  DriveApp = null, lockFree = true, failTriggers = [], now }) {
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
  const pushes = [];
  const fires = [];
  const route = (url, opts) => {
    const method = String(opts.method ?? 'get').toLowerCase();
    calls.push({ url, method });
    if (url.startsWith('https://api.github.com/')) return repo.handle(method, url, opts.payload, opts.headers);
    if (url.startsWith('https://api.anthropic.com/')) { fires.push({ url, opts }); return routine(url, opts); }
    if (/^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[\w.-]+\.push\.apple\.com|[\w.-]+\.notify\.windows\.com)\//.test(url)) {
      pushes.push({ url, opts });
      return push(url, opts);
    }
    // Everything else (Gemini, Hevy) goes to the test's own handler, as it always has.
    return gemini ? gemini(url, opts) : { status: 500, body: { error: 'no Gemini here' } };
  };
  const respond = (r) => {
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return { getResponseCode: () => r.status, getContentText: () => text };
  };
  const UrlFetchApp = {
    fetch: (url, opts = {}) => respond(route(url, opts)),
    fetchAll: (requests) => requests.map((req) => respond(route(req.url, req))),
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
    DriveApp,
    fetch: g.fetch,
    now,
    // for the tests to look at
    props: map, calls, triggers, lines, pushes, fires,
  };
}
