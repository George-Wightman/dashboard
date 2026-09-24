// Web Push from the planner (docs/superpowers/specs/2026-09-25-coach-mind-design.md): a notification
// for George's phone or laptop, encrypted so only that browser can read it (RFC 8291, aes128gcm) and
// signed so the push service knows it's from this app (RFC 8292, VAPID). The curve and the cipher are
// planner/p256.js and planner/aes.js; SHA-256 and HMAC come in as `hash` ({ sha256, hmac }) and
// randomness as `randomBytes(n)` — Utilities in Apps Script, node:crypto in the tests.

import { aesGcmEncrypt } from './aes.js';
import { publicKeyOf, ecdh, ecdsaSign, newPrivateKey, bigToBytes, bytesToBig } from './p256.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const RECORD_SIZE = 4096;
export const TTL_SECONDS = 43200;
export const JWT_HOURS = 12;

export function b64url(u8) {
  let out = '';
  for (let i = 0; i < u8.length; i += 3) {
    const n = (u8[i] << 16) | ((u8[i + 1] ?? 0) << 8) | (u8[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (i + 1 < u8.length) out += ALPHABET[(n >> 6) & 63];
    if (i + 2 < u8.length) out += ALPHABET[n & 63];
  }
  return out;
}

export function fromB64url(s) {
  const clean = String(s).replace(/[\s=]/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const out = [];
  let bits = 0;
  let value = 0;
  for (const c of clean) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw new Error('Not base64url');
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((value >> bits) & 255); }
  }
  return Uint8Array.from(out);
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const utf8 = (s) => new TextEncoder().encode(s);

// RFC 5869 with SHA-256, for at most 32 bytes (all Web Push needs).
export function hkdf(hash, salt, ikm, info, length) {
  const prk = hash.hmac(salt, ikm);
  return hash.hmac(prk, concat(info, [1])).slice(0, length);
}

// The body of one push message: salt ‖ record size ‖ key id length ‖ our one-off public key, then
// the payload (with its 0x02 delimiter) under AES-128-GCM.
export function encryptPayload({ hash, randomBytes, payload, uaPublic, authSecret, salt = randomBytes(16), asPrivate = newPrivateKey(randomBytes) }) {
  const asPublic = publicKeyOf(asPrivate);
  const secret = ecdh(asPrivate, uaPublic);
  const ikm = hkdf(hash, authSecret, secret, concat(utf8('WebPush: info'), [0], uaPublic, asPublic), 32);
  const cek = hkdf(hash, salt, ikm, concat(utf8('Content-Encoding: aes128gcm'), [0]), 16);
  const nonce = hkdf(hash, salt, ikm, concat(utf8('Content-Encoding: nonce'), [0]), 12);
  const ciphertext = aesGcmEncrypt(cek, nonce, concat(payload, [2]));
  const rs = [(RECORD_SIZE >>> 24) & 255, (RECORD_SIZE >>> 16) & 255, (RECORD_SIZE >>> 8) & 255, RECORD_SIZE & 255];
  return concat(salt, rs, [asPublic.length], asPublic, ciphertext);
}

// The push service's origin, read without URL (Apps Script has none).
const originOf = (endpoint) => (/^(https:\/\/[^/]+)/.exec(String(endpoint)) ?? [])[1] ?? '';

export function vapidAuthorization({ hash, randomBytes, endpoint, privateKey, publicKey, now, subject }) {
  const header = b64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(utf8(JSON.stringify({ aud: originOf(endpoint), exp: Math.floor(now.getTime() / 1000) + JWT_HOURS * 3600, sub: subject })));
  const input = `${header}.${claims}`;
  const signature = ecdsaSign(hash.sha256(utf8(input)), privateKey, randomBytes);
  return `vapid t=${input}.${b64url(signature)}, k=${b64url(publicKey)}`;
}

const signed = (u8) => Array.from(u8, (b) => (b > 127 ? b - 256 : b));

// One request for UrlFetchApp.fetchAll. `vapid` is { privateKey, publicKey } as base64url strings;
// `authorization` may be passed in to reuse one signature for several messages to the same service.
export function pushRequest({ hash, randomBytes, sub, message, vapid, now, subject, authorization = null }) {
  const body = encryptPayload({
    hash, randomBytes, payload: utf8(JSON.stringify(message)), uaPublic: fromB64url(sub.p256dh), authSecret: fromB64url(sub.auth),
  });
  const auth = authorization ?? vapidAuthorization({
    hash, randomBytes, endpoint: sub.endpoint, now, subject,
    privateKey: bytesToBig(fromB64url(vapid.privateKey)), publicKey: fromB64url(vapid.publicKey),
  });
  return {
    url: sub.endpoint, method: 'post', muteHttpExceptions: true, contentType: 'application/octet-stream',
    headers: { Authorization: auth, TTL: String(TTL_SECONDS), Urgency: 'normal', 'Content-Encoding': 'aes128gcm' },
    payload: signed(body),
  };
}

export function makeVapidKeys(randomBytes) {
  const d = newPrivateKey(randomBytes);
  return { privateKey: b64url(bigToBytes(d)), publicKey: b64url(publicKeyOf(d)) };
}

// Apps Script's SHA-256 and HMAC, and randomness from its UUIDs (Java's SecureRandom), hashed.
export function gasCrypto(Utilities) {
  const unsigned = (bytes) => Uint8Array.from(bytes, (b) => b & 255);
  const hash = {
    sha256: (u8) => unsigned(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, signed(u8))),
    hmac: (key, data) => unsigned(Utilities.computeHmacSha256Signature(signed(data), signed(key))),
  };
  let counter = 0;
  const randomBytes = (n) => {
    const out = [];
    while (out.length < n) out.push(...hash.sha256(utf8(`${Utilities.getUuid()}|${Utilities.getUuid()}|${++counter}|${Date.now()}`)));
    return Uint8Array.from(out.slice(0, n));
  };
  return { hash, randomBytes };
}
