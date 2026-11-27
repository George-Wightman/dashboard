// Canned Gemini for local testing, so a check-in's summary can be checked without a key and
// without spending any quota. js/app.js imports this only on localhost with ?fakegemini, and in
// that mode never reads a real key. It is not in the offline shell (sw.js).
//
//   ?fakegemini          ok: canned replies after 0.8 s
//   ?fakegemini=slow     the same after 5 s
//   ?fakegemini=nokey    no key at all (the app gives the client no keys, so this is never called)
//   ?fakegemini=quota    429 with no retry hint, every time
//   ?fakegemini=down     503, every time
//   ?fakegemini=offline  the request never reaches Google
//   ?fakegemini=badkey   400 "API key not valid"
//   ?fakegemini=nonsense a 200 whose text isn't JSON
//   ?fakegemini=meal     a canned meal estimate (js/food.js's MEAL_SYSTEM); meal-slow after 5 s;
//                        meal-nonsense a 200 that isn't an estimate
// A pot's ingredients (js/food.js's POT_SYSTEM) get a canned chicken and rice in any mode that answers.
// A recording to write down (js/voice.js's TRANSCRIBE_SYSTEM) gets a canned breakfast in any mode that answers.
// Any other mode behaves like ok.

import { SUMMARY_SYSTEM } from '../js/checkins.js';
import { MEAL_SYSTEM, POT_SYSTEM } from '../js/food.js';
import { TRANSCRIBE_SYSTEM } from '../js/voice.js';

export const FAKE_MODES = ['ok', 'slow', 'nokey', 'quota', 'down', 'offline', 'badkey', 'nonsense', 'meal', 'meal-slow', 'meal-nonsense'];

// The canned estimate for a meal: a chicken wrap, whatever the photo.
const MEAL = { name: 'Chicken wrap and crisps', items: [{ name: 'Large chicken wrap', qty: 2, unit: 'wraps', protein: 40, kcal: 560 }, { name: 'Bag of crisps', qty: 1, unit: 'bag', protein: 2, kcal: 180 }, { name: 'Sauce', qty: 30, unit: 'g', protein: 0, kcal: 40 }],
  protein: { low: 38, mid: 46, high: 54 }, kcal: { low: 650, mid: 780, high: 900 } };

// The canned pot: chicken and rice, item by item.
const POT = { name: 'Chicken and rice', plants: ['rice', 'tomato'], items: [
  { name: 'raw chicken breast', qty: 6, unit: 'breasts', protein: 186, kcal: 990, carbs: 0, fat: 21, fibre: 0, sugar: 0, veg: 0, fruit: 0, oilyFish: 0 },
  { name: 'dry basmati rice', qty: 500, unit: 'g', protein: 40, kcal: 1750, carbs: 390, fat: 3, fibre: 5, sugar: 0, veg: 0, fruit: 0, oilyFish: 0 },
  { name: 'chopped tomatoes', qty: 2, unit: 'tins', protein: 8, kcal: 160, carbs: 28, fat: 1, fibre: 7, sugar: 20, veg: 5, fruit: 0, oilyFish: 0 },
] };

function response(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text };
}

const reply = (text) => response(200, { candidates: [{ content: { parts: [{ text }] } }] });
const failure = (status, message) => response(status, { error: { code: status, message } });

// Everything the request asked, as one string (the plain retry puts the system text in too).
function promptOf(init) {
  try {
    const body = JSON.parse(init?.body ?? '{}');
    return [body.systemInstruction, ...(body.contents ?? [])].flatMap((c) => c?.parts ?? []).map((p) => p.text ?? '').join('\n');
  } catch {
    return '';
  }
}

// The canned summary (js/checkins.js's SUMMARY_SYSTEM): his words, cut down.
function answer(prompt) {
  if (prompt.includes(POT_SYSTEM)) return POT;
  if (prompt.includes(MEAL_SYSTEM)) return MEAL;
  if (prompt.includes(TRANSCRIBE_SYSTEM)) return { text: 'six fried eggs, three wholemeal pittas and a quarter of a cucumber' };
  if (!prompt.includes(SUMMARY_SYSTEM)) return {};
  const said = prompt.split('What he said:\n')[1] ?? '';
  return { summary: `Fake summary: ${said.replace(/\s+/g, ' ').trim().slice(0, 160)}` };
}

function wait(ms, signal) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    });
  });
}

// A stand-in for fetch with Google's response shapes. The URL (which carries the fake key) is
// ignored.
export function fakeGeminiFetch(mode = 'ok', { delayMs = mode === 'slow' || mode === 'meal-slow' ? 5000 : 800 } = {}) {
  return async (url, init) => {
    await wait(delayMs, init?.signal);
    switch (mode) {
      case 'quota': return failure(429, 'Resource has been exhausted (e.g. check quota).');
      case 'down': return failure(503, 'The model is overloaded.');
      case 'offline': throw new TypeError('Failed to fetch');
      case 'badkey': return failure(400, 'API key not valid. Please pass a valid API key.');
      case 'nonsense': case 'meal-nonsense': return reply('Happy to help!');
      default: return reply(JSON.stringify(answer(promptOf(init))));
    }
  };
}
