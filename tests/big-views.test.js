import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prBoard, sessionDays, groupWeeks } from '../js/gym.js';
import { history } from '../js/schedule.js';
import { libraryOf } from '../js/talk.js';
import { ensureHebrewGoal, HEBREW_IDS } from '../js/hebrewSync.js';
import { ladder, nextRung, recentDays } from '../js/ui/hebrew.js';
import { historyWeeks, dayMisses } from '../js/ui/side.js';
import { WIDGETS } from '../js/ui/widgets.js';
import { fixture, makeStore } from './helpers.js';

// makeStore's clock is Thursday 10 September 2026; the week began on Monday the 7th.
const TODAY = '2026-09-10';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// A workout as the gym map keeps it (js/gym.js's workoutRecord makes these from Hevy's).
const lift = (name, kg, reps, n = 3, tpl = '') => ({ name, tpl, kind: 'lift', n, best: [kg, reps], e1rm: Math.round(kg * (1 + reps / 30) * 10) / 10 });
const cardio = (minutes) => ({ name: 'Walking', tpl: 'walk', kind: 'cardio', n: 1, minutes, km: 0 });
function gymDoc(sessions, templates = {}) {
  const doc = fixture();
  doc.gym.templates = { id: 'templates', status: 'active', source: 'hevy', list: templates };
  sessions.forEach(([day, exercises], i) => {
    doc.gym[`w:${i}`] = { id: `w:${i}`, status: 'active', hevyId: `h${i}`, title: 'Session', day, start: `${day}T08:00:00.000Z`, end: `${day}T09:00:00.000Z`, minutes: 60, exercises };
  });
  return doc;
}

test('prBoard: each lift at its best, the ones done most first, never a session from the future', () => {
  const doc = gymDoc([
    ['2025-04-01', [lift('Squat (Barbell)', 80, 5), lift('Curl', 20, 10)]],
    ['2026-09-01', [lift('Squat (Barbell)', 100, 3), lift('Squat (Barbell)', 90, 8)]],
    ['2026-09-08', [lift('Squat (Barbell)', 95, 3), lift('Bench Press (Barbell)', 100, 1), cardio(20)]],
    ['2026-09-12', [lift('Bench Press (Barbell)', 200, 1)]],
  ]);
  const board = prBoard(doc, TODAY);
  assert.deepEqual(board.map((r) => [r.name, r.sessions, r.e1rm, r.best, r.day, r.last]), [
    // the second session's 90 × 8 (114) beats its own 100 × 3 (110): one session, best set of the two
    ['Squat (Barbell)', 3, 114, [90, 8], '2026-09-01', '2026-09-08'],
    ['Bench Press (Barbell)', 1, 103.3, [100, 1], '2026-09-08', '2026-09-08'],
    ['Curl', 1, 26.7, [20, 10], '2025-04-01', '2025-04-01'],
  ]);
  assert.equal(prBoard(doc, TODAY, 1).length, 1);
  assert.deepEqual(prBoard(gymDoc([]), TODAY), []);
});

test('sessionDays: a year of weeks Monday to Sunday, marking lifting and cardio', () => {
  const doc = gymDoc([
    ['2026-09-07', [lift('Squat', 100, 5)]],
    ['2026-09-08', [cardio(25)]],
    ['2026-09-08', [cardio(10)]],
    ['2025-01-01', [lift('Squat', 50, 5)]], // more than a year ago: not in the grid
  ]);
  const days = sessionDays(doc, TODAY);
  assert.equal(days.length, 52 * 7);
  assert.equal(days[0].day, '2025-09-15'); // a Monday, 51 weeks before this one
  assert.equal(days.at(-1).day, '2026-09-13');
  const at = (d) => days.find((x) => x.day === d);
  assert.deepEqual(at('2026-09-07'), { day: '2026-09-07', future: false, sessions: 1, lifted: true, cardio: 0 });
  assert.deepEqual(at('2026-09-08'), { day: '2026-09-08', future: false, sessions: 2, lifted: false, cardio: 35 });
  assert.equal(at('2026-09-11').future, true);
  assert.equal(days.filter((d) => d.sessions).length, 2);
  assert.equal(sessionDays(doc, TODAY, 2).length, 14);
});

test('groupWeeks: working sets per muscle group, week by week', () => {
  const templates = { sq: ['Squat', 'weight_reps', 'quadriceps'], bp: ['Bench', 'weight_reps', 'chest'] };
  const doc = gymDoc([
    ['2026-08-31', [lift('Squat', 100, 5, 4, 'sq')]],
    ['2026-09-07', [lift('Squat', 100, 5, 3, 'sq'), lift('Bench', 80, 5, 5, 'bp')]],
    ['2026-09-09', [lift('Bench', 80, 5, 2, 'bp'), cardio(20)]],
  ], templates);
  const { weeks, groups } = groupWeeks(doc, TODAY, 3);
  assert.deepEqual(weeks, ['2026-08-24', '2026-08-31', '2026-09-07']);
  const of = (name) => groups.find((g) => g.name === name).sets;
  assert.deepEqual(of('Quads'), [0, 4, 3]);
  assert.deepEqual(of('Chest'), [0, 0, 7]);
  assert.deepEqual(of('Back'), [0, 0, 0]);
  assert.equal(groups.length, 8);
});

test('history takes a number of weeks; the big view shows every week since the start, three to fifty-two', () => {
  const store = makeStore();
  assert.equal(history(store.doc(), TODAY).length, 21);
  assert.equal(history(store.doc(), TODAY, 5).length, 35);
  assert.equal(history(store.doc(), TODAY, 5)[0].day, '2026-08-10');
  assert.equal(historyWeeks(store.doc(), TODAY), 3); // nothing yet
  store.addItem({ type: 'task', title: 'First', date: TODAY });
  assert.equal(historyWeeks(store.doc(), TODAY), 3); // this week only: still three
  const doc = store.doc();
  doc.items[Object.keys(doc.items)[0]].created = '2026-07-01';
  assert.equal(historyWeeks(doc, TODAY), 11); // the week of Mon 29 Jun to this one
  doc.items[Object.keys(doc.items)[0]].created = '2024-01-01';
  assert.equal(historyWeeks(doc, TODAY), 52);
});

test("libraryOf: the journal's entries, digests and check-ins, newest first, found by every word", () => {
  const store = makeStore();
  store.saveJournal({ kind: 'entry', day: '2026-09-08', slot: 'evening', feeling: 'tired', text: 'Long day of role plays.', pointers: ['Likes mornings'] });
  store.saveJournal({ kind: 'entry', day: '2026-09-09', slot: 'morning', text: 'Planning Maya’s present with Luli.' });
  store.saveJournal({ kind: 'digest', day: '2026-08-31', summary: 'A steady week.', wins: ['Gym three times'], slipped: [], focus: 'Cardio' });
  store.saveJournal({ kind: 'checkin', day: '2026-08-30', questions: ['How was it?'], answers: ['Role plays went well'], feedback: 'Good.' });
  store.saveJournal({ kind: 'talk', day: '2026-09-09', slot: 'morning', messages: [{ who: 'george', text: 'role plays', at: '2026-09-09T08:00:00.000Z' }] });
  const kinds = (words) => libraryOf(store.doc(), words).map((r) => `${r.kind} ${r.day}`);
  // a digest sits after its week's entries: it is filed under Monday but written at the week's end
  assert.deepEqual(kinds(''), ['entry 2026-09-09', 'entry 2026-09-08', 'digest 2026-08-31', 'checkin 2026-08-30']);
  assert.deepEqual(kinds('role PLAYS'), ['entry 2026-09-08', 'checkin 2026-08-30']);
  assert.deepEqual(kinds('mornings tired'), ['entry 2026-09-08']);
  assert.deepEqual(kinds('gym cardio'), ['digest 2026-08-31']);
  assert.deepEqual(kinds('nowhere'), []);
});

test('ladder: every rung in order, done, next or later, with the counted ones measured', () => {
  const store = makeStore();
  ensureHebrewGoal(store);
  store.updateGoal(HEBREW_IDS.goal, { hebrewNow: { strong: 10, live: 20, gold: 1, days: 5, daily: {} } });
  store.updateMilestone('hebrew-ms-live-1', { auto: { kind: 'live', n: 40 } });
  let rungs = ladder(store.doc());
  assert.equal(rungs.length, 20);
  assert.deepEqual(rungs.slice(0, 3).map((r) => [r.state, r.byHand, r.have, r.n]), [['next', true, null, null], ['later', false, 20, 40], ['later', false, null, null]]);
  store.toggleMilestone('hebrew-ms-talk-hello');
  rungs = ladder(store.doc());
  assert.deepEqual(rungs.slice(0, 2).map((r) => r.state), ['done', 'next']);
  assert.deepEqual(nextRung(store.doc()), { title: rungs[1].title, have: 20, n: 40, byHand: false });
  assert.equal(rungs.filter((r) => r.state === 'next').length, 1);
});

test('recentDays: the last two weeks that saw practice, newest first, with the share right', () => {
  const store = makeStore();
  ensureHebrewGoal(store);
  store.logAmount({ itemId: HEBREW_IDS.minutes, amount: 12, day: '2026-09-09' });
  store.logAmount({ itemId: HEBREW_IDS.minutes, amount: 5, day: '2026-08-20' }); // too long ago
  store.updateGoal(HEBREW_IDS.goal, { hebrewNow: { daily: { '2026-09-09': { spoken: 20, spokenOk: 15 }, '2026-09-01': { spoken: 4, spokenOk: 4 } } } });
  assert.deepEqual(recentDays(store.doc(), TODAY), [
    { day: '2026-09-09', minutes: 12, spoken: 20, right: 75 },
    { day: '2026-09-01', minutes: 0, spoken: 4, right: 100 },
  ]);
});

test('opening big is wired in: the three widgets with a big view, the Coach with its own, the window and the shell', () => {
  const big = WIDGETS.filter((w) => w.big).map((w) => w.id);
  assert.deepEqual(big, ['history', 'hebrew', 'gym']);
  assert.equal(typeof WIDGETS.find((w) => w.id === 'coach').open, 'function');
  assert.match(read('index.html'), /<dialog id="widget-sheet" class="coach-sheet widget-sheet"/);
  assert.match(read('js/app.js'), /paintCoachSheet\(ctx\);\s*paintBig\(ctx\);/);
  assert.match(read('sw.js'), /'js\/ui\/big\.js'/);
  // the heading is the way in, only outside Arrange mode
  assert.match(read('js/ui/widgets.js'), /if \(open && !ctx\.ui\.arranging\) makeOpener\(/);
  // the Coach's window has the journal to switch to
  const coach = read('js/ui/coach.js');
  assert.match(coach, /link\(journal \? 'Conversation' : 'Journal', flip\)/);
  assert.match(coach, /'data-focus': 'journal-search'/);
});

test('dayMisses: a past day\'s misses by name, as its score counts them — a rest-day habit is not one', () => {
  const store = makeStore();
  const DAY = '2026-09-08';
  const walk = store.addItem({ type: 'habit', title: 'Walk', repeat: { kind: 'daily' }, created: '2026-09-01' });
  store.addItem({ type: 'habit', title: 'Gym', repeat: { kind: 'perWeek', n: 2 }, created: '2026-09-01' });
  const cv = store.addItem({ type: 'task', title: 'Update CV', date: DAY, created: '2026-09-01' });
  store.addItem({ type: 'task', title: 'Email Sarah', date: DAY, created: '2026-09-01' });
  store.toggleDone(walk.id, DAY);
  const titles = dayMisses(store.doc(), DAY).map((m) => `${m.title} ${m.how}`);
  assert.deepEqual(titles.sort(), ['Email Sarah missed', 'Update CV missed']);
  store.toggleDone(cv.id, DAY);
  assert.deepEqual(dayMisses(store.doc(), DAY).map((m) => m.title), ['Email Sarah']);
});
