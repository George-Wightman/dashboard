// Offline shell: the app's own files come from the cache and are refreshed in the background,
// so an update shows on the second load. Cross-origin requests (GitHub) are never touched.

// Bump CACHE whenever SHELL changes, so activate drops the old cache. dev/fake-gemini.js is left
// out on purpose: it is only for local testing. CACHE doubles as the app version a flag records
// (js/flags.js's APP_VERSION; tests/sw.test.js checks the two match).
const CACHE = 'dash-v3';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/data.js', 'js/doc.js', 'js/dates.js', 'js/parse.js', 'js/schedule.js',
  'js/merge.js', 'js/sync.js', 'js/gemini.js', 'js/coach.js', 'js/look.js', 'js/layout.js', 'js/flags.js',
  'js/ui/dom.js', 'js/ui/today.js', 'js/ui/side.js', 'js/ui/edit.js', 'js/ui/settings.js', 'js/ui/coach.js',
  'js/ui/widgets.js', 'js/ui/flags.js',
];

self.addEventListener('install', (e) => {
  // Bypass the HTTP cache: GitHub Pages sends max-age=600 and the local server allows heuristic
  // caching, so a plain addAll(SHELL) could install stale files right after a push.
  e.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Revalidate with the server rather than reading the HTTP cache (a navigation Request can't be
  // re-used with an init object, so fetch by URL; the response is still cached under req below).
  const fresh = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(async (res) => {
    if (res.ok) await (await caches.open(CACHE)).put(req, res.clone());
    return res;
  });
  e.waitUntil(fresh.catch(() => {}));
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((cached) => cached ?? fresh));
});
