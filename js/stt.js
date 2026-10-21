// On-device dictation, from the page's side (js/stt-worker.js runs the model). Each device chooses for
// itself in ⚙ → Dictation: download the model once (≈64 MB), and from then on the mic writes down what
// was said here, offline, with nothing sent anywhere; Gemini is the fallback when it isn't downloaded or
// fails. Whether it's downloaded, and how quick it was last time, is this device's own (localStorage).

export const STT_KEY = 'dash_stt';
export const STT_MB = 64;
const TIMEOUT_MS = 60000;

export function readStt(storage) {
  try {
    const v = JSON.parse(storage.getItem(STT_KEY));
    return v && v.state === 'ready' ? { state: 'ready', at: v.at ?? null, lastMs: v.lastMs ?? null, lastSeconds: v.lastSeconds ?? null } : { state: 'none' };
  } catch {
    return { state: 'none' };
  }
}

function writeStt(storage, value) {
  try { storage.setItem(STT_KEY, JSON.stringify(value)); } catch { /* this device only */ }
}

// "2.0 s for 10 s of speech", from the last time.
export function sttSpeed(s) {
  if (!s?.lastMs || !s?.lastSeconds) return null;
  return `${(s.lastMs / 1000).toFixed(1)} s for ${Math.round(s.lastSeconds)} s of speech`;
}

export function createStt({ storage = globalThis.localStorage, makeWorker = () => new Worker(new URL('./stt-worker.js', import.meta.url), { type: 'module' }) } = {}) {
  let worker = null;
  let ready = null;
  let n = 0;
  const waiting = new Map();
  let onProgress = null;

  function start() {
    if (ready) return ready;
    worker = makeWorker();
    ready = new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.type === 'progress') onProgress?.(data.loaded, data.total);
        else if (data.type === 'ready') resolve(data.device);
        else if (data.type === 'text' || data.type === 'error') {
          const w = data.id != null ? waiting.get(data.id) : null;
          if (w) { waiting.delete(data.id); data.type === 'text' ? w.resolve(data) : w.reject(new Error(data.message)); }
          else if (data.type === 'error') reject(new Error(data.message));
        }
      };
      worker.onerror = (e) => reject(new Error(e?.message || 'The speech model couldn\'t start'));
    });
    ready.catch(() => { worker?.terminate(); worker = null; ready = null; });
    worker.postMessage({ type: 'load', device: 'wasm', size: 'base' });
    return ready;
  }

  return {
    status: () => readStt(storage),
    // Fetches the model (the first time) and loads it; `progress(loaded, total)` meanwhile.
    async download(progress = null) {
      onProgress = progress;
      try {
        await start();
      } finally {
        onProgress = null;
      }
      writeStt(storage, { ...readStt(storage), state: 'ready', at: new Date().toISOString() });
    },
    // Loads a downloaded model in the background, so the first tap of the mic doesn't wait for it.
    warm() {
      if (readStt(storage).state === 'ready') start().catch(() => {});
    },
    // What was said, as words. Throws when the model isn't there or can't do it (Gemini takes over).
    async transcribe(samples, rate = 16000) {
      if (readStt(storage).state !== 'ready') throw new Error('Not downloaded on this device');
      await start();
      const id = ++n;
      const result = await new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        setTimeout(() => { if (waiting.delete(id)) reject(new Error('The speech model took too long')); }, TIMEOUT_MS);
        worker.postMessage({ type: 'transcribe', id, audio: samples });
      });
      writeStt(storage, { ...readStt(storage), state: 'ready', lastMs: result.ms, lastSeconds: samples.length / rate });
      return result.text;
    },
    // Takes it off this device: the flag, the worker, and the browser's copy of the model.
    async remove() {
      worker?.terminate();
      worker = null;
      ready = null;
      try { storage.removeItem(STT_KEY); } catch { /* nothing to remove */ }
      try { await globalThis.caches?.delete('transformers-cache'); } catch { /* best effort */ }
    },
  };
}
