// The Hebrew panel: George's Hebrew in one place, from the Hebrew app's sync (js/hebrewSync.js).
// The week as seven cells, shaded by minutes practised; this week's three targets as numbers, with
// how much of what he said aloud was right; the words the app is teaching him, by how well he
// holds them; the next rung of the ladder towards the 10-minute conversation; and the words he
// has most recently said live. Nothing until the Hebrew goal exists. Opened big (renderHebrewBig)
// it adds the whole ladder — the conversations ticked right there — and the last two weeks day by day.

import { h } from './dom.js';
import { weekTotal, streak, milestonesOf, duolingoOn } from '../schedule.js';
import { addDays, weekStart, shortWeekday, shortDate } from '../dates.js';
import { formatAmount } from '../parse.js';
import { HEBREW_IDS, RECENT_DAYS } from '../hebrewSync.js';
import { bigSection } from './big.js';

const active = (doc, id) => (doc.items[id]?.status === 'active' ? doc.items[id] : null);

// Minutes practised on a day: the Hebrew app's own log for it.
function minutesOn(doc, day) {
  return Object.values(doc.logs)
    .filter((l) => l.status === 'active' && l.itemId === HEBREW_IDS.minutes && l.kind === 'amount' && l.day === day)
    .reduce((m, l) => m + l.amount, 0);
}

// How dark a day's cell is: nothing, a few minutes, a proper session, a long one.
export const shade = (minutes) => (minutes <= 0 ? 0 : minutes < 5 ? 1 : minutes < 15 ? 2 : minutes < 30 ? 3 : 4);

// This week, Monday to Sunday: minutes each day, whether it's today or still to come.
export function hebrewWeek(doc, today) {
  const monday = weekStart(today);
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(monday, i);
    const future = day > today;
    return { day, minutes: future ? 0 : minutesOn(doc, day), xp: future ? 0 : duolingoOn(doc, HEBREW_IDS.habit, day), today: day === today, future };
  });
}

// Of the reps he said aloud this week, the share the app marked right; null before any.
export function weekAccuracy(now, today) {
  const monday = weekStart(today);
  let spoken = 0;
  let ok = 0;
  for (const [day, s] of Object.entries(now?.daily ?? {})) {
    if (day < monday || day > today) continue;
    spoken += s.spoken ?? 0;
    ok += s.spokenOk ?? 0;
  }
  return spoken ? Math.round((ok / spoken) * 100) : null;
}

// The first rung not yet reached, and — for one the app counts — how far along it is.
export function nextRung(doc) {
  const r = ladder(doc).find((x) => x.state === 'next');
  return r ? { title: r.title, have: r.have, n: r.n, byHand: r.byHand } : null;
}

// Every rung of the ladder, in order, for the big view: done, the next, or still to come; with
// how far along a counted one is.
export function ladder(doc) {
  const now = doc.goals[HEBREW_IDS.goal]?.hebrewNow;
  let next = true;
  return milestonesOf(doc, HEBREW_IDS.goal).filter((m) => m.status === 'active').map((m) => {
    const { kind, n } = m.auto ?? {};
    const have = kind && n > 0 && Number.isFinite(now?.[kind]) ? now[kind] : null;
    const state = m.done ? 'done' : next ? 'next' : 'later';
    if (!m.done) next = false;
    return { id: m.id, title: m.title, state, byHand: !m.auto, have, n: have == null ? null : n };
  });
}

function weekCells(doc, today) {
  return h('div', { class: 'heb-week' }, hebrewWeek(doc, today).map((c) => {
    const duo = !c.minutes && c.xp > 0;
    const what = c.future ? 'to come' : c.minutes ? `${formatAmount(c.minutes, 'minutes')} practised` : duo ? `Duolingo only, ${c.xp} XP` : 'no practice';
    const label = `${shortWeekday(c.day)}: ${what}`;
    return h('div', { class: c.today ? 'heb-day today' : 'heb-day', title: label, 'aria-label': label, role: 'img' },
      h('span', { class: 'dow' }, shortWeekday(c.day)[0]),
      h('span', { class: c.future ? 'heb-cell future' : duo ? 'heb-cell duo' : `heb-cell lvl${shade(c.minutes)}` }));
  }));
}

// One of this week's targets as a number against its target, gold once met.
function stat(doc, id, label, today, extra = null) {
  const q = active(doc, id);
  if (!q) return null;
  const total = weekTotal(doc, id, today);
  const met = total >= q.target;
  const shown = q.unit === 'minutes' ? Math.round(total) : formatAmount(total, q.unit);
  const target = q.unit === 'minutes' ? Math.round(q.target) : formatAmount(q.target, q.unit);
  return h('div', { class: 'heb-stat', 'data-target': id, title: `${q.title}: ${shown} of ${target}${q.unit === 'minutes' ? ' minutes' : ''} this week` },
    h('span', { class: 'muted' }, label),
    h('span', { class: met ? 'heb-num met' : 'heb-num' }, String(shown), h('span', { class: 'of' }, ` / ${target}`)),
    extra ? h('span', { class: 'heb-extra' }, extra) : null);
}

const BANDS = [['strong', 'strong'], ['progressing', 'progressing'], ['weak', 'weak'], ['new', 'new']];

function bands(now) {
  const b = now?.bands;
  const total = b ? BANDS.reduce((n, [k]) => n + (b[k] ?? 0), 0) : 0;
  if (!total) return null;
  const said = BANDS.map(([k, name]) => `${b[k] ?? 0} ${name}`).join(', ');
  return h('div', { class: 'heb-bands' },
    h('div', { class: 'muted' }, 'Words the app is teaching you'),
    h('div', { class: 'heb-band-bar', role: 'img', 'aria-label': `Words: ${said}` },
      BANDS.map(([k]) => (b[k] ? h('span', { class: `band ${k}`, style: `flex:${b[k]}` }) : null))),
    h('div', { class: 'heb-band-key' }, BANDS.map(([k, name]) => h('span', {}, h('i', { class: `band ${k}` }), `${name} ${b[k] ?? 0}`))));
}

function rung(doc) {
  const r = nextRung(doc);
  if (!r) return null;
  const pct = r.have == null ? null : Math.min(100, Math.round((r.have / r.n) * 100));
  return h('div', { class: 'heb-rung' },
    h('div', { class: 'bar-label' },
      h('span', {}, h('span', { class: 'muted' }, 'Next: '), r.title),
      r.have != null ? h('span', { class: 'muted' }, `${r.have} / ${r.n}`) : r.byHand ? h('span', { class: 'muted', title: 'Tick it in Goals once it has happened' }, 'yours to tick') : null),
    pct != null ? h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': r.title },
      h('span', { style: `width:${pct}%` })) : null);
}

function recentWords(now) {
  const words = (now?.recent ?? []).map((r) => r.word).filter(Boolean);
  if (!words.length) return null;
  return h('div', { class: 'heb-words' },
    h('span', { class: 'muted' }, 'Said live lately'),
    h('span', { class: 'heb-said', lang: 'he', dir: 'rtl' }, words.join(' · ')));
}

// Strong words now, how many more than a week ago (null with no week before to compare), and words
// said live this week: progress, not just time spent.
export function hebrewGrowth(now) {
  if (!now) return null;
  const weeks = now.strongWeeks ?? [];
  const before = weeks.at(-2);
  return { strong: now.strong ?? 0, gained: before == null ? null : (now.strong ?? 0) - before, liveWeek: now.liveWeek ?? 0 };
}

function growthLine(now) {
  const g = hebrewGrowth(now);
  if (!g || (!g.strong && !g.liveWeek)) return null;
  const parts = [`${g.strong} strong words${g.gained ? ` (${g.gained > 0 ? '+' : ''}${g.gained} this week)` : ''}`, `${g.liveWeek} said live this week`];
  return h('p', { class: 'heb-growth' }, parts.join(' · '));
}

// The last 8 weeks of strong words, as bars, for the big view.
function strongTrend(now) {
  const weeks = (now?.strongWeeks ?? []).filter((n) => n != null);
  if (weeks.length < 2) return null;
  const top = Math.max(...weeks, 1);
  return h('div', { class: 'heb-trend', role: 'img', 'aria-label': `Strong words over the last ${weeks.length} weeks: ${weeks.join(', ')}` },
    weeks.map((n) => h('span', { class: 'heb-trend-bar', style: `height:${Math.max(4, Math.round((n / top) * 100))}%`, title: `${n} strong` })));
}

export function renderHebrew(ctx) {
  const doc = ctx.store.doc();
  const goal = doc.goals[HEBREW_IDS.goal];
  if (!goal || goal.status !== 'active') return null;
  const today = ctx.store.today();
  const now = goal.hebrewNow ?? null;
  const habit = active(doc, HEBREW_IDS.habit);
  const s = habit ? streak(doc, habit, today) : null;
  const accuracy = weekAccuracy(now, today);
  const stats = [
    stat(doc, HEBREW_IDS.minutes, 'Minutes', today),
    stat(doc, HEBREW_IDS.spoken, 'Spoken', today, accuracy == null ? null : `${accuracy}% right`),
    stat(doc, HEBREW_IDS.live, 'Said live', today),
  ].filter(Boolean);
  return h('section', { class: 'panel hebrew' },
    h('h2', {}, 'Hebrew', s && s.current > 1 ? h('span', { class: 'streak', title: `Best: ${s.best}` }, `${s.current}-day streak`) : null),
    weekCells(doc, today),
    stats.length ? h('div', { class: 'heb-stats' }, stats) : null,
    growthLine(now),
    bands(now),
    rung(doc),
    recentWords(now));
}

// ---- Opened big ----------------------------------------------------------------------------------

// The last RECENT_DAYS days that saw practice, newest first: minutes, reps said aloud and the share
// right. Minutes are the app's logs; the reps come from the summary each sync keeps.
export function recentDays(doc, today) {
  const daily = doc.goals[HEBREW_IDS.goal]?.hebrewNow?.daily ?? {};
  return Array.from({ length: RECENT_DAYS }, (_, i) => addDays(today, -i))
    .map((day) => {
      const s = daily[day] ?? {};
      const spoken = s.spoken ?? 0;
      return { day, minutes: minutesOn(doc, day), spoken, right: spoken ? Math.round(((s.spokenOk ?? 0) / spoken) * 100) : null };
    })
    .filter((d) => d.minutes > 0 || d.spoken > 0);
}

const MARK = { done: '✓', next: '→', later: '·' };

function ladderList(ctx) {
  const rungs = ladder(ctx.store.doc());
  if (!rungs.length) return null;
  return h('ol', { class: 'heb-ladder' }, rungs.map((r) => {
    const pct = r.state === 'next' && r.have != null ? Math.min(100, Math.round((r.have / r.n) * 100)) : null;
    // A conversation is his to tick, here as in Goals; a counted rung ticks itself.
    const mark = r.byHand
      ? h('input', { type: 'checkbox', checked: r.state === 'done', 'aria-label': r.title, onchange: () => ctx.store.toggleMilestone(r.id) })
      : h('span', { class: 'rung-mark', 'aria-hidden': 'true' }, MARK[r.state]);
    return h('li', { class: `rung ${r.state}` },
      mark,
      h('span', { class: 'rung-title' }, r.title,
        pct != null ? h('span', { class: 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': r.title },
          h('span', { style: `width:${pct}%` })) : null),
      h('span', { class: 'muted rung-count' }, r.state !== 'done' && r.have != null ? `${r.have} / ${r.n}` : ''));
  }));
}

function daysTable(doc, today) {
  const days = recentDays(doc, today);
  if (!days.length) return h('p', { class: 'muted' }, 'No practice in the last two weeks.');
  return h('table', { class: 'big-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Day'), h('th', { class: 'num' }, 'Minutes'), h('th', { class: 'num' }, 'Spoken'), h('th', { class: 'num' }, 'Right'))),
    h('tbody', {}, days.map((d) => h('tr', {},
      h('td', {}, `${shortWeekday(d.day)} ${shortDate(d.day)}`),
      h('td', { class: 'num' }, d.minutes ? formatAmount(d.minutes, 'minutes') : '·'),
      h('td', { class: 'num' }, d.spoken ? String(d.spoken) : '·'),
      h('td', { class: 'num' }, d.right == null ? '·' : `${d.right}%`)))));
}

export function renderHebrewBig(ctx) {
  const base = renderHebrew(ctx);
  if (!base) return null;
  base.querySelector('h2')?.remove();
  return h('div', { class: 'big hebrew' },
    bigSection('This week', base),
    strongTrend(ctx.store.doc().goals[HEBREW_IDS.goal]?.hebrewNow) ? bigSection('Strong words, the last 8 weeks', strongTrend(ctx.store.doc().goals[HEBREW_IDS.goal]?.hebrewNow)) : null,
    bigSection('The ladder to a 10-minute conversation', ladderList(ctx)),
    bigSection('The last two weeks', daysTable(ctx.store.doc(), ctx.store.today())));
}
