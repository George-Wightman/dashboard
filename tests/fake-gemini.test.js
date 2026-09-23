import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeGeminiFetch, FAKE_MODES } from '../dev/fake-gemini.js';
import { askGemini, GeminiError } from '../js/gemini.js';
import {
  questionsPrompt, feedbackPrompt, digestPrompt, parseQuestions, parseFeedback, parseDigest,
} from '../js/coach.js';
import { fixture } from './helpers.js';

const TODAY = '2026-09-11';

// Timers that never fire: the client's 30 s timeout is set and cleared, nothing more. With
// delayMs 0 the fake answers at once, so no real timer is involved anywhere.
const timers = { setTimeout: () => 0, clearTimeout: () => {} };

const ask = (mode, job) => askGemini({ keys: ['fake-key'], ...job, fetch: fakeGeminiFetch(mode, { delayMs: 0 }), timers });

test('the fake answers every job with a reply its parser accepts', async () => {
  const doc = fixture();
  const q = await ask('ok', questionsPrompt(doc, TODAY));
  assert.equal(q.model, 'gemini-flash-lite-latest');
  const { questions } = parseQuestions(q.data);
  assert.equal(questions.length, 3);

  const f = parseFeedback((await ask('ok', feedbackPrompt(doc, TODAY, questions, ['Fine', '', 'Start early']))).data);
  assert.ok(f.feedback.length > 0);
  assert.equal(f.tomorrow.length, 1);

  const d = parseDigest((await ask('ok', digestPrompt(doc, '2026-08-31'))).data);
  assert.ok(d.summary.length > 0 && d.focus.length > 0);
  assert.equal(d.wins.length, 2);
  assert.equal(d.slipped.length, 1);
});

test('each fake mode fails the way it says', async () => {
  const job = questionsPrompt(fixture(), TODAY);
  const outcome = (mode) => ask(mode, job).then(() => 'ok', (e) => (e instanceof GeminiError ? e.code : String(e)));
  assert.equal(await outcome('slow'), 'ok');
  assert.equal(await outcome('quota'), 'quota');
  assert.equal(await outcome('down'), 'failed');
  assert.equal(await outcome('offline'), 'offline');
  assert.equal(await outcome('badkey'), 'badkey');
  assert.equal(await outcome('nonsense'), 'nonsense');
  assert.deepEqual(FAKE_MODES, ['ok', 'slow', 'nokey', 'quota', 'down', 'offline', 'badkey', 'nonsense']);
});
