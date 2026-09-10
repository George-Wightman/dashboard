# Task 14: Install, offline, README

Part of [the core hub plan](../2026-09-10-core-hub.md) — read its Global Constraints first.

**Files:**
- Create: `manifest.webmanifest`, `sw.js`, `icons/icon.svg`, `dev/make-icons.mjs`,
  `icons/icon-192.png`, `icons/icon-512.png` (generated), `README.md`
- Modify: `js/app.js` (register the service worker)

**Interfaces:**
- Consumes: every file the app serves (listed in `sw.js`).
- Produces:
  - An installable app: the manifest plus 192px and 512px PNG icons (Chrome's installability
    criteria) and an SVG icon for the tab.
  - `sw.js`: a stale-while-revalidate cache of the app's own files. Offline, the app opens from
    cache. Online, files are refreshed in the background, so a code update shows on the *second*
    load. Cross-origin requests (GitHub's API) are never touched.
  - `README.md`: what it is, running and testing locally, **George's morning steps** (publish,
    sync repo, access key, install, start on sign-in, phone), backups, layout, and the roadmap.

- [ ] **Step 1: `icons/icon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#2f6f5e"/>
  <path d="M28 52 L44 68 L74 36" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

- [ ] **Step 2: `dev/make-icons.mjs`** — draws the same tick into PNGs, using nothing but Node's built-ins

```js
// Generates icons/icon-192.png and icons/icon-512.png: a full-bleed accent square with a white
// tick, safe as a maskable icon. Run: node dev/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const ACCENT = [47, 111, 94];
const TICK = [[0.28, 0.52], [0.44, 0.68], [0.74, 0.36]];
const STROKE = 0.09;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pixel(x, y, size) {
  const u = x / size;
  const v = y / size;
  const d = Math.min(distToSegment(u, v, TICK[0], TICK[1]), distToSegment(u, v, TICK[1], TICK[2]));
  const coverage = Math.max(0, Math.min(1, (STROKE / 2 - d) * size + 0.5));
  return [...ACCENT.map((c) => Math.round(c + (255 - c) * coverage)), 255];
}

function png(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * stride + 1 + x * 4;
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), png(size));
  console.log(`icons/icon-${size}.png`);
}
```

Run: `node dev/make-icons.mjs`
Expected output: `icons/icon-192.png` and `icons/icon-512.png`. Open one with the Read tool to
confirm it's a green square with a white tick.

- [ ] **Step 3: `manifest.webmanifest`**

```json
{
  "name": "Today",
  "short_name": "Today",
  "description": "What have I got today — tasks, habits, weekly targets and goals.",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#f7f7f5",
  "theme_color": "#f7f7f5",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" },
    { "src": "icons/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" }
  ]
}
```

- [ ] **Step 4: `sw.js`**

```js
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
```

- [ ] **Step 5: Register it — append to the end of `js/app.js`**

```js
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
```

- [ ] **Step 6: `README.md`**

````markdown
# Today — a personal dashboard

Open the laptop, it's already on screen: what have I got today, tick things off as I go.
One screen: today's list (tasks, habits, weekly targets), this week's bars, goals, and the last
three weeks. Works offline and syncs between the laptop and the phone through a private GitHub
repo.

Piece 1 of 6. The design is in [`docs/superpowers/specs/`](docs/superpowers/specs/), and the
build plan is in [`docs/superpowers/plans/`](docs/superpowers/plans/).

## Using it

- **Add a task:** type in the box under the list and press Enter. Pick *Tomorrow* or a date if
  it isn't for today.
- **Habits, weekly targets and goals:** *New habit, quota or goal…* under the list, or *+ goal*
  in the Goals panel. Click any row's title to edit it. Archive instead of deleting — history is kept.
- **Weekly targets:** **+** adds 1 (shift-click to type an amount). For time targets, **+** asks
  for an amount: `45m`, `1.5h`, `1h30`. Click the count to see or remove this week's entries.
- **Unfinished tasks carry over** with an orange *from Tue* marker until they're done.
- **The day starts at 4am**, so a late night still counts as the day before (change it in ⚙).
- **Suggestions** from Claude or Gemini show dimmed at the top: ✓ to take one on, ✕ to dismiss it.

## Morning steps (one-off setup, about 10 minutes)

1. **Publish the app.** On GitHub, create a **public** repo called `dashboard` (no README).
   Then, in this folder:
   ```
   git remote add origin https://github.com/George-Wightman/dashboard.git
   git push -u origin main
   ```
   In the repo: *Settings → Pages → Deploy from a branch → `main` / `(root)` → Save*. After a
   minute it's live at **https://george-wightman.github.io/dashboard/**.
2. **Create the sync store.** Create a **private** repo called `dashboard-sync`. Tick "Add a
   README" so it isn't empty.
3. **Make an access key.** *GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token.* Repository access: *Only select repositories →
   `dashboard-sync`*. Permissions: *Contents → Read and write*. Copy the token.
4. **Connect the laptop.** Open the site, then ⚙ → Sync repo `George-Wightman/dashboard-sync`,
   and paste the key → Save. The header should change to *synced HH:MM*.
5. **Install it and start it on sign-in.** In Chrome, use the install icon at the right of the
   address bar (or ⋮ → *Cast, save and share → Install page as app*). Then press Win+R and type
   `shell:startup`. In the Start menu, right-click *Today* → *Open file location*, and copy that
   shortcut into the Startup folder.
6. **Phone.** Open the same address in Chrome → ⋮ → *Add to home screen*. Enter the same repo and
   key in ⚙.

Anything typed into a local test copy (`localhost`) doesn't carry over to the published site on
its own. Use ⚙ → *Export backup* there and *Import backup…* on the site.

## Running it locally

```
python -m http.server 8080
```

Then open http://localhost:8080/. For sample data, open http://localhost:8080/dev/seed.html?replace
(this only works on localhost).

After changing code, reload **twice** — the offline cache serves the old copy once while it
fetches the new one.

## Tests

```
npm test
```

Node 24's built-in test runner. There are no dependencies to install. Every pure module (dates,
parsing, scheduling, streaks, history, merge) and the sync flow is covered, including two
simulated devices converging.

## How it's built

Plain HTML, CSS and JavaScript modules. No build step, no framework, no dependencies.

| File | Job |
|---|---|
| `js/dates.js` | Day arithmetic, the 4am boundary, labels |
| `js/parse.js` | `45m` / `1.5h` parsing and display |
| `js/doc.js`, `js/data.js` | The document and the store (`localStorage`) |
| `js/schedule.js` | What's on a day, carry-over, streaks, weekly totals, history, goal progress |
| `js/merge.js` | Merging two copies — commutative, idempotent, never loses anything |
| `js/sync.js` | GitHub read/merge/write with retry, and the sync timer |
| `js/ui/*.js`, `js/app.js` | The screen |
| `sw.js`, `manifest.webmanifest` | Offline and install |

Data lives in one JSON document: `items`, `goals`, `milestones`, `logs`. Nothing is ever
hard-deleted. Records are archived or tombstoned, so a sync can't bring back something removed on
another device. Settings (repo, key, day start) stay on each device and are never synced.

## Roadmap

1. **Core hub** — this
2. Hebrew auto-tick — practice minutes from the Hebrew app's sync file
3. Claude connector + skill — Claude can see the dashboard and add to it from any chat
4. Job search + Notion — application counts and deadlines from the Job Tracker
5. Gemini coach — goal shaping, evening check-in, weekly digest
6. Google Calendar — today's events beside the list
````

- [ ] **Step 7: Run the unit tests**

Run: `npm test`
Expected: PASS — all suites.

- [ ] **Step 8: Check it in the browser**

Reload `http://localhost:8080/` twice. Then check:
- `navigator.serviceWorker.controller` is non-null (`javascript_tool`).
- `caches.keys()` includes `dash-v1`.
- No console errors, and the page still renders fully.

- [ ] **Step 9: Commit**

```bash
git add manifest.webmanifest sw.js icons/ dev/make-icons.mjs js/app.js README.md
git commit -m "Make it installable and offline; add README with setup steps"
```

(End the commit message with the co-author line from the Global Constraints.)
