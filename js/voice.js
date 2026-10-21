// Dictation, the parts that need no browser. The mic (js/ui/mic.js) records what George says and
// Gemini writes it down, told what he's describing so a meal comes back as "chorizo", not "charities".
// The browser's own speech recognition is weak on the laptop and, on Android, repeats itself, so it's
// only the fallback when there's no Gemini key; heardFrom() takes the repeats out of what it hears.
// Pure.

export const MAX_SECONDS = 180;
export const SAMPLE_RATE = 16000;
// Writing down what was said is a quick plain job: the lighter model first, and no thinking.
export const TRANSCRIBE_MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest'];

export const TRANSCRIBE_SYSTEM = [
  'You write down exactly what a man says in a voice recording, in British English.',
  'Write his words, not a summary: keep every amount, number and food he names. Leave out ums, ers and false starts.',
  'Never add anything he did not say. If a word is unclear, choose what makes sense for what he is describing.',
  'Reply only with JSON: {"text": "what he said"}. If nothing is said, {"text": ""}.',
].join('\n');

const HINTS = {
  meal: 'He is describing a meal he ate: the foods and how much of each.',
  checkin: 'He is saying how a task on his to-do list went.',
  note: 'He is leaving a note for his planner about his plans, tasks or calendar.',
};

export function transcribePrompt(hint) {
  return [HINTS[hint] ?? 'He is dictating a short note.', 'The recording is attached.'].join('\n');
}

export function parseTranscript(data) {
  if (!data || typeof data !== 'object' || typeof data.text !== 'string') throw new Error('Gemini’s transcript didn’t make sense');
  return data.text.replace(/\s+/g, ' ').trim();
}

// What he said added to what's already there.
export function joinText(before, heard) {
  const a = String(before ?? '').trimEnd();
  const b = String(heard ?? '').trim();
  if (!b) return a;
  return a ? `${a} ${b}` : b;
}

// The browser recognition's results as one line. Chrome on Android sends each phrase again with
// more on the end ("six", "six fried", "six fried eggs"), so a result that starts with the one
// before replaces it rather than adding to it.
export function heardFrom(results) {
  const parts = [];
  for (const r of results) {
    const t = String(r?.[0]?.transcript ?? '').trim();
    if (!t) continue;
    const last = parts.at(-1);
    if (last && t.toLowerCase().startsWith(last.toLowerCase())) parts[parts.length - 1] = t;
    else if (!last || !last.toLowerCase().endsWith(t.toLowerCase())) parts.push(t);
  }
  return parts.join(' ');
}

// Mono samples at `from` Hz down to `to` Hz, each output sample the mean of the ones it covers.
export function downsample(samples, from, to = SAMPLE_RATE) {
  if (from <= to) return Float32Array.from(samples);
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

// The recording without the quiet before he starts and after he stops (a little kept either side), so
// less is sent and less is listened to. All of it when nothing is louder than the threshold.
export function trimSilence(samples, rate = SAMPLE_RATE, threshold = 0.02, keepSeconds = 0.25) {
  const window = Math.max(1, Math.round(rate * 0.02));
  const loud = (from) => {
    let peak = 0;
    for (let i = from; i < Math.min(samples.length, from + window); i++) peak = Math.max(peak, Math.abs(samples[i]));
    return peak >= threshold;
  };
  let start = 0;
  while (start < samples.length && !loud(start)) start += window;
  if (start >= samples.length) return samples;
  let end = samples.length;
  while (end > start && !loud(Math.max(start, end - window))) end -= window;
  const keep = Math.round(rate * keepSeconds);
  return samples.subarray(Math.max(0, start - keep), Math.min(samples.length, end + keep));
}

// 16-bit PCM WAV of mono samples (-1…1), which Gemini reads whatever browser recorded it.
export function encodeWav(samples, rate = SAMPLE_RATE) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

export function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
