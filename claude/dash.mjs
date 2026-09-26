#!/usr/bin/env node
// The dashboard from the command line — what the Claude skill's run.sh runs. See claude/cli.js.

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { main } from './cli.js';

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
});
if (text) process.stdout.write(`${text}\n`);
process.exitCode = code;
