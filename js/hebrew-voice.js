// What the Hebrew widget and its pings say (docs/superpowers/specs/2026-11-02-hebrew-nudges-design.md).
// George enjoys Hebrew once he's in it; what fails is the first step, so this is a mate on his home
// screen: light, a bit cheeky, honest about missed days, quiet once he's done. Everything said is
// written here, up front, with slots filled from his data: no AI at send time. Pure — the planner and
// the widget's glance both call it, so they never disagree.

import { addDays, weekStart, daysBetween } from './dates.js';
import { wallClock, deviceZone } from './travel.js';
import { countdowns } from './calendar.js';
import { duolingoOn } from './schedule.js';
import { HEBREW_IDS } from './hebrewSync.js';

export const HEBREW_APP = 'https://george-wightman.github.io/hebrew-reader/hebrew-reader.html';
export const HEBREW_DONE_MIN = 15;
export const HEBREW_GOLD_MIN = 30;
export const MOMENTS = [['morning', '09:30'], ['afternoon', '15:00'], ['evening', '19:00']];
export const LAST_PING = '21:30';
export const HEBREW_PINGS_PER_DAY = 3;
// One line for Claude's planner read from the planner's `hebrew:status`, or null before its first run:
// what went today, or what's wrong (wrong device, reminders off, no token).
export function hebrewPingsLine(doc, when = (iso) => iso) {
  const s = doc?.calendar?.['hebrew:status'];
  if (!s || s.status !== 'active') return null;
  if (s.lastError) return `Hebrew pings: ${s.lastError}`;
  return `Hebrew pings: ${s.sent ?? 0} sent on ${s.day} to ${s.devices} device${s.devices === 1 ? '' : 's'} · last checked ${s.lastRun ? when(s.lastRun) : 'never'}`;
}

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

// The input both callers build: his wall clock (the moments are his times, wherever he is; the planner
// runs on London's), the Hebrew app's own days when the planner could read them, else the dashboard's
// Hebrew minutes, his Duolingo days, the nearest countdown, and today's busy events (shifted with the
// clock, so they still line up with it).
export function hebrewInputFrom({ doc, now, today, progress = null, busy = [] }) {
  const wall = wallClock(now, deviceZone(doc));
  const [y, mo, d] = wall.date.split('-').map(Number);
  const local = new Date(y, mo - 1, d, Math.floor(wall.minutes / 60), wall.minutes % 60, now.getSeconds());
  const shift = local.getTime() - now.getTime();
  const moved = (iso) => new Date(Date.parse(iso) + shift).toISOString();
  let days = progress?.days;
  if (!days) {
    days = {};
    for (const l of Object.values(doc.logs ?? {})) {
      if (l.status !== 'active' || l.kind !== 'amount' || l.itemId !== HEBREW_IDS.minutes) continue;
      const day = days[l.day] ??= { sec: 0, sessions: 0 };
      day.sec += (Number(l.amount) || 0) * 60;
      day.sessions = day.sec > 0 ? 1 : 0;
    }
  }
  const duolingo = [];
  for (let i = 0; i < 21; i++) {
    const day = addDays(today, -i);
    if (duolingoOn(doc, HEBREW_IDS.habit, day) > 0) duolingo.push(day);
  }
  const [countdown = null] = countdowns(doc, today);
  return {
    now: local, shift, today, days, duolingo, strongGain: progress?.strongGain ?? 0,
    words: progress?.words ?? [], liveWeek: progress?.liveWeek ?? 0, level: progress?.level ?? null,
    countdown: countdown ? { title: countdown.title, days: countdown.days } : null,
    busy: busy.filter((e) => e?.start && e?.end).map((e) => ({ ...e, start: moved(e.start), end: moved(e.end) })),
  };
}

// ---- The widget's card -----------------------------------------------------------------------------
// The tall widget shows one card at a time and changes it through the day (George, 3 Nov 2026: "every
// time I look at it, something different", but not every five minutes). Four slots a day, the order
// different each day; a word and a phrase of the day; encouragement while it isn't done (the poster
// when days have been missed); the week's numbers, only ever what he's gained; gold on a 30-minute day.
// Calendar-aware: while he's busy it shows the word or phrase, not a push; when something ends, the
// encouragement comes to the front for an hour. `nextAt` says when the card should change, so the
// widget can ask again then rather than whenever Android wakes it.

const SLOT_STARTS = [11 * 60, 15 * 60, 19 * 60, 23 * 60];
const ROTATION = ['cheer', 'word', 'phrase', 'numbers'];
const dayIndex = (today) => daysBetween('2026-01-01', today);
const fmtMinutes = (m) => (m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : `${m} min`);

// The day's pick from a list: the same all day, a different one tomorrow.
const ofTheDay = (list, today, salt) => (list.length ? list[(dayIndex(today) * 7 + salt) % list.length] : null);

// A word he's learning, so he can recognise it: progressing first (one he nearly has), then weak.
function wordOfTheDay(words, today) {
  const pool = words.filter((w) => w.band === 'progressing');
  return ofTheDay(pool.length >= 5 ? pool : words.filter((w) => w.band === 'progressing' || w.band === 'weak'), today, 0);
}

// His level's phrases first (from the Hebrew app's own course), easier ones if there are none.
function phraseOfTheDay(phrases, level, today) {
  const at = phrases.filter((p) => p.lvl === level);
  return ofTheDay(at.length ? at : phrases.filter((p) => !level || p.lvl <= level), today, 3);
}

// What he's gained this week, never what he's short of. Empty when there's nothing yet.
function weekNumbers(input) {
  const { today, days = {} } = input;
  const monday = weekStart(today);
  let sec = 0;
  let practised = 0;
  let lastSec = 0;
  for (let i = 0; i <= daysBetween(monday, today); i++) {
    const d = addDays(monday, i);
    sec += Number(days[d]?.sec) || 0;
    if (hebrewLevel(days[d]) !== 'none') practised++;
    lastSec += Number(days[addDays(d, -7)]?.sec) || 0;
  }
  const stats = [];
  const minutes = Math.round(sec / 60);
  if (minutes > 0) stats.push({ n: fmtMinutes(minutes), t: 'of Hebrew this week' });
  if (practised > 0) stats.push({ n: String(practised), t: practised === 1 ? 'day practised' : 'days practised' });
  if (input.strongGain > 0) stats.push({ n: `+${input.strongGain}`, t: input.strongGain === 1 ? 'word to strong' : 'words to strong' });
  if (input.liveWeek > 0) stats.push({ n: String(input.liveWeek), t: input.liveWeek === 1 ? 'word said live' : 'words said live' });
  const aside = sec > lastSec && lastSec > 0 ? 'Ahead of where you were last week.' : 'Every session moves a word along.';
  return { stats: stats.slice(0, 3), aside };
}

// `extras.phrases` is the course's phrases ({ he, tr, en, lvl }). Returns the card:
// { kind, label, hebrew, line?, aside?, big?, word?: { he, tr, en }, stats?, nextAt } with nextAt in
// real time (ISO).
export function hebrewCard(input, { phrases = [] } = {}) {
  const v = hebrewVoice(input);
  const { now, today } = input;
  const t = clockOf(now);
  const slot = SLOT_STARTS.findIndex((s) => t < s);
  const word = wordOfTheDay(input.words ?? [], today);
  const phrase = phraseOfTheDay(phrases, input.level, today);
  const numbers = weekNumbers(input);
  const { inside, ended } = busyState(input.busy, now);
  const shift = input.shift ?? 0;
  const real = (ms) => new Date(ms - shift).toISOString();

  // When the card should next change: the next slot, the end of what he's in, or the end of the
  // hour after something ended.
  const nextTimes = [];
  const nextSlot = SLOT_STARTS.find((s) => t < s);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  nextTimes.push(midnight + (nextSlot ?? 24 * 60 + 7 * 60) * 60000);
  if (inside) nextTimes.push(Date.parse(inside.end));
  if (ended) nextTimes.push(Date.parse(ended.end) + FREE_FOR_MIN * 60000);
  const nextAt = real(Math.min(...nextTimes.filter((x) => x > now.getTime())));

  const order = ROTATION.map((_, i) => ROTATION[(i + dayIndex(today)) % ROTATION.length]);
  const pending = v.level === 'none' || v.level === 'bit';
  let pick = order[slot === -1 ? 3 : slot];
  if (pending && v.missed >= 2 && (slot <= 0 || pick === 'cheer')) pick = 'cheer';
  if (pending && ended && !inside) pick = 'cheer';
  if (pending && inside && pick === 'cheer') pick = word ? 'word' : 'phrase';
  const available = (k) => (k === 'word' ? !!word : k === 'phrase' ? !!phrase : k === 'numbers' ? numbers.stats.length > 0 : true);
  if (!available(pick)) pick = order.find(available) ?? 'cheer';

  const base = { label: v.label, hebrew: v.hebrew, nextAt };
  if (pick === 'word') return { ...base, kind: 'word', label: 'Word of the day', hebrew: 'מילה', word: { he: word.he, tr: word.tr, en: word.en } };
  if (pick === 'phrase') {
    const label = input.countdown && input.countdown.days > 0 && input.countdown.days <= 14 ? `${input.countdown.title} in ${input.countdown.days} day${input.countdown.days === 1 ? '' : 's'}` : 'Phrase of the day';
    return { ...base, kind: 'phrase', label, hebrew: 'משפט', word: { he: phrase.he, tr: phrase.tr, en: phrase.en } };
  }
  if (pick === 'numbers') return { ...base, kind: 'numbers', label: 'This week', hebrew: 'השבוע', stats: numbers.stats, aside: numbers.aside };
  // The encouragement: what the voice says, as a poster when days have gone by, gold or done once it's in.
  const minutes = Math.round((Number(input.days?.[today]?.sec) || 0) / 60);
  if (v.level === 'gold') return { ...base, kind: 'gold', big: String(minutes), line: 'minutes. That\'s the good stuff.', aside: v.aside };
  if (v.level === 'done') return { ...base, kind: 'done', line: v.line, aside: v.aside };
  if (v.missed >= 2 && v.level === 'none' && !inside && !ended) {
    return { ...base, kind: 'poster', big: String(v.missed), line: 'days off the road, mate. Come on.', aside: v.aside };
  }
  return { ...base, kind: 'cheer', line: v.line, aside: v.aside };
}
