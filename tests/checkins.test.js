// Check-ins (docs/superpowers/specs/2026-09-26-checkins-design.md): the store's records, which are
// waiting, which blocks count as missed, the summary's prompt and reply, the planner's asking and
// pinging, and Claude's catch-up.
process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeStore, clock, fixture, done } from './helpers.js';
import { recordProblem } from '../js/doc.js';
import {
  checkinId, questionFor, waitingCheckins, checkinsSince, missedTasks, summaryPrompt, parseSummary, SUMMARY_SYSTEM, CHECKIN_STATUS,
} from '../js/checkins.js';
import { createCheckins, isQuiet, pushSubscriptions, PINGS_PER_DAY } from '../planner/checkins.js';
import { READS, CAUGHT_UP } from '../claude/read.js';

const DAY = '2026-09-10'; // a Thursday
const at = (hhmm, day = DAY) => new Date(`${day}T${hhmm}:00`);

function withTask(now = clock(at('09:00'))) {
  const store = makeStore({ now });
  const task = store.addItem({ type: 'task', title: 'Scenario practice', date: DAY });
  const habit = store.addItem({ type: 'habit', title: 'Gym' });
  return { store, task, habit, now };
}

// ---- The store -------------------------------------------------------------------------------------

test('saveJournal writes only the brief now: one per day, overwritten in place, and refuses the rest', () => {
  const { store } = withTask();
  const first = store.saveJournal({ kind: 'brief', day: DAY, text: 'Scenarios first.' }, 'claude');
  assert.equal(first.id, `brief:${DAY}`);
  store.saveJournal({ kind: 'brief', day: DAY, text: 'Scenarios, then rest.' }, 'claude');
  assert.equal(store.doc().journal[`brief:${DAY}`].text, 'Scenarios, then rest.');
  for (const kind of ['checkin', 'digest', 'talk', 'entry', 'guide']) {
    assert.throws(() => store.saveJournal({ kind, day: DAY }), /Unknown journal kind/);
  }
  assert.throws(() => store.saveJournal({ kind: 'brief', day: '10 Sep' }), /real day/);
});

test('a tick asks how it went; the same tick again changes nothing; untick takes the question away', () => {
  const { store, task } = withTask();
  const rec = store.askCheckin({ day: DAY, itemId: task.id, why: 'done' });
  assert.equal(rec.id, checkinId(DAY, task.id));
  assert.equal(rec.id, `reflect:${DAY}:${task.id}`);
  assert.deepEqual([rec.kind, rec.why, rec.title, rec.said, rec.answeredAt, rec.status], ['reflect', 'done', 'Scenario practice', '', null, 'active']);
  assert.equal(store.askCheckin({ day: DAY, itemId: task.id, why: 'done' }), rec);
  assert.deepEqual(waitingCheckins(store.doc(), DAY).map((r) => r.id), [rec.id]);
  store.withdrawCheckin(DAY, task.id);
  assert.equal(store.doc().journal[rec.id].status, 'archived');
  assert.deepEqual(waitingCheckins(store.doc(), DAY), []);
  assert.deepEqual(checkinsSince(store.doc(), DAY), [], 'a withdrawn question is no check-in');
  // Ticked again: asked again. Skipped: not asked again.
  assert.equal(store.askCheckin({ day: DAY, itemId: task.id, why: 'done' }).status, 'active');
  store.skipCheckin(rec.id);
  assert.equal(store.askCheckin({ day: DAY, itemId: task.id, why: 'done' }), null);
});

test("a missed block's question turns into 'how did it go' when he ticks it later; the planner never re-asks", () => {
  const { store, task } = withTask();
  const missed = store.askCheckin({ day: DAY, itemId: task.id, why: 'missed', source: 'planner', onlyNew: true });
  assert.equal(missed.why, 'missed');
  assert.equal(store.askCheckin({ day: DAY, itemId: task.id, why: 'missed', source: 'planner', onlyNew: true }), null);
  const now = store.askCheckin({ day: DAY, itemId: task.id, why: 'done' });
  assert.equal(now.why, 'done');
  assert.equal(Object.values(store.doc().journal).filter((r) => r.kind === 'reflect').length, 1);
  // Untick: that "how did it go" goes, and the planner doesn't bring the old one back.
  store.withdrawCheckin(DAY, task.id);
  assert.equal(store.askCheckin({ day: DAY, itemId: task.id, why: 'missed', source: 'planner', onlyNew: true }), null);
});

test('answering keeps his words at once; a summary joins them; an answered one is never asked again', () => {
  const { store, task, now } = withTask();
  const rec = store.askCheckin({ day: DAY, itemId: task.id, why: 'done' });
  assert.throws(() => store.answerCheckin(rec.id, '   '), /Say or type something first/);
  now.advance(60000);
  store.answerCheckin(rec.id, '  Framework held up. Step 3 was shaky.  ');
  const answered = store.doc().journal[rec.id];
  assert.equal(answered.said, 'Framework held up. Step 3 was shaky.');
  assert.equal(answered.answeredAt, now().toISOString());
  assert.deepEqual(waitingCheckins(store.doc(), DAY), []);
  store.summariseCheckin(rec.id, 'The framework held up; step 3 was shaky.', 'gemini-flash-lite-latest');
  assert.equal(store.doc().journal[rec.id].summary, 'The framework held up; step 3 was shaky.');
  assert.equal(store.askCheckin({ day: DAY, itemId: task.id, why: 'missed', source: 'planner' }), null);
  assert.equal(store.askCheckin({ day: DAY, itemId: task.id, why: 'done' }), null);
});

test('skip dismisses; waiting is only today, oldest first, and only for live tasks', () => {
  const { store, task, now } = withTask();
  const other = store.addItem({ type: 'task', title: 'STAR stories', date: DAY });
  const gone = store.addItem({ type: 'task', title: 'Old one', date: DAY });
  const a = store.askCheckin({ day: DAY, itemId: task.id, why: 'done' });
  now.advance(1000);
  const b = store.askCheckin({ day: DAY, itemId: other.id, why: 'missed' });
  store.askCheckin({ day: DAY, itemId: gone.id, why: 'missed' });
  store.archiveItem(gone.id);
  store.askCheckin({ day: '2026-09-09', itemId: task.id, why: 'missed' });
  assert.deepEqual(waitingCheckins(store.doc(), DAY).map((r) => r.id), [a.id, b.id]);
  store.skipCheckin(a.id);
  assert.deepEqual(waitingCheckins(store.doc(), DAY).map((r) => r.id), [b.id]);
  assert.deepEqual(checkinsSince(store.doc(), DAY).map((r) => r.status).sort(), ['active', 'active', 'dismissed']);
});

test('a check-in record is checked like any other', () => {
  const base = { id: 'reflect:2026-09-10:t1', kind: 'reflect', day: DAY, itemId: 't1', why: 'done', status: 'active' };
  assert.equal(recordProblem('journal', base.id, base), null);
  assert.equal(recordProblem('journal', base.id, { ...base, why: 'maybe' }), 'Invalid check-in');
  assert.equal(recordProblem('journal', base.id, { ...base, itemId: 3 }), 'Invalid check-in');
  assert.equal(recordProblem('journal', base.id, { ...base, answeredAt: 'soon' }), 'Invalid answeredAt');
  assert.equal(recordProblem('journal', base.id, { ...base, said: 4 }), 'Invalid check-in answer');
});

test('the questions', () => {
  assert.equal(questionFor('done', 'Mock interview'), 'How did "Mock interview" go?');
  assert.equal(questionFor('missed', 'Mock interview'), '"Mock interview" isn\'t ticked — what happened?');
});

// ---- Missed blocks -----------------------------------------------------------------------------------

function booked(store, blocks) {
  store.putCalendar(`day:${DAY}`, { day: DAY, blocks, skipped: [], missed: [], notes: [] });
}

test('missedTasks: a task whose block ended half an hour ago unticked — not before, not a habit, not a done one', () => {
  const { store, task, habit } = withTask();
  const other = store.addItem({ type: 'task', title: 'STAR stories', date: DAY });
  const later = store.addItem({ type: 'task', title: 'Evening reading', date: DAY });
  const iso = (hhmm) => at(hhmm).toISOString();
  booked(store, [
    { key: 'a', start: iso('09:00'), end: iso('10:00'), items: [task.id, habit.id] },
    { key: 'b', start: iso('10:00'), end: iso('11:00'), items: [other.id] },
    { key: 'c', start: iso('18:00'), end: iso('19:00'), items: [later.id] },
  ]);
  assert.deepEqual(missedTasks(store.doc(), DAY, at('10:20')), []);
  assert.deepEqual(missedTasks(store.doc(), DAY, at('10:30')).map((m) => m.itemId), [task.id]);
  store.toggleDone(other.id, DAY);
  assert.deepEqual(missedTasks(store.doc(), DAY, at('12:00')).map((m) => m.itemId), [task.id]);
});

// ---- Gemini's tidy-up ----------------------------------------------------------------------------------

test('the summary prompt says what was asked and carries his words; the reply is one clean line', () => {
  const p = summaryPrompt({ why: 'missed', title: 'Mock interview' }, 'ran out of time, the train was late');
  assert.match(p, /"Mock interview" was booked in his calendar and wasn't ticked off/);
  assert.match(p, /What he said:\nran out of time, the train was late$/);
  assert.match(SUMMARY_SYSTEM, /no advice, no praise, no judgement/);
  assert.equal(parseSummary({ summary: '  The train was late.\n\nRan out of time. ' }), 'The train was late. Ran out of time.');
  assert.throws(() => parseSummary({}), /No summary/);
  assert.equal(parseSummary({ summary: 'x'.repeat(900) }).length, 600);
});

// ---- The planner ---------------------------------------------------------------------------------------

const nodeCrypto = {
  hash: {
    sha256: (u8) => new Uint8Array(crypto.createHash('sha256').update(u8).digest()),
    hmac: (k, d) => new Uint8Array(crypto.createHmac('sha256', k).update(d).digest()),
  },
  randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)),
};
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function device(store, id, code = 201) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  store.putCalendar(`push:${id}`, { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: b64url(ecdh.getPublicKey()), auth: b64url(crypto.randomBytes(16)), label: 'phone' }, 'me');
  return code;
}

function planner(store, t, codes = {}) {
  const map = new Map();
  const props = { get: (k) => map.get(k) ?? null, put: (k, v) => map.set(k, String(v)) };
  const sent = [];
  const UrlFetchApp = {
    fetchAll: (reqs) => reqs.map((r) => {
      sent.push(r.url);
      const id = r.url.split('/').pop();
      return { getResponseCode: () => codes[id] ?? 201 };
    }),
  };
  let now = t;
  const make = () => createCheckins({ UrlFetchApp, props, now: () => now, crypto: nodeCrypto });
  return { sent, props, make, setNow: (d) => { now = d; } };
}

test('the planner asks about a missed block once, pings each device, and marks it sent', () => {
  const { store, task } = withTask();
  booked(store, [{ key: 'a', start: at('09:00').toISOString(), end: at('10:00').toISOString(), items: [task.id] }]);
  device(store, 'phone1');
  const p = planner(store, at('10:40'));
  const c = p.make();
  assert.deepEqual(c.ask(store), [checkinId(DAY, task.id)]);
  assert.ok(store.doc().calendar['push-config'].publicKey, 'the devices are given the public key');
  const r = c.ping(store);
  assert.deepEqual(r, { changed: true, sent: 1 });
  assert.equal(p.sent.length, 1);
  assert.ok(store.doc().journal[checkinId(DAY, task.id)].pushedAt);
  assert.equal(store.doc().calendar[CHECKIN_STATUS].pings, 1);
  // The next run: nothing new to ask, nothing to ping.
  const again = p.make();
  assert.deepEqual(again.ask(store), []);
  assert.deepEqual(again.ping(store), { changed: false, sent: 0 });
  assert.equal(p.sent.length, 1);
});

test('no pings in the quiet hours, none past the day cap, and a device that has gone is retired', () => {
  assert.equal(isQuiet(at('22:30')), true);
  assert.equal(isQuiet(at('06:59')), true);
  assert.equal(isQuiet(at('07:00')), false);

  const { store } = withTask(clock(at('09:00')));
  const tasks = Array.from({ length: PINGS_PER_DAY + 2 }, (_, i) => store.addItem({ type: 'task', title: `Task ${i}`, date: DAY }));
  booked(store, tasks.map((t, i) => ({ key: `k${i}`, start: at('09:00').toISOString(), end: at('10:00').toISOString(), items: [t.id] })));
  device(store, 'phone1');
  device(store, 'old');
  const p = planner(store, at('11:00'), { old: 410 });
  const c = p.make();
  c.ask(store);
  const r = c.ping(store);
  assert.equal(r.sent, PINGS_PER_DAY);
  assert.equal(store.doc().calendar['push:old'].status, 'archived');
  assert.deepEqual(pushSubscriptions(store.doc()).map((s) => s.id), ['push:phone1']);
  // Two were left over when the cap was reached: never pinged, still waiting in the app.
  assert.equal(Object.values(store.doc().journal).filter((x) => x.kind === 'reflect' && !x.pushedAt).length, 2);
  assert.equal(waitingCheckins(store.doc(), DAY).length, PINGS_PER_DAY + 2);

  const quiet = withTask(clock(at('09:00')));
  booked(quiet.store, [{ key: 'a', start: at('20:00').toISOString(), end: at('21:00').toISOString(), items: [quiet.task.id] }]);
  device(quiet.store, 'phone1');
  const q = planner(quiet.store, at('23:00'));
  const qc = q.make();
  assert.equal(qc.ask(quiet.store).length, 1);
  assert.deepEqual(qc.ping(quiet.store), { changed: false, sent: 0 });
});

// ---- Claude's catch-up ----------------------------------------------------------------------------------

test('catchup: each day since the last one, what he said, new flags and his calendar edits', () => {
  const TODAY = '2026-09-13';
  const doc = fixture({
    items: [
      { id: 't1', type: 'task', title: 'Mock interview', date: '2026-09-12' },
      { id: 't2', type: 'task', title: 'Scenarios', date: TODAY },
    ],
    logs: [done('t1', '2026-09-12', { at: '2026-09-12T10:30:00.000Z' })],
    journal: [
      { id: 'reflect:2026-09-12:t1', kind: 'reflect', day: '2026-09-12', itemId: 't1', title: 'Mock interview', why: 'done', said: 'went ok, rambled on Q2', summary: 'Went OK; rambled on question 2.', askedAt: '2026-09-12T10:31:00.000Z', answeredAt: '2026-09-12T10:33:00.000Z' },
    ],
    flags: [
      { id: 'f-old', text: 'Old flag', at: '2026-09-10T09:00:00.000Z' },
      { id: 'f-new', text: 'Make the mic bigger', at: '2026-09-12T20:00:00.000Z', kind: 'feature' },
    ],
    changes: [
      { id: 'c1', at: '2026-09-12T18:00:00.000Z', source: 'calendar', summary: 'Imported task edits from Google Calendar',
        edits: [{ map: 'items', id: 't2', before: { title: 'Scenarios', date: '2026-09-12', time: '14:00', status: 'active' }, after: { title: 'Scenarios', date: TODAY, time: '10:00', status: 'active' } }] },
    ],
  });
  doc.calendar[CAUGHT_UP] = { id: CAUGHT_UP, status: 'active', at: '2026-09-12T08:00:00.000Z', source: 'claude' };
  const text = READS.catchup(doc, TODAY, '');
  assert.match(text, /^Catching up since the last catch-up, Sat 12 Sep, 09:00\.$/m);
  assert.match(text, /^ {2}Sat 12 Sep: 1 of 1 done\n {4}ticked: "Mock interview" 11:30$/m);
  assert.match(text, /^ {2}today: 0 of 1 done so far\n {4}still open: "Scenarios" #t2$/m);
  assert.match(text, /^ {4}summary: Went OK; rambled on question 2\.$/m);
  assert.match(text, /^New flags:\n {2}Feature: "Make the mic bigger" #f-new/m);
  assert.doesNotMatch(text, /Old flag/);
  assert.match(text, /^What he changed in Google Calendar \(each task once, oldest first\):\n {2}"Scenarios" #t2: Sat 12 Sep 14:00 → today 10:00 \(Sat 12 Sep, 19:00\)$/m);
  // A fixed look back reads further without a marker.
  assert.match(READS.catchup(doc, TODAY, '3'), /^Catching up on the last 3 days\.$/m);
  delete doc.calendar[CAUGHT_UP];
  assert.match(READS.catchup(doc, TODAY, ''), /^First catch-up: yesterday and today\.$/m);
});
