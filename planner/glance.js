// The widgets' way in (android/, js/glance.js): the phone asks the planner's web app for a summary of
// the day and the tiles, and gets only that — no way to read the data itself, and none to change it.
// Synchronous, like the relay (planner/relay.js): a web app's doPost can't wait on a promise, so the
// caller hands in a blocking `request(url, init) → { status, text }` (UrlFetchApp). Its own key,
// checked against glance.json in the sync repo, so the widgets can be switched off without the relay.

import { glanceOf } from '../js/glance.js';
import { logicalDay } from '../js/dates.js';
import { isDoc } from '../js/doc.js';
import { decodeBase64 } from '../js/sync.js';
import { API } from './relay.js';
import { validMap } from '../js/map/files.js';

export const GLANCE_FILE = 'glance.json';

// The map's private files (js/map/files.js), for the Map widget: none when there are none, or any fails.
function readMaps(request, repo, headers) {
  const raw = (path) => {
    const res = request(`${API}/repos/${repo}/contents/${path}`, { method: 'GET', headers: { ...headers, Accept: 'application/vnd.github.raw+json' } });
    if (res.status !== 200) return null;
    try { return JSON.parse(res.text); } catch { return null; }
  };
  const index = raw('map/index.json');
  const ids = Array.isArray(index?.cities) ? index.cities.filter((id) => /^[a-z0-9-]{1,40}$/.test(id)) : [];
  return ids.map((id) => raw(`map/${id}.json`)).filter((m) => validMap(m));
}

function sameText(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

// `req` is the request already read as JSON ({ glance: key }). One reply out, a JSON string.
// `hebrew(today)` reads the Hebrew app's own progress (planner/hebrew-progress.js); without it, or when
// it fails, the Hebrew widget goes by the dashboard's own minutes.
export function handleGlance({ req, repo, token, request, sha256Hex, now = new Date(), dayStartHour = 4, hebrew = null }) {
  const reply = (obj) => JSON.stringify(obj);
  if (!repo || !token) return reply({ error: 'The planner has no GITHUB_TOKEN or SYNC_REPO' });
  if (typeof req?.glance !== 'string' || req.glance.length < 32) return reply({ error: 'The widget key is missing' });
  const headers = { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const stored = request(`${API}/repos/${repo}/contents/${GLANCE_FILE}`, { method: 'GET', headers: { ...headers, Accept: 'application/vnd.github+json' } });
  if (stored.status === 404) return reply({ error: 'The widgets are switched off: there is no glance.json in the sync repo' });
  if (stored.status !== 200) return reply({ error: `The widgets couldn't read glance.json (GitHub ${stored.status})` });
  let hash = '';
  try { hash = String(JSON.parse(decodeBase64(String(JSON.parse(stored.text).content ?? ''))).sha256 ?? ''); } catch { /* refused below */ }
  if (!/^[0-9a-f]{64}$/.test(hash) || !sameText(sha256Hex(req.glance), hash)) return reply({ error: 'The planner refused the widget key' });
  // The raw file, whatever its size (the contents API stops giving it inline past 1 MB).
  const data = request(`${API}/repos/${repo}/contents/data.json`, { method: 'GET', headers: { ...headers, Accept: 'application/vnd.github.raw+json' } });
  if (data.status !== 200) return reply({ error: `The widgets couldn't read the dashboard (GitHub ${data.status})` });
  let doc;
  try { doc = JSON.parse(data.text); } catch { return reply({ error: "The dashboard's data couldn't be read" }); }
  if (!isDoc(doc)) return reply({ error: "The sync file isn't a dashboard document" });
  const today = logicalDay(now, dayStartHour);
  let progress = null;
  try { progress = hebrew?.(today) ?? null; } catch { progress = null; }
  return reply(glanceOf(doc, today, now, readMaps(request, repo, headers), progress?.ok ? progress : null));
}
