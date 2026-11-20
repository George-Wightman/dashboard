// "Your own week, in Hebrew" (the Hebrew app's docs/superpowers/specs/2026-11-20-practice-everywhere-
// design.md, Phase 2): once a week Claude writes 20 to 30 practice cards about George's coming week,
// from the words he has. They are personal, so they never go near the Hebrew app's public course
// file: they live in this private sync repo as hebrew/week.json, and the Hebrew app reads them with
// the dashboard's own key (both apps are served from the same address). Here: what Claude reads
// before writing (`hebrew-week --progress <file>`), and the checks before anything is saved
// (`hebrew-week-write <file>`).

import { gunzipSync } from 'node:zlib';
import { addDays, shortWeekday, shortDate } from '../js/dates.js';
import { wordBand } from '../planner/hebrew-progress.js';
import { timeOff, offText } from '../js/calendar.js';

export const HEBREW_WEEK_PATH = 'hebrew/week.json';
export const WEEK_DAYS = 7;
export const CARDS_MIN = 12;
export const CARDS_MAX = 40;
export const SAY_MAX = 7;

// The Hebrew app's STOPLIST (grammar he knows cold, which it never harvests or drills), so the brief
// doesn't read as if he couldn't say "I" or "with".
export const KNOWN_COLD = 'the pronouns (אני, אתה, את, הוא, היא, אנחנו, אתם, הם, הן), their forms with של, ל, את and עם (שלי, לך, אותו, איתה…), של, גם, אז, עם, אבל, מאוד, מה, מי, זה/הזה/הזאת, יש, אין, הרבה, פה, שם, and the joined ה־ ו־ ב־ ל־ מ־ ש־';

const HEBREW = /[֐-׿]/;
const LATIN = /[A-Za-z]/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The Hebrew app's sync file: { enc: 'gzip', body: base64 } around { keys: { name: json } }.
export function progressKeys(text) {
  let outer;
  try { outer = JSON.parse(text); } catch { throw new Error("That progress file isn't JSON"); }
  if (outer?.enc !== 'gzip' || typeof outer.body !== 'string') throw new Error("That isn't the Hebrew app's sync file");
  const inner = JSON.parse(gunzipSync(Buffer.from(outer.body, 'base64')).toString('utf8'));
  return inner?.keys ?? {};
}

const parsed = (keys, name, empty) => {
  try {
    const v = JSON.parse(keys?.[name] ?? 'null');
    return v ?? empty;
  } catch { return empty; }
};

// What he knows, as the Hebrew app has it: his level (1–5) and each word he has met, with its band for
// saying it ('strong', 'progressing', 'weak'; never-answered words are left out).
export function hebrewState(keys) {
  const library = parsed(keys, 'hvr_library', {});
  const srs = parsed(keys, 'hvr_srs', {});
  const level = Number(parsed(keys, 'hvr_level', {})?.at) || 1;
  const words = [];
  for (const [he, w] of Object.entries(library)) {
    if (!w || typeof w !== 'object' || !w.tr || !w.en || he.length > 24) continue;
    const band = wordBand(srs[he]?.prod);
    if (band !== 'new') words.push({ he, tr: String(w.tr), en: String(w.en), band });
  }
  words.sort((a, b) => (a.he < b.he ? -1 : a.he > b.he ? 1 : 0));
  return { level: Math.min(5, Math.max(1, Math.round(level))), words };
}

const clock = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const dayOfIso = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// His next seven days as the dashboard knows them: the calendar's own events (shifts, trips), his
// tasks, his habits, and time off. Titles only, which is what a sentence needs.
export function weekDays(doc, from) {
  const busy = doc?.calendar?.agenda?.busy ?? [];
  const items = Object.values(doc?.items ?? {}).filter((i) => i.status === 'active');
  const out = [];
  for (let n = 0; n < WEEK_DAYS; n++) {
    const day = addDays(from, n);
    const parts = [];
    for (const e of busy) {
      if (!e?.start || dayOfIso(e.start) !== day) continue;
      parts.push(e.allDay ? `${e.title} (all day)` : `${e.title} ${clock(e.start)}–${clock(e.end)}`);
    }
    for (const t of items.filter((i) => i.type === 'task' && i.date === day)) parts.push(`task: ${t.title}`);
    out.push({ day, parts });
  }
  const habits = items.filter((i) => i.type === 'habit').map((h) => h.title);
  const off = timeOff(doc).filter((o) => o.end.slice(0, 10) >= from && o.start.slice(0, 10) <= addDays(from, WEEK_DAYS - 1)).map(offText);
  return { days: out, habits, off };
}

// What Claude reads before writing the week's cards, in lines.
export function weekInput({ doc, today, state, previous = null }) {
  const from = today;
  const to = addDays(from, WEEK_DAYS - 1);
  const strong = state.words.filter((w) => w.band === 'strong');
  const progressing = state.words.filter((w) => w.band === 'progressing');
  const learning = state.words.filter((w) => w.band === 'weak');
  const list = (ws, none) => ws.map((w) => `${w.he} ${w.tr} = ${w.en}`).join(' · ') || none;
  const { days, habits, off } = weekDays(doc, from);
  const out = [
    `Cards for ${shortWeekday(from)} ${shortDate(from)} to ${shortWeekday(to)} ${shortDate(to)} (batch ${from}).`,
    previous?.partner ? `The person he is learning for: ${previous.partner} (keep "partner" in the file).` : 'No partner name on file yet: set "partner" if you know it.',
    `His level: ${state.level} of 5. Write mostly at ${state.level}, a few at ${Math.min(5, state.level + 1)}.`,
    `Strong words, solid enough to hold up a new one (${strong.length}): ${list(strong, 'none yet')}`,
    `Progressing words, he can say them (${progressing.length}): ${list(progressing, 'none')}`,
    `Words he is learning, still weak (${learning.length}): ${list(learning, 'none')}`,
    'His week:',
    ...days.map((d) => `  ${shortWeekday(d.day)} ${shortDate(d.day)}: ${d.parts.join(' · ') || 'nothing booked'}`),
    `Habits: ${habits.join(', ') || 'none'}`,
    ...(off.length ? [`Time off: ${off.join(' · ')}`] : []),
  ];
  if (previous?.cards?.length) out.push(`Last batch (${previous.week}), not to repeat: ${previous.cards.map((c) => c.he).join(' · ')}`);
  out.push(
    '',
    'Write 20 to 30 cards about this week, things he would actually say or hear: his plans, his day, what he is cooking, training, travelling, the people in it.',
    // The Hebrew app's own gate (bankServable): a card it would hold back is a card he never sees this week.
    'Most cards: only strong and progressing words, and the grammar below. The app serves those at once.',
    'Some cards may carry ONE learning word or ONE new word, never two, and then every other word in that card must be STRONG: the app holds back a card that leans a weak word on half-learned ones, and serves it only on a day that word comes up for practice.',
    'A new word is glossed, and waits in his Pending list for his OK before its card is served, so keep new words to a handful. Forms of his words (עייפה, רוצה) are usually fine; when unsure the app knows a form (חזקה), gloss it, because a word it cannot place that no gloss explains drops the card.',
    `Grammar he knows cold, never listed above and never glossed: ${KNOWN_COLD}.`,
    'Nothing she should not hear: these cards show on his phone and the say ones are spoken to her, so no presents, surprises or plans kept from her, and nothing about health or money.',
    `Mark ${SAY_MAX - 3} to ${SAY_MAX} cards "say": true: short things to say to his partner this week, in his own voice (first person, everyday).`,
    'Transliteration, his scheme: kh for ח and כ (never ch); the article and one-letter prepositions join the word (harekhov, bakheder, la\'avoda), with an apostrophe before a vowel (ha\'ir); the conjunction ו is ve- as spoken (ve\'ani). Natural Hebrew a person would say, not a translation of English.',
    'Save with hebrew-week-write <file>, the file being:',
    '{"week": "<batch day>", "partner": "<name>", "cards": [{"he": "…", "tr": "…", "en": "…", "type": "sentence" | "listen", "lvl": 1-5, "say": true?, "gloss": [{"he": "…", "tr": "…", "en": "…", "why": "…"}]?}]}',
  );
  return out;
}

const fail = (msg) => { throw new Error(`hebrew-week-write: ${msg}`); };

// A transliteration that breaks his scheme, in words, or null.
export function schemeProblem(tr) {
  if (/(^|[^t])ch/i.test(tr)) return 'uses "ch" (his scheme writes kh for ח and כ)';
  if (/\b(ha|ba|la|le|be|ve|mi|me|she|ke)-[a-z]/i.test(tr)) return 'hyphenates the article or a preposition (they join the word)';
  if (/(^|\s)u-/i.test(tr)) return 'writes the conjunction as u- (he says ve-)';
  return null;
}

// The file Claude wrote, checked and tidied into what hebrew/week.json holds. Throws on anything wrong,
// naming the card, so nothing half-right reaches his phone.
export function checkWeek(json, { today }) {
  let data;
  try { data = typeof json === 'string' ? JSON.parse(json) : json; } catch { fail('the file is not JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('the file is an object: {"week", "partner", "cards"}');
  const week = data.week ?? today;
  if (!DAY.test(week)) fail('"week" is the batch day, YYYY-MM-DD');
  const partner = data.partner == null ? '' : String(data.partner).trim();
  if (partner.length > 30) fail('"partner" is a first name');
  const cards = Array.isArray(data.cards) ? data.cards : fail('"cards" is a list');
  if (cards.length < CARDS_MIN || cards.length > CARDS_MAX) fail(`${CARDS_MIN} to ${CARDS_MAX} cards, not ${cards.length}`);
  const seen = new Set();
  const out = cards.map((c, i) => {
    const where = `card ${i + 1}`;
    const he = String(c?.he ?? '').trim();
    const tr = String(c?.tr ?? '').trim();
    const en = String(c?.en ?? '').trim();
    if (!he || !HEBREW.test(he) || LATIN.test(he)) fail(`${where}: "he" is Hebrew only`);
    if (he.length > 80) fail(`${where}: keep it under 80 characters`);
    if (!tr || HEBREW.test(tr)) fail(`${where}: "tr" is the transliteration in Latin letters`);
    const bad = schemeProblem(tr);
    if (bad) fail(`${where} (${tr}) ${bad}`);
    if (!en) fail(`${where}: "en" is the English`);
    const key = he.replace(/[.,!?״"'־-]/g, '').replace(/\s+/g, ' ');
    if (seen.has(key)) fail(`${where}: the same sentence twice`);
    seen.add(key);
    const type = c.type == null ? 'sentence' : c.type;
    if (!['sentence', 'listen'].includes(type)) fail(`${where}: "type" is sentence or listen`);
    const lvl = c.lvl == null ? null : Number(c.lvl);
    if (lvl != null && !(Number.isInteger(lvl) && lvl >= 1 && lvl <= 5)) fail(`${where}: "lvl" is 1 to 5`);
    let gloss = [];
    if (c.gloss != null) {
      if (!Array.isArray(c.gloss) || c.gloss.length > 1) fail(`${where}: "gloss" is a list of at most one new word`);
      gloss = c.gloss.map((g) => {
        const gh = String(g?.he ?? '').trim();
        const gt = String(g?.tr ?? '').trim();
        const ge = String(g?.en ?? '').trim();
        if (!gh || !HEBREW.test(gh) || !gt || !ge) fail(`${where}: a gloss is {"he", "tr", "en", "why"?}`);
        const gb = schemeProblem(gt);
        if (gb) fail(`${where}: the gloss's transliteration ${gb}`);
        return { he: gh, tr: gt, en: ge, ...(g.why ? { why: String(g.why).slice(0, 200) } : {}) };
      });
    }
    return { he, tr, en, type, ...(lvl ? { lvl } : {}), ...(c.say === true ? { say: true } : {}), ...(gloss.length ? { gloss } : {}) };
  });
  const says = out.filter((c) => c.say).length;
  if (says > SAY_MAX) fail(`at most ${SAY_MAX} cards marked "say", not ${says}`);
  return { v: 1, week, partner, written: new Date().toISOString(), cards: out };
}

export async function readHebrewWeek(files) {
  const f = await files.read(HEBREW_WEEK_PATH);
  if (!f) return null;
  try { return JSON.parse(f.text); } catch { return null; }
}

export async function writeHebrewWeek(files, text, { today }) {
  const doc = checkWeek(text, { today });
  await files.write(HEBREW_WEEK_PATH, `${JSON.stringify(doc)}\n`, 'hebrew: week');
  const says = doc.cards.filter((c) => c.say).length;
  return `Saved ${HEBREW_WEEK_PATH}: ${doc.cards.length} cards for the batch of ${doc.week}, ${says} to say to ${doc.partner || 'his partner'}. The Hebrew app picks them up within three hours of being opened.`;
}
