// The relay: a way into the sync repo for Claude when its sandbox won't let it reach GitHub itself.
// claude.ai's sandboxes let a private repo be read but not written (or not reached at all), so the
// skill's tool sends the GitHub request it would have made to the planner's web app instead, with a
// key, and the planner makes it with its own GITHUB_TOKEN. Pure and synchronous — a web app's doPost
// has to return its answer, and Apps Script won't wait on a promise — so the caller hands in a
// blocking `request(url, init) → { status, text }` (UrlFetchApp) and a SHA-256, and the tests run it in Node.
//
// It is deliberately narrow. Only the sync repo, only its contents (and blobs, for a data.json over
// 1 MB), only GET, PUT and DELETE — the same three things the tool does on its own. The key is never
// stored: relay.json in the sync repo holds its SHA-256, written by the tool's `relay-key` setup.

import { decodeBase64 } from '../js/sync.js';

export const API = 'https://api.github.com';
export const RELAY_FILE = 'relay.json';
const METHODS = new Set(['GET', 'PUT', 'DELETE']);

// A path into the sync repo the relay will forward, or null. `repo` is SYNC_REPO, so the caller can
// never name another repo; `..` and anything after a `#` are refused outright.
export function relayPath(path, repo) {
  const p = String(path ?? '');
  if (!p.startsWith(`/repos/${repo}/`) || p.includes('..') || p.includes('#') || /[\s\\]/.test(p)) return null;
  const rest = p.slice(`/repos/${repo}/`.length);
  const [route, query = null] = rest.split('?');
  if (query !== null && !/^ref=[\w.%-]+$/.test(query)) return null;
  if (/^contents(\/[\w.%@+-]+)*\/?$/.test(route)) return p;
  if (/^git\/blobs\/[0-9a-f]{40}$/.test(route)) return p;
  return null;
}

// Equal without stopping at the first difference, so the time a refusal takes says nothing.
function sameText(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

const reply = (obj) => JSON.stringify(obj);

// One request in, one reply out (a JSON string). `{ status, body }` is GitHub's own answer, passed
// back untouched; `{ error }` is the relay refusing, which never reaches GitHub.
export function handleRelay({ raw, repo, token, request, sha256Hex }) {
  if (!repo || !token) return reply({ error: 'The planner has no GITHUB_TOKEN or SYNC_REPO' });
  let req;
  try { req = JSON.parse(String(raw ?? '')); } catch { return reply({ error: 'The relay needs JSON' }); }
  if (!req || typeof req !== 'object' || typeof req.key !== 'string' || req.key.length < 32) {
    return reply({ error: 'The relay key is missing' });
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const stored = request(`${API}/repos/${repo}/contents/${RELAY_FILE}`, { method: 'GET', headers });
  if (stored.status === 404) return reply({ error: 'The relay is switched off: there is no relay.json in the sync repo' });
  if (stored.status !== 200) return reply({ error: `The relay couldn't read relay.json (GitHub ${stored.status})` });
  let hash = '';
  try {
    const body = JSON.parse(stored.text);
    hash = String(JSON.parse(decodeBase64(String(body.content ?? ''))).sha256 ?? '');
  } catch { /* unreadable: refused below */ }
  if (!/^[0-9a-f]{64}$/.test(hash) || !sameText(sha256Hex(req.key), hash)) return reply({ error: 'The relay refused the key' });

  const method = String(req.method ?? 'GET').toUpperCase();
  if (!METHODS.has(method)) return reply({ error: `The relay doesn't forward ${method}` });
  const path = relayPath(req.path, repo);
  if (!path) return reply({ error: 'The relay only reaches the sync repo\'s files' });
  const init = { method, headers: { ...headers } };
  if (req.body != null && method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    init.body = String(req.body);
  }
  const res = request(`${API}${path}`, init);
  return reply({ status: res.status, body: res.text });
}
