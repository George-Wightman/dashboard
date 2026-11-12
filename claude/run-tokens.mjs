#!/usr/bin/env node
// How many tokens a Claude Code session used, from its own transcript
// (~/.claude/projects/<project>/<session id>.jsonl): for the Stocks routine's run record, so George
// can see what the morning runs cost (docs/superpowers/plans/2026-11-12-stocks-routine-spike.md).
//   node claude/run-tokens.mjs <session id>   → {"input":…,"cacheWrite":…,"cacheRead":…,"output":…,"total":…,"replies":…}
// A reply is written over several lines with the same usage, so each message id counts once.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

export function sumUsage(text) {
  const seen = new Set();
  const out = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, total: 0, replies: 0 };
  for (const raw of String(text).split('\n')) {
    let j;
    try { j = JSON.parse(raw); } catch { continue; }
    const u = j?.message?.usage;
    const id = j?.message?.id;
    if (j?.type !== 'assistant' || !u || !id || seen.has(id)) continue;
    seen.add(id);
    out.input += u.input_tokens ?? 0;
    out.cacheWrite += u.cache_creation_input_tokens ?? 0;
    out.cacheRead += u.cache_read_input_tokens ?? 0;
    out.output += u.output_tokens ?? 0;
    out.replies++;
  }
  out.total = out.input + out.cacheWrite + out.cacheRead + out.output;
  return out;
}

export function findTranscript(root, sessionId) {
  if (!existsSync(root)) return null;
  for (const dir of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const p = join(root, dir.name, `${sessionId}.jsonl`);
    if (existsSync(p)) return p;
  }
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const id = process.argv[2];
  const path = id ? findTranscript(join(homedir(), '.claude', 'projects'), id) : null;
  if (!path) {
    console.log(JSON.stringify({ error: id ? `No transcript for session ${id}` : 'Give a session id' }));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(sumUsage(readFileSync(path, 'utf8'))));
  }
}
