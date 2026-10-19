process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { dueNudges, NUDGES_PER_DAY } from '../js/nudges.js';
import { createNudges } from '../planner/nudges.js';
import { makeVapidKeys } from '../planner/webpush.js';
import { checkConfigField, CALENDAR_DEFAULTS, dayRecordId } from '../js/calendar.js';
import { makeStore, clock } from './helpers.js';

const DAY = '2026-10-20';
const at = (hh, mm = 0) => new Date(2026, 9, 20, hh, mm);
const ids = (doc, t) => dueNudges(doc, t, 4).map((n) => n.id);

function withData() {
  const store = makeStore({ now: clock(at(7, 0)) });
  const heb = store.addItem({ id: 'hebrew-minutes', type: 'quota', title: 'Hebrew learning time', unit: 'minutes', target: 420 });
  return { store, heb };
}

test('the back nudge: from 07:30 until 11:00, only while the morning is unanswered', () => {
  const { store } = withData();
  assert.deepEqual(ids(store.doc(), at(7, 20)), []);
  assert.deepEqual(ids(store.doc(), at(7, 30)), [`back:${DAY}`]);
  const [n] = dueNudges(store.doc(), at(8, 0), 4);
  assert.deepEqual([n.title, n.url], ["How's your back?", './?do=back']);
  store.setBack(DAY, 0);
  assert.deepEqual(ids(store.doc(), at(8, 0)), []);
});

test('the lunch nudge: from 14:00 to 17:00 with no lunch logged, and only once he snaps meals', () => {
  const { store } = withData();
  store.setBack(DAY, 0);
  assert.deepEqual(ids(store.doc(), at(14, 10)), [], 'never snapped a meal: no nudge');
  store.addMeal({ at: new Date(2026, 9, 18, 13, 0), text: 'soup' });
  assert.deepEqual(ids(store.doc(), at(14, 10)), [`lunch:${DAY}`]);
  assert.equal(dueNudges(store.doc(), at(14, 10), 4)[0].url, './?do=snap');
  store.addMeal({ at: at(13, 0), text: 'wrap' });
  assert.deepEqual(ids(store.doc(), at(14, 10)), []);
});

test("the Hebrew nudge: at 20:00 if today's minutes are short of a seventh of the week's target", () => {
  const { store, heb } = withData();
  store.setBack(DAY, 0);
  store.logAmount({ itemId: heb.id, amount: 40, day: DAY });
  const [n] = dueNudges(store.doc(), at(20, 5), 4);
  assert.equal(n.id, `hebrew:${DAY}`);
  assert.equal(n.body, 'Hebrew logged so far today: 40 of 60 minutes.');
  assert.equal(n.url, './?do=hebrew');
  store.logAmount({ itemId: heb.id, amount: 20, day: DAY });
  assert.deepEqual(ids(store.doc(), at(20, 5)), []);
});

test("the session nudge: half an hour before a coach's session, saying the routine is in Hevy", () => {
  const { store } = withData();
  store.setBack(DAY, 0);
  const t = store.addItem({ type: 'task', title: 'Gym · Legs A', date: DAY });
  store.setSession(t.id, { name: 'Legs A', exercises: [{ name: 'Squat (Barbell)', tpl: 'SQ', sets: 3, reps: 5, kg: 95 }] });
  store.putCalendar(dayRecordId(DAY), { day: DAY, blocks: [{ key: 'k', start: at(17, 30).toISOString(), end: at(18, 45).toISOString(), items: [t.id], state: 'exact' }] });
  store.putGym('routines', { folderId: 1, byRoutine: { r1: { taskId: t.id, day: DAY, hash: 'h' } } });
  assert.deepEqual(ids(store.doc(), at(16, 50)), []);
  const [n] = dueNudges(store.doc(), at(17, 0), 4);
  assert.deepEqual([n.id, n.title, n.body], [`session:${t.id}:${DAY}`, 'Legs A at 17:30', "The routine's in Hevy, with the weights filled in."]);
  store.toggleDone(t.id, DAY);
  assert.deepEqual(ids(store.doc(), at(17, 0)), []);
});

test('nudges can be turned off as a planner setting, on by default', () => {
  assert.equal(CALENDAR_DEFAULTS.nudges, true);
  assert.equal(checkConfigField('nudges', false), false);
  assert.throws(() => checkConfigField('nudges', 'no'), /true or false/);
  const { store } = withData();
  store.putCalendar('config', { nudges: false });
  assert.deepEqual(ids(store.doc(), at(8, 0)), []);
});

// ---- Sending ---------------------------------------------------------------------------------------

const nodeCrypto = {
  hash: {
    sha256: (u8) => new Uint8Array(crypto.createHash('sha256').update(u8).digest()),
    hmac: (k, d) => new Uint8Array(crypto.createHmac('sha256', k).update(d).digest()),
  },
  randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)),
};
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function sender(store, startAt) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  store.putCalendar('push:phone', { endpoint: 'https://fcm.googleapis.com/fcm/send/phone', p256dh: b64url(ecdh.getPublicKey()), auth: b64url(crypto.randomBytes(16)), label: 'phone' }, 'me');
  const map = new Map();
  const props = { get: (k) => map.get(k) ?? null, put: (k, v) => map.set(k, String(v)) };
  // The planner's push keys, which check-ins make on every run before nudges are sent.
  const keys = makeVapidKeys(nodeCrypto.randomBytes);
  props.put('VAPID_PRIVATE', keys.privateKey);
  props.put('VAPID_PUBLIC', keys.publicKey);
  const sent = [];
  const UrlFetchApp = { fetchAll: (reqs) => reqs.map((r) => { sent.push(r.url); return { getResponseCode: () => 201 }; }) };
  let now = startAt;
  return { sent, setNow: (d) => { now = d; }, nudges: () => createNudges({ UrlFetchApp, props, now: () => now, crypto: nodeCrypto }) };
}

test('each nudge is sent once, at most four a day, never in the quiet hours', () => {
  const { store } = withData();
  const s = sender(store, at(7, 40));
  assert.equal(s.nudges().send(store).sent, 1);
  assert.equal(s.nudges().send(store).sent, 0, 'the same nudge is never sent twice');
  s.setNow(at(23, 0));
  store.putCalendar('config', {});
  assert.equal(s.nudges().send(store).sent, 0);
  assert.equal(NUDGES_PER_DAY, 4);
});

test('a planner run sends a due nudge to the devices, after its other work', async () => {
  const { createPlanner } = await import('../planner/gas.js');
  const { FakeCalendar } = await import('./planner-fakes.js');
  const { FakeRepo, appsScript } = await import('./planner-apps.js');
  const { fixture } = await import('./helpers.js');
  const doc = fixture();
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  doc.calendar['push:phone'] = { id: 'push:phone', status: 'active', endpoint: 'https://fcm.googleapis.com/fcm/send/phone', p256dh: b64url(ecdh.getPublicKey()), auth: b64url(crypto.randomBytes(16)), label: 'phone' };
  const run = appsScript({ cal: new FakeCalendar(), repo: new FakeRepo(doc), props: { GITHUB_TOKEN: 'ghp_dummy_token', SYNC_REPO: 'o/r' }, now: () => at(7, 40) });
  assert.equal(await createPlanner({ ...run, version: 't' }).run(), 'ok');
  assert.equal(run.pushes.length, 1);
  assert.deepEqual(JSON.parse(run.props.get('NUDGES')).sent, [`back:${DAY}`]);
});
