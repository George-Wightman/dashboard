// The `usage` read: how the dashboard is really being used, for a review. Two halves. The app's own
// counts (js/usage.js): opens, minutes, tiles opened big, taps, errors, sync times, per device. And
// what the records themselves show: whether check-ins get answered, when ticks happen and who makes
// them, how late meals are logged, the morning question, and what the synced file is made of.
// Counts and rates only; pure.

import { addDays } from '../js/dates.js';
import { usageLines } from '../js/usage.js';

// Every Daylight tile with a big view, so the ones never opened can be named.
export const BIG_TILES = ['review', 'body', 'fuel', 'hebrew', 'weeks', 'eu', 'money', 'london', 'map'];

const active = (map) => Object.values(map ?? {}).filter((r) => r?.status === 'active');
const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : 'none');
const count = (list, key) => list.reduce((m, x) => { const k = key(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});

export function behaviourLines(doc, today, days = 14, { zone = 'Europe/London' } = {}) {
  const since = addDays(today, -(days - 1));
  const inRange = (d) => typeof d === 'string' && d >= since && d <= today;
  const out = [];
  const hourOf = (iso) => {
    try { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hour12: false }).format(new Date(iso))) % 24; } catch { return new Date(iso).getUTCHours(); }
  };

  // Ticks: who made them, and when his own happened.
  const ticks = active(doc.logs).filter((l) => l.kind === 'done' && inRange(l.day));
  const by = count(ticks, (l) => l.source ?? 'me');
  const mine = ticks.filter((l) => (l.source ?? 'me') === 'me' && l.at);
  const stamps = mine.map((l) => Date.parse(l.at)).sort((a, b) => a - b);
  const together = stamps.filter((t, i) => i > 0 && t - stamps[i - 1] < 120000).length;
  const evening = mine.filter((l) => hourOf(l.at) >= 20 || hourOf(l.at) < 4).length;
  out.push(`Ticks: ${ticks.length} (${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k === 'me' ? 'by hand' : k} ${n}`).join(' · ') || 'none'})`);
  if (mine.length) out.push(`  by hand: ${evening} of ${mine.length} after 20:00 · ${together} within two minutes of another (ticked in a batch)`);

  // Check-ins: asked against answered in words.
  const asked = Object.values(doc.journal ?? {}).filter((j) => j?.kind === 'reflect' && inRange(j.day));
  const answered = asked.filter((j) => j.status === 'active' && j.said);
  const skipped = asked.filter((j) => j.status === 'dismissed' || (j.answeredAt && !j.said));
  const why = (w) => { const a = asked.filter((j) => j.why === w); return `${a.filter((j) => j.status === 'active' && j.said).length} of ${a.length}`; };
  out.push(`Check-ins: ${asked.length} asked · ${answered.length} answered (${pct(answered.length, asked.length)}) · ${skipped.length} skipped · ${asked.length - answered.length - skipped.length} left unanswered`);
  if (asked.length) out.push(`  after a tick: ${why('done')} answered · after a missed block: ${why('missed')} answered`);

  // Meals: how many days, how late, photos, usual meals.
  const meals = active(doc.meals).filter((m) => m.kind === 'meal' && inRange(m.day));
  const mealDays = new Set(meals.map((m) => m.day)).size;
  const lag = meals.map((m) => (Date.parse(m._sync?.fields?.id ?? m.updated) - Date.parse(m.at)) / 3600000).filter(Number.isFinite);
  const late = lag.filter((h) => h > 12).length;
  const usuals = active(doc.meals).filter((m) => m.kind === 'usual');
  out.push(`Meals: ${meals.length} on ${mealDays} of ${days} days · ${late} logged more than 12 h after eating · ${meals.filter((m) => m.photo || m.photoState).length} with a photo · ${meals.filter((m) => m.usualId || m.usual).length} from a usual meal · ${meals.filter((m) => m.state && m.state !== 'estimated' && m.state !== 'exact').length} still waiting for an estimate`);
  if (usuals.length) out.push(`  usual meals saved: ${usuals.length}, used ${usuals.reduce((a, u) => a + (u.uses ?? 0), 0)} times in all`);

  // The morning back question.
  const backs = active(doc.gym).filter((g) => g.kind === 'back' && inRange(g.day));
  out.push(`Morning back question: answered on ${backs.length} of ${days} days`);

  // Flags he wrote, and what's sitting open.
  const flags = Object.values(doc.flags ?? {});
  const his = flags.filter((f) => f.source === 'me' && inRange((f.at ?? f.created ?? '').slice(0, 10)));
  const open = flags.filter((f) => f.status === 'active');
  out.push(`Flags: ${his.length} written by him · ${open.length} open (${Object.entries(count(open, (f) => f.source ?? 'me')).map(([k, n]) => `${k} ${n}`).join(' · ') || 'none'})`);

  // His calendar as an input, and Claude.
  const changes = Object.values(doc.changes ?? {}).filter((c) => inRange((c.at ?? '').slice(0, 10)));
  const cal = changes.filter((c) => c.source === 'calendar').length;
  const claudeDays = new Set(changes.filter((c) => c.source === 'claude').map((c) => c.at.slice(0, 10))).size;
  out.push(`Google Calendar edits imported: ${cal} · Claude changed things on ${claudeDays} of ${days} days (${changes.filter((c) => c.source === 'claude').length} changes)`);

  // Features with nothing in them.
  const empty = ['rules', 'outcomes', 'reviews', 'workflowRuns'].filter((m) => !Object.keys(doc[m] ?? {}).length);
  if (empty.length) out.push(`Never used (no records): ${empty.join(', ')}`);
  return out;
}

// What the synced file is made of, biggest first.
export function sizeLines(doc) {
  const size = (v) => JSON.stringify(v ?? {}).length;
  const total = size(doc);
  const maps = Object.keys(doc).filter((k) => doc[k] && typeof doc[k] === 'object')
    .map((k) => [k, size(doc[k]), Object.keys(doc[k]).length]).sort((a, b) => b[1] - a[1]);
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  return [`The synced file: ${kb(total)} · ${maps.slice(0, 6).map(([k, n, c]) => `${k} ${kb(n)} (${c})`).join(' · ')}`];
}

export function usageRead(doc, today, arg, { zone } = {}) {
  const n = Number.parseInt(String(arg ?? '').trim(), 10);
  const days = Number.isInteger(n) && n > 0 ? Math.min(n, 90) : 14;
  return [
    `The last ${days} days.`,
    '',
    'The app (counted on each device):',
    ...usageLines(doc, today, days, BIG_TILES).map((l) => `  ${l}`),
    '',
    'What the records show:',
    ...behaviourLines(doc, today, days, { zone }).map((l) => `  ${l}`),
    '',
    ...sizeLines(doc),
    '',
    'Use it to say what is used, what is ignored and what is breaking. A feature nobody touches is a candidate to simplify or remove; say so plainly.',
  ].join('\n');
}
