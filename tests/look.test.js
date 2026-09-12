import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { resolveLook, THEME_COLORS, LOOKS, LOOK_CHOICES } from '../js/look.js';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../js/data.js';
import { MemoryStorage, makeStore } from './helpers.js';

const at = (hour, minute = 0) => new Date(2026, 8, 12, hour, minute);
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const nightHours = (settings) => HOURS.filter((h) => resolveLook(at(h, 30), settings) === 'night');

// ---- resolveLook -------------------------------------------------------------------------------

test('resolveLook with the defaults: Night from 18:00 until 04:00, Paper otherwise', () => {
  for (const hour of HOURS) {
    const expected = hour >= 18 || hour < 4 ? 'night' : 'paper';
    for (const minute of [0, 59]) {
      assert.equal(resolveLook(at(hour, minute), { look: 'auto', checkinHour: 18, dayStartHour: 4 }), expected, `${hour}:${minute}`);
    }
    assert.equal(resolveLook(at(hour)), expected, `${hour}:00 with no settings`);
    assert.equal(resolveLook(at(hour), DEFAULT_SETTINGS), expected, `${hour}:00 with DEFAULT_SETTINGS`);
  }
});

test('resolveLook follows custom check-in and day-start hours', () => {
  assert.deepEqual(nightHours({ look: 'auto', checkinHour: 21, dayStartHour: 6 }), [0, 1, 2, 3, 4, 5, 21, 22, 23]);
  assert.deepEqual(nightHours({ look: 'auto', checkinHour: 23, dayStartHour: 0 }), [23]);
  assert.deepEqual(nightHours({ look: 'auto', checkinHour: 12, dayStartHour: 0 }), HOURS.filter((h) => h >= 12));
  assert.deepEqual(nightHours({ look: 'auto', checkinHour: 20, dayStartHour: 12 }),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 20, 21, 22, 23]);
});

test('a fixed look ignores the clock', () => {
  for (const hour of HOURS) {
    assert.equal(resolveLook(at(hour), { look: 'paper', checkinHour: 18, dayStartHour: 4 }), 'paper');
    assert.equal(resolveLook(at(hour), { look: 'night', checkinHour: 18, dayStartHour: 4 }), 'night');
  }
});

test('when the two hours meet (both 12) it is always Night', () => {
  assert.deepEqual(nightHours({ look: 'auto', checkinHour: 12, dayStartHour: 12 }), HOURS);
});

test('an unknown or missing look setting follows the day', () => {
  for (const look of ['bogus', undefined, null, '']) {
    assert.deepEqual(nightHours({ look, checkinHour: 18, dayStartHour: 4 }), [0, 1, 2, 3, 18, 19, 20, 21, 22, 23], String(look));
  }
});

test('the ⚙ choices and the title-bar colours', () => {
  assert.deepEqual(LOOKS, ['auto', 'paper', 'night']);
  assert.deepEqual(LOOK_CHOICES, [
    ['auto', 'Follow the day (Paper, then Night from the check-in hour)'],
    ['paper', 'Paper'],
    ['night', 'Night'],
  ]);
  assert.deepEqual(THEME_COLORS, { paper: '#f5f0e7', night: '#1c232b' });
});

test('look is a device-local setting, auto by default; older saved settings pick it up', () => {
  assert.equal(DEFAULT_SETTINGS.look, 'auto');
  const storage = new MemoryStorage({ [SETTINGS_KEY]: JSON.stringify({ token: 't', repo: 'o/r', dayStartHour: 5, checkinHour: 20 }) });
  const store = makeStore({ storage });
  assert.equal(store.settings().look, 'auto');
  store.updateSettings({ look: 'night' });
  assert.equal(JSON.parse(storage.getItem(SETTINGS_KEY)).look, 'night');
  assert.equal('look' in store.doc(), false);
});

// ---- the inline <head> script and the title bar -------------------------------------------------

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Compiles index.html's one inline script once, and returns a function that runs it against a
// storage and a moment, in a vm context with a fake document, and reports what it set.
function inlineRunner() {
  const scripts = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1, 'index.html has exactly one inline script');
  const script = new vm.Script(scripts[0]);
  const root = { dataset: {} };
  const meta = { content: '' };
  const sandbox = {
    document: { documentElement: root, querySelector: (sel) => (sel === 'meta[name="theme-color"]' ? meta : null) },
  };
  const context = vm.createContext(sandbox);
  return (storage, when) => {
    sandbox.localStorage = storage;
    sandbox.Date = class extends Date {
      constructor(...args) { super(...(args.length ? args : [when.getTime()])); }
    };
    delete root.dataset.theme;
    meta.content = '';
    script.runInContext(context);
    return { theme: root.dataset.theme, color: meta.content };
  };
}

test('index.html sets the look in <head>, before the body paints, after the theme-color meta', () => {
  assert.match(HTML, /<meta name="theme-color" content="#f5f0e7">/);
  const script = HTML.indexOf('<script>');
  assert.ok(script > HTML.indexOf('<meta name="theme-color"'));
  assert.ok(script < HTML.indexOf('</head>'));
});

test('the inline script agrees with resolveLook for every hour and a spread of settings', () => {
  const run = inlineRunner();
  const saves = [null, '{not json', '[]', '"paper"', 'true', '{}', JSON.stringify({ token: 't', repo: 'o/r', dayStartHour: 5 })];
  for (const look of ['auto', 'paper', 'night', 'bogus']) {
    for (const [checkinHour, dayStartHour] of [[18, 4], [12, 12], [23, 0], [20, 6], [12, 0], [21, 12]]) {
      saves.push(JSON.stringify({ look, checkinHour, dayStartHour }));
    }
  }
  saves.push(JSON.stringify({ look: 'night' }), JSON.stringify({ checkinHour: 21 }), JSON.stringify({ dayStartHour: 7 }));
  for (const saved of saves) {
    const storage = new MemoryStorage(saved === null ? {} : { [SETTINGS_KEY]: saved });
    const settings = makeStore({ storage }).settings(); // what the page itself will read
    for (const hour of HOURS) {
      for (const minute of [0, 30]) {
        const when = at(hour, minute);
        const expected = resolveLook(when, settings);
        assert.deepEqual(run(storage, when), { theme: expected, color: THEME_COLORS[expected] }, `${saved} at ${hour}:${minute}`);
      }
    }
  }
});

test('the inline script falls back to the defaults when storage cannot be read', () => {
  const run = inlineRunner();
  const denied = { getItem() { throw new Error('denied'); } };
  assert.equal(run(denied, at(19)).theme, 'night');
  assert.equal(run(denied, at(3)).theme, 'night');
  assert.equal(run(denied, at(10)).theme, 'paper');
});

test('the installed app starts Paper: manifest colours match Paper\'s --bg', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.theme_color, THEME_COLORS.paper);
  assert.equal(manifest.background_color, THEME_COLORS.paper);
});
