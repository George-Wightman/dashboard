// What a day is worth on the map, row by row (docs/superpowers/specs/2026-10-22-civ-map-design.md):
// the checklist George asked for on 22 Oct 2026, so he can see what's counting and what isn't
// instead of guessing. The same rules as the turn itself (js/map/engine.js), read from the same
// honest day score (js/schedule.js). Pure.

import { dayScore, doneIndex } from '../schedule.js';
import { timeOff } from '../calendar.js';
import { cardioQuotaId } from '../gym.js';
import { rowHammers, lookups, FINISHED_BONUS, ROAD_MINUTES } from './engine.js';
import { shortWeekday } from '../dates.js';

const values = (o) => Object.values(o ?? {});
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Each row: { id, title, area, track, hammers, state, note }. `state` is earned (ticked), open (still
// to do: a miss if it isn't), optional (a times-a-week habit the week doesn't need today: worth its
// hammers if done, no miss if not), pushed (moved after the lock: left out today, a miss next time),
// missed (moved a second time, or deleted) or released (no longer needed: no miss).
export function dayPoints(doc, day, map = null) {
  const idx = doneIndex(doc);
  const s = dayScore(doc, day, idx, timeOff(doc));
  const L = map ? lookups(map) : null;
  const trackOf = (item) => (L ? L.trackOfArea[item.area] ?? null : null);
  const row = (r, state, note = null) => ({
    id: r.item.id, title: r.item.title, area: r.item.area ?? '', track: trackOf(r.item),
    hammers: state === 'pushed' || state === 'missed' || state === 'released' ? 0 : rowHammers(r), state, note,
  });
  const mealsNote = (r) => (r.kind === 'meals' ? `${r.logged} of ${r.needed} meals logged` : null);
  const rows = [
    ...s.doneRows.map((r) => row(r, 'earned', mealsNote(r))),
    ...s.open.map((r) => row(r, 'open', mealsNote(r))),
    ...s.optional.map((r) => row(r, 'optional', 'Not needed today: worth it if you do it, no miss if not')),
    ...s.pushed.map((e) => row(e, 'pushed', `Moved to ${shortWeekday(e.to)}: left out today, a miss if it moves again`)),
    ...s.missed.map((e) => row(e, 'missed', 'Moved a second time: counts as a miss')),
    ...s.dropped.map((e) => row(e, 'missed', 'Deleted after the lock: counts as a miss')),
    ...s.released.map((e) => row(e, 'released', e.item.released ? `No longer needed: ${e.item.released}` : 'No longer needed')),
  ];
  const earned = rows.filter((r) => r.state === 'earned').reduce((n, r) => n + r.hammers, 0);
  const toEarn = rows.filter((r) => r.state === 'open').reduce((n, r) => n + r.hammers, 0);
  const cardioId = cardioQuotaId(doc);
  const cardio = cardioId ? values(doc.logs).filter((l) => l.status === 'active' && l.kind === 'amount' && l.itemId === cardioId && l.day === day)
    .reduce((n, l) => n + (Number(l.amount) || 0), 0) : 0;
  return {
    day, rows, earned, toEarn, done: s.done, total: s.total,
    // The finished-day bonus: everything counted done, at least three of them.
    bonus: { amount: FINISHED_BONUS, earned: s.total >= 3 && s.done === s.total, possible: s.total >= 3, left: s.total - s.done },
    cardio: { minutes: Math.round(cardio), perStep: ROAD_MINUTES },
  };
}

// The checklist as lines, for Claude's `map` read and catch-up.
export function pointsLines(p) {
  const mark = { earned: '✓', open: '○', optional: '·', pushed: '↷', missed: '✗', released: '–' };
  const out = [`Today's points: +${p.earned} so far${p.toEarn ? `, +${p.toEarn} still to earn` : ''}; ${p.bonus.earned ? `finished: +${p.bonus.amount} bonus` : p.bonus.possible ? `finish all ${p.total} (${p.left} to go) for +${p.bonus.amount}` : `fewer than 3 rows count, so no finished-day bonus`}.`];
  for (const r of p.rows) out.push(`  ${mark[r.state]} ${r.title}${r.hammers ? ` +${r.hammers}` : ''}${r.note ? ` · ${r.note}` : ''}`);
  if (p.cardio.minutes) out.push(`  Cardio ${p.cardio.minutes}m: a road step per ${p.cardio.perStep} minutes.`);
  const open = p.rows.filter((r) => r.state === 'open').length;
  out.push(`  Not counted: weekly targets (Cardio builds roads instead); a goal step earns a wonder card.${open ? ` ${plural(open, 'row')} open: a day with anything left undone sends barbarians.` : ''}`);
  return out;
}
