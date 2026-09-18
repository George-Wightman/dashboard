import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, clock, fixture } from './helpers.js';
import { FakeCalendar, step, ev, WORK } from './planner-fakes.js';
import { at } from '../planner/time.js';
import { reconcileCalendar } from '../planner/reconcile.js';
import { prepareCoachTurn } from '../js/coach-session.js';
import { scheduleView, taskInput } from '../js/plan-state.js';
import { talkContents, waitingOpener, conversationContents } from '../js/talk.js';
import { rowsForDay } from '../js/schedule.js';
import { createPlanner } from '../planner/gas.js';
import { FakeRepo, appsScript } from './planner-apps.js';
import { blockBody } from '../planner/plan.js';
import { APP } from './planner-fakes.js';
import { resolveConflict } from '../js/ui/agenda.js';

process.env.TZ = 'Europe/London';
const FRI = '2026-09-18', SAT = '2026-09-19';
function setup() {
  const now = clock(at(FRI, '08:00'));
  const store = makeStore({ now, prefix: 'task-' });
  const task = store.addItem({ type: 'task', title: 'Write the day out', date: FRI, area: 'Job search', minutes: 60 });
  return { now, store, task };
}
const commit = (store, turn) => { const p = turn.finish(); return store.commitDraft(p.before, p.after, p.summary); };

test('a turn has one net action; undo restores the before state', () => {
  const { store, task, now } = setup();
  const turn = prepareCoachTurn(store, now);
  turn.run('move_task', { id: task.id, day: SAT });
  turn.run('set_task', { id: task.id, minutes: '45m' });
  assert.equal(store.doc().items[task.id].date, FRI, 'draft is isolated');
  const change = commit(store, turn);
  assert.equal(Object.keys(store.doc().changes).length, 1);
  assert.equal(store.doc().items[task.id].date, SAT);
  assert.equal(store.undoChange(change.id).undone.length, 1);
  assert.equal(store.doc().items[task.id].date, FRI);
  assert.equal(store.doc().items[task.id].minutes, 60);
});

test('the incident forward/back sequence is collapsed instead of exposing two Undo buttons', () => {
  const { store, task, now } = setup();
  const turn = prepareCoachTurn(store, now);
  turn.run('move_task', { id: task.id, day: SAT });
  turn.run('move_task', { id: task.id, day: FRI });
  const p = turn.finish();
  assert.equal(p.edits.length, 0);
  assert.equal(p.edits.filter((e) => e.map === 'items' && e.after.date !== e.before.date).length, 0);
  // Explicit clearing of a time is allowed, but should not invent date changes.
  assert.equal(p.summary.includes('date:'), false);
});

function runner(store, cal = new FakeCalendar()) {
  const repo = new FakeRepo(store.doc());
  const env = appsScript({ cal, repo, props: { GITHUB_TOKEN: 'test-token', SYNC_REPO: 'o/r' }, now: () => at(FRI, '08:00') });
  return { repo, cal, env, planner: createPlanner(env) };
}

test('production runner follows an event dragged outside its window instead of deleting it', async () => {
  const { store, task } = setup();
  const { repo, cal, planner } = runner(store);
  assert.equal(await planner.run(), 'ok');
  const id = cal.byTitle(task.title).id;
  cal.move(id, '2026-10-23', '14:00', '15:00');
  assert.equal(await planner.run(), 'ok');
  assert.equal(repo.doc().items[task.id].date, '2026-10-23');
  assert.equal(cal.mine().length, 1);
  assert.equal(cal.mine()[0].id, id);
  assert.equal(scheduleView(repo.doc(), FRI).entries[0].scheduledDay, '2026-10-23');
  assert.equal(await planner.run(), 'ok');
  assert.equal(cal.mine().length, 1);
});

test('production runner imports deletion and never infers it from a failed lookup', async () => {
  const { store, task } = setup();
  const { repo, cal, env, planner } = runner(store);
  await planner.run();
  const id = cal.byTitle(task.title).id;
  cal.remove(id);
  const get = env.Calendar.Events.get;
  env.Calendar.Events.get = () => { throw new Error('Quota exceeded'); };
  assert.equal(await planner.run(), 'failed');
  assert.notEqual(repo.doc().items[task.id].scheduleHold, true);
  env.Calendar.Events.get = get;
  assert.equal(await planner.run(), 'ok');
  assert.equal(repo.doc().items[task.id].scheduleHold, true);
  assert.equal(cal.mine().length, 0);
  assert.equal(await planner.run(), 'ok');
  assert.equal(cal.mine().length, 0);
});

test('migration of a future area block waits for confirmed deletion before inserting children', async () => {
  const { store, task } = setup();
  const other = store.addItem({ type: 'task', title: 'Update CV', date: FRI, area: 'Job search', minutes: 30 });
  const legacy = { calendarId: APP, ...blockBody({ key: `${FRI}|job search|0`, title: 'Job search ×2', base: 'Job search ×2',
    start: at(FRI, '09:00'), end: at(FRI, '10:30'), items: [task.id, other.id], state: 'exact' }) };
  const { repo, cal, env, planner } = runner(store, new FakeCalendar([legacy]));
  const remove = env.Calendar.Events.remove;
  env.Calendar.Events.remove = () => { throw new Error('Temporary Calendar failure'); };
  assert.equal(await planner.run(), 'partly');
  assert.equal(cal.mine().length, 1);
  assert.equal(repo.doc().calendar.agenda.blocks.length, 1);
  env.Calendar.Events.remove = remove;
  assert.equal(await planner.run(), 'ok');
  assert.equal(cal.mine().length, 2);
  assert.ok(cal.mine().every((e) => e.extendedProperties.private.dashKey.startsWith('task|')));
  assert.equal(await planner.run(), 'ok');
  assert.equal(cal.mine().length, 2);
});

test('a conflicting title remains untouched until the chosen resolution reaches Calendar', async () => {
  const { store, task } = setup();
  const { repo, cal, planner } = runner(store);
  await planner.run();
  const id = cal.byTitle(task.title).id;
  const changed = repo.doc(); changed.items[task.id].title = 'Phone title'; repo.text = JSON.stringify(changed);
  cal.get(id).summary = 'Calendar title';
  assert.equal(await planner.run(), 'ok');
  assert.equal(repo.doc().calendar[`conflict:${task.id}`].open, true);
  assert.equal(cal.get(id).summary, 'Calendar title');
  store.replaceDoc(repo.doc());
  resolveConflict({ store }, task.id, 'dashboard');
  repo.text = JSON.stringify(store.doc());
  assert.equal(await planner.run(), 'ok');
  assert.equal(cal.get(id).summary, 'Phone title');
  assert.equal(repo.doc().calendar[`conflict:${task.id}`].resolution, null);
  assert.equal(await planner.run(), 'ok');
  assert.equal(repo.doc().calendar[`conflict:${task.id}`].open, false);
});

test('failed mutations and stale drafts cannot commit partial changes', () => {
  const { store, task, now } = setup();
  const turn = prepareCoachTurn(store, now);
  turn.run('move_task', { id: task.id, day: SAT });
  turn.run('set_task', { id: task.id, minutes: 'nonsense' });
  assert.throws(() => turn.finish(), /No plan changes/);
  assert.equal(store.doc().items[task.id].date, FRI);
  const other = prepareCoachTurn(store, now);
  other.run('move_task', { id: task.id, day: SAT });
  store.updateItem(task.id, { title: 'Changed on phone' });
  assert.throws(() => commit(store, other), /plan changed/);
  assert.equal(store.doc().items[task.id].date, FRI);
});

test('weekend capture is direct, repeated capture is idempotent within the turn, closed day is enforced', () => {
  const { store, now } = setup();
  const turn = prepareCoachTurn(store, now);
  const args = { title: 'Consider selling PC', day: '2026-09-20' };
  turn.run('add_task', args); turn.run('add_task', args);
  assert.equal(turn.finish().proposal, false);
  commit(store, turn);
  assert.equal(Object.values(store.doc().items).filter((i) => i.title === args.title).length, 1);
  const closed = prepareCoachTurn(store, now);
  closed.run('close_day', {}); commit(store, closed);
  const late = prepareCoachTurn(store, now);
  assert.equal(late.run('add_task', { title: 'New work', day: FRI }).ok, false);
  assert.throws(() => late.finish(), /closed/);
});

test('broad reviews become proposals and receipts include actual undo state', () => {
  const { store, task, now } = setup();
  const turn = prepareCoachTurn(store, now, { message: 'The calendar layout is not relevant' });
  turn.run('move_task', { id: task.id, day: SAT });
  assert.equal(turn.finish().proposal, true);
  const change = commit(store, turn);
  store.undoChange(change.id);
  const contents = talkContents({ messages: [{ who: 'coach', text: 'Done.', did: [{ text: 'Moved task', change: change.id }] }] }, [], store.doc());
  assert.match(JSON.stringify(contents), /UNDONE/);
});

test('one-hour tasks fill fragmented free windows as separate named events', () => {
  const { store, task, now } = setup();
  store.addItem({ type: 'task', title: 'Update CV', date: FRI, area: 'Job search', minutes: 60 });
  const cal = new FakeCalendar([ev(WORK, 'Midday meeting', FRI, '10:30', '12:00'), ev(WORK, 'Busy', FRI, '13:30', '19:00')]);
  const r = step(cal, store.doc(), now());
  const blocks = r.days[FRI].blocks;
  assert.deepEqual(blocks.map((b) => b.title), ['Write the day out', 'Update CV']);
  assert.equal(blocks.every((b) => b.items.length === 1), true);
  assert.match(blocks[0].key, /^task\|/);
  assert.match(cal.byTitle(task.title).description, /Open task \/ mark complete:/);
  assert.deepEqual(step(cal, store.doc(), now(), r.days).actions, []);
});

test('overflow has one confirmed day shared by the agenda, Today and the Coach', () => {
  const { store, task, now } = setup();
  const cal = new FakeCalendar([ev(WORK, 'Busy all Friday', FRI, '09:00', '19:00')]);
  const r = step(cal, store.doc(), now());
  store.putCalendar('agenda', { from: FRI, through: '2026-10-01', syncedAt: now().toISOString(), blocks: Object.values(r.days).flatMap((d) => d.blocks) });
  const [entry] = scheduleView(store.doc(), FRI).entries;
  assert.equal(entry.scheduledDay, SAT);
  assert.equal(entry.requestedDay, FRI);
  assert.equal(rowsForDay(store.doc(), FRI).some((r) => r.item.id === task.id), false);
  assert.equal(rowsForDay(store.doc(), SAT).filter((r) => r.item.id === task.id).length, 1);
});

test('calendar drag, resize and rename update the task and do not duplicate its event', () => {
  const { store, task, now } = setup();
  const cal = new FakeCalendar();
  const first = step(cal, store.doc(), now());
  const event = cal.byTitle(task.title);
  cal.move(event.id, SAT, '14:00', '14:45');
  cal.get(event.id).summary = 'Write the IDADP plan';
  reconcileCalendar(store, cal.all());
  const updated = store.doc().items[task.id];
  assert.deepEqual([updated.title, updated.date, updated.time, updated.minutes], ['Write the IDADP plan', SAT, '14:00', 45]);
  const second = step(cal, store.doc(), now(), first.days);
  assert.equal(cal.mine().length, 1);
  assert.equal(cal.mine()[0].id, event.id);
  assert.equal(cal.mine()[0].summary, updated.title);
  assert.deepEqual(step(cal, store.doc(), now(), second.days).actions, []);
});

test('calendar deletion retains the task as unscheduled; conflicting edits are visible', () => {
  const { store, task, now } = setup();
  const cal = new FakeCalendar();
  step(cal, store.doc(), now());
  const event = cal.byTitle(task.title);
  store.updateItem(task.id, { title: 'Phone title' });
  cal.get(event.id).summary = 'Calendar title';
  assert.deepEqual(reconcileCalendar(store, cal.all()), [task.id]);
  assert.equal(store.doc().items[task.id].title, 'Phone title');
  assert.equal(scheduleView(store.doc(), FRI).entries[0].state, 'conflict');
  const clean = setup();
  const deleted = { ...event, status: 'cancelled' };
  reconcileCalendar(clean.store, [], [deleted]);
  assert.equal(clean.store.doc().items[clean.task.id].scheduleHold, true);
  assert.equal(clean.store.doc().items[clean.task.id].status, 'active');
  assert.equal(step(new FakeCalendar(), clean.store.doc(), clean.now()).actions.length, 0);
});

test('missed prompts expire and separate storage segments form one conversation', () => {
  const { store } = setup();
  store.saveJournal({ kind: 'talk', day: FRI, slot: 'afternoon', messages: [{ who: 'coach', text: 'Old prompt', at: at(FRI, '14:00').toISOString() }] });
  assert.equal(waitingOpener(store.doc(), FRI, at(FRI, '20:00')), null);
  store.saveJournal({ kind: 'talk', day: FRI, slot: 'own-1', messages: [{ who: 'george', text: 'Remember the garage', at: at(FRI, '15:00').toISOString() }], done: true });
  store.saveJournal({ kind: 'talk', day: FRI, slot: 'own-2', messages: [{ who: 'george', text: 'One more thing', at: at(FRI, '20:00').toISOString() }] });
  const text = JSON.stringify(conversationContents(store.doc(), FRI));
  assert.match(text, /Remember the garage/); assert.match(text, /One more thing/);
  assert.doesNotMatch(text, /Old prompt/);
});

test('moving one split session preserves every remaining session', async () => {
  const { store, task } = setup();
  store.updateItem(task.id, { minutes: 240 });
  const { cal, planner } = runner(store);
  await planner.run();
  const initial = cal.mine();
  assert.ok(initial.length > 1);
  const first = initial[0];
  cal.move(first.id, SAT, '14:00', '15:30');
  await planner.run();
  assert.equal(cal.mine().length, initial.length);
  assert.equal(cal.get(first.id).start.dateTime, at(SAT, '14:00').toISOString());
  await planner.run();
  assert.equal(cal.mine().length, initial.length);
});

test('an invalid all-day conversion waits for a choice and replaces without duplicating', async () => {
  const { store, task } = setup();
  const { cal, planner, repo } = runner(store);
  await planner.run();
  const event = cal.mine()[0];
  cal.get(event.id).start = { date: FRI };
  cal.get(event.id).end = { date: SAT };
  await planner.run();
  assert.equal(cal.mine().length, 1);
  assert.equal(repo.doc().calendar['conflict:' + task.id].calendarValid, false);
  store.replaceDoc(repo.doc());
  assert.throws(() => resolveConflict({ store }, task.id, 'calendar'), /not a valid/);
  resolveConflict({ store }, task.id, 'dashboard');
  repo.text = JSON.stringify(store.doc());
  await planner.run();
  assert.equal(cal.mine().length, 1);
  assert.ok(cal.mine()[0].start.dateTime);
  assert.equal(repo.doc().calendar['conflict:' + task.id].resolution, null);
  cal.get(cal.mine()[0].id).summary = 'Renamed after resolution';
  await planner.run();
  assert.equal(repo.doc().items[task.id].title, 'Renamed after resolution');
});


test('shared agenda includes each day of an external all-day commitment', async () => {
  const { store } = setup();
  const cal = new FakeCalendar([{ calendarId: WORK, summary: 'Conference', start: { date: FRI }, end: { date: '2026-09-20' } }]);
  const { planner, repo } = runner(store, cal);
  await planner.run();
  const busy = repo.doc().calendar.agenda.busy.filter(b => b.title === 'Conference');
  assert.equal(busy.length, 2);
  assert.ok(busy.every(b => b.allDay));
});
