import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TILE_IDS, DEFAULT_TILES, fromClassic, normalizeTiles, moveTile, nudgeTile, hideTile, showTile, loadTiles, saveTiles, TILES_KEY,
  bodyHero, hebrewHero,
} from '../js/tiles.js';
import { MemoryStorage, fixture } from './helpers.js';

test('a classic arrangement becomes tiles in the same reading order', () => {
  const classic = { v: 4, under: ['goals', 'agenda'], columns: [['note', 'countdown', 'gym'], ['history', 'hebrew', 'muscles']], hidden: ['week', 'cardio'] };
  assert.deepEqual(fromClassic(classic), { v: 1, order: ['review', 'goals', 'needs', 'countdown', 'body', 'weeks', 'hebrew', 'fuel', 'week'], hidden: ['week'] });
});

test('Fuel is a tile after Body, and a saved arrangement from before it gains it at the end', () => {
  assert.deepEqual(TILE_IDS.slice(2, 4), ['body', 'fuel']);
  const old = { v: 1, order: ['needs', 'body', 'hebrew', 'goals', 'weeks', 'countdown', 'week'], hidden: [] };
  assert.equal(normalizeTiles(old).order.at(-1), 'fuel');
});

test('normalising drops strangers and repeats, adds the missing, and rejects junk', () => {
  assert.deepEqual(normalizeTiles({ v: 1, order: ['body', 'body', 'nope'], hidden: [] }).order, ['review', 'body', ...TILE_IDS.filter((id) => id !== 'body' && id !== 'review')]);
  assert.deepEqual(normalizeTiles('junk'), DEFAULT_TILES);
});

test('moving, nudging, hiding and showing', () => {
  let t = DEFAULT_TILES;
  t = moveTile(t, 'weeks', 'needs');
  assert.deepEqual(t.order.slice(0, 2), ['review', 'weeks']);
  t = nudgeTile(t, 'weeks', 1);
  assert.deepEqual(t.order.slice(1, 3), ['needs', 'weeks']);
  t = hideTile(t, 'goals');
  assert.ok(t.hidden.includes('goals'));
  t = showTile(t, 'goals');
  assert.equal(t.order.at(-1), 'goals');
  assert.ok(!t.hidden.includes('goals'));
});

test('loading prefers the saved tiles, and otherwise starts from the classic layout', () => {
  const storage = new MemoryStorage();
  const classic = { v: 4, under: [], columns: [['gym'], []], hidden: [] };
  assert.deepEqual(loadTiles(storage, classic).order.slice(0, 2), ['review', 'body']);
  saveTiles(storage, { v: 1, order: ['hebrew', ...TILE_IDS.filter((id) => id !== 'hebrew')], hidden: [] });
  assert.equal(JSON.parse(storage.getItem(TILES_KEY)).order[0], 'hebrew');
  assert.equal(loadTiles(storage, classic).order[0], 'hebrew');
});

test("Body's hero: cardio minutes this week against the target", () => {
  const doc = fixture({
    items: [{ id: 'cardio', type: 'quota', title: 'Cardio', unit: 'minutes', target: 150 }],
    logs: [{ id: 'l1', itemId: 'cardio', kind: 'amount', amount: 25, day: '2026-10-19' }, { id: 'l2', itemId: 'cardio', kind: 'amount', amount: 13, day: '2026-10-20' }],
  });
  doc.gym.config = { id: 'config', status: 'active', cardioQuota: 'cardio' };
  assert.deepEqual(bodyHero(doc, '2026-10-20'), { number: '38', caption: 'of 150 cardio minutes this week' });
  assert.equal(bodyHero(fixture(), '2026-10-20'), null);
});

test("Hebrew's hero: hours and minutes this week against the target in hours", () => {
  const doc = fixture({
    items: [{ id: 'hebrew-minutes', type: 'quota', title: 'Hebrew learning time', unit: 'minutes', target: 420 }],
    logs: [{ id: 'h1', itemId: 'hebrew-minutes', kind: 'amount', amount: 230, day: '2026-10-19' }, { id: 'h2', itemId: 'hebrew-minutes', kind: 'amount', amount: 62, day: '2026-10-20' }],
  });
  assert.deepEqual(hebrewHero(doc, '2026-10-20'), { number: '4:52', caption: 'of 7 h this week' });
  assert.equal(hebrewHero(fixture(), '2026-10-20'), null);
});

test('final review: what Daylight shows elsewhere decides This week, not the classic hidden list', async () => {
  const { daylightShows } = await import('../js/tiles.js');
  const { weekTargets } = await import('../js/ui/side.js');
  const doc = fixture({ items: [{ id: 'cardio', type: 'quota', title: 'Cardio', unit: 'minutes', target: 150 }] });
  doc.gym.config = { id: 'config', status: 'active', cardioQuota: 'cardio' };
  const shown = { v: 1, order: [...TILE_IDS], hidden: [] };
  // Body shows cardio as its big number even with no workouts yet, so This week leaves it out.
  assert.deepEqual(daylightShows(shown, doc, '2026-10-20'), { cardio: true, hebrew: false });
  assert.deepEqual(weekTargets(doc, '2026-10-20', [], daylightShows(shown, doc, '2026-10-20')).map((q) => q.id), []);
  // Body hidden: cardio comes back to This week.
  const hidden = hideTile(shown, 'body');
  assert.deepEqual(weekTargets(doc, '2026-10-20', [], daylightShows(hidden, doc, '2026-10-20')).map((q) => q.id), ['cardio']);
});
