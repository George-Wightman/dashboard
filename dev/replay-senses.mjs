#!/usr/bin/env node
// Replay the Mind's Senses over George's real history: fetch data.json as it was at two moments from
// the dashboard-sync repo's commits, sense from the first to the second, and print the events. No
// calendar events (the calendar's past isn't kept), nothing written anywhere.
//   node dev/replay-senses.mjs "2026-09-24T17:00" "2026-09-24T19:30" [config.json]
// Times are London wall-clock. The config defaults to the Claude skill's (~/.dashboard-skill/config.json).

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { readConfig } from '../claude/config.js';
import { decodeBase64 } from '../js/sync.js';
import { sense, planRisk } from '../planner/senses.js';
import { readArtefacts, drivePaths } from '../planner/drive.js';

process.env.TZ = 'Europe/London';
const [fromText, toText, configPath = `${homedir()}/.dashboard-skill/config.json`] = process.argv.slice(2);
if (!fromText || !toText) {
  console.log('Usage: node dev/replay-senses.mjs "YYYY-MM-DDTHH:MM" "YYYY-MM-DDTHH:MM" [config.json]');
  process.exit(1);
}
const { token, repo } = readConfig(readFileSync(configPath, 'utf8'));
const API = 'https://api.github.com';
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
const get = async (url) => {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${url.replace(token, '…')}`);
  return res.json();
};

// The last commit of data.json at or before a moment.
async function docAt(moment) {
  const until = moment.toISOString();
  const [commit] = await get(`${API}/repos/${repo}/commits?path=data.json&until=${until}&per_page=1`);
  if (!commit) throw new Error(`No data.json before ${until}`);
  const meta = await get(`${API}/repos/${repo}/contents/data.json?ref=${commit.sha}`);
  const content = meta.content ? meta.content : (await get(`${API}/repos/${repo}/git/blobs/${meta.sha}`)).content;
  return { doc: JSON.parse(decodeBase64(content)), at: commit.commit.committer.date, sha: commit.sha.slice(0, 7) };
}

const from = new Date(fromText);
const to = new Date(toText);
const a = await docAt(from);
const b = await docAt(to);
console.log(`From ${a.sha} (${a.at}) to ${b.sha} (${b.at})\n`);
const { cursor } = sense({ doc: a.doc, cursor: null, now: from });
const { events } = sense({ doc: b.doc, cursor, now: to });
const risks = planRisk(b.doc, events, cursor.day, to);
for (const e of [...events, ...risks]) {
  console.log(`[${e.level}] ${e.kind} · ${e.id}\n    ${e.text}`);
  for (const f of e.facts) console.log(`    · ${f.slice(0, 220)}`);
  if (e.paths) console.log(`    paths: ${e.paths.join(', ')}`);
}
if (!events.length) console.log('No events.');

// The Drive files the planner would read for them, from the local copy of My Drive.
const root = process.env.DRIVE_ROOT;
if (root) {
  const { localDrive } = await import('./local-drive.mjs');
  for (const e of events.filter((x) => x.paths)) {
    const { files, problem } = readArtefacts({ DriveApp: localDrive(root), paths: e.paths, now: to });
    console.log(`\nArtefacts for ${e.id}${problem ? ` (${problem})` : ''}:`);
    for (const f of files) console.log(`  ${f.path} · ${f.modified} · ${f.text.length} chars\n    ${f.text.slice(0, 160).replace(/\s+/g, ' ')}…`);
  }
}
void drivePaths;
