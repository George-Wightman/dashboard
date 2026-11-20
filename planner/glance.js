// The widgets' way in (android/, js/glance.js): the phone asks the planner's web app for a summary of
// the day and the tiles, and gets only that: no way to read the data itself, and only two things it
// can change (applyGlanceAct: tick one of today's items, add Hebrew minutes).
// Synchronous, like the relay (planner/relay.js): a web app's doPost can't wait on a promise, so the
// caller hands in a blocking `request(url, init) → { status, text }` (UrlFetchApp). Its own key,
// checked against glance.json in the sync repo, so the widgets can be switched off without the relay.

import { glanceOf } from '../js/glance.js';
import { logicalDay } from '../js/dates.js';
import { isDoc } from '../js/doc.js';
import { mergeDocs } from '../js/merge.js';
import { archiveFiles } from '../js/archive.js';
import { decodeBase64 } from '../js/sync.js';
import { API } from './relay.js';
import { validMap } from '../js/map/files.js';
import { HEBREW_IDS } from '../js/hebrewSync.js';
import { tickable, doneOn, tick, tickLogId } from './ticks.js';

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

// The widget key against glance.json: null when it is good, else what's wrong, in a sentence.
export function glanceKeyProblem({ req, repo, token, request, sha256Hex }) {
  if (!repo || !token) return 'The planner has no GITHUB_TOKEN or SYNC_REPO';
  if (typeof req?.glance !== 'string' || req.glance.length < 32) return 'The widget key is missing';
  const headers = { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const stored = request(`${API}/repos/${repo}/contents/${GLANCE_FILE}`, { method: 'GET', headers: { ...headers, Accept: 'application/vnd.github+json' } });
  if (stored.status === 404) return 'The widgets are switched off: there is no glance.json in the sync repo';
  if (stored.status !== 200) return `The widgets couldn't read glance.json (GitHub ${stored.status})`;
  let hash = '';
  try { hash = String(JSON.parse(decodeBase64(String(JSON.parse(stored.text).content ?? ''))).sha256 ?? ''); } catch { /* refused below */ }
  if (!/^[0-9a-f]{64}$/.test(hash) || !sameText(sha256Hex(req.glance), hash)) return 'The planner refused the widget key';
  return null;
}

// WHAT A WIDGET MAY CHANGE (2026-11-20). Until now they only showed, and ticking anything still
// meant opening the app. Two things, no more: tick one of today's tasks or habits (the Today
// widget's rows), and add Hebrew minutes done away from the app (the Hebrew widget's +15). Applied
// to a store by the planner's web app (planner/gas.js, glanceAct), which then answers with the
// tiles as they now are. { ok, text }; never throws.
export const ACT_HEBREW_STEP = 15;
export const ACT_HEBREW_DAY_MAX = 240;
export function applyGlanceAct(store, act, { today, now }) {
  const doc = store.doc();
  if (act?.kind === 'tick') {
    const item = doc.items?.[String(act.item ?? '')];
    if (!tickable(item)) return { ok: false, text: "That's no longer on today's list." };
    if (doneOn(doc, item.id, today)) return { ok: true, text: `"${item.title}" is already ticked.` };
    if (doc.logs?.[tickLogId(item.id, today)]) return { ok: false, text: `"${item.title}" was unticked in the dashboard, so it's been left.` };
    store.transaction(() => tick(store, item, today, { at: now.toISOString(), source: 'widget' }),
      { summary: `Ticked "${item.title}" from the phone's widget`, source: 'widget' });
    return { ok: true, text: `✓ ${item.title}` };
  }
  if (act?.kind === 'hebrew') {
    const minutes = Math.round(Number(act.minutes));
    const quota = doc.items?.[HEBREW_IDS.minutes];
    if (!(minutes >= 1 && minutes <= 120)) return { ok: false, text: 'That many minutes makes no sense.' };
    if (quota?.status !== 'active') return { ok: false, text: "There's no Hebrew target to add minutes to." };
    const id = `hebrew:widget:${today}`;
    const had = Number(doc.logs?.[id]?.status === 'active' ? doc.logs[id].amount : 0) || 0;
    const amount = Math.min(ACT_HEBREW_DAY_MAX, had + minutes);
    if (amount === had) return { ok: false, text: `${had} minutes from the widget is today's most.` };
    store.transaction(() => store.putLog(id, { itemId: quota.id, kind: 'amount', amount, day: today, source: 'widget' }),
      { summary: `Added ${minutes} min of Hebrew from the phone's widget`, source: 'widget' });
    return { ok: true, text: `+${minutes} min of Hebrew` };
  }
  return { ok: false, text: "The widget asked for something the planner doesn't do." };
}

// `req` is the request already read as JSON ({ glance: key }). One reply out, a JSON string.
// `hebrew(today)` reads the Hebrew app's own progress (planner/hebrew-progress.js); without it, or when
// it fails, the Hebrew widget goes by the dashboard's own minutes.
export function handleGlance({ req, repo, token, request, sha256Hex, now = new Date(), dayStartHour = 4, hebrew = null }) {
  const reply = (obj) => JSON.stringify(obj);
  const problem = glanceKeyProblem({ req, repo, token, request, sha256Hex });
  if (problem) return reply({ error: problem });
  const headers = { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  // The raw file, whatever its size (the contents API stops giving it inline past 1 MB).
  const data = request(`${API}/repos/${repo}/contents/data.json`, { method: 'GET', headers: { ...headers, Accept: 'application/vnd.github.raw+json' } });
  if (data.status !== 200) return reply({ error: `The widgets couldn't read the dashboard (GitHub ${data.status})` });
  let doc;
  try { doc = JSON.parse(data.text); } catch { return reply({ error: "The dashboard's data couldn't be read" }); }
  if (!isDoc(doc)) return reply({ error: "The sync file isn't a dashboard document" });
  // The archive's year files (js/archive.js), so goal totals and the week count what has moved out of
  // data.json. One that can't be read is an error, as data.json is: a tile that quietly counts less is
  // worse than none.
  const files = archiveFiles(doc);
  for (const year of Object.keys(files ?? {})) {
    const res = request(`${API}/repos/${repo}/git/blobs/${files[year]}`, { method: 'GET', headers: { ...headers, Accept: 'application/vnd.github.raw+json' } });
    if (res.status !== 200) return reply({ error: `The widgets couldn't read the dashboard's archive (GitHub ${res.status})` });
    let part = null;
    try { part = JSON.parse(res.text); } catch { part = null; }
    if (typeof part?.content === 'string' && part.encoding === 'base64') { try { part = JSON.parse(decodeBase64(part.content)); } catch { part = null; } }
    if (!isDoc(part)) return reply({ error: "The dashboard's archive couldn't be read" });
    doc = mergeDocs(doc, part);
  }
  const today = logicalDay(now, dayStartHour);
  let progress = null;
  try { progress = hebrew?.(today) ?? null; } catch { progress = null; }
  return reply(glanceOf(doc, today, now, readMaps(request, repo, headers), progress?.ok ? progress : null));
}
