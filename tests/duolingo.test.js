process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncDuolingo, DUOLINGO } from '../planner/duolingo.js';
import { duolingoStatus, duolingoStatusLine } from '../js/duolingo.js';
import { streak, dayScore, rowsForDay, todayRows } from '../js/schedule.js';
import { checkConfigField, readPlannerConfig } from '../js/calendar.js';
import { dueNudges } from '../js/nudges.js';
import { glanceOf } from '../js/glance.js';
import { makeStore, clock, fixture, done, amount } from './helpers.js';

const DAY = '2026-10-21';
const at = (d, hh, mm = 0) => new Date(2026, 9, d, hh, mm);

// Duolingo's public profile, in memory: a Hebrew course and a Spanish one, whose XP the test moves.
class FakeDuolingo {
  constructor() { this.he = 1000; this.es = 500; this.calls = []; this.answer = 200; this.users = null; }
  fetch = async (url) => {
    this.calls.push(url);
    if (this.answer !== 200) return { ok: false, status: this.answer, json: async () => ({}) };
    const users = this.users ?? [{ username: 'Tester', courses: [
      { id: 'DUOLINGO_HE_EN', learningLanguage: 'he', fromLanguage: 'en', xp: this.he },
      { id: 'DUOLINGO_ES_EN', learningLanguage: 'es', fromLanguage: 'en', xp: this.es },
    ] }];
    return { ok: true, status: 200, json: async () => ({ users }) };
  };
}

function setup() {
  const now = clock(at(21, 9));
  const store = makeStore({ now });
  store.addItem({ id: 'hebrew-habit', type: 'habit', title: 'Hebrew practice', area: 'Hebrew', repeat: { kind: 'daily' }, created: '2026-10-01' });
  const duo = new FakeDuolingo();
  const sync = (user = 'Tester') => syncDuolingo({ fetch: duo.fetch, user, store, now });
  const log = (day = DAY) => store.doc().logs[`duolingo:${day}`];
  return { now, store, duo, sync, log };
}

test('the first check only takes a starting point; XP gained after it goes on the day', async () => {
  const { now, store, duo, sync, log } = setup();
  await sync();
  assert.equal(duo.calls[0], `${DUOLINGO}?username=Tester`);
  assert.equal(log(), undefined);
  assert.equal(duolingoStatus(store.doc()).xp, 1000);

  duo.he += 30;
  duo.es += 99; // Spanish never counts
  now.advance(10 * 60000);
  await sync();
  assert.equal(log().amount, 30);
  assert.equal(log().itemId, 'hebrew-habit');
  assert.equal(log().source, 'duolingo');
  assert.equal(log().kind, 'amount');

  duo.he += 15;
  now.advance(10 * 60000);
  await sync();
  assert.equal(log().amount, 45, 'a second lesson the same day adds to the same log');
});

test('the day is the logical day: a lesson at 01:30 counts for the day before', async () => {
  const { now, duo, sync, log } = setup();
  await sync();
  duo.he += 20;
  now.set(at(22, 1, 30));
  await sync();
  assert.equal(log(DAY).amount, 20);
  assert.equal(log('2026-10-22'), undefined);
});

test('a check that finds nothing new writes nothing until the hour is up', async () => {
  const { now, store, sync } = setup();
  await sync();
  const after = JSON.stringify(store.doc());
  now.advance(10 * 60000);
  await sync();
  assert.equal(JSON.stringify(store.doc()), after);
  now.advance(60 * 60000);
  await sync();
  assert.notEqual(JSON.stringify(store.doc()), after);
});

test('a problem is kept as a sentence and the XP isn\'t lost; a new username starts again', async () => {
  const { store, duo, sync, log } = setup();
  await sync();
  duo.answer = 429;
  const s = await sync();
  assert.equal(s.lastError, "Couldn't reach Duolingo (it answered 429)");
  assert.equal(duolingoStatus(store.doc()).xp, 1000);
  assert.match(duolingoStatusLine(store.doc()), /Duolingo \(Tester\): Couldn't reach Duolingo/);
  duo.answer = 200;
  duo.users = [];
  assert.equal((await sync()).lastError, 'Duolingo has no public profile called Tester');
  duo.users = null;
  duo.he = 5000;
  await sync('Other');
  assert.equal(log(), undefined, 'another account\'s XP is not a lesson');
  assert.equal(duolingoStatus(store.doc()).user, 'Other');
});

test('the setting: a username, or empty to stop', () => {
  assert.equal(readPlannerConfig({ calendar: {} }).config.duolingo, '');
  assert.equal(checkConfigField('duolingo', ' GeorgeWMan '), 'GeorgeWMan');
  assert.equal(checkConfigField('duolingo', ''), '');
  assert.throws(() => checkConfigField('duolingo', 'not a name!'), /Duolingo username/);
});

// The day as the dashboard reads it.
const HABIT = { id: 'hebrew-habit', type: 'habit', title: 'Hebrew practice', repeat: { kind: 'daily' }, created: '2026-10-15' };
const duo = (day, xp) => amount(`duolingo:${day}`, 'hebrew-habit', day, xp, { source: 'duolingo' });

test('a Duolingo-only day is weaker: open on the day, but the streak survives it', () => {
  const doc = fixture({ items: [HABIT], logs: [done('hebrew-habit', '2026-10-19'), duo('2026-10-20', 30), done('hebrew-habit', '2026-10-21')] });
  assert.deepEqual(streak(doc, doc.items['hebrew-habit'], '2026-10-21'), { current: 3, best: 3 });
  const score = dayScore(doc, '2026-10-20');
  assert.equal(score.done, 0);
  assert.equal(score.total, 1);
  const [row] = rowsForDay(doc, '2026-10-20');
  assert.equal(row.done, false);
  assert.equal(row.duolingo, 30);
  // With a Reader session too, it's simply done.
  const both = fixture({ items: [HABIT], logs: [duo('2026-10-20', 30), done('hebrew-habit', '2026-10-20')] });
  const [r] = rowsForDay(both, '2026-10-20');
  assert.equal(r.done, true);
  assert.equal(r.duolingo, undefined);
  // And a day with neither is still a miss.
  const gap = fixture({ items: [HABIT], logs: [duo('2026-10-19', 10), done('hebrew-habit', '2026-10-21')] });
  assert.deepEqual(streak(gap, gap.items['hebrew-habit'], '2026-10-21'), { current: 1, best: 1 });
});

test('Duolingo today keeps today in the streak and shows on the row', () => {
  const doc = fixture({ items: [HABIT], logs: [done('hebrew-habit', '2026-10-20'), duo('2026-10-21', 12)] });
  assert.equal(streak(doc, doc.items['hebrew-habit'], '2026-10-21').current, 2);
  const row = todayRows(doc, '2026-10-21').find((r) => r.item.id === 'hebrew-habit');
  assert.equal(row.duolingo, 12);
});

test("the evening Hebrew push still comes, and says Duolingo's XP", () => {
  const store = makeStore({ now: clock(at(20, 7)) });
  store.addItem({ id: 'hebrew-minutes', type: 'quota', title: 'Hebrew learning time', unit: 'minutes', target: 420 });
  store.addItem({ id: 'hebrew-habit', type: 'habit', title: 'Hebrew practice', repeat: { kind: 'daily' } });
  store.setBack('2026-10-20', 0);
  store.putLog('duolingo:2026-10-20', { itemId: 'hebrew-habit', kind: 'amount', amount: 25, day: '2026-10-20', source: 'duolingo' });
  const n = dueNudges(store.doc(), at(20, 20, 5), 4).find((x) => x.id === 'hebrew:2026-10-20');
  assert.equal(n.body, 'Hebrew logged so far today: 0 of 60 minutes. Duolingo: 25 XP.');
});

test('the phone widget marks a Duolingo-only day smaller than Reader minutes', () => {
  const minutes = { id: 'hebrew-minutes', type: 'quota', title: 'Hebrew learning time', unit: 'minutes', target: 420, created: '2026-10-01' };
  const doc = fixture({ items: [HABIT, minutes], logs: [
    amount('m1', 'hebrew-minutes', '2026-10-19', 40), amount('m2', 'hebrew-minutes', '2026-10-20', 10), duo('2026-10-21', 20),
  ] });
  const tile = glanceOf(doc, '2026-10-22', at(22, 9)).tiles.hebrew;
  assert.ok(tile.lines.includes('●◐◔○···  Mon–Sun'), tile.lines.join(' / '));
});

test("the Hebrew tile's week carries each day's Duolingo XP beside its minutes", async () => {
  const { hebrewWeek } = await import('../js/ui/hebrew.js');
  const minutes = { id: 'hebrew-minutes', type: 'quota', title: 'Hebrew learning time', unit: 'minutes', target: 420, created: '2026-10-01' };
  const doc = fixture({ items: [HABIT, minutes], logs: [amount('m1', 'hebrew-minutes', '2026-10-19', 40), duo('2026-10-19', 5), duo('2026-10-20', 20)] });
  const week = hebrewWeek(doc, '2026-10-21');
  assert.deepEqual(week.slice(0, 3).map((c) => [c.minutes, c.xp]), [[40, 5], [0, 20], [0, 0]]);
});
