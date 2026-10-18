// Daylight's tiles beside the timeline: Needs you, Body, Hebrew, Goals, Your weeks, Countdown and
// This week. Each is a coloured card with one job; most reuse the classic widget's content (restyled
// by styles/daylight.css), Body and Hebrew add a big number on top (js/tiles.js), and those with a
// long view open it big with ⤢. In Arrange mode tiles can be dragged (or nudged with ↑ ↓ on touch and
// narrow windows), hidden, and brought back. The arrangement is this device's own (js/tiles.js).

import { h } from './dom.js';
import { moveTile, nudgeTile, hideTile, showTile, bodyHero, hebrewHero, daylightShows } from '../tiles.js';
import { renderNeeds } from './needs.js';
import { renderGym, renderGymBig } from './gym.js';
import { renderMuscles, renderCardioTrend } from './training.js';
import { renderHebrew, renderHebrewBig } from './hebrew.js';
import { renderGoals, renderHistory, renderHistoryBig, renderWeek, keptFocus, restoreFocus } from './side.js';
import { renderCountdown } from './countdown.js';
import { renderFuel, renderFuelBig } from './fuel.js';
import { renderCoach, renderCoachBig } from './coach.js';
import { openBig } from './big.js';

// Parts of a tile one under the other, or nothing when none has anything to show.
const stacked = (...parts) => {
  const shown = parts.filter(Boolean);
  return shown.length ? h('div', { class: 'tile-parts' }, shown) : null;
};

// A widget's content with its big number above it.
const withHero = (hero, content) => {
  if (!content && !hero) return null;
  return h('div', { class: 'tile-stack' },
    hero ? h('p', { class: 'tile-hero' }, h('span', { class: 'tile-num' }, hero.number), h('span', { class: 'tile-cap' }, hero.caption)) : null,
    content);
};

export const TILES = [
  { id: 'needs', title: 'Needs you', area: 'needs', render: renderNeeds },
  {
    id: 'body', title: 'Body', area: 'body',
    render: (ctx) => withHero(bodyHero(ctx.store.doc(), ctx.store.today()), stacked(renderCoach(ctx), renderGym(ctx))),
    big: (ctx) => h('div', { class: 'tile-big' }, renderCoachBig(ctx), renderGymBig(ctx), renderMuscles(ctx), renderCardioTrend(ctx)),
  },
  { id: 'fuel', title: 'Fuel', area: 'fuel', render: renderFuel, big: renderFuelBig },
  {
    id: 'hebrew', title: 'Hebrew', area: 'hebrew',
    render: (ctx) => withHero(hebrewHero(ctx.store.doc(), ctx.store.today()), renderHebrew(ctx)),
    big: renderHebrewBig,
  },
  { id: 'goals', title: 'Goals', area: 'goals', render: renderGoals },
  { id: 'weeks', title: 'Your weeks', area: 'weeks', render: renderHistory, big: renderHistoryBig },
  { id: 'countdown', title: 'Countdown', area: 'countdown', render: renderCountdown },
  {
    id: 'week', title: 'This week', area: 'week',
    // Only the targets no other tile shows (each number in one place).
    render: (ctx) => renderWeek({ ...ctx, weekShows: () => daylightShows(ctx.tiles(), ctx.store.doc(), ctx.store.today()) }),
  },
];
const BY_ID = new Map(TILES.map((t) => [t.id, t]));

const useNudge = () => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || innerWidth < 760;

function tileEl(ctx, tile, content, arranging) {
  const head = h('div', { class: 'tile-head' },
    h('h2', {}, tile.title),
    tile.big && !arranging ? h('button', { class: 'tile-open', type: 'button', title: `Open ${tile.title} big`, 'aria-label': `Open ${tile.title} big`, onclick: () => openBig(ctx, tile) }, '⤢') : null);
  return h('section', { class: 'tile', 'data-tile': tile.id, 'data-area': tile.area, 'aria-label': tile.title }, head, content);
}

// The bar a tile gets in Arrange mode, and where a dragged tile can land.
function arrangeBar(ctx, tile) {
  const tiles = ctx.tiles();
  const bar = h('div', { class: 'tile-bar' });
  if (useNudge()) {
    bar.append(
      h('button', { class: 'dl-btn', type: 'button', 'aria-label': `Move ${tile.title} up`, onclick: () => ctx.setTiles(nudgeTile(tiles, tile.id, -1)) }, '↑'),
      h('button', { class: 'dl-btn', type: 'button', 'aria-label': `Move ${tile.title} down`, onclick: () => ctx.setTiles(nudgeTile(tiles, tile.id, 1)) }, '↓'));
  } else {
    const grip = h('span', { class: 'tile-grip', draggable: 'true', title: 'Drag to move' }, '⋮⋮');
    grip.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-tile', tile.id); e.dataTransfer.effectAllowed = 'move'; });
    bar.append(grip);
  }
  bar.append(h('button', { class: 'link', type: 'button', onclick: () => ctx.setTiles(hideTile(tiles, tile.id)) }, 'Hide'));
  return bar;
}

function dropBefore(el, ctx, beforeId) {
  el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-tile')) { e.preventDefault(); el.classList.add('drop-before'); } });
  el.addEventListener('dragleave', () => el.classList.remove('drop-before'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drop-before');
    const id = e.dataTransfer.getData('text/x-tile');
    if (id) ctx.setTiles(moveTile(ctx.tiles(), id, beforeId));
  });
}

export function renderTiles(ctx) {
  const root = document.getElementById('tiles');
  const kept = keptFocus(root);
  const arranging = ctx.ui.arranging;
  const tiles = ctx.tiles();
  const els = [];
  for (const id of tiles.order) {
    if (tiles.hidden.includes(id)) continue;
    const tile = BY_ID.get(id);
    if (!tile) continue;
    const content = tile.render(ctx);
    if (!arranging) {
      if (content) els.push(tileEl(ctx, tile, content, false));
      continue;
    }
    const inner = content ?? h('p', { class: 'muted' }, 'Nothing to show yet');
    inner.inert = true;
    const el = tileEl(ctx, tile, inner, true);
    el.classList.add('arranging');
    el.prepend(arrangeBar(ctx, tile));
    dropBefore(el, ctx, id);
    els.push(el);
  }
  if (arranging) {
    const end = h('div', { class: 'tile-drop' }, 'Drop here to put it last');
    dropBefore(end, ctx, null);
    els.push(end);
    const hidden = tiles.hidden.map((id) => BY_ID.get(id)).filter(Boolean);
    if (hidden.length) {
      els.push(h('div', { class: 'tile-add' }, h('span', { class: 'muted' }, 'Add a tile:'),
        hidden.map((t) => h('button', { class: 'dl-btn', type: 'button', onclick: () => ctx.setTiles(showTile(ctx.tiles(), t.id)) }, `+ ${t.title}`))));
    }
  }
  root.replaceChildren(...els);
  restoreFocus(root, kept);
}
