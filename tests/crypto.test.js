// The maths Web Push needs (P-256 and AES-128-GCM), written out because Apps Script has none of it —
// every piece checked against Node's own crypto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  bytesToBig, bigToBytes, pointFromBytes, pointToBytes, publicKeyOf, ecdh, ecdsaSign, newPrivateKey, N,
} from '../planner/p256.js';
import { aesGcmEncrypt, aesBlock } from '../planner/aes.js';

const rand = (n) => new Uint8Array(crypto.randomBytes(n));
const hex = (u8) => Buffer.from(u8).toString('hex');
const b64u = (buf) => Buffer.from(buf).toString('base64url');

function nodeKey() {
  const ecdhKey = crypto.createECDH('prime256v1');
  ecdhKey.generateKeys();
  return { d: bytesToBig(new Uint8Array(ecdhKey.getPrivateKey())), pub: new Uint8Array(ecdhKey.getPublicKey()), node: ecdhKey };
}

test('bytes and big integers, both ways', () => {
  const b = rand(32);
  assert.equal(hex(bigToBytes(bytesToBig(b), 32)), hex(b));
  assert.equal(hex(bigToBytes(1n, 4)), '00000001');
});

test('the public key of a private key is the one Node computes', () => {
  for (let i = 0; i < 5; i++) {
    const k = nodeKey();
    assert.equal(hex(publicKeyOf(k.d)), hex(k.pub));
  }
});

test('ECDH agrees with Node, both ways round', () => {
  for (let i = 0; i < 4; i++) {
    const a = nodeKey();
    const b = nodeKey();
    const mine = ecdh(a.d, b.pub);
    assert.equal(hex(mine), hex(b.node.computeSecret(Buffer.from(a.pub))));
    assert.equal(hex(ecdh(b.d, a.pub)), hex(mine));
  }
});

test('ECDSA signatures verify with Node', () => {
  for (let i = 0; i < 5; i++) {
    const k = nodeKey();
    const msg = Buffer.from(`hello ${i}`);
    const hash = new Uint8Array(crypto.createHash('sha256').update(msg).digest());
    const sig = ecdsaSign(hash, k.d, rand);
    assert.equal(sig.length, 64);
    const jwk = { kty: 'EC', crv: 'P-256', x: b64u(k.pub.slice(1, 33)), y: b64u(k.pub.slice(33)) };
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    assert.equal(crypto.verify('sha256', msg, { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig)), true);
  }
});

test('points: only uncompressed points on the curve are accepted', () => {
  const k = nodeKey();
  assert.equal(hex(pointToBytes(pointFromBytes(k.pub))), hex(k.pub));
  const off = k.pub.slice();
  off[64] ^= 1;
  assert.throws(() => pointFromBytes(off), /not on the curve/);
  assert.throws(() => pointFromBytes(k.pub.slice(0, 33)), /uncompressed/);
});

test('new private keys are in range', () => {
  for (let i = 0; i < 20; i++) {
    const d = newPrivateKey(rand);
    assert.ok(d > 0n && d < N);
  }
});

test('one AES-128 block matches FIPS-197', () => {
  const key = Uint8Array.from(Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'));
  const block = Uint8Array.from(Buffer.from('00112233445566778899aabbccddeeff', 'hex'));
  assert.equal(hex(aesBlock(key)(block)), '69c4e0d86a7b0430d8cdb78070b4c55a');
});

test('AES-128-GCM matches Node for every length, with and without extra data, and NIST test case 2', () => {
  for (const len of [0, 1, 15, 16, 17, 100, 300]) {
    for (const aad of [new Uint8Array(), rand(20)]) {
      const key = rand(16);
      const iv = rand(12);
      const pt = rand(len);
      const c = crypto.createCipheriv('aes-128-gcm', key, iv);
      if (aad.length) c.setAAD(aad);
      const expected = Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
      assert.equal(hex(aesGcmEncrypt(key, iv, pt, aad)), hex(expected), `length ${len}, aad ${aad.length}`);
    }
  }
  const zero16 = new Uint8Array(16);
  const out = aesGcmEncrypt(zero16, new Uint8Array(12), zero16);
  assert.equal(hex(out.slice(0, 16)), '0388dace60b6a392f328c2b971b2fe78');
  assert.equal(hex(out.slice(16)), 'ab6e47d42cec13bdf53a67b21257bddf');
});
