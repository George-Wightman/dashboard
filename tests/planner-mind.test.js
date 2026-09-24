// The Mind inside whole planner runs: senses, reflexes, openers, Claude's routine, pings, and
// mind.json — against the fake Apps Script, GitHub, Gemini, Drive and push services.

process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPlanner } from '../planner/gas.js';
import { at } from '../planner/time.js';
import { fixture, done } from './helpers.js';
import { FakeCalendar } from './planner-fakes.js';
import { FakeRepo, appsScript } from './planner-apps.js';
import { b64url } from '../planner/webpush.js';

const THU = '2026-09-24';
const GEMINI_KEY = 'AIzaDummyKey_0123456789';
const ROUTINE_TOKEN = 'sk-ant-oat01-dummy-routine-token';
const ROUTINE_URL = 'https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire';
const NOTES = 'Pack: Job Search/IDADP/Practice/RP3_MILLRACE/RP3_MILLRACE_pack.html. 35 min prep.';

// ---- Fakes --------------------------------------------------------------------------------------

const iter = (list) => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
const file = (name, text, updated) => ({ getId: () => name, getName: () => name, getLastUpdated: () => new Date(updated), getMimeType: () => 'text/plain', getBlob: () => ({ getDataAsString: () => text }) });
const folder = (name, children = [], files = []) => ({ getName: () => name, getFoldersByName: (n) => iter(children.filter((c) => c.getName() === n)), getFiles: () => iter(files) });
const drive = () => ({ getRootFolder: () => folder('My Drive', [folder('Job Search', [folder('IDADP', [folder('Practice', [
  folder('RP3_MILLRACE', [], [file('RP3_debrief.md', 'Recommendation came late again, same as HALYARD.', '2026-09-24T18:22:00Z')]),
])])])]) });

const reply = (obj) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } });
function geminiFake(rules) {
  const prompts = [];
  const handler = (url, opts) => {
    const prompt = JSON.parse(opts.payload).contents[0].parts[0].text;
    prompts.push({ url, prompt });
    for (const [re, out] of rules) if (re.test(prompt)) return typeof out === 'function' ? out(prompt) : out.status ? out : reply(out);
    return { status: 500, body: 'no rule' };
  };
  handler.prompts = prompts;
  return handler;
}
const GOOD = [
  [/Angle: progress/, { notes: 'Debrief: recommendation late again.', matters: 3 }],
  [/Angle: pattern/, { notes: 'Same as HALYARD.', matters: 2 }],
  [/Angle: plan/, { notes: 'RP4 Sunday.', matters: 1 }],
  [/Now decide what the Coach says/, { say: true, text: 'MILLRACE is ticked. Your debrief says the recommendation came late again, as in HALYARD. Open RP4 with a two-minute recommendation drill?', notify: true }],
  [/The message:/, { ok: true, problems: [], text: '' }],
  [/It's the morning/, { text: 'Morning. MILLRACE is the big one today — what does the day look like?' }],
  [/It's the evening/, { text: 'Evening. How did MILLRACE go?' }],
];

function phone() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, record: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc:def', p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth), label: 'phone' } };
}
function openPush(payload, { ecdh, auth }) {
  const buf = Buffer.from(Uint8Array.from(payload, (b) => b & 255));
  const salt = buf.subarray(0, 16);
  const keyid = buf.subarray(21, 21 + buf[20]);
  const ct = buf.subarray(21 + buf[20]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdh.computeSecret(keyid), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), keyid]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(-16));
  const pt = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
  return JSON.parse(pt.subarray(0, pt.lastIndexOf(2)).toString('utf8'));
}

const nodeCrypto = {
  hash: {
    sha256: (u8) => new Uint8Array(crypto.createHash('sha256').update(u8).digest()),
    hmac: (k, d) => new Uint8Array(crypto.createHmac('sha256', k).update(d).digest()),
  },
  randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)),
};

function world({ config = {}, props = {}, rules = GOOD, calendar = {}, push, routine } = {}) {
  const doc = fixture({
    goals: [{ id: 'ac', title: 'Smash Assessment Center', targetDate: '2026-10-05', order: 1 }],
    items: [{ id: 'rp3', type: 'task', title: 'Role play 3 - MILLRACE, timed', date: THU, area: 'Assessment centre', goalId: 'ac', notes: NOTES, order: 1 }],
  });
  doc.calendar['mind:config'] = { id: 'mind:config', status: 'active', source: 'claude', updated: '2026-09-24T06:00:00.000Z', enabled: true, morningAt: '23:58', checkinAt: '23:59', ...config };
  for (const [id, r] of Object.entries(calendar)) doc.calendar[id] = { id, status: 'active', source: 'me', updated: '2026-09-24T06:00:00.000Z', ...r };
  const repo = new FakeRepo(doc);
  const gemini = geminiFake(rules);
  let t = at(THU, '19:00');
  const env = appsScript({ cal: new FakeCalendar(), repo, gemini, push, routine, DriveApp: drive(), now: () => t,
    props: { GITHUB_TOKEN: 'ghp_dummy_token_1234567890', SYNC_REPO: 'o/r', GEMINI_KEY, ...props } });
  const planner = createPlanner({ ...env, version: 'test1', mindCrypto: nodeCrypto });
  const edit = (fn) => { const d = repo.doc(); fn(d); repo.text = JSON.stringify(d); };
  return { repo, env, gemini, planner, edit, setNow: (d) => { t = d; } };
}
const geminiCalls = (env) => env.calls.filter((c) => c.url.startsWith('https://generativelanguage.googleapis.com/')).length;

// ---- The tests ----------------------------------------------------------------------------------

test('the first run with the Mind on only takes its bearings', async () => {
  const w = world();
  assert.equal(await w.planner.run(), 'ok');
  const mind = w.repo.file('mind.json');
  assert.ok(mind.cursor?.at);
  assert.deepEqual(mind.events, {});
  assert.equal(geminiCalls(w.env), 0);
  const d = w.repo.doc();
  assert.ok(d.calendar['push-config'].publicKey, 'the notification key is ready for devices');
  assert.ok(d.calendar['mind:status'].lastRun);
});

test('a role play ticked through Claude: the Coach reads the debrief, says something, and pings the phone once', async () => {
  const p = phone();
  const w = world({ calendar: { 'push:dev1': p.record } });
  await w.planner.run();
  w.edit((d) => { d.logs.t1 = { ...done('rp3', THU, { id: 't1', source: 'claude', at: at(THU, '19:23').toISOString() }), status: 'active', created: THU, updated: at(THU, '19:23').toISOString(), source: 'claude' }; });
  w.setNow(at(THU, '19:30'));
  assert.equal(await w.planner.run(), 'ok');
  const talk = w.repo.doc().journal[`talk:${THU}:mind-1`];
  assert.ok(talk, 'a Mind conversation');
  const [m] = talk.messages;
  assert.equal(m.from, 'mind');
  assert.equal(m.by, 'gemini');
  assert.equal(m.notify, true);
  assert.match(m.text, /MILLRACE/);
  assert.ok(w.gemini.prompts.some((x) => x.prompt.includes('Recommendation came late again')), 'the debrief went to Gemini');
  const mind = w.repo.file('mind.json');
  const tick = mind.events['tick:t1'];
  assert.equal(tick.level, 3);
  assert.equal(tick.artefacts[0].name, 'RP3_debrief.md');
  assert.ok(tick.reflex);
  assert.ok(w.repo.doc().calendar['mind:status'].lastReflex);

  assert.equal(w.env.pushes.length, 1);
  const push = w.env.pushes[0].opts;
  assert.match(push.headers.Authorization, /^vapid t=/);
  assert.deepEqual(openPush(push.payload, p), { title: 'Coach', body: m.text.slice(0, 140), url: `./?coach=talk:${THU}:mind-1`, tag: `talk:${THU}:mind-1` });
  assert.equal(mind.budget.pings, 1);

  w.setNow(at(THU, '19:40'));
  await w.planner.run();
  assert.equal(w.env.pushes.length, 1, 'never twice');
});

test('a phone that has gone away is retired', async () => {
  const p = phone();
  const w = world({ calendar: { 'push:dev1': p.record }, push: () => ({ status: 410, body: 'gone' }) });
  await w.planner.run();
  w.edit((d) => { d.logs.t1 = { ...done('rp3', THU, { id: 't1', source: 'me' }), status: 'active', created: THU, updated: at(THU, '19:23').toISOString() }; });
  w.setNow(at(THU, '19:30'));
  await w.planner.run();
  assert.equal(w.env.pushes.length, 1);
  assert.equal(w.repo.doc().calendar['push:dev1'].status, 'archived');
  assert.equal(Object.values(w.repo.file('mind.json').pushed)[0].state, 'gone');
});

test('switched off, it still senses — but asks Gemini nothing and says nothing', async () => {
  const w = world({ config: { enabled: false } });
  await w.planner.run();
  w.edit((d) => { d.logs.t1 = { ...done('rp3', THU, { id: 't1', source: 'me' }), status: 'active', created: THU, updated: at(THU, '19:23').toISOString() }; });
  w.setNow(at(THU, '19:30'));
  await w.planner.run();
  assert.ok(w.repo.file('mind.json').events['tick:t1']);
  assert.equal(geminiCalls(w.env), 0);
  assert.equal(Object.keys(w.repo.doc().journal).filter((id) => id.includes(':mind-')).length, 0);
});

test('the morning and evening openers come from the background, once each', async () => {
  const w = world({ config: { morningAt: '07:00', checkinAt: '18:00' } });
  w.setNow(at(THU, '06:40'));
  await w.planner.run();
  w.setNow(at(THU, '07:05'));
  await w.planner.run();
  const morning = w.repo.doc().journal[`talk:${THU}:morning`];
  assert.equal(morning.messages[0].text, 'Morning. MILLRACE is the big one today — what does the day look like?');
  assert.equal(morning.messages[0].from, 'mind');
  w.setNow(at(THU, '07:15'));
  await w.planner.run();
  assert.equal(w.repo.doc().journal[`talk:${THU}:morning`].messages.length, 1);
  w.setNow(at(THU, '18:01'));
  await w.planner.run();
  assert.equal(w.repo.doc().journal[`talk:${THU}:evening`].messages[0].text, 'Evening. How did MILLRACE go?');
});

test("George's question for Claude starts the routine, once, with the right headers", async () => {
  const w = world({ props: { MIND_ROUTINE_URL: ROUTINE_URL, MIND_ROUTINE_TOKEN: ROUTINE_TOKEN } });
  await w.planner.run();
  w.edit((d) => { d.calendar[`ask:${THU}:1`] = { id: `ask:${THU}:1`, status: 'active', source: 'coach', updated: at(THU, '19:25').toISOString(), text: 'Rework the weekend around the mock', day: THU, at: at(THU, '19:25').toISOString() }; });
  w.setNow(at(THU, '19:30'));
  await w.planner.run();
  assert.equal(w.repo.doc().calendar[`ask:${THU}:1`].status, 'archived');
  assert.equal(w.env.fires.length, 1);
  const { url, opts } = w.env.fires[0];
  assert.equal(url, ROUTINE_URL);
  assert.equal(opts.headers.Authorization, `Bearer ${ROUTINE_TOKEN}`);
  assert.equal(opts.headers['anthropic-beta'], 'experimental-cc-routine-2026-04-01');
  assert.equal(opts.headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(JSON.parse(opts.payload), { text: `ask: ask:ask:${THU}:1` });
  w.edit((d) => { d.calendar[`ask:${THU}:2`] = { id: `ask:${THU}:2`, status: 'active', source: 'coach', updated: at(THU, '19:35').toISOString(), text: 'And Monday?', day: THU, at: at(THU, '19:35').toISOString() }; });
  w.setNow(at(THU, '19:40'));
  await w.planner.run();
  assert.equal(w.env.fires.length, 1, 'one outstanding at a time');
  assert.ok(w.env.lines.every((l) => !l.includes(ROUTINE_TOKEN) && !l.includes(GEMINI_KEY)));
});

test("Gemini's free allowance used up: nothing said, planning untouched, and the status says so", async () => {
  const PER_DAY = { status: 429, body: { error: { message: 'Quota exceeded, quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier' } } };
  const w = world({ rules: [[/./, PER_DAY]] });
  await w.planner.run();
  w.edit((d) => { d.logs.t1 = { ...done('rp3', THU, { id: 't1', source: 'me' }), status: 'active', created: THU, updated: at(THU, '19:23').toISOString() }; });
  w.setNow(at(THU, '19:30'));
  assert.equal(await w.planner.run(), 'ok');
  assert.equal(Object.keys(w.repo.doc().journal).filter((id) => id.includes(':mind-')).length, 0);
  assert.deepEqual(w.repo.file('mind.json').budget.geminiBlocked.sort(), ['gemini-flash-latest', 'gemini-flash-lite-latest']);
  assert.match(w.repo.doc().calendar['mind:status'].lastError, /used up/);
});

test("a deep run's writes to mind.json survive the planner's", async () => {
  const w = world();
  await w.planner.run();
  const other = w.repo.file('mind.json');
  other.events.x = { id: 'x', at: at(THU, '19:05').toISOString(), kind: 'ask', level: 3, refs: {}, text: 'x', facts: [], reflex: null, deep: at(THU, '19:20').toISOString() };
  other.runs['deep:1'] = { id: 'deep:1', at: at(THU, '19:20').toISOString(), engine: 'deep', summary: 'Reviewed.' };
  other.cursor = { at: 'not the planner\'s' };
  w.repo.others.set('mind.json', { text: JSON.stringify(other), sha: 'from-claude' });
  w.setNow(at(THU, '19:30'));
  await w.planner.run();
  const mind = w.repo.file('mind.json');
  assert.equal(mind.events.x.deep, at(THU, '19:20').toISOString());
  assert.ok(mind.runs['deep:1']);
  assert.notEqual(mind.cursor.at, "not the planner's");
  assert.equal(w.repo.doc().calendar['mind:status'].lastDeep, at(THU, '19:20').toISOString());
});

test('the Mind failing never stops the planner, and never shows a key', async () => {
  const w = world({ rules: [[/./, () => { throw new Error(`socket hang up for ${GEMINI_KEY}`); }]] });
  await w.planner.run();
  w.edit((d) => { d.logs.t1 = { ...done('rp3', THU, { id: 't1', source: 'me' }), status: 'active', created: THU, updated: at(THU, '19:23').toISOString() }; });
  w.setNow(at(THU, '19:30'));
  assert.equal(await w.planner.run(), 'ok');
  const status = w.repo.doc().calendar['mind:status'];
  assert.match(status.lastError, /The Mind stopped/);
  assert.ok(!status.lastError.includes(GEMINI_KEY));
  assert.ok(w.env.lines.every((l) => !l.includes(GEMINI_KEY)));
  assert.ok(w.repo.doc().calendar.status.lastRun, 'the planner itself carried on');
});
