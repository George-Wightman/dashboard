import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStt, readStt, sttSpeed, STT_KEY } from '../js/stt.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

// A stand-in for js/stt-worker.js: reports progress, then ready, then writes down "six eggs".
function fakeWorker({ fail = false } = {}) {
  const sent = [];
  const w = {
    sent,
    onmessage: null,
    terminate() { w.ended = true; },
    postMessage(msg) {
      sent.push(msg.type);
      queueMicrotask(() => {
        if (msg.type === 'load') {
          if (fail) { w.onmessage({ data: { type: 'error', message: 'no network' } }); return; }
          w.onmessage({ data: { type: 'progress', loaded: 32, total: 64 } });
          w.onmessage({ data: { type: 'ready', device: 'wasm' } });
        }
        if (msg.type === 'transcribe') w.onmessage({ data: { type: 'text', id: msg.id, text: 'six eggs', ms: 1800 } });
      });
    },
  };
  return w;
}

test('until it is downloaded the device uses Gemini, and says so', async () => {
  const storage = new MemoryStorage();
  const stt = createStt({ storage, makeWorker: () => fakeWorker() });
  assert.equal(stt.status().state, 'none');
  await assert.rejects(stt.transcribe(new Float32Array(16000)), /Not downloaded/);
});

test('downloaded once, it writes down what was said here and remembers how quick it was', async () => {
  const storage = new MemoryStorage();
  const progress = [];
  const worker = fakeWorker();
  const stt = createStt({ storage, makeWorker: () => worker });
  await stt.download((loaded, total) => progress.push(`${loaded}/${total}`));
  assert.deepEqual(progress, ['32/64']);
  assert.equal(stt.status().state, 'ready');
  assert.equal(await stt.transcribe(new Float32Array(16000 * 10)), 'six eggs');
  assert.equal(sttSpeed(readStt(storage)), '1.8 s for 10 s of speech');
  await stt.remove();
  assert.equal(stt.status().state, 'none');
  assert.ok(worker.ended);
});

test('a download that fails leaves Gemini in charge', async () => {
  const storage = new MemoryStorage();
  const stt = createStt({ storage, makeWorker: () => fakeWorker({ fail: true }) });
  await assert.rejects(stt.download(), /no network/);
  assert.equal(stt.status().state, 'none');
});

test('anything unreadable in storage reads as not downloaded', () => {
  const storage = new MemoryStorage();
  storage.setItem(STT_KEY, '{bad');
  assert.equal(readStt(storage).state, 'none');
  assert.equal(sttSpeed({}), null);
});
