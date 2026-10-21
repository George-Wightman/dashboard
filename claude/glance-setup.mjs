#!/usr/bin/env node
// Switches the phone's widgets on (planner/glance.js, android/), once, on the laptop:
//   node claude/glance-setup.mjs
// Puts a new random widget key in ~/.dashboard-skill/config.json (glanceKey, beside the relay's
// address, which the widgets use too), its SHA-256 in glance.json in the sync repo, where the planner
// checks it, and both in the dashboard's data for ⚙ → Phone widgets → Connect. Run it again for a new
// key (the old one stops working at once: Connect again on the phone); delete glance.json from the
// sync repo to switch them off.
// Never prints the key.

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { readConfig } from './config.js';
import { createFileStore } from './files.js';
import { GLANCE_FILE } from '../planner/glance.js';
import { createGitHubClient } from '../js/sync.js';
import { openSession } from './session.js';

const path = process.argv[2] ?? join(homedir(), '.dashboard-skill', 'config.json');
const raw = JSON.parse(readFileSync(path, 'utf8'));
const config = readConfig(JSON.stringify(raw));
if (!config.relayUrl) {
  console.log('Set up the relay first (node claude/relay-setup.mjs <address>): the widgets ask the same web app.');
  process.exit(1);
}
const key = randomBytes(32).toString('base64url');
const files = createFileStore({ token: config.token, repo: config.repo });
const sha256 = createHash('sha256').update(key, 'utf8').digest('hex');
await files.write(GLANCE_FILE, `${JSON.stringify({ sha256, created: new Date().toISOString() }, null, 2)}\n`, 'widget key');
writeFileSync(path, `${JSON.stringify({ ...raw, glanceKey: key }, null, 2)}\n`);
// And in the dashboard's own data, so ⚙ → Phone widgets on the phone can hand it to the widgets app.
// The key opens only a summary of what that data already holds.
const session = await openSession({ client: createGitHubClient({ token: config.token, repo: config.repo }) });
session.record((store) => store.putCalendar('widgets', { url: config.relayUrl, key }, 'claude'), { log: false });
const pushed = await session.push();
if (!pushed.ok) { console.log(`The key is set, but the dashboard couldn't be told: ${pushed.error}`); process.exit(1); }
console.log(`Widgets on: ${GLANCE_FILE} written to ${config.repo}, key saved in ${path}.`);
console.log('Next: on the phone, ⚙ → Phone widgets → Connect (android/README.md).');
