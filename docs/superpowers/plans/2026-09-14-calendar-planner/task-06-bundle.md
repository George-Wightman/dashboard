# Task 6: The bundle and the loader

**Files:**
- Create: `planner/entry.js`, `planner/bundle.mjs`, `planner/build.mjs`, `planner/planner.js` (built),
  `planner/apps-script/Code.gs`, `planner/apps-script/appsscript.json`
- Modify: `package.json`
- Test: `tests/planner-bundle.test.js`

**Interfaces:**
- Consumes: `installShims`, `createPlanner` (Task 5); `FakeCalendar`, `ev`, `MAIN` (Task 4); `FakeRepo`,
  `appsScript` (Task 5); `fixture` (`tests/helpers.js`); `logicalDay`, `addDays` (`js/dates.js`).
- Produces: `bundle({ entry, read })` → `{ code, build }`; the committed `planner/planner.js` defining
  `PLANNER_BUILD` and `Planner`; the loader George pastes.

- [ ] **Step 1: Write the failing tests** — create `tests/planner-bundle.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { bundle } from '../planner/bundle.mjs';
import { logicalDay, addDays } from '../js/dates.js';
import { fixture } from './helpers.js';
import { FakeCalendar } from './planner-fakes.js';
import { FakeRepo, appsScript } from './planner-apps.js';

process.env.TZ = 'Europe/London';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const lf = (text) => text.replace(/\r\n/g, '\n');

test('planner/planner.js is the bundle of the current sources', () => {
  assert.equal(lf(read('planner/planner.js')), bundle({ read }).code, 'run npm run build-planner');
});

test('the bundle runs with none of the browser globals, as in Apps Script', async () => {
  const { code, build } = bundle({ read });
  const today = logicalDay(new Date());
  const repo = new FakeRepo(fixture({ items: [
    { id: 'a', type: 'task', title: 'Draft the cover letter', area: 'Job search', date: today, order: 1 },
    { id: 'b', type: 'task', title: 'Send it', area: 'Job search', date: addDays(today, 1), order: 2 },
  ] }));
  const cal = new FakeCalendar();
  const env = appsScript({ cal, repo, props: { GITHUB_TOKEN: 'ghp_dummy', SYNC_REPO: 'o/r' } });
  const sandbox = { Calendar: env.Calendar, UrlFetchApp: env.UrlFetchApp, Utilities: env.Utilities, PropertiesService: env.PropertiesService, LockService: env.LockService, ScriptApp: env.ScriptApp, Logger: env.Logger };
  const context = vm.createContext(sandbox);
  for (const name of ['fetch', 'TextEncoder', 'structuredClone', 'crypto', 'btoa']) {
    assert.equal(vm.runInContext(`typeof ${name}`, context), 'undefined', `${name} is missing, as in Apps Script`);
  }
  new vm.Script(code).runInContext(context);
  assert.equal(context.PLANNER_BUILD, build);
  assert.deepEqual(Object.keys(context.Planner), ['run', 'install', 'pause', 'resume', 'removeAll']);
  assert.equal(await context.Planner.run(), 'ok');
  assert.ok(cal.mine().length >= 1);
  assert.equal(repo.doc().calendar.status.version, build);
});

test('bundle: named imports (also "as" and across lines), and nothing else', () => {
  const files = {
    'p/entry.js': "import {\n  twice as double,\n} from './lib.js';\nexport const Planner = { run: () => double(2) };\n",
    'p/lib.js': "const pad = 1;\nexport function twice(n) { return n * 2 + pad - 1; }\n",
  };
  const { code } = bundle({ entry: 'p/entry.js', read: (p) => files[p] });
  const context = vm.createContext({});
  new vm.Script(code).runInContext(context);
  assert.equal(context.Planner.run(), 4);
  assert.throws(() => bundle({ entry: 'x.js', read: () => 'export default 1;\n' }), /only "export function\|const\|let\|class"/);
  assert.throws(() => bundle({ entry: 'x.js', read: () => "import fs from 'node:fs';\n" }), /only named imports/);
  assert.throws(() => bundle({ entry: 'x.js', read: () => "import { a } from 'node:fs';\n" }), /can't bundle "node:fs"/);
});

test('the loader and its manifest', () => {
  const gs = read('planner/apps-script/Code.gs');
  assert.match(gs, /var PLANNER_URL = 'https:\/\/george-wightman\.github\.io\/dashboard\/planner\/planner\.js';/);
  for (const fn of ['run(e)', 'install()', 'pause()', 'resume()', 'removeAll()']) assert.ok(gs.includes(`function ${fn}`), fn);
  assert.match(gs, /new Function\(res\.getContentText\(\) \+ '\\nreturn Planner;'\)/);
  const manifest = JSON.parse(read('planner/apps-script/appsscript.json'));
  assert.equal(manifest.timeZone, 'Europe/London');
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.deepEqual(manifest.dependencies.enabledAdvancedServices, [{ userSymbol: 'Calendar', serviceId: 'calendar', version: 'v3' }]);
  assert.deepEqual(manifest.oauthScopes, [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/script.scriptapp',
  ]);
  assert.equal(JSON.parse(read('package.json')).scripts['build-planner'], 'node planner/build.mjs');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/planner-bundle.test.js`
Expected: FAIL — `Cannot find module '.../planner/bundle.mjs'`.

- [ ] **Step 3: Create `planner/entry.js`**

```js
// The bundle's entry (npm run build-planner): Apps Script's services in, `Planner` out. Only ever
// run inside Apps Script, or the bundle test's sandbox, where these globals exist.

import { installShims } from './shims.js';
import { createPlanner } from './gas.js';

export const Planner = (() => {
  installShims(globalThis, { Utilities, UrlFetchApp });
  return createPlanner({
    Calendar, UrlFetchApp, PropertiesService, LockService, ScriptApp, Logger,
    fetch: (...args) => globalThis.fetch(...args),
    version: typeof PLANNER_BUILD === 'string' ? PLANNER_BUILD : 'dev',
  });
})();
```

- [ ] **Step 4: Create `planner/bundle.mjs`**

```js
// Builds planner/planner.js: planner/entry.js and every module it imports (from planner/ and js/),
// each wrapped in a function of its own so their top-level names can't collide, in one plain
// script that defines PLANNER_BUILD and Planner — Apps Script has no modules. Only the shapes the
// planner's modules use are allowed, and anything else fails the build rather than the calendar.

import { createHash } from 'node:crypto';
import { posix } from 'node:path';

const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?[ \t]*$/gm;
const EXPORT = /^export\s+(async\s+function|function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;

const varName = (path) => `__${path.replace(/\.m?js$/, '').replace(/\W/g, '_')}`;

export function bundle({ entry = 'planner/entry.js', read }) {
  const order = [];
  const seen = new Set();

  function visit(path) {
    if (seen.has(path)) return;
    seen.add(path);
    const src = read(path).replace(/\r\n/g, '\n');
    if (/^export\s+(default|\{|\*)/m.test(src)) throw new Error(`${path}: only "export function|const|let|class" can be bundled`);
    if (/^import\s+[\w$*]/m.test(src) || /\bimport\s*\(/.test(src)) throw new Error(`${path}: only named imports can be bundled`);
    const deps = [];
    const body = src.replace(IMPORT, (_, names, from) => {
      if (!from.startsWith('.')) throw new Error(`${path}: can't bundle "${from}"`);
      const dep = posix.normalize(posix.join(posix.dirname(path), from));
      deps.push(dep);
      const list = names.split(',').map((n) => n.trim()).filter(Boolean).map((n) => n.replace(/\s+as\s+/, ': '));
      return `const { ${list.join(', ')} } = ${varName(dep)};`;
    });
    for (const dep of deps) visit(dep);
    const names = [...body.matchAll(EXPORT)].map((m) => m[2]);
    order.push({ path, names, code: body.replace(EXPORT, (_, kind, name) => `${kind} ${name}`).trimEnd() });
  }

  visit(entry);
  const modules = order.map(({ path, names, code }) =>
    `// ---- ${path}\nconst ${varName(path)} = (() => {\n${code}\nreturn { ${names.join(', ')} };\n})();`);
  const body = `${modules.join('\n\n')}\n\nvar Planner = ${varName(entry)}.Planner;\n`;
  const build = createHash('sha1').update(body).digest('hex').slice(0, 8);
  const code = [
    "// Dashboard calendar planner — built by `npm run build-planner` from planner/ and js/. Don't edit by hand.",
    `var PLANNER_BUILD = '${build}';`,
    '',
    body,
  ].join('\n');
  return { code, build };
}
```

- [ ] **Step 5: Create `planner/build.mjs`**

```js
// npm run build-planner: writes planner/planner.js, which GitHub Pages serves to George's Apps
// Script loader. Commit the result — tests/planner-bundle.test.js fails when it's out of date.

import { readFileSync, writeFileSync } from 'node:fs';
import { bundle } from './bundle.mjs';

const root = new URL('../', import.meta.url);
const { code, build } = bundle({ read: (path) => readFileSync(new URL(path, root), 'utf8') });
writeFileSync(new URL('planner/planner.js', root), code);
console.log(`planner/planner.js built — ${build}, ${Math.round(code.length / 1024)} KB`);
```

- [ ] **Step 6: Create `planner/apps-script/Code.gs`**

```js
// Dashboard planner — plans your dashboard into your Google Calendar. This file only loads the
// planner from your dashboard's site each time it runs, so updates arrive by themselves.
// Once: set the script properties (GITHUB_TOKEN, SYNC_REPO, and GEMINI_KEY if you like), then
// choose install in the toolbar and press Run.

var PLANNER_URL = 'https://george-wightman.github.io/dashboard/planner/planner.js';

function load_() {
  var res = UrlFetchApp.fetch(PLANNER_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error("Couldn't load the planner from " + PLANNER_URL + ' (' + res.getResponseCode() + ')');
  }
  return new Function(res.getContentText() + '\nreturn Planner;')();
}

function say_(promise) {
  return promise.then(function (text) { Logger.log(text); return text; });
}

function run(e) { return load_().run(e); }
function install() { return say_(load_().install()); }
function pause() { return say_(load_().pause()); }
function resume() { return say_(load_().resume()); }
function removeAll() { return say_(load_().removeAll()); }
```

- [ ] **Step 7: Create `planner/apps-script/appsscript.json`**

```json
{
  "timeZone": "Europe/London",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "dependencies": {
    "enabledAdvancedServices": [
      { "userSymbol": "Calendar", "serviceId": "calendar", "version": "v3" }
    ]
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.scriptapp"
  ]
}
```

- [ ] **Step 8: `package.json`** — add the script:

```json
  "scripts": {
    "test": "node --test tests/*.test.js",
    "build-skill": "node claude/build-skill.mjs",
    "build-planner": "node planner/build.mjs"
  }
```

- [ ] **Step 9: Build, then run the tests**

Run: `npm run build-planner` → `planner/planner.js built — <build>, <n> KB`.
Run: `node --test tests/planner-bundle.test.js` → PASS (4 tests). Then `npm test` → PASS.

If `.gitattributes` turns `planner/planner.js` into CRLF on checkout, the first test still passes (it
compares with line endings normalised).

- [ ] **Step 10: Commit**

```bash
git add planner/entry.js planner/bundle.mjs planner/build.mjs planner/planner.js planner/apps-script/Code.gs planner/apps-script/appsscript.json package.json tests/planner-bundle.test.js
git commit -m "Add the planner bundle for Apps Script, the loader George pastes, and npm run build-planner

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
