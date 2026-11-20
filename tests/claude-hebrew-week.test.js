import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { progressKeys, hebrewState, weekInput, checkWeek, schemeProblem, writeHebrewWeek, readHebrewWeek, HEBREW_WEEK_PATH } from '../claude/hebrew-week.js';
import { fixture } from './helpers.js';

process.env.TZ = 'Europe/London';

const FRI = '2026-11-20';

// An invented Hebrew app sync file: three words, two of them practised.
function progressFile() {
  const keys = {
    hvr_library: JSON.stringify({ 'עייף': { tr: 'ayef', en: 'tired (m)' }, 'קפה': { tr: 'kafe', en: 'coffee' }, 'חורף': { tr: 'khoref', en: 'winter' } }),
    hvr_srs: JSON.stringify({ 'עייף': { prod: { n: 6, stab: 30, diff: 3, miss: 0, rn: 3, rmiss: 0 } }, 'חורף': { prod: { n: 3, stab: 2, diff: 7, miss: 2 } } }),
    hvr_level: JSON.stringify({ at: 2 }),
  };
  return JSON.stringify({ app: 'hebrew-reader-gz', enc: 'gzip', body: gzipSync(Buffer.from(JSON.stringify({ keys }))).toString('base64') });
}

const card = (he, tr, en, extra = {}) => ({ he, tr, en, ...extra });
const cards = (n, extra = {}) => Array.from({ length: n }, (_, i) => card(`אני שותה קפה ${'א'.repeat(i + 1)}`, `ani shote kafe ${i}`, `I drink coffee ${i}`, extra));

test('his state from the Hebrew app: level, and each practised word with its band for saying it', () => {
  const state = hebrewState(progressKeys(progressFile()));
  assert.equal(state.level, 2);
  assert.deepEqual(state.words.map((w) => [w.he, w.band]), [['חורף', 'weak'], ['עייף', 'strong']], 'never answered (coffee) is left out');
  assert.throws(() => progressKeys('{"enc":"none"}'), /isn't the Hebrew app's sync file/);
});

test('what Claude reads: the dates, his words by band, his week day by day, and the rules', () => {
  const doc = fixture({ items: [{ id: 't1', type: 'task', title: 'Fix the shelf', date: '2026-11-21' }, { id: 'h1', type: 'habit', title: 'Gym' }] });
  doc.calendar.agenda = { id: 'agenda', status: 'active', busy: [{ title: 'Shift', calendar: 'Work', start: '2026-11-20T12:00:00.000Z', end: '2026-11-20T14:00:00.000Z' }] };
  const lines = weekInput({ doc, today: FRI, state: hebrewState(progressKeys(progressFile())), previous: { week: '2026-11-13', partner: 'Ana', cards: [{ he: 'שלום' }] } }).join('\n');
  assert.match(lines, /^Cards for Fri 20 Nov to Thu 26 Nov \(batch 2026-11-20\)\./);
  assert.match(lines, /The person he is learning for: Ana/);
  assert.match(lines, /His level: 2 of 5/);
  assert.match(lines, /Words he can say \(1\): עייף ayef = tired \(m\)/);
  assert.match(lines, /Words he is learning \(1\): חורף khoref = winter/);
  assert.match(lines, / {2}Fri 20 Nov: Shift 12:00–14:00/);
  assert.match(lines, / {2}Sat 21 Nov: task: Fix the shelf/);
  assert.match(lines, /Habits: Gym/);
  assert.match(lines, /Last batch \(2026-11-13\), not to repeat: שלום/);
  assert.match(lines, /kh for ח and כ/);
});

test('the checks: his transliteration scheme, Hebrew only, no repeats, between 12 and 40, at most 7 to say', () => {
  assert.equal(schemeProblem('ani shote kafe'), null);
  assert.match(schemeProblem('ha-cheder'), /ch/);
  assert.match(schemeProblem('ba-bayit'), /hyphenates/);
  assert.match(schemeProblem('u-ani'), /ve-/);
  const ok = checkWeek({ week: FRI, partner: 'Ana', cards: [...cards(10), card('אני עייף היום', 'ani ayef hayom', "I'm tired today", { say: true, lvl: 1 }),
    card('קר בחוץ', 'kar bakhutz', "It's cold outside", { type: 'listen', gloss: [{ he: 'בחוץ', tr: 'bakhutz', en: 'outside', why: 'b + khutz' }] })] }, { today: FRI });
  assert.equal(ok.cards.length, 12);
  assert.deepEqual(ok.cards[10], { he: 'אני עייף היום', tr: 'ani ayef hayom', en: "I'm tired today", type: 'sentence', lvl: 1, say: true });
  assert.equal(ok.cards[11].gloss[0].he, 'בחוץ');
  assert.equal(ok.partner, 'Ana');
  assert.equal(ok.v, 1);
  assert.throws(() => checkWeek({ cards: cards(11) }, { today: FRI }), /12 to 40 cards/);
  assert.throws(() => checkWeek({ cards: [...cards(11), card('hello', 'x', 'y')] }, { today: FRI }), /card 12: "he" is Hebrew only/);
  assert.throws(() => checkWeek({ cards: [...cards(11), card('החדר', 'ha-cheder', 'the room')] }, { today: FRI }), /card 12 \(ha-cheder\) uses "ch"/);
  assert.throws(() => checkWeek({ cards: [...cards(11), { ...cards(1)[0], he: 'אני שותה קפה א.' }] }, { today: FRI }), /the same sentence twice/);
  assert.throws(() => checkWeek({ cards: cards(12, { say: true }) }, { today: FRI }), /at most 7 cards marked "say"/);
  assert.throws(() => checkWeek({ cards: [...cards(11), card('קר', 'kar', 'cold', { gloss: [{ he: 'א', tr: 'a', en: 'b' }, { he: 'ב', tr: 'b', en: 'c' }] })] }, { today: FRI }), /at most one new word/);
});

test('saved in the private sync repo for the Hebrew app, and read back for the next batch', async () => {
  const written = new Map();
  const files = {
    read: async (path) => (written.has(path) ? { text: written.get(path), sha: 's' } : null),
    write: async (path, text) => { written.set(path, text); return 'sha'; },
  };
  const said = await writeHebrewWeek(files, JSON.stringify({ week: FRI, partner: 'Ana', cards: cards(14).map((c, i) => (i < 4 ? { ...c, say: true } : c)) }), { today: FRI });
  assert.match(said, /^Saved hebrew\/week\.json: 14 cards for the batch of 2026-11-20, 4 to say to Ana\./);
  assert.ok(written.has(HEBREW_WEEK_PATH));
  const back = await readHebrewWeek(files);
  assert.equal(back.cards.length, 14);
  await assert.rejects(writeHebrewWeek(files, '{"cards": []}', { today: FRI }), /12 to 40 cards/);
  assert.equal((await readHebrewWeek(files)).cards.length, 14, 'a bad file never replaces a good one');
});
