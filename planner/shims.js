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
        const text = res.getContentText();
        return Promise.resolve({ ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) });
      } catch (e) {
        return Promise.reject(e);
      }
    };
  }
}
