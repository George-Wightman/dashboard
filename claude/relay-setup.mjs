#!/usr/bin/env node
// Switches the relay on (planner/relay.js, claude/relay.js), once, on the laptop:
//   node claude/relay-setup.mjs https://script.google.com/macros/s/…/exec
// Puts the web app's address and a new random key in ~/.dashboard-skill/config.json, and the key's
// SHA-256 in relay.json in the sync repo, where the planner checks it. Run it again for a new key
// (the old one stops working at once); delete relay.json from the sync repo to switch the relay off.
// Then `npm run build-skill` and upload the zip. Never prints the key.

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { readConfig } from './config.js';
import { createFileStore } from './files.js';
import { RELAY_FILE } from '../planner/relay.js';

const url = process.argv[2];
const path = process.argv[3] ?? join(homedir(), '.dashboard-skill', 'config.json');
if (!url) {
  console.log('Usage: node claude/relay-setup.mjs <the planner web app address> [config.json]');
  process.exit(1);
}
const raw = JSON.parse(readFileSync(path, 'utf8'));
const key = randomBytes(32).toString('base64url');
const next = { ...raw, relayUrl: url.trim(), relayKey: key };
const config = readConfig(JSON.stringify(next));

const files = createFileStore({ token: config.token, repo: config.repo });
const sha256 = createHash('sha256').update(key, 'utf8').digest('hex');
await files.write(RELAY_FILE, `${JSON.stringify({ sha256, created: new Date().toISOString() }, null, 2)}\n`, 'relay key');
writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
console.log(`Relay on: ${RELAY_FILE} written to ${config.repo}, address and key saved in ${path}.`);
console.log('Next: npm run build-skill, then upload the zip at claude.ai → Settings → Capabilities → Skills.');
