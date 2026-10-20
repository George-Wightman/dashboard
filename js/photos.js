// Meal photos: shrunk on the device, kept there (IndexedDB) until Gemini has estimated the meal and
// the small copy is in the sync repo (photos/YYYY/MM/<id>.jpg), then let go. Offline, or when Gemini
// or GitHub fails, nothing is lost: the next pass picks it up (on save, when the device comes back
// online, after each sync, and at start-up).

import { mealWork, mealPrompt, parseEstimate, finalFor, usualMeals, MEAL_SYSTEM, MEAL_MODELS, MEAL_TEMPERATURE, MAX_TRIES } from './food.js';
import { GeminiError } from './gemini.js';

const API = 'https://api.github.com';
const pad = (n) => String(n).padStart(2, '0');

export function photoPath(id, at) {
  const d = new Date(at);
  return `photos/${d.getFullYear()}/${pad(d.getMonth() + 1)}/${String(id).replace(/^meal:/, '')}.jpg`;
}

// One photo into the sync repo. A 422 means it's already there (a pass that was cut off), so done.
export async function uploadPhoto({ token, repo, path, base64, fetch = (...a) => globalThis.fetch(...a) }) {
  const res = await fetch(`${API}/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: JSON.stringify({ message: 'Meal photo', content: base64 }),
  });
  if (res.status === 422 || res.ok) return;
  throw new Error(`Couldn’t upload the photo (${res.status})`);
}

// A picture shrunk to `maxSide` pixels on its longest side, as base64 JPEG. Browser only.
export async function shrink(file, maxSide, quality = 0.7) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(binary), width, height };
}

// This device's photos, in IndexedDB: { big, small } base64 by meal id. Every call fails soft.
const DB = 'dash_photos';
const STORE = 'photos';
function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result);
    t.onerror = () => reject(t.error);
  });
}
export const localPhotos = {
  async put(id, value) { try { await tx('readwrite', (s) => s.put(value, id)); return true; } catch { return false; } },
  async get(id) { try { return (await tx('readonly', (s) => s.get(id))) ?? null; } catch { return null; } },
  async del(id) { try { await tx('readwrite', (s) => s.delete(id)); } catch { /* best effort */ } },
  async ids() { try { return new Set(await tx('readonly', (s) => s.getAllKeys())); } catch { return new Set(); } },
};

// A snapped meal's photos onto the device. If they can't be kept (storage full, a private window),
// the meal is estimated from its words instead, so it never waits for a photo that isn't there.
export async function keepPhoto(store, photos, mealId, value) {
  let ok;
  try { ok = (await photos.put(mealId, value)) !== false; } catch { ok = false; }
  if (!ok) store.updateMeal(mealId, { photoState: null });
  return ok;
}

let running = null;
let again = false;

// The meal passes: never two at once. Asked for while one is running (a meal snapped mid-pass), it
// goes round once more when the current round ends, and the same promise covers both.
export function runMealPass(opts = {}) {
  if (running) { again = true; return running; }
  running = (async () => {
    const total = { estimated: 0, uploaded: 0, failed: 0 };
    do {
      again = false;
      const r = await onePass(opts);
      for (const k of Object.keys(total)) total[k] += r[k];
    } while (again);
    return total;
  })().finally(() => { running = null; });
  return running;
}

// Gemini down, overloaded, out of today's quota, unreachable, or without a working key: the meal
// waits, untried. Only a reply that made no sense counts as one of its tries.
const waitsUntried = (e) => e instanceof GeminiError ? e.code !== 'nonsense' : ['nokey', 'offline', 'quota', 'failed', 'badkey'].includes(e?.code);

async function onePass({ ctx, photos = localPhotos, upload = uploadPhoto, online = () => globalThis.navigator?.onLine !== false } = {}) {
  const result = { estimated: 0, uploaded: 0, failed: 0 };
  if (!online()) return result;
  const { store } = ctx;
  // Every write waits until nothing is being typed, so a reply landing can never wipe a draft.
  const idle = () => ctx.whenIdle?.() ?? Promise.resolve();
  const local = await photos.ids();

  for (const meal of mealWork(store.doc(), local).estimate) {
    const photo = local.has(meal.id) ? await photos.get(meal.id) : null;
    try {
      const { data } = await ctx.gemini.ask({
        system: MEAL_SYSTEM,
        prompt: mealPrompt({ text: meal.text, at: new Date(meal.at), hasPhoto: !!photo, usual: usualMeals(store.doc()) }),
        image: photo ? { mimeType: 'image/jpeg', data: photo.big } : null,
        models: MEAL_MODELS,
        temperature: MEAL_TEMPERATURE,
      });
      const estimate = parseEstimate(data);
      await idle();
      // A fresh estimate starts the counts again from Gemini's.
      store.updateMeal(meal.id, { state: 'estimated', estimate, items: null, final: finalFor(estimate, meal.portion ?? 'right'), error: null });
      result.estimated++;
    } catch (e) {
      if (waitsUntried(e)) continue;
      await idle();
      store.updateMeal(meal.id, { state: 'failed', tries: (meal.tries ?? 0) + 1, error: String(e?.message ?? e).slice(0, 200) });
      result.failed++;
    }
  }

  const { token, repo } = store.settings();
  if (token && repo) {
    for (const meal of mealWork(store.doc(), local).upload) {
      const photo = await photos.get(meal.id);
      if (!photo) continue;
      const path = photoPath(meal.id, meal.at);
      try {
        await upload({ token, repo, path, base64: photo.small });
        await idle();
        store.updateMeal(meal.id, { photo: path, photoState: 'uploaded' });
        result.uploaded++;
      } catch { /* stays local; the next pass tries again */ }
    }
  }

  // A photo is let go once its meal is done with it: removed, or uploaded and either estimated,
  // corrected, or given up on. A meal this tab hasn't seen yet (another tab's, still syncing) keeps it.
  for (const id of local) {
    const meal = store.doc().meals?.[id];
    if (!meal) continue;
    const settled = meal.state === 'estimated' || meal.correction || (meal.tries ?? 0) >= MAX_TRIES;
    if (meal.status === 'archived' || (meal.photoState === 'uploaded' && settled)) await photos.del(id);
  }
  return result;
}
