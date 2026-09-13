// Offline shell: the app's own files come from the cache and are refreshed in the background.
// Cross-origin requests (GitHub) are never touched. The page checks the site for a newer build
// itself (js/version.js) and asks for 'refresh' below, so an update is offered on the first load
// after it's published, not the second.

// Bump CACHE whenever SHELL changes, so activate drops the old cache. dev/fake-gemini.js is left
// out on purpose: it is only for local testing. CACHE doubles as the app version a flag records
// (js/flags.js's APP_VERSION; tests/sw.test.js checks the two match).
const CACHE = 'dash-v5';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/data.js', 'js/doc.js', 'js/dates.js', 'js/parse.js', 'js/schedule.js',
  'js/merge.js', 'js/sync.js', 'js/gemini.js', 'js/coach.js', 'js/look.js', 'js/layout.js', 'js/flags.js', 'js/changes.js',
  'js/version.js', 'js/ui/dom.js', 'js/ui/today.js', 'js/ui/side.js', 'js/ui/edit.js', 'js/ui/settings.js', 'js/ui/coach.js',
  'js/ui/widgets.js', 'js/ui/flags.js',
];

// Bypass the HTTP cache: GitHub Pages sends max-age=600 and the local server allows heuristic
// caching, so a plain addAll(SHELL) could cache stale files right after a push. addAll is all or
// nothing, so a failed download never leaves a mix of old and new files.
const cacheShell = () => caches.open(CACHE)
  .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))));

self.addEventListener('install', (e) => {
  e.waitUntil(cacheShell().then(() => self.skipWaiting()));
});

// The page has seen a newer build on the site (js/version.js): bring all of it down before the
// page offers a reload, and say whether that worked.
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'refresh') return;
  const reply = (ok) => e.ports[0]?.postMessage({ ok });
  e.waitUntil(cacheShell().then(() => reply(true), () => reply(false)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Cached under the path alone. A query (?fakegemini) only changes behaviour inside the same
  // page; a second copy kept under it goes stale, and matching with ignoreSearch served that
  // copy ahead of a refreshed one, so "Reload to update" reopened the old version.
  const key = url.origin + url.pathname;
  // Revalidate with the server rather than reading the HTTP cache (a navigation Request can't be
  // re-used with an init object, so fetch by URL).
  const fresh = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(async (res) => {
    if (res.ok) await (await caches.open(CACHE)).put(key, res.clone());
    return res;
  });
  e.waitUntil(fresh.catch(() => {}));
  e.respondWith(caches.match(key).then((cached) => cached ?? fresh));
});
