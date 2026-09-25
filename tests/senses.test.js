// Senses: what changed since the planner last looked, who did it, and how much it matters
// (docs/superpowers/specs/2026-09-25-coach-mind-design.md).

process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, done, amount } from './helpers.js';
import { at } from '../planner/time.js';
import { sense, planRisk } from '../planner/senses.js';
import { ev, APP, MAIN } from './planner-fakes.js';

const THU = '2026-09-24';
const FRI = '2026-09-25';
const RP3_NOTES = 'Pack: Job Search/IDADP/Practice/RP3_MILLRACE/RP3_MILLRACE_pack.html. 35 min prep, 25 min meeting.';

const goal = { id: 'ac', title: 'Smash Assessment Center', targetDate: '2026-10-05', order: 1 };
const plainGoal = { id: 'read', title: 'Reread a book', targetDate: '2026-12-31', order: 2 };
const rp3 = { id: 'rp3', type: 'task', title: 'Role play 3 - MILLRACE, timed', date: THU, area: 'Assessment centre', goalId: 'ac', notes: RP3_NOTES, order: 1 };
const star = { id: 'star', type: 'task', title: 'Planning and researching RPs', date: THU, area: 'Assessment centre', goalId: 'ac', order: 2 };
const scen = { id: 'scen', type: 'task', title: 'Scenario primer + 4 practice scenarios', date: THU, area: 'Assessment centre', goalId: 'ac', order: 3 };
const book = { id: 'book', type: 'task', title: 'Order the next book', date: THU, goalId: 'read', order: 4 };
const chore = { id: 'chore', type: 'task', title: 'Take the bins out', date: THU, order: 5 };
const gym = { id: 'gym', type: 'habit', title: 'Gym', repeat: { kind: 'perWeek', n: 5 }, area: 'Health', order: 6 };

function doc({ items = [rp3, star, scen, book, chore, gym], logs = [], goals = [goal, plainGoal], milestones = [], journal = [], flags = [], changes = [], calendar = {} } = {}) {
  const d = fixture({ items, logs, goals, milestones, journal, flags, changes });
  for (const [id, r] of Object.entries(calendar)) d.calendar[id] = { id, status: 'active', source: 'planner', updated: '2026-09-24T06:00:00.000Z', ...r };
  return d;
}
const T0 = at(THU, '17:00');
const T1 = at(THU, '19:30');
const baseline = (d, calEvents = [], now = T0) => sense({ doc: d, cursor: null, calEvents, now }).cursor;
const kinds = (events) => events.map((e) => `${e.kind}:${e.level}`).sort();

test('the first look records a baseline and says nothing', () => {
  const d = doc({ logs: [done('rp3', THU)] });
  const r = sense({ doc: d, cursor: null, calEvents: [], now: T0 });
  assert.deepEqual(r.events, []);
  assert.ok(r.cursor.at);
});

test('a tick on goal work due soon, by Claude, with the Drive path in its notes', () => {
  const before = doc();
  const cursor = baseline(before);
  const after = doc({ logs: [done('rp3', THU, { source: 'claude', at: at(THU, '19:23').toISOString() })] });
  const { events, cursor: next } = sense({ doc: after, cursor, now: T1 });
  assert.equal(events.length, 1);
  const [e] = events;
  assert.equal(e.kind, 'tick');
  assert.equal(e.level, 3);
  assert.equal(e.by, 'claude');
  assert.equal(e.id, `tick:done-rp3-${THU}`);
  assert.deepEqual(e.refs, { itemId: 'rp3', goalId: 'ac' });
  assert.deepEqual(e.paths, ['Job Search/IDADP/Practice/RP3_MILLRACE/RP3_MILLRACE_pack.html']);
  assert.match(e.text, /Role play 3 - MILLRACE, timed/);
  assert.match(e.text, /Claude/);
  assert.ok(e.facts.some((f) => /Smash Assessment Center/.test(f) && /5 Oct/.test(f)));
  assert.equal(e.reflex, null);
  assert.equal(e.deep, null);
  // Seen once.
  assert.deepEqual(sense({ doc: after, cursor: next, now: at(THU, '19:40') }).events, []);
});

test('tick levels: starred or goal-due work is 3, other goal work 2, the rest 1; Hevy and the Hebrew app are their own kinds', () => {
  const d = doc({ items: [rp3, { ...star, notes: '', priority: true }, book, chore, gym] });
  const cursor = baseline(d);
  const after = doc({ items: [rp3, { ...star, notes: '', priority: true }, book, chore, gym], logs: [
    done('star', THU), done('book', THU), done('chore', THU), done('gym', THU, { source: 'hevy' }),
  ] });
  assert.deepEqual(kinds(sense({ doc: after, cursor, now: T1 }).events), ['tick:1', 'tick:2', 'tick:3', 'workout:1']);
});

test('pushed and dropped: committed work that leaves the day, and who moved it', () => {
  const commit = { [`commit:${THU}`]: { day: THU, at: at(THU, '09:03').toISOString(), tasks: ['scen', 'chore', 'book'] } };
  const before = doc({ calendar: commit });
  const cursor = baseline(before, [], at(THU, '10:00'));
  const moved = [{ ...scen, date: FRI }, { ...chore, date: FRI }, { ...book, status: 'archived', archivedOn: THU }];
  const changes = [{ id: 'c1', source: 'calendar', at: at(THU, '11:00').toISOString(), summary: 'Imported task edits from Google Calendar',
    edits: [{ map: 'items', id: 'scen', before: scen, after: moved[0] }] }];
  const after = doc({ items: [rp3, star, ...moved, gym], changes, calendar: commit });
  const { events } = sense({ doc: after, cursor, now: at(THU, '11:05') });
  const by = Object.fromEntries(events.map((e) => [e.id, e]));
  assert.equal(by[`pushed:scen:${FRI}`].level, 3);
  assert.equal(by[`pushed:scen:${FRI}`].by, 'calendar');
  assert.equal(by[`pushed:chore:${FRI}`].by, 'me');
  assert.equal(by['dropped:book'].kind, 'dropped');
  assert.equal(by['dropped:book'].level, 3);
  assert.equal(events.length, 3);
});

test('moved: George dragging a block in Google Calendar', () => {
  const before = doc({ items: [{ ...scen, time: '11:00' }] });
  const cursor = baseline(before, [], at(THU, '09:00'));
  const after = doc({ items: [{ ...scen, time: '15:00' }], changes: [{ id: 'c2', source: 'calendar', at: at(THU, '09:30').toISOString(), summary: 'x',
    edits: [{ map: 'items', id: 'scen', before: null, after: null }] }] });
  const [e] = sense({ doc: after, cursor, now: at(THU, '09:40') }).events;
  assert.equal(e.kind, 'moved');
  assert.equal(e.level, 1, 'a move within the day is his to make: noted, never remarked on');
  assert.equal(e.id, `moved:scen:${THU}|15:00`);
  const later = doc({ items: [{ ...scen, date: '2026-09-26', time: null }], changes: [{ id: 'c3', source: 'calendar', at: at(THU, '09:30').toISOString(), summary: 'x',
    edits: [{ map: 'items', id: 'scen', before: null, after: null }] }] });
  assert.equal(sense({ doc: later, cursor, now: at(THU, '09:40') }).events[0].level, 2, 'to another day: looked at once the calendar settles');
});

test('slipped: a block that ended half an hour ago with its work unticked, once', () => {
  const block = (from, to, items) => ({ key: `${THU}|ac|${from}`, start: at(THU, from).toISOString(), end: at(THU, to).toISOString(), items, title: 'x', calendar: 'Application', state: 'exact' });
  const cal = { agenda: { from: THU, through: '2026-09-30', blocks: [block('14:30', '15:30', ['star']), block('15:30', '16:45', ['scen', 'rp3'])], busy: [] } };
  const cursor = baseline(doc({ calendar: cal }), [], at(THU, '14:00'));
  assert.deepEqual(sense({ doc: doc({ calendar: cal }), cursor, now: at(THU, '15:50') }).events, [], 'twenty minutes is still grace');
  let r = sense({ doc: doc({ calendar: cal }), cursor, now: at(THU, '16:05') });
  assert.deepEqual(r.events.map((e) => `${e.id}:${e.level}`), [`slip:${THU}:star:1`], 'noted, never chased');
  r = sense({ doc: doc({ calendar: cal }), cursor: r.cursor, now: at(THU, '17:20') });
  assert.deepEqual(r.events.map((e) => `${e.id}:${e.level}`).sort(), [`slip:${THU}:rp3:1`, `slip:${THU}:scen:1`]);
  assert.deepEqual(sense({ doc: doc({ calendar: cal }), cursor: r.cursor, now: at(THU, '17:40') }).events, []);
});

test('calendar: what George adds, moves or removes — with what it says', () => {
  const booked = { agenda: { from: THU, through: '2026-09-30', blocks: [
    { key: 'k', start: at(FRI, '13:00').toISOString(), end: at(FRI, '14:00').toISOString(), items: ['scen'], title: 'Scenario primer', calendar: 'Application', state: 'exact' },
  ], busy: [] } };
  const d = doc({ calendar: booked });
  const cursor = baseline(d, [ev(MAIN, 'Dentist', '2026-09-28', '09:00', '09:30', { id: 'dent' })]);
  const added = ev(APP, 'Meeting on the AC', FRI, '13:00', '13:30', { id: 'mtg', calendarId: APP,
    description: '<p>Apparently through <b>old links</b> &amp; the invite.</p>' + ' x'.repeat(400) });
  const mine = ev(APP, 'Scenario primer', FRI, '13:00', '14:00', { id: 'blk', extendedProperties: { private: { dash: '1' } } });
  const moved = ev(MAIN, 'Dentist', '2026-09-29', '09:00', '09:30', { id: 'dent' });
  let { events, cursor: next } = sense({ doc: d, cursor, calEvents: [added, mine, moved], now: T1 });
  const by = Object.fromEntries(events.map((e) => [e.refs.calendar, e]));
  assert.equal(events.length, 2);
  assert.equal(by[`${APP}|mtg`].level, 3, 'tomorrow, on top of booked work');
  assert.match(by[`${APP}|mtg`].text, /Meeting on the AC/);
  const desc = by[`${APP}|mtg`].facts.find((f) => f.startsWith('Description: '));
  assert.ok(desc.startsWith('Description: Apparently through old links & the invite.'));
  assert.ok(desc.length <= 'Description: '.length + 600);
  assert.equal(by[`${MAIN}|dent`].level, 1);
  assert.match(by[`${MAIN}|dent`].text, /moved/);
  // Removed while still ahead.
  ({ events } = sense({ doc: d, cursor: next, calEvents: [added, mine], now: at(THU, '19:40') }));
  assert.equal(events.length, 1);
  assert.match(events[0].text, /removed/);
  // An old recurring event that just came into view isn't new.
  const series = ev(MAIN, 'Learn Hebrew', '2026-10-01', '21:30', '21:50', { id: 'heb_20261001', created: '2026-08-01T10:00:00.000Z' });
  assert.deepEqual(sense({ doc: d, cursor: next, calEvents: [added, mine, series], now: at(THU, '19:40') }).events.map((e) => e.refs.calendar), [`${MAIN}|dent`]);
});

test('milestones, flags, the Hebrew app, replies to the Mind, and asks', () => {
  const ms = { id: 'm1', goalId: 'ac', title: 'Seven role plays run and debriefed', done: false, order: 1 };
  const talk = { id: `talk:${THU}:mind-1`, kind: 'talk', day: THU, slot: 'mind-1', messages: [{ who: 'coach', text: 'How did it go?', at: at(THU, '18:00').toISOString(), from: 'mind', by: 'gemini' }] };
  const hebrewMinutes = { id: 'hebrew-minutes', type: 'quota', title: 'Hebrew learning time', target: 90, unit: 'minutes', area: 'Hebrew', order: 9 };
  const d = doc({ items: [rp3, hebrewMinutes], milestones: [ms], journal: [talk] });
  const cursor = baseline(d);
  const after = doc({
    items: [rp3, hebrewMinutes],
    milestones: [{ ...ms, done: true }],
    journal: [{ ...talk, messages: [...talk.messages, { who: 'george', text: 'Better than RP2', at: at(THU, '19:00').toISOString() }] }],
    flags: [{ id: 'f1', text: 'The Coach said X', at: at(THU, '19:10').toISOString() }],
    logs: [amount(`hebrew:${THU}`, 'hebrew-minutes', THU, 12, { source: 'hebrew' })],
    calendar: { [`ask:${THU}:1`]: { text: 'Rework the weekend', day: THU, at: at(THU, '19:15').toISOString(), source: 'coach' } },
  });
  const { events } = sense({ doc: after, cursor, now: T1 });
  assert.deepEqual(events.map((e) => e.kind).sort(), ['ask', 'flag', 'hebrew', 'milestone', 'reply']);
  const e = Object.fromEntries(events.map((x) => [x.kind, x]));
  assert.equal(e.milestone.id, 'ms:m1');
  assert.equal(e.milestone.level, 2);
  assert.equal(e.reply.refs.talkId, `talk:${THU}:mind-1`);
  assert.equal(e.ask.id, `ask:ask:${THU}:1`);
  assert.equal(e.ask.level, 3);
  assert.match(e.ask.text, /Rework the weekend/);
});

test('plan risk: three overflows on one goal in a day, or work booked past its deadline', () => {
  const d = doc();
  const over = (id) => ({ id: `overflow:${id}:${FRI}`, kind: 'overflow', level: 1, day: THU, refs: { itemId: id, goalId: 'ac' } });
  assert.deepEqual(planRisk(d, [over('a'), over('b')], THU), []);
  const [risk] = planRisk(d, [over('a'), over('b'), over('c')], THU);
  assert.equal(risk.id, `risk:ac:${THU}`);
  assert.equal(risk.level, 3);
  assert.match(risk.text, /Smash Assessment Center/);
  // Work booked after the deadline it was asked for before — not work meant to come after it.
  const after = doc({ items: [rp3, star, { ...scen, date: '2026-10-07', title: 'Chase the verdict' }, book, chore, gym] });
  assert.deepEqual(planRisk(after, [], THU), []);
  const pushedPast = doc({ items: [rp3, star, { ...scen, date: '2026-10-04' }, book, chore, gym], calendar: { agenda: { from: THU, through: '2026-10-08', busy: [], blocks: [
    { key: 'k', start: at('2026-10-06', '11:00').toISOString(), end: at('2026-10-06', '12:00').toISOString(), items: ['scen'], title: 'x', calendar: 'Application', state: 'rough' },
  ] } } });
  const [late] = planRisk(pushedPast, [], THU);
  assert.equal(late.id, `risk:ac:${THU}`);
  assert.ok(late.facts.some((f) => /Scenario primer/.test(f) && /6 Oct/.test(f)));
});

test('overflow: the planner placing work later than it was asked for', () => {
  const blocks = (day) => ({ agenda: { from: THU, through: '2026-09-30', blocks: [
    { key: 'k', start: at(day, '11:00').toISOString(), end: at(day, '12:00').toISOString(), items: ['scen'], title: 'Scenario primer', calendar: 'Application', state: 'exact' },
  ], busy: [] } });
  const cursor = baseline(doc({ calendar: blocks(THU) }), [], at(THU, '08:00'));
  const [e] = sense({ doc: doc({ calendar: blocks(FRI) }), cursor, now: at(THU, '08:10') }).events;
  assert.equal(e.id, `overflow:scen:${FRI}`);
  assert.equal(e.by, 'planner');
  assert.equal(e.level, 1);
  assert.equal(e.refs.goalId, 'ac');
});
