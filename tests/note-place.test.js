import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NOTE_PLACES, NOTE_KEY, loadNotePlace, saveNotePlace } from '../js/tiles.js';
import { MemoryStorage } from './helpers.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the note for Claude sits at the top by default, and can move under the day or into the tiles', () => {
  assert.deepEqual(NOTE_PLACES, ['top', 'day', 'tiles']);
  const storage = new MemoryStorage();
  assert.equal(loadNotePlace(storage), 'top');
  saveNotePlace(storage, 'tiles');
  assert.equal(storage.getItem(NOTE_KEY), 'tiles');
  assert.equal(loadNotePlace(storage), 'tiles');
  storage.setItem(NOTE_KEY, 'nowhere');
  assert.equal(loadNotePlace(storage), 'top');
});

test('each place draws the note, and Arrange offers the three places', () => {
  const html = read('index.html');
  assert.match(html, /<header id="dl-sky" class="dl-sky"><\/header>\s*<div id="dl-note-top" class="dl-note-top"><\/div>/);
  // Under the day, it sits beside the timeline, not in it: Arrange freezes the timeline, and the note's
  // place buttons must still work there.
  assert.match(html, /<div id="timeline"><\/div>\s*<div id="dl-note-day" class="dl-note-day"><\/div>/);
  assert.doesNotMatch(read('js/ui/timeline.js'), /noteBlock/);
  assert.match(read('js/ui/noteslot.js'), /dl-note-day/);
  assert.match(read('js/ui/tiles.js'), /ctx\.notePlace\(\) === 'tiles'/);
  const slot = read('js/ui/noteslot.js');
  assert.match(slot, /\['dl-note-top', 'top'\], \['dl-note-day', 'day'\]/);
  assert.match(slot, /Top/);
  assert.match(slot, /Under the day/);
  assert.match(slot, /With the tiles/);
  assert.match(read('js/app.js'), /closest\('#list, #under, #side, #timeline, #tiles, #dl-sky, #dl-note-top, #dl-note-day'\)/);
  assert.ok(read('sw.js').includes("'js/ui/noteslot.js'"));
});
