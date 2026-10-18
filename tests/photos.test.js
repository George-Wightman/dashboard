import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoPath, uploadPhoto, runMealPass } from '../js/photos.js';
import { GeminiError } from '../js/gemini.js';
import { makeStore } from './helpers.js';

const ESTIMATE = { name: 'Chicken wrap', items: [], protein: { low: 38, mid: 46, high: 54 }, kcal: { low: 650, mid: 780, high: 900 } };

// Photos kept "on the device", in memory.
function fakePhotos(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    async put(id, v) { map.set(id, v); },
    async get(id) { return map.get(id) ?? null; },
    async del(id) { map.delete(id); },
    async ids() { return new Set(map.keys()); },
  };
}

function setup({ reply = { data: ESTIMATE }, sync = true } = {}) {
  const store = makeStore();
  if (sync) store.updateSettings({ token: 't', repo: 'o/sync' });
  const asked = [];
  const ctx = { store, gemini: { ask: async (req) => { asked.push(req); if (reply instanceof Error) throw reply; return reply; } } };
  const meal = store.addMeal({ at: new Date(2026, 8, 10, 12, 34), text: 'wrap', hasPhoto: true });
  const photos = fakePhotos({ [meal.id]: { big: 'BIG', small: 'SMALL' } });
  const uploads = [];
  const upload = async (args) => { uploads.push(args); };
  return { store, ctx, meal, photos, uploads, upload, asked };
}

test('a photo path is per month, without the meal: prefix', () => {
  assert.equal(photoPath('meal:abc', new Date(2026, 9, 20, 12)), 'photos/2026/10/abc.jpg');
});

test('uploadPhoto PUTs the base64 with the key; already there counts as done; other errors say so', async () => {
  const calls = [];
  const fetch = (status) => async (url, init) => { calls.push({ url, init }); return { status, ok: status < 300, json: async () => ({}) }; };
  await uploadPhoto({ token: 'K', repo: 'o/sync', path: 'photos/2026/10/abc.jpg', base64: 'SMALL', fetch: fetch(201) });
  assert.equal(calls[0].url, 'https://api.github.com/repos/o/sync/contents/photos/2026/10/abc.jpg');
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer K');
  assert.equal(JSON.parse(calls[0].init.body).content, 'SMALL');
  await uploadPhoto({ token: 'K', repo: 'o/sync', path: 'p.jpg', base64: 'S', fetch: fetch(422) });
  await assert.rejects(uploadPhoto({ token: 'K', repo: 'o/sync', path: 'p.jpg', base64: 'S', fetch: fetch(500) }), /Couldn’t upload the photo \(500\)/);
});

test('a pending meal is estimated from its photo, uploaded, and its local copy let go', async () => {
  const { store, ctx, meal, photos, uploads, upload, asked } = setup();
  const result = await runMealPass({ ctx, photos, upload, online: () => true });
  assert.deepEqual(result, { estimated: 1, uploaded: 1, failed: 0 });
  assert.deepEqual(asked[0].image, { mimeType: 'image/jpeg', data: 'BIG' });
  const m = store.doc().meals[meal.id];
  assert.deepEqual([m.state, m.final, m.photoState, m.photo], ['estimated', { protein: 46, kcal: 780 }, 'uploaded', 'photos/2026/09/' + meal.id.slice(5) + '.jpg']);
  assert.equal(uploads[0].base64, 'SMALL');
  assert.equal(photos.map.size, 0);
});

test('nonsense from Gemini marks the meal failed, keeps the photo, and counts a try', async () => {
  const { store, ctx, meal, photos, upload } = setup({ reply: { data: { nope: true } } });
  const result = await runMealPass({ ctx, photos, upload, online: () => true });
  assert.equal(result.failed, 1);
  assert.deepEqual([store.doc().meals[meal.id].state, store.doc().meals[meal.id].tries], ['failed', 1]);
  assert.equal(photos.map.has(meal.id), true);
});

test('with no Gemini key the meal stays pending; offline nothing happens; two passes at once run once', async () => {
  const a = setup({ reply: new GeminiError('nokey') });
  await runMealPass({ ctx: a.ctx, photos: a.photos, upload: a.upload, online: () => true });
  assert.deepEqual([a.store.doc().meals[a.meal.id].state, a.store.doc().meals[a.meal.id].tries], ['pending', 0]);
  const b = setup();
  assert.deepEqual(await runMealPass({ ctx: b.ctx, photos: b.photos, upload: b.upload, online: () => false }), { estimated: 0, uploaded: 0, failed: 0 });
  assert.equal(b.asked.length, 0);
  const c = setup();
  const [one, two] = [runMealPass({ ctx: c.ctx, photos: c.photos, upload: c.upload, online: () => true }), runMealPass({ ctx: c.ctx, photos: c.photos, upload: c.upload, online: () => true })];
  assert.equal(one, two);
  await one;
  assert.equal(c.asked.length, 1);
});

test('without sync set up the photo stays on the device after the estimate', async () => {
  const { store, ctx, meal, photos, uploads, upload } = setup({ sync: false });
  await runMealPass({ ctx, photos, upload, online: () => true });
  assert.equal(store.doc().meals[meal.id].state, 'estimated');
  assert.equal(uploads.length, 0);
  assert.equal(photos.map.has(meal.id), true);
});
