process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jobLines } from '../js/jobs.js';
import { fixture } from './helpers.js';

const NOW = new Date('2026-10-20T12:00:00Z');
const ago = (min) => new Date(NOW.getTime() - min * 60000).toISOString();

test('each background job says when it last worked, and what is wrong', () => {
  const doc = fixture();
  doc.calendar.status = { id: 'status', status: 'active', lastRun: ago(4), lastError: null };
  doc.gym.status = { id: 'status', status: 'active', lastSync: ago(9), lastError: null };
  doc.gym.routines = { id: 'routines', status: 'active', byRoutine: {}, lastError: "Hevy wouldn't take the routine for \"Legs A\"" };
  doc.calendar['checkins:status'] = { id: 'checkins:status', status: 'active', day: '2026-10-20', lastRun: ago(4), lastError: null };
  doc.calendar['review-status'] = { id: 'review-status', status: 'active', lastError: 'Goal reviews could not run' };
  const jobs = jobLines(doc, NOW);
  assert.deepEqual(jobs.map((j) => [j.name, j.ok]), [
    ['Calendar planner', true], ['Reading Hevy', true], ['Sessions into Hevy', false], ['Check-ins', true], ['Goal reviews', false],
  ]);
  assert.match(jobs[0].line, /^ran at \d\d:\d\d$/);
  assert.match(jobs[2].line, /Hevy wouldn't take the routine/);
});

test('a planner that has gone quiet for over half an hour is a problem, not a tick', () => {
  const doc = fixture();
  doc.calendar.status = { id: 'status', status: 'active', lastRun: ago(95), lastError: null };
  const [planner] = jobLines(doc, NOW);
  assert.equal(planner.ok, false);
  assert.match(planner.line, /last ran at \d\d:\d\d — it runs every 10 minutes, so something has stopped it/);
});

test('jobs never set up are left out, and the Claude panel lists the rest first', () => {
  assert.deepEqual(jobLines(fixture(), NOW), []);
  const ui = read('js/ui/claude.js');
  assert.match(ui, /section\('Background jobs'/);
  assert.match(ui, /jobLines\(/);
});

function read(p) { return readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'); }
