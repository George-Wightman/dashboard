// NIST P-256, for Web Push (planner/webpush.js): the planner runs in Apps Script, which has no ECDSA
// and no ECDH, so the curve is done here with BigInt — Jacobian coordinates so a scalar multiply needs
// only one inverse. Checked against node:crypto in tests/crypto.test.js. Not constant-time; it signs
// notifications for one person's phone, which is not a setting where timing attacks are a concern.

export const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
export const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
const G = { x: 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n, y: 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n };
const INFINITY = [0n, 1n, 0n];

const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
function modPow(base, exp, m) {
  let r = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}
const inverse = (a, m = P) => modPow(a, m - 2n, m); // both moduli are prime

export function bytesToBig(u8) {
  let n = 0n;
  for (const b of u8) n = (n << 8n) | BigInt(b);
  return n;
}

export function bigToBytes(n, len = 32) {
  const out = new Uint8Array(len);
  let v = n;
  for (let i = len - 1; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
}

// Doubling for a = −3 (the "dbl-2001-b" formulas).
function double([X, Y, Z]) {
  if (Z === 0n || Y === 0n) return INFINITY;
  const delta = mod(Z * Z);
  const gamma = mod(Y * Y);
  const beta = mod(X * gamma);
  const alpha = mod(3n * mod(X - delta) * mod(X + delta));
  const X3 = mod(alpha * alpha - 8n * beta);
  const Z3 = mod(mod((Y + Z) * (Y + Z)) - gamma - delta);
  const Y3 = mod(alpha * (4n * beta - X3) - 8n * gamma * gamma);
  return [X3, Y3, Z3];
}

function add(p, q) {
  const [X1, Y1, Z1] = p;
  const [X2, Y2, Z2] = q;
  if (Z1 === 0n) return q;
  if (Z2 === 0n) return p;
  const Z1Z1 = mod(Z1 * Z1);
  const Z2Z2 = mod(Z2 * Z2);
  const U1 = mod(X1 * Z2Z2);
  const U2 = mod(X2 * Z1Z1);
  const S1 = mod(Y1 * Z2 * Z2Z2);
  const S2 = mod(Y2 * Z1 * Z1Z1);
  if (U1 === U2) return S1 === S2 ? double(p) : INFINITY;
  const H = mod(U2 - U1);
  const R = mod(S2 - S1);
  const H2 = mod(H * H);
  const H3 = mod(H * H2);
  const U1H2 = mod(U1 * H2);
  const X3 = mod(R * R - H3 - 2n * U1H2);
  const Y3 = mod(R * (U1H2 - X3) - S1 * H3);
  const Z3 = mod(H * Z1 * Z2);
  return [X3, Y3, Z3];
}

function affine([X, Y, Z]) {
  if (Z === 0n) throw new Error('The point at infinity has no coordinates');
  const zi = inverse(Z);
  const zi2 = mod(zi * zi);
  return { x: mod(X * zi2), y: mod(Y * zi2 * zi) };
}

function multiply(k, point) {
  let r = INFINITY;
  let q = [point.x, point.y, 1n];
  let e = k;
  while (e > 0n) {
    if (e & 1n) r = add(r, q);
    q = double(q);
    e >>= 1n;
  }
  return affine(r);
}

const onCurve = ({ x, y }) => mod(y * y) === mod(x * x * x - 3n * x + B);

export function pointFromBytes(u8) {
  if (u8.length !== 65 || u8[0] !== 4) throw new Error('A P-256 public key here is 65 bytes, uncompressed');
  const point = { x: bytesToBig(u8.slice(1, 33)), y: bytesToBig(u8.slice(33)) };
  if (point.x >= P || point.y >= P || !onCurve(point)) throw new Error('That public key is not on the curve');
  return point;
}

export function pointToBytes({ x, y }) {
  const out = new Uint8Array(65);
  out[0] = 4;
  out.set(bigToBytes(x), 1);
  out.set(bigToBytes(y), 33);
  return out;
}

export const publicKeyOf = (d) => pointToBytes(multiply(d, G));

// The shared secret: the x-coordinate of d·Q.
export const ecdh = (d, pub) => bigToBytes(multiply(d, pointFromBytes(pub)).x);

// A number from 1 to N − 1, by rejection.
function scalar(randomBytes) {
  for (;;) {
    const k = bytesToBig(randomBytes(32));
    if (k > 0n && k < N) return k;
  }
}
export const newPrivateKey = (randomBytes) => scalar(randomBytes);

// ECDSA over a SHA-256 hash: r ‖ s, 32 bytes each (the JOSE / IEEE P1363 form ES256 uses).
export function ecdsaSign(hash, d, randomBytes) {
  const z = bytesToBig(hash);
  for (;;) {
    const k = scalar(randomBytes);
    const r = mod(multiply(k, G).x, N);
    if (r === 0n) continue;
    const s = mod(inverse(k, N) * (z + r * d), N);
    if (s === 0n) continue;
    const out = new Uint8Array(64);
    out.set(bigToBytes(r), 0);
    out.set(bigToBytes(s), 32);
    return out;
  }
}
