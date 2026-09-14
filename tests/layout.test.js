import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYOUT_KEY, DEFAULT_LAYOUT, normalizeLayout, visibleColumns, moveWidget, nudgeWidget, hideWidget, showWidget,
  loadLayout, saveLayout,
} from '../js/layout.js';
import { MemoryStorage, FullStorage } from './helpers.js';

const IDS = ['coach', 'week', 'goals', 'history'];
const L = (columns, hidden = []) => ({ v: 2, columns, hidden });

// Freezes a layout all the way down, so a function that changes its input throws.
function frozen(layout) {
  layout.columns.forEach(Object.freeze);
  Object.freeze(layout.columns);
  Object.freeze(layout.hidden);
  return Object.freeze(layout);
}

// Every known id exactly once, across the columns and hidden.
function assertEachOnce(layout, ids = IDS) {
  assert.deepEqual([...layout.columns.flat(), ...layout.hidden].sort(), [...ids].sort());
}

// ---- the default and normalizeLayout ------------------------------------------------------------

test('the default arrangement: Coach and Goals, then Last 3 weeks; This week hidden', () => {
  assert.equal(LAYOUT_KEY, 'dash_layout');
  assert.deepEqual(DEFAULT_LAYOUT, { v: 2, columns: [['coach', 'goals'], ['history']], hidden: ['week'] });
  assert.throws(() => DEFAULT_LAYOUT.columns[0].push('x'), TypeError);
  assert.throws(() => { DEFAULT_LAYOUT.hidden = ['coach']; }, TypeError);
});

test('normalizeLayout of the default is a fresh copy of it', () => {
  const out = normalizeLayout(DEFAULT_LAYOUT, IDS);
  assert.deepEqual(out, DEFAULT_LAYOUT);
  out.columns[0].push('extra');
  assert.deepEqual(DEFAULT_LAYOUT.columns[0], ['coach', 'goals']);
});

test('unreadable saved data gives the default', () => {
  const unreadable = [null, undefined, 'x', 42, true, [], {}, { v: 3, columns: [['coach'], []], hidden: [] }, { v: 2 }, { v: 1, columns: 'coach' }];
  for (const saved of unreadable) assert.deepEqual(normalizeLayout(saved, IDS), DEFAULT_LAYOUT, JSON.stringify(saved));
});

test('normalizeLayout drops unknown ids, non-strings and repeats; hidden wins over placed', () => {
  const saved = L([['coach', 'weather', 'coach', 7, null], ['week', 'goals', 'coach']], ['goals', 'goals', 'nope']);
  assert.deepEqual(normalizeLayout(saved, IDS), L([['coach', 'history'], ['week']], ['goals']));
});

test('normalizeLayout always gives two columns', () => {
  assert.deepEqual(normalizeLayout(L([['week', 'coach', 'goals', 'history']]), IDS), L([['week', 'coach', 'goals', 'history'], []]));
  assert.deepEqual(normalizeLayout(L([]), IDS), L([['coach', 'week', 'goals', 'history'], []]));
  assert.deepEqual(normalizeLayout(L([['coach'], ['week'], ['goals'], 'junk']), IDS), L([['coach', 'history'], ['week', 'goals']]));
  assert.deepEqual(normalizeLayout({ v: 2, columns: ['junk', ['goals']], hidden: 'junk' }, IDS), L([['coach', 'week', 'history'], ['goals']]));
});

test('a new widget appears at the end of the first column; one that has gone disappears', () => {
  const saved = L([['week', 'coach'], ['history']], ['goals']);
  assert.deepEqual(normalizeLayout(saved, [...IDS, 'calendar']), L([['week', 'coach', 'calendar'], ['history']], ['goals']));
  assert.deepEqual(normalizeLayout(saved, ['coach', 'week', 'history']), L([['week', 'coach'], ['history']], []));
});

test('a saved v 1 layout comes out as v 2 with This week hidden, everything else where it was', () => {
  const v1 = (columns, hidden = []) => ({ v: 1, columns, hidden });
  assert.deepEqual(normalizeLayout(v1([['coach', 'week'], ['goals', 'history']]), IDS), L([['coach'], ['goals', 'history']], ['week']));
  assert.deepEqual(normalizeLayout(v1([['history', 'coach'], ['goals', 'week']]), IDS), L([['history', 'coach'], ['goals']], ['week']));
  // already hidden: only the version changes
  assert.deepEqual(normalizeLayout(v1([['coach'], ['goals']], ['history', 'week']), IDS), L([['coach'], ['goals']], ['history', 'week']));
  // once migrated it stays put: This week shown again from Arrange is not hidden a second time
  assert.deepEqual(normalizeLayout(L([['coach', 'week'], ['goals', 'history']]), IDS), L([['coach', 'week'], ['goals', 'history']]));
  const storage = new MemoryStorage({ [LAYOUT_KEY]: JSON.stringify(v1([['coach', 'week'], ['goals', 'history']])) });
  assert.deepEqual(loadLayout(storage, IDS), L([['coach'], ['goals', 'history']], ['week']));
});

test('normalizeLayout never changes what it was given', () => {
  assert.doesNotThrow(() => normalizeLayout(frozen(L([['coach', 'coach'], ['week']], ['nope'])), IDS));
});

// ---- visibleColumns ----------------------------------------------------------------------------

test('visibleColumns: two columns side by side, or one list, never the hidden ones', () => {
  const layout = L([['coach', 'week'], ['goals']], ['history']);
  assert.deepEqual(visibleColumns(layout, 2), [['coach', 'week'], ['goals']]);
  assert.deepEqual(visibleColumns(layout, 1), [['coach', 'week', 'goals']]);
  assert.deepEqual(visibleColumns(DEFAULT_LAYOUT, 1), [['coach', 'goals', 'history']]);
  // hidden ids stay out even if a hand-edited layout still has them in a column
  assert.deepEqual(visibleColumns(L([['coach', 'history'], ['week']], ['history']), 2), [['coach'], ['week']]);
  const out = visibleColumns(DEFAULT_LAYOUT, 2);
  out[0].push('x');
  assert.deepEqual(DEFAULT_LAYOUT.columns[0], ['coach', 'goals']);
});

// ---- moveWidget --------------------------------------------------------------------------------

test('moveWidget puts a widget before another, in either column', () => {
  const start = frozen(L([['coach', 'week'], ['goals', 'history']]));
  assert.deepEqual(moveWidget(start, 'week', 0, 'coach'), L([['week', 'coach'], ['goals', 'history']]));
  assert.deepEqual(moveWidget(start, 'coach', 1, 'history'), L([['week'], ['goals', 'coach', 'history']]));
  assert.deepEqual(moveWidget(start, 'history', 0, 'coach'), L([['history', 'coach', 'week'], ['goals']]));
  // a hidden widget that is moved is placed, and so shown
  assert.deepEqual(moveWidget(frozen(L([['coach'], ['goals']], ['week'])), 'week', 1, 'goals'), L([['coach'], ['week', 'goals']]));
});

test('moveWidget with no widget to go before puts it at the end of the column', () => {
  const start = frozen(L([['coach', 'week'], ['goals', 'history']]));
  assert.deepEqual(moveWidget(start, 'coach', 1, null), L([['week'], ['goals', 'history', 'coach']]));
  assert.deepEqual(moveWidget(start, 'coach', 0, null), L([['week', 'coach'], ['goals', 'history']]));
  assert.deepEqual(moveWidget(start, 'goals', 0, 'nope'), L([['coach', 'week', 'goals'], ['history']]));
  const empty = frozen(L([['coach', 'week', 'goals', 'history'], []]));
  assert.deepEqual(moveWidget(empty, 'week', 1, null), L([['coach', 'goals', 'history'], ['week']]));
});

test('moveWidget changes nothing for a drop on itself, an unknown widget or a bad column', () => {
  const start = frozen(L([['coach', 'week'], ['goals', 'history']]));
  assert.deepEqual(moveWidget(start, 'week', 0, 'week'), start);
  assert.deepEqual(moveWidget(start, 'weather', 0, 'coach'), start);
  assert.deepEqual(moveWidget(start, 'week', 2, null), start);
  assert.deepEqual(moveWidget(start, 'week', -1, null), start);
});

// ---- nudgeWidget -------------------------------------------------------------------------------

test('nudgeWidget moves one step up or down within a column', () => {
  const start = frozen(L([['coach', 'week'], ['goals', 'history']]));
  assert.deepEqual(nudgeWidget(start, 'week', -1), L([['week', 'coach'], ['goals', 'history']]));
  assert.deepEqual(nudgeWidget(start, 'coach', 1), L([['week', 'coach'], ['goals', 'history']]));
  assert.deepEqual(nudgeWidget(start, 'history', -1), L([['coach', 'week'], ['history', 'goals']]));
  assert.deepEqual(nudgeWidget(start, 'goals', 1), L([['coach', 'week'], ['history', 'goals']]));
});

test('nudgeWidget crosses into the other column at the matching end', () => {
  const start = frozen(L([['coach', 'week'], ['goals', 'history']]));
  // down from the bottom of the first column: to the top of the second
  assert.deepEqual(nudgeWidget(start, 'week', 1), L([['coach'], ['week', 'goals', 'history']]));
  // up from the top of the second column: to the bottom of the first
  assert.deepEqual(nudgeWidget(start, 'goals', -1), L([['coach', 'week', 'goals'], ['history']]));
  // into an empty column
  assert.deepEqual(nudgeWidget(frozen(L([['coach', 'week', 'goals', 'history'], []])), 'history', 1), L([['coach', 'week', 'goals'], ['history']]));
  assert.deepEqual(nudgeWidget(frozen(L([[], ['coach', 'week']])), 'coach', -1), L([['coach'], ['week']]));
});

test('nudgeWidget stops at the very top and bottom, and ignores unknown widgets and directions', () => {
  const start = frozen(L([['coach', 'week'], ['goals', 'history']]));
  assert.deepEqual(nudgeWidget(start, 'coach', -1), start);
  assert.deepEqual(nudgeWidget(start, 'history', 1), start);
  assert.deepEqual(nudgeWidget(start, 'weather', 1), start);
  assert.deepEqual(nudgeWidget(start, 'week', 2), start);
  assert.deepEqual(nudgeWidget(start, 'week', 0), start);
});

test('crossing between columns is its own step in the one-column order', () => {
  let layout = L([['coach', 'week'], ['goals', 'history']]);
  const down = [];
  for (let i = 0; i < 5; i++) {
    layout = nudgeWidget(layout, 'coach', 1);
    down.push([visibleColumns(layout, 1)[0].indexOf('coach'), layout.columns[0].includes('coach') ? 0 : 1]);
  }
  assert.deepEqual(down, [[1, 0], [1, 1], [2, 1], [3, 1], [3, 1]]);
  const up = [];
  for (let i = 0; i < 5; i++) {
    layout = nudgeWidget(layout, 'coach', -1);
    up.push([visibleColumns(layout, 1)[0].indexOf('coach'), layout.columns[0].includes('coach') ? 0 : 1]);
  }
  assert.deepEqual(up, [[2, 1], [1, 1], [1, 0], [0, 0], [0, 0]]);
});

// ---- hideWidget and showWidget -----------------------------------------------------------------

test('hideWidget moves a widget into hidden; showWidget brings it back at the end of the first column', () => {
  const start = frozen(L([['coach', 'week'], ['goals', 'history']]));
  const hidden = hideWidget(start, 'goals');
  assert.deepEqual(hidden, L([['coach', 'week'], ['history']], ['goals']));
  assert.deepEqual(visibleColumns(hidden, 2), [['coach', 'week'], ['history']]);
  assert.deepEqual(showWidget(frozen(hidden), 'goals'), L([['coach', 'week', 'goals'], ['history']]));
  const twoHidden = frozen(hideWidget(frozen(hideWidget(start, 'coach')), 'week'));
  assert.deepEqual(twoHidden, L([[], ['goals', 'history']], ['coach', 'week']));
  assert.deepEqual(showWidget(twoHidden, 'week'), L([['week'], ['goals', 'history']], ['coach']));
});

test('hiding a hidden or unknown widget, or showing a visible or unknown one, changes nothing', () => {
  const layout = frozen(L([['coach', 'week'], ['history']], ['goals']));
  assert.deepEqual(hideWidget(layout, 'goals'), layout);
  assert.deepEqual(hideWidget(layout, 'weather'), layout);
  assert.deepEqual(showWidget(layout, 'coach'), layout);
  assert.deepEqual(showWidget(layout, 'weather'), layout);
});

test('any run of changes keeps every widget in exactly one place, and stays normalised', () => {
  let s = 7;
  const rnd = (n) => { s = (s * 16807) % 2147483647; return s % n; };
  let layout = normalizeLayout(null, IDS);
  for (let i = 0; i < 500; i++) {
    const id = IDS[rnd(4)];
    const other = [...IDS, null][rnd(5)];
    switch (rnd(4)) {
      case 0: layout = moveWidget(frozen(layout), id, rnd(2), other); break;
      case 1: layout = nudgeWidget(frozen(layout), id, rnd(2) ? 1 : -1); break;
      case 2: layout = hideWidget(frozen(layout), id); break;
      default: layout = showWidget(frozen(layout), id);
    }
    assertEachOnce(layout);
    assert.deepEqual(normalizeLayout(layout, IDS), layout);
  }
});

// ---- loadLayout and saveLayout -----------------------------------------------------------------

test('loadLayout reads the saved arrangement, normalised; nothing saved or unreadable gives the default', () => {
  const layout = L([['history'], ['goals', 'coach']], ['week']);
  const storage = new MemoryStorage({ [LAYOUT_KEY]: JSON.stringify(layout) });
  assert.deepEqual(loadLayout(storage, IDS), layout);
  assert.deepEqual(loadLayout(new MemoryStorage(), IDS), DEFAULT_LAYOUT);
  assert.deepEqual(loadLayout(new MemoryStorage({ [LAYOUT_KEY]: '{not json' }), IDS), DEFAULT_LAYOUT);
  class DeniedRead extends MemoryStorage { getItem() { throw new Error('denied'); } }
  assert.deepEqual(loadLayout(new DeniedRead(), IDS), DEFAULT_LAYOUT);
  assert.deepEqual(loadLayout(storage, [...IDS, 'calendar']), L([['history', 'calendar'], ['goals', 'coach']], ['week']));
});

test('saveLayout writes only dash_layout, and a full storage is reported, not thrown', () => {
  const storage = new MemoryStorage();
  const layout = L([['week'], ['coach', 'goals', 'history']]);
  assert.equal(saveLayout(storage, layout), true);
  assert.deepEqual([...storage.map.keys()], ['dash_layout']);
  assert.deepEqual(JSON.parse(storage.getItem('dash_layout')), layout);
  assert.deepEqual(loadLayout(storage, IDS), layout);
  assert.equal(saveLayout(new FullStorage(), layout), false);
});
