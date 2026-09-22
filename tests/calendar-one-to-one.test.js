// The calendar and the task list, one to one (docs/superpowers/specs/2026-09-22-calendar-one-to-one-design.md):
// an event George adds on an area's calendar becomes a task, and deleting a task's block removes the task.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, clock } from './helpers.js';
import { FakeCalendar, ev, allDayEv, MAIN, APP, GYM, WORK } from './planner-fakes.js';
import { at } from '../planner/time.js';
import { createPlanner } from '../planner/gas.js';
import { FakeRepo, appsScript } from './planner-apps.js';
import { openFlags } from '../js/flags.js';

process.env.TZ = 'Europe/London';
const THU = '2026-09-17', FRI = '2026-09-18', SAT = '2026-09-19';

function setup({ config = null, events = [] } = {}) {
  const store = makeStore({ now: clock(at(FRI, '08:00')), prefix: 'task-' });
  if (config) store.putCalendar('config', config);
  const cal = new FakeCalendar(events);
  const repo = new FakeRepo(store.doc());
  const env = appsScript({ cal, repo, props: { GITHUB_TOKEN: 'test-token', SYNC_REPO: 'o/r' }, now: () => at(FRI, '08:00') });
  return { repo, cal, env, planner: createPlanner(env) };
}
// Another device's edit, pushed to the sync repo between runs.
function edit(repo, fn) {
  const doc = repo.doc();
  fn(doc);
  repo.text = JSON.stringify(doc);
  repo.sha = `sha${++repo.n}`;
}
const tasks = (repo) => Object.values(repo.doc().items).filter((i) => i.type === 'task');
const active = (repo) => tasks(repo).filter((i) => i.status === 'active');

// ---- George's own events become tasks ----------------------------------------------------------

test("an event George adds on an area's calendar becomes a task, pinned where he put it", async () => {
  const { repo, cal, planner } = setup({ events: [
    ev(APP, 'Call the vetting officer', FRI, '14:00', '14:45', { id: 'vet', description: 'Number is in the email' }),
  ] });
  assert.equal(await planner.run(), 'ok');
  const [t] = active(repo);
  assert.equal(t.title, 'Call the vetting officer');
  assert.equal(t.date, FRI);
  assert.equal(t.time, '14:00');
  assert.equal(t.minutes, 45);
  assert.equal(t.area, 'Job search');
  assert.equal(t.notes, 'Number is in the email');
  assert.equal(t.fromEvent, `${APP}|vet`);
  assert.equal(t.source, 'calendar');
  // His event is now the task's block: one event, marked as the planner's, linked to the task.
  assert.equal(cal.all().length, 1);
  const e = cal.get('vet');
  assert.equal(e.extendedProperties.private.dash, '1');
  assert.match(e.description, new RegExp(`dashboard:${t.id}`));
  assert.match(e.description, /Number is in the email/);
  assert.equal(e.start.dateTime, at(FRI, '14:00').toISOString());
  assert.ok(Object.values(repo.doc().changes).some((c) => c.summary === 'Added tasks from Google Calendar'));
});

test('run again: the same event is never adopted twice', async () => {
  const { repo, cal, planner } = setup({ events: [ev(APP, 'Call the vetting officer', FRI, '14:00', '14:45', { id: 'vet' })] });
  await planner.run();
  await planner.run();
  await planner.run();
  assert.equal(tasks(repo).length, 1);
  assert.equal(cal.all().length, 1);
});

test('a calendar two areas book into gives its task the priority area', async () => {
  const { repo, planner } = setup({
    config: { areaCalendars: { 'Job search': 'Application', 'Assessment centre': 'Application' }, priorityAreas: ['Assessment centre'] },
    events: [ev(APP, 'Practice role play', FRI, '10:00', '11:00')],
  });
  await planner.run();
  assert.equal(active(repo)[0].area, 'Assessment centre');
});

test('left alone: the main calendar, Work, repeating sessions, linked habits, all-day and past events', async () => {
  const { repo, cal, planner } = setup({ events: [
    ev(MAIN, 'Dinner with dad', FRI, '18:00', '20:00'),
    ev(WORK, 'Signify', FRI, '09:00', '13:00'),
    ev(GYM, 'Run club', FRI, '07:00', '08:00', { recurringEventId: 'club', originalStartTime: { dateTime: at(FRI, '07:00').toISOString() } }),
    ev(GYM, 'Gym', FRI, '17:00', '18:00'),
    allDayEv(APP, 'Assessment centre week', FRI, SAT),
    ev(APP, 'Yesterday’s call', THU, '10:00', '10:30'),
    ev(APP, 'Linked by hand', FRI, '15:00', '15:30', { description: 'dashboard:abc12345' }),
  ] });
  await planner.run();
  assert.deepEqual(tasks(repo).map((t) => t.title), []);
  assert.equal(cal.byTitle('Dinner with dad').extendedProperties, undefined);
});

test("moving George's event moves the task, like any block", async () => {
  const { repo, cal, planner } = setup({ events: [ev(APP, 'Call the vetting officer', FRI, '14:00', '14:45', { id: 'vet' })] });
  await planner.run();
  cal.move('vet', SAT, '10:00', '10:30');
  await planner.run();
  const [t] = active(repo);
  assert.equal(t.date, SAT);
  assert.equal(t.time, '10:00');
  assert.equal(t.minutes, 30);
});

// ---- Deleting a block removes the task ----------------------------------------------------------

test("deleting a task's block removes the task, and leaves a note saying so", async () => {
  const store = makeStore({ now: clock(at(FRI, '08:00')), prefix: 'task-' });
  const task = store.addItem({ type: 'task', title: 'Role play 2', date: FRI, area: 'Job search', minutes: 60 });
  const cal = new FakeCalendar();
  const repo = new FakeRepo(store.doc());
  const planner = createPlanner(appsScript({ cal, repo, props: { GITHUB_TOKEN: 'test-token', SYNC_REPO: 'o/r' }, now: () => at(FRI, '08:00') }));
  await planner.run();
  const booked = cal.byTitle('Role play 2');
  cal.remove(booked.id);
  assert.equal(await planner.run(), 'ok');
  assert.equal(repo.doc().items[task.id].status, 'archived');
  const [note] = openFlags(repo.doc(), 'note');
  assert.match(note.text, /Removed "Role play 2" from your list: its calendar block \(Fri 18 Sep, \d\d:\d\d\) was deleted/);
  assert.equal(note.source, 'calendar');
  await planner.run();
  assert.equal(cal.mine().length, 0);
});

test("deleting George's adopted event removes its task too", async () => {
  const { repo, cal, planner } = setup({ events: [ev(APP, 'Call the vetting officer', FRI, '14:00', '14:45', { id: 'vet' })] });
  await planner.run();
  cal.remove('vet');
  await planner.run();
  assert.equal(active(repo).length, 0);
  // …and it isn't adopted again from anywhere.
  await planner.run();
  assert.equal(tasks(repo).length, 1);
});

test('archiving an adopted task in the app deletes its event', async () => {
  const { repo, cal, planner } = setup({ events: [ev(APP, 'Call the vetting officer', FRI, '14:00', '14:45', { id: 'vet' })] });
  await planner.run();
  const [t] = active(repo);
  edit(repo, (doc) => { doc.items[t.id] = { ...doc.items[t.id], status: 'archived', archivedOn: FRI, updated: at(FRI, '08:01').toISOString() }; });
  await planner.run();
  assert.equal(cal.get('vet'), undefined);
  assert.equal(tasks(repo).length, 1);
});

test('deleting one part of a long task only unschedules it', async () => {
  const store = makeStore({ now: clock(at(FRI, '08:00')), prefix: 'task-' });
  const task = store.addItem({ type: 'task', title: 'Write-up day', date: FRI, area: 'Job search', minutes: 300 });
  const cal = new FakeCalendar();
  const repo = new FakeRepo(store.doc());
  const planner = createPlanner(appsScript({ cal, repo, props: { GITHUB_TOKEN: 'test-token', SYNC_REPO: 'o/r' }, now: () => at(FRI, '08:00') }));
  await planner.run();
  cal.remove(cal.byTitle('Write-up day (1 of 2)').id);
  await planner.run();
  assert.equal(repo.doc().items[task.id].status, 'active');
  assert.equal(repo.doc().items[task.id].scheduleHold, true);
});
