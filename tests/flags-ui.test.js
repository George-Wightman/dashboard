import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the ⚑ button sits after sync status and before Arrange, and the dialog is after Settings', () => {
  const html = read('index.html');
  assert.match(html, /<button id="sync-status"[^>]*><\/button>\s*<button id="flag-button" class="icon flag-button" type="button" title="Note something to change" aria-label="Note something to change">⚑<\/button>\s*<button id="arrange-button"/);
  assert.match(html, /<dialog id="settings" class="settings"><\/dialog>\s*<dialog id="flags" class="settings flags" aria-label="Flags"><\/dialog>/);
});

test('styles.css gives the ⚑ its grey/teal states, steady, and styles the panel', () => {
  const css = read('styles.css');
  assert.match(css, /#flag-button\.waiting \{ color: var\(--accent\); \}/);
  assert.doesNotMatch(css, /flag-button[\s\S]{0,120}(animation|@keyframes)/);
  for (const selector of ['.flags .about', '.flags textarea', '.flag-list', '.flag-item', '.flag-sync']) {
    assert.ok(css.includes(selector), selector);
  }
});

test('js/ui/flags.js builds the panel from the plan: About, Save/Ctrl+Enter, the list, and the sync line', () => {
  const src = read('js/ui/flags.js');
  assert.match(src, /export function openFlagPanel\(ctx\)/);
  assert.match(src, /flagContext\(ctx\.flagState\(\)\)/);
  assert.match(src, /flagAbout\(captured\)/);
  assert.match(src, /store\.addFlag\(text, captured\)/);
  assert.match(src, /'Write something first\.'/);
  assert.match(src, /status\.textContent = 'Saved\.'/);
  assert.match(src, /e\.key === 'Enter' && \(e\.ctrlKey \|\| e\.metaKey\)/);
  assert.match(src, /openFlags\(doc\)/);
  assert.match(src, /addressFlag\(f\.id\)/);
  assert.match(src, /'Mark addressed'/);
  assert.match(src, /addressedCount\(doc\)/);
  assert.match(src, /flagSyncLine\(syncOn, waiting\)/);
  assert.match(src, /waitingFlags\(doc, ctx\.lastSynced\(\)\)/);
  assert.match(src, /'Sync now'/);
  assert.match(src, /store\.subscribe\(repaint\)/);
  assert.match(src, /dialog\.addEventListener\('close', \(\) => unsubscribe\(\), \{ once: true \}\)/);
  assert.match(src, /dialog\.showModal\(\)/);
  assert.doesNotMatch(src, /ctx\.render\(\)/);
});

test("js/app.js wires ⚑'s state, the last-synced time, and the flag state ctx.flagState() captures", () => {
  const src = read('js/app.js');
  assert.match(src, /import \{ askGemini, geminiKeys, hebrewKeys \} from '\.\/gemini\.js';/);
  assert.match(src, /import \{ readLastSynced, writeLastSynced, waitingFlags, APP_VERSION \} from '\.\/flags\.js';/);
  assert.match(src, /import \{ openFlagPanel \} from '\.\/ui\/flags\.js';/);
  assert.match(src, /syncOn: \(\) => !FAKE && !!store\.settings\(\)\.token && !!store\.settings\(\)\.repo,/);
  assert.match(src, /lastSynced: \(\) => readLastSynced\(localStorage\),/);
  assert.match(src, /flagState: \(\) => \(\{/);
  assert.match(src, /hebrewKey: hebrewKeys\(localStorage\)\.length > 0,/);
  assert.match(src, /version: APP_VERSION,/);
  assert.match(src, /const started = new Date\(\)\.toISOString\(\);/);
  assert.match(src, /if \(result\.ok\) writeLastSynced\(localStorage, started\);/);
  assert.match(src, /getElementById\('flag-button'\)\.classList\.toggle\(\s*'waiting', ctx\.syncOn\(\) && waitingFlags\(store\.doc\(\), ctx\.lastSynced\(\)\)\.length > 0\)/);
  assert.match(src, /getElementById\('flag-button'\)\.addEventListener\('click', \(\) => openFlagPanel\(ctx\)\)/);
});
