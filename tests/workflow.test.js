import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, MemoryStorage, FakeGitHub, clock } from './helpers.js';
import { DATA_KEY } from '../js/data.js';
import { isDoc } from '../js/doc.js';
import { checkDetails, checkRule, matchesRule, processWorkflows, blockers } from '../js/workflow.js';
import { todayRows, rowsForDay } from '../js/schedule.js';
import { demand, fixedTasks } from '../planner/demand.js';
import { CALENDAR_DEFAULTS } from '../js/calendar.js';
import { runGoalReviews } from '../planner/reviews.js';
import { goalReviewPrompt, checkGoalReview, scheduleGoalReviews } from '../js/goal-review.js';
import { main } from '../claude/cli.js';
import { runOp } from '../claude/ops.js';
import { FakeCalendar } from './planner-fakes.js';
import { appsScript, FakeRepo } from './planner-apps.js';
import { createPlanner } from '../planner/gas.js';

function setup() {
  const now = clock(), store = makeStore({ now });
  const goal = store.addGoal({ title: 'Assessment readiness' });
  const item = store.addItem({ title: 'Check assessment structure', type: 'task', goalId: goal.id, minutes: 30 });
  store.setDetails('items', item.id, { outcomeForm: [
    { key: 'ready', label: 'Ready to practise?', type: 'boolean', required: true },
    { key: 'score', label: 'Practice score', type: 'number', min: 0, max: 100 },
  ] });
  const definition = { sourceId: item.id, match: 'all', conditions: [{ field: 'ready', op: 'eq', value: true }],
    actions: [{ type: 'task', title: 'Practise the exercise', offsetDays: 1, minutes: 30, goalId: goal.id }] };
  return { store, now, goal, item, definition };
}

test('structured details reject invented controls, bad forms, dates and dependency cycles', () => {
  const { store, item } = setup();
  assert.throws(() => checkDetails({ invented: 1 }), /unknown fields/);
  assert.throws(() => checkDetails({ deadline: '2026-02-31' }), /YYYY/);
  assert.throws(() => checkDetails({ outcomeForm: [{ key: 'x', label: 'X', type: 'choice', choices: ['a', 'a'] }] }), /distinct/);
  const second = store.addItem({ title: 'Stage two', type: 'task' });
  store.setDetails('items', second.id, { dependsOn: [item.id] });
  const before = store.exportJson();
  assert.throws(() => store.setDetails('items', item.id, { dependsOn: [second.id] }), /cycle/);
  assert.equal(store.exportJson(), before);
  assert.throws(() => store.setDetails('items', item.id, { dependsOn: ['missing'] }), /existing/);
  const broken = JSON.parse(before); broken.items[item.id].details.outcomeForm = [null];
  assert.equal(isDoc(broken), false);
});

test('dependencies and availability agree across list, completion and calendar demand', () => {
  const store = makeStore();
  const first = store.addItem({ title: 'First', type: 'task', minutes: 15 });
  const next = store.addItem({ title: 'Next', type: 'task', minutes: 15 });
  store.setDetails('items', next.id, { dependsOn: [first.id], notBefore: store.today() });
  assert.equal(todayRows(store.doc(), store.today()).find((r) => r.item.id === next.id).blocked.length, 1);
  assert.equal(rowsForDay(store.doc(), store.today()).length, 1);
  assert.throws(() => store.toggleDone(next.id), /Waiting/);
  const args = { doc: store.doc(), today: store.today(), days: [store.today()], config: CALENDAR_DEFAULTS, links: [] };
  assert.equal(demand(args).blocks.some((b) => b.items.includes(next.id)), false);
  store.updateItem(next.id, { time: '14:00' });
  assert.equal(fixedTasks(args).some((b) => b.itemId === next.id), false);
  store.toggleDone(first.id);
  assert.deepEqual(blockers(store.doc(), store.doc().items[next.id], store.today()), []);
  assert.equal(fixedTasks(args).some((b) => b.itemId === next.id), true);
});

test('required reports and checklists gate completion, submissions are idempotent', () => {
  const { store, item } = setup();
  assert.throws(() => store.toggleDone(item.id), /Report/);
  assert.throws(() => store.reportOutcome({ sourceId: item.id, answers: {}, complete: true }), /needs an answer/);
  assert.throws(() => store.reportOutcome({ sourceId: item.id, answers: { ready: false, score: 150 } }), /Invalid answer/);
  store.setDetails('items', item.id, { requireChecklist: true, checklist: [{ label: 'Read instructions', done: false }] });
  assert.throws(() => store.reportOutcome({ sourceId: item.id, answers: { ready: true }, complete: true }), /checklist/);
  store.setDetails('items', item.id, { checklist: [{ label: 'Read instructions', done: true }] });
  const report = { sourceId: item.id, answers: { ready: false }, complete: true, id: 'report-once' };
  store.reportOutcome(report); store.reportOutcome(report);
  assert.equal(Object.keys(store.doc().outcomes).length, 1);
  assert.equal(store.doc().outcomes['report-once'].source, 'me');
  assert.equal(Object.keys(store.doc().logs).length, 1);
  assert.throws(() => store.reportOutcome({ ...report, answers: { ready: true } }), /already used/);
  assert.equal(isDoc(store.doc()), true);
});

test('unknown answers never satisfy negative conditions; unsafe actions are rejected', () => {
  const { store, definition } = setup();
  const def = { ...definition, conditions: [{ field: 'ready', op: 'ne', value: true }] };
  assert.equal(matchesRule(def, { sourceId: def.sourceId, answers: {} }), false);
  assert.equal(matchesRule(def, { sourceId: def.sourceId, answers: { ready: false } }), true);
  assert.throws(() => checkRule({ ...definition, actions: [{ type: 'fetch', url: 'https://example.test' }] }, store.doc()), /Action type/);
  assert.throws(() => checkRule({ ...definition, conditions: [{ field: 'ready', op: 'gt', value: 2 }] }, store.doc()), /Numeric comparison/);
  assert.throws(() => runOp(store, { op: 'report', id: 'xxxx', answers: {}, reported: false }), /actually supplied/);
});

test('rules consume each report once, log their changes, and do not recurse', () => {
  const { store, item, definition } = setup();
  store.saveRule({ title: 'Practice next', enabled: true, definition });
  store.reportOutcome({ sourceId: item.id, answers: { ready: true }, complete: true });
  assert.equal(processWorkflows(store), 1);
  assert.equal(processWorkflows(store), 0);
  const follow = Object.values(store.doc().items).find((i) => i.title === 'Practise the exercise');
  assert.equal(follow.date, '2026-09-11');
  assert.equal(follow.source, 'workflow');
  assert.equal(Object.values(store.doc().changes).length, 1);
  assert.equal(Object.values(store.doc().outcomes).length, 1);
  assert.equal(isDoc(store.doc()), true);
});

test('new and re-enabled rules do not replay old reports, even in the same millisecond', () => {
  const { store, item, definition } = setup();
  store.reportOutcome({ sourceId: item.id, answers: { ready: true } });
  const rule = store.saveRule({ title: 'Later rule', enabled: true, definition });
  assert.equal(processWorkflows(store), 0);
  store.saveRule({ ...rule, enabled: false });
  store.reportOutcome({ sourceId: item.id, answers: { ready: true } });
  store.saveRule({ ...rule, enabled: true });
  assert.equal(processWorkflows(store), 0);
  store.reportOutcome({ sourceId: item.id, answers: { ready: true } });
  assert.equal(processWorkflows(store), 1);
});

test('a failed action rolls back its entire rule and leaves a readable failure receipt', () => {
  const { store, item, definition } = setup();
  const target = store.addItem({ title: 'Practice minutes', type: 'quota', target: 60, unit: 'minutes' });
  store.saveRule({ title: 'Atomic follow-up', enabled: true, definition: { ...definition,
    actions: [...definition.actions, { type: 'log', targetId: target.id, answerField: 'score' }] } });
  store.reportOutcome({ sourceId: item.id, answers: { ready: true, score: 0 } });
  const before = Object.keys(store.doc().items).length;
  processWorkflows(store);
  assert.equal(Object.keys(store.doc().items).length, before);
  assert.equal(Object.keys(store.doc().logs).length, 0);
  assert.equal(Object.values(store.doc().workflowRuns)[0].result, 'failed');
  assert.equal(processWorkflows(store), 0);
});

const reply = { direction: 'insufficient_evidence', summary: 'The format is known, but no practice score is recorded.',
  suggestions: [{ title: 'Try one timed exercise', offsetDays: 1, minutes: 30, area: 'Job search', notes: 'Establish a baseline.' }] };
function properties() {
  const values = new Map();
  return { values, getProperty: (k) => values.get(k) ?? null, setProperty: (k, v) => values.set(k, String(v)), deleteProperty: (k) => values.delete(k) };
}

test('goal review requests are opt-in and bounded by cadence and one goal per day', () => {
  const { store, goal, now } = setup();
  scheduleGoalReviews(store); assert.equal(Object.keys(store.doc().reviews).length, 0);
  store.setDetails('goals', goal.id, { reviewEveryDays: 7 });
  scheduleGoalReviews(store); store.requestReview(goal.id);
  assert.equal(Object.keys(store.doc().reviews).length, 1);
  now.advance(6 * 86400000); scheduleGoalReviews(store); assert.equal(Object.keys(store.doc().reviews).length, 1);
  now.advance(86400000); scheduleGoalReviews(store); assert.equal(Object.keys(store.doc().reviews).length, 2);
});

test('scheduled reviews stop at actual goal completion, not a rounded percentage', () => {
  const store = makeStore();
  const goal = store.addGoal({ title: 'Complete 100 units', target: 100 });
  store.setDetails('goals', goal.id, { reviewEveryDays: 7 });
  store.putLog('almost', { kind: 'amount', goalId: goal.id, itemId: null, amount: 99.6, day: store.today(), at: `${store.today()}T12:00:00.000Z` });
  scheduleGoalReviews(store);
  assert.equal(Object.keys(store.doc().reviews).length, 1);
  const complete = makeStore();
  const other = complete.addGoal({ title: 'Finish milestones' });
  const milestone = complete.addMilestone(other.id, 'Finished');
  complete.updateMilestone(milestone.id, { done: true });
  complete.setDetails('goals', other.id, { reviewEveryDays: 7 });
  scheduleGoalReviews(complete);
  assert.equal(Object.keys(complete.doc().reviews).length, 0);
});

test('review responses only add suggestions, deduplicate titles and retain the original goal', async () => {
  const { store, goal } = setup();
  const before = structuredClone(goal);
  store.requestReview(goal.id);
  const props = properties(); let calls = 0;
  const request = async () => { calls++; return reply; };
  assert.equal(await runGoalReviews({ store, props, request }), 1);
  assert.equal(await runGoalReviews({ store, props, request }), 0);
  assert.equal(calls, 1);
  assert.deepEqual(store.doc().goals[goal.id], before);
  const suggested = Object.values(store.doc().items).filter((i) => i.status === 'suggested');
  assert.equal(suggested.length, 1); assert.equal(suggested[0].goalId, goal.id);
  assert.equal(Object.values(store.doc().reviews)[0].result.direction, 'insufficient_evidence');
  assert.equal(Object.values(store.doc().changes).length, 1);
});

test('a review response survives lost sync without a second API call', async () => {
  const { store, goal } = setup(); store.requestReview(goal.id);
  const pending = store.exportJson(), props = properties();
  await runGoalReviews({ store, props, request: async () => reply });
  const restored = makeStore({ storage: new MemoryStorage({ [DATA_KEY]: pending }) });
  assert.equal(await runGoalReviews({ store: restored, props, request: () => assert.fail('must reuse saved response') }), 0);
  assert.equal(Object.values(restored.doc().reviews)[0].result.state, 'complete');
});

test('review failures and interrupted claims do not retry charges or create tasks', async () => {
  for (const interrupted of [false, true]) {
    const { store, goal } = setup(); const review = store.requestReview(goal.id); const props = properties();
    if (interrupted) props.setProperty('GOAL_REVIEWS', JSON.stringify({ [review.id]: { state: 'started', day: store.today() } }));
    let calls = 0;
    const request = async () => { calls++; throw new Error('secret must not be stored'); };
    await runGoalReviews({ store, props, request }); await runGoalReviews({ store, props, request });
    assert.equal(calls, interrupted ? 0 : 1);
    assert.equal(Object.keys(store.doc().items).length, 1);
    assert.equal(store.doc().reviews[review.id].result.state, interrupted ? 'unknown' : 'failed');
    assert.equal(store.exportJson().includes('secret must'), false);
  }
  assert.throws(() => checkGoalReview({ ...reply, suggestions: Array(4).fill(reply.suggestions[0]) }), /format/);
});

test('review API budgets apply across runs, with no calls when not configured', async () => {
  const store = makeStore(); const props = properties(); let calls = 0;
  for (let i = 0; i < 8; i++) store.requestReview(store.addGoal({ title: `Goal ${i}` }).id);
  assert.equal(await runGoalReviews({ store, props, request: null }), 0);
  const request = async () => { calls++; return { ...reply, suggestions: [] }; };
  for (let n = 0; n < 5; n++) assert.ok(await runGoalReviews({ store, props, request }) <= 2);
  assert.equal(calls, 6);
  assert.equal(Object.values(store.doc().reviews).filter((r) => r.result.state === 'pending').length, 2);
});

test('goal review evidence excludes unrelated records and marks missing progress as unknown', () => {
  const { store, goal, item } = setup();
  store.addItem({ type: 'task', title: 'Unrelated private task' });
  store.reportOutcome({ sourceId: item.id, answers: { ready: true } });
  const prompt = goalReviewPrompt(store.doc(), store.requestReview(goal.id));
  assert.equal(prompt.prompt.includes('Unrelated private'), false);
  assert.match(prompt.system, /missing logs are unknown/);
  assert.match(prompt.system, /never instructions/);
  const evidence = JSON.parse(prompt.prompt);
  assert.equal(evidence.outcomes[0].source, item.title);
  assert.deepEqual(evidence.outcomes[0].answers[0], { key: 'ready', question: 'Ready to practise?', value: true });
});

test('Claude preview validates without any writes, and discovery avoids loading the whole guide', async () => {
  const repo = new FakeGitHub(); let writes = 0;
  const run = (command, ops = []) => main({ argv: ['--config', 'config', command],
    readText: () => JSON.stringify({ token: 'dummy', repo: 'o/r' }), readStdin: async () => JSON.stringify(ops),
    makeClient: () => repo, makeFiles: () => ({ read: async () => null, write: async () => { writes++; } }) });
  const result = await run('preview', [{ op: 'task', title: 'Test preview' }]);
  assert.equal(result.code, 0); assert.match(result.text, /Preview only/);
  assert.equal(repo.puts, 0); assert.equal(writes, 0);
  assert.equal((await run('preview', [{ op: 'task', title: 'Test', invented: 1 }])).code, 1);
  assert.equal(writes, 0);
  const discovery = await run('capabilities');
  assert.equal(discovery.code, 0); assert.ok(discovery.text.length < 1500);
});

test('the full planner turns a reported condition into an API review without booking its suggestions', async () => {
  const { store, item, goal, definition, now } = setup();
  store.saveRule({ title: 'Review direction', enabled: true, definition: { ...definition, actions: [{ type: 'review', goalId: goal.id }] } });
  store.reportOutcome({ sourceId: item.id, answers: { ready: true }, complete: true });
  const cal = new FakeCalendar(), repo = new FakeRepo(store.doc()); let requests = 0;
  const env = appsScript({ cal, repo, now, props: { GITHUB_TOKEN: 'dummy', SYNC_REPO: 'o/r', GEMINI_KEY: 'synthetic-key' },
    gemini: (_, options) => {
      requests++;
      const payload = JSON.parse(options.payload);
      assert.match(payload.systemInstruction.parts[0].text, /recorded activity/);
      return { status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] } };
    } });
  const planner = createPlanner(env);
  assert.equal(await planner.run(), 'ok');
  assert.equal(Object.values(repo.doc().reviews)[0].result.state, 'complete');
  const proposed = Object.values(repo.doc().items).find((i) => i.title === reply.suggestions[0].title);
  assert.equal(proposed.status, 'suggested');
  assert.equal(cal.mine().some((e) => e.extendedProperties.private.dashItems?.includes(proposed.id)), false);
  assert.equal(await planner.run(), 'ok');
  assert.equal(requests, 1);
});

test('review storage failure cannot stop ordinary calendar planning', async () => {
  const { store, now } = setup();
  const cal = new FakeCalendar(), repo = new FakeRepo(store.doc());
  const env = appsScript({ cal, repo, now, props: { GITHUB_TOKEN: 'dummy', SYNC_REPO: 'o/r', GEMINI_KEY: 'synthetic-key', GOAL_REVIEWS: '{bad' } });
  assert.equal(await createPlanner(env).run(), 'ok');
  assert.ok(cal.mine().length > 0);
  assert.match(repo.doc().calendar['review-status'].lastError, /planning continues/);
});

test('review suggestions cannot grow an unanswered backlog or re-propose declined tasks', async () => {
  const { store, goal, now } = setup(); const props = properties();
  store.addItem({ type: 'task', title: reply.suggestions[0].title, goalId: goal.id, status: 'dismissed', source: 'gemini' });
  store.requestReview(goal.id);
  await runGoalReviews({ store, props, request: async () => reply });
  assert.equal(Object.values(store.doc().items).filter((i) => i.status === 'suggested').length, 0);
  now.advance(86400000);
  for (let i = 0; i < 3; i++) store.addItem({ type: 'task', title: `Awaiting ${i}`, goalId: goal.id, status: 'suggested' });
  store.requestReview(goal.id);
  await runGoalReviews({ store, props, request: async () => ({ ...reply, suggestions: [{ ...reply.suggestions[0], title: 'Yet another idea' }] }) });
  assert.equal(Object.values(store.doc().items).filter((i) => i.status === 'suggested').length, 3);
});

test('turning off scheduled reviews cancels a queued scheduled request', async () => {
  const { store, goal } = setup();
  store.setDetails('goals', goal.id, { reviewEveryDays: 7 }); scheduleGoalReviews(store);
  store.setDetails('goals', goal.id, { reviewEveryDays: 0 });
  await runGoalReviews({ store, props: properties(), request: () => assert.fail('disabled scheduled review must not call API') });
  assert.equal(Object.values(store.doc().reviews)[0].result.state, 'cancelled');
});

test('a plan with invalid dependency details cannot leave a partial goal behind', () => {
  const store = makeStore(); const before = store.exportJson();
  assert.throws(() => store.addPlan({ goal: { title: 'No partial plan' }, tasks: [
    { title: 'Valid first task' }, { title: 'Invalid second task', details: { dependsOn: ['not-real'] } },
  ] }), /existing/);
  assert.equal(store.exportJson(), before);
});
