// The mic, for the snap sheet, the check-in card and the note for Claude. Tap it and speak; tap again
// and what he said is written down and added to what's already typed, there to read before saving.
// Nothing is sent by itself. Written down on this device when its speech model is downloaded (⚙ →
// Dictation, js/stt.js), otherwise — or if that fails — by Gemini (js/voice.js), told what he's
// describing. With neither (or a browser that can't record) it falls back to the browser's own speech
// recognition, as he speaks. No button where nothing is possible. One recording at a time on the page.

import { h } from './dom.js';
import {
  TRANSCRIBE_SYSTEM, TRANSCRIBE_MODELS, transcribePrompt, parseTranscript, joinText, heardFrom, downsample, encodeWav, toBase64, clock,
  trimSilence, MAX_SECONDS, SAMPLE_RATE,
} from '../voice.js';

const MIC = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>';
const BLOCKED = 'The microphone is blocked for this page: allow it in the browser to speak.';

// { key, phase: 'recording' | 'transcribing' | 'speech', started, stop, cancel }
let listening = null;
let ticker = null;

// Gemini, set once by js/app.js: ask(...) as ctx.gemini.ask, ready() when there's a key to use. And
// the on-device model (js/stt.js), when this device has one.
let transcriber = null;
let local = null;
export function useTranscriber(t, stt = null) { transcriber = t; local = stt; }
const localReady = () => local?.status().state === 'ready';

export function speechRecognition(g = globalThis) {
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

const canRecord = (g = globalThis) => !!(g.navigator?.mediaDevices?.getUserMedia && g.MediaRecorder && (g.AudioContext ?? g.webkitAudioContext));
const recording = () => (localReady() || !!transcriber?.ready()) && canRecord();

// Stops whatever is listening without writing anything down: the sheet it was for is closing or sending.
export const stopListening = () => listening?.cancel();

function tick() {
  clearInterval(ticker);
  ticker = setInterval(() => {
    if (listening?.phase !== 'recording') { clearInterval(ticker); return; }
    const seconds = (Date.now() - listening.started) / 1000;
    for (const el of document.querySelectorAll('.mic.on .mic-time')) el.textContent = clock(seconds);
    if (seconds >= MAX_SECONDS) listening.stop();
  }, 500);
}

// The recording as 16 kHz mono samples, the quiet either side cut, whatever the browser recorded in.
async function samplesOf(blob) {
  const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const audio = new Ctx();
  try {
    const decoded = await audio.decodeAudioData(await blob.arrayBuffer());
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const ch = decoded.getChannelData(c);
      for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / decoded.numberOfChannels;
    }
    return trimSilence(downsample(mono, decoded.sampleRate, SAMPLE_RATE));
  } finally {
    audio.close?.();
  }
}

async function record({ key, hint, getText, setText, onBlocked, render }) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  } catch (e) {
    onBlocked(e?.name === 'NotAllowedError' ? BLOCKED : 'The microphone couldn’t be started.');
    render();
    return;
  }
  const chunks = [];
  const rec = new MediaRecorder(stream);
  let cancelled = false;
  const me = {
    key, phase: 'recording', started: Date.now(),
    stop: () => { if (rec.state !== 'inactive') rec.stop(); },
    cancel: () => { cancelled = true; if (rec.state !== 'inactive') rec.stop(); },
  };
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  rec.onstop = async () => {
    for (const t of stream.getTracks()) t.stop();
    if (cancelled || !chunks.length) { if (listening === me) listening = null; render(); return; }
    me.phase = 'transcribing';
    render();
    try {
      const samples = await samplesOf(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      let heard = null;
      if (localReady()) {
        try { heard = (await local.transcribe(samples)).replace(/\s+/g, ' ').trim(); } catch { heard = null; }
      }
      if (heard === null) {
        if (!transcriber?.ready()) throw new Error('the speech model on this device failed, and there’s no Gemini key');
        const reply = await transcriber.ask({
          system: TRANSCRIBE_SYSTEM, prompt: transcribePrompt(hint), image: { mimeType: 'audio/wav', data: toBase64(encodeWav(samples)) },
          models: TRANSCRIBE_MODELS, temperature: 0, think: false,
        });
        heard = parseTranscript(reply.data);
      }
      if (heard) setText(joinText(getText(), heard));
      else onBlocked('Nothing was heard. Try again a little closer to the mic.');
    } catch (e) {
      onBlocked(`That couldn’t be written down (${e?.message ?? e}). Try again, or type it.`);
    } finally {
      if (listening === me) listening = null;
      render();
    }
  };
  listening = me;
  rec.start(1000);
  tick();
  render();
}

function speak({ key, getText, setText, onBlocked, render }) {
  const Recognition = speechRecognition();
  const r = new Recognition();
  r.lang = 'en-GB';
  r.interimResults = true;
  r.continuous = true;
  const before = getText() ?? '';
  r.onresult = (e) => setText(joinText(before, heardFrom(Array.from(e.results))));
  r.onerror = (e) => {
    if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') onBlocked(BLOCKED);
  };
  const me = { key, phase: 'speech', started: Date.now(), stop: () => r.stop(), cancel: () => r.stop() };
  r.onend = () => { if (listening === me) listening = null; render(); };
  listening = me;
  try { r.start(); } catch { listening = null; }
  render();
}

// `key` names what's being dictated into, so only its button shows as on; `hint` says what he's
// describing (meal, checkin, note). getText/setText read and write the draft; onBlocked shows a
// problem; render redraws the page.
export function micButton({ key, hint = null, getText, setText, onBlocked, render }) {
  if (!recording() && !speechRecognition()) return null;
  const mine = listening?.key === key ? listening : null;
  const busy = mine?.phase === 'transcribing';
  const label = busy ? 'Writing it down…' : mine ? 'Stop: write down what I said' : 'Speak instead of typing';
  const button = h('button', {
    class: `btn mic${mine && !busy ? ' on' : ''}${busy ? ' busy' : ''}`, type: 'button', 'aria-pressed': String(!!mine && !busy),
    'aria-label': label, title: label, disabled: busy,
    onclick: () => {
      if (mine) { mine.stop(); return; }
      // Another box was listening: what it heard still goes into that box.
      if (listening && listening.phase !== 'transcribing') listening.stop();
      const opts = { key, hint, getText, setText, onBlocked, render };
      if (recording()) record(opts);
      else speak(opts);
    },
  });
  button.innerHTML = MIC; // a fixed string, never data
  if (mine?.phase === 'recording') button.append(h('span', { class: 'mic-time' }, clock((Date.now() - mine.started) / 1000)));
  if (busy) button.append(h('span', { class: 'mic-time' }, '…'));
  return button;
}

// A textarea that fits what's in it.
export function grow(box) {
  box.style.height = 'auto';
  box.style.height = `${box.scrollHeight + 2}px`;
}
