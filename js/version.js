// Which build is this device running, and is there a newer one? Worked out from two facts that
// can't drift, the way the Hebrew app does it, so there's no version number to remember to bump:
//  - what this page is RUNNING: the Last-Modified of the copy it was served. document.lastModified
//    reads that header off whatever the service worker handed over, so it's the running copy, not
//    whatever has since landed in the cache.
//  - what is LIVE: the Last-Modified of the published page, asked with a HEAD request. The service
//    worker only handles GETs, so this always goes to the site.
// GitHub Pages restamps every file on every deploy, so live later than running means a newer
// version is out. GitHub's commit list only adds what changed, and whether a push is still being
// published.

import { shortDate } from './dates.js';

export const REPO = 'George-Wightman/dashboard';
export const HISTORY_URL = `https://github.com/${REPO}/commits/main`;
// Automatic checks (on focus, and once a minute while open) go out at most this often.
export const CHECK_GAP = 60 * 1000;
export const IDLE_CHECK_GAP = 10 * 60 * 1000;

const date = (value) => {
  const t = Date.parse(value ?? '');
  return Number.isNaN(t) ? null : new Date(t);
};

// The build this page is running. With no Last-Modified header the browser reports the moment
// the page loaded instead, which would read as "brand new", so that counts as unknown.
export function runningBuild(lastModified, loadedAt) {
  const d = date(lastModified);
  return d && Math.abs(d.getTime() - loadedAt) > 10 * 1000 ? d : null;
}

export const lastModifiedOf = (header) => date(header);

// '13 Sep, 08:08', in local time.
export function buildStamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${shortDate(day)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// A commit's first line only: the rest is a note for whoever maintains this, not a release note.
export const commitSubject = (message) => String(message ?? '').split('\n')[0].trim();

// GitHub's commit list, newest first, as { date, title }. The committer date, not the author's,
// so a commit that was rebased counts from when it was actually put on the branch.
export function parseCommits(list) {
  if (!Array.isArray(list)) throw new Error('unexpected reply');
  return list.map((c) => ({ date: new Date(c.commit.committer.date), title: commitSubject(c.commit.message) }));
}

export async function recentChanges({ fetch = globalThis.fetch, count = 5 } = {}) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits?per_page=${count}`,
      { headers: { Accept: 'application/vnd.github+json' }, signal: abort.signal });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    return parseCommits(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

// The line ⚙ shows. `live` is null when the site couldn't be reached; `newest` (the newest
// commit's date) is null when GitHub couldn't be. "Can't tell" is never reported as "behind".
export function versionStatus({ running, live, newest = null, online = true }) {
  if (!running) return { kind: 'unknown', text: "Can't tell which build this is: this copy came without a date." };
  if (!live) {
    return {
      kind: 'unknown',
      text: `Running the ${buildStamp(running)} build. ${online ? "Couldn't reach the site to check for a newer one." : "Offline, so can't check for a newer one."}`,
    };
  }
  if (live > running) {
    return { kind: 'update', text: `Update ready: this device has the ${buildStamp(running)} build, and the newest is ${buildStamp(live)}.` };
  }
  const text = `Up to date: running the ${buildStamp(running)} build, the newest published.`;
  // Pages publishes a minute or so after a push; until then the site still has the old build.
  if (newest && newest > live) {
    return { kind: 'publishing', text: `${text} A change from ${buildStamp(newest)} is still being published. Check again in a minute.` };
  }
  return { kind: 'current', text };
}

// The page's side of updates: ask the site for its build and, when it's newer, have the service
// worker bring the whole new version into the offline cache before saying so. A reload then opens
// all of the new version, never a mix of old and new files. Nothing reloads on its own: onReady
// shows the offer, and apply() takes it.
export function createUpdater({ running, fetch = globalThis.fetch, worker = null, now = Date.now, onReady = () => {} }) {
  let live = null;
  // The live build the service worker has cached, once it has. A later deploy that lands before
  // the reload is cached again, so the reload always opens the newest.
  let cached = null;
  let checkedAt = -Infinity;
  let pending = null;
  const behind = () => !!(running && live && live > running && !(cached && cached >= live));

  // Ask the service worker to cache the new version (sw.js's 'refresh'). With no worker in
  // charge, nothing is cached, so a reload fetches the new version anyway.
  function refresh() {
    const sw = worker?.controller;
    if (!sw) return Promise.resolve(true);
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const done = (ok) => { clearTimeout(timer); channel.port1.close(); resolve(ok); };
      const timer = setTimeout(() => done(false), 30 * 1000);
      channel.port1.onmessage = (e) => done(e.data?.ok === true);
      sw.postMessage({ type: 'refresh' }, [channel.port2]);
    });
  }

  async function run() {
    try {
      const res = await fetch('./', { method: 'HEAD', cache: 'no-store' });
      live = res.ok ? lastModifiedOf(res.headers.get('last-modified')) : null;
    } catch {
      live = null;
    }
    if (behind()) {
      const build = live;
      if (await refresh()) {
        cached = build;
        onReady();
      }
    }
    return state();
  }

  function state() {
    return { running, live, ready: cached !== null };
  }

  return {
    state,
    // Checks at most once per `gap`; { gap: 0 } always checks. Overlapping calls share one check.
    check({ gap = CHECK_GAP } = {}) {
      if (pending) return pending;
      if (now() - checkedAt < gap) return Promise.resolve(state());
      checkedAt = now();
      pending = run().finally(() => { pending = null; });
      return pending;
    },
    // Reload into the new version, making sure the newest seen is cached first.
    async apply(reload) {
      if (cached === null || behind()) await refresh();
      reload();
    },
  };
}
