# Task 7: Weekly digest

Part of [the Gemini coach plan](../2026-09-11-gemini-coach.md) — read its Global Constraints first.

**Files:**
- Modify: `js/ui/coach.js` (imports, `renderCoach` replaced, two functions appended), `js/app.js`
  (five exact edits), `styles.css` (a block appended)

**Interfaces:**
- Consumes: `digestOf`, `digestDue` (Task 3), `digestPrompt`, `parseDigest` (Task 4) from
  `js/coach.js`; `saveJournal` on the store (Task 1); `consult`, `blocker`, `link`, `renderCheckin`
  and the `ui.coach.digest*` fields from Task 5; `addDays`, `weekStart` from `js/dates.js`; the sync
  scheduler's `run` in `js/app.js`.
- Produces:
  - `writeDigest(ctx, { quiet = false } = {})` in `js/ui/coach.js`. It writes last week's digest
    (job D) and files it under last week's Monday.
  - The digest part of the Coach panel, under the check-in and its error line:
    - When last week's digest exists: a collapsed **Last week** `<details>`. Opened, it shows the
      summary, "Went well: a · b", "Slipped: c" (each line only when its list isn't empty) and
      "This week: <focus>". `ui.coach.digestOpen` remembers whether it's open across re-renders.
    - When there's no digest, a key is available and `digestDue` is set: a *Write last week's
      digest* link (it reads "Writing last week's digest…" while a request runs), with
      `ui.coach.digestError` under it.
    - Otherwise nothing: an empty last week, or no key.
  - `maybeWriteDigest()` in `js/app.js`: the background trigger, run after every sync pass.

**The trigger, exactly:**
- The scheduler's `run` becomes `async () => { await runSync(); maybeWriteDigest(); }`. It runs on
  open, on focus or visibility, when the network returns, 5 s after a local change, and on *Sync
  now*. Because it runs after the pull, a digest another device already wrote is merged in before
  deciding.
- `maybeWriteDigest` returns straight away if `ui.coach.digestTried` is set, if `ctx.coach.keys()` is
  empty, if `navigator.onLine === false`, or if `digestDue(store.doc(), store.today())` is null (a
  digest already exists for last week, or last week had no counted rows and no amounts). Otherwise
  it sets `digestTried` and calls `writeDigest(ctx, { quiet: true })`.
- Quiet means silent: a failure leaves no error line, only the *Write last week's digest* link.
- One attempt per week while the page stays open. `digestTried` is page state, so a reload tries
  again. It is also cleared when the logical day rolls into a new week, because the laptop keeps
  the page open for days and would otherwise never write Monday's digest. A day rollover inside
  the same week leaves it alone, so a failing digest costs at most one request per page load per
  week.
- Nothing is written until `parseDigest` has accepted the reply. A digest is 1 request.

- [ ] **Step 1: The digest in `js/ui/coach.js`**

1a. Replace the imports:

```js
import {
  checkinOf, checkinState, questionsPrompt, feedbackPrompt, parseQuestions, parseFeedback, shapePrompt, parseShape,
} from '../coach.js';
import { addDays, hourLabel } from '../dates.js';
```

with:

```js
import {
  checkinOf, checkinState, questionsPrompt, feedbackPrompt, parseQuestions, parseFeedback, shapePrompt, parseShape,
  digestOf, digestDue, digestPrompt, parseDigest,
} from '../coach.js';
import { addDays, weekStart, hourLabel } from '../dates.js';
```

1b. Replace `renderCoach`:

```js
export function renderCoach(ctx) {
  const c = ctx.ui.coach;
  return h('section', { class: 'panel coach' },
    h('h2', {}, 'Coach', ctx.coach.fake ? h('span', { class: 'fake' }, `fake · ${ctx.coach.fake}`) : null),
    renderCheckin(ctx),
    c.error ? h('p', { class: 'error', role: 'status' }, c.error) : null);
}
```

with:

```js
export function renderCoach(ctx) {
  const c = ctx.ui.coach;
  return h('section', { class: 'panel coach' },
    h('h2', {}, 'Coach', ctx.coach.fake ? h('span', { class: 'fake' }, `fake · ${ctx.coach.fake}`) : null),
    renderCheckin(ctx),
    c.error ? h('p', { class: 'error', role: 'status' }, c.error) : null,
    renderDigest(ctx));
}
```

1c. Append to the end of `js/ui/coach.js`:

```js

// ---- Last week's digest -----------------------------------------------------------------------

// Job D: last week's digest, filed under last week's Monday. Quiet (the background trigger in
// js/app.js) says nothing when there's no key or no network, and swallows a failure, leaving the
// "Write last week's digest" link.
export async function writeDigest(ctx, { quiet = false } = {}) {
  const { store, ui } = ctx;
  const c = ui.coach;
  if (c.digestBusy) return;
  if (quiet && blocker(ctx)) return;
  const monday = addDays(weekStart(store.today()), -7);
  c.digestError = '';
  c.digestBusy = true;
  ctx.render();
  try {
    const { reply, model } = await consult(ctx, digestPrompt(store.doc(), monday), parseDigest);
    store.saveJournal({ kind: 'digest', day: monday, ...reply, model });
  } catch (e) {
    if (!quiet) c.digestError = e.message;
  } finally {
    c.digestBusy = false;
    ctx.render();
  }
}

// The collapsed "Last week" line once the digest exists; before that, the link to write it (only
// with a key, and only for a week that had anything in it).
function renderDigest(ctx) {
  const { store, ui } = ctx;
  const c = ui.coach;
  const doc = store.doc();
  const today = store.today();
  const digest = digestOf(doc, addDays(weekStart(today), -7));
  if (digest) {
    const line = (label, text) => h('p', {}, h('strong', {}, label), text);
    const details = h('details', { class: 'digest', open: c.digestOpen },
      h('summary', {}, 'Last week'),
      h('p', { class: 'digest-summary' }, digest.summary),
      digest.wins?.length ? line('Went well: ', digest.wins.join(' · ')) : null,
      digest.slipped?.length ? line('Slipped: ', digest.slipped.join(' · ')) : null,
      digest.focus ? line('This week: ', digest.focus) : null);
    details.addEventListener('toggle', () => { c.digestOpen = details.open; });
    return details;
  }
  if (!ctx.coach.keys().length || !digestDue(doc, today)) return null;
  return h('div', { class: 'digest-write' },
    c.digestBusy
      ? h('p', { class: 'muted', role: 'status' }, "Writing last week's digest…")
      : h('p', {}, link("Write last week's digest", () => writeDigest(ctx))),
    c.digestError ? h('p', { class: 'error', role: 'status' }, c.digestError) : null);
}
```

- [ ] **Step 2: The background trigger in `js/app.js`**

2a. The imports — replace:

```js
import { longDate } from './dates.js';
import { dayCompletion } from './schedule.js';
```

with:

```js
import { longDate, weekStart } from './dates.js';
import { dayCompletion } from './schedule.js';
import { digestDue } from './coach.js';
```

and replace:

```js
import { checkinNow } from './ui/coach.js';
```

with:

```js
import { checkinNow, writeDigest } from './ui/coach.js';
```

2b. Run the digest check after every sync pass — replace:

```js
const scheduler = createSyncScheduler({ run: runSync, canRun });
```

with:

```js
// Last week's digest, written in the background once a new week has started and last week had
// anything in it (digestDue). At most one attempt per week while the page is open; a failure is
// silent and leaves the panel's "Write last week's digest" link.
function maybeWriteDigest() {
  if (ui.coach.digestTried) return;
  if (!ctx.coach.keys().length) return;
  if (navigator.onLine === false) return;
  if (!digestDue(store.doc(), store.today())) return;
  ui.coach.digestTried = true;
  writeDigest(ctx, { quiet: true });
}

// Each sync pass (on open, on focus, after a change) is followed by the digest check, so a digest
// another device already wrote has been pulled in before deciding to write one.
const scheduler = createSyncScheduler({
  run: async () => { await runSync(); maybeWriteDigest(); },
  canRun,
});
```

2c. A new week allows a new attempt — replace:

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

with:

```js
function checkRollover() {
  const day = store.today();
  if (day !== shownDay) {
    // A new week: last week's digest is now due, even if this page already tried one last week.
    if (weekStart(day) !== weekStart(shownDay)) {
      Object.assign(ui.coach, { digestTried: false, digestError: '', digestOpen: false });
    }
    shownDay = day;
    ui.historyDay = null;
    // Yesterday's check-in is over: its typed answers, "Not now" and last error no longer apply.
    Object.assign(ui.coach, { answers: [], notNow: '', error: '', feedbackOpen: true });
    render();
  }
}
```

- [ ] **Step 3: Styles**

Append to the end of `styles.css`:

```css

/* Last week's digest */
.coach .digest-summary { white-space: pre-line; }
.coach .digest strong { font-weight: 600; }
.coach .digest-write { margin-top: .5rem; }
```

- [ ] **Step 4: Run the tests and check the syntax**

Run: `npm test`
Expected: PASS — 176 tests (no new pure logic here: `digestDue`, `digestPrompt` and `parseDigest` are covered by Tasks 3–4, and the fake's digest reply by `tests/fake-gemini.test.js`).

Run: `node --check js/ui/coach.js && node --check js/app.js`
Expected: no output.

- [ ] **Step 5: Check it in the browser** (controller; never type a real key anywhere)

Serve with `preview_start` `dashboard` and reload twice after the new code. Every group starts with
a fresh `http://localhost:8080/dev/seed.html?replace`. The seed ticks habits on each of the last
20 days, so last week has counted rows and the digest is due. Sync is off locally, so the "sync
pass" on open is the no-op `runSync` followed by the digest check.

1. **`?fakegemini=slow`** — as the page opens, the Coach panel shows "Writing last week's
   digest…" under the check-in line for about 5 s, with no clicking. The rest of the page works
   meanwhile. Then it's replaced by a collapsed **Last week** line.
   - Open it: the fake summary, "**Went well:** Hebrew practice most days · Two applications
     sent", "**Slipped:** Gym only once", "**This week:** Start each day with the task you would
     rather avoid."
   - Tick a task on the left (a re-render): **Last week** stays open. Collapse it, tick again: it
     stays collapsed.
   - `JSON.parse(localStorage.getItem('dash_data')).journal` has `digest:<last Monday>` with `kind:
     'digest'`, `day` = last Monday, the summary, 2 wins, 1 slipped, the focus, and
     `model: 'gemini-flash-lite-latest'`. Note its `updated`.
2. **Reload with `?fakegemini`** (no reseed) — **Last week** shows at once, with no "Writing…".
   Click elsewhere and back into the window (a focus → another sync pass), or wait 5 s after
   ticking a task. The digest's `updated` hasn't changed, so no second digest was written.
3. **`?fakegemini=down`** (reseed first) — "Writing last week's digest…" for about 1.6 s on open,
   then the *Write last week's digest* link, with **no** error line (the background attempt is
   quiet). Click the link: "Writing last week's digest…", then "Gemini didn't answer — try again"
   in red under the link, which is still there. `journal` is still `{}`.
   - Click away from the window and back (focus). Nothing starts by itself — the page already
     tried this week.
4. **`?fakegemini=nonsense`** (reseed first) — the quiet attempt fails silently. Clicking the link
   shows "Gemini's reply didn't make sense — try again".
5. **`?fakegemini=nokey`** (reseed first) — no digest line at all: no link, no "Writing…".
6. **With a check-in as well** — reseed, open `?fakegemini`, let the digest land, then run today's
   check-in to its feedback. Both show: **Today's check-in** (open) above **Last week**
   (collapsed).
7. Throughout: no console errors, apart from the Browser pane's service-worker refusal ("An unknown
   error occurred when fetching the script"), which isn't from this task.

- [ ] **Step 6: Commit**

```bash
git add js/ui/coach.js js/app.js styles.css
git commit -m "Write last week's digest in the background and show it in the Coach panel" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
