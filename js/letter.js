// THE SUNDAY LETTER. George plans through Claude and Google Calendar, and the week-in-review tile
// was never opened. So on Sunday evening a Claude routine (his subscription, like the stocks one;
// the desktop task "sunday-letter") writes the week: what got done and what didn't, by name, his
// Hebrew, money against the forecast, the map, and a proposed plan for next week. It arrives as one
// notification (the planner, planner/letter.js) and one page (js/ui/letter.js), and he answers in a
// chat: the page's button opens Claude with the letter, where "yes" or a change is applied as any
// other plan is. Nothing in the letter changes the dashboard by itself.
//
// Kept in the PRIVATE sync repo as letters/letters.json, the last eight, newest first. Pure: shared
// by the CLI (`letter`, `letter-write`), the planner and the app.

export const LETTERS_PATH = 'letters/letters.json';
export const LETTERS_KEY = 'dash_letters';
export const LETTERS_KEPT = 8;
// How long after it's written a letter is news: the push, and the review tile's button.
export const LETTER_FRESH_DAYS = 3;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LIMITS = { title: 120, head: 60, text: 1600, parts: 8, plan: 14, line: 220 };

export const replyUrl = (id) => `https://claude.ai/new?q=${encodeURIComponent(`/dashboard Read my Sunday letter (letter ${id}) and go through the plan it proposes with me.`)}`;

const str = (v) => typeof v === 'string';
function validLetter(l) {
  return !!l && DAY.test(l.id ?? '') && str(l.written) && str(l.title) && l.title.length <= LIMITS.title
    && Array.isArray(l.parts) && l.parts.length >= 1 && l.parts.length <= LIMITS.parts
    && l.parts.every((p) => p && str(p.head) && str(p.text) && p.head.length <= LIMITS.head && p.text.length <= LIMITS.text)
    && Array.isArray(l.plan) && l.plan.length <= LIMITS.plan && l.plan.every((x) => str(x) && x.length <= LIMITS.line);
}
export function validLetters(doc) {
  return !!doc && doc.v === 1 && Array.isArray(doc.letters) && doc.letters.length <= LETTERS_KEPT && doc.letters.every(validLetter);
}

const fail = (msg) => { throw new Error(`letter-write: ${msg}`); };
const tidy = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// The routine's file, checked and tidied into a letter. Throws on anything wrong, by name, so a
// half-right letter never reaches his phone.
export function checkLetter(json, { today, now = new Date() }) {
  let d;
  try { d = typeof json === 'string' ? JSON.parse(json) : json; } catch { fail('the file is not JSON'); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) fail('the file is an object: {"week", "title", "parts", "plan"}');
  const id = d.week ?? today;
  if (!DAY.test(id)) fail('"week" is the letter\'s day, YYYY-MM-DD');
  const title = tidy(d.title);
  if (!title || title.length > LIMITS.title) fail(`"title" is one line, under ${LIMITS.title} characters: it is the notification`);
  if (!Array.isArray(d.parts) || !d.parts.length || d.parts.length > LIMITS.parts) fail(`"parts" is a list of 1 to ${LIMITS.parts} {"head", "text"}`);
  const parts = d.parts.map((p, i) => {
    const head = tidy(p?.head), text = tidy(p?.text);
    if (!head || head.length > LIMITS.head) fail(`part ${i + 1}: "head" is a short heading`);
    if (!text || text.length > LIMITS.text) fail(`part ${i + 1}: "text" is 1 to ${LIMITS.text} characters`);
    return { head, text };
  });
  const plan = (d.plan ?? []);
  if (!Array.isArray(plan) || plan.length > LIMITS.plan) fail(`"plan" is a list of at most ${LIMITS.plan} lines`);
  const lines = plan.map((x, i) => {
    const t = tidy(x);
    if (!t || t.length > LIMITS.line || t.includes('\n')) fail(`plan line ${i + 1} is one line under ${LIMITS.line} characters`);
    return t;
  });
  return { id, written: now.toISOString(), title, parts, plan: lines };
}

// The file with a new letter in: one per week day, newest first, the last LETTERS_KEPT.
export function addLetter(file, letter) {
  const others = (validLetters(file) ? file.letters : []).filter((l) => l.id !== letter.id);
  return { v: 1, letters: [letter, ...others].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).slice(0, LETTERS_KEPT) };
}

export function latestLetter(file) {
  return validLetters(file) && file.letters.length ? file.letters[0] : null;
}

// Whether a letter is still news on `today`: written within the last LETTER_FRESH_DAYS days.
export function letterFresh(letter, today) {
  if (!letter || !DAY.test(today ?? '')) return false;
  const written = String(letter.written).slice(0, 10);
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${written}T00:00:00Z`);
  return Number.isFinite(ms) && ms >= 0 && ms < LETTER_FRESH_DAYS * 86400000;
}

// The chat read: the latest letter as text.
export function letterLines(file) {
  const l = latestLetter(file);
  if (!l) return ['No Sunday letter yet: the Sunday routine writes one with `letter-write`.'];
  return [
    `Letter ${l.id} (written ${l.written.slice(0, 16).replace('T', ' ')} UTC): ${l.title}`,
    ...l.parts.flatMap((p) => ['', `## ${p.head}`, p.text]),
    ...(l.plan.length ? ['', '## Proposed for next week (not applied: he says yes or changes it here)', ...l.plan.map((x) => `- ${x}`)] : []),
  ];
}
