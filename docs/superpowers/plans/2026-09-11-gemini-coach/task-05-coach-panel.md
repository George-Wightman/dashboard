# Task 5: Coach panel and evening check-in

Part of [the Gemini coach plan](../2026-09-11-gemini-coach.md) — read its Global Constraints first.

**Files:**
- Create: `js/ui/coach.js`, `dev/fake-gemini.js`, `tests/fake-gemini.test.js`
- Modify: `js/dates.js` (`hourLabel` appended), `tests/dates.test.js` (import + one test),
  `js/app.js` (five exact edits), `js/ui/side.js` (two exact edits), `styles.css` (a block
  appended), `index.html` (one line)

**Interfaces:**
- Consumes: `askGemini`, `geminiKeys`, `GeminiError`, `MESSAGES` from `js/gemini.js` (Task 2);
  `checkinOf`, `checkinState`, `questionsPrompt`, `feedbackPrompt`, `parseQuestions`,
  `parseFeedback`, `JOBS`, `clip` from `js/coach.js` (Tasks 3–4); `saveJournal`, `addPlan` on the
  store (Task 1); `addDays` from `js/dates.js`; `h` from `js/ui/dom.js`; `fixture` from
  `tests/helpers.js`; `typing()`, `checkRollover()` and the render loop already in `js/app.js`.
- Produces:
  - `hourLabel(hour)` in `js/dates.js`: `18 → '6pm'`, `12 → '12pm'`, `23 → '11pm'`, `0 → '12am'`, `9 → '9am'`.
  - `dev/fake-gemini.js`: `FAKE_MODES`, `fakeGeminiFetch(mode, { delayMs })` — see the plan's Shared
    interfaces. `delayMs: 0` answers without any timer (the Node test uses that).
  - `js/ui/coach.js`: `renderCoach(ctx)`, `checkinNow(ctx)`, `startCheckin(ctx)`, `sendCheckin(ctx)`.
  - `js/app.js`: `ui.coach` (every field Tasks 5–7 use), `ctx.coach` (`fake`, `keys()`, `ask()`), the
    fake switch, and the minute tick that repaints when the check-in state moves on.
  - `js/ui/side.js`: the Coach panel is the first panel in `#side`. `renderSide` puts focus (and the
    caret) back into a text box marked `data-focus` after it replaces the column, so a re-render
    while George is typing doesn't interrupt him; the text itself comes back from `ctx.ui.coach`.

**How the panel stays out of the way:**
- A request never blocks: `startCheckin` / `sendCheckin` set `ui.coach.busy`, render "Thinking…",
  and await in the background. Everything else on the page keeps working. `busy` also stops a second
  click from sending a second request.
- Every flow captures `today = store.today()` once at its start, and builds its prompt from the
  document as it is at that moment.
- Nothing is written until the reply has passed its parser (`consult` asks and parses in one step;
  a parser failure is a `GeminiError('nonsense')`).
- Typed answers live in `ui.coach.answers`, updated on every keystroke, and each textarea is rebuilt
  from it on every render. The render loop replaces `#side` on every store change and every sync,
  so this is what keeps them. On top of that, `renderSide` restores focus to the same box.
- The existing `canRun()` hold-back already covers the new boxes: `typing()` matches any focused,
  non-empty `textarea` inside `#side`, so a sync pull or another window's save waits while George is
  mid-answer. No change is needed there. The minute tick uses the same `typing()` check before it
  repaints.
- Errors are shown as text only: `GeminiError`'s fixed message, `MESSAGES.failed` for anything else
  from the request, or the store's own message. The key is never shown — `js/gemini.js` never puts it
  in an error, and nothing here prints a key or an error's raw text.

- [ ] **Step 1: Write the failing tests**

In `tests/dates.test.js`, replace:

```js
  shortWeekday, shortDate, longDate, carryLabel,
} from '../js/dates.js';
```

with:

```js
  shortWeekday, shortDate, longDate, carryLabel, hourLabel,
} from '../js/dates.js';
```

and append to the end of the file:

```js

test('hourLabel: a whole hour on the 12-hour clock', () => {
  assert.equal(hourLabel(18), '6pm');
  assert.equal(hourLabel(12), '12pm');
  assert.equal(hourLabel(23), '11pm');
  assert.equal(hourLabel(0), '12am');
  assert.equal(hourLabel(9), '9am');
});
```

Create `tests/fake-gemini.test.js`. It runs the fake through the real client and the real parsers,
so the browser checks in Tasks 5–7 can rely on every canned reply being accepted:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeGeminiFetch, FAKE_MODES } from '../dev/fake-gemini.js';
import { askGemini, GeminiError } from '../js/gemini.js';
import {
  questionsPrompt, feedbackPrompt, shapePrompt, digestPrompt, parseQuestions, parseFeedback, parseShape, parseDigest,
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

  const s = parseShape((await ask('ok', shapePrompt(doc, TODAY, 'run a 10k by Christmas'))).data, TODAY);
  assert.equal(s.title, 'Run a 10k by Christmas');
  assert.equal(s.targetDate, '2026-11-06');
  assert.equal(s.milestones.length, 4);
  assert.deepEqual(s.habits.map((x) => x.repeat), [{ kind: 'weekdays', days: [1, 3, 5] }]);
  assert.deepEqual(s.targets.map((x) => [x.target, x.unit]), [[90, 'minutes']]);
  assert.ok(s.why.length > 0);

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
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm test`
Expected: FAIL —
- `tests/dates.test.js` doesn't load: `SyntaxError: The requested module '../js/dates.js' does not provide an export named 'hourLabel'`
- `tests/fake-gemini.test.js` doesn't load: `ERR_MODULE_NOT_FOUND` for `dev/fake-gemini.js`

- [ ] **Step 3: Add `hourLabel` to `js/dates.js`**

Append to the end of `js/dates.js`:

```js

// A whole hour on the 12-hour clock: 18 → '6pm', 12 → '12pm', 0 → '12am'.
export function hourLabel(hour) {
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${hour < 12 ? 'am' : 'pm'}`;
}
```

- [ ] **Step 4: Create `dev/fake-gemini.js`**

```js
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
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — 174 tests (171 before, plus 1 in `dates.test.js` and 2 in `fake-gemini.test.js`).

- [ ] **Step 6: Create `js/ui/coach.js`**

```js
// The Coach panel: today's evening check-in (and, from Tasks 6 and 7, goal shaping and last
// week's digest). Every Gemini request runs in the background: the panel says "Thinking…", the
// rest of the page keeps working, and a failure is one line of text, never a dialog. What George
// types lives in ctx.ui.coach, so a re-render (a sync landing, a tick on the left) never loses it.
// Nothing is written to the document until a reply has passed its parser.

import { h } from './dom.js';
import { GeminiError, MESSAGES } from '../gemini.js';
import { checkinOf, checkinState, questionsPrompt, feedbackPrompt, parseQuestions, parseFeedback } from '../coach.js';
import { addDays, hourLabel } from '../dates.js';

const link = (text, onclick) => h('button', { class: 'link', type: 'button', onclick }, text);

// Why a request can't be sent right now ('' when it can): no key on this device, or offline.
function blocker(ctx) {
  if (!ctx.coach.keys().length) return MESSAGES.nokey;
  if (navigator.onLine === false) return MESSAGES.offline;
  return '';
}

// Ask Gemini, then check the reply. Resolves { reply, model }. Rejects with an Error whose message
// is the line to show: Gemini's own plain-English message, or the catch-all — never another
// error's raw text.
async function consult(ctx, prompt, parse) {
  const why = blocker(ctx);
  if (why) throw new Error(why);
  try {
    const { data, model } = await ctx.coach.ask(prompt);
    return { reply: parse(data), model };
  } catch (e) {
    throw new Error(e instanceof GeminiError ? e.message : MESSAGES.failed);
  }
}

// Today's check-in state as the panel shows it right now. js/app.js repaints when it changes
// (the check-in hour arriving while the page sits open).
export function checkinNow(ctx) {
  const { store } = ctx;
  const { dayStartHour, checkinHour } = store.settings();
  return checkinState({
    doc: store.doc(), today: store.today(), now: new Date(), dayStartHour, checkinHour,
    hasKey: ctx.coach.keys().length > 0,
  });
}

// ---- The check-in -----------------------------------------------------------------------------

// Job A: Gemini's questions about today, saved as soon as they arrive (so they survive a reload
// or a switch of device).
export async function startCheckin(ctx) {
  const { store, ui } = ctx;
  const c = ui.coach;
  if (c.busy) return;
  const today = store.today();
  c.error = '';
  c.busy = 'questions';
  ctx.render();
  try {
    const { reply, model } = await consult(ctx, questionsPrompt(store.doc(), today), parseQuestions);
    c.answers = [];
    c.notNow = '';
    store.saveJournal({ kind: 'checkin', day: today, questions: reply.questions, answers: [], feedback: '', tomorrowIds: [], model });
  } catch (e) {
    c.error = e.message;
  } finally {
    c.busy = '';
    ctx.render();
  }
}

// Job B: his answers go to Gemini; its feedback and at most two tasks for tomorrow come back.
// The tasks land as suggestions dated tomorrow, then the check-in is saved with the answers.
export async function sendCheckin(ctx) {
  const { store, ui } = ctx;
  const c = ui.coach;
  if (c.busy) return;
  const today = store.today();
  const rec = checkinOf(store.doc(), today);
  if (!rec?.questions?.length) return;
  const answers = rec.questions.map((_, i) => String(c.answers[i] ?? '').trim());
  if (!answers.some(Boolean)) {
    c.error = 'Answer at least one question first.';
    ctx.render();
    return;
  }
  c.error = '';
  c.busy = 'feedback';
  ctx.render();
  try {
    const { reply, model } = await consult(ctx, feedbackPrompt(store.doc(), today, rec.questions, answers), parseFeedback);
    const { items } = store.addPlan({ tasks: reply.tomorrow.map((t) => ({ title: t.title, date: addDays(today, 1) })) });
    store.saveJournal({ kind: 'checkin', day: today, answers, feedback: reply.feedback, tomorrowIds: items.map((i) => i.id), model });
    c.answers = [];
    c.feedbackOpen = true;
  } catch (e) {
    c.error = e.message;
  } finally {
    c.busy = '';
    ctx.render();
  }
}

function renderQuestions(ctx, rec) {
  const c = ctx.ui.coach;
  const send = () => sendCheckin(ctx);
  return h('form', { class: 'checkin', onsubmit: (e) => { e.preventDefault(); send(); } },
    rec.questions.map((q, i) => {
      // The box is rebuilt from ui.coach.answers on every render; data-focus lets renderSide
      // put the caret back after a re-render.
      const box = h('textarea', { rows: 2, 'data-focus': `coach-answer-${i}` });
      box.value = c.answers[i] ?? '';
      box.addEventListener('input', () => { c.answers[i] = box.value; });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
      });
      return h('label', { class: 'question' }, h('span', {}, q), box);
    }),
    h('div', { class: 'buttons' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Send'),
      link('Not now', () => { c.notNow = ctx.store.today(); c.error = ''; ctx.render(); })));
}

function renderFeedback(ctx, rec) {
  const c = ctx.ui.coach;
  const doc = ctx.store.doc();
  const waiting = (rec.tomorrowIds ?? []).filter((id) => doc.items[id]?.status === 'suggested').length;
  const details = h('details', { class: 'coach-feedback', open: c.feedbackOpen },
    h('summary', {}, "Today's check-in"),
    h('p', { class: 'feedback-text' }, rec.feedback),
    waiting
      ? h('p', { class: 'muted' }, waiting === 1
        ? 'A task for tomorrow waits at the top of the list.'
        : `${waiting} tasks for tomorrow wait at the top of the list.`)
      : null);
  details.addEventListener('toggle', () => { c.feedbackOpen = details.open; });
  return details;
}

function renderCheckin(ctx) {
  const { store, ui } = ctx;
  const c = ui.coach;
  if (c.busy) return h('p', { class: 'muted', role: 'status' }, 'Thinking…');
  const today = store.today();
  const doc = store.doc();
  switch (checkinNow(ctx)) {
    case 'nokey':
      return h('p', { class: 'muted' }, MESSAGES.nokey);
    case 'early':
      return h('p', { class: 'muted' },
        `Evening check-in from ${hourLabel(store.settings().checkinHour)} · `, link('check in now', () => startCheckin(ctx)));
    case 'due':
      return h('button', { class: 'btn primary', type: 'button', onclick: () => startCheckin(ctx) }, "Start today's check-in");
    case 'questions':
      return c.notNow === today
        ? h('p', { class: 'muted' }, "Today's check-in is waiting · ", link('answer now', () => { c.notNow = ''; ctx.render(); }))
        : renderQuestions(ctx, checkinOf(doc, today));
    default: // 'done'
      return renderFeedback(ctx, checkinOf(doc, today));
  }
}

// ---- The panel --------------------------------------------------------------------------------

export function renderCoach(ctx) {
  const c = ctx.ui.coach;
  return h('section', { class: 'panel coach' },
    h('h2', {}, 'Coach', ctx.coach.fake ? h('span', { class: 'fake' }, `fake · ${ctx.coach.fake}`) : null),
    renderCheckin(ctx),
    c.error ? h('p', { class: 'error', role: 'status' }, c.error) : null);
}
```

- [ ] **Step 7: Put the panel first in `js/ui/side.js`, and keep focus across a re-render**

7a. Replace:

```js
import { SOURCE_NAMES } from './today.js';
```

with:

```js
import { SOURCE_NAMES } from './today.js';
import { renderCoach } from './coach.js'; // js/ui/coach.js, the panel (js/coach.js is the pure half)
```

7b. Replace:

```js
export function renderSide(ctx) {
  document.getElementById('side').replaceChildren(
    ...[renderWeek(ctx), renderGoals(ctx), renderHistory(ctx)].filter(Boolean));
}
```

with:

```js
// A re-render replaces the whole column. A text box marked data-focus gets its focus and caret
// back afterwards (its text comes back from ctx.ui), so typing carries on uninterrupted.
function keptFocus(root) {
  const el = document.activeElement;
  if (!el || !root.contains(el) || !el.dataset.focus) return null;
  return { key: el.dataset.focus, start: el.selectionStart, end: el.selectionEnd };
}

function restoreFocus(root, kept) {
  if (!kept) return;
  const el = [...root.querySelectorAll('[data-focus]')].find((x) => x.dataset.focus === kept.key);
  if (!el) return;
  el.focus();
  try {
    el.setSelectionRange(kept.start, kept.end);
  } catch {
    // not a text box
  }
}

export function renderSide(ctx) {
  const side = document.getElementById('side');
  const kept = keptFocus(side);
  side.replaceChildren(
    ...[renderCoach(ctx), renderWeek(ctx), renderGoals(ctx), renderHistory(ctx)].filter(Boolean));
  restoreFocus(side, kept);
}
```

- [ ] **Step 8: Wire it into `js/app.js`**

8a. The imports — replace:

```js
import { createStore, DATA_KEY } from './data.js';
```

with:

```js
import { createStore, DATA_KEY } from './data.js';
import { askGemini, geminiKeys } from './gemini.js';
```

and replace:

```js
import { openSettings } from './ui/settings.js';
```

with:

```js
import { openSettings } from './ui/settings.js';
import { checkinNow } from './ui/coach.js';
```

8b. The page state, the fake switch and `ctx.coach` — replace:

```js
const store = createStore({ storage: localStorage });
const ui = { entriesFor: null, amountFor: null, expandedGoals: new Set(), historyDay: null, editorDirty: false, closeEditor: null };
const sync = { state: 'off', at: null, error: null };
const ctx = {
  store,
  ui,
  render,
  openEditor: (opts) => openEditor(ctx, opts),
  openSettings: () => openSettings(ctx),
  syncNow: () => scheduler.now(),
  syncProblem: () => (sync.state === 'failing' ? sync.error : ''),
};
```

with:

```js
const store = createStore({ storage: localStorage });
const ui = {
  entriesFor: null, amountFor: null, expandedGoals: new Set(), historyDay: null, editorDirty: false, closeEditor: null,
  // The Coach panel's page-only state (js/ui/coach.js). Typed text lives here, not only in the
  // textareas, so a re-render never loses it.
  coach: {
    busy: '', error: '', answers: [], notNow: '', feedbackOpen: true,
    shapeOpen: false, shapeText: '', shapeBusy: false, shapeError: '',
    digestOpen: false, digestBusy: false, digestError: '', digestTried: false,
  },
};
const sync = { state: 'off', at: null, error: null };

// Canned Gemini for local testing: only on localhost, only with ?fakegemini (or =<mode>). In
// fake mode the real keys are never read, and dev/fake-gemini.js answers instead of Google.
const params = new URLSearchParams(location.search);
const FAKE = (['localhost', '127.0.0.1'].includes(location.hostname) && params.has('fakegemini'))
  ? (params.get('fakegemini') || 'ok') : null;

const ctx = {
  store,
  ui,
  render,
  openEditor: (opts) => openEditor(ctx, opts),
  openSettings: () => openSettings(ctx),
  syncNow: () => scheduler.now(),
  syncProblem: () => (sync.state === 'failing' ? sync.error : ''),
  coach: {
    fake: FAKE,
    // Every key to try, in order: the one in ⚙, then the Hebrew app's on this device.
    keys: () => (FAKE ? (FAKE === 'nokey' ? [] : ['fake-key']) : geminiKeys(store.settings(), localStorage)),
    async ask({ system, prompt }) {
      // The fake module is only ever loaded in fake mode; otherwise askGemini uses the real fetch.
      const fetch = FAKE ? (await import('../dev/fake-gemini.js')).fakeGeminiFetch(FAKE) : undefined;
      return askGemini({ keys: ctx.coach.keys(), system, prompt, fetch });
    },
  },
};
```

8c. Remember what the Coach panel last showed — replace:

```js
function render() {
  renderHeader();
  renderToday(ctx);
  renderSide(ctx);
}
```

with:

```js
// The check-in state the Coach panel last showed; the minute tick repaints when it changes.
let shownCheckin = null;

function render() {
  renderHeader();
  renderToday(ctx);
  renderSide(ctx);
  shownCheckin = checkinNow(ctx);
}
```

8d. A new day clears yesterday's check-in page state — replace:

```js
function checkRollover() {
  const day = store.today();
  if (day !== shownDay) {
    shownDay = day;
    ui.historyDay = null;
    render();
  }
}
```

with:

```js
function checkRollover() {
  const day = store.today();
  if (day !== shownDay) {
    shownDay = day;
    ui.historyDay = null;
    // Yesterday's check-in is over: its typed answers, "Not now" and last error no longer apply.
    Object.assign(ui.coach, { answers: [], notNow: '', error: '', feedbackOpen: true });
    render();
  }
}
```

8e. The minute tick — replace:

```js
setInterval(checkRollover, 60000);
```

with:

```js
// Once a minute: roll over to a new day, and repaint when the check-in state has moved on (the
// check-in hour arriving) — unless something is being typed in the column.
setInterval(() => {
  checkRollover();
  if (checkinNow(ctx) !== shownCheckin && !typing()) render();
}, 60000);
```

- [ ] **Step 9: Styles and the column's label**

Append to the end of `styles.css`:

```css

/* Coach panel */
.coach h2 .fake { font-weight: 400; letter-spacing: 0; text-transform: none; color: var(--carry); }
.coach p { margin: 0 0 .5rem; font-size: .9rem; }
.coach .error { min-height: 0; margin: .4rem 0 0; }
.checkin .question { display: flex; flex-direction: column; gap: .25rem; margin-bottom: .6rem; font-size: .9rem; }
.coach textarea {
  width: 100%; padding: .35rem .5rem; resize: vertical;
  background: var(--surface); border: 1px solid var(--line); border-radius: 6px;
}
.coach textarea:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); }
.checkin .buttons { align-items: center; margin-top: .25rem; }
.coach details {
  margin-bottom: .5rem; padding: .5rem .75rem; font-size: .9rem;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
}
.coach summary { cursor: pointer; font-weight: 500; }
.coach details p { margin: .5rem 0 0; }
.coach .feedback-text { white-space: pre-line; }
```

In `index.html`, replace:

```html
    <aside id="side" class="side" aria-label="Week, goals and history"></aside>
```

with:

```html
    <aside id="side" class="side" aria-label="Coach, week, goals and history"></aside>
```

- [ ] **Step 10: Run the tests and check the syntax**

Run: `npm test`
Expected: PASS — 174 tests.

Run: `node --check js/ui/coach.js && node --check js/ui/side.js && node --check js/app.js && node --check dev/fake-gemini.js`
Expected: no output.

- [ ] **Step 11: Check it in the browser** (controller; never type a real key anywhere)

Serve with `preview_start` `dashboard` (`.claude/launch.json` runs `python -m http.server 8080`).
Open `http://localhost:8080/dev/seed.html?replace` before each numbered group below. It resets the
document, which is what clears today's check-in. After the first load of the new code, reload
**twice**, because the offline cache serves the old `app.js` once. The heading reads **COACH** with
an orange `fake · <mode>` beside it in every fake mode.

Whether the panel shows the early line ("Evening check-in from 6pm · check in now") or the
**Start today's check-in** button depends on the clock: the early line before 18:00, the button from
18:00. Use whichever shows. The other one is checked in Task 8, which adds the check-in hour to ⚙.

1. **`http://localhost:8080/?fakegemini=nokey`** — the panel is the first one in the right column
   and reads exactly "The coach needs a Gemini key. Add one in ⚙, or save one in the Hebrew app on
   this device." There's no button and no link.
2. **Failures, one reseed each**, via the button or *check in now*. Each shows "Thinking…" for about
   1.6 s (two fake attempts), then the button or link again, with this red line under it:
   - `?fakegemini=quota` → "Gemini's free limit is used up for today — try tomorrow"
   - `?fakegemini=down` → "Gemini didn't answer — try again"
   - `?fakegemini=offline` → "Can't reach Gemini — check you're online and try again"
   - `?fakegemini=badkey` → "Gemini refused the key — check it in ⚙" (after about 0.8 s — a refused key isn't retried)
   - `?fakegemini=nonsense` → "Gemini's reply didn't make sense — try again" (after about 0.8 s)
   In each case `JSON.parse(localStorage.getItem('dash_data')).journal` is still `{}`, so nothing
   was written.
3. **`?fakegemini=slow`** — start the check-in. "Thinking…" stays for about 5 s. Meanwhile tick a
   task on the left and type in the add box — both work, and "Thinking…" stays. Then three
   questions appear, each over a two-row textarea, followed by **Send** and *Not now*.
4. **Still in that tab, reload with `?fakegemini`** (don't reseed):
   - The same three questions are back (they were saved). `journal['checkin:<today>']` has
     `questions` (3), `answers: []`, `feedback: ''` and `model: 'gemini-flash-lite-latest'`.
   - Type "Went well" in the first box. Tick a task on the left, which re-renders the column. The
     text is still in the first box.
   - *Not now* folds the panel to "Today's check-in is waiting · answer now". *answer now* brings
     the questions back, with "Went well" still in the first box.
   - Clear the first box, then press **Send** → "Answer at least one question first." Nothing is sent.
   - Type "Went well" again and reload with `?fakegemini=down`. The typed text is gone (answers live
     only in the page, as designed). Type "Went well" once more and press **Send** → "Thinking…",
     then the questions again with "Went well" still in the box and "Gemini didn't answer — try again" under them.
   - Reload with `?fakegemini`. Type "Went well" and press Ctrl+Enter in the box (the same as
     **Send**) → "Thinking…" → an open **Today's check-in** box holding the two-paragraph fake
     feedback and "A task for tomorrow waits at the top of the list." At the top of Today, a dimmed
     suggestion reads "Start with the carried-over task (fake)", suggested by Gemini. (The "for Sat"
     marker comes in Task 6.)
   - `journal['checkin:<today>']` now has `answers: ['Went well', '', '']`, the feedback, and a
     `tomorrowIds` holding the one id. `items[<that id>]` is a `task`, `suggested`, `source: 'gemini'`,
     dated tomorrow.
   - Collapse **Today's check-in**, then tick a task. It stays collapsed.
5. **`?fakegemini=nokey` straight after step 4 (no reseed)** — today's feedback still shows, because
   `done` doesn't need a key.
6. **Without `?fakegemini`** (`http://localhost:8080/`): the heading has no `fake ·` label. The
   network list (`read_network_requests`, filter `fake-gemini`) shows no request for
   `dev/fake-gemini.js`. **Don't click anything in the panel here**, in case this browser holds a
   real key on localhost.
7. Throughout: no console errors, apart from the Browser pane's refusal to register the service
   worker ("An unknown error occurred when fetching the script"). That one shows on every load
   there and isn't from this task. `read_network_requests` filtered on `generativelanguage` is empty
   (the fake never touches the network). At 375 px wide, the Coach panel is the first thing under the list.

- [ ] **Step 12: Commit**

```bash
git add js/ui/coach.js dev/fake-gemini.js tests/fake-gemini.test.js js/dates.js tests/dates.test.js js/app.js js/ui/side.js styles.css index.html
git commit -m "Add the Coach panel and the evening check-in" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
