// The way round a sandbox that won't let the tool reach GitHub (planner/relay.js is the other end).
// claude.ai's chats, and Claude Code on the web, put GitHub behind a proxy that lets a private repo
// be read but not written, or not reached at all. With a relay in config.json, this fetch tries
// GitHub as usual and, the first time GitHub answers 401/403 or can't be reached, sends that request
// and every later one to the planner's web app, which makes it with the planner's own key.
// On the laptop GitHub answers, so nothing changes there.
//
// The relay itself can blink: Apps Script starting cold, or a sandbox's proxy dropping a connection
// ("fetch failed" from a phone chat, 21 Oct 2026). So a request that couldn't get an answer is tried
// again, then once through curl (`curl`, from claude/curl.js), which goes through the sandbox's proxy
// on its own terms. A refusal from the relay (wrong key, a path it won't touch) is never retried.

const API = 'https://api.github.com';
const WAITS_MS = [800, 2500];

class Refused extends Error {}

// Why a request never got an answer, in a few words: the error and, when Node gives one, its cause.
export function whyFailed(e) {
  const cause = e?.cause?.code ?? e?.cause?.message;
  return [e?.message ?? String(e), cause].filter(Boolean).join(': ');
}

export function relayingFetch({
  relayUrl, relayKey, fetch = (...args) => globalThis.fetch(...args), curl = null, force = false, onSwitch = () => {},
  sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
}) {
  if (!relayUrl || !relayKey) return fetch;
  let viaRelay = force;

  async function once(send, url, init) {
    const res = await send(relayUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key: relayKey, method: init.method ?? 'GET', path: String(url).slice(API.length), body: init.body ?? null }),
      ...(init.signal ? { signal: init.signal } : {}),
    });
    const text = await res.text();
    let reply;
    try { reply = JSON.parse(text); } catch {
      throw new Error(`The relay didn't answer with JSON (HTTP ${res.status}) — is the planner's web app deployed for "Anyone"?`);
    }
    if (reply.error) throw new Refused(reply.error);
    return new Response(reply.body === '' ? null : reply.body, { status: reply.status });
  }

  async function relay(url, init = {}) {
    const ways = [fetch, ...WAITS_MS.map(() => fetch), ...(curl ? [curl] : [])];
    let last = null;
    for (let i = 0; i < ways.length; i++) {
      if (i > 0 && WAITS_MS[i - 1] !== undefined) await sleep(WAITS_MS[i - 1]);
      try {
        return await once(ways[i], url, init);
      } catch (e) {
        if (e instanceof Refused || e?.name === 'AbortError') throw e;
        last = e;
      }
    }
    throw new Error(`Couldn't reach the planner's relay after ${ways.length} tries (${whyFailed(last)})`);
  }

  return async (url, init = {}) => {
    if (!String(url).startsWith(`${API}/`)) return fetch(url, init);
    if (!viaRelay) {
      try {
        const res = await fetch(url, init);
        if (res.status !== 401 && res.status !== 403) return res;
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
      }
      viaRelay = true;
      onSwitch();
    }
    return relay(url, init);
  };
}
