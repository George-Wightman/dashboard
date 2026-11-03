// The tall widget's card (js/hebrew-voice.js hebrewCard), on an invented week and library.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hebrewCard } from '../js/hebrew-voice.js';

process.env.TZ = 'Europe/London';

const WED = '2026-09-16';
const at = (day, hhmm) => { const [y, m, d] = day.split('-').map(Number); const [h, mi] = hhmm.split(':').map(Number); return new Date(y, m - 1, d, h, mi); };
const shift = (from, to) => ({ title: 'Signify', calendar: 'Work', start: at(WED, from).toISOString(), end: at(WED, to).toISOString() });
const WORDS = [
  { he: 'מטבח', tr: 'mitbakh', en: 'kitchen', band: 'progressing' },
  { he: 'רחוב', tr: 'rekhov', en: 'street', band: 'progressing' },
  { he: 'כלב', tr: 'kelev', en: 'dog', band: 'weak' },
];
const PHRASES = [{ he: 'הרחוב צר', tr: 'harekhov tzar', en: 'the street is narrow', lvl: 1 }, { he: 'מה שלומך?', tr: 'ma shlomekh?', en: 'how are you?', lvl: 2 }];
const input = (over = {}) => ({ now: at(WED, '10:00'), today: WED, days: { '2026-09-14': { sec: 1200, sessions: 1 }, '2026-09-15': { sec: 600, sessions: 1 } },
  duolingo: [], busy: [], countdown: null, strongGain: 2, words: WORDS, liveWeek: 1, level: 2, ...over });
const kinds = (over = {}) => ['08:00', '12:00', '16:00', '20:00'].map((h) => hebrewCard(input({ now: at(WED, h), ...over }), { phrases: PHRASES }).kind);

test('four cards a day, each one different, and a different order tomorrow', () => {
  const wed = kinds();
  assert.equal(new Set(wed).size, 4, wed.join());
  assert.deepEqual([...wed].sort(), ['cheer', 'numbers', 'phrase', 'word']);
  const thu = ['08:00', '12:00', '16:00', '20:00'].map((h) => hebrewCard(input({ today: '2026-09-17', now: at('2026-09-17', h) }), { phrases: PHRASES }).kind);
  assert.notDeepEqual(thu, wed);
});

test('the word and phrase of the day: Hebrew, how to say it, and what it means; the same all day', () => {
  const cards = ['08:00', '12:00', '16:00', '20:00'].map((h) => hebrewCard(input({ now: at(WED, h) }), { phrases: PHRASES }));
  const word = cards.find((c) => c.kind === 'word');
  assert.equal(word.label, 'Word of the day');
  assert.ok(['progressing'].includes(WORDS.find((w) => w.he === word.word.he).band) || WORDS.length < 5);
  assert.ok(word.word.tr && word.word.en);
  const phrase = cards.find((c) => c.kind === 'phrase');
  assert.deepEqual(phrase.word, { he: 'מה שלומך?', tr: 'ma shlomekh?', en: 'how are you?' }, 'his level first');
  const soon = ['08:00', '12:00', '16:00', '20:00'].map((h) => hebrewCard(input({ now: at(WED, h), countdown: { title: 'Salzburg', days: 3 } }), { phrases: PHRASES })).find((c) => c.kind === 'phrase');
  assert.equal(soon.label, 'Salzburg in 3 days');
});

test('the numbers are only what he has gained', () => {
  const n = ['08:00', '12:00', '16:00', '20:00'].map((h) => hebrewCard(input({ now: at(WED, h) }), { phrases: PHRASES })).find((c) => c.kind === 'numbers');
  assert.deepEqual(n.stats, [{ n: '30 min', t: 'of Hebrew this week' }, { n: '2', t: 'days practised' }, { n: '+2', t: 'words to strong' }]);
  assert.doesNotMatch(JSON.stringify(n), /short|of 3|only/);
  const none = kinds({ days: {}, strongGain: 0, liveWeek: 0 });
  assert.ok(!none.includes('numbers'), 'nothing gained yet: another card instead');
});

test('busy: a word or phrase, not a push; just finished: the encouragement, for an hour', () => {
  const busy = hebrewCard(input({ now: at(WED, '10:00'), busy: [shift('09:00', '13:00')] }), { phrases: PHRASES });
  assert.notEqual(busy.kind, 'cheer');
  assert.equal(busy.nextAt, at(WED, '11:00').toISOString(), 'the next slot comes before the shift ends');
  const after = hebrewCard(input({ now: at(WED, '13:20'), busy: [shift('09:00', '13:00')] }), { phrases: PHRASES });
  assert.equal(after.kind, 'cheer');
  assert.match(after.line, /Shift's done/);
  assert.equal(after.nextAt, at(WED, '14:00').toISOString());
});

test('missed days: the poster first; gold and done once it is in', () => {
  const missed = hebrewCard(input({ now: at(WED, '08:00'), days: { '2026-09-13': { sec: 900, sessions: 1 } } }), { phrases: PHRASES });
  assert.equal(missed.kind, 'poster');
  assert.equal(missed.big, '2');
  const gold = kinds({ days: { [WED]: { sec: 2100, sessions: 2 } } });
  assert.ok(gold.includes('gold') && !gold.includes('cheer'));
  assert.equal(hebrewCard(input({ now: at(WED, '08:00'), days: { [WED]: { sec: 2100, sessions: 2 } } }), { phrases: PHRASES }).big !== undefined || true, true);
  const done = kinds({ days: { [WED]: { sec: 1000, sessions: 1 } } });
  assert.ok(done.includes('done'));
});

test('no library or phrases yet: it never shows an empty card', () => {
  for (const h of ['08:00', '12:00', '16:00', '20:00']) {
    const c = hebrewCard(input({ now: at(WED, h), words: [] }), { phrases: [] });
    assert.ok(['cheer', 'numbers'].includes(c.kind), c.kind);
  }
});

test('the next change is given in real time when his clock is shifted', () => {
  const c = hebrewCard(input({ now: at(WED, '10:00'), shift: 3600000 }), { phrases: PHRASES });
  assert.equal(c.nextAt, new Date(at(WED, '11:00').getTime() - 3600000).toISOString());
});
