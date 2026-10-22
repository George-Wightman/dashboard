// An invented town for the map's tests: a hexagon of land four rings out, two places to find, a home,
// one building per track, a wonder and a few finds. Nothing in it is anyone's real place.

import { key, dist } from '../../js/map/hex.js';

const TERRAIN = ['meadow', 'farm', 'forest', 'hills', 'town'];

export function mapTown(overrides = {}) {
  const tiles = [];
  for (let q = -4; q <= 4; q++) {
    for (let r = -4; r <= 4; r++) {
      if (dist([q, r], [0, 0]) > 4) continue;
      const t = { q, r, terrain: TERRAIN[Math.abs(q * 3 + r) % TERRAIN.length] };
      if (key(q, r) === '2,0') t.find = 'wheat';
      if (key(q, r) === '-2,2') t.find = 'coal';
      tiles.push(t);
    }
  }
  return {
    id: 'town', name: 'Townsby', place: 'uk', start: '2026-09-10', end: null,
    home: 'cottage',
    tiles,
    places: [
      { id: 'mill', name: 'The Mill', kind: 'found', q: 3, r: -1, note: 'An old mill' },
      { id: 'pond', name: 'Duck Pond', kind: 'found', q: -3, r: 1, note: 'A pond' },
      { id: 'cottage', name: 'Home', kind: 'found', q: -1, r: 3, note: 'Home' },
      { id: 'school', name: 'The School', kind: 'build', track: 'learning', q: 2, r: 1 },
      { id: 'gym', name: 'The Gym', kind: 'build', track: 'sport', q: -2, r: -1 },
      { id: 'hall', name: 'The Hall', kind: 'build', track: 'culture', q: 0, r: -2 },
      { id: 'tower', name: 'The Tower', kind: 'wonder', q: 4, r: -2 },
    ],
    tracks: {
      learning: { name: 'Learning', areas: ['Study'], list: [['school', 100]] },
      sport: { name: 'Sport', areas: ['Health'], list: [['gym', 100]] },
      culture: { name: 'Culture', areas: ['Reading'], list: [['hall', 60]] },
    },
    ...overrides,
  };
}
