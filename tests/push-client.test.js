// Notifications on this device: the check on every open (js/push-client.js, repairPush) that catches
// a subscription the browser no longer holds, or one the planner was told is gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore } from './helpers.js';
import { pushDrift, repairPush, DEVICE_KEY } from '../js/push-client.js';

const live = { status: 'active', source: 'me', endpoint: 'https://fcm.googleapis.com/fcm/send/old' };

test('pushDrift: what to do about this device, from the record, the permission and what the browser holds', () => {
  assert.equal(pushDrift({ rec: null, permission: 'granted', endpoint: null }), 'ok', 'never turned on');
  assert.equal(pushDrift({ rec: live, permission: 'granted', endpoint: live.endpoint }), 'ok');
  assert.equal(pushDrift({ rec: live, permission: 'granted', endpoint: null }), 'renew', 'permission held, subscription gone');
  assert.equal(pushDrift({ rec: live, permission: 'granted', endpoint: 'https://x/other' }), 'renew');
  assert.equal(pushDrift({ rec: live, permission: 'default', endpoint: null }), 'lost', 'the permission was taken away');
  const retired = { ...live, status: 'archived', source: 'planner' };
  assert.equal(pushDrift({ rec: retired, permission: 'granted', endpoint: live.endpoint }), 'renew', 'the planner was told it is gone');
  assert.equal(pushDrift({ rec: retired, permission: 'denied', endpoint: null }), 'ok', 'nothing to renew without permission');
  assert.equal(pushDrift({ rec: { ...live, status: 'archived', source: 'me' }, permission: 'granted', endpoint: null }), 'ok', 'he turned it off');
});

function fakeEnv({ permission = 'granted', held = null } = {}) {
  const storage = new Map([[DEVICE_KEY, 'dev1']]);
  const calls = [];
  let sub = held ? { endpoint: held, options: {}, toJSON: () => ({ endpoint: held, keys: { p256dh: 'P', auth: 'A' } }), unsubscribe: async () => { calls.push('unsubscribe'); sub = null; } } : null;
  const reg = { pushManager: {
    getSubscription: async () => sub,
    subscribe: async () => {
      calls.push('subscribe');
      sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/new', options: {}, toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/new', keys: { p256dh: 'P2', auth: 'A2' } }) };
      return sub;
    },
  } };
  return {
    calls,
    env: {
      navigator: { serviceWorker: { getRegistration: async () => reg }, userAgent: 'Android' },
      PushManager: function PushManager() {},
      Notification: { permission },
      localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    },
  };
}

function storeWith(rec, source) {
  const store = makeStore();
  store.putCalendar('push-config', { publicKey: 'BEnN4HrxPmT5wP6veMQwZtpCi-V0FLWBs63gtoqvnaV0q47aQdLLhyU5llAPcASODmxWFUBFNHLL5OlXSCYd-dQ' }, 'planner');
  if (rec) store.putCalendar('push:dev1', rec, source);
  return store;
}

test('repairPush: a device the planner retired gets a new subscription, and says why', async () => {
  const store = storeWith({ endpoint: live.endpoint, p256dh: 'P', auth: 'A', label: 'phone' }, 'me');
  store.putCalendar('push:dev1', { status: 'archived', archivedOn: store.today() }, 'planner');
  const { env, calls } = fakeEnv({ held: live.endpoint });
  assert.equal(await repairPush({ store }, env), 'renew');
  assert.deepEqual(calls, ['unsubscribe', 'subscribe'], 'the refused subscription is dropped, not reused');
  const rec = store.doc().calendar['push:dev1'];
  assert.equal(rec.status, 'active');
  assert.equal(rec.endpoint, 'https://fcm.googleapis.com/fcm/send/new');
  assert.equal(rec.lastRepair.retiredBy, 'planner');
  assert.equal(rec.lastRepair.held, 'same');
  assert.equal(rec.repairs, 1);
});

test('repairPush: a permission taken away retires the record and keeps what the browser said', async () => {
  const store = storeWith({ endpoint: live.endpoint, p256dh: 'P', auth: 'A' }, 'me');
  const { env, calls } = fakeEnv({ permission: 'default' });
  assert.equal(await repairPush({ store }, env), 'lost');
  assert.deepEqual(calls, []);
  const rec = store.doc().calendar['push:dev1'];
  assert.equal(rec.status, 'archived');
  assert.equal(rec.lost, 'default');
  assert.equal(rec.lastRepair.held, 'none');
});

test('repairPush: nothing to do leaves the record alone', async () => {
  const store = storeWith({ endpoint: live.endpoint, p256dh: 'P', auth: 'A' }, 'me');
  const before = JSON.stringify(store.doc().calendar['push:dev1']);
  const { env, calls } = fakeEnv({ held: live.endpoint });
  assert.equal(await repairPush({ store }, env), 'ok');
  assert.deepEqual(calls, []);
  assert.equal(JSON.stringify(store.doc().calendar['push:dev1']), before);
});
