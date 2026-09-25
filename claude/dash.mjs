#!/usr/bin/env node
// The dashboard from the command line — what the Claude skill's run.sh runs. See claude/cli.js.

import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './cli.js';
import { createBranchWriter } from './branch.js';

// In a cloud routine the sync repo is cloned beside this one (/home/user/dashboard-sync); the tool
// writes there with git (claude/branch.js). DASHBOARD_SYNC_DIR says otherwise if it ever moves.
function makeBranchWriter({ repo }) {
  const dir = process.env.DASHBOARD_SYNC_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', repo.split('/').pop());
  const git = (args) => {
    try {
      return execFileSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      throw new Error(`git ${args[0] === '-c' ? 'commit' : args[0]}: ${String(e.stderr || e.message).trim()}`);
    }
  };
  return createBranchWriter({ git, files: { write: (path, text) => writeFileSync(join(dir, path), text) }, repo });
}

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

const { code, text } = await main({
  argv: process.argv.slice(2),
  readText: (path) => readFileSync(path, 'utf8'),
  readStdin,
  newId: randomUUID,
  makeBranchWriter,
});
if (text) process.stdout.write(`${text}\n`);
process.exitCode = code;
