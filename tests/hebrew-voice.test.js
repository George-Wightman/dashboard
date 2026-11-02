// What the Hebrew widget and pings say (js/hebrew-voice.js), on an invented week.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hebrewLevel, hebrewVoice, duePing, HEBREW_APP } from '../js/hebrew-voice.js';

process.env.TZ = 'Europe/London';

const WED = '2026-09-16';
const at = (day, hhmm) => { const [y, m, d] = day.split('-').map(Number); const [h, mi] = hhmm.split(':').map(Number); return new Date(y, m - 1, d, h, mi); };
const shift = (day, from, to) => ({ title: 'Signify', calendar: 'Work', start: at(day, from).toISOString(), end: at(day, to).toISOString() });
const input = (over = {}) => ({ now: at(WED, '10:00'), today: WED, days: { '2026-09-14': { sec: 1200, sessions: 1 }, '2026-09-15': { sec: 2000, sessions: 2 } }, duolingo: [], busy: [], countdown: null, strongGain: 0, ...over });

test('levels: any session counts, 15 minutes is done, 30 is gold', () => {
  assert.equal(hebrewLevel({ sec: 0, sessions: 0 }), 'none');
  assert.equal(hebrewLevel({ sec: 300, sessions: 1 }), 'bit');
  assert.equal(hebrewLevel({ sec: 900, sessions: 1 }), 'done');
  assert.equal(hebrewLevel({ sec: 1800, sessions: 2 }), 'gold');
  assert.equal(hebrewLevel(undefined), 'none');
});

test('the week: done, gold, today and ahead; the label counts the days that counted', () => {
  const v = hebrewVoice(input());
  assert.deepEqual(v.week, ['done', 'gold', 'today', 'ahead', 'ahead', 'ahead', 'ahead']);
  assert.equal(v.label, '2 of 7 this week');
  assert.equal(v.level, 'none');
  assert.equal(v.night, false);
  assert.equal(v.open, HEBREW_APP);
});

test('morning with nothing booked: the morning line; a shift: it holds, then knows the shift is done', () => {
  const free = hebrewVoice(input());
  assert.ok(['Nothing yet. Loads of day left.', 'Morning. Nothing in yet, and the day is yours.'].includes(free.line), free.line);
  const busy = { busy: [shift(WED, '09:00', '13:00')] };
  assert.match(hebrewVoice(input({ ...busy, now: at(WED, '09:45') })).line, /Signify till 13:00/);
  assert.equal(duePing(input({ ...busy, now: at(WED, '09:45') }), []), null);
  assert.equal(duePing(input({ ...busy, now: at(WED, '13:05') }), []), null, 'waits ten minutes after it ends');
  const p = duePing(input({ ...busy, now: at(WED, '13:12') }), []);
  assert.equal(p.id, `heb:${WED}:morning`);
  assert.match(p.body, /^Shift's done\. You've got time now\./);
  assert.equal(p.title, 'Hebrew');
  assert.equal(p.url, HEBREW_APP);
});

test('each moment pings once, three at most, and none after 21:30', () => {
  assert.equal(duePing(input({ now: at(WED, '09:00') }), []), null);
  assert.equal(duePing(input({ now: at(WED, '09:31') }), []).id, `heb:${WED}:morning`);
  assert.equal(duePing(input({ now: at(WED, '09:41') }), [`heb:${WED}:morning`]), null);
  assert.equal(duePing(input({ now: at(WED, '15:01') }), [`heb:${WED}:morning`]).id, `heb:${WED}:afternoon`);
  assert.equal(duePing(input({ now: at(WED, '19:00') }), ['a', 'b', 'c']), null);
  const late = { busy: [shift(WED, '18:00', '21:25')] };
  assert.equal(duePing(input({ ...late, now: at(WED, '21:36') }), [`heb:${WED}:morning`, `heb:${WED}:afternoon`]), null);
});

test('done or gold: quiet, and says what he did', () => {
  const done = input({ days: { [WED]: { sec: 1000, sessions: 1 } }, now: at(WED, '15:30') });
  assert.equal(duePing(done, []), null);
  assert.equal(hebrewVoice(done).level, 'done');
  assert.match(hebrewVoice(done).aside, /17 minutes/);
  const gold = hebrewVoice(input({ days: { [WED]: { sec: 2400, sessions: 2 } } }));
  assert.equal(gold.level, 'gold');
  assert.equal(gold.line, 'Half an hour. That\'s the good stuff.');
  assert.equal(gold.week[2], 'gold');
});

test('a bit: the gentle ping once, then nothing', () => {
  const bit = input({ days: { [WED]: { sec: 300, sessions: 1 } }, now: at(WED, '15:05') });
  const p = duePing(bit, []);
  assert.equal(p.id, `heb:${WED}:bit`);
  assert.match(p.body, /You did a bit/);
  assert.equal(duePing(bit, [p.id]), null);
  assert.equal(hebrewVoice(bit).week[2], 'bit');
});

test('missed days are named; a Duolingo-only day is its own dot and not a miss', () => {
  const v = hebrewVoice(input({ days: { '2026-09-13': { sec: 1000, sessions: 1 } }, now: at(WED, '19:05') }));
  assert.deepEqual(v.week.slice(0, 3), ['miss', 'miss', 'today']);
  assert.equal(v.missed, 2);
  assert.equal(v.label, '2 days off the road');
  assert.match(v.line, /2 days off the road, mate\. Come on\./);
  assert.equal(v.night, true);
  const duo = hebrewVoice(input({ days: { '2026-09-13': { sec: 1000, sessions: 1 } }, duolingo: ['2026-09-15'] }));
  assert.equal(hebrewVoice(input({ days: {} })).missed, 0, 'nothing before the first record is missed');
  assert.deepEqual(duo.week.slice(0, 2), ['miss', 'duo']);
  assert.equal(duo.missed, 0);
});

test('night by the clock: 19:00 to 07:00', () => {
  assert.equal(hebrewVoice(input({ now: at(WED, '19:00') })).night, true);
  assert.equal(hebrewVoice(input({ now: at(WED, '06:59') })).night, true);
  assert.equal(hebrewVoice(input({ now: at(WED, '07:00') })).night, false);
});

test('the same moment does not say the same line two days running', () => {
  const lines = ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'].map((d) =>
    hebrewVoice(input({ today: d, now: at(d, '15:10'), days: { [d]: { sec: 0, sessions: 0 } } })).line);
  for (let i = 1; i < lines.length; i++) assert.notEqual(lines[i], lines[i - 1]);
});

test('personal touches: a countdown that matters, Duolingo done, words to strong', () => {
  const soon = hebrewVoice(input({ countdown: { title: 'Salzburg', days: 3 } }));
  assert.equal(soon.label, 'Salzburg in 3 days');
  const duo = hebrewVoice(input({ duolingo: [WED], now: at(WED, '19:10') }));
  assert.match(duo.aside, /Duolingo's done/);
  const strong = hebrewVoice(input({ days: { [WED]: { sec: 1000, sessions: 1 } }, strongGain: 4 }));
  assert.match(strong.aside, /4 words to strong this week/);
});
