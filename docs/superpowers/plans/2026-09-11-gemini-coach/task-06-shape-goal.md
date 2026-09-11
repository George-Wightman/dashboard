# Task 6: Shape a goal

Part of [the Gemini coach plan](../2026-09-11-gemini-coach.md) — read its Global Constraints first.

**Files:**
- Create: `tests/coach-proposals.test.js`
- Modify: `js/dates.js` (`forLabel` appended), `tests/dates.test.js` (import + one test),
  `js/coach.js` (`proposalLine` appended), `js/ui/coach.js` (import + two functions appended),
  `js/ui/side.js` (three exact edits), `js/ui/today.js` (two exact edits), `styles.css` (a block
  appended)

**Interfaces:**
- Consumes: `shapePrompt`, `parseShape`, `proposedItems`, `formatAmount` (already imported in
  `js/coach.js`) from Tasks 3–4; `addPlan`, `acceptGoalPlan`, `dismissGoalPlan` on the store (Task 1);
  `consult`, `link` and the `ui.coach.shape*` fields from Task 5; `milestonesOf` (`js/schedule.js`);
  `daysBetween`, `shortWeekday`, `shortDate` (`js/dates.js`); `SOURCE_NAMES` (`js/ui/today.js`).
- Produces:
  - `forLabel(day, today)` in `js/dates.js`: `'for Sat'` when `day` is 1–6 days after `today`,
    otherwise `'for 3 Oct'`.
  - `proposalLine(item)` in `js/coach.js` (pure): `'Habit: Stretch · Mon, Wed, Fri'`,
    `'Habit: Walk · 3 times a week'`, `'Habit: Read · every day'`, `'Weekly target: Running · 1.5h'`,
    `'Weekly target: Parkruns · 2 runs'`.
  - `renderShapeBox(ctx)` and `shapeGoal(ctx, text)` in `js/ui/coach.js`.
  - In the Goals panel: a *Shape with AI* link before *+ goal*, and the shaping box straight under
    the heading. A suggested goal's card previews the plan. ✓ calls `acceptGoalPlan`, and ✕ calls
    `dismissGoalPlan`.
  - On Today: a suggested task dated after today shows `for Sat` (or `for 3 Oct`) in its meta.

**How it behaves:**
- **Shape** with a blank box shows "Say what you want to achieve first." Otherwise the button reads
  "Shaping…" and is disabled, and the request runs in the background. On success the box closes and
  its text is cleared. On failure the box stays open with its text, and the error sits under it.
- Everything the reply proposes goes in with one `addPlan` commit, as suggestions: the goal (with
  `why`), its milestones, and its habits and targets (linked by `goalId`). The habits and targets
  show at the top of Today like any suggestion. They can be taken on one by one there, whether or
  not the goal has been accepted.
- ✓ on the card makes the goal and its still-suggested milestones live. The linked habits and
  targets stay as suggestions on Today. ✕ dismisses the goal, its still-suggested milestones and its
  still-suggested habits and targets. Anything already accepted is left alone (Task 1's store
  methods do this). A suggested goal from anywhere else (Claude, or the seeded one) uses the same two
  buttons. With no plan behind it, the card is just the title and "suggested by …", as before.
- The shaping textarea is marked `data-focus`, so a re-render while George is typing in it (a
  check-in landing, a sync) keeps his caret. Its text lives in `ui.coach.shapeText`.

- [ ] **Step 1: Write the failing tests**

In `tests/dates.test.js`, replace:

```js
  shortWeekday, shortDate, longDate, carryLabel, hourLabel,
} from '../js/dates.js';
```

with:

```js
  shortWeekday, shortDate, longDate, carryLabel, hourLabel, forLabel,
} from '../js/dates.js';
```

and append to the end of the file:

```js

test('forLabel: the weekday within six days, the date beyond', () => {
  assert.equal(forLabel('2026-09-12', '2026-09-11'), 'for Sat');
  assert.equal(forLabel('2026-09-17', '2026-09-11'), 'for Thu');
  assert.equal(forLabel('2026-09-18', '2026-09-11'), 'for 18 Sep');
  assert.equal(forLabel('2026-10-03', '2026-09-11'), 'for 3 Oct');
});
```

Create `tests/coach-proposals.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposalLine } from '../js/coach.js';

test('proposalLine: one line per habit or weekly target a plan proposes', () => {
  const habit = (repeat) => ({ type: 'habit', title: 'Stretch', repeat });
  assert.equal(proposalLine(habit({ kind: 'weekdays', days: [1, 3, 5] })), 'Habit: Stretch · Mon, Wed, Fri');
  assert.equal(proposalLine(habit({ kind: 'perWeek', n: 3 })), 'Habit: Stretch · 3 times a week');
  assert.equal(proposalLine(habit({ kind: 'perWeek', n: 1 })), 'Habit: Stretch · once a week');
  assert.equal(proposalLine(habit({ kind: 'daily' })), 'Habit: Stretch · every day');
  assert.equal(proposalLine(habit(undefined)), 'Habit: Stretch · every day');
  assert.equal(proposalLine(habit({ kind: 'weekly', day: 7 })), 'Habit: Stretch · every Sun');
  assert.equal(proposalLine(habit({ kind: 'monthly', date: 1 })), 'Habit: Stretch · on day 1 of the month');
  assert.equal(proposalLine({ type: 'quota', title: 'Running', target: 90, unit: 'minutes', unitLabel: '' }), 'Weekly target: Running · 1.5h');
  assert.equal(proposalLine({ type: 'quota', title: 'Running', target: 45, unit: 'minutes' }), 'Weekly target: Running · 45m');
  assert.equal(proposalLine({ type: 'quota', title: 'Parkruns', target: 2, unit: 'count', unitLabel: 'runs' }), 'Weekly target: Parkruns · 2 runs');
  assert.equal(proposalLine({ type: 'quota', title: 'Apps', target: 5, unit: 'count', unitLabel: '' }), 'Weekly target: Apps · 5');
  assert.equal(proposalLine({ type: 'task', title: 'Email Sarah' }), 'Email Sarah');
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm test`
Expected: FAIL —
- `tests/dates.test.js` doesn't load: `SyntaxError: The requested module '../js/dates.js' does not provide an export named 'forLabel'`
- `tests/coach-proposals.test.js` doesn't load: `SyntaxError: The requested module '../js/coach.js' does not provide an export named 'proposalLine'`

- [ ] **Step 3: Add `forLabel` and `proposalLine`**

Append to the end of `js/dates.js`:

```js

// The marker on a suggestion for a later day: the weekday within six days, else the date.
export function forLabel(day, today) {
  const n = daysBetween(today, day);
  return n >= 1 && n <= 6 ? `for ${shortWeekday(day)}` : `for ${shortDate(day)}`;
}
```

Append to the end of `js/coach.js` (after `parseDigest`):

```js

// ---- The suggested-goal card -------------------------------------------------------------------

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function repeatText(repeat) {
  switch (repeat?.kind) {
    case 'weekdays': return (repeat.days ?? []).map((d) => DAY_NAMES[d - 1]).filter(Boolean).join(', ');
    case 'perWeek': return repeat.n === 1 ? 'once a week' : `${repeat.n} times a week`;
    case 'weekly': return `every ${DAY_NAMES[repeat.day - 1] ?? 'week'}`;
    case 'monthly': return `on day ${repeat.date} of the month`;
    default: return 'every day';
  }
}

// One line for a habit or weekly target a plan proposes, as the suggested-goal card lists it:
// 'Habit: Stretch · Mon, Wed, Fri' · 'Weekly target: Running · 1.5h' · 'Weekly target: Parkruns · 2 runs'.
export function proposalLine(item) {
  if (item.type === 'habit') return `Habit: ${item.title} · ${repeatText(item.repeat)}`;
  if (item.type === 'quota') {
    const unit = item.unit ?? 'count';
    const label = unit === 'count' && item.unitLabel ? ` ${item.unitLabel}` : '';
    return `Weekly target: ${item.title} · ${formatAmount(Number(item.target) || 0, unit)}${label}`;
  }
  return item.title;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — 176 tests (174 before, plus 1 in `dates.test.js` and 1 in `coach-proposals.test.js`).

- [ ] **Step 5: The shaping box in `js/ui/coach.js`**

5a. Replace the import:

```js
import { checkinOf, checkinState, questionsPrompt, feedbackPrompt, parseQuestions, parseFeedback } from '../coach.js';
```

with:

```js
import {
  checkinOf, checkinState, questionsPrompt, feedbackPrompt, parseQuestions, parseFeedback, shapePrompt, parseShape,
} from '../coach.js';
```

5b. Append to the end of `js/ui/coach.js`:

```js

// ---- Shape a goal -----------------------------------------------------------------------------

// Job C: a big goal in plain words becomes a suggested goal with milestones, habits and weekly
// targets — all suggestions, written in one commit, only once the reply has passed its parser.
export async function shapeGoal(ctx, text) {
  const { store, ui } = ctx;
  const c = ui.coach;
  if (c.shapeBusy) return;
  if (!String(text ?? '').trim()) {
    c.shapeError = 'Say what you want to achieve first.';
    ctx.render();
    return;
  }
  const today = store.today();
  c.shapeError = '';
  c.shapeBusy = true;
  ctx.render();
  try {
    const { reply: plan } = await consult(ctx, shapePrompt(store.doc(), today, text), (data) => parseShape(data, today));
    store.addPlan({
      goal: { title: plan.title, targetDate: plan.targetDate, why: plan.why },
      milestones: plan.milestones,
      habits: plan.habits,
      targets: plan.targets,
    });
    c.shapeOpen = false;
    c.shapeText = '';
  } catch (e) {
    c.shapeError = e.message;
  } finally {
    c.shapeBusy = false;
    ctx.render();
  }
}

// The inline box under the Goals heading, or null while it's closed.
export function renderShapeBox(ctx) {
  const c = ctx.ui.coach;
  if (!c.shapeOpen) return null;
  const shape = () => shapeGoal(ctx, c.shapeText);
  const box = h('textarea', {
    rows: 3, placeholder: 'What do you want to achieve?', 'aria-label': 'What do you want to achieve?',
    'data-focus': 'coach-shape',
  });
  box.value = c.shapeText;
  box.addEventListener('input', () => { c.shapeText = box.value; });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); shape(); }
  });
  return h('form', { class: 'shape', onsubmit: (e) => { e.preventDefault(); shape(); } },
    box,
    h('div', { class: 'buttons' },
      h('button', { class: 'btn primary', type: 'submit', disabled: c.shapeBusy }, c.shapeBusy ? 'Shaping…' : 'Shape'),
      link('Cancel', () => { c.shapeOpen = false; c.shapeError = ''; ctx.render(); })),
    c.shapeError ? h('p', { class: 'error', role: 'status' }, c.shapeError) : null);
}
```

- [ ] **Step 6: The Goals panel in `js/ui/side.js`**

6a. The imports — replace:

```js
import { renderCoach } from './coach.js'; // js/ui/coach.js, the panel (js/coach.js is the pure half)
```

with:

```js
import { renderCoach, renderShapeBox } from './coach.js'; // js/ui/coach.js, the panel (js/coach.js is the pure half)
import { proposedItems, proposalLine } from '../coach.js';
```

6b. The suggested-goal card — replace:

```js
function renderGoal(goal, ctx) {
  const { store, ui } = ctx;
  if (goal.status === 'suggested') {
    return h('div', { class: 'goal suggested' },
      h('div', { class: 'goal-head' },
        h('span', {}, goal.title),
        h('span', {},
          h('button', { class: 'accept', type: 'button', 'aria-label': `Accept goal ${goal.title}`, onclick: () => store.acceptSuggestion('goals', goal.id) }, '✓'),
          ' ',
          h('button', { class: 'dismiss', type: 'button', 'aria-label': `Dismiss goal ${goal.title}`, onclick: () => store.dismissSuggestion('goals', goal.id) }, '✕'))),
      h('div', { class: 'muted', style: 'font-size:.8rem' }, `suggested by ${SOURCE_NAMES[goal.source] ?? goal.source}`));
  }
```

with:

```js
// A suggested goal, previewing the plan behind it: why, target date, the proposed milestones, and
// the habits and weekly targets that wait on Today. ✓ takes on the goal and its milestones; ✕
// turns down the goal, its milestones and whatever of its habits and targets is still suggested.
function renderSuggestedGoal(goal, ctx) {
  const { store } = ctx;
  const doc = store.doc();
  const milestones = milestonesOf(doc, goal.id).filter((m) => m.status === 'suggested');
  const proposed = proposedItems(doc, goal.id);
  const preview = !!goal.why || !!goal.targetDate || milestones.length > 0 || proposed.length > 0;
  return h('div', { class: preview ? 'goal suggested plan' : 'goal suggested' },
    h('div', { class: 'goal-head' },
      h('span', {}, goal.title),
      h('span', {},
        h('button', {
          class: 'accept', type: 'button', title: 'Take on this goal and its milestones',
          'aria-label': `Accept goal ${goal.title}`, onclick: () => store.acceptGoalPlan(goal.id),
        }, '✓'),
        ' ',
        h('button', {
          class: 'dismiss', type: 'button', title: 'Not for me',
          'aria-label': `Dismiss goal ${goal.title}`, onclick: () => store.dismissGoalPlan(goal.id),
        }, '✕'))),
    h('div', { class: 'muted', style: 'font-size:.8rem' }, `suggested by ${SOURCE_NAMES[goal.source] ?? goal.source}`),
    goal.why ? h('p', { class: 'why' }, goal.why) : null,
    goal.targetDate ? h('div', { class: 'muted' }, `Target: ${shortDate(goal.targetDate)}`) : null,
    milestones.length ? h('ol', { class: 'proposal' }, milestones.map((m) => h('li', {}, m.title))) : null,
    proposed.length ? h('ul', { class: 'proposal' }, proposed.map((i) => h('li', {}, proposalLine(i)))) : null,
    proposed.length ? h('div', { class: 'muted plan-note' }, 'Habits and targets also wait at the top of Today.') : null);
}

function renderGoal(goal, ctx) {
  const { store, ui } = ctx;
  if (goal.status === 'suggested') return renderSuggestedGoal(goal, ctx);
```

6c. The heading and the shaping box — replace:

```js
function renderGoals(ctx) {
  const doc = ctx.store.doc();
  const goals = values(doc.goals)
    .filter((g) => g.status === 'active' || g.status === 'suggested')
    .sort((a, b) => (a.status === b.status ? byOrder(a, b) : a.status === 'suggested' ? -1 : 1));
  return h('section', { class: 'panel' },
    h('h2', {}, 'Goals', h('button', { class: 'link', type: 'button', onclick: () => ctx.openEditor({ map: 'goals' }) }, '+ goal')),
    goals.length ? goals.map((g) => renderGoal(g, ctx)) : h('p', { class: 'muted' }, 'No goals yet.'));
}
```

with:

```js
function renderGoals(ctx) {
  const { store, ui } = ctx;
  const doc = store.doc();
  const goals = values(doc.goals)
    .filter((g) => g.status === 'active' || g.status === 'suggested')
    .sort((a, b) => (a.status === b.status ? byOrder(a, b) : a.status === 'suggested' ? -1 : 1));
  const toggleShape = () => {
    ui.coach.shapeOpen = !ui.coach.shapeOpen;
    ctx.render();
    if (ui.coach.shapeOpen) document.querySelector('#side [data-focus="coach-shape"]')?.focus();
  };
  return h('section', { class: 'panel' },
    h('h2', {}, 'Goals', h('span', { class: 'panel-links' },
      h('button', { class: 'link', type: 'button', 'aria-expanded': String(ui.coach.shapeOpen), onclick: toggleShape }, 'Shape with AI'),
      h('button', { class: 'link', type: 'button', onclick: () => ctx.openEditor({ map: 'goals' }) }, '+ goal'))),
    renderShapeBox(ctx),
    goals.length ? goals.map((g) => renderGoal(g, ctx)) : h('p', { class: 'muted' }, 'No goals yet.'));
}
```

- [ ] **Step 7: "for Sat" in `js/ui/today.js`**

7a. Replace:

```js
import { carryLabel, addDays, weekStart, shortWeekday } from '../dates.js';
```

with:

```js
import { carryLabel, addDays, weekStart, shortWeekday, forLabel } from '../dates.js';
```

7b. Replace:

```js
function renderSuggestion(row, ctx) {
  const { store } = ctx;
  const { item } = row;
  return h('li', { class: 'row suggested', 'data-id': item.id },
    h('button', { class: 'accept', type: 'button', title: 'Add it', 'aria-label': `Accept ${item.title}`,
      onclick: () => store.acceptSuggestion('items', item.id) }, '✓'),
    h('span', { class: 'title' }, item.title),
    h('span', { class: 'meta' }, h('span', { class: 'by' }, `suggested by ${SOURCE_NAMES[item.source] ?? item.source}`)),
    h('button', { class: 'dismiss', type: 'button', title: 'Not for me', 'aria-label': `Dismiss ${item.title}`,
      onclick: () => store.dismissSuggestion('items', item.id) }, '✕'));
}
```

with:

```js
// Every suggestion shows at the top of Today, whatever its date; one for a later day (tomorrow's
// tasks from the check-in) says which day it's for.
function renderSuggestion(row, ctx) {
  const { store } = ctx;
  const { item } = row;
  const today = store.today();
  return h('li', { class: 'row suggested', 'data-id': item.id },
    h('button', { class: 'accept', type: 'button', title: 'Add it', 'aria-label': `Accept ${item.title}`,
      onclick: () => store.acceptSuggestion('items', item.id) }, '✓'),
    h('span', { class: 'title' }, item.title),
    h('span', { class: 'meta' },
      item.type === 'task' && item.date > today ? h('span', { class: 'for' }, forLabel(item.date, today)) : null,
      h('span', { class: 'by' }, `suggested by ${SOURCE_NAMES[item.source] ?? item.source}`)),
    h('button', { class: 'dismiss', type: 'button', title: 'Not for me', 'aria-label': `Dismiss ${item.title}`,
      onclick: () => store.dismissSuggestion('items', item.id) }, '✕'));
}
```

- [ ] **Step 8: Styles**

Append to the end of `styles.css`:

```css

/* Shape with AI, and the suggested goal it makes */
.panel-links { display: flex; gap: .75rem; }
.shape { margin-bottom: .75rem; }
.shape textarea {
  width: 100%; padding: .35rem .5rem; resize: vertical;
  background: var(--surface); border: 1px solid var(--line); border-radius: 6px;
}
.shape textarea:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); }
.shape .buttons { align-items: center; margin-top: .4rem; }
.shape .error { min-height: 0; margin: .4rem 0 0; }
.goal.suggested.plan { opacity: .85; }
.goal .why { margin: .35rem 0 0; font-size: .85rem; }
.proposal { margin: .35rem 0 0; padding-left: 1.2rem; font-size: .85rem; }
.proposal li { padding: .05rem 0; }
.goal .plan-note { margin-top: .35rem; font-size: .8rem; }
.row .for { color: var(--accent); font-weight: 500; }
```

- [ ] **Step 9: Run the tests and check the syntax**

Run: `npm test`
Expected: PASS — 176 tests.

Run: `node --check js/ui/coach.js && node --check js/ui/side.js && node --check js/ui/today.js`
Expected: no output.

- [ ] **Step 10: Check it in the browser** (controller; never type a real key anywhere)

Serve with `preview_start` `dashboard`, reload twice after the new code, and open
`http://localhost:8080/dev/seed.html?replace` first.

1. **`http://localhost:8080/?fakegemini`**
   - The Goals heading reads *Shape with AI* then *+ goal*. The seeded Gemini goal, "Hold a
     10-minute conversation in Hebrew", still shows as a plain dimmed card (title, ✓ / ✕,
     "suggested by Gemini"). It has nothing to preview.
   - *Shape with AI* opens a box under the heading, with the caret already in the textarea (placeholder
     "What do you want to achieve?"). **Shape** with the box empty → "Say what you want to achieve first."
   - Type "run a 10k by Christmas" and press **Shape**. The button reads "Shaping…" and is disabled.
     About a second later the box closes and a dashed card appears at the top of Goals:
     "Run a 10k by Christmas" with ✓ / ✕, "suggested by Gemini", "A fake plan: small weekly steps
     you can actually hit.", "Target: <the date 8 weeks from today, e.g. 6 Nov>", four numbered
     milestones (Write down what done looks like · Take the first small step · Review how week one
     went · Reach the halfway point), then "Habit: Ten minutes towards it · Mon, Wed, Fri",
     "Weekly target: Time on it · 1.5h", and "Habits and targets also wait at the top of Today."
   - The top of Today has two new dimmed suggestions, "Ten minutes towards it" and "Time on it",
     both suggested by Gemini, with no "for" marker.
   - Open the box again, type "learn to juggle" and click *Cancel*. The box closes. *Shape with
     AI* opens it again with "learn to juggle" still there.
   - ✓ on the "Run a 10k" card: it becomes an ordinary goal at 0%, listed after "Land an analyst
     role". Expanded, it lists the four milestones as live checkboxes. "Ten minutes towards it" and
     "Time on it" still wait at the top of Today. ✓ "Time on it" there: it becomes a weekly target
     row, and the goal's expanded body says "Linked: Time on it".
   - Shape "learn to juggle" now. A second card appears, and a second "Ten minutes towards it" /
     "Time on it" pair joins the top of Today (the fake proposes the same two every time). ✕ the
     juggling card: the card goes, and so does that second pair. The top of Today is back to the
     seeded "Read one policy brief a day this week" and the 10k plan's "Ten minutes towards it".
     The accepted "Time on it" row is untouched.
   - ✓ on the seeded Hebrew goal: it becomes an ordinary goal.
2. **"for Sat"** — still with `?fakegemini`, run today's check-in (*check in now* or the button),
   answer the first question and press **Send**. The new suggestion "Start with the carried-over
   task (fake)" at the top of Today reads "for <tomorrow's weekday, e.g. Sat>" before "suggested by
   Gemini". The seeded suggestion "Read one policy brief a day this week" (dated today) has no
   marker.
3. **Focus survives a re-render** — reseed, open `?fakegemini=slow`, start the check-in and wait
   about 5 s for the questions. Open *Shape with AI*, type "write a novel" and press **Shape**
   ("Shaping…"). Straight away, click into the first answer box and keep typing. When the plan lands,
   about 5 s later, the column re-renders: the caret is still in the first answer box, the text is
   intact, and typing carries on without clicking again.
4. **`?fakegemini=quota`** — shape "run a 10k". "Shaping…", then "Gemini's free limit is used up
   for today — try tomorrow" under the box. The box stays open with "run a 10k" in it, and no card
   appears.
5. **`?fakegemini=nokey`** — *Shape with AI*, type anything, **Shape** → the no-key line under the
   box, straight away.
6. Throughout: no console errors, apart from the Browser pane's service-worker refusal ("An unknown
   error occurred when fetching the script"), which isn't from this task. At 375 px, *Shape with
   AI* and *+ goal* both fit in the Goals heading.

- [ ] **Step 11: Commit**

```bash
git add js/dates.js tests/dates.test.js js/coach.js tests/coach-proposals.test.js js/ui/coach.js js/ui/side.js js/ui/today.js styles.css
git commit -m "Shape a goal with Gemini, preview the plan, mark suggestions for later days" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
