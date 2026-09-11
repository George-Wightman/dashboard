// Canned Gemini for local testing, so every Coach panel state can be checked without a key and
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
// Any other mode behaves like ok.

import { JOBS, clip } from '../js/coach.js';
import { addDays } from '../js/dates.js';

export const FAKE_MODES = ['ok', 'slow', 'nokey', 'quota', 'down', 'offline', 'badkey', 'nonsense'];

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
    return (body.contents ?? []).flatMap((c) => c.parts ?? []).map((p) => p.text ?? '').join('\n');
  } catch {
    return '';
  }
}

// The canned reply for whichever job's text is in the prompt. Each one passes its parser.
function answer(prompt) {
  if (prompt.includes(JOBS.shape)) {
    const wrote = clip(prompt.match(/^George wrote: (.*)$/m)?.[1] ?? 'A new goal', 60);
    const today = prompt.match(/^Today's date: (\d{4}-\d{2}-\d{2})$/m)?.[1];
    return {
      title: wrote.charAt(0).toUpperCase() + wrote.slice(1),
      targetDate: today ? addDays(today, 56) : null,
      milestones: ['Write down what done looks like', 'Take the first small step', 'Review how week one went', 'Reach the halfway point'],
      habits: [{ title: 'Ten minutes towards it', repeat: { kind: 'weekdays', days: [1, 3, 5] } }],
      targets: [{ title: 'Time on it', target: 90, unit: 'minutes', unitLabel: '' }],
      why: 'A fake plan: small weekly steps you can actually hit.',
    };
  }
  if (prompt.includes(JOBS.feedback)) {
    return {
      feedback: 'Fake feedback: you finished the thing that mattered most today.\n\nTomorrow, start with the task you carried over, before opening email.',
      tomorrow: [{ title: 'Start with the carried-over task (fake)' }],
    };
  }
  if (prompt.includes(JOBS.digest)) {
    return {
      summary: 'A fake digest: a steady week. Most habits held, the weekly targets moved, and two tasks carried over.',
      wins: ['Hebrew practice most days', 'Two applications sent'],
      slipped: ['Gym only once'],
      focus: 'Start each day with the task you would rather avoid.',
    };
  }
  if (prompt.includes(JOBS.questions)) {
    return {
      questions: [
        'What went best today, and why did it work?',
        'What got in the way of the thing you left undone?',
        'What is the first thing you will do tomorrow?',
      ],
    };
  }
  return {};
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
export function fakeGeminiFetch(mode = 'ok', { delayMs = mode === 'slow' ? 5000 : 800 } = {}) {
  return async (url, init) => {
    await wait(delayMs, init?.signal);
    switch (mode) {
      case 'quota': return failure(429, 'Resource has been exhausted (e.g. check quota).');
      case 'down': return failure(503, 'The model is overloaded.');
      case 'offline': throw new TypeError('Failed to fetch');
      case 'badkey': return failure(400, 'API key not valid. Please pass a valid API key.');
      case 'nonsense': return reply('Happy to help!');
      default: return reply(JSON.stringify(answer(promptOf(init))));
    }
  };
}
