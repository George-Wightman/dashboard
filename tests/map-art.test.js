// The map's generic art (js/ui/map-art.js): seasons, and nothing in it can run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seasonOf, decoSvg, starSvg, seasonTop, groundSvg, findSvg, campSvg, bannerSvg, SNOW, TERRAIN } from '../js/ui/map-art.js';

test('the season follows the date', () => {
  assert.equal(seasonOf('2026-10-22'), 'autumn');
  assert.equal(seasonOf('2026-12-03'), 'winter');
  assert.equal(seasonOf('2027-02-28'), 'winter');
  assert.equal(seasonOf('2027-04-01'), 'spring');
  assert.equal(seasonOf('2027-07-15'), 'summer');
});

test('winter puts snow on the trees and the land', () => {
  assert.ok(decoSvg('forest', 0, 0, { q: 1, r: 2, season: 'winter' }).includes(SNOW) || decoSvg('forest', 0, 0, { q: 1, r: 2, season: 'winter' }).includes('#ffffff'));
  assert.notEqual(seasonTop(TERRAIN.meadow.top, 'winter', 'meadow'), TERRAIN.meadow.top);
  assert.equal(seasonTop(TERRAIN.meadow.top, 'summer', 'meadow'), TERRAIN.meadow.top);
});

test('a wonder site of his is a gold star', () => {
  assert.ok(starSvg(0, 0, true).includes('#ffd866'));
  assert.ok(!starSvg(0, 0, false).includes('#ffd866'));
});

test('nothing the art draws can run', () => {
  const all = [groundSvg(0, 0, '#9cc35a'), findSvg('coal', 0, 0), campSvg(0, 0), bannerSvg('<script>x</script>', 3, 0, 0),
    ...Object.keys(TERRAIN).map((t) => decoSvg(t, 0, 0, { season: 'spring', clip: 'c' }))].join('');
  assert.ok(!/<script/i.test(all));
  assert.ok(!/\son[a-z]+=/i.test(all));
});
