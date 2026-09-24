// The page's side of the Coach's Mind: openers left to the background while it runs, its messages
// in the conversation and the Coach's context, think_deeper, and notifications on this device.

process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openerDue, waitingOpener, talkContext, conversationContents, TALK_SYSTEM, PICTURE_IN_CONTEXT } from '../js/talk.js';
import { sendMessage } from '../js/ui/coach.js';
import { pushState, turnOn, turnOff, deviceId, b64urlToBytes } from '../js/push-client.js';
import { at } from '../planner/time.js';
import { makeStore, clock } from './helpers.js';

const THU = '2026-09-24';

function store(time = '07:30') {
  const s = makeStore({ now: clock(at(THU, time)), prefix: 'item-' });
  s.addItem({ type: 'task', title: 'Role play 3 - MILLRACE, timed', date: THU, area: 'Assessment centre' });
  return s;
}
const alive = (s, now, mins = 5) => {
  s.putCalendar('mind:config', { enabled: true }, 'claude');
  s.putCalendar('mind:status', { lastRun: new Date(now.getTime() - mins * 60000).toISOString() });
};
const mindTalk = (s, slot, text, time, by = 'gemini') => s.saveJournal({ kind: 'talk', day: THU, slot,
  messages: [{ who: 'coach', text, at: at(THU, time).toISOString(), from: 'mind', by, notify: true }] }, 'mind');

test('while the background runs, the page leaves the openers to it; stale, it takes them back', () => {
  const s = store();
  const now = at(THU, '07:30');
  const hours = { today: THU, now, dayStartHour: 4, checkinHour: 18 };
  assert.equal(openerDue(s.doc(), hours), 'morning');
  alive(s, now, 20);
  assert.equal(openerDue(s.doc(), hours), null);
  s.putCalendar('mind:status', { lastRun: new Date(now.getTime() - 80 * 60000).toISOString() });
  assert.equal(openerDue(s.doc(), hours), 'morning', 'silent for 80 minutes: the page steps in');
});

test('an unanswered Mind message waits under the date, until he talks after it', () => {
  const s = store('19:40');
  mindTalk(s, 'mind-1', 'MILLRACE is ticked. How did the recommendation land?', '19:30');
  const now = at(THU, '19:40');
  assert.deepEqual(waitingOpener(s.doc(), THU, now, { dayStartHour: 4, checkinHour: 18 }), { slot: 'mind-1', text: 'MILLRACE is ticked. How did the recommendation land?' });
  s.saveJournal({ kind: 'talk', day: THU, slot: 'own-1', messages: [{ who: 'george', text: 'Better than HALYARD', at: at(THU, '19:45').toISOString() }] });
  assert.equal(waitingOpener(s.doc(), THU, at(THU, '19:50'), { dayStartHour: 4, checkinHour: 18 }), null);
});

test("the Coach's context carries Claude's picture and what it said in the background, and its rules know about both", () => {
  const s = store('19:40');
  s.putCalendar('mind:picture', { text: `Now: AC fortnight.\n${'x'.repeat(5000)}`, opener: null, by: 'claude', at: at(THU, '06:30').toISOString() }, 'claude');
  mindTalk(s, 'mind-1', 'MILLRACE is ticked. How did the recommendation land?', '19:30');
  const text = talkContext(s.doc(), THU, at(THU, '19:40'));
  assert.match(text, /Claude's picture of George \(written Thu 06:30\)/);
  assert.match(text, /Now: AC fortnight\./);
  const pic = text.split("where it disagrees with the lists, the lists are right:\n")[1].split('\n')[0];
  assert.ok(pic.length <= PICTURE_IN_CONTEXT);
  assert.match(text, /hasn't answered yet: "MILLRACE is ticked\. How did the recommendation land\?" \(19:30\)/);
  assert.match(TALK_SYSTEM, /background mind/);
  assert.match(TALK_SYSTEM, /think_deeper/);
  const contents = conversationContents(s.doc(), THU);
  assert.ok(JSON.stringify(contents).includes('How did the recommendation land?'), 'the model sees what it said');
});

function flowCtx(s, now, talk) {
  return {
    store: s, now,
    ui: { coach: { talk: null, draft: '', talkBusy: '', talkError: '', editing: null, sheet: false, tried: {} } },
    render: () => {}, syncNow: async () => {}, whenIdle: async () => {},
    coach: { fake: null, keys: () => ['k'], ask: async () => ({}), talk, syncWaitMs: 5 },
  };
}

test('think_deeper: an ask for Claude, one undoable change, and a reply that says it will come back', async () => {
  const s = store('19:40');
  const now = clock(at(THU, '19:40'));
  const ctx = flowCtx(s, now, async (opts) => {
    const r = opts.run('think_deeper', { question: 'Is the weekend plan still right after tonight?' });
    assert.equal(r.ok, true, JSON.stringify(r));
    return { text: "I'll think that through properly and come back to you.", calls: [], model: 'gemini-flash-lite-latest' };
  });
  ctx.ui.coach.draft = 'rework the weekend around the mock';
  await sendMessage(ctx);
  const ask = s.doc().calendar[`ask:${THU}:1`];
  assert.equal(ask.text, 'Is the weekend plan still right after tonight?');
  assert.equal(ask.source, 'coach');
  const change = Object.values(s.doc().changes).find((c) => /Asked for a deeper look/.test(c.summary));
  assert.equal(change.source, 'coach');
  assert.match(s.doc().journal[`talk:${THU}:own-1`].messages[1].did[0].text, /Asked for a deeper look: "Is the weekend plan/);
});

test('a reply to a Mind message goes into its conversation', async () => {
  const s = store('19:40');
  mindTalk(s, 'mind-1', 'How did the recommendation land?', '19:30');
  const ctx = flowCtx(s, clock(at(THU, '19:40')), async () => ({ text: 'Good to hear.', calls: [], model: 'm' }));
  ctx.ui.coach.draft = 'Earlier than last time';
  await sendMessage(ctx);
  const t = s.doc().journal[`talk:${THU}:mind-1`];
  assert.deepEqual(t.messages.map((m) => m.who), ['coach', 'george', 'coach']);
});

// ---- Notifications on this device ------------------------------------------------------------------

function browser({ permission = 'default', grant = 'granted', existing = null, ua = 'Mozilla/5.0 (Linux; Android 16; Pixel 9) Mobile' } = {}) {
  const storage = new Map();
  let sub = existing;
  const env = {
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    PushManager: function PushManager() {},
    Notification: { permission, requestPermission: async () => { env.Notification.permission = grant; return grant; } },
    navigator: {
      userAgent: ua,
      serviceWorker: {
        ready: Promise.resolve({ pushManager: { getSubscription: async () => sub, subscribe: async (o) => {
          env.subscribedWith = o;
          sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/new', options: o, unsubscribe: async () => { sub = null; return true; },
            toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/new', keys: { p256dh: 'BPUB', auth: 'AUTH' } }) };
          return sub;
        } } }),
        getRegistration: async () => ({ pushManager: { getSubscription: async () => sub } }),
      },
    },
  };
  return env;
}

test('notifications: waiting for the planner, then on and off; blocked says so', async () => {
  const s = store();
  const ctx = { store: s, syncNow: () => { ctx.synced = true; } };
  const env = browser();
  assert.equal(await pushState(ctx, env), 'waiting');
  await assert.rejects(turnOn(ctx, env), /next run/);
  const key = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
  s.putCalendar('push-config', { publicKey: key });
  assert.equal(await pushState(ctx, env), 'off');
  await turnOn(ctx, env);
  assert.deepEqual([...env.subscribedWith.applicationServerKey], [...b64urlToBytes(key)]);
  assert.equal(env.subscribedWith.userVisibleOnly, true);
  const id = deviceId(env.localStorage);
  const rec = s.doc().calendar[`push:${id}`];
  assert.deepEqual({ endpoint: rec.endpoint, p256dh: rec.p256dh, auth: rec.auth, label: rec.label, status: rec.status },
    { endpoint: 'https://fcm.googleapis.com/fcm/send/new', p256dh: 'BPUB', auth: 'AUTH', label: 'phone', status: 'active' });
  assert.equal(ctx.synced, true);
  assert.equal(await pushState(ctx, env), 'on');
  await turnOff(ctx, env);
  assert.equal(s.doc().calendar[`push:${id}`].status, 'archived');
  assert.equal(await pushState(ctx, env), 'off');
  const blocked = browser({ permission: 'denied' });
  assert.equal(await pushState(ctx, blocked), 'blocked');
  await assert.rejects(turnOn(ctx, browser({ grant: 'denied' })), /blocked for this site/);
  assert.equal(await pushState(ctx, { navigator: {} }), 'unsupported');
});

test('a subscription made with an old key is replaced', async () => {
  const s = store();
  const ctx = { store: s };
  s.putCalendar('push-config', { publicKey: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8' });
  let dropped = false;
  const old = { endpoint: 'https://fcm.googleapis.com/fcm/send/old', options: { applicationServerKey: new Uint8Array(65).buffer }, unsubscribe: async () => { dropped = true; return true; } };
  const env = browser({ existing: old });
  await turnOn(ctx, env);
  assert.equal(dropped, true);
  assert.equal(s.doc().calendar[`push:${deviceId(env.localStorage)}`].endpoint, 'https://fcm.googleapis.com/fcm/send/new');
});
