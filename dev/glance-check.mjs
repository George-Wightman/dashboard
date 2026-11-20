#!/usr/bin/env node
// What a phone widget would be sent right now, from the real dashboard, on the laptop:
//   node dev/glance-check.mjs [tile]
// Uses ~/.dashboard-skill/config.json for the sync repo (never printed). Without the planner's
// Hebrew token it can't read the Hebrew app's own progress, so the Hebrew tile goes by the
// dashboard's own minutes, as the widget does when that read fails.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../claude/config.js';
import { openSession } from '../claude/session.js';
import { createGitHubClient } from '../js/sync.js';
import { glanceOf } from '../js/glance.js';
import { logicalDay } from '../js/dates.js';

const config = readConfig(readFileSync(join(homedir(), '.dashboard-skill', 'config.json'), 'utf8'));
const session = await openSession({ client: createGitHubClient({ token: config.token, repo: config.repo }) });
const doc = session.store.doc();
const now = new Date();
const out = glanceOf(doc, logicalDay(now, config.dayStartHour ?? 4), now, [], null);
const tile = process.argv[2] ?? 'hebrew';
console.log(JSON.stringify(out.tiles[tile], null, 2));
