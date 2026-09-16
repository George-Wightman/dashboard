import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handoffPath, handoffFile, handoffList, pickHandoff, slug, trailLine, pruneTrail } from '../claude/handoff.js';

const AT = new Date('2026-09-16T08:14:00.000Z');

test('the path carries the day, the time and a slug of the title', () => {
  assert.equal(handoffPath(AT, 'Stale bundled docs!'), 'handoffs/2026-09-16-0814-stale-bundled-docs.md');
});

test('a title with nothing usable in it still makes a path', () => {
  assert.equal(handoffPath(AT, '!!!'), 'handoffs/2026-09-16-0814-handoff.md');
  assert.equal(slug('  A very, very long title that runs on well past what a file name wants  '),
    'a-very-very-long-title-that-runs-on-well');
});

test('the file carries frontmatter, and the text whole', () => {
  const text = `${'x'.repeat(5000)}\nand a line after it`;
  const out = handoffFile({ at: AT, by: 'claude', build: 'abc123', app: 'dash-v9', title: 'Stale docs', text });
  assert.match(out, /^---\nat: 2026-09-16T08:14:00\.000Z\n/);
  assert.match(out, /\nby: claude\n/);
  assert.match(out, /\ntool: abc123\n/);
  assert.match(out, /\napp: dash-v9\n/);
  assert.match(out, /\ntitle: Stale docs\n/);
  assert.ok(out.endsWith(`${text}\n`), 'the text is last and nothing is cut');
});

test('a title over more than one line stays on one line of frontmatter', () => {
  const out = handoffFile({ at: AT, by: 'claude', build: 'x', app: 'y', title: 'One\ntwo', text: 'body' });
  assert.match(out, /\ntitle: One two\n/);
});

test('the list shows open handoffs newest first, and says when there are none', () => {
  const lines = handoffList([
    { name: '2026-09-15-1607-planner.md', path: 'handoffs/2026-09-15-1607-planner.md', size: 900 },
    { name: '2026-09-16-0814-stale-docs.md', path: 'handoffs/2026-09-16-0814-stale-docs.md', size: 4200 },
  ]);
  assert.match(lines, /stale-docs/);
  assert.ok(lines.indexOf('2026-09-16') < lines.indexOf('2026-09-15'), 'newest first');
  assert.match(handoffList([]), /No open handoffs/);
});

test('the trail is never listed as a handoff', () => {
  const lines = handoffList([
    { name: 'trail.md', path: 'handoffs/trail.md', size: 100 },
    { name: '2026-09-16-0814-stale-docs.md', path: 'handoffs/2026-09-16-0814-stale-docs.md', size: 10 },
  ]);
  assert.doesNotMatch(lines, /trail/);
});

test('a handoff is picked by any unique start of its name', () => {
  const files = [
    { name: '2026-09-16-0814-stale-docs.md', path: 'handoffs/2026-09-16-0814-stale-docs.md', size: 1 },
    { name: '2026-09-15-1607-planner.md', path: 'handoffs/2026-09-15-1607-planner.md', size: 1 },
  ];
  assert.equal(pickHandoff(files, '2026-09-16').path, 'handoffs/2026-09-16-0814-stale-docs.md');
  assert.throws(() => pickHandoff(files, '2026-09'), /matches 2 handoffs/);
  assert.throws(() => pickHandoff(files, 'nope'), /No handoff/);
  assert.throws(() => pickHandoff(files, ''), /needs the name/);
});

test('a trail line carries when, the build, what was tried and what came back — on one line', () => {
  const line = trailLine({ at: AT, build: 'abc1234', what: '{"op":"dayOff",\n "date":"x"}', error: 'Unknown op "dayOff"' });
  assert.match(line, /2026-09-16T08:14/);
  assert.match(line, /abc1234/);
  assert.match(line, /dayOff/);
  assert.ok(!line.includes('\n'), 'a trail that wraps is a trail nobody reads');
});

test('a very long op and a very long error are clipped, not dropped', () => {
  const line = trailLine({ at: AT, build: 'x', what: 'w'.repeat(900), error: 'e'.repeat(900) });
  assert.ok(line.length < 700);
  assert.match(line, /w{300}/);
  assert.match(line, /e{300}/);
});

test('the trail keeps only its last lines, and blank ones never count', () => {
  const text = `${Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n')}\n\n`;
  const out = pruneTrail(text, 200).split('\n').filter(Boolean);
  assert.equal(out.length, 200);
  assert.equal(out.at(-1), 'line 249');
  assert.equal(out[0], 'line 50');
});
