import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSCRIBE_SYSTEM, transcribePrompt, parseTranscript, joinText, heardFrom, downsample, encodeWav, toBase64, clock, SAMPLE_RATE,
} from '../js/voice.js';
import { askGemini } from '../js/gemini.js';
import { fakeGeminiFetch } from '../dev/fake-gemini.js';

const said = (...phrases) => phrases.map((t) => [{ transcript: t }]);

test('Android repeating a phrase with more on the end is heard once', () => {
  assert.equal(heardFrom(said('six', 'six fried', 'six fried eggs')), 'six fried eggs');
  assert.equal(heardFrom(said('six fried eggs', ' and butter')), 'six fried eggs and butter');
  assert.equal(heardFrom(said('Six fried eggs', 'six fried eggs in butter', 'three pittas')), 'six fried eggs in butter three pittas');
  assert.equal(heardFrom(said('three pittas', 'pittas')), 'three pittas');
  assert.equal(heardFrom([]), '');
});

test('what he says is added to what is already typed', () => {
  assert.equal(joinText('Breakfast:', ' six eggs '), 'Breakfast: six eggs');
  assert.equal(joinText('', 'six eggs'), 'six eggs');
  assert.equal(joinText('typed ', ''), 'typed');
});

test('the prompt says what he is describing, and a transcript must be text', () => {
  assert.match(transcribePrompt('meal'), /a meal he ate/);
  assert.match(transcribePrompt('checkin'), /task/);
  assert.match(transcribePrompt(undefined), /short note/);
  assert.match(TRANSCRIBE_SYSTEM, /Never add anything he did not say/);
  assert.equal(parseTranscript({ text: '  six   eggs ' }), 'six eggs');
  assert.throws(() => parseTranscript({}), /didn’t make sense/);
  assert.throws(() => parseTranscript(null), /didn’t make sense/);
});

test('a recording becomes 16 kHz mono WAV', () => {
  const tone = Float32Array.from({ length: 48000 }, (_, i) => Math.sin(i / 10));
  const down = downsample(tone, 48000);
  assert.equal(down.length, 16000);
  const wav = encodeWav(down);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.subarray(8, 12)), 'WAVE');
  assert.equal(v.getUint16(22, true), 1, 'mono');
  assert.equal(v.getUint32(24, true), SAMPLE_RATE);
  assert.equal(v.getUint16(34, true), 16, '16-bit');
  assert.equal(v.getUint32(40, true), 32000);
  assert.equal(wav.length, 44 + 32000);
  assert.equal(encodeWav(Float32Array.from([2, -2])).length, 48, 'clipped, not wrapped');
  assert.equal(new DataView(encodeWav(Float32Array.from([2, -2])).buffer).getInt16(44, true), 0x7fff);
  assert.equal(toBase64(Uint8Array.from([104, 105])), 'aGk=');
  assert.equal(downsample(Float32Array.from([1, 2]), 8000).length, 2, 'never upsampled');
});

test('a recording goes to Gemini as inline audio, and the fake answers with words', async () => {
  let body;
  const fetch = async (url, init) => { body = JSON.parse(init.body); return fakeGeminiFetch('ok', { delayMs: 0 })(url, init); };
  const { data } = await askGemini({ keys: ['k'], system: TRANSCRIBE_SYSTEM, prompt: transcribePrompt('meal'), image: { mimeType: 'audio/wav', data: 'UklGRg==' }, temperature: 0, fetch });
  assert.deepEqual(body.contents[0].parts[0], { inlineData: { mimeType: 'audio/wav', data: 'UklGRg==' } });
  assert.equal(body.generationConfig.temperature, 0);
  assert.match(parseTranscript(data), /six fried eggs/);
});

test('the clock reads minutes and seconds', () => {
  assert.equal(clock(7), '0:07');
  assert.equal(clock(65.4), '1:05');
});
