// The Sunday letter (js/letter.js, planner/letter.js), on an invented week.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLetter, addLetter, latestLetter, letterFresh, letterLines, validLetters, replyUrl, LETTERS_KEPT, LETTERS_PATH } from '../js/letter.js';
import { createLetterPush } from '../planner/letter.js';

const SUN = '2026-11-22';
const NOW = new Date('2026-11-22T18:40:00Z');
const draft = (over = {}) => ({
  week: SUN, title: '19 of 24 done; the shelf slipped twice; Hebrew on 5 days',
  parts: [{ head: 'What got done', text: 'Gym five times.\n\nThe shelf, missed Tuesday and Thursday.' }, { head: 'Hebrew', text: 'Five days, 2:10 in all.' }],
  plan: ['Mon: the shelf, first thing', 'Wed: Hebrew 30 min before the gym'], ...over,
});

test('checkLetter: the routine\'s file tidied, or refused by name', () => {
  const l = checkLetter(JSON.stringify(draft({ title: '  19 of 24 done  ' })), { today: SUN, now: NOW });
  assert.deepEqual([l.id, l.written, l.title, l.parts.length, l.plan.length], [SUN, NOW.toISOString(), '19 of 24 done', 2, 2]);
  assert.equal(l.parts[0].text, 'Gym five times.\n\nThe shelf, missed Tuesday and Thursday.');
  assert.equal(checkLetter(draft({ week: undefined }), { today: '2026-11-23', now: NOW }).id, '2026-11-23', 'no week: today');
  assert.throws(() => checkLetter('nope', { today: SUN }), /not JSON/);
  assert.throws(() => checkLetter(draft({ title: '' }), { today: SUN }), /"title" is one line/);
  assert.throws(() => checkLetter(draft({ parts: [] }), { today: SUN }), /"parts" is a list/);
  assert.throws(() => checkLetter(draft({ parts: [{ head: 'x', text: '' }] }), { today: SUN }), /part 1: "text"/);
  assert.throws(() => checkLetter(draft({ plan: ['two\nlines'] }), { today: SUN }), /plan line 1/);
  assert.throws(() => checkLetter(draft({ week: '22 Nov' }), { today: SUN }), /"week" is the letter's day/);
});

test('the file keeps the last eight, newest first, one a day', () => {
  let file = null;
  for (let i = 0; i < 10; i++) {
    const day = `2026-09-${String(10 + i).padStart(2, '0')}`;
    file = addLetter(file, checkLetter(draft({ week: day }), { today: day, now: NOW }));
  }
  assert.ok(validLetters(file));
  assert.equal(file.letters.length, LETTERS_KEPT);
  assert.equal(latestLetter(file).id, '2026-09-19');
  const again = addLetter(file, checkLetter(draft({ week: '2026-09-19', title: 'rewritten' }), { today: SUN, now: NOW }));
  assert.equal(again.letters.filter((l) => l.id === '2026-09-19').length, 1, 'written twice, kept once');
  assert.equal(latestLetter(again).title, 'rewritten');
  assert.equal(latestLetter(null), null);
  assert.equal(validLetters({ v: 1, letters: [{ id: 'x' }] }), false);
});

test('news for three days, and the chat read says the plan is not applied', () => {
  const l = checkLetter(draft(), { today: SUN, now: NOW });
  assert.deepEqual(['2026-11-22', '2026-11-24', '2026-11-25', '2026-11-21'].map((d) => letterFresh(l, d)), [true, true, false, false]);
  const text = letterLines({ v: 1, letters: [l] }).join('\n');
  assert.match(text, /^Letter 2026-11-22 \(written 2026-11-22 18:40 UTC\): 19 of 24 done/);
  assert.match(text, /## Hebrew\nFive days/);
  assert.match(text, /not applied: he says yes or changes it here\)\n- Mon: the shelf, first thing/);
  assert.match(letterLines(null)[0], /No Sunday letter yet/);
  assert.match(decodeURIComponent(replyUrl(SUN)), /\/dashboard Read my Sunday letter \(letter 2026-11-22\)/);
});

test('the planner sends a new letter once, opening the dashboard on it, and looks at most every 20 minutes', () => {
  const file = { v: 1, letters: [checkLetter(draft(), { today: SUN, now: NOW })] };
  const store = new Map([['SYNC_REPO', 'me/sync'], ['GITHUB_TOKEN', 'T']]);
  const props = { get: (k) => store.get(k) ?? null, put: (k, v) => store.set(k, v) };
  const seen = [];
  const sent = [];
  const request = (url, init) => { seen.push({ url, init }); return { status: 200, text: JSON.stringify(file) }; };
  let t = NOW.getTime();
  const push = () => createLetterPush({ request, props, send: (m) => { sent.push(m); return true; }, now: () => new Date(t), today: SUN }).run();
  assert.equal(push(), 'letter 2026-11-22 sent');
  assert.deepEqual(sent, [{ title: 'Your week', body: '19 of 24 done; the shelf slipped twice; Hebrew on 5 days', url: './?big=letter', tag: 'letter:2026-11-22' }]);
  assert.match(seen[0].url, new RegExp(`/repos/me/sync/contents/${LETTERS_PATH}$`));
  t += 5 * 60000;
  assert.equal(push(), null, 'five minutes later: not even a look');
  assert.equal(seen.length, 1);
  t += 30 * 60000;
  assert.equal(push(), null, 'a look, but it was sent');
  assert.equal(seen.length, 2);
  assert.equal(sent.length, 1);
  const stale = createLetterPush({ request, props: { get: () => null, put: () => {} }, send: (m) => { sent.push(m); return true; }, now: () => new Date(t), today: '2026-11-30' }).run();
  assert.equal(stale, null, 'a week-old letter is not news');
  const none = createLetterPush({ request: () => ({ status: 404, text: '' }), props: { get: () => null, put: () => {} }, send: () => true, now: () => new Date(t), today: SUN }).run();
  assert.equal(none, null);
  assert.throws(() => createLetterPush({ request: () => ({ status: 500, text: '' }), props: { get: () => null, put: () => {} }, send: () => true, now: () => new Date(t), today: SUN }).run(), /GitHub 500/);
});
