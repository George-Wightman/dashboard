// The Mind's records in data.json and the checks every Mind message passes
// (docs/superpowers/specs/2026-09-25-coach-mind-design.md).

process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, done, makeStore, clock } from './helpers.js';
import { at } from '../planner/time.js';
import {
  MIND_DEFAULTS, mindConfig, mindAlive, isQuiet, nextMindSlot, mindMessages, isMindTalk, messageKey, checkMessage,
  openAsks, nextAskId, pushSubscriptions, picture,
} from '../js/mind.js';

const THU = '2026-09-24';
const FRI = '2026-09-25';

function doc({ items = [], logs = [], calendar = {}, journal = [] } = {}) {
  const d = fixture({ items, logs, journal });
  for (const [id, r] of Object.entries(calendar)) d.calendar[id] = { id, status: 'active', source: 'planner', updated: '2026-09-24T06:00:00.000Z', ...r };
  return d;
}

test('mindConfig: the defaults, overlaid only with fields that make sense', () => {
  assert.deepEqual(mindConfig(doc()), MIND_DEFAULTS);
  assert.equal(MIND_DEFAULTS.enabled, false);
  assert.equal(MIND_DEFAULTS.models.think, 'gemini-flash-latest');
  const c = mindConfig(doc({ calendar: { 'mind:config': { pingsPerDay: 2, quietFrom: '23:00', bogus: 1, gapMinutes: -5, morningAt: '7am', enabled: true, models: { think: 'gemini-x' } } } }));
  assert.equal(c.pingsPerDay, 2);
  assert.equal(c.quietFrom, '23:00');
  assert.equal(c.gapMinutes, 45);
  assert.equal(c.morningAt, '07:00');
  assert.equal(c.enabled, true);
  assert.equal(c.bogus, undefined);
  assert.deepEqual(c.models, { think: 'gemini-x', check: 'gemini-flash-lite-latest' });
});

test('mindAlive: switched on and heard from in the last 75 minutes', () => {
  const now = at(THU, '12:00');
  const status = (mins) => ({ 'mind:status': { speaking: true, lastRun: new Date(now.getTime() - mins * 60000).toISOString() } });
  assert.equal(mindAlive(doc({ calendar: status(5) }), now), false);
  const on = { 'mind:config': { enabled: true } };
  assert.equal(mindAlive(doc({ calendar: { ...on, ...status(74) } }), now), true);
  assert.equal(mindAlive(doc({ calendar: { ...on, ...status(76) } }), now), false);
  assert.equal(mindAlive(doc({ calendar: on }), now), false);
  // Switched on but with no Gemini key, the background can't speak: the page keeps its openers.
  const mute = { 'mind:status': { speaking: false, lastRun: new Date(now.getTime() - 5 * 60000).toISOString() } };
  assert.equal(mindAlive(doc({ calendar: { ...on, ...mute } }), now), false);
});

test('isQuiet: the night, a closed day, and time off for everything', () => {
  const d = doc();
  assert.equal(isQuiet(d, at(THU, '23:10')), true);
  assert.equal(isQuiet(d, at(FRI, '02:00')), true);
  assert.equal(isQuiet(d, at(THU, '06:50')), true);
  assert.equal(isQuiet(d, at(THU, '07:00')), false);
  assert.equal(isQuiet(d, at(THU, '12:00')), false);
  assert.equal(isQuiet(doc({ calendar: { [`closed:${THU}`]: { day: THU, closed: true } } }), at(THU, '15:00')), true);
  // After midnight still belongs to the day that was closed.
  assert.equal(isQuiet(doc({ calendar: { [`closed:${THU}`]: { day: THU, closed: true }, 'mind:config': { quietFrom: '23:59', quietUntil: '00:01' } } }), at(FRI, '02:00')), true);
  const off = (areas) => doc({ calendar: { [`off:${THU}T07:30`]: { start: `${THU}T07:30`, end: `${THU}T12:00`, areas, reason: 'Slow morning' } } });
  assert.equal(isQuiet(off([]), at(THU, '09:00')), true);
  assert.equal(isQuiet(off([]), at(THU, '12:30')), false);
  assert.equal(isQuiet(off(['Job search']), at(THU, '09:00')), false);
  const wholeDay = doc({ calendar: { [`off:${THU}`]: { start: THU, end: THU, areas: [], reason: 'Day off' } } });
  assert.equal(isQuiet(wholeDay, at(THU, '14:00')), true);
});

test('Mind talks: their slots, their messages in order, and the ledger key', () => {
  const store = makeStore({ now: clock(at(THU, '10:00')) });
  assert.equal(nextMindSlot(store.doc(), THU, 'mind'), 'mind-1');
  store.saveJournal({ kind: 'talk', day: THU, slot: 'mind-1', messages: [{ who: 'coach', text: 'First', at: at(THU, '10:00').toISOString(), from: 'mind', by: 'gemini' }] }, 'mind');
  store.saveJournal({ kind: 'talk', day: THU, slot: 'deep-1', messages: [{ who: 'coach', text: 'Deep', at: at(THU, '09:00').toISOString(), from: 'mind', by: 'claude' }] }, 'claude');
  store.saveJournal({ kind: 'talk', day: THU, slot: 'own-1', messages: [{ who: 'george', text: 'Hi', at: at(THU, '08:00').toISOString() }] }, 'gemini');
  assert.equal(nextMindSlot(store.doc(), THU, 'mind'), 'mind-2');
  assert.equal(nextMindSlot(store.doc(), THU, 'deep'), 'deep-2');
  assert.throws(() => store.saveJournal({ kind: 'talk', day: THU, slot: 'mind-x', messages: [] }), /slot/);
  const list = mindMessages(store.doc(), THU);
  assert.deepEqual(list.map((x) => x.m.text), ['Deep', 'First']);
  assert.equal(list[1].talkId, `talk:${THU}:mind-1`);
  assert.equal(isMindTalk(store.doc().journal[`talk:${THU}:mind-1`]), true);
  assert.equal(isMindTalk(store.doc().journal[`talk:${THU}:own-1`]), false);
  assert.equal(messageKey(list[1].talkId, list[1].m), `talk:${THU}:mind-1|${at(THU, '10:00').toISOString()}`);
});

test('asks, push subscriptions and the picture are read from the calendar map', () => {
  const d = doc({ calendar: {
    [`ask:${THU}:1`]: { text: 'Rework my week', day: THU, at: at(THU, '10:00').toISOString() },
    [`ask:${THU}:2`]: { text: 'Old', day: THU, status: 'archived' },
    'push:abc': { endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: 'p', auth: 'a', label: 'phone' },
    'push:old': { endpoint: 'https://fcm.googleapis.com/fcm/send/y', p256dh: 'p', auth: 'a', status: 'archived' },
    'mind:picture': { text: 'Now: AC prep.', opener: { day: THU, text: 'Morning.' }, by: 'claude', at: at(THU, '06:30').toISOString() },
  } });
  assert.deepEqual(openAsks(d).map((a) => a.id), [`ask:${THU}:1`]);
  assert.equal(nextAskId(d, THU), `ask:${THU}:3`);
  assert.deepEqual(pushSubscriptions(d).map((s) => s.id), ['push:abc']);
  assert.equal(picture(d).text, 'Now: AC prep.');
  assert.equal(picture(doc()), null);
});

// ---- The checks -------------------------------------------------------------------------------

const rp3 = { id: 'rp3', type: 'task', title: 'Role play 3 - MILLRACE, timed', date: THU, area: 'Assessment centre', order: 1 };
const rp4 = { id: 'rp4', type: 'task', title: 'Role play 4 + write-up, fully timed', date: '2026-09-27', area: 'Assessment centre', order: 2 };
const gym = { id: 'gym', type: 'habit', title: 'Gym', repeat: { kind: 'perWeek', n: 5 }, order: 3 };
const walk = { id: 'walk', type: 'habit', title: 'Morning walk', repeat: { kind: 'daily' }, order: 4 };
const now = at(THU, '19:30');
const check = (d, text, extra = {}) => checkMessage(d, { today: THU, now, text, ...extra });

test('checkMessage: no claiming something is done that is not ticked', () => {
  const open = doc({ items: [rp3, rp4] });
  const r = check(open, 'Nice work finishing Role play 3 tonight. How did the recommendation land?');
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /Role play 3/);
  assert.equal(check(open, 'MILLRACE is done — what would you change?').ok, false);
  assert.equal(check(open, 'Did you get through MILLRACE?').ok, true, 'asking is fine');
  assert.equal(check(open, "You haven't finished MILLRACE yet; is tonight still realistic?").ok, true);
  const ticked = doc({ items: [rp3, rp4], logs: [done('rp3', THU, { source: 'claude' })] });
  assert.equal(check(ticked, 'Nice work finishing Role play 3 tonight.').ok, true);
  assert.equal(check(ticked, 'Role play 4 is done too, so that is two.').ok, false, 'a future task is not done either');
});

test('checkMessage: a clock time has to be one the plan or George gave', () => {
  const d = doc({ items: [rp3] });
  assert.equal(check(d, 'See you at 15:45 for the next one.').ok, false);
  const booked = structuredClone(d);
  booked.calendar.agenda = { id: 'agenda', status: 'active', source: 'planner', from: THU, blocks: [
    { key: 'k', start: at(THU, '15:45').toISOString(), end: at(THU, '16:45').toISOString(), items: ['rp3'], title: 'Role play 3', calendar: 'Application' },
  ], busy: [] };
  assert.equal(check(booked, 'See you at 15:45 for the next one.').ok, true);
  assert.equal(check(d, 'You said 7:30, so the walk first?', { georgeToday: ['I will start at 7:30'] }).ok, true);
});

test('checkMessage: an optional times-a-week habit is never a miss', () => {
  const d = doc({ items: [gym, walk], logs: [done('gym', '2026-09-21'), done('gym', '2026-09-22'), done('gym', '2026-09-23')] });
  assert.equal(check(d, 'You missed Gym today, which matters.').ok, false);
  assert.equal(check(d, 'You missed the Morning walk today — what got in the way?').ok, true);
});

test('checkMessage: length, emoji, and repeating itself', () => {
  const d = doc();
  assert.equal(check(d, 'x'.repeat(601)).ok, false);
  assert.equal(check(d, 'Great job 🎉').ok, false);
  const recent = ['Three role plays done this week, and the write-ups are getting faster each time.'];
  assert.equal(check(d, 'Three role plays done this week, and the write-ups getting faster each time!', { recent }).ok, false);
  assert.equal(check(d, 'The scenario primer moved to Saturday. Is Friday afternoon free for it instead?', { recent }).ok, true);
  assert.equal(check(d, '').ok, false);
});
