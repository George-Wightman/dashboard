import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlanner } from '../planner/gas.js';
import { installShims } from '../planner/shims.js';
import { tagPrompt, readArea } from '../planner/tag.js';
import { at } from '../planner/time.js';
import { CALENDAR_DEFAULTS } from '../js/calendar.js';
import { fixture } from './helpers.js';
import { FakeCalendar, ev, MAIN, GYM, WORK } from './planner-fakes.js';
import { FakeRepo, fakeUtilities, appsScript } from './planner-apps.js';

process.env.TZ = 'Europe/London';

const TUE = '2026-09-15';
const TOKEN = 'ghp_dummy_token_1234567890';
const KEYS = { GITHUB_TOKEN: TOKEN, SYNC_REPO: 'o/r' };

function setup({ props = KEYS, items, clock = at(TUE, '08:00'), calendarConfig, ...rest } = {}) {
  const doc = fixture({ items: items ?? [
    { id: 'hebrew', type: 'habit', title: 'Hebrew - app plus Duolingo', area: 'Hebrew', repeat: { kind: 'daily' } },
    { id: 'chase', type: 'task', title: 'Chase the GSS outcome', area: 'Job search', date: TUE, order: 1 },
    { id: 'dayout', type: 'task', title: 'Write the day out', area: 'Assessment centre', date: TUE, minutes: 60, order: 2 },
  ] });
  const cal = new FakeCalendar([
    ev(MAIN, 'Learn Hebrew', TUE, '09:30', '10:15'),
    ev(GYM, 'Gym', TUE, '11:00', '13:00'),
    ev(WORK, 'Signify', TUE, '14:00', '16:00'),
  ]);
  if (calendarConfig) doc.calendar = { ...(doc.calendar ?? {}), config: { ...CALENDAR_DEFAULTS, ...calendarConfig, status: 'active', id: 'config' } };
  const repo = new FakeRepo(doc);
  let t = clock;
  const env = appsScript({ cal, repo, props, now: () => t, ...rest });
  const planner = createPlanner({ ...env, version: 'test1' });
  return { cal, repo, env, planner, setNow: (d) => { t = d; } };
}

test('shims: browser globals over Apps Script, and only where missing', async () => {
  const repo = new FakeRepo({ schema: 1, items: {} });
  const env = appsScript({ cal: new FakeCalendar(), repo });
  const g = {};
  installShims(g, { Utilities: fakeUtilities, UrlFetchApp: env.UrlFetchApp });
  assert.equal(new g.TextDecoder().decode(new g.TextEncoder().encode('Ünïcødé ✓')), 'Ünïcødé ✓');
  const binary = String.fromCharCode(0, 127, 128, 255);
  assert.equal(g.atob(g.btoa(binary)), binary);
  assert.deepEqual(g.structuredClone({ a: [1, { b: 2 }] }), { a: [1, { b: 2 }] });
  assert.match(g.crypto.randomUUID(), /^uuid-\d+$/);
  const res = await g.fetch('https://api.github.com/repos/o/r/contents/data.json', { headers: { Authorization: 'Bearer x' } });
  assert.equal(res.ok, true);
  assert.equal((await res.json()).sha, 'sha1');
  const own = () => 'mine';
  const h = { fetch: own };
  installShims(h, { Utilities: fakeUtilities, UrlFetchApp: env.UrlFetchApp });
  assert.equal(h.fetch, own);
});

test('tagPrompt and readArea: one of the areas, exactly, or none', () => {
  const { system, prompt } = tagPrompt('Email NatCen', ['Hebrew', 'Job search']);
  assert.match(system, /Answer only with JSON/);
  assert.equal(prompt, 'Areas: "Hebrew", "Job search"\nTo-do: "Email NatCen"');
  assert.equal(readArea({ area: 'job search' }, ['Hebrew', 'Job search']), 'Job search');
  assert.equal(readArea({ area: 'Cooking' }, ['Hebrew', 'Job search']), '');
  assert.equal(readArea(null, ['Hebrew']), '');
});

test('run: books the calendar, keeps its memory, and writes its records to the dashboard', async () => {
  const { cal, repo, env, planner } = setup();
  assert.equal(await planner.run(), 'ok');
  assert.equal(cal.mine().length, 2);
  const doc = repo.doc();
  assert.equal(doc.calendar['day:2'].day, TUE);
  assert.equal(doc.calendar['day:2'].blocks.length, 2);
  assert.ok(doc.calendar['day:2'].blocks.every((b) => b.eventId));
  assert.equal(doc.calendar.status.version, 'test1');
  assert.equal(doc.calendar.status.lastError, null);
  assert.equal(doc.calendar.config.source, 'planner');
  assert.equal(JSON.parse(env.props.get('DAYS'))[TUE].blocks.length, 2);
  assert.equal(repo.puts, 1);
});

test('run again: nothing to change, nothing pushed — until the hourly heartbeat', async () => {
  const { cal, repo, planner, setNow } = setup();
  await planner.run();
  const events = cal.all().length;
  assert.equal(await planner.run(), 'ok');
  assert.equal(cal.all().length, events);
  assert.equal(repo.puts, 1);
  setNow(at(TUE, '09:05'));
  await planner.run();
  assert.equal(repo.puts, 2);
  assert.equal(repo.doc().calendar.status.lastRun, at(TUE, '09:05').toISOString());
});

test('paused, busy, and its own echo', async () => {
  assert.equal(await setup({ props: { ...KEYS, PAUSED: '1' } }).planner.run(), 'paused');
  assert.equal(await setup({ lockFree: false }).planner.run(), 'busy');
  const { planner, env } = setup({ props: { ...KEYS, LAST_WRITE: String(at(TUE, '07:59').getTime()) } });
  assert.equal(await planner.run({ calendarId: WORK }), 'echo');
  assert.equal(await planner.run(), 'ok');
  assert.ok(env.props.get('LAST_WRITE'));
});

test('a failure is kept for the dashboard, with the key scrubbed', async () => {
  const none = setup({ props: {} });
  assert.equal(await none.planner.run(), 'failed');
  assert.match(none.env.props.get('LAST_ERROR'), /needs GITHUB_TOKEN and SYNC_REPO/);
  const leaky = setup();
  const planner = createPlanner({ ...leaky.env, fetch: async () => { throw new Error(`boom ${TOKEN}`); } });
  assert.equal(await planner.run(), 'failed');
  assert.doesNotMatch(leaky.env.props.get('LAST_ERROR'), /ghp_dummy/);
  assert.ok(leaky.env.lines.every((l) => !l.includes(TOKEN)));
  const next = setup({ props: { ...KEYS, LAST_ERROR: 'GitHub was down' } });
  await next.planner.run();
  assert.equal(next.repo.doc().calendar.status.lastError, 'GitHub was down');
});

test('a calendar change that fails is reported, and the rest still happen', async () => {
  const { cal, repo, planner } = setup();
  cal.fail = 'insert';
  assert.equal(await planner.run(), 'partly');
  assert.equal(cal.mine().length, 1);
  assert.match(repo.doc().calendar.status.lastError, /^1 calendar change failed — first: insert ".*": Rate Limit Exceeded$/);
});

test('install: every 10 minutes and on calendar changes, then a first run', async () => {
  const { env, planner } = setup({ failTriggers: [WORK] });
  const text = await planner.install();
  assert.match(text, /^Installed: the planner runs every 10 minutes\. Couldn't watch Work for changes — the 10-minute run covers them\. First run: ok\.$/);
  assert.deepEqual(env.triggers.map((t) => t.everyMinutes ?? t.calendar), [10, 'georgewight03@gmail.com', 'application@group', 'gym@group']);
  await planner.install();
  assert.equal(env.triggers.filter((t) => t.everyMinutes).length, 1, 'installing again replaces the triggers');
});

test('removeAll: every future block the planner made goes, and it pauses', async () => {
  const { cal, env, planner } = setup();
  await planner.run();
  const text = await planner.removeAll();
  assert.equal(text, 'Removed 2 planned blocks and paused the planner. Run resume() to start again.');
  assert.equal(cal.mine().length, 0);
  assert.equal(cal.all().length, 3);
  assert.equal(env.props.get('PAUSED'), '1');
  assert.equal(env.props.get('DAYS'), undefined);
  assert.match(await planner.resume(), /^Resumed\. First run: ok\.$/);
});

test('tagging: an untagged task gets an area from Gemini, asked once', async () => {
  let asked = 0;
  const gemini = () => { asked++; return { status: 200, body: { candidates: [{ content: { parts: [{ text: '{"area": "Job search"}' }] } }] } }; };
  const items = [
    { id: 'chase', type: 'task', title: 'Chase the GSS outcome', area: 'Job search', date: TUE, order: 1 },
    { id: 'natcen', type: 'task', title: 'Email NatCen about the deadline', area: '', date: TUE, order: 2 },
  ];
  const { repo, env, planner } = setup({ props: { ...KEYS, GEMINI_KEY: 'gm-dummy-key' }, items, gemini });
  await planner.run();
  assert.equal(repo.doc().items.natcen.area, 'Job search');
  assert.equal(asked, 1);
  assert.deepEqual(JSON.parse(env.props.get('TAGGED')), { natcen: 'Job search' });
  await planner.run();
  assert.equal(asked, 1);
  assert.ok(env.calls.every((c) => !c.url.includes('gm-dummy') || c.url.startsWith('https://generativelanguage.googleapis.com/')));
});

test('with a fortnight horizon the near week keeps its records, and the far week cannot clobber them', async () => {
  // Day records are keyed by weekday (day:1 … day:7), so a 14-day plan writes two dates into every
  // slot and the second week used to win — leaving the app, the Coach and Claude reading an empty
  // calendar for the days that actually matter.
  const items = [
    { id: 'daily', type: 'habit', title: 'Read ten pages', area: 'Reading', repeat: { kind: 'daily' } },
  ];
  const { repo, planner } = setup({ items, calendarConfig: { days: 14 } });
  assert.equal(await planner.run(), 'ok');
  const doc = repo.doc();
  const slots = Object.keys(doc.calendar).filter((k) => k.startsWith('day:'));
  const dates = slots.map((k) => doc.calendar[k].day).sort();
  assert.equal(new Set(dates).size, dates.length, 'no two records share a weekday slot');
  for (const d of dates) assert.ok(d >= TUE && d < '2026-09-22', `${d} is inside the seven days the app reads`);
  assert.equal(doc.calendar['day:2'].day, TUE, "today's own record survives the run");
});
