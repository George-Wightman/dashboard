process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { talkGemini, GeminiError, MESSAGES } from '../js/gemini.js';
import { coachTools, TOOL_DECLARATIONS } from '../js/coach-tools.js';
import {
  momentAt, openerDue, waitingOpener, talkContents, cleanEntry, slippedItems, talkOf, entryOf, nextOwnSlot, talkContext, TALK_SYSTEM,
} from '../js/talk.js';
import { sendMessage, openMoment, finishTalk, talkNow, editEntry, saveEdit, removeEntry } from '../js/ui/coach.js';
import { rowsForDay, streak } from '../js/schedule.js';
import { READS } from '../claude/read.js';
import { runOp } from '../claude/ops.js';
import { at } from '../planner/time.js';
import { makeStore, clock } from './helpers.js';

const KEY = 'AIzaSy-test-SECRET-123';
const THU = '2026-09-17';
const FRI = '2026-09-18';

// A store on Thursday 17 Sep (09:00 by default) with a task today, one next week, a habit and a
// weekly target. Ids read item-1 … so the Coach's tools can find them.
function coachStore(time = '09:00') {
  const now = clock(at(THU, time));
  const store = makeStore({ now, prefix: 'item-' });
  const cv = store.addItem({ type: 'task', title: 'Update CV', date: THU, area: 'Job search' });
  const later = store.addItem({ type: 'task', title: 'Later thing', date: '2026-09-24' });
  const heb = store.addItem({ type: 'habit', title: 'Learn Hebrew', created: '2026-09-10' });
  const apps = store.addItem({ type: 'quota', title: 'Applications', target: 5 });
  return { store, now, cv, later, heb, apps };
}

// ---- talkGemini ----------------------------------------------------------------------------------

const res = (status, body) => ({ status, ok: status < 300, text: async () => JSON.stringify(body) });
const says = (text, extra = []) => res(200, { candidates: [{ content: { role: 'model', parts: [...extra, { text }] } }] });
const wants = (...calls) => res(200, { candidates: [{ content: { role: 'model', parts: calls.map(([name, args]) => ({ functionCall: { name, args } })) } }] });

// Answers each request with the next step of the script; records every request.
function script(...steps) {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body) });
    const step = steps[seen.length - 1];
    if (!step) throw new Error(`unexpected request ${seen.length}`);
    return step;
  };
  fetch.seen = seen;
  return fetch;
}
const timers = { setTimeout: () => 0, clearTimeout() {} };
const hello = [{ role: 'user', parts: [{ text: 'add call Mum' }] }];

test("talkGemini: a tool call is carried out, its result goes back, and the Coach's words come last", async () => {
  const fetch = script(wants(['add_task', { title: 'Call Mum', day: 'today' }]), says('Added it.', [{ text: 'thinking…', thought: true }]));
  const ran = [];
  const r = await talkGemini({
    keys: [KEY], system: 'S', contents: hello, tools: [{ name: 'add_task' }], fetch, timers,
    run: async (name, args) => { ran.push([name, args]); return { ok: true, did: 'Added "Call Mum"' }; },
  });
  assert.equal(r.text, 'Added it.', 'thought parts are left out');
  assert.deepEqual(ran, [['add_task', { title: 'Call Mum', day: 'today' }]]);
  assert.deepEqual(r.calls, [{ name: 'add_task', args: { title: 'Call Mum', day: 'today' }, result: { ok: true, did: 'Added "Call Mum"' } }]);
  const [first, second] = fetch.seen;
  assert.match(first.url, /gemini-flash-lite-latest:generateContent\?key=/);
  assert.deepEqual(first.body.tools, [{ functionDeclarations: [{ name: 'add_task' }] }]);
  assert.equal(first.body.systemInstruction.parts[0].text, 'S');
  assert.equal(first.body.generationConfig.responseMimeType, undefined, 'words, not JSON');
  assert.deepEqual(second.body.contents.slice(1), [
    { role: 'model', parts: [{ functionCall: { name: 'add_task', args: { title: 'Call Mum', day: 'today' } } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'add_task', response: { ok: true, did: 'Added "Call Mum"' } } }] },
  ]);
});

test('talkGemini: at most `steps` rounds of calls, then words with no tools; a failing tool is reported back', async () => {
  const fetch = script(wants(['find', { words: 'a' }]), wants(['find', { words: 'b' }]), says('Here it is.'));
  const r = await talkGemini({ keys: [KEY], system: 'S', contents: hello, tools: [{ name: 'find' }], fetch, timers, steps: 2, run: () => { throw new Error('boom'); } });
  assert.equal(fetch.seen.length, 3);
  assert.equal(fetch.seen[2].body.tools, undefined);
  assert.deepEqual(r.calls.map((c) => c.result), [{ ok: false, error: 'boom' }, { ok: false, error: 'boom' }]);
  assert.equal(r.text, 'Here it is.');
});

test('talkGemini: no key, a refused key, and a busy Lite that hands over to Flash for the whole turn', async () => {
  await assert.rejects(talkGemini({ keys: [], system: 'S', contents: hello }), (e) => e instanceof GeminiError && e.code === 'nokey');
  const refused = script(res(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }));
  await assert.rejects(talkGemini({ keys: [KEY], system: 'S', contents: hello, fetch: refused, timers }), (e) => e.code === 'badkey');
  const busy = script(res(503, { error: {} }), wants(['find', { words: 'cv' }]), says('Found it.'));
  await talkGemini({ keys: [KEY], system: 'S', contents: hello, tools: [{ name: 'find' }], fetch: busy, timers, run: () => ({ ok: true }) });
  assert.deepEqual(busy.seen.map((s) => s.url.match(/models\/([^:]+)/)[1]), ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-flash-latest']);
  const empty = script(res(200, { candidates: [{ content: { parts: [] } }] }));
  await assert.rejects(talkGemini({ keys: [KEY], system: 'S', contents: hello, fetch: empty, timers }), (e) => e.code === 'nonsense');
});

// ---- The Coach's tools ---------------------------------------------------------------------------

test("the gate: today and tomorrow only, and every change is the Coach's, with Undo", () => {
  const { store, cv, later } = coachStore();
  const t = coachTools({ store });
  const add = t.run('add_task', { title: 'Call NatCen', day: 'tomorrow', minutes: '30m', time: '10:00' });
  assert.equal(add.did, 'Added "Call NatCen" for tomorrow');
  const added = Object.values(store.doc().items).find((i) => i.title === 'Call NatCen');
  assert.deepEqual([added.date, added.minutes, added.time, added.source], [FRI, 30, '10:00', 'gemini']);
  assert.deepEqual([store.doc().changes[add.change].source, store.doc().changes[add.change].summary], ['coach', 'Added "Call NatCen" for tomorrow']);
  assert.deepEqual(t.run('add_task', { title: 'Next week', day: '2026-09-21' }),
    { ok: false, error: 'The Coach can only change today and tomorrow — hand anything else to Claude with hand_to_claude' });
  assert.match(t.run('add_task', { title: 'x', day: 'today', minutes: '20h' }).error, /A length is from 5 minutes to 12 hours/);
  assert.match(t.run('move_task', { id: later.id, day: 'today' }).error, /"Later thing" isn't on today's or tomorrow's list/);
  const move = t.run('move_task', { id: cv.id, day: 'tomorrow' });
  assert.equal(move.did, 'Moved "Update CV" to tomorrow');
  assert.equal(store.doc().items[cv.id].date, FRI);
  store.undoChange(move.change, 'me');
  assert.equal(store.doc().items[cv.id].date, THU);
  assert.deepEqual(t.run('fly', {}), { ok: false, error: "There's no tool called fly" });
});

test('skip, set, tick and block out hours', () => {
  const { store, cv, heb, apps } = coachStore();
  const t = coachTools({ store });
  store.toggleDone(heb.id, '2026-09-15');
  store.toggleDone(heb.id, '2026-09-16');
  assert.equal(t.run('skip', { id: heb.id, reason: 'travelling' }).did, 'Let "Learn Hebrew" off today — travelling');
  assert.ok(!rowsForDay(store.doc(), THU).some((r) => r.item.id === heb.id), 'off the list today');
  store.toggleDone(heb.id, FRI);
  assert.equal(streak(store.doc(), store.doc().items[heb.id], FRI).current, 3, 'Tue, Wed, Fri — Thursday let off');
  assert.match(t.run('skip', { id: apps.id }).error, /isn't on today's list/);
  assert.equal(t.run('set_task', { id: cv.id, minutes: '1h', time: '14:00', notes: 'Use the new template' }).did, 'Set "Update CV": length 1h, at 14:00, new notes');
  const rec = store.doc().items[cv.id];
  assert.deepEqual([rec.minutes, rec.time, rec.notes], [60, '14:00', 'Use the new template']);
  assert.match(t.run('set_task', { id: cv.id }).error, /needs minutes, time or notes/);
  assert.equal(t.run('tick', { id: cv.id }).did, 'Ticked "Update CV"');
  assert.equal(t.run('tick', { id: cv.id }).did, '"Update CV" was already ticked');
  assert.equal(t.run('untick', { id: cv.id }).did, 'Unticked "Update CV"');
  assert.match(t.run('tick', { id: apps.id }).error, /weekly target/);
  assert.equal(t.run('block_hours', { day: 'today', start: '13:00', end: '17:00', reason: 'Dentist' }).did, 'Blocked out 13:00–17:00 today — Dentist');
  const off = store.doc().calendar['off:2026-09-17'];
  assert.deepEqual([off.start, off.end, off.areas, off.reason, off.source], ['2026-09-17T13:00', '2026-09-17T17:00', [], 'Dentist', 'coach']);
  assert.match(t.run('block_hours', { day: 'today', start: '17:00', end: '13:00' }).error, /end after it starts/);
});

test('looking things up, handing to Claude, and finishing', () => {
  const { store } = coachStore();
  const handed = [];
  const finished = [];
  const t = coachTools({ store, onHandoff: (x) => handed.push(x), onFinish: (e) => finished.push(e) });
  assert.match(t.run('get_day', { day: 'today' }).text, /\[ \] item-1 task "Update CV" · Job search/);
  assert.match(t.run('get_day', { day: '2026-10-30' }).error, /30 days back to 7 days ahead/);
  assert.match(t.run('find', { words: 'cv' }).text, /item-1 task "Update CV" for 2026-09-17 · Job search/);
  assert.equal(t.run('get_journal', {}).text, 'No journal entries in that time.');
  assert.equal(t.run('hand_to_claude', { text: ' Drop the  Friday target ' }).did, 'For Claude: Drop the Friday target');
  assert.deepEqual(handed, ['Drop the Friday target']);
  assert.match(t.run('finish', { feeling: 'ok' }).error, /finish needs text/);
  t.run('finish', { feeling: 'tired but fine', text: 'Long day.', pointers: ['a', 'b', 'c', 'd', 'e', 'f'] });
  assert.deepEqual(finished, [{ feeling: 'tired but fine', text: 'Long day.', pointers: ['a', 'b', 'c', 'd', 'e'] }]);
  assert.ok(TOOL_DECLARATIONS.every((d) => d.parameters.type === 'OBJECT' && d.description));
});

// ---- When it talks, and what it's told -------------------------------------------------------------

test('the moments: morning, afternoon, evening — and after midnight still the evening', () => {
  const m = (h, mm = 0) => momentAt(new Date(2026, 8, 17, h, mm), { dayStartHour: 4, checkinHour: 18 });
  assert.deepEqual([m(6, 59), m(7), m(11, 59), m(12), m(14), m(16, 59), m(17), m(18), m(23), m(1), m(4)],
    [null, 'morning', 'morning', null, 'afternoon', 'afternoon', null, 'evening', 'evening', 'evening', null]);
});

test("openerDue: one a moment, none once he's talked in it, the afternoon only after a slip", () => {
  const { store, cv } = coachStore();
  const s = { today: THU, now: at(THU, '09:30'), dayStartHour: 4, checkinHour: 18 };
  assert.equal(openerDue(store.doc(), s), 'morning');
  store.saveJournal({ kind: 'talk', day: THU, slot: 'own-1', messages: [{ who: 'george', text: 'hi', at: at(THU, '08:00').toISOString() }] });
  assert.equal(openerDue(store.doc(), s), null, 'he already talked this morning');
  const pm = { ...s, now: at(THU, '15:00') };
  assert.equal(openerDue(store.doc(), pm), null, 'nothing slipped');
  store.updateItem(cv.id, { time: '10:00' });
  assert.deepEqual(slippedItems(store.doc(), THU, pm.now), [cv.id]);
  assert.equal(openerDue(store.doc(), pm), 'afternoon');
  store.saveJournal({ kind: 'talk', day: THU, slot: 'afternoon', messages: [{ who: 'coach', text: 'Move the CV?', at: at(THU, '15:00').toISOString() }] });
  assert.equal(openerDue(store.doc(), pm), null);
  assert.deepEqual(waitingOpener(store.doc(), THU), { slot: 'afternoon', text: 'Move the CV?' });
  assert.equal(openerDue(store.doc(), { ...s, now: at(THU, '19:00') }), 'evening');
  assert.match(talkContext(store.doc(), THU, pm.now), /Slipped earlier today: "Update CV"/);
  assert.match(talkContext(store.doc(), THU, pm.now), /^Now: Thursday 17 September, 15:00\nToday's list \(2026-09-17\):\n  \[ \] item-1 task "Update CV" · Job search · at 10:00/);
  assert.match(talkContext(store.doc(), THU, pm.now), /\nTomorrow's list \(2026-09-18\):\n/);
});

test("talkContents: a conversation the Coach opened starts with a note; one side's run of messages is joined", () => {
  const talk = { slot: 'evening', messages: [{ who: 'coach', text: 'How did today go?' }, { who: 'george', text: 'Fine.' }, { who: 'george', text: 'Tired.' }] };
  assert.deepEqual(talkContents(talk, [{ role: 'user', parts: [{ text: '(wrap up)' }] }]), [
    { role: 'user', parts: [{ text: '(Evening: the coach opened the conversation.)' }] },
    { role: 'model', parts: [{ text: 'How did today go?' }] },
    { role: 'user', parts: [{ text: 'Fine.\n\nTired.\n\n(wrap up)' }] },
  ]);
  assert.deepEqual(cleanEntry({ text: `  ${'x'.repeat(700)}`, feeling: 'fine', pointers: 'not a list' }).text.length, 600);
  assert.match(TALK_SYSTEM, /never plan them/);
});

test('the records: a slot for talks and entries, the guide under its Monday, old conversations trimmed', () => {
  const { store } = coachStore();
  assert.throws(() => store.saveJournal({ kind: 'talk', day: THU, slot: 'noon' }), /needs a slot/);
  assert.throws(() => store.saveJournal({ kind: 'guide', day: THU, text: 'x' }), /A guide is filed under its week's Monday/);
  assert.equal(store.saveJournal({ kind: 'entry', day: THU, slot: 'own-2', text: 'x' }).id, 'entry:2026-09-17:own-2');
  store.saveJournal({ kind: 'talk', day: '2026-08-10', slot: 'evening', messages: [{ who: 'george', text: 'old', at: '2026-09-17T09:00:00.000Z' }] });
  assert.equal(store.pruneTalks(30), 1);
  const old = store.doc().journal['talk:2026-08-10:evening'];
  assert.deepEqual([old.messages, old.pruned], [[], true]);
  assert.equal(store.pruneTalks(30), 0);
});

// ---- The panel's flows ---------------------------------------------------------------------------

function flowCtx(store, now, talk) {
  return {
    store, now,
    ui: {
      coach: {
        talk: null, draft: '', talkBusy: '', talkError: '', editing: null, sheet: false, tried: {},
        shapeOpen: false, shapeText: '', shapeBusy: false, shapeError: '', digestOpen: false, digestBusy: false, digestError: '', digestTried: false,
      },
    },
    render: () => {},
    syncNow: async () => {},
    whenIdle: async () => {},
    coach: { fake: null, keys: () => ['k'], ask: async () => ({}), talk, syncWaitMs: 5 },
  };
}

test("a message: his words, the Coach's change and its reply are kept with the conversation", async () => {
  const { store, cv, now } = coachStore();
  let seen;
  const ctx = flowCtx(store, now, async (opts) => {
    seen = structuredClone({ system: opts.system, contents: opts.contents, tools: opts.tools.length });
    opts.run('move_task', { id: cv.id, day: 'tomorrow' });
    return { text: 'Moved it to tomorrow.', calls: [], model: 'gemini-flash-lite-latest' };
  });
  ctx.ui.coach.draft = 'push the CV to tomorrow';
  await sendMessage(ctx);
  const t = talkOf(store.doc(), THU, 'own-1');
  assert.deepEqual(t.messages.map((m) => [m.who, m.text]), [['george', 'push the CV to tomorrow'], ['coach', 'Moved it to tomorrow.']]);
  const [d] = t.messages[1].did;
  assert.equal(d.text, 'Moved "Update CV" to tomorrow');
  assert.equal(store.doc().changes[d.change].source, 'coach');
  assert.deepEqual([ctx.ui.coach.draft, ctx.ui.coach.talk, ctx.ui.coach.talkBusy], ['', 'own-1', '']);
  assert.match(seen.system, /^You are George's coach/);
  assert.match(seen.system, /Today's list \(2026-09-17\):/);
  assert.deepEqual(seen.contents, [{ role: 'user', parts: [{ text: 'push the CV to tomorrow' }] }]);
  assert.equal(seen.tools, TOOL_DECLARATIONS.length);
});

test('no answer: his message comes off the conversation and goes back in the box', async () => {
  const { store, now } = coachStore();
  const ctx = flowCtx(store, now, async () => { throw new GeminiError('quota'); });
  ctx.ui.coach.draft = 'hello';
  await sendMessage(ctx);
  assert.deepEqual([ctx.ui.coach.draft, ctx.ui.coach.talkError], ['hello', MESSAGES.quota]);
  assert.equal(talkOf(store.doc(), THU, 'own-1'), null);
  assert.equal(nextOwnSlot(store.doc(), THU), 'own-2');
});

test("finish: the entry is saved at once, its handoffs become the Coach's flags, and Edit and Remove follow", async () => {
  const { store, now } = coachStore();
  const ctx = flowCtx(store, now, async ({ run }) => {
    run('hand_to_claude', { text: 'Drop the Friday applications target' });
    run('finish', { feeling: 'tired', text: 'Long day; wants Friday lighter.', pointers: ['Mornings are best'] });
    return { text: 'Night — saved.', calls: [], model: 'm' };
  });
  ctx.ui.coach.draft = "that's me, bye";
  await sendMessage(ctx);
  assert.equal(talkOf(store.doc(), THU, 'own-1').done, true);
  const e = entryOf(store.doc(), THU, 'own-1');
  assert.deepEqual([e.feeling, e.text, e.pointers, e.forClaude], ['tired', 'Long day; wants Friday lighter.', ['Mornings are best'], ['Drop the Friday applications target']]);
  const flag = store.doc().flags[e.flagIds[0]];
  assert.deepEqual([flag.text, flag.source, flag.status], ['Drop the Friday applications target', 'coach', 'active']);

  editEntry(ctx, e);
  Object.assign(ctx.ui.coach.editing, { text: 'Long day.', forClaude: 'Move the dentist to next week' });
  saveEdit(ctx);
  const edited = entryOf(store.doc(), THU, 'own-1');
  assert.deepEqual([edited.text, edited.forClaude], ['Long day.', ['Move the dentist to next week']]);
  assert.equal(store.doc().flags[e.flagIds[0]].status, 'archived', 'the handoff taken out is withdrawn');
  assert.equal(store.doc().flags[edited.flagIds[0]].status, 'active');
  removeEntry(ctx, edited);
  assert.equal(entryOf(store.doc(), THU, 'own-1'), null);
  assert.equal(store.doc().flags[edited.flagIds[0]].status, 'archived');

  ctx.coach.talk = async () => ({ text: 'Hi again.', calls: [], model: 'm' });
  ctx.ui.coach.draft = 'one more thing';
  await sendMessage(ctx);
  assert.equal(ctx.ui.coach.talk, 'own-2', 'a finished conversation stays finished; a new one starts');
});

test("Finish: Gemini is asked for the entry with only finish to call; if it can't, his own words are kept", async () => {
  const { store, now } = coachStore();
  const talk = (day) => store.saveJournal({ kind: 'talk', day, slot: 'own-1', messages: [{ who: 'george', text: 'Gym was good', at: '2026-09-17T09:00:00.000Z' }, { who: 'coach', text: 'Nice.', at: '2026-09-17T09:01:00.000Z' }] });
  talk(THU);
  let opts;
  const ctx = flowCtx(store, now, async (o) => { opts = o; o.run('finish', { feeling: 'up', text: 'Good gym session.' }); return { text: 'Saved.', calls: [], model: 'm' }; });
  ctx.ui.coach.talk = 'own-1';
  await finishTalk(ctx);
  assert.deepEqual(opts.tools.map((d) => d.name), ['finish']);
  assert.deepEqual(opts.toolConfig, { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['finish'] } });
  assert.equal(entryOf(store.doc(), THU, 'own-1').text, 'Good gym session.');

  const other = coachStore();
  other.store.saveJournal({ kind: 'talk', day: THU, slot: 'own-1', messages: [{ who: 'george', text: 'Gym was good', at: '2026-09-17T09:00:00.000Z' }] });
  const failing = flowCtx(other.store, other.now, async () => { throw new GeminiError('failed'); });
  failing.ui.coach.talk = 'own-1';
  await finishTalk(failing);
  assert.equal(talkOf(other.store.doc(), THU, 'own-1').done, true);
  assert.deepEqual(entryOf(other.store.doc(), THU, 'own-1').text, 'Gym was good');
});

test("a moment's opener: earlier conversations wrapped up first; the plain line when Gemini can't be reached; never twice", async () => {
  const { store, now } = coachStore('19:00');
  store.saveJournal({ kind: 'talk', day: THU, slot: 'own-1', messages: [{ who: 'george', text: 'Busy morning', at: at(THU, '10:00').toISOString() }] });
  const asked = [];
  const ctx = flowCtx(store, now, async (o) => {
    asked.push(o.tools?.map((d) => d.name) ?? []);
    return o.tools?.length ? { text: '', calls: [], model: 'm' } : { text: 'How did the CV go?', calls: [], model: 'm' };
  });
  assert.equal(talkNow(ctx), 'talking');
  await openMoment(ctx, 'evening');
  assert.deepEqual(asked, [['finish'], []]);
  assert.equal(talkOf(store.doc(), THU, 'own-1').done, true);
  assert.equal(entryOf(store.doc(), THU, 'own-1').text, 'Busy morning');
  assert.deepEqual(talkOf(store.doc(), THU, 'evening').messages.map((m) => [m.who, m.text]), [['coach', 'How did the CV go?']]);
  assert.equal(ctx.ui.coach.tried[`${THU}|evening`], true);
  assert.equal(talkNow(ctx), 'waiting');

  const plain = coachStore('09:30');
  await openMoment(flowCtx(plain.store, plain.now, async () => { throw new GeminiError('offline'); }), 'morning');
  assert.equal(talkOf(plain.store.doc(), THU, 'morning').messages[0].text, "Morning — what's today looking like?");

  const raced = coachStore('09:30');
  let called = false;
  const rctx = flowCtx(raced.store, raced.now, async () => { called = true; return { text: 'x', calls: [], model: 'm' }; });
  rctx.syncNow = async () => raced.store.saveJournal({ kind: 'talk', day: THU, slot: 'morning', messages: [{ who: 'coach', text: 'From the phone', at: '2026-09-17T09:00:00.000Z' }] });
  await openMoment(rctx, 'morning');
  assert.equal(called, false, "another device's opener arrived in the sync: nothing asked, nothing written");
  assert.equal(talkOf(raced.store.doc(), THU, 'morning').messages[0].text, 'From the phone');
});

// ---- Claude's side ----------------------------------------------------------------------------------

test("Claude: the guide op, entries in the journal read, a day's conversations in talk, flags in full", () => {
  const { store } = coachStore();
  assert.match(runOp(store, { op: 'guide', text: 'AC on Thursday: check prep each morning.' }), /^Guide for the Coach, week of .*: "AC on Thursday: check prep each morning\."$/);
  assert.equal(store.doc().journal['guide:2026-09-14'].text, 'AC on Thursday: check prep each morning.');
  assert.throws(() => runOp(store, { op: 'guide', text: 'x'.repeat(601) }), /at most 600 characters/);
  store.saveJournal({
    kind: 'talk', day: THU, slot: 'morning', done: true, handoffs: ['Drop Friday'],
    messages: [{ who: 'coach', text: 'Morning — plan?', at: '2026-09-17T09:00:00.000Z' }, { who: 'george', text: 'CV first', at: '2026-09-17T09:01:00.000Z' },
      { who: 'coach', text: 'Moved it.', at: '2026-09-17T09:02:00.000Z', did: [{ text: 'Moved "Update CV" to today', change: null }] }],
  });
  store.saveJournal({ kind: 'entry', day: THU, slot: 'morning', feeling: 'keen', text: 'Wants the CV done by noon.', pointers: ['Mornings are best'], forClaude: ['Drop Friday'] });
  const journal = READS.journal(store.doc(), THU);
  assert.match(journal, /Your guide for the Coach this week: AC on Thursday/);
  assert.match(journal, /, morning · keen: Wants the CV done by noon\.\n    pointer: Mornings are best\n    for you: Drop Friday/);
  assert.match(READS.talk(store.doc(), THU, 'today'),
    /Morning:\n  Coach: Morning — plan\?\n  George: CV first\n  Coach: Moved it\.\n    did: Moved "Update CV" to today\n  for you: Drop Friday\n  Entry \(keen\): Wants the CV done by noon\./);
  store.addFlag('y'.repeat(300), null, 'coach');
  assert.match(READS.flags(store.doc(), THU), new RegExp(`"${'y'.repeat(300)}" #\\S+ · .* · from the Coach \\(Gemini\\)`));
  assert.match(READS.flags(store.doc(), THU), /^For Claude \(/m);
});
