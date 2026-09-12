import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { APP_VERSION } from '../js/flags.js';

const SW = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

// Every .js file under js/, as a SHELL-style relative path ('js/app.js', 'js/ui/dom.js', ...).
function jsFiles(dir = new URL('../js/', import.meta.url), prefix = 'js/') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? jsFiles(new URL(`${e.name}/`, dir), `${prefix}${e.name}/`)
    : e.name.endsWith('.js') ? [`${prefix}${e.name}`] : []));
}

function shellEntries() {
  const body = SW.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('CACHE is the app version a flag records (js/flags.js), so the two can never drift', () => {
  assert.equal(SW.match(/const CACHE = '([^']+)';/)?.[1], APP_VERSION);
});

test('every SHELL entry exists, apart from "./" (the page itself)', () => {
  for (const entry of shellEntries()) {
    if (entry === './') continue;
    assert.ok(existsSync(new URL(`../${entry}`, import.meta.url)), entry);
  }
});

test('every js/ file is offline-shelled; nothing under dev/ is', () => {
  const shell = shellEntries();
  for (const file of jsFiles()) assert.ok(shell.includes(file), `${file} missing from SHELL`);
  assert.ok(!shell.some((entry) => entry.startsWith('dev/')), 'dev/ is for local testing only');
});
