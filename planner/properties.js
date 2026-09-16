// Script Properties allow 9 KB per value. Publish a chunk manifest only after every
// chunk is written, so an interrupted save leaves the previous generation readable.
const CHUNK_BYTES = 8000;
const MAX_BYTES = 180000;
const bytes = (s) => new TextEncoder().encode(s).length;

export function propertyParts(value) {
  const text = JSON.stringify(value);
  if (bytes(text) > MAX_BYTES) throw new Error('Planner memory is too large to save safely');
  const parts = [];
  let part = '', size = 0;
  for (const char of text) {
    // Apps Script's TextEncoder shim calls Utilities.newBlob; avoid invoking
    // a service once per character when splitting an entire planning window.
    const cp = char.codePointAt(0);
    const n = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    if (size + n > CHUNK_BYTES) { parts.push(part); part = ''; size = 0; }
    part += char;
    size += n;
  }
  parts.push(part);
  return parts;
}

function manifest(raw) {
  const v = raw ? JSON.parse(raw) : null;
  return v?.chunked === 1 && ['a', 'b'].includes(v.bank) && Number.isInteger(v.parts) && v.parts > 0 && v.parts < 100 ? v : null;
}

export function readProperty(props, name, fallback = {}) {
  const raw = props.getProperty(name);
  if (!raw) return fallback;
  const m = manifest(raw);
  if (!m) return JSON.parse(raw); // migrate the original single-property format on write
  let text = '';
  for (let i = 0; i < m.parts; i++) {
    const part = props.getProperty(`${name}:${m.bank}:${i}`);
    if (part == null) throw new Error(`Planner memory ${name} is incomplete`);
    text += part;
  }
  return JSON.parse(text);
}

export function writeProperty(props, name, value) {
  const parts = propertyParts(value);
  const previous = manifest(props.getProperty(name));
  const bank = previous?.bank === 'a' ? 'b' : 'a';
  if (parts.length === 1) props.setProperty(name, parts[0]);
  else {
    for (let i = 0; i < parts.length; i++) props.setProperty(`${name}:${bank}:${i}`, parts[i]);
    props.setProperty(name, JSON.stringify({ chunked: 1, bank, parts: parts.length }));
  }
  if (previous) {
    for (let i = 0; i < previous.parts; i++) {
      try { props.deleteProperty(`${name}:${previous.bank}:${i}`); } catch { /* published; cleanup can wait */ }
    }
  }
}

export function deleteProperty(props, name) {
  const previous = manifest(props.getProperty(name));
  props.deleteProperty(name);
  if (previous) for (let i = 0; i < previous.parts; i++) props.deleteProperty(`${name}:${previous.bank}:${i}`);
}
