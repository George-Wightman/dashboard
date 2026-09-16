// Sync with one JSON file in a private GitHub repo: GET → merge → apply locally → PUT with the
// sha. A 409 means another device wrote in between, so go round again. Never throws, never
// blocks: every failure comes back as { ok: false, error } for the header to show.

import { mergeDocs, sameDoc } from './merge.js';
import { isDoc } from './doc.js';

export class ConflictError extends Error {}

const API = 'https://api.github.com';

export function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function decodeBase64(b64) {
  const binary = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export function createGitHubClient({ token, repo, path = 'data.json', fetch = (...args) => globalThis.fetch(...args), timeoutMs = 20000, timers = globalThis }) {
  const url = `${API}/repos/${repo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // Bound the entire operation, including body reads. Race as well as abort:
  // a suspended connection (or an adapter ignoring abort) must release sync.
  async function bounded(operation) {
    if (typeof timers.setTimeout !== 'function') return operation(undefined); // Apps Script uses synchronous UrlFetchApp
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = timers.setTimeout(() => {
        reject(new Error('GitHub sync timed out — will retry'));
        abort?.abort();
      }, timeoutMs);
    });
    try { return await Promise.race([operation(abort?.signal), deadline]); }
    finally { timers.clearTimeout(timer); }
  }

  async function failure(res) {
    let message = '';
    try { message = (await res.json())?.message ?? ''; } catch { /* no body */ }
    return new Error(`GitHub ${res.status}${message ? `: ${message}` : ''}`);
  }

  // Plain-English cause for the two ways a bad or under-scoped key shows up: 401/403 on any
  // request, or a 404 on PUT (GitHub answers 404 rather than 403 when a fine-grained key can't
  // see the repo at all). Everything else keeps GitHub's own message.
  async function explain(res, repo, where) {
    if (res.status === 401 || res.status === 403) {
      return new Error(`GitHub refused the access key — check it hasn't expired and has Contents read and write on ${repo}`);
    }
    if (res.status === 404 && where === 'put') {
      return new Error(`GitHub can't see ${repo} with this key — check the repo name, and that the key was given access to that repo`);
    }
    return failure(res);
  }

  return {
    get: () => bounded(async (signal) => {
      const res = await fetch(url, { headers, cache: 'no-store', ...(signal ? { signal } : {}) });
      if (res.status === 404) return null;
      if (!res.ok) throw await explain(res, repo, 'get');
      const body = await res.json();
      // Over 1 MB, the Contents API omits `content` and the file must be read as a blob instead.
      if (!body.content || body.encoding === 'none') {
        const blobRes = await fetch(`${API}/repos/${repo}/git/blobs/${body.sha}`, { headers, cache: 'no-store', ...(signal ? { signal } : {}) });
        if (!blobRes.ok) throw await explain(blobRes, repo, 'get');
        const blob = await blobRes.json();
        return { doc: JSON.parse(decodeBase64(blob.content)), sha: body.sha };
      }
      return { doc: JSON.parse(decodeBase64(body.content)), sha: body.sha };
    }),

    put: (doc, sha) => bounded(async (signal) => {
      const res = await fetch(url, {
        method: 'PUT',
        ...(signal ? { signal } : {}),
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'sync', content: encodeBase64(JSON.stringify(doc)), ...(sha ? { sha } : {}) }),
      });
      if (res.status === 409) throw new ConflictError(`GitHub 409`);
      if (res.status === 422) {
        const err = await failure(res);
        if (/sha/i.test(err.message)) throw new ConflictError(err.message);
        throw err;
      }
      if (!res.ok) throw await explain(res, repo, 'put');
      return (await res.json()).content.sha;
    }),
  };
}

export async function syncOnce({ store, client, maxAttempts = 3 }) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let remote;
    try {
      remote = await client.get();
    } catch (e) {
      return { ok: false, error: e.message };
    }
    if (remote && !isDoc(remote.doc)) {
      return { ok: false, error: "The sync file isn't a dashboard document — nothing was changed" };
    }

    let merged;
    try {
      merged = mergeDocs(store.doc(), remote?.doc ?? null);
    } catch (e) {
      return { ok: false, error: `Merge failed: ${e.message}` };
    }
    try { store.replaceDoc(merged); }
    catch (e) { return { ok: false, error: `Couldn't apply sync: ${e.message}` }; }
    if (remote && sameDoc(merged, remote.doc)) return { ok: true, pushed: false };

    try {
      await client.put(merged, remote?.sha);
      return { ok: true, pushed: true };
    } catch (e) {
      if (!(e instanceof ConflictError)) return { ok: false, error: e.message };
    }
  }
  return { ok: false, error: 'Another device kept writing at the same moment — will retry next time' };
}

export function createSyncScheduler({ run, canRun = () => true, canPoll = () => true, debounceMs = 5000,
  pollMs = 60000, maxPollMs = 600000, clock = Date.now, timers = globalThis }) {
  let timer = null;
  let running = false;
  let again = false;
  let current = null;
  let failures = 0;
  let nextPoll = clock() + pollMs;

  function schedule() {
    if (timer) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => now().catch(() => {}), debounceMs);
  }

  async function now() {
    if (timer) { timers.clearTimeout(timer); timer = null; }
    if (!canRun()) { schedule(); return; }
    if (running) { again = true; return current; }
    running = true;
    let finish;
    current = new Promise((resolve) => { finish = resolve; });
    try {
      const result = await run();
      failures = result?.ok === false ? failures + 1 : 0;
      return result;
    } catch (e) {
      failures++;
      throw e;
    } finally {
      nextPoll = clock() + Math.min(maxPollMs, pollMs * 2 ** Math.min(failures, 10));
      running = false;
      finish();
      current = null;
      if (again) { again = false; now().catch(() => {}); }
    }
  }

  function flush() {
    if (!timer) return;
    return now();
  }

  function poll() {
    if (!running && clock() >= nextPoll && canPoll() && canRun()) return now();
    return Promise.resolve();
  }

  return { now, changed: schedule, flush, poll };
}

export function mergeStoredEvents(previous, incoming) {
  try {
    const next = JSON.parse(incoming);
    if (!isDoc(next)) return previous;
    const prev = previous ? JSON.parse(previous) : null;
    return JSON.stringify(mergeDocs(isDoc(prev) ? prev : null, next));
  } catch { return previous; }
}
