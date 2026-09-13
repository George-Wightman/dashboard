import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { zipFiles } from '../claude/zip.js';
import { buildSkill, PLACEHOLDER, SKILL_FILES } from '../claude/build-skill.mjs';
import { OPS } from '../claude/ops.js';
import { READS } from '../claude/read.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Reads a zip back through its central directory: [{ name, mode, data }].
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const mode = (buf.readUInt32LE(at + 38) >>> 16) & 0o777;
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    out.push({ name, mode, data: inflateRawSync(buf.subarray(dataAt, dataAt + size)) });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const CONFIG = JSON.stringify({ token: 'github_pat_TESTKEY0123456789abcdef', repo: 'George-Wightman/dashboard-sync', dayStartHour: 4, timeZone: 'Europe/London' });

test('zipFiles writes a zip that reads back, names, modes and all', () => {
  const zip = zipFiles([{ name: 'd/a.txt', data: 'hello' }, { name: 'd/run.sh', data: Buffer.from('#!/bin/sh\n'), mode: 0o755 }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.deepEqual(unzip(zip).map((f) => [f.name, f.mode, f.data.toString()]),
    [['d/a.txt', 0o644, 'hello'], ['d/run.sh', 0o755, '#!/bin/sh\n']]);
});

test('buildSkill puts the three skill files and the config under dashboard/', () => {
  const files = unzip(buildSkill({ configText: CONFIG }));
  assert.deepEqual(files.map((f) => f.name), ['dashboard/SKILL.md', 'dashboard/reference.md', 'dashboard/run.sh', 'dashboard/config.json']);
  assert.equal(files[2].mode, 0o755);
  assert.equal(files[3].mode, 0o600);
  assert.equal(files[3].data.toString(), CONFIG);
  assert.equal(files[0].data.toString(), read('claude/skill/SKILL.md'));
  assert.deepEqual(SKILL_FILES, ['SKILL.md', 'reference.md', 'run.sh']);
});

test('buildSkill refuses a config without a real key', () => {
  assert.ok(read('claude/skill/config.example.json').includes(PLACEHOLDER));
  assert.throws(() => buildSkill({ configText: read('claude/skill/config.example.json') }), /Paste the Claude skill key/);
  assert.throws(() => buildSkill({ configText: '{"repo":"a/b"}' }), /has no token/);
});

test('SKILL.md: named dashboard, a description Claude can trigger on, and the rules from the design', () => {
  const skill = read('claude/skill/SKILL.md');
  const front = /^---\nname: dashboard\ndescription: (.+)\n---\n/.exec(skill);
  assert.ok(front, 'frontmatter with name and a one-line description');
  assert.ok(front[1].length <= 1024, 'description at most 1024 characters');
  for (const phrase of ['/dashboard', 'add', "what's on today", 'suggestion']) {
    assert.ok(front[1].toLowerCase().includes(phrase.toLowerCase()), phrase);
  }
  for (const phrase of ["run.sh apply <<'EOF'", '"suggest": true', '"op": "plan"', 'dashboard:<id>',
    'reference.md', 'Settings → Capabilities', 'never on a guessed title', 'config.json']) {
    assert.ok(skill.includes(phrase), phrase);
  }
});

test('reference.md documents every read and every op', () => {
  const ref = read('claude/skill/reference.md');
  for (const name of Object.keys(READS)) assert.match(ref, new RegExp(`^### \`${name}`, 'm'), name);
  for (const name of Object.keys(OPS)) assert.match(ref, new RegExp(`^### \`${name}\``, 'm'), name);
});

test("run.sh fetches the public app, checks Node, and runs the tool with the skill's config", () => {
  const sh = read('claude/skill/run.sh');
  assert.match(sh, /^#!\/usr\/bin\/env bash\n/);
  assert.ok(sh.includes('URL=https://github.com/George-Wightman/dashboard.git'));
  assert.ok(sh.includes('APP=/tmp/dashboard'));
  assert.ok(sh.includes('NODE_USE_ENV_PROXY=1 exec node "$APP/claude/dash.mjs" --config "$HERE/config.json" "$@"'));
  assert.ok(sh.includes('Settings → Capabilities'));
  assert.doesNotMatch(sh, /\r/);
  assert.doesNotMatch(sh, /github_pat_|ghp_/);
});

test('the key never enters the repo; the build has a script', () => {
  assert.match(read('.gitignore'), /^claude\/skill\/config\.json$/m);
  assert.match(read('package.json'), /"build-skill": "node claude\/build-skill\.mjs"/);
});
