// Complete, integrity-checked releases. Open pages stay pinned to their release;
// a refresh selects the new release for the next navigation, never per-file.
const CACHE = 'today-dashboard-v12';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/data.js', 'js/doc.js', 'js/dates.js', 'js/parse.js', 'js/schedule.js',
  'js/record.js', 'js/merge.js', 'js/sync.js', 'js/hebrewSync.js', 'js/gemini.js', 'js/coach.js', 'js/look.js', 'js/layout.js', 'js/flags.js', 'js/changes.js', 'js/calendar.js', 'js/attention.js', 'js/gym.js', 'js/talk.js', 'js/coach-tools.js',
  'js/plan-state.js', 'js/coach-session.js', 'js/ui/agenda.js',
  'js/workflow.js', 'js/goal-review.js', 'js/ui/outcome.js',
  'js/version.js', 'js/ui/dom.js', 'js/ui/today.js', 'js/ui/side.js', 'js/ui/edit.js', 'js/ui/settings.js', 'js/ui/coach.js',
  'js/ui/widgets.js', 'js/ui/flags.js', 'js/ui/changes.js', 'js/ui/claude.js', 'js/ui/sources.js', 'js/ui/gym.js',
  'js/ui/training.js',
];

const META = 'today-dashboard-meta';
const scope = self.registration.scope;
const absolute = (path) => new URL(path, scope).href;
const metaKey = (name) => absolute('__cache/' + encodeURIComponent(name));
const shellKeys = new Set(SHELL.map(absolute));
const owned = (name) => /^today-dashboard-v\d+-[a-f0-9]{64}$/.test(name) || /^dash-v[1-9]$/.test(name);
const digest = async (data) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (b) => b.toString(16).padStart(2, '0')).join('');
let refreshing = null;

async function readMeta(name) {
  const value = await (await caches.open(META)).match(metaKey(name));
  return value ? value.text() : null;
}
async function writeMeta(name, value) {
  await (await caches.open(META)).put(metaKey(name), new Response(value));
}
async function activeCache() {
  return await readMeta('active') || ((await caches.keys()).includes('dash-v9') ? 'dash-v9' : null);
}

async function publish(name) {
  const previous = await activeCache();
  // Persist pins before publishing. They survive the worker being suspended.
  for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
    if (client.url.startsWith(scope) && !await readMeta('client:' + client.id)) {
      await writeMeta('client:' + client.id, previous || name);
    }
  }
  if (previous && previous !== name) await writeMeta('previous', previous);
  await writeMeta('active', name);
}

async function cleanup() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const keep = new Set([await activeCache(), await readMeta('previous')]);
  for (const client of clients) keep.add(await readMeta('client:' + client.id));
  for (const key of await caches.keys()) if (owned(key) && !keep.has(key)) await caches.delete(key);
  const live = new Set(clients.map((c) => metaKey('client:' + c.id)));
  const meta = await caches.open(META);
  for (const request of await meta.keys()) {
    if (decodeURIComponent(new URL(request.url).pathname).includes('/__cache/client:') && !live.has(request.url)) await meta.delete(request);
  }
}

async function download() {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 25000);
  try {
    const manifestResponse = await fetch(absolute('release.json'), { cache: 'no-store', signal: abort.signal });
    if (!manifestResponse.ok) throw new Error('Release manifest unavailable');
    const manifest = await manifestResponse.json();
    if (!/^[a-f0-9]{64}$/.test(manifest.id) || !manifest.files || Object.keys(manifest.files).length !== SHELL.length
      || !SHELL.every((path) => /^[a-f0-9]{64}$/.test(manifest.files[path]))) throw new Error('Invalid release manifest');
    const name = CACHE + '-' + manifest.id;
    // All responses must match this manifest. A deployment changing halfway through
    // download fails safely, leaving the prior release active.
    const responses = await Promise.all(SHELL.map(async (path) => {
      const response = await fetch(absolute(path), { cache: 'reload', signal: abort.signal });
      if (!response.ok || await digest(await response.clone().arrayBuffer()) !== manifest.files[path]) throw new Error('Incomplete release: ' + path);
      return [absolute(path), response];
    }));
    const cache = await caches.open(name);
    await Promise.all(responses.map(([url, response]) => cache.put(url, response)));
    await publish(name);
    // Publication succeeded. Cleanup is best effort and must not hide the update.
    await cleanup().catch(() => {});
  } finally { clearTimeout(timer); }
}

function refresh() {
  if (!refreshing) refreshing = download().finally(() => { refreshing = null; });
  return refreshing;
}

self.addEventListener('install', (e) => {
  e.waitUntil(refresh().then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(cleanup().then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'refresh') return;
  e.waitUntil(refresh().then(() => e.ports[0]?.postMessage({ ok: true }), () => e.ports[0]?.postMessage({ ok: false })));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  const key = url.origin + url.pathname;
  if (req.method !== 'GET' || !shellKeys.has(key)) return;
  const response = (async () => {
    const navigation = req.mode === 'navigate';
    const name = navigation ? await activeCache() : (e.clientId && await readMeta('client:' + e.clientId)) || await activeCache();
    if (!name) return fetch(req); // no installed release yet
    if (navigation && e.resultingClientId) await writeMeta('client:' + e.resultingClientId, name);
    else if (e.clientId && !await readMeta('client:' + e.clientId)) await writeMeta('client:' + e.clientId, name);
    const cached = await (await caches.open(name)).match(key);
    // Never fill a missing file from an unrelated live release.
    return cached || new Response('This offline copy is incomplete. Reconnect and update the app.', { status: 503 });
  })();
  e.respondWith(response);
  e.waitUntil(response.then(() => {}, () => {}));
});
