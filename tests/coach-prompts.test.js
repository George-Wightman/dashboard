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
