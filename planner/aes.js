// AES-128 and GCM, for Web Push's aes128gcm content encoding (planner/webpush.js) — Apps Script has
// neither. Encryption only (the planner never decrypts). Checked against FIPS-197, NIST's GCM test
// vectors and node:crypto in tests/crypto.test.js.

const rotl8 = (x, s) => ((x << s) | (x >> (8 - s))) & 0xff;

// The S-box, generated rather than typed out: the multiplicative inverse in GF(2^8), then the affine
// transform.
const SBOX = (() => {
  const s = new Uint8Array(256);
  let p = 1;
  let q = 1;
  do {
    p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    s[p] = (q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63) & 0xff;
  } while (p !== 1);
  s[0] = 0x63;
  return s;
})();

const xtime = (a) => ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

function expandKey(key) {
  const w = new Uint8Array(176);
  w.set(key);
  for (let i = 16, r = 0; i < 176; i += 4) {
    let t = [w[i - 4], w[i - 3], w[i - 2], w[i - 1]];
    if (i % 16 === 0) {
      t = [SBOX[t[1]] ^ RCON[r++], SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]];
    }
    for (let j = 0; j < 4; j++) w[i + j] = w[i - 16 + j] ^ t[j];
  }
  return w;
}

// One AES-128 key's block cipher: block (16 bytes) → encrypted block.
export function aesBlock(key) {
  const w = expandKey(key);
  return (input) => {
    let s = Uint8Array.from(input, (b, i) => b ^ w[i]);
    for (let round = 1; round <= 10; round++) {
      const t = new Uint8Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[r + 4 * c] = SBOX[s[r + 4 * ((c + r) % 4)]];
      if (round < 10) {
        for (let c = 0; c < 4; c++) {
          const [a0, a1, a2, a3] = [t[4 * c], t[4 * c + 1], t[4 * c + 2], t[4 * c + 3]];
          t[4 * c] = xtime(a0) ^ xtime(a1) ^ a1 ^ a2 ^ a3;
          t[4 * c + 1] = a0 ^ xtime(a1) ^ xtime(a2) ^ a2 ^ a3;
          t[4 * c + 2] = a0 ^ a1 ^ xtime(a2) ^ xtime(a3) ^ a3;
          t[4 * c + 3] = xtime(a0) ^ a0 ^ a1 ^ a2 ^ xtime(a3);
        }
      }
      for (let i = 0; i < 16; i++) t[i] ^= w[16 * round + i];
      s = t;
    }
    return s;
  };
}

const toBig = (u8) => { let n = 0n; for (const b of u8) n = (n << 8n) | BigInt(b); return n; };
const fromBig = (n) => { const out = new Uint8Array(16); let v = n; for (let i = 15; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; } return out; };
const R = 0xe1n << 120n;

// Multiplication in GCM's GF(2^128), bit 127 being the first bit.
function gmul(x, y) {
  let z = 0n;
  let v = y;
  for (let i = 127n; i >= 0n; i--) {
    if ((x >> i) & 1n) z ^= v;
    v = v & 1n ? (v >> 1n) ^ R : v >> 1n;
  }
  return z;
}

function ghash(h, aad, ciphertext) {
  let x = 0n;
  const absorb = (data) => {
    for (let i = 0; i < data.length; i += 16) {
      const block = new Uint8Array(16);
      block.set(data.subarray(i, i + 16));
      x = gmul(x ^ toBig(block), h);
    }
  };
  absorb(aad);
  absorb(ciphertext);
  x = gmul(x ^ ((BigInt(aad.length * 8) << 64n) | BigInt(ciphertext.length * 8)), h);
  return x;
}

// AES-128-GCM with a 96-bit IV: ciphertext followed by the 16-byte tag.
export function aesGcmEncrypt(key, iv, plaintext, aad = new Uint8Array()) {
  const encrypt = aesBlock(key);
  const h = toBig(encrypt(new Uint8Array(16)));
  const j0 = new Uint8Array(16);
  j0.set(iv);
  j0[15] = 1;
  const out = new Uint8Array(plaintext.length + 16);
  const counter = j0.slice();
  for (let i = 0; i < plaintext.length; i += 16) {
    for (let j = 15; j >= 12; j--) { counter[j] = (counter[j] + 1) & 0xff; if (counter[j]) break; }
    const pad = encrypt(counter);
    for (let j = 0; j < 16 && i + j < plaintext.length; j++) out[i + j] = plaintext[i + j] ^ pad[j];
  }
  const ct = out.subarray(0, plaintext.length);
  const tag = fromBig(toBig(encrypt(j0)) ^ ghash(h, aad, ct));
  out.set(tag, plaintext.length);
  return out;
}
