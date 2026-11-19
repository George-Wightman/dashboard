// The browser globals the app's modules use, for Apps Script, which has none of them. Each is
// installed only where it's missing, over Apps Script's own services: fetch over UrlFetchApp (a
// Promise that is already settled — UrlFetchApp waits), text and base64 over Utilities.

const signed = (b) => (b > 127 ? b - 256 : b);

function binaryString(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.slice(i, i + 8192));
  return s;
}

export function installShims(g, { Utilities, UrlFetchApp }) {
  if (typeof g.TextEncoder !== 'function') {
    g.TextEncoder = class { encode(text) { return Uint8Array.from(Utilities.newBlob(String(text)).getBytes(), (b) => b & 255); } };
  }
  if (typeof g.TextDecoder !== 'function') {
    g.TextDecoder = class { decode(bytes) { return Utilities.newBlob(Array.from(bytes, signed)).getDataAsString('UTF-8'); } };
  }
  if (typeof g.btoa !== 'function') {
    g.btoa = (binary) => Utilities.base64Encode(Array.from(binary, (c) => signed(c.charCodeAt(0))));
  }
  if (typeof g.atob !== 'function') {
    g.atob = (b64) => binaryString(Utilities.base64Decode(b64).map((b) => b & 255));
  }
  // UTF-8 text to and from base64 in one call each (js/sync.js's encodeBase64 and decodeBase64 use them
  // when they're here), rather than 1.7 MB going byte by byte through Utilities and back on every save.
  // Each is checked against a known answer first, Hebrew included: if Apps Script ever disagrees, it
  // isn't installed and the byte-by-byte path above, which has always worked, carries on.
  const SAMPLE = 'ש ✓ é';
  const SAMPLE_B64 = '16kg4pyTIMOp';
  try {
    const encode = (text) => Utilities.base64Encode(String(text), Utilities.Charset.UTF_8);
    if (typeof g.__utf8ToBase64 !== 'function' && Utilities.Charset?.UTF_8 && encode(SAMPLE) === SAMPLE_B64) g.__utf8ToBase64 = encode;
  } catch { /* not this Apps Script: the slower path stays */ }
  try {
    const decode = (b64) => Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString('UTF-8');
    if (typeof g.__utf8FromBase64 !== 'function' && decode(SAMPLE_B64) === SAMPLE) g.__utf8FromBase64 = decode;
  } catch { /* the slower path stays */ }
  if (typeof g.structuredClone !== 'function') {
    g.structuredClone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  }
  if (typeof g.crypto?.randomUUID !== 'function') {
    g.crypto = { ...(g.crypto ?? {}), randomUUID: () => Utilities.getUuid() };
  }
  if (typeof g.fetch !== 'function') {
    g.fetch = (url, init = {}) => {
      const headers = { ...(init.headers ?? {}) };
      let contentType;
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === 'content-type') { contentType = headers[k]; delete headers[k]; }
      }
      const options = { method: String(init.method ?? 'get').toLowerCase(), headers, muteHttpExceptions: true };
      if (init.body !== undefined) options.payload = init.body;
      if (contentType) options.contentType = contentType;
      try {
        const res = UrlFetchApp.fetch(url, options);
        const status = res.getResponseCode();
        // UTF-8 said outright: the sync file is now read as raw text (js/sync.js), Hebrew and all, and
        // a wrong guess at the charset would be written straight back to every device.
        const text = res.getContentText('UTF-8');
        return Promise.resolve({ ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) });
      } catch (e) {
        return Promise.reject(e);
      }
    };
  }
}
