process.env.TZ = 'UTC'; // the sandbox's zone; the tool counts days in London time itself

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../claude/cli.js';
import { createFileStore } from '../claude/files.js';
import { FakeGitHub, ids, fixture, fakeApi, makeStore, clock, done } from './helpers.js';
import { emptyMind } from '../js/mind-state.js';
import { netEdits } from '../js/coach-session.js';
import { configFromEnv, checkMindBatch, mindPack, makeMindOps, applyHandled } from '../claude/mind.js';
import { runOp } from '../claude/ops.js';

const KEY = 'github_pat_TESTKEY0123456789abcdef';
const CONFIG = JSON.stringify({ token: KEY, repo: 'George-Wightman/dashboard-sync', dayStartHour: 4, timeZone: 'Europe/London' });
const EVENING = () => new Date('2026-09-24T18:30:00Z'); // Thursday, 19:30 in London
const THU = '2026-09-24';

function doc() {
  const d = fixture({
    goals: [{ id: 'ac', title: 'Smash Assessment Center', targetDate: '2026-10-05', order: 1 }],
    items: [
      { id: 'role3', type: 'task', title: 'Role play 3 - MILLRACE, timed', date: THU, area: 'Assessment centre', goalId: 'ac', order: 1 },
      { id: 'role4', type: 'task', title: 'Role play 4 + write-up, fully timed', date: '2026-09-27', area: 'Assessment centre', goalId: 'ac', order: 2 },
    ],
    logs: [done('role3', THU, { source: 'claude' })],
  });
  return d;
}

function mindFile() {
  const m = emptyMind();
  m.cursor = { at: '2026-09-24T18:00:00.000Z' };
  m.events['tick:done-role3'] = { id: 'tick:done-role3', at: '2026-09-24T18:25:00.000Z', kind: 'tick', level: 3, by: 'claude', day: THU, refs: { itemId: 'role3', goalId: 'ac' },
    text: 'Claude ticked "Role play 3 - MILLRACE, timed" at 19:23', facts: ['Goal "Smash Assessment Center", due Mon 5 Oct (11 days)'],
    artefacts: [{ name: 'RP3_debrief.md', path: 'Job Search/IDADP/Practice/RP3_MILLRACE/RP3_debrief.md', modified: '2026-09-24T18:22:00.000Z', text: 'Recommendation came late again.' }],
    health: { label: 'short night', detail: { sleepMinutes: 340 } }, reflex: '2026-09-24T18:30:00.000Z', deep: null };
  m.events.old = { id: 'old', at: '2026-09-23T10:00:00.000Z', kind: 'flag', level: 1, by: 'me', day: '2026-09-23', refs: {}, text: 'An older flag', facts: [], reflex: null, deep: '2026-09-23T20:30:00.000Z' };
  return m;
}

function setup() {
  const remote = new FakeGitHub();
  remote.file = { doc: doc(), sha: 's0' };
  const mindRemote = new FakeGitHub();
  mindRemote.file = { doc: mindFile(), sha: 'm0' };
  const files = createFileStore({ token: 'x', repo: 'o/r', fetch: fakeApi() });
  const run = (argv, { stdin = '', env = {}, config = CONFIG } = {}) => main({
    argv: ['--config', 'config.json', ...argv], readText: () => config, readStdin: async () => stdin,
    makeClient: ({ path }) => (path === 'mind.json' ? mindRemote : remote), makeFiles: () => files, now: EVENING, newId: ids('n'), env,
  });
  return { remote, mindRemote, run };
}

test('--config env: a routine has its key in the environment, not a file', async () => {
  assert.deepEqual(configFromEnv({ DASHBOARD_TOKEN: KEY }), { token: KEY, repo: 'George-Wightman/dashboard-sync', dayStartHour: 4, timeZone: 'Europe/London' });
  assert.throws(() => configFromEnv({}), /DASHBOARD_TOKEN isn't set/);
  const s = setup();
  const r = await main({
    argv: ['--config', 'env', 'today'], readText: () => { throw new Error('no files here'); }, readStdin: async () => '',
    makeClient: () => s.remote, now: EVENING, newId: ids('n'), env: { DASHBOARD_TOKEN: KEY },
  });
  assert.equal(r.code, 0);
  assert.match(r.text, /^Today is Thursday 24 September/);
  const none = await main({ argv: ['--config', 'env', 'today'], readText: () => '', readStdin: async () => '', makeClient: () => s.remote, now: EVENING, env: {} });
  assert.deepEqual(none, { code: 1, text: "DASHBOARD_TOKEN isn't set in this environment, so the dashboard can't be reached" });
});

test('mind: the whole context for a deep run, with only what it has yet to look at', async () => {
  const s = setup();
  const r = await s.run(['mind']);
  assert.equal(r.code, 0);
  for (const heading of ['Your picture of George', 'Settings and today', 'What happened since your last deep run (1)', 'Today, as the Coach sees it',
    'The week as booked', 'Goals', 'Needs attention', 'Conversations, the last three days', 'Journal', 'Open flags', 'How to answer']) {
    assert.ok(r.text.includes(`## ${heading}`), heading);
  }
  assert.match(r.text, /Recommendation came late again/);
  assert.match(r.text, /sleepMinutes/, 'Claude sees health in full');
  assert.doesNotMatch(r.text, /An older flag/, 'already handled by a deep run');
  assert.match(r.text, /The Mind is OFF/);
  assert.equal(s.remote.puts, 0);
  assert.equal(s.mindRemote.puts, 0);
});

test('apply --mind refuses anything but the Mind\'s ops, and more than its share, before anything runs', async () => {
  const s = setup();
  let r = await s.run(['apply', '--mind'], { stdin: JSON.stringify([{ op: 'say', text: 'How did MILLRACE go?' }, { op: 'task', title: 'Sneaky' }]) });
  assert.equal(r.code, 1);
  assert.match(r.text, /only picture, say, propose, brief, guide, flag, handoff, handled are allowed — "task" isn't/);
  assert.equal(s.remote.puts, 0);
  r = await s.run(['apply', '--mind'], { stdin: JSON.stringify([1, 2, 3].map((n) => ({ op: 'say', text: `Question ${n}?` }))) });
  assert.match(r.text, /at most 2 says/);
  assert.throws(() => checkMindBatch([{ op: 'handled', events: 'all', summary: 'a' }, { op: 'handled', events: 'all', summary: 'b' }]), /at most 1 handled/);
  assert.doesNotThrow(() => checkMindBatch([{ op: 'picture', text: 'x' }, { op: 'say', text: 'y' }, { op: 'propose', text: 'z', ops: [] }, { op: 'brief', text: 'b' }, { op: 'handled', events: 'all', summary: 's' }]));
});

test('say: a checked message in a conversation of its own; a false claim is refused', async () => {
  const s = setup();
  let r = await s.run(['apply', '--mind'], { stdin: JSON.stringify([
    { op: 'say', text: 'MILLRACE is ticked — three of seven. Your debrief says the recommendation came late again; open RP4 with a two-minute drill?', notify: true, ref: ['tick:done-role3'] },
    { op: 'say', text: 'And one for tomorrow: the scenario primer is the first thing booked.' },
  ]) });
  assert.equal(r.code, 0, r.text);
  const j = s.remote.file.doc.journal;
  const m = j[`talk:${THU}:deep-1`].messages[0];
  assert.deepEqual({ ...m, text: '' }, { who: 'coach', text: '', at: EVENING().toISOString(), from: 'mind', by: 'claude', notify: true, ref: ['tick:done-role3'] });
  assert.equal(j[`talk:${THU}:deep-2`].messages[0].notify, false);
  assert.equal(j[`talk:${THU}:deep-1`].source, 'claude');
  r = await s.run(['apply', '--mind'], { stdin: JSON.stringify({ op: 'say', text: 'Role play 4 is done as well, brilliant.' }) });
  assert.equal(r.code, 1);
  assert.match(r.text, /doesn't stand up: Says "Role play 4 \+ write-up, fully timed" is done/);
});

test('propose: a change George applies with one tap — and nothing moves until he does', async () => {
  const s = setup();
  const r = await s.run(['apply', '--mind'], { stdin: JSON.stringify({
    op: 'propose', text: 'RP4 fits better on Saturday morning, before the half day.', ops: [{ op: 'edit', id: 'role4', set: { date: '2026-09-26' } }],
  }) });
  assert.equal(r.code, 0, r.text);
  const d = s.remote.file.doc;
  assert.equal(d.items.role4.date, '2026-09-27', 'unchanged until Apply');
  const talk = d.journal[`talk:${THU}:deep-1`];
  const p = talk.proposal;
  const edits = netEdits(p.before, p.after);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].after.date, '2026-09-26');
  // Apply, as the Coach panel does.
  const store = makeStore({ now: clock(EVENING()) });
  store.replaceDoc(d);
  store.commitDraft(p.before, p.after, 'Applied');
  assert.equal(store.doc().items.role4.date, '2026-09-26');
  const bad = await s.run(['apply', '--mind'], { stdin: JSON.stringify({ op: 'propose', text: 'Tick it for him.', ops: [{ op: 'done', id: 'role4' }] }) });
  assert.match(bad.text, /A proposal can only task, edit, archive — not "done"/);
});

test('picture: Claude\'s standing understanding, capped, with an opener for the morning', async () => {
  const s = setup();
  let r = await s.run(['apply', '--mind'], { stdin: JSON.stringify({ op: 'picture', text: 'x'.repeat(4001) }) });
  assert.match(r.text, /at most 4000 characters/);
  r = await s.run(['apply', '--mind'], { stdin: JSON.stringify({ op: 'picture', text: 'Now: AC fortnight, day 4.\nPatterns: late starts after shifts (18, 21, 24 Sep).', opener: { day: 'tomorrow', text: 'Morning. Scenario primer first — what does the day look like?' } }) });
  assert.equal(r.code, 0, r.text);
  const pic = s.remote.file.doc.calendar['mind:picture'];
  assert.match(pic.text, /late starts after shifts/);
  assert.deepEqual(pic.opener, { day: '2026-09-25', text: 'Morning. Scenario primer first — what does the day look like?' });
  assert.equal(pic.by, 'claude');
});

test('handled: the events stamped in mind.json and the run recorded, once everything else is saved', async () => {
  const s = setup();
  const r = await s.run(['apply', '--mind'], { stdin: JSON.stringify([
    { op: 'say', text: 'How did MILLRACE compare with HALYARD?' },
    { op: 'handled', events: 'all', summary: 'MILLRACE done; watching the late recommendation.' },
  ]), env: { MIND_TRIGGER: 'ask' } });
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /mind\.json: 1 event marked as handled\./);
  const m = s.mindRemote.file.doc;
  assert.equal(m.events['tick:done-role3'].deep, EVENING().toISOString());
  const run = Object.values(m.runs).find((x) => x.engine === 'deep');
  assert.deepEqual({ trigger: run.trigger, events: run.events, summary: run.summary }, { trigger: 'ask', events: ['tick:done-role3'], summary: 'MILLRACE done; watching the late recommendation.' });
  assert.deepEqual(m.cursor, { at: '2026-09-24T18:00:00.000Z' }, "the planner's cursor is left alone");
  assert.equal(s.remote.file.doc.calendar['mind:status'].lastDeep, EVENING().toISOString());
  assert.equal(Object.values(s.remote.file.doc.changes).some((c) => /Deep run recorded/.test(c.summary)), false, 'not a change George needs to see');
});

test('mind (settings): checked and merged', async () => {
  const s = setup();
  let r = await s.run(['apply'], { stdin: JSON.stringify({ op: 'mind', enabled: true, pingsPerDay: 4, models: { think: 'gemini-flash-latest' } }) });
  assert.equal(r.code, 0, r.text);
  r = await s.run(['apply'], { stdin: JSON.stringify({ op: 'mind', quietFrom: '23:00' }) });
  const c = s.remote.file.doc.calendar['mind:config'];
  assert.equal(c.enabled, true);
  assert.equal(c.pingsPerDay, 4);
  assert.equal(c.quietFrom, '23:00');
  r = await s.run(['apply'], { stdin: JSON.stringify({ op: 'mind', morningAt: '7am' }) });
  assert.match(r.text, /morningAt is a time like "07:00"/);
  r = await s.run(['apply'], { stdin: JSON.stringify({ op: 'mind', volume: 11 }) });
  assert.match(r.text, /The Mind has no setting "volume"/);
});

test('mindPack and the ops work without the command line too', () => {
  const store = makeStore({ now: clock(EVENING()) });
  store.replaceDoc(doc());
  const text = mindPack(store.doc(), mindFile(), EVENING(), store.today());
  assert.match(text, /^# The Coach's deep mind — Thursday 24 September/);
  const ops = makeMindOps(runOp);
  assert.match(ops.say(store, { text: 'How did it go?' }), /^Said to George \(deep-1\)/);
  const m = mindFile();
  assert.equal(applyHandled(m, { events: ['tick:done-role3', 'nope'], summary: 's' }, EVENING()), 1);
});
