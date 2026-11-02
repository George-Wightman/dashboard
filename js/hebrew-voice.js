// What the Hebrew widget and its pings say (docs/superpowers/specs/2026-11-02-hebrew-nudges-design.md).
// George enjoys Hebrew once he's in it; what fails is the first step, so this is a mate on his home
// screen: light, a bit cheeky, honest about missed days, quiet once he's done. Everything said is
// written here, up front, with slots filled from his data: no AI at send time. Pure — the planner and
// the widget's glance both call it, so they never disagree.

import { addDays, weekStart, daysBetween } from './dates.js';

export const HEBREW_APP = 'https://george-wightman.github.io/hebrew-reader/hebrew-reader.html';
export const HEBREW_DONE_MIN = 15;
export const HEBREW_GOLD_MIN = 30;
export const MOMENTS = [['morning', '09:30'], ['afternoon', '15:00'], ['evening', '19:00']];
export const LAST_PING = '21:30';
export const HEBREW_PINGS_PER_DAY = 3;
const HOLD_MIN = 10;      // after a busy event ends, before the ping
const FREE_FOR_MIN = 60;  // how long "you're free now" stays the line

const minutesOf = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const clockOf = (d) => d.getHours() * 60 + d.getMinutes();
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// 'none' (no session), 'bit' (some, under 15 min), 'done' (15+), 'gold' (30+).
export function hebrewLevel(day) {
  const sec = Number(day?.sec) || 0;
  if (sec >= HEBREW_GOLD_MIN * 60) return 'gold';
  if (sec >= HEBREW_DONE_MIN * 60) return 'done';
  return sec > 0 || (Number(day?.sessions) || 0) > 0 ? 'bit' : 'none';
}

// [line, aside] pairs. `{n}`, `{k}`, `{m}`, `{title}`, `{end}` are filled in.
const LINES = {
  morning: [['Nothing yet. Loads of day left.', 'Half an hour with your coffee and it\'s done.'],
    ['Morning. Nothing in yet, and the day is yours.', 'Get it in early and forget about it.']],
  afternoon: [['You\'ve got half an hour. I know you have.', 'Do it now, before it\'s 10pm and you can\'t be bothered.'],
    ['Still not done, and it\'s only getting later.', 'Thirty minutes now beats lying about it at ten.'],
    ['Afternoon. This is the window.', 'You always enjoy it once you\'re in.']],
  evening: [['Last call. Ten minutes keeps the road going.', 'You always enjoy it once you\'re in.'],
    ['Evening. This is the bit where you usually bail.', 'Don\'t. Ten minutes, then you\'re done.']],
  missed: [['{n} days off the road, mate. Come on.', 'Ten minutes, just to get started.'],
    ['{n} days off the road, mate. Come on.', 'You enjoy it once you start. So start.']],
  busy: [['{title} till {end}.', 'Hebrew\'s waiting when you\'re out.']],
  shiftFree: [['Shift\'s done. You\'ve got time now.', 'Get it in before the evening takes it.']],
  free: [['{title}\'s done. You\'ve got time now.', 'Get it in before the evening takes it.']],
  bit: [['You did a bit. Fancy a few more?', 'Five more minutes makes it count properly.']],
  done: [['Done. That\'s {k} this week.', '{m} minutes{strong}. Nice.'], ['Well done, that\'s today.', '{m} minutes{strong}. Same again tomorrow.']],
  gold: [['Half an hour. That\'s the good stuff.', '{m} minutes today{strong}.']],
};
const HEBREW = { morning: 'בוקר טוב', afternoon: 'יאללה', evening: 'ערב טוב', missed: 'נו, באמת', busy: 'אחר כך',
  shiftFree: 'עכשיו', free: 'עכשיו', bit: 'עוד קצת', done: 'כל הכבוד', gold: 'מצוין' };

// A different pair each day for the same moment (consecutive days never repeat when there are two).
function pick(set, today) {
  const list = LINES[set];
  return list[((daysBetween('2026-01-01', today) % list.length) + list.length) % list.length];
}
const fill = (text, slots) => text.replace(/\{(\w+)\}/g, (_, k) => String(slots[k] ?? ''));

function momentAt(now) {
  let current = null;
  for (const [name, time] of MOMENTS) if (clockOf(now) >= minutesOf(time)) current = name;
  return current;
}

const isShift = (e) => /work/i.test(e.calendar ?? '') || /signify|shift/i.test(e.title ?? '');

// Today's busy events against `now`: the one he's in, and one that ended in the last hour.
function busyState(busy, now) {
  const t = now.getTime();
  const spans = (busy ?? []).map((e) => ({ ...e, s: Date.parse(e.start), e: Date.parse(e.end) })).filter((e) => e.s < e.e);
  const inside = spans.filter((e) => e.s <= t && t < e.e).sort((a, b) => b.e - a.e)[0] ?? null;
  const ended = spans.filter((e) => e.e <= t && t < e.e + FREE_FOR_MIN * 60000).sort((a, b) => b.e - a.e)[0] ?? null;
  return { inside, ended };
}

// The widget: { level, label, hebrew, line, aside, night, week, missed, open }.
// `today` is the planner's logical day (a 00:30 session belongs to the day before); `days` maps each
// day to the Hebrew app's { sec, sessions }; `duolingo` lists the days with Duolingo XP; `busy` is
// today's busy events.
export function hebrewVoice({ now, today, days = {}, duolingo = [], busy = [], countdown = null, strongGain = 0 }) {
  const level = hebrewLevel(days[today]);
  const duo = new Set(duolingo);
  const stateOf = (d) => {
    const l = hebrewLevel(days[d]);
    if (l !== 'none') return l;
    return duo.has(d) ? 'duo' : 'miss';
  };
  const monday = weekStart(today);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    if (d > today) return 'ahead';
    if (d === today) return level === 'none' ? 'today' : level;
    return stateOf(d);
  });
  // Back to the last day that counted, but never before the first day there's any record of: before
  // he started, nothing was missed.
  const first = [...Object.keys(days), ...duo].sort()[0] ?? today;
  let missed = 0;
  for (let d = addDays(today, -1); d >= first && stateOf(d) === 'miss'; d = addDays(d, -1)) missed++;
  const counted = week.filter((s) => ['bit', 'done', 'gold'].includes(s)).length;
  const minutes = Math.round((Number(days[today]?.sec) || 0) / 60);
  const strong = strongGain > 0 ? `, ${strongGain} word${strongGain === 1 ? '' : 's'} to strong this week` : '';
  const { inside, ended } = busyState(busy, now);

  let set;
  if (level !== 'none') set = level;
  else if (inside) set = 'busy';
  else if (ended) set = isShift(ended) ? 'shiftFree' : 'free';
  else if (missed >= 2) set = 'missed';
  else set = momentAt(now) ?? 'morning';
  let [line, aside] = pick(set, today);
  const slots = { n: missed, k: counted, m: minutes, strong, title: (inside ?? ended)?.title ?? '', end: inside ? hhmm(new Date(inside.e)) : '' };
  line = fill(line, slots);
  aside = fill(aside, slots);
  if (level === 'none' && duo.has(today) && set === 'evening') aside = 'Duolingo\'s done; ten minutes of the real thing?';

  const label = missed >= 2 && level === 'none' ? `${missed} days off the road`
    : countdown && countdown.days > 0 && countdown.days <= 14 ? `${countdown.title} in ${countdown.days} day${countdown.days === 1 ? '' : 's'}`
      : `${counted} of 7 this week`;
  const hour = now.getHours();
  return { level, label, hebrew: HEBREW[set], line, aside, night: hour >= 19 || hour < 7, week, missed, open: HEBREW_APP };
}

// The ping due now, or null. `sent` is today's already-sent ids. One per moment while nothing is
// done, held while he's busy and for ten minutes after; the gentle one once after a bit; none once
// done, after 21:30, before 07:00, or past three.
export function duePing(input, sent = []) {
  const { now, today } = input;
  const v = hebrewVoice(input);
  if (v.level === 'done' || v.level === 'gold') return null;
  const t = clockOf(now);
  if (t < 7 * 60 || t >= minutesOf(LAST_PING) || sent.length >= HEBREW_PINGS_PER_DAY) return null;
  const moment = momentAt(now);
  if (!moment) return null;
  const id = v.level === 'bit' ? `heb:${today}:bit` : `heb:${today}:${moment}`;
  if (sent.includes(id)) return null;
  const { inside, ended } = busyState(input.busy, now);
  if (inside || (ended && now.getTime() < Date.parse(ended.end) + HOLD_MIN * 60000)) return null;
  return { id, title: 'Hebrew', body: `${v.line} ${v.aside}`.slice(0, 140), url: HEBREW_APP };
}
