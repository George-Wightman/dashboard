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
  // Check-ins ran inside the bundle too: the notification key made, nothing wrong, and no mind.json.
  assert.match(repo.doc().calendar['push-config'].publicKey, /^[\w-]{87}$/);
  assert.equal(repo.doc().calendar['checkins:status'].lastError, null);
  assert.equal(repo.file('mind.json'), null);
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
