# Task 4: Prompts and reply parsers

Part of [the Gemini coach plan](../2026-09-11-gemini-coach.md) — read its Global Constraints first.

**Files:**
- Modify: `js/coach.js` (one import line added; a block appended to the end)
- Test: `tests/coach-prompts.test.js`

**Interfaces:**
- Consumes: from `js/coach.js` itself (Task 3): `coachContext`, `weekStats`, `clip`, and the private
  helpers `values`, `byOrder`, `answersOf`, `section`, `targetLine` and the caps `ANSWER_CAP`,
  `ROW_CAP`, `TARGET_CAP`, `GOAL_CAP`, plus the date/parse imports already there (`addDays`,
  `longDate`, `shortWeekday`, `formatAmount`). From `js/gemini.js` (Task 2): `GeminiError` (and
  `MESSAGES` in the test).
- Produces:
  - `SYSTEM` — the system instruction, verbatim from the design.
  - `JOBS` — `{ questions, feedback, shape, digest }`, the four job texts, verbatim from the design.
    `dev/fake-gemini.js` (Task 5) spots the job by finding one of these in the prompt.
  - Prompt builders, each returning `{ system: SYSTEM, prompt }`. The layouts:
    - `questionsPrompt(doc, today)` — the context, a blank line, `JOBS.questions`.
    - `feedbackPrompt(doc, today, questions, answers)` — the context; a blank line;
      `Today's check-in:`; `Q: …` / `A: …` lines (a blank answer is `(no answer)`; answers clipped to
      1000); a blank line; `JOBS.feedback`.
    - `shapePrompt(doc, today, text)` — the context; a blank line; `Today's date: YYYY-MM-DD`;
      `Already tracked: <every active or suggested goal title, then item title, joined by '; '>`
      (at most 80, or `nothing yet`); the days-and-minutes line; `George wrote: <text, one line,
      ≤ 1000>`; a blank line; `JOBS.shape`.
    - `digestPrompt(doc, monday)` — `Week: Monday 31 August to Sunday 6 September 2026`; `Days: …`;
      `Habits:` (`Title: done of scheduled`); `Weekly targets:`; `Tasks: d of t done`; `Goals:`
      (`Title — pct% (d of t milestones)`, or for a numeric goal
      `(done of total, week this week)`); `Check-ins:` (that week's only, oldest first,
      `Tue: answers: a / b — feedback: …`); a blank line; `JOBS.digest`. Empty sections read `none`.
  - Parsers — `parseQuestions(data)`, `parseFeedback(data)`, `parseShape(data, today)`,
    `parseDigest(data)`. Each returns a clean object in the shape the plan's Shared interfaces give,
    or throws `new GeminiError('nonsense')` ("Gemini's reply didn't make sense — try again"). The rules:
    - Strings are trimmed. One-line fields have their whitespace collapsed. Feedback and summary keep
      their paragraph breaks.
    - Caps: titles 80 (goal, milestones, habits, targets, tomorrow's tasks, wins, slipped),
      questions 300, feedback 900, summary 1200, `why` 300, `focus` 300, `unitLabel` 40.
    - Lists are cut to: questions 3, tomorrow 2, milestones 6, habits 2, targets 2, wins 3,
      slipped 3. Blank or non-string entries are dropped before counting.
    - Unknown fields are dropped: every parser builds a new object.
    - A repeat that isn't `daily`, `weekdays` (with at least one day in 1–7) or `perWeek` (numeric
      `n`, clamped to 1–7) becomes `{ kind: 'daily' }`.
    - `targetDate` is kept only if it is a real `YYYY-MM-DD` on or after `today`; otherwise `null`.
    - A target needs a title, a unit of `count` or `minutes` (missing means `count`), and a positive
      number (a numeric string is accepted). Minutes are rounded to whole minutes, and one that rounds
      to 0 is dropped. `unitLabel` is kept only for `count`.
    - Required, or the parser throws: at least one question; non-blank feedback; a goal title;
      a non-blank summary. A reply that isn't a plain object also throws.

- [ ] **Step 1: Write the failing test**

`tests/coach-prompts.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SYSTEM, JOBS, coachContext, questionsPrompt, feedbackPrompt, shapePrompt, digestPrompt,
  parseQuestions, parseFeedback, parseShape, parseDigest,
} from '../js/coach.js';
import { GeminiError, MESSAGES } from '../js/gemini.js';
import { fixture, done, amount } from './helpers.js';

const TODAY = '2026-09-11';

function small() {
  return fixture({
    items: [
      { id: 'heb', type: 'habit', title: 'Hebrew practice', area: 'Hebrew', repeat: { kind: 'daily' }, order: 1 },
      { id: 'sarah', type: 'task', title: 'Email Sarah', date: TODAY, order: 2 },
      { id: 'idea', type: 'task', title: 'Idea', date: TODAY, status: 'suggested', source: 'gemini', order: 3 },
      { id: 'old', type: 'task', title: 'Old thing', date: '2026-09-02', status: 'archived', archivedOn: '2026-09-03', order: 4 },
    ],
    goals: [
      { id: 'role', title: 'Land an analyst role', order: 1 },
      { id: 'nope', title: 'Turned down', status: 'dismissed', order: 2 },
    ],
  });
}

const isNonsense = (e) => e instanceof GeminiError && e.code === 'nonsense' && e.message === MESSAGES.nonsense;

// ---- prompts -----------------------------------------------------------------------------------

test('the system instruction and job texts are the agreed ones', () => {
  assert.equal(SYSTEM, "You are George's coach inside his personal daily dashboard. Be direct, warm and specific, in British English. Refer to the actual items, numbers and words in the data you are given; never give generic advice or motivational filler. No emojis. Stay within the length limits. Reply with JSON only, in exactly the shape asked for.");
  assert.ok(JOBS.questions.startsWith('Ask George 2 or 3 short questions about today'));
  assert.ok(JOBS.questions.endsWith('Shape: {"questions": ["…", "…"]}'));
  assert.ok(JOBS.feedback.startsWith('Reply with feedback of at most 90 words.'));
  assert.ok(JOBS.shape.startsWith('Turn this into a plan George can start this week.'));
  assert.ok(JOBS.shape.endsWith('"why": "one sentence"}'));
  assert.ok(JOBS.digest.startsWith("Write last week's digest, for George and for Claude"));
});

test('job A: the context, then the questions job', () => {
  const doc = small();
  assert.deepEqual(questionsPrompt(doc, TODAY), { system: SYSTEM, prompt: `${coachContext(doc, TODAY)}\n\n${JOBS.questions}` });
});

test('job B: the context, his questions and answers, then the feedback job', () => {
  const doc = small();
  const { system, prompt } = feedbackPrompt(doc, TODAY, ['How did the CV go?', 'What comes first tomorrow?'], ['Finished it', '  ']);
  assert.equal(system, SYSTEM);
  assert.equal(prompt, [
    coachContext(doc, TODAY),
    '',
    "Today's check-in:",
    'Q: How did the CV go?',
    'A: Finished it',
    'Q: What comes first tomorrow?',
    'A: (no answer)',
    '',
    JOBS.feedback,
  ].join('\n'));
});

test('job C: the context, the date, what he already tracks, his words, then the shaping job', () => {
  const doc = small();
  const { system, prompt } = shapePrompt(doc, TODAY, '  I want to run a 10k\nby Christmas  ');
  assert.equal(system, SYSTEM);
  assert.equal(prompt, [
    coachContext(doc, TODAY),
    '',
    "Today's date: 2026-09-11",
    'Already tracked: Land an analyst role; Hebrew practice; Email Sarah; Idea',
    'Days of the week are numbered 1 (Monday) to 7 (Sunday). Time targets are in minutes.',
    'George wrote: I want to run a 10k by Christmas',
    '',
    JOBS.shape,
  ].join('\n'));
  assert.match(shapePrompt(fixture(), TODAY, 'x').prompt, /Already tracked: nothing yet/);
});

test("job D: the week's numbers and that week's check-ins, then the digest job", () => {
  const since = { created: '2026-08-25' };
  const doc = fixture({
    items: [
      { id: 'heb', type: 'habit', title: 'Hebrew', repeat: { kind: 'daily' }, order: 1, ...since },
      { id: 'apps', type: 'quota', title: 'Apps', target: 5, unit: 'count', unitLabel: '', order: 2, ...since },
      { id: 'cv', type: 'task', title: 'CV', date: '2026-09-01', order: 3, ...since },
    ],
    logs: [
      done('heb', '2026-08-31'), done('heb', '2026-09-01'), done('cv', '2026-09-01'),
      amount('a1', 'apps', '2026-09-02', 3),
      { id: 'g1', itemId: null, goalId: 'sav', kind: 'amount', amount: 200, day: '2026-09-02' },
      { id: 'g0', itemId: null, goalId: 'sav', kind: 'amount', amount: 100, day: '2026-08-20' },
    ],
    goals: [
      { id: 'job', title: 'Job', target: null, unit: 'count', order: 1 },
      { id: 'sav', title: 'Savings', target: 1000, unit: 'count', order: 2 },
    ],
    milestones: [
      { id: 'm1', goalId: 'job', title: 'A', done: true, order: 1 },
      { id: 'm2', goalId: 'job', title: 'B', done: false, order: 2 },
    ],
    journal: [
      { id: 'checkin:2026-09-01', kind: 'checkin', day: '2026-09-01', questions: ['Q1', 'Q2'], answers: ['Sent it', ''], feedback: 'Nice work.', tomorrowIds: [] },
      { id: 'checkin:2026-09-08', kind: 'checkin', day: '2026-09-08', questions: ['Q'], answers: ['Next week'], feedback: 'Later.', tomorrowIds: [] },
    ],
  });
  const { system, prompt } = digestPrompt(doc, '2026-08-31');
  assert.equal(system, SYSTEM);
  assert.equal(prompt, [
    'Week: Monday 31 August to Sunday 6 September 2026',
    'Days: Mon 1/1 · Tue 2/2 · Wed 0/1 · Thu 0/1 · Fri 0/1 · Sat 0/1 · Sun 0/1',
    'Habits:',
    'Hebrew: 2 of 7',
    'Weekly targets:',
    'Apps: 3 of 5',
    'Tasks: 1 of 1 done',
    'Goals:',
    'Job — 50% (1 of 2 milestones)',
    'Savings — 30% (300 of 1000, 200 this week)',
    'Check-ins:',
    'Tue: answers: Sent it — feedback: Nice work.',
    '',
    JOBS.digest,
  ].join('\n'));
});

// ---- parsers -----------------------------------------------------------------------------------

test('parseQuestions trims, collapses, caps at 3, and drops what is not a question', () => {
  assert.deepEqual(
    parseQuestions({ questions: ['  How did the CV go? ', 'What first\n tomorrow?', 'Third?', 'Fourth?'], extra: 1 }),
    { questions: ['How did the CV go?', 'What first tomorrow?', 'Third?'] },
  );
  assert.deepEqual(parseQuestions({ questions: [1, '', null, 'Real?'] }), { questions: ['Real?'] });
  assert.equal(parseQuestions({ questions: ['q'.repeat(400)] }).questions[0].length, 300);
  for (const bad of [null, [], 'text', {}, { questions: [] }, { questions: 'Why?' }, { questions: ['  '] }]) {
    assert.throws(() => parseQuestions(bad), isNonsense, JSON.stringify(bad));
  }
});

test('parseFeedback caps the feedback at 900 and tomorrow at 2 tasks of 80 characters', () => {
  assert.deepEqual(
    parseFeedback({
      feedback: '  Good.\n\nStart earlier.  ',
      tomorrow: [{ title: '  Email   Sarah ', when: 'am' }, { title: 'y'.repeat(100) }, { title: 'Third' }],
      mood: 'fine',
    }),
    { feedback: 'Good.\n\nStart earlier.', tomorrow: [{ title: 'Email Sarah' }, { title: 'y'.repeat(80) }] },
  );
  assert.equal(parseFeedback({ feedback: 'x'.repeat(1000) }).feedback.length, 900);
  assert.deepEqual(parseFeedback({ feedback: 'Fine.' }).tomorrow, []);
  assert.deepEqual(parseFeedback({ feedback: 'Fine.', tomorrow: ['Plain string', { title: '' }, 7] }).tomorrow, [{ title: 'Plain string' }]);
  for (const bad of [null, [], { feedback: '' }, { feedback: '   ' }, { feedback: 3 }, { tomorrow: [] }]) {
    assert.throws(() => parseFeedback(bad), isNonsense, JSON.stringify(bad));
  }
});

test('parseShape cleans a full plan and drops what it did not ask for', () => {
  const out = parseShape({
    title: '  Run a 10k ', targetDate: '2026-12-20',
    milestones: ['Run 3k', 'Run 5k', 'Run 7k', 'Run 8k', 'Run 9k', 'Run 10k', 'One too many'],
    habits: [
      { title: 'Stretch', repeat: { kind: 'weekdays', days: [5, 1, 3, 3, 9] }, colour: 'red' },
      { title: 'Walk', repeat: { kind: 'perWeek', n: 3 } },
      { title: 'Third habit', repeat: { kind: 'daily' } },
    ],
    targets: [
      { title: 'Running', target: 90.4, unit: 'minutes', unitLabel: 'ignored for time' },
      { title: 'Parkruns', target: '2', unit: 'count', unitLabel: 'runs' },
      { title: 'Third target', target: 1, unit: 'count' },
    ],
    why: '  Small steps first. ', extra: true,
  }, TODAY);
  assert.deepEqual(out, {
    title: 'Run a 10k',
    targetDate: '2026-12-20',
    milestones: ['Run 3k', 'Run 5k', 'Run 7k', 'Run 8k', 'Run 9k', 'Run 10k'],
    habits: [
      { title: 'Stretch', repeat: { kind: 'weekdays', days: [1, 3, 5] } },
      { title: 'Walk', repeat: { kind: 'perWeek', n: 3 } },
    ],
    targets: [
      { title: 'Running', target: 90, unit: 'minutes', unitLabel: '' },
      { title: 'Parkruns', target: 2, unit: 'count', unitLabel: 'runs' },
    ],
    why: 'Small steps first.',
  });
});

test('parseShape: a repeat that is not daily, weekdays or perWeek becomes daily', () => {
  const repeatOf = (repeat) => parseShape({ title: 'G', habits: [{ title: 'H', repeat }] }, TODAY).habits[0].repeat;
  assert.deepEqual(repeatOf({ kind: 'weekly', day: 3 }), { kind: 'daily' });
  assert.deepEqual(repeatOf({ kind: 'monthly', date: 1 }), { kind: 'daily' });
  assert.deepEqual(repeatOf(undefined), { kind: 'daily' });
  assert.deepEqual(repeatOf({ kind: 'weekdays', days: [0, 8] }), { kind: 'daily' });
  assert.deepEqual(repeatOf({ kind: 'perWeek', n: 9 }), { kind: 'perWeek', n: 7 });
  assert.deepEqual(repeatOf({ kind: 'perWeek', n: 'lots' }), { kind: 'daily' });
});

test('parseShape keeps targetDate only when it is a real day on or after today', () => {
  const dateOf = (targetDate) => parseShape({ title: 'G', targetDate }, TODAY).targetDate;
  assert.equal(dateOf('2026-09-11'), '2026-09-11');
  assert.equal(dateOf('2026-09-10'), null);
  assert.equal(dateOf('2026-02-30'), null);
  assert.equal(dateOf('2027-02-30'), null);
  assert.equal(dateOf('next week'), null);
  assert.equal(dateOf(null), null);
});

test('parseShape drops a target that is not a positive number in count or minutes', () => {
  const targetsOf = (targets) => parseShape({ title: 'G', targets }, TODAY).targets;
  assert.deepEqual(targetsOf([
    { title: 'Zero', target: 0, unit: 'count' },
    { title: 'Negative', target: -3, unit: 'count' },
    { title: 'Words', target: 'lots', unit: 'count' },
    { title: 'Missing', unit: 'count' },
    { title: 'Hours', target: 2, unit: 'hours' },
    { title: 'Rounds to nothing', target: 0.3, unit: 'minutes' },
    { title: '', target: 3, unit: 'count' },
  ]), []);
  assert.deepEqual(targetsOf([{ title: 'No unit', target: 3 }]), [{ title: 'No unit', target: 3, unit: 'count', unitLabel: '' }]);
});

test('parseShape needs a title; everything else may be empty', () => {
  assert.deepEqual(parseShape({ title: 'Just a title' }, TODAY), {
    title: 'Just a title', targetDate: null, milestones: [], habits: [], targets: [], why: '',
  });
  assert.equal(parseShape({ title: 't'.repeat(100) }, TODAY).title.length, 80);
  for (const bad of [null, [], 'plan', {}, { title: '  ' }, { title: 5 }]) {
    assert.throws(() => parseShape(bad, TODAY), isNonsense, JSON.stringify(bad));
  }
});

test('parseDigest caps the summary at 1200 and wins and slips at 3', () => {
  assert.deepEqual(
    parseDigest({ summary: ' A steady week. ', wins: [' Sent 3 apps ', 'b', 'c', 'd'], slipped: ['Gym'], focus: ' Start by 9. ', score: 7 }),
    { summary: 'A steady week.', wins: ['Sent 3 apps', 'b', 'c'], slipped: ['Gym'], focus: 'Start by 9.' },
  );
  assert.equal(parseDigest({ summary: 's'.repeat(1300) }).summary.length, 1200);
  assert.deepEqual(parseDigest({ summary: 'S', wins: 'not a list' }), { summary: 'S', wins: [], slipped: [], focus: '' });
  for (const bad of [null, [], { summary: '' }, { wins: ['a'] }]) {
    assert.throws(() => parseDigest(bad), isNonsense, JSON.stringify(bad));
  }
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test`
Expected: FAIL — `tests/coach-prompts.test.js` doesn't load: `SyntaxError: The requested module '../js/coach.js' does not provide an export named …` (one of `JOBS`, `SYSTEM`, the builders or the parsers).

- [ ] **Step 3: Add the import**

In `js/coach.js`, replace:

```js
import { journalId } from './doc.js';
```

with:

```js
import { journalId } from './doc.js';
import { GeminiError } from './gemini.js';
```

- [ ] **Step 4: Append the prompts and parsers**

Add this to the end of `js/coach.js`, after `digestDue`:

```js

// ---- Prompts -----------------------------------------------------------------------------------
// Each builder returns { system, prompt } for askGemini. The job texts are the design's, word for
// word; dev/fake-gemini.js recognises a job by finding its text in the prompt.

export const SYSTEM = "You are George's coach inside his personal daily dashboard. Be direct, warm and specific, in British English. Refer to the actual items, numbers and words in the data you are given; never give generic advice or motivational filler. No emojis. Stay within the length limits. Reply with JSON only, in exactly the shape asked for.";

export const JOBS = {
  questions: `Ask George 2 or 3 short questions about today, each answerable in a sentence or two. At least one must name something specific from today — a miss, a win, or a number. The last question is about tomorrow. Shape: {"questions": ["…", "…"]}`,
  feedback: `Reply with feedback of at most 90 words. First one specific thing that went well, if anything did; then the single most useful change for tomorrow, grounded in his answers and the numbers. Don't moralise and don't repeat his answers back to him. Then suggest at most 2 concrete tasks for tomorrow, only if they follow from what he said. Shape: {"feedback": "…", "tomorrow": [{"title": "…"}]}`,
  shape: `Turn this into a plan George can start this week. Don't duplicate anything he already tracks. Prefer small weekly targets he can actually hit. Shape: {"title": "short goal name", "targetDate": "YYYY-MM-DD" or null (only if he gave or implied a deadline), "milestones": ["3 to 6 concrete, checkable steps, in order"], "habits": [0 to 2 of {"title": "…", "repeat": {"kind": "daily"} or {"kind": "weekdays", "days": [1-7…]} or {"kind": "perWeek", "n": 1-7}}], "targets": [0 to 2 of {"title": "…", "target": number, "unit": "count" or "minutes", "unitLabel": "…"}], "why": "one sentence"}`,
  digest: `Write last week's digest, for George and for Claude, who reads it later to help him. Shape: {"summary": "at most 120 words", "wins": [0 to 3 short phrases], "slipped": [0 to 3 short phrases], "focus": "one sentence for this week"}`,
};

const TYPED_CAP = 1000;
const TRACKED_CAP = 80;

// Job A — the check-in questions.
export function questionsPrompt(doc, today) {
  return { system: SYSTEM, prompt: `${coachContext(doc, today)}\n\n${JOBS.questions}` };
}

// Job B — feedback on his answers. A blank answer is sent as "(no answer)".
export function feedbackPrompt(doc, today, questions, answers) {
  const qa = questions.flatMap((q, i) => [`Q: ${clip(q, ANSWER_CAP)}`, `A: ${clip(answers?.[i], TYPED_CAP) || '(no answer)'}`]);
  return {
    system: SYSTEM,
    prompt: `${coachContext(doc, today)}\n\nToday's check-in:\n${qa.join('\n')}\n\n${JOBS.feedback}`,
  };
}

// Every goal and item he tracks or has been offered, so a new plan doesn't repeat them.
function trackedTitles(doc) {
  const live = (r) => r.status === 'active' || r.status === 'suggested';
  return [...values(doc.goals).filter(live).sort(byOrder), ...values(doc.items).filter(live).sort(byOrder)]
    .map((r) => clip(r.title, 80))
    .filter(Boolean);
}

// Job C — shape a goal from what he typed.
export function shapePrompt(doc, today, text) {
  const titles = trackedTitles(doc);
  return {
    system: SYSTEM,
    prompt: [
      coachContext(doc, today),
      '',
      `Today's date: ${today}`,
      `Already tracked: ${titles.length ? titles.slice(0, TRACKED_CAP).join('; ') : 'nothing yet'}`,
      'Days of the week are numbered 1 (Monday) to 7 (Sunday). Time targets are in minutes.',
      `George wrote: ${clip(text, TYPED_CAP)}`,
      '',
      JOBS.shape,
    ].join('\n'),
  };
}

function goalWeekLine(g) {
  const detail = g.numeric
    ? `${formatAmount(g.done, g.unit)} of ${formatAmount(g.total, g.unit)}, ${formatAmount(g.week, g.unit)} this week`
    : `${g.done} of ${g.total} milestones`;
  return `${clip(g.title, 80)} — ${g.pct}% (${detail})`;
}

// Job D — the digest of the week starting `monday`: its numbers, then its check-ins.
export function digestPrompt(doc, monday) {
  const s = weekStats(doc, monday);
  const checkins = values(doc.journal)
    .filter((c) => c.kind === 'checkin' && c.status === 'active' && c.day >= s.monday && c.day <= s.sunday)
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map((c) => {
      const answers = answersOf(c).map((a) => clip(a, ANSWER_CAP)).join(' / ') || '(none)';
      return `${shortWeekday(c.day)}: answers: ${answers} — feedback: ${clip(c.feedback, 400) || '(none)'}`;
    });
  const lines = [
    `Week: ${longDate(s.monday)} to ${longDate(s.sunday)} ${s.sunday.slice(0, 4)}`,
    `Days: ${s.days.map((d) => `${shortWeekday(d.day)} ${d.done}/${d.total}`).join(' · ')}`,
    ...section('Habits:', s.habits.slice(0, ROW_CAP).map((h) => `${clip(h.title, 80)}: ${h.done} of ${h.scheduled}`), s.habits.length, 'none'),
    ...section('Weekly targets:', s.targets.slice(0, TARGET_CAP).map((t) => targetLine(t, t.total)), s.targets.length, 'none'),
    `Tasks: ${s.tasks.done} of ${s.tasks.total} done`,
    ...section('Goals:', s.goals.slice(0, GOAL_CAP).map(goalWeekLine), s.goals.length, 'none'),
    ...section('Check-ins:', checkins, checkins.length, 'none'),
  ];
  return { system: SYSTEM, prompt: `${lines.join('\n')}\n\n${JOBS.digest}` };
}

// ---- Reply parsers -----------------------------------------------------------------------------
// Each takes the JSON askGemini returned and gives back a clean object, or throws the "didn't make
// sense" GeminiError. Strings are trimmed and capped, lists cut to the counts the prompts ask
// for, and any field not asked for is dropped. Nothing is written until a parser has passed.

const nonsense = () => new GeminiError('nonsense');
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const oneLine = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n).trim() : '');
const block = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n).trim() : '');
const lineList = (v, max, n) => (Array.isArray(v) ? v.map((x) => oneLine(x, n)).filter(Boolean).slice(0, max) : []);
const isRealDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && addDays(d, 0) === d;

// → { questions: string[] }  1–3 questions, each at most 300 characters.
export function parseQuestions(data) {
  if (!isObject(data)) throw nonsense();
  const questions = lineList(data.questions, 3, 300);
  if (!questions.length) throw nonsense();
  return { questions };
}

// → { feedback: string, tomorrow: { title }[] }  feedback at most 900 characters; 0–2 tasks.
export function parseFeedback(data) {
  if (!isObject(data)) throw nonsense();
  const feedback = block(data.feedback, 900);
  if (!feedback) throw nonsense();
  const tomorrow = (Array.isArray(data.tomorrow) ? data.tomorrow : [])
    .map((t) => ({ title: oneLine(isObject(t) ? t.title : t, 80) }))
    .filter((t) => t.title)
    .slice(0, 2);
  return { feedback, tomorrow };
}

// Only the three repeats the prompt offers; anything else becomes daily.
function cleanRepeat(r) {
  if (isObject(r) && r.kind === 'weekdays' && Array.isArray(r.days)) {
    const days = [...new Set(r.days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);
    if (days.length) return { kind: 'weekdays', days };
  }
  if (isObject(r) && r.kind === 'perWeek' && typeof r.n === 'number' && Number.isFinite(r.n)) {
    return { kind: 'perWeek', n: Math.min(7, Math.max(1, Math.round(r.n))) };
  }
  return { kind: 'daily' };
}

// A weekly target, or null when it can't be one: a positive number, in minutes for time.
function cleanTarget(t) {
  if (!isObject(t)) return null;
  const unit = t.unit === undefined ? 'count' : t.unit;
  if (unit !== 'count' && unit !== 'minutes') return null;
  const title = oneLine(t.title, 80);
  let target = typeof t.target === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(t.target) ? Number(t.target) : t.target;
  if (typeof target !== 'number' || !Number.isFinite(target)) return null;
  if (unit === 'minutes') target = Math.round(target);
  if (!title || !(target > 0)) return null;
  return { title, target, unit, unitLabel: unit === 'count' ? oneLine(t.unitLabel, 40) : '' };
}

// → { title, targetDate, milestones, habits, targets, why }  targetDate only if it's a real day
// on or after today; up to 6 milestones, 2 habits and 2 targets.
export function parseShape(data, today) {
  if (!isObject(data)) throw nonsense();
  const title = oneLine(data.title, 80);
  if (!title) throw nonsense();
  return {
    title,
    targetDate: isRealDay(data.targetDate) && data.targetDate >= today ? data.targetDate : null,
    milestones: lineList(data.milestones, 6, 80),
    habits: (Array.isArray(data.habits) ? data.habits : [])
      .filter(isObject)
      .map((h) => ({ title: oneLine(h.title, 80), repeat: cleanRepeat(h.repeat) }))
      .filter((h) => h.title)
      .slice(0, 2),
    targets: (Array.isArray(data.targets) ? data.targets : []).map(cleanTarget).filter(Boolean).slice(0, 2),
    why: oneLine(data.why, 300),
  };
}

// → { summary, wins, slipped, focus }  summary at most 1200 characters; 0–3 wins and slips.
export function parseDigest(data) {
  if (!isObject(data)) throw nonsense();
  const summary = block(data.summary, 1200);
  if (!summary) throw nonsense();
  return {
    summary,
    wins: lineList(data.wins, 3, 80),
    slipped: lineList(data.slipped, 3, 80),
    focus: oneLine(data.focus, 300),
  };
}
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — 171 tests (13 new).

- [ ] **Step 6: Commit**

```bash
git add js/coach.js tests/coach-prompts.test.js
git commit -m "Add coach prompts and reply parsers" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
