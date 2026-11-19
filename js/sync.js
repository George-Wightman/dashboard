// Sync with one JSON file in a private GitHub repo: GET → merge → apply locally → PUT with the
// sha. A 409 means another device wrote in between, so go round again. Never throws, never
// blocks: every failure comes back as { ok: false, error } for the header to show.

import { mergeDocs, sameDoc } from './merge.js';
import { isDoc } from './doc.js';

export class ConflictError extends Error {}

const API = 'https://api.github.com';

// In Apps Script, planner/shims.js puts a one-call UTF-8 base64 on globalThis (checked against a known
// answer before it's trusted); everywhere else these work byte by byte.
export function encodeBase64(text) {
  if (typeof globalThis.__utf8ToBase64 === 'function') return globalThis.__utf8ToBase64(text);
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function decodeBase64(b64) {
  if (typeof globalThis.__utf8FromBase64 === 'function') return globalThis.__utf8FromBase64(b64.replace(/\s/g, ''));
  const binary = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

// A 401/403 is usually the key, but a sandbox's egress proxy can answer 403 for a private repo it
// hasn't been told to allow, and blaming the key then sends everyone off to replace a working one.
// GitHub's (or the proxy's) own words always go on the end: on 25 Sep a cloud routine's write was
// refused by Anthropic's GitHub gateway, and without them it read as a bad key.
export function accessError(repo, message = '', status = null) {
  if (/for this session|add_repo/i.test(message)) {
    return new Error(`The network this chat runs in is blocking ${repo} — the key was never checked. It said: ${message}`);
  }
  const said = message || status ? ` It said${status ? ` (HTTP ${status})` : ''}: ${message || 'nothing more'}` : '';
  return new Error(`GitHub refused the access key — check it hasn't expired and has Contents read and write on ${repo}.${said}`);
}

// GitHub's JSON for a blob, rather than the blob itself: what the relay (planner/relay.js, which always
// asks for JSON) or anything else that drops the Accept header hands back. A dashboard document never
// has these fields at its top level.
const isBlobJson = (v) => !!v && typeof v === 'object' && typeof v.content === 'string' && v.encoding === 'base64';

// `ref` reads a branch instead of the default one (the planner reading what a Claude routine left on
// its claude/ branch); writes always go to the default branch.
export function createGitHubClient({ token, repo, path = 'data.json', ref = null, fetch = (...args) => globalThis.fetch(...args), timeoutMs = 20000, timers = globalThis }) {
  const url = `${API}/repos/${repo}/contents/${path}`;
  const readUrl = ref ? `${url}?ref=${encodeURIComponent(ref)}` : url;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  // The last blob this client read, as text. A sha names exactly one content, so a file over 1 MB whose
  // sha hasn't moved since is not downloaded again: on 19 Nov 2026 data.json was 1.7 MB, read on every
  // sync (about a minute apart while the app is open) and twice in every planner run.
  let blob = null;

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
      let message = '';
      try { message = (await res.json())?.message ?? ''; } catch { /* no body */ }
      return accessError(repo, message, res.status);
    }
    if (res.status === 404 && where === 'put') {
      return new Error(`GitHub can't see ${repo} with this key — check the repo name, and that the key was given access to that repo`);
    }
    return failure(res);
  }

  return {
    get: () => bounded(async (signal) => {
      const res = await fetch(readUrl, { headers, cache: 'no-store', ...(signal ? { signal } : {}) });
      if (res.status === 404) return null;
      if (!res.ok) throw await explain(res, repo, 'get');
      const body = await res.json();
      // Over 1 MB, the Contents API omits `content` and the file must be read as a blob instead: asked
      // for raw, so there's no base64 to undo (2.3 MB of it, which in Apps Script goes byte by byte
      // through Utilities), and not at all when it's the blob this client already has.
      if (!body.content || body.encoding === 'none') {
        if (blob?.sha === body.sha) return { doc: JSON.parse(blob.text), sha: body.sha };
        const blobRes = await fetch(`${API}/repos/${repo}/git/blobs/${body.sha}`, {
          headers: { ...headers, Accept: 'application/vnd.github.raw+json' }, cache: 'no-store', ...(signal ? { signal } : {}),
        });
        if (!blobRes.ok) throw await explain(blobRes, repo, 'get');
        let text = await blobRes.text();
        let doc = JSON.parse(text);
        if (isBlobJson(doc)) { text = decodeBase64(doc.content); doc = JSON.parse(text); }
        blob = { sha: body.sha, text };
        return { doc, sha: body.sha };
      }
      return { doc: JSON.parse(decodeBase64(body.content)), sha: body.sha };
    }),

    put: (doc, sha) => bounded(async (signal) => {
      const text = JSON.stringify(doc);
      const res = await fetch(url, {
        method: 'PUT',
        ...(signal ? { signal } : {}),
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'sync', content: encodeBase64(text), ...(sha ? { sha } : {}) }),
      });
      if (res.status === 409) throw new ConflictError(`GitHub 409`);
      if (res.status === 422) {
        const err = await failure(res);
        if (/sha/i.test(err.message)) throw new ConflictError(err.message);
        throw err;
      }
      if (!res.ok) throw await explain(res, repo, 'put');
      const written = (await res.json()).content.sha;
      // What was just written is the blob under its new sha, so the next read needn't fetch it back.
      if (written) blob = { sha: written, text };
      return written;
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
