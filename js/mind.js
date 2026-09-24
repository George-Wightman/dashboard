// The Coach's Mind in the synced document (docs/superpowers/specs/2026-09-25-coach-mind-design.md):
// its settings, its status line, Claude's picture of George, the questions George has asked it to
// think about, the devices it may ping, the conversations it opens — and the checks every message it
// sends has to pass first. Pure. Everything lives in the `calendar` map or in ordinary talk records,
// because a new record kind would make a device still on older code reject the whole document.

import { logicalDay, addDays } from './dates.js';
import { timeOff, offCovers, offWindows } from './calendar.js';
import { dayClosed, scheduleBlocks } from './plan-state.js';
import { rowsForDay, doneIndex, dayScore } from './schedule.js';

export const MIND_DEFAULTS = Object.freeze({
  enabled: false,
  morningAt: '07:00',
  checkinAt: '18:00',
  quietFrom: '22:30',
  quietUntil: '07:00',
  pingsPerDay: 6,
  messagesPerDay: 8,
  gapMinutes: 45,
  geminiPerDay: 120,
  deepPerDay: 3,
  models: Object.freeze({ think: 'gemini-flash-latest', check: 'gemini-flash-lite-latest' }),
});

export const MESSAGE_MAX = 600;
export const PICTURE_MAX = 4000;
export const ALIVE_MINUTES = 75;

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const CLOCK_FIELDS = ['morningAt', 'checkinAt', 'quietFrom', 'quietUntil'];
const COUNT_FIELDS = ['pingsPerDay', 'messagesPerDay', 'gapMinutes', 'geminiPerDay', 'deepPerDay'];
const values = (map) => Object.values(map ?? {});
const live = (r) => r && r.status === 'active';
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

// The Mind's settings: the defaults, overlaid with whatever in `mind:config` makes sense.
export function mindConfig(doc) {
  const rec = doc?.calendar?.['mind:config'];
  const out = { ...MIND_DEFAULTS, models: { ...MIND_DEFAULTS.models } };
  if (!live(rec)) return out;
  if (typeof rec.enabled === 'boolean') out.enabled = rec.enabled;
  for (const k of CLOCK_FIELDS) if (typeof rec[k] === 'string' && CLOCK.test(rec[k])) out[k] = rec[k];
  for (const k of COUNT_FIELDS) if (Number.isInteger(rec[k]) && rec[k] >= 0 && rec[k] <= 1000) out[k] = rec[k];
  for (const k of ['think', 'check']) {
    const m = rec.models?.[k];
    if (typeof m === 'string' && /^[\w.-]{3,80}$/.test(m)) out.models[k] = m;
  }
  return out;
}

// A setting as Claude's `mind` op gives it, checked: the value, or a plain-English error.
export function checkMindSetting(field, value) {
  if (field === 'enabled') {
    if (typeof value !== 'boolean') throw new Error('enabled is true or false');
    return value;
  }
  if (CLOCK_FIELDS.includes(field)) {
    if (typeof value !== 'string' || !CLOCK.test(value)) throw new Error(`${field} is a time like "07:00"`);
    return value;
  }
  if (COUNT_FIELDS.includes(field)) {
    if (!Number.isInteger(value) || value < 0 || value > 1000) throw new Error(`${field} is a whole number from 0 to 1000`);
    return value;
  }
  if (field === 'models') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('models is { "think": "…", "check": "…" }');
    const out = {};
    for (const [k, m] of Object.entries(value)) {
      if (!['think', 'check'].includes(k)) throw new Error('models has only think and check');
      if (typeof m !== 'string' || !/^[\w.-]{3,80}$/.test(m)) throw new Error(`models.${k} is a Gemini model name`);
      out[k] = m;
    }
    return out;
  }
  throw new Error(`The Mind has no setting ${JSON.stringify(field)} — it has enabled, ${[...CLOCK_FIELDS, ...COUNT_FIELDS].join(', ')} and models`);
}

export const mindStatus = (doc) => (live(doc?.calendar?.['mind:status']) ? doc.calendar['mind:status'] : null);

export function picture(doc) {
  const rec = doc?.calendar?.['mind:picture'];
  return live(rec) && typeof rec.text === 'string' && rec.text.trim() ? rec : null;
}

// Whether the background is running the Coach: switched on, and heard from recently. While it is,
// the page leaves the openers to it.
export function mindAlive(doc, now) {
  if (!mindConfig(doc).enabled) return false;
  const last = Date.parse(mindStatus(doc)?.lastRun ?? '');
  return Number.isFinite(last) && now.getTime() - last < ALIVE_MINUTES * 60000;
}

// Whether a ping would be unwelcome now: the night, a day he has closed, or time off for everything.
// A message still lands in the Coach; it just doesn't buzz.
export function isQuiet(doc, now, dayStartHour = 4) {
  const config = mindConfig(doc);
  const m = now.getHours() * 60 + now.getMinutes();
  const from = minutesOf(config.quietFrom);
  const until = minutesOf(config.quietUntil);
  if (from > until ? m >= from || m < until : m >= from && m < until) return true;
  const day = logicalDay(now, dayStartHour);
  if (dayClosed(doc, day)) return true;
  const offs = timeOff(doc).filter((o) => !o.areas?.length);
  if (offs.some((o) => offCovers(o, day))) return true;
  const t = now.getTime();
  return offWindows(doc, day, offs).some((w) => w.start <= t && t < w.end);
}

// ---- The conversations it opens -------------------------------------------------------------------

export const MIND_SLOT = /^(mind-\d{1,3}|deep-\d{1,2})$/;
export const isMindTalk = (t) => !!t && t.kind === 'talk' && MIND_SLOT.test(String(t.slot ?? ''));
export const isMindMessage = (m) => !!m && m.from === 'mind';

export function mindTalks(doc, day) {
  return values(doc?.journal).filter((t) => live(t) && isMindTalk(t) && (!day || t.day === day));
}

export function nextMindSlot(doc, day, prefix = 'mind') {
  let n = 1;
  while (doc?.journal?.[`talk:${day}:${prefix}-${n}`]) n++;
  return `${prefix}-${n}`;
}

// Every message the Mind has sent from `fromDay` on, oldest first.
export function mindMessages(doc, fromDay = '0000-00-00') {
  return values(doc?.journal)
    .filter((t) => live(t) && t.kind === 'talk' && t.day >= fromDay)
    .flatMap((t) => (t.messages ?? []).filter(isMindMessage).map((m) => ({ talkId: t.id, day: t.day, slot: t.slot, m })))
    .sort((a, b) => String(a.m.at ?? '').localeCompare(String(b.m.at ?? '')));
}

export const messageKey = (talkId, m) => `${talkId}|${m.at}`;

// ---- Asks and devices -------------------------------------------------------------------------------

export function openAsks(doc) {
  return values(doc?.calendar).filter((r) => live(r) && String(r.id).startsWith('ask:')).sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

export function nextAskId(doc, day) {
  let n = 1;
  while (doc?.calendar?.[`ask:${day}:${n}`]) n++;
  return `ask:${day}:${n}`;
}

export function pushSubscriptions(doc) {
  return values(doc?.calendar).filter((r) => live(r) && String(r.id).startsWith('push:')
    && typeof r.endpoint === 'string' && typeof r.p256dh === 'string' && typeof r.auth === 'string');
}

// ---- The checks ---------------------------------------------------------------------------------------

const DONE_WORDS = /\b(done|ticked|finish(ed|ing)?|complet(ed|ing)|nailed|smashed|got through|wrapped up|knocked (it )?out|crushed)\b/i;
const NOT_YET = /\b(not|n't|yet|still|haven't|hasn't|didn't|if|when|once|before)\b/i;
const MISS_WORDS = /\b(miss(ed|ing)?|skip(ped|ping)?|slipped|didn't|did not|haven't|fail(ed)?)\b/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const TIME = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g;

const norm = (s) => ` ${String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
// Clauses rather than sentences, so "MILLRACE is done — what would you change?" is read as a claim
// followed by a question, not as one question.
const sentences = (text) => String(text).split(/(?<=[.!?])\s+|\s[—–]\s|;\s|\n+/).map((s) => s.trim()).filter(Boolean);
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (h, m) => `${pad(Number(h))}:${pad(Number(m))}`;
const localClock = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? hhmm(d.getHours(), d.getMinutes()) : null; };

// The ways a title shows up in a sentence: the whole title, its first part ("Role play 3" of "Role
// play 3 - MILLRACE, timed"), and any word in capitals ("MILLRACE").
function namesOf(title) {
  const t = String(title ?? '');
  const out = new Set([norm(t)]);
  const first = t.split(/\s[-–+:]\s|,|\(/)[0];
  if (first && norm(first).trim().length >= 5) out.add(norm(first));
  for (const w of t.match(/\b[A-Z]{4,}\b/g) ?? []) out.add(norm(w));
  return [...out].filter((n) => n.trim().length >= 3);
}
const mentions = (sentence, title) => namesOf(title).some((n) => norm(sentence).includes(n));

const words = (s) => new Set(String(s).toLowerCase().match(/[a-z]{3,}/g) ?? []);
function overlap(a, b) {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

// The clock times the plan and George have given today and tomorrow — the only ones a message may use.
function knownTimes(doc, today, georgeToday) {
  const days = new Set([today, addDays(today, 1)]);
  const out = new Set();
  const add = (iso) => { const c = localClock(iso); if (c) out.add(c); };
  const onDays = (iso) => { const d = new Date(iso); return days.has(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`); };
  for (const b of [...scheduleBlocks(doc), ...(doc.calendar?.agenda?.busy ?? [])]) {
    if (b.start && onDays(b.start)) { add(b.start); add(b.end); }
  }
  for (const i of values(doc.items)) if (live(i) && typeof i.time === 'string' && CLOCK.test(i.time)) out.add(i.time);
  for (const t of values(doc.journal)) {
    if (!live(t) || t.kind !== 'talk' || !days.has(t.day)) continue;
    for (const m of t.messages ?? []) if (m.who === 'george') for (const x of m.text.matchAll(TIME)) out.add(hhmm(x[1], x[2]));
  }
  for (const text of georgeToday) for (const x of String(text).matchAll(TIME)) out.add(hhmm(x[1], x[2]));
  return out;
}

// Whether a message the Mind wants to send is true to the record: nothing called done that isn't
// ticked, no clock time the plan or George didn't give, no optional habit called a miss, short, no
// emoji, and not a near-repeat of something it said recently. { ok, problems }.
export function checkMessage(doc, { today, now, text, recent = [], georgeToday = [] }) {
  const problems = [];
  const t = String(text ?? '').trim();
  if (!t) return { ok: false, problems: ['The message is empty'] };
  if (t.length > MESSAGE_MAX) problems.push(`The message is ${t.length} characters; at most ${MESSAGE_MAX}`);
  if (EMOJI.test(t)) problems.push('No emoji');

  const idx = doneIndex(doc);
  const doneToday = new Set(rowsForDay(doc, today, idx).filter((r) => r.done).map((r) => r.item.id));
  const everDone = new Set(values(doc.logs).filter((l) => live(l) && l.kind === 'done').map((l) => l.itemId));
  const notDone = values(doc.items).filter((i) => live(i) && i.type !== 'quota'
    && !(i.type === 'task' ? everDone.has(i.id) : doneToday.has(i.id)));
  for (const s of sentences(t)) {
    if (s.endsWith('?') || !DONE_WORDS.test(s) || NOT_YET.test(s)) continue;
    for (const i of notDone) if (mentions(s, i.title)) problems.push(`Says "${i.title}" is done, but it isn't ticked`);
  }

  const known = knownTimes(doc, today, georgeToday);
  for (const x of t.matchAll(TIME)) {
    const c = hhmm(x[1], x[2]);
    if (!known.has(c)) problems.push(`Mentions ${c}, which isn't a booking, an event or a time George gave`);
  }

  const optional = dayScore(doc, today, idx).optional.map((r) => r.item);
  for (const s of sentences(t)) {
    if (!MISS_WORDS.test(s)) continue;
    for (const i of optional) if (mentions(s, i.title)) problems.push(`"${i.title}" is optional today — a rest day, not a miss`);
  }

  for (const r of recent) if (overlap(t, r) > 0.6) { problems.push('Too close to something the Coach said recently'); break; }
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}
