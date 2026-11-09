// Sending Hebrew's own pings (planner/hebrew-nudges.js), to an invented device.

process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createHebrewNudges } from '../planner/hebrew-nudges.js';
import { makeVapidKeys } from '../planner/webpush.js';

const DAY = '2026-09-16';
const at = (hh, mm = 0) => new Date(2026, 8, 16, hh, mm);
const nodeCrypto = {
  hash: {
    sha256: (u8) => new Uint8Array(crypto.createHash('sha256').update(u8).digest()),
    hmac: (k, d) => new Uint8Array(crypto.createHmac('sha256', k).update(d).digest()),
  },
  randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)),
};
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function device(name) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { id: `hvr:${name}`, endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, p256dh: b64url(ecdh.getPublicKey()), auth: b64url(crypto.randomBytes(16)), label: 'Hebrew app' };
}

function setup({ status = () => 201 } = {}) {
  const map = new Map();
  const props = { get: (k) => map.get(k) ?? null, put: (k, v) => map.set(k, String(v)) };
  const keys = makeVapidKeys(nodeCrypto.randomBytes);
  props.put('VAPID_PRIVATE', keys.privateKey);
  props.put('VAPID_PUBLIC', keys.publicKey);
  const sent = [];
  const UrlFetchApp = { fetchAll: (reqs) => reqs.map((r) => { sent.push(r.url); return { getResponseCode: () => status(r.url) }; }) };
  const send = (now, devices) => createHebrewNudges({ UrlFetchApp, props, crypto: nodeCrypto, t: now })
    .send({ devices, input: { now, today: DAY, days: { '2026-09-14': { sec: 1200, sessions: 1 } }, duolingo: [], busy: [], countdown: null, strongGain: 0 } });
  return { sent, send, props };
}

test('each moment pings every device once; the same minute again sends nothing; three a day at most', () => {
  const s = setup();
  const phone = device('phone');
  assert.deepEqual(s.send(at(9, 31), [phone]), { sent: 1, devices: 1, error: null });
  assert.equal(s.send(at(9, 41), [phone]).sent, 0);
  assert.equal(s.send(at(15, 1), [phone]).sent, 1);
  assert.equal(s.send(at(19, 1), [phone]).sent, 1);
  assert.equal(s.sent.length, 3);
  assert.deepEqual(JSON.parse(s.props.get('HEBREW_NUDGES')).sent, [`heb:${DAY}:morning`, `heb:${DAY}:afternoon`, `heb:${DAY}:evening`]);
});

test('a device that has gone (410) is never tried again', () => {
  const s = setup({ status: (url) => (url.endsWith('/old') ? 410 : 201) });
  const old = device('old');
  const phone = device('phone');
  s.send(at(9, 31), [old, phone]);
  s.send(at(15, 1), [old, phone]);
  assert.deepEqual(s.sent.map((u) => u.split('/').pop()), ['old', 'phone', 'phone']);
});

test('a device that has gone is retired with what the push service said, and named, not passed over', () => {
  const map = new Map();
  const props = { get: (k) => map.get(k) ?? null, put: (k, v) => map.set(k, String(v)) };
  const keys = makeVapidKeys(nodeCrypto.randomBytes);
  props.put('VAPID_PRIVATE', keys.privateKey);
  props.put('VAPID_PUBLIC', keys.publicKey);
  const UrlFetchApp = { fetchAll: (reqs) => reqs.map(() => ({ getResponseCode: () => 410, getContentText: () => 'push subscription has unsubscribed or expired.\n' })) };
  const phone = device('ts4pkg');
  const send = (t) => createHebrewNudges({ UrlFetchApp, props, crypto: nodeCrypto, t })
    .send({ devices: [phone], practising: 'ts4pkg', input: { now: t, today: DAY, days: {}, duolingo: [], busy: [], countdown: null, strongGain: 0 } });
  const first = send(at(9, 31));
  assert.match(first.error, /stopped working on ts4pkg \(HTTP 410: push subscription has unsubscribed or expired\.\)/);
  const retired = JSON.parse(props.get('HEBREW_RETIRED'));
  assert.equal(retired[0].why, 'HTTP 410: push subscription has unsubscribed or expired.');
  // Later runs have nothing live to send to, and say when and why rather than "reminders are off".
  const later = send(at(15, 1));
  assert.equal(later.devices, 0);
  assert.match(later.error, /Reminders on ts4pkg stopped working on 2026-09-16 \(HTTP 410/);
});

test('no devices: nothing sent, and it says reminders are off', () => {
  const s = setup();
  assert.deepEqual(s.send(at(9, 31), []), { sent: 0, devices: 0, error: 'Reminders are off: turn them on in the Hebrew app' });
});

test('reminders on another device than the one he practises on: still sent, but it says so', () => {
  const s = setup();
  const laptop = device('laptop');
  const send = (practising) => createHebrewNudges({ UrlFetchApp: { fetchAll: (reqs) => reqs.map(() => ({ getResponseCode: () => 201 })) }, props: s.props, crypto: nodeCrypto, t: at(9, 31) })
    .send({ devices: [laptop], practising, input: { now: at(9, 31), today: DAY, days: {}, duolingo: [], busy: [], countdown: null, strongGain: 0 } });
  const r = send('phone');
  assert.equal(r.sent, 1);
  assert.match(r.error, /aren't on for the device you last practised on \(phone\).*laptop/);
  s.props.put('HEBREW_NUDGES', 'null');
  assert.equal(send('laptop').error, null);
  s.props.put('HEBREW_NUDGES', 'null');
  assert.equal(send(null).error, null, 'an older sync file with no device says nothing');
});
