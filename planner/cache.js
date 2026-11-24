// Fewer web calls (24 Nov 2026: the planner ran out of Google's 20,000 a day — the phone's Hebrew
// widget asked every few minutes, and each answer cost about ten). Apps Script's CacheService, for text
// bigger than one entry allows (100 KB), and a blocking request whose GET answers for slow-changing
// files are kept a while. Both do nothing without a cache, and never throw: a cache is only a saving.

const PART = 30000; // characters: under 100 KB even when every one takes three bytes
const MAX_PARTS = 40;

export function textCache(cache, hash = (s) => s) {
  const id = (key) => `t:${hash(String(key))}`.slice(0, 200);
  if (!cache) return { get: () => null, put: () => {} };
  return {
    get(key) {
      try {
        const k = id(key);
        const n = Number(cache.get(`${k}#n`));
        if (!Number.isInteger(n) || n < 1 || n > MAX_PARTS) return null;
        const keys = Array.from({ length: n }, (_, i) => `${k}#${i}`);
        const got = cache.getAll(keys) ?? {};
        if (keys.some((x) => typeof got[x] !== 'string')) return null;
        return keys.map((x) => got[x]).join('');
      } catch { return null; }
    },
    // The count goes in last, so a half-written or half-expired entry reads as nothing.
    put(key, text, seconds) {
      try {
        const k = id(key);
        const s = String(text);
        const n = Math.max(1, Math.ceil(s.length / PART));
        if (n > MAX_PARTS) return;
        const parts = {};
        for (let i = 0; i < n; i++) parts[`${k}#${i}`] = s.slice(i * PART, (i + 1) * PART);
        const ttl = Math.min(21600, Math.max(1, Math.round(seconds)));
        cache.putAll(parts, ttl);
        cache.put(`${k}#n`, String(n), ttl);
      } catch { /* only a saving */ }
    },
  };
}

// `request(url, init) → { status, text }`, with a 200 to a GET kept for `secondsFor(url)` seconds
// (0: not kept).
export function cachedRequest(request, cache, secondsFor) {
  return (url, init = {}) => {
    const ttl = String(init.method ?? 'GET').toUpperCase() === 'GET' ? secondsFor(url) : 0;
    if (!ttl) return request(url, init);
    const hit = cache.get(`url:${url}`);
    if (hit != null) return { status: 200, text: hit };
    const res = request(url, init);
    if (res.status === 200) cache.put(`url:${url}`, res.text, ttl);
    return res;
  };
}

// The day's web calls by where they came from, for ⚙ → Claude and the `planner` read: { day, total,
// by: { timer, calendar, widget, relay, tick } }. Pure.
export function addFetches(prev, day, kind, n) {
  const same = prev && prev.day === day && prev.by && typeof prev.by === 'object';
  const by = same ? { ...prev.by } : {};
  const add = Math.max(0, Math.round(Number(n) || 0));
  if (/^[a-z]{1,12}$/.test(kind)) by[kind] = (Number(by[kind]) || 0) + add;
  return { day, total: (same ? Number(prev.total) || 0 : 0) + add, by };
}
