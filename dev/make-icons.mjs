// Generates the app's icon: icons/icon.svg, icons/icon-192.png and icons/icon-512.png. The sun-path
// D (chosen 21 Oct 2026): the D's straight side solid, its curve the sun's dotted path from Daylight's
// sky, the sun on it, in ink and amber on peach. The PNGs are full-bleed squares with the D inside the
// middle 80% circle, so they're safe as maskable icons too. Run: node dev/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const PEACH = [0xFF, 0xE9, 0xD2];
const INK = [0x1D, 0x1A, 0x2B];
const SUN = [0xFF, 0xAA, 0x3C];

// In a 100-unit square: the D shifted right until its own ink (the heavy stem and the dots, not the
// sun) is centred, so the D sits in the middle by eye and the sun hangs off to its right.
const DX = 10;
const STEM = { x: 34 + DX, top: 24, bottom: 76, width: 7 };
const ARC = { cx: 34 + DX, cy: 50, r: 26, dot: 3, gap: 9, first: 0.25 };
const SUN_AT = { x: 54 + DX, y: 33, r: 9 };

const dots = [];
for (let s = ARC.first; s <= Math.PI * ARC.r; s += ARC.gap) {
  const a = -Math.PI / 2 + s / ARC.r;
  dots.push([ARC.cx + ARC.r * Math.cos(a), ARC.cy + ARC.r * Math.sin(a)]);
}

export function svg() {
  const dot = dots.map(([x, y]) => `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${ARC.dot}" fill="#1D1A2B"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="24" fill="#FFE9D2"/>
  <line x1="${STEM.x}" y1="${STEM.top}" x2="${STEM.x}" y2="${STEM.bottom}" stroke="#1D1A2B" stroke-width="${STEM.width}" stroke-linecap="round"/>
  ${dot}
  <circle cx="${SUN_AT.x}" cy="${SUN_AT.y}" r="${SUN_AT.r}" fill="#FFAA3C"/>
</svg>
`;
}

// What colour a point (in 100 units) is: the sun over the D over the peach.
function colourAt(u, v) {
  if (Math.hypot(u - SUN_AT.x, v - SUN_AT.y) <= SUN_AT.r) return SUN;
  const y = Math.max(STEM.top, Math.min(STEM.bottom, v));
  if (Math.hypot(u - STEM.x, v - y) <= STEM.width / 2) return INK;
  for (const [x, yy] of dots) if (Math.hypot(u - x, v - yy) <= ARC.dot) return INK;
  return PEACH;
}

// Each pixel the average of 4 × 4 samples, for smooth edges.
function pixel(x, y, size) {
  const sum = [0, 0, 0];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const c = colourAt(((x + (i + 0.5) / 4) / size) * 100, ((y + (j + 0.5) / 4) / size) * 100);
      sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2];
    }
  }
  return [...sum.map((s) => Math.round(s / 16)), 255];
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function png(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * stride + 1 + x * 4;
      const [r, g, b, a] = pixel(x, y, size);
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (process.argv[1]?.endsWith('make-icons.mjs')) {
  writeFileSync(new URL('../icons/icon.svg', import.meta.url), svg());
  for (const size of [192, 512]) writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), png(size));
  console.log('Wrote icons/icon.svg, icon-192.png and icon-512.png');
}
