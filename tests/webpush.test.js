// Web Push: encrypting a notification for a phone (RFC 8291) and signing for it (RFC 8292), checked
// against the RFC's own worked example and a decryptor built from node:crypto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  b64url, fromB64url, hkdf, encryptPayload, vapidAuthorization, pushRequest, makeVapidKeys,
} from '../planner/webpush.js';
import { bytesToBig } from '../planner/p256.js';

const hash = {
  sha256: (u8) => new Uint8Array(crypto.createHash('sha256').update(u8).digest()),
  hmac: (key, data) => new Uint8Array(crypto.createHmac('sha256', key).update(data).digest()),
};
const randomBytes = (n) => new Uint8Array(crypto.randomBytes(n));
const text = (u8) => Buffer.from(u8).toString('utf8');

// A phone, as far as push goes: its key pair and auth secret.
function phone() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc:def', p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth) } };
}

// What the phone's browser does with the body.
function decrypt(body, { ecdh, auth }) {
  const buf = Buffer.from(body);
  const salt = buf.subarray(0, 16);
  assert.equal(buf.readUInt32BE(16), 4096);
  const idlen = buf[20];
  const keyid = buf.subarray(21, 21 + idlen);
  const ct = buf.subarray(21 + idlen);
  const secret = ecdh.computeSecret(keyid);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), keyid]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(-16));
  const pt = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
  let end = pt.length - 1;
  while (pt[end] === 0) end--;
  assert.equal(pt[end], 2, 'the last record ends with the 0x02 delimiter');
  return pt.subarray(0, end);
}

test('base64url, both ways', () => {
  for (const n of [0, 1, 2, 3, 16, 65]) {
    const b = randomBytes(n);
    assert.equal(b64url(b), Buffer.from(b).toString('base64url'));
    assert.deepEqual(fromB64url(b64url(b)), b);
  }
  assert.deepEqual(fromB64url('BTBZ MqHH6r4Tts7J_aSIgg=='), new Uint8Array(Buffer.from('BTBZMqHH6r4Tts7J_aSIgg', 'base64url')));
});

test('HKDF matches Node', () => {
  for (const len of [12, 16, 32]) {
    const salt = randomBytes(16);
    const ikm = randomBytes(32);
    const info = randomBytes(40);
    assert.deepEqual(hkdf(hash, salt, ikm, info, len), new Uint8Array(crypto.hkdfSync('sha256', ikm, salt, info, len)));
  }
});

test("RFC 8291's worked example, byte for byte", () => {
  const body = encryptPayload({
    hash, randomBytes,
    payload: new TextEncoder().encode('When I grow up, I want to be a watermelon'),
    uaPublic: fromB64url('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'),
    authSecret: fromB64url('BTBZMqHH6r4Tts7J_aSIgg'),
    salt: fromB64url('DGv6ra1nlYgDCS1FRnbzlw'),
    asPrivate: bytesToBig(fromB64url('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw')),
  });
  const header = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
  const ciphertext = '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ';
  assert.equal(b64url(body.slice(0, 86)), header);
  assert.equal(b64url(body.slice(86)), ciphertext);
});

test('a phone can open what the planner encrypts for it', () => {
  const p = phone();
  for (const msg of ['hi', 'x'.repeat(1000), JSON.stringify({ title: 'Coach', body: 'MILLRACE ticked — how did it go? £ ✓' })]) {
    const body = encryptPayload({ hash, randomBytes, payload: new TextEncoder().encode(msg), uaPublic: fromB64url(p.sub.p256dh), authSecret: fromB64url(p.sub.auth) });
    assert.equal(text(decrypt(body, p)), msg);
  }
});

test('the VAPID header: an ES256 JWT for the push service, twelve hours long', () => {
  const keys = makeVapidKeys(randomBytes);
  const now = new Date('2026-09-24T19:30:00Z');
  const auth = vapidAuthorization({
    hash, randomBytes, endpoint: 'https://fcm.googleapis.com/fcm/send/abc:def', now,
    privateKey: bytesToBig(fromB64url(keys.privateKey)), publicKey: fromB64url(keys.publicKey), subject: 'https://george-wightman.github.io/dashboard/',
  });
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(auth);
  assert.ok(m, auth);
  assert.equal(m[4], keys.publicKey);
  assert.deepEqual(JSON.parse(text(fromB64url(m[1]))), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(text(fromB64url(m[2])));
  assert.deepEqual(claims, { aud: 'https://fcm.googleapis.com', exp: now.getTime() / 1000 + 43200, sub: 'https://george-wightman.github.io/dashboard/' });
  const pub = fromB64url(keys.publicKey);
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33)) }, format: 'jwk' });
  assert.equal(crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(fromB64url(m[3]))), true);
});

test('pushRequest: everything UrlFetchApp needs, and a body the phone opens to the message', () => {
  const p = phone();
  const keys = makeVapidKeys(randomBytes);
  const message = { title: 'Coach', body: 'MILLRACE ticked. How did the recommendation land?', url: './?coach=talk:2026-09-24:mind-1', tag: 'talk:2026-09-24:mind-1' };
  const req = pushRequest({ hash, randomBytes, sub: p.sub, message, vapid: keys, now: new Date('2026-09-24T19:30:00Z'), subject: 'https://george-wightman.github.io/dashboard/' });
  assert.equal(req.url, p.sub.endpoint);
  assert.equal(req.method, 'post');
  assert.equal(req.muteHttpExceptions, true);
  assert.equal(req.contentType, 'application/octet-stream');
  assert.equal(req.headers.TTL, '43200');
  assert.equal(req.headers.Urgency, 'normal');
  assert.equal(req.headers['Content-Encoding'], 'aes128gcm');
  assert.match(req.headers.Authorization, /^vapid t=/);
  assert.ok(req.payload.every((b) => Number.isInteger(b) && b >= -128 && b <= 127), 'signed bytes, as Apps Script sends them');
  const body = Uint8Array.from(req.payload, (b) => b & 255);
  assert.deepEqual(JSON.parse(text(decrypt(body, p))), message);
});
