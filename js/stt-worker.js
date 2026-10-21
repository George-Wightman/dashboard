// On-device dictation (js/ui/mic.js, js/stt.js): a speech model run in the browser, in this worker so
// the page never stalls. Moonshine base (Useful Sensors), through Transformers.js, downloaded once from
// Hugging Face and kept by the browser; after that it works offline and nothing leaves the device. On
// the graphics chip where the browser offers one (WebGPU), otherwise on the processor, smaller.
//
// Messages in: { type: 'load', device } and { type: 'transcribe', id, audio } (16 kHz mono
// Float32Array). Out: { type: 'progress', loaded, total }, { type: 'ready', device },
// { type: 'text', id, text, ms } and { type: 'error', id?, message }.

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;
env.useBrowserCache = true;

// Base by default; tiny (≈27 MB, quicker, less sure of itself) when asked.
const MODELS = { base: 'onnx-community/moonshine-base-ONNX', tiny: 'onnx-community/moonshine-tiny-ONNX' };
// What each way of running it downloads: the full-size encoder with a 4-bit decoder on the graphics
// chip (≈146 MB), both 8-bit on the processor (≈61 MB).
const DTYPES = {
  webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
  wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' },
};

let asr = null;
let loading = null;
let running = null;

async function load(device, size = 'base') {
  const model = MODELS[size] ?? MODELS.base;
  const files = new Map();
  const report = (p) => {
    if (p.status !== 'progress' || !p.file) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    self.postMessage({ type: 'progress', loaded, total });
  };
  const make = (d) => pipeline('automatic-speech-recognition', model, { device: d, dtype: DTYPES[d], progress_callback: report });
  try {
    asr = await make(device);
    running = device;
  } catch (e) {
    if (device === 'wasm') throw e;
    asr = await make('wasm');
    running = 'wasm';
  }
  self.postMessage({ type: 'ready', device: running });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      loading ??= load(data.device === 'webgpu' ? 'webgpu' : 'wasm', data.size);
      await loading;
      return;
    }
    if (data.type === 'transcribe') {
      if (!loading) throw new Error('The speech model isn\'t loaded');
      await loading;
      const t = performance.now();
      const out = await asr(data.audio);
      self.postMessage({ type: 'text', id: data.id, text: String(out?.text ?? '').trim(), ms: Math.round(performance.now() - t) });
    }
  } catch (e) {
    if (data.type === 'load') loading = null;
    self.postMessage({ type: 'error', id: data.id, message: String(e?.message ?? e).slice(0, 300) });
  }
};
