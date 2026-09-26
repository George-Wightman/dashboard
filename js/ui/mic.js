// The mic: the browser's own speech-to-text (Chrome on the phone and the laptop), for the check-in
// card and the note for Claude. What he says is added to what's already typed as he speaks; tap
// again, or stop talking, and it's there to read before saving. Nothing is sent by itself. No
// button where the browser has no speech recognition. One recording at a time on the page.

import { h } from './dom.js';

const MIC = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>';
let listening = null;

export function speechRecognition(g = globalThis) {
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

export const stopListening = () => listening?.r.stop();

// `key` names what's being dictated into, so only its button shows as on. getText/setText read and
// write the draft; onBlocked says the mic isn't allowed; render redraws the page.
export function micButton({ key, getText, setText, onBlocked, render }) {
  const Recognition = speechRecognition();
  if (!Recognition) return null;
  const on = listening?.key === key;
  const button = h('button', {
    class: `btn mic${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on),
    'aria-label': on ? 'Stop listening' : 'Speak instead of typing', title: on ? 'Stop listening' : 'Speak instead of typing',
    onclick: () => {
      if (listening) { const was = listening.key; listening.r.stop(); if (was === key) return; }
      const r = new Recognition();
      r.lang = 'en-GB';
      r.interimResults = true;
      r.continuous = true;
      const before = getText() ? `${String(getText()).trimEnd()} ` : '';
      r.onresult = (e) => {
        let heard = '';
        for (let i = 0; i < e.results.length; i++) heard += e.results[i][0].transcript;
        setText(`${before}${heard.trim()}`);
      };
      r.onerror = (e) => {
        if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') onBlocked('The microphone is blocked for this page: allow it in the browser to speak.');
      };
      r.onend = () => { if (listening?.r === r) listening = null; render(); };
      listening = { key, r };
      try { r.start(); } catch { listening = null; }
      render();
    },
  });
  button.innerHTML = MIC; // a fixed string, never data
  return button;
}

// A textarea that fits what's in it.
export function grow(box) {
  box.style.height = 'auto';
  box.style.height = `${box.scrollHeight + 2}px`;
}
