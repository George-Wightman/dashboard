// Reflexes: Gemini reads what just happened from two or three angles at once, drafts one message,
// and checks it twice before the Coach says anything. And the openers, written by the background.

process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, clock, done } from './helpers.js';
import { at } from '../planner/time.js';
import { emptyMind } from '../js/mind-state.js';
import { MIND_DEFAULTS } from '../js/mind.js';
import {
  pickGroups, anglesFor, groupText, runChain, runReflexes, backgroundOpenerDue, writeOpener, MIND_SYSTEM,
} from '../planner/reflex.js';

const THU = '2026-09-24';
const config = { ...MIND_DEFAULTS, models: { ...MIND_DEFAULTS.models }, enabled: true };

function world(now = at(THU, '19:30')) {
  const store = makeStore({ now: clock(now) });
  const goal = store.addGoal({ title: 'Smash Assessment Center', targetDate: '2026-10-05' });
  const rp3 = store.addItem({ type: 'task', title: 'Role play 3 - MILLRACE, timed', date: THU, area: 'Assessment centre', goalId: goal.id });
  const rp4 = store.addItem({ type: 'task', title: 'Role play 4 + write-up, fully timed', date: '2026-09-27', area: 'Assessment centre', goalId: goal.id });
  store.toggleDone(rp3.id, THU, 'claude');
  return { store, goal, rp3, rp4, now };
}

function tickEvent(w, extra = {}) {
  return {
    id: `tick:${w.rp3.id}`, at: w.now.toISOString(), kind: 'tick', level: 3, by: 'claude', day: THU,
    refs: { itemId: w.rp3.id, goalId: w.goal.id }, text: 'Claude ticked "Role play 3 - MILLRACE, timed" (Assessment centre) at 19:23',
    facts: ['Goal "Smash Assessment Center", due Mon 5 Oct (11 days); 1 of 7 milestones done'],
    artefacts: [{ name: 'RP3_debrief.md', path: 'Job Search/IDADP/Practice/RP3_MILLRACE/RP3_debrief.md', modified: '2026-09-24T18:22:54.000Z', text: 'Recommendation came late again, same as HALYARD.' }],
    reflex: null, deep: null, ...extra,
  };
}

// A scripted Gemini: each question is answered by the first rule whose pattern its prompt matches.
function fakeGemini(rules, { flash = false } = {}) {
  const asked = [];
  return {
    asked,
    available: (role) => (role === 'think' ? flash : true),
    async ask(questions) {
      asked.push(questions);
      return questions.map((q) => {
        const rule = rules.find(([re]) => re.test(q.prompt));
        if (!rule) return { error: 'server' };
        const out = typeof rule[1] === 'function' ? rule[1](q) : rule[1];
        return out.error ? out : { data: out, model: q.model };
      });
    },
  };
}

const GOOD = [
  [/Angle: progress/, { notes: 'Third role play; debrief says the recommendation came late again.', matters: 3 }],
  [/Angle: pattern/, { notes: 'Late recommendation in both HALYARD and MILLRACE.', matters: 2 }],
  [/Angle: plan/, { notes: 'RP4 on Sunday is the next chance.', matters: 2 }],
  [/Now decide what the Coach says/, { say: true, text: 'MILLRACE is ticked, three role plays in. Your debrief says the recommendation came late again, same as HALYARD. Want Sunday\'s RP4 to open with a two-minute recommendation drill?', notify: true, escalate: false, why: 'A repeated weakness with a fix' }],
  [/The message:/, { ok: true, problems: [], text: '' }],
];

test('pickGroups: one subject per goal, level 3 now, level 2 once settled, nothing stale, at most two', () => {
  const now = at(THU, '19:30');
  const m = emptyMind();
  const e = (id, level, minsAgo, refs, kind = 'tick') => ({ id, at: new Date(now.getTime() - minsAgo * 60000).toISOString(), kind, level, refs, reflex: null, deep: null });
  m.events.a = e('a', 3, 5, { goalId: 'g1', itemId: 'x' });
  m.events.b = e('b', 2, 2, { goalId: 'g1', itemId: 'y' });
  m.events.c = e('c', 2, 10, { itemId: 'z' }, 'slip');
  m.events.d = e('d', 3, 240, { itemId: 'old' });
  m.events.f = e('f', 3, 1, { askId: 'q' }, 'ask');
  m.events.g = e('g', 1, 60, { itemId: 'w' });
  let groups = pickGroups(m, now);
  assert.deepEqual(groups.map((g) => [g.key, g.level, g.events.map((x) => x.id).sort().join()]), [['g1', 3, 'a,b']]);
  groups = pickGroups(m, new Date(now.getTime() + 15 * 60000));
  assert.deepEqual(groups.map((g) => g.key), ['g1', 'z']);
  assert.equal(pickGroups(m, new Date(now.getTime() + 15 * 60000), 1).length, 1);
});

test('anglesFor: progress and pattern for a tick, plan too when the goal is a week away', () => {
  const w = world();
  const g = { events: [tickEvent(w)] };
  assert.deepEqual(anglesFor(g, w.store.doc(), THU), ['progress', 'pattern']);
  assert.deepEqual(anglesFor(g, w.store.doc(), '2026-09-29'), ['progress', 'pattern', 'plan']);
  assert.deepEqual(anglesFor({ events: [{ kind: 'pushed', refs: {} }] }, w.store.doc(), THU), ['plan', 'pattern']);
  assert.deepEqual(anglesFor({ events: [{ kind: 'calendar', refs: {} }] }, w.store.doc(), THU), ['plan']);
});

test('with Flash to hand: one call, thinking hard, weighs every angle with the debrief and decides; Lite checks it', async () => {
  const w = world();
  const deep = { notes: { progress: 'Third role play; recommendation late again.', pattern: 'Same as HALYARD.', plan: 'RP4 Sunday.' },
    say: true, text: 'MILLRACE is ticked, three in. Your debrief says the recommendation came late again, as in HALYARD. Open RP4 with a two-minute drill?', notify: true };
  const gemini = fakeGemini([[/Think this through properly/, deep], ...GOOD], { flash: true });
  const r = await runChain({ gemini, doc: w.store.doc(), group: { level: 3, events: [tickEvent(w)] }, now: w.now, today: THU });
  assert.equal(gemini.asked.length, 2, 'one deep call, one check');
  const [q] = gemini.asked[0];
  assert.deepEqual([q.model, q.think, q.system === MIND_SYSTEM], ['think', true, true]);
  assert.match(q.prompt, /Angle: progress[\s\S]*Angle: pattern[\s\S]*Angle: plan/);
  assert.match(q.prompt, /Recommendation came late again/);
  assert.equal(gemini.asked[1][0].model, 'check');
  assert.deepEqual([r.say, r.depth, r.calls, r.notify], [true, 'deep', 2, true]);
});

test('without Flash (its allowance spent, or busy): Lite reads the angles in parallel, then drafts', async () => {
  const w = world();
  const gemini = fakeGemini(GOOD);
  const r = await runChain({ gemini, doc: w.store.doc(), group: { level: 3, events: [tickEvent(w)] }, now: w.now, today: THU });
  assert.equal(gemini.asked[0].length, 2, 'both angles in one go');
  assert.ok(gemini.asked[0].every((q) => q.model === 'check' && q.system === MIND_SYSTEM));
  assert.equal(r.depth, 'lite');
  // Flash that fails on the day falls back the same way.
  const failing = fakeGemini([[/Think this through properly/, { error: 'quota' }], ...GOOD], { flash: true });
  const f = await runChain({ gemini: failing, doc: w.store.doc(), group: { level: 3, events: [tickEvent(w)] }, now: w.now, today: THU });
  assert.deepEqual([f.say, f.depth, f.calls], [true, 'lite', 5]);
  assert.ok(gemini.asked[0].every((q) => q.prompt.includes('Recommendation came late again')));
  assert.ok(gemini.asked[0][0].prompt.includes('Ticked off today'), 'the Coach\'s whole context comes along');
  assert.equal(gemini.asked[2][0].model, 'check');
  assert.equal(r.say, true);
  assert.match(r.text, /MILLRACE/);
  assert.equal(r.notify, true);
  assert.equal(r.calls, 4);
});

test('the critic catches a false claim and its correction is used; a correction that is still wrong says nothing', async () => {
  const w = world();
  const claim = 'MILLRACE and Role play 4 are both done — how did they compare?';
  const rules = [...GOOD.slice(0, 3), [/Now decide what the Coach says/, { say: true, text: claim, notify: true }]];
  let gemini = fakeGemini([...rules, [/The message:/, { ok: false, problems: ['RP4 is not ticked'], text: 'MILLRACE is ticked. How did it compare with HALYARD?' }]]);
  let r = await runChain({ gemini, doc: w.store.doc(), group: { level: 3, events: [tickEvent(w)] }, now: w.now, today: THU });
  assert.equal(r.say, true);
  assert.equal(r.text, 'MILLRACE is ticked. How did it compare with HALYARD?');
  gemini = fakeGemini([...rules, [/The message:/, { ok: false, problems: ['RP4 is not ticked'], text: 'Role play 4 is done too, well done.' }]]);
  r = await runChain({ gemini, doc: w.store.doc(), group: { level: 3, events: [tickEvent(w)] }, now: w.now, today: THU });
  assert.equal(r.say, false);
  assert.ok(r.problems.some((p) => /Role play 4/.test(p)));
  // The plain-code check alone catches it even when the critic is unavailable.
  gemini = fakeGemini([...rules, [/The message:/, { error: 'quota' }]]);
  r = await runChain({ gemini, doc: w.store.doc(), group: { level: 3, events: [tickEvent(w)] }, now: w.now, today: THU });
  assert.equal(r.say, false);
});

test('Gemini only ever sees a health label, never the numbers', async () => {
  const w = world();
  const e = tickEvent(w, { kind: 'sleep', artefacts: [], health: { label: 'short night', detail: { sleepMinutes: 340, hrv: 31 } } });
  const gemini = fakeGemini(GOOD);
  await runChain({ gemini, doc: w.store.doc(), group: { level: 3, events: [e] }, now: w.now, today: THU });
  const prompts = gemini.asked.flat().map((q) => q.prompt).join('\n');
  assert.match(prompts, /short night/);
  assert.doesNotMatch(prompts, /340|sleepMinutes|hrv/);
  assert.match(groupText({ events: [e] }, { forGemini: false }), /sleepMinutes/);
});

test('runReflexes: the message lands in its own talk, the events are stamped, and the caps hold', async () => {
  const w = world();
  const mind = emptyMind();
  mind.events.t = { ...tickEvent(w), id: 't' };
  const gemini = fakeGemini(GOOD);
  let r = await runReflexes({ gemini, store: w.store, mind, now: w.now, config });
  assert.equal(r.said.length, 1);
  const talk = w.store.doc().journal[`talk:${THU}:mind-1`];
  assert.equal(talk.source, 'mind');
  assert.deepEqual({ ...talk.messages[0], text: '' }, { who: 'coach', text: '', at: w.now.toISOString(), from: 'mind', by: 'gemini', notify: true, ref: ['t'] });
  assert.equal(mind.events.t.reflex, w.now.toISOString());
  assert.equal(mind.budget.messages, 1);
  assert.equal(Object.values(mind.runs)[0].said, true);

  // Quiet: still said, but no buzz.
  const w2 = world();
  const m2 = emptyMind();
  m2.events.t = { ...tickEvent(w2), id: 't' };
  r = await runReflexes({ gemini: fakeGemini(GOOD), store: w2.store, mind: m2, now: w2.now, config, quiet: true });
  assert.equal(r.said[0].m.notify, false);

  // At the day's limit: looked at, nothing said.
  const w3 = world();
  const m3 = emptyMind();
  m3.events.t = { ...tickEvent(w3), id: 't' };
  m3.budget = { ...m3.budget, day: THU, messages: 8 };
  r = await runReflexes({ gemini: fakeGemini(GOOD), store: w3.store, mind: m3, now: w3.now, config });
  assert.equal(r.said.length, 0);
  assert.ok(m3.events.t.reflex);

  // A level-2 subject waits out the gap after the last message; a level-3 one doesn't.
  const w4 = world();
  const m4 = emptyMind();
  m4.budget = { ...m4.budget, day: THU, messages: 1, lastSaid: new Date(w4.now.getTime() - 30 * 60000).toISOString() };
  m4.events.s = { ...tickEvent(w4), id: 's', kind: 'slip', level: 2, at: new Date(w4.now.getTime() - 25 * 60000).toISOString(), artefacts: [] };
  r = await runReflexes({ gemini: fakeGemini(GOOD), store: w4.store, mind: m4, now: w4.now, config });
  assert.equal(r.said.length, 0, 'held back by the 45-minute gap');
});

test('a draft asking for a re-plan sends its events to Claude', async () => {
  const w = world();
  const mind = emptyMind();
  mind.events.t = { ...tickEvent(w), id: 't' };
  const rules = [...GOOD.slice(0, 3), [/Now decide what the Coach says/, { say: false, escalate: true, why: 'The week no longer fits' }]];
  const r = await runReflexes({ gemini: fakeGemini(rules), store: w.store, mind, now: w.now, config });
  assert.deepEqual(r.escalate, ['t']);
  assert.equal(r.said.length, 0);
});

test('backgroundOpenerDue: morning from 07:00 until noon, evening from 18:00, once each, never on a closed day', () => {
  const w = world(at(THU, '06:59'));
  const doc = () => w.store.doc();
  const due = (hhmm) => backgroundOpenerDue({ doc: doc(), now: at(THU, hhmm), config });
  assert.equal(due('06:59'), null);
  assert.equal(due('07:00'), 'morning');
  assert.equal(due('11:59'), 'morning');
  assert.equal(due('12:00'), null);
  assert.equal(due('18:00'), 'evening');
  w.store.saveJournal({ kind: 'talk', day: THU, slot: 'evening', messages: [{ who: 'coach', text: 'How did today go?', at: at(THU, '18:00').toISOString() }] });
  assert.equal(due('18:30'), null);
  w.store.putCalendar(`closed:${THU}`, { day: THU, closed: true });
  assert.equal(due('07:30'), null);
});

test('writeOpener: Claude\'s morning opener when it holds up, otherwise Gemini, otherwise the plain line', async () => {
  const w = world(at(THU, '07:05'));
  w.store.putCalendar('mind:picture', { text: 'Now: AC fortnight.', opener: { day: THU, text: 'Morning. MILLRACE tonight is the one that matters — what does the day look like?' }, by: 'claude', at: at(THU, '06:30').toISOString() }, 'claude');
  let r = await writeOpener({ gemini: fakeGemini([]), store: w.store, slot: 'morning', now: at(THU, '07:05'), config });
  assert.equal(r.m.by, 'claude');
  assert.equal(r.m.notify, true);
  assert.equal(w.store.doc().journal[`talk:${THU}:morning`].messages[0].text, 'Morning. MILLRACE tonight is the one that matters — what does the day look like?');

  const w2 = world(at(THU, '07:05'));
  w2.store.putCalendar('mind:picture', { text: 'x', opener: { day: THU, text: 'Role play 4 is done already — great start.' }, by: 'claude', at: at(THU, '06:30').toISOString() }, 'claude');
  r = await writeOpener({ gemini: fakeGemini([[/It's the morning/, { text: 'Morning. Role play 3 is tonight — how is the day shaping up?' }]]), store: w2.store, slot: 'morning', now: at(THU, '07:05'), config });
  assert.equal(r.m.by, 'gemini');
  assert.match(r.m.text, /Role play 3 is tonight/);

  const w3 = world(at(THU, '18:01'));
  r = await writeOpener({ gemini: fakeGemini([]), store: w3.store, slot: 'evening', now: at(THU, '18:01'), config, quiet: true });
  assert.equal(r.m.by, 'plain');
  assert.equal(r.m.text, 'How did today go?');
  assert.equal(r.m.notify, false);
});

// ---- 25 Sep: his own rearranging, and the day's allowance -------------------------------------

test('his calendar edits wait until the calendar has been still for half an hour, then are one subject', () => {
  const now = at(THU, '11:30');
  const m = emptyMind();
  const e = (id, kind, level, minsAgo, refs = {}) => ({ id, at: new Date(now.getTime() - minsAgo * 60000).toISOString(), kind, level, by: 'calendar', refs, reflex: null, deep: null });
  m.events.m1 = e('m1', 'moved', 1, 90, { itemId: 'self', goalId: 'ac' });
  m.events.m2 = e('m2', 'moved', 2, 50, { itemId: 'rp4', goalId: 'ac' });
  m.events.m3 = e('m3', 'moved', 1, 10, { itemId: 'mock', goalId: 'ac' });
  assert.deepEqual(pickGroups(m, now), [], 'still rearranging: ten minutes since the last move');
  const later = new Date(now.getTime() + 25 * 60000);
  const [g] = pickGroups(m, later);
  assert.equal(g.key, 'rearranged');
  assert.deepEqual(g.events.map((x) => x.id).sort(), ['m1', 'm2', 'm3'], 'the whole morning, judged together');
  // Moves within the day alone are never a subject.
  const quiet = emptyMind();
  quiet.events.m1 = e('m1', 'moved', 1, 90, { itemId: 'self' });
  assert.deepEqual(pickGroups(quiet, later), []);
  assert.match(MIND_SYSTEM, /judge the day as it stands now, not each move/);
  assert.match(MIND_SYSTEM, /never ask him to retell how it went/);
});

test('minor things get two messages a day, and two are kept for the evening', async () => {
  const minor = (w) => ({ ...tickEvent(w), id: 'minor', level: 2, at: new Date(w.now.getTime() - 25 * 60000).toISOString() });
  let w = world(at(THU, '14:00'));
  let m = emptyMind();
  m.events.x = minor(w);
  m.budget = { ...m.budget, day: THU, messages: 2, minor: 2 };
  let r = await runReflexes({ gemini: fakeGemini(GOOD), store: w.store, mind: m, now: w.now, config });
  assert.equal(r.said.length, 0, 'two minor messages already today');

  w = world(at(THU, '14:00'));
  m = emptyMind();
  m.events.t = { ...tickEvent(w), id: 't' };
  m.budget = { ...m.budget, day: THU, messages: config.messagesPerDay - 2 };
  r = await runReflexes({ gemini: fakeGemini(GOOD), store: w.store, mind: m, now: w.now, config });
  assert.equal(r.said.length, 0, 'the last two are kept for the evening');

  w = world(at(THU, '19:30'));
  m = emptyMind();
  m.events.t = { ...tickEvent(w), id: 't' };
  m.budget = { ...m.budget, day: THU, messages: config.messagesPerDay - 2 };
  r = await runReflexes({ gemini: fakeGemini(GOOD), store: w.store, mind: m, now: w.now, config });
  assert.equal(r.said.length, 1, 'and used in the evening');

  w = world(at(THU, '19:30'));
  m = emptyMind();
  m.events.x = minor(w);
  r = await runReflexes({ gemini: fakeGemini(GOOD), store: w.store, mind: m, now: w.now, config });
  assert.equal(r.said.length, 1);
  assert.equal(m.budget.minor, 1);
  assert.equal(r.said[0].m.notify, false, 'minor things never buzz the phone');
});

test('when Flash hands the question to Lite, Lite goes through its own steps', async () => {
  const w = world();
  const ev = { ...tickEvent(w), id: 't' };
  const rules = [
    [/Think this through properly/, (q) => ({ data: { say: true, text: 'A one-shot answer from Lite standing in.' }, model: 'lite', role: 'check' })],
    ...GOOD,
  ];
  const gemini = fakeGemini(rules, { flash: true });
  gemini.ask = async (questions) => questions.map((q) => {
    const rule = rules.find(([re]) => re.test(q.prompt));
    const out = typeof rule[1] === 'function' ? rule[1](q) : { data: rule[1], model: q.model, role: q.model };
    return out;
  });
  const r = await runChain({ gemini, doc: w.store.doc(), group: { key: 'g', kind: 'tick', level: 3, events: [ev] }, now: w.now, today: THU });
  assert.equal(r.depth, 'lite');
  assert.match(r.text, /MILLRACE is ticked, three role plays in/, "Lite's own draft, not its one-shot answer");
});
