process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewWeek, PLAN_URL } from '../js/review.js';
import { TILE_IDS, normalizeTiles } from '../js/tiles.js';
import { fixture } from './helpers.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// Mon 12 – Sun 18 Oct 2026.
const SUN = '2026-10-18';

function week() {
  const doc = fixture({
    items: [
      { id: 'heb', type: 'habit', title: 'Hebrew practice', repeat: { kind: 'daily' } },
      { id: 'dentist', type: 'task', title: 'Book dentist', date: '2026-10-14' },
      { id: 'hebrew-minutes', type: 'quota', title: 'Hebrew learning time', unit: 'minutes', target: 420 },
    ],
    logs: [
      ...['2026-10-12', '2026-10-13', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].map((day) => ({ id: `d-${day}`, itemId: 'heb', kind: 'done', day })),
      { id: 'm1', itemId: 'hebrew-minutes', kind: 'amount', amount: 310, day: '2026-10-16' },
    ],
  });
  doc.gym['back:2026-10-17'] = { id: 'back:2026-10-17', status: 'active', kind: 'back', day: '2026-10-17', score: 2 };
  doc.gym['back:2026-10-18'] = { id: 'back:2026-10-18', status: 'active', kind: 'back', day: '2026-10-18', score: 0 };
  return doc;
}

test('the review is the week to date on Saturday and Sunday, last week on Monday, and nothing midweek', () => {
  const doc = week();
  assert.equal(reviewWeek(doc, SUN).start, '2026-10-12');
  assert.equal(reviewWeek(doc, '2026-10-17').end, '2026-10-17');
  const mon = reviewWeek(doc, '2026-10-19');
  assert.deepEqual([mon.start, mon.end], ['2026-10-12', '2026-10-18']);
  assert.equal(reviewWeek(doc, '2026-10-21'), null);
});

test('it names every miss with its day, and counts done against planned honestly', () => {
  const r = reviewWeek(week(), SUN);
  assert.deepEqual(r.misses, [{ title: 'Book dentist', day: '2026-10-14' }, { title: 'Hebrew practice', day: '2026-10-14' }]);
  // Day by day, as the day score counts: a task carried over counts on each day it stayed undone.
  assert.deepEqual([r.done, r.total], [6, 12]);
});

test('the targets: Hebrew hours, back mornings, and only the ones there are numbers for', () => {
  const r = reviewWeek(week(), SUN);
  assert.deepEqual(r.hebrew, { minutes: 310, target: 420 });
  assert.equal(r.cardio, null);
  assert.equal(r.protein, null);
  assert.deepEqual(r.back, { answered: 2, sore: 1 });
  assert.equal(r.sessions, null);
});

test('the review tile comes first, for arrangements saved before it too', () => {
  assert.equal(TILE_IDS[0], 'review');
  const old = { v: 1, order: ['needs', 'body', 'fuel', 'hebrew', 'goals', 'weeks', 'countdown', 'week'], hidden: [] };
  assert.equal(normalizeTiles(old).order[0], 'review');
});

test('planning next week hands over to Claude with nothing personal in the address', () => {
  assert.match(PLAN_URL, /^https:\/\/claude\.ai\/new\?q=/);
  assert.equal(decodeURIComponent(PLAN_URL.split('q=')[1]), '/dashboard Plan my next week: start with catchup 7, name what I missed, then plan it.');
  const ui = read('js/ui/review.js');
  assert.match(ui, /PLAN_URL/);
  assert.match(ui, /target: '_blank'/);
  assert.match(read('js/ui/tiles.js'), /id: 'review'/);
  assert.ok(read('sw.js').includes("'js/review.js'") && read('sw.js').includes("'js/ui/review.js'"));
});
