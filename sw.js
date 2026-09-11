// Offline shell: the app's own files come from the cache and are refreshed in the background,
// so an update shows on the second load. Cross-origin requests (GitHub) are never touched.

const CACHE = 'dash-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/data.js', 'js/doc.js', 'js/dates.js', 'js/parse.js', 'js/schedule.js',
  'js/merge.js', 'js/sync.js',
  'js/ui/dom.js', 'js/ui/today.js', 'js/ui/side.js', 'js/ui/edit.js', 'js/ui/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const fresh = fetch(req).then(async (res) => {
    if (res.ok) await (await caches.open(CACHE)).put(req, res.clone());
    return res;
  });
  e.waitUntil(fresh.catch(() => {}));
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((cached) => cached ?? fresh));
});
