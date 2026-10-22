// Axial hex coordinates for the map (js/map/engine.js, js/ui/map.js): pointy-top hexes, a tile as
// "q,r". Pure.

export const DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
export const key = (q, r) => `${q},${r}`;
export const unkey = (k) => k.split(',').map(Number);
export const nbrs = (q, r) => DIRS.map(([a, b]) => key(q + a, r + b));
export const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[0] + a[1] - b[0] - b[1]));
export const distK = (a, b) => dist(unkey(a), unkey(b));
