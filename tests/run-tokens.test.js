import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sumUsage, findTranscript } from '../claude/run-tokens.mjs';

const line = (id, u) => JSON.stringify({ type: 'assistant', message: { id, usage: u } });
const U = (i, cw, cr, o) => ({ input_tokens: i, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: o });

test('sumUsage: one reply split over several lines counts once', () => {
  const text = [line('m1', U(2, 100, 1000, 50)), line('m1', U(2, 100, 1000, 50)), JSON.stringify({ type: 'user' }), line('m2', U(3, 0, 1100, 20)), 'not json'].join('\n');
  assert.deepEqual(sumUsage(text), { input: 5, cacheWrite: 100, cacheRead: 2100, output: 70, total: 2275, replies: 2 });
});

test('findTranscript: looks in every project folder for the session id', () => {
  const root = mkdtempSync(join(tmpdir(), 'rt-'));
  mkdirSync(join(root, 'a'));
  mkdirSync(join(root, 'b'));
  writeFileSync(join(root, 'b', 'abc-123.jsonl'), line('m1', U(1, 1, 1, 1)));
  assert.equal(findTranscript(root, 'abc-123'), join(root, 'b', 'abc-123.jsonl'));
  assert.equal(findTranscript(root, 'nope'), null);
});
