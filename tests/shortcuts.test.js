process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backRowState } from '../js/coach.js';
import { hebrewMinutesId, logHebrewByHand } from '../js/tiles.js';
import { makeStore, fixture } from './helpers.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the home-screen icon has three shortcuts: snap a meal, log Hebrew time, the back check', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.deepEqual(m.shortcuts.map((s) => [s.short_name, s.url]), [['Snap', './?do=snap'], ['Hebrew', './?do=hebrew'], ['Back', './?do=back']]);
  for (const s of m.shortcuts) assert.ok(s.name && s.icons?.length, s.url);
});

test('the app opens what a shortcut asks for, then tidies the address', () => {
  const app = read('js/app.js');
  assert.match(app, /params\.get\('do'\)/);
  // At the top level after the page is set up (not inside wake(), which runs on every return to the tab).
  assert.match(app, /\nif \(params\.has\('checkin'\)\) \{[\s\S]*\n\}\n(\/\/[^\n]*\n)*(function runShortcut[\s\S]*?\n\}\n)?if \(params\.has\('do'\)\) \{/);
  assert.match(app, /openSnap\(ctx/);
  assert.match(app, /openHebrewLog\(ctx\)/);
  assert.match(app, /ui\.backAsk = true/);
  assert.match(read('index.html'), /<dialog id="hebrew-log" class="sheet hebrew-log"/);
  assert.ok(read('sw.js').includes("'js/ui/hebrewlog.js'"));
});

test('asked for (the shortcut, or Change), the back question shows at any hour', () => {
  const store = makeStore();
  const at15 = new Date(2026, 9, 20, 15, 0);
  assert.equal(backRowState(store.doc(), '2026-10-20', at15, 4), null);
  assert.deepEqual(backRowState(store.doc(), '2026-10-20', at15, 4, { anyTime: true }), { state: 'ask' });
});

test('Hebrew time logged by hand counts towards the weekly Hebrew minutes', () => {
  const doc = fixture({ items: [{ id: 'hebrew-minutes', type: 'quota', title: 'Hebrew learning time', unit: 'minutes', target: 420 }] });
  assert.equal(hebrewMinutesId(doc), 'hebrew-minutes');
  assert.equal(hebrewMinutesId(fixture()), null);
  const store = makeStore();
  assert.throws(() => logHebrewByHand(store, 30), /No weekly Hebrew target yet/);
  const q = store.addItem({ type: 'quota', title: 'Hebrew learning time', unit: 'minutes', target: 420, id: 'hebrew-minutes' });
  const log = logHebrewByHand(store, 30);
  assert.deepEqual([log.itemId, log.amount, log.kind, log.note], [q.id, 30, 'amount', 'logged by hand']);
  assert.throws(() => logHebrewByHand(store, 0), /above 0/);
});

test('a home-screen widget opens its tile big, then tidies the address', () => {
  const app = read('js/app.js');
  assert.match(app, /if \(params\.has\('big'\)\) \{[\s\S]*searchParams\.delete\('big'\)[\s\S]*openTile\(ctx, tile\)/);
  assert.match(read('js/ui/tiles.js'), /export function openTile\(ctx, id\)/);
});
