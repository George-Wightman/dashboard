import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createStore, DEFAULT_SETTINGS, SETTINGS_KEY } from '../js/data.js';
import { MemoryStorage } from './helpers.js';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// index.html's head script, run against saved settings and a URL, reporting the screen it picked.
function headScreen(saved, search = '') {
  const script = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  const root = { dataset: {} };
  const storage = new MemoryStorage();
  if (saved) storage.setItem('dash_settings', JSON.stringify(saved));
  const sandbox = {
    document: { documentElement: root, querySelector: () => ({ content: '' }) },
    localStorage: storage, location: { search },
  };
  vm.runInContext(script, vm.createContext(sandbox));
  return root.dataset.screen;
}

test('Daylight is the screen by default, and Classic only when chosen since Daylight became the default', () => {
  assert.equal(DEFAULT_SETTINGS.screen, 'daylight');
  assert.equal(headScreen(null), 'daylight');
  assert.equal(headScreen({ screen: 'classic' }), 'daylight', 'a classic saved before Daylight was the default moves over once');
  assert.equal(headScreen({ screen: 'classic', screenV: 2 }), 'classic');
  assert.equal(headScreen({ screen: 'classic', screenV: 2 }, '?daylight'), 'daylight');
  assert.equal(headScreen({ screen: 'daylight', screenV: 2 }, '?classic'), 'classic');
});

test('the store agrees: an old classic save reads as Daylight, and a choice made now is kept', () => {
  const storage = new MemoryStorage();
  storage.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, screen: 'classic' }));
  const store = createStore({ storage });
  assert.equal(store.settings().screen, 'daylight');
  store.updateSettings({ screen: 'classic' });
  assert.equal(JSON.parse(storage.getItem(SETTINGS_KEY)).screenV, 2);
  assert.equal(createStore({ storage }).settings().screen, 'classic');
});
