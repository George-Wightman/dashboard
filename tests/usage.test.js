import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsage, deviceOf, tapName, errorName, usageId, usageByDevice, usageLines, USAGE_KEY, FLUSH_GAP_MS } from '../js/usage.js';
import { behaviourLines, usageRead } from '../claude/usage.js';
import { mergeDocs } from '../js/merge.js';
import { MemoryStorage, makeStore, clock, fixture } from './helpers.js';

// A stand-in for an element: closest() answers from a list of selector fragments.
const el = ({ tag = 'BUTTON', cls = '', type = '', use = '', inside = {} } = {}) => {
  const node = { tagName: tag, type, dataset: use ? { use } : {}, getAttribute: (n) => (n === 'class' ? cls : null) };
  node.closest = (sel) => {
    if (sel.startsWith('button')) return node;
    for (const [key, value] of Object.entries(inside)) if (sel.includes(key)) return value;
    return null;
  };
  return node;
};

test('a tap is named by where it is and what it is, never by its text', () => {
  assert.equal(tapName(el({ cls: 'tile-open', inside: { '[data-tile]': { dataset: { tile: 'hebrew' } } } })), 'tile-hebrew/tile-open');
  assert.equal(tapName(el({ cls: 'link sheet-close', inside: { 'dialog[id]': { id: 'widget-sheet' } } })), 'widget-sheet/sheet-close');
  assert.equal(tapName(el({ tag: 'INPUT', type: 'checkbox', inside: { '#timeline': {} } })), 'today/input-checkbox');
  assert.equal(tapName(el({ use: 'Save Check-in', inside: { '#timeline': {} } })), 'today/save-check-in');
  assert.equal(tapName(el({ cls: 'dl-btn' })), 'page/button');
  assert.equal(tapName({ closest: () => null }), null);
  assert.equal(tapName(null), null);
});

test('an error keeps its message short, with the file and line', () => {
  assert.equal(errorName('x is not a function', 'https://a.b/dashboard/js/ui/map.js?v=2', 41), 'x is not a function @map.js:41');
  assert.equal(errorName('a'.repeat(200)).length, 90);
});

test('the device gets a name once, and keeps it', () => {
  const storage = new MemoryStorage();
  const a = deviceOf(storage, { touch: true, newId: () => 'Ab12cd' });
  assert.deepEqual(a, { id: 'ab12cd', kind: 'phone' });
  assert.deepEqual(deviceOf(storage, { newId: () => 'zzzzzz' }), { id: 'ab12cd', kind: 'laptop' });
});

function setup() {
  const now = clock(new Date(2026, 10, 11, 9, 0));
  const storage = new MemoryStorage();
  const store = makeStore({ now });
  const usage = createUsage({ storage, device: { id: 'lap1', kind: 'laptop' }, today: () => store.today(), now: () => now().getTime() });
  return { now, storage, store, usage };
}

test('opens, minutes, taps and big views are counted on the day, and survive a reload', () => {
  const { now, storage, store, usage } = setup();
  usage.visible({ from: 'widget', hour: 9, size: { width: 400, height: 800 } });
  usage.visible({ hour: 9 }); // already in view: not another open
  usage.big('hebrew');
  usage.tap(el({ cls: 'tile-open', inside: { '[data-tile]': { dataset: { tile: 'hebrew' } } } }));
  now.advance(90 * 1000);
  usage.hidden();
  now.advance(10 * 1000);
  usage.visible({ hour: 9 }); // back within half a minute: the same visit
  now.advance(30 * 1000);
  usage.hidden();
  usage.synced({ ok: true, ms: 2400, kb: 2266 });
  usage.synced({ ok: false });
  usage.error('boom', 'js/app.js', 3);
  const again = createUsage({ storage, device: usage.device, today: () => store.today(), now: () => now().getTime() });
  const day = again.days()['2026-11-11'];
  assert.equal(day.opens, 1);
  assert.equal(day.sec, 120);
  assert.deepEqual(day.from, { widget: 1 });
  assert.deepEqual(day.hours, { '09': 1 });
  assert.deepEqual(day.big, { hebrew: 1 });
  assert.deepEqual(day.taps, { 'tile-hebrew/tile-open': 1 });
  assert.deepEqual(day.sync, { n: 2, fail: 1, ms: 2400, maxMs: 2400, kb: 2266 });
  assert.deepEqual(day.errors, { 'boom @app.js:3': 1 });
  assert.equal([day.w, day.h].join('x'), '400x800');
});

test('a flush writes one record a week, at most every three hours, and adds to what is there', () => {
  const { now, storage, store, usage } = setup();
  usage.visible({ hour: 9 });
  assert.equal(usage.flush(store), 1);
  const id = usageId('lap1', '2026-11-11');
  assert.equal(id, 'usage:lap1:2026-11-09');
  assert.equal(store.doc().calendar[id].days['2026-11-11'].opens, 1);
  assert.equal(store.doc().calendar[id].device, 'laptop');
  usage.big('map');
  assert.equal(usage.flush(store), 0, 'too soon');
  now.advance(FLUSH_GAP_MS + 1000);
  assert.equal(usage.flush(store, { extra: { tiles: { order: ['map'], hidden: ['london'] } } }), 1);
  assert.deepEqual(store.doc().calendar[id].days['2026-11-11'].big, { map: 1 });
  assert.deepEqual(store.doc().calendar[id].tiles.hidden, ['london']);
  assert.equal(usage.flush(store, { force: true }), 0, 'nothing new');
  // A cleared device keeps the days already in the document.
  storage.removeItem(USAGE_KEY);
  const fresh = createUsage({ storage, device: usage.device, today: () => '2026-11-12', now: () => now().getTime() });
  fresh.visible({ hour: 8 });
  fresh.flush(store, { force: true });
  assert.deepEqual(Object.keys(store.doc().calendar[id].days), ['2026-11-11', '2026-11-12']);
});

test('yesterday still waiting goes up at once, and last week leaves the device after it', () => {
  const { now, storage, store, usage } = setup();
  usage.visible({ hour: 9 });
  usage.flush(store);
  usage.big('fuel');
  now.advance(6 * 86400000); // Tuesday 17 Nov
  assert.equal(usage.flush(store), 1);
  assert.deepEqual(store.doc().calendar['usage:lap1:2026-11-09'].days['2026-11-11'].big, { fuel: 1 });
  assert.deepEqual(JSON.parse(storage.getItem(USAGE_KEY)).days, {});
});

test('the read says what each device did, and what was never opened', () => {
  const { store, usage } = setup();
  usage.visible({ from: 'widget', hour: 21, size: { width: 412, height: 915 } });
  usage.big('hebrew');
  usage.synced({ ok: true, ms: 3000, kb: 1500 });
  usage.flush(store, { extra: { tiles: { order: ['hebrew', 'london'], hidden: ['london'] } } });
  assert.equal(usageByDevice(store.doc(), '2026-11-11', 14).length, 1);
  const text = usageLines(store.doc(), '2026-11-11', 14, ['hebrew', 'map']).join('\n');
  assert.match(text, /^laptop \(lap1\): opened on 1 of 14 days · 1 opens · 0 min on screen/);
  assert.match(text, /opened at: 21h×1/);
  assert.match(text, /came from: widget 1/);
  assert.match(text, /opened big: hebrew 1/);
  assert.match(text, /never opened big: map/);
  assert.match(text, /hidden tiles: london/);
  assert.match(text, /sync: 1 runs, 0 failed · 3\.0 s on average/);
  assert.match(text, /errors: none/);
  assert.match(usageLines(store.doc(), '2026-10-01', 14).join('\n'), /^No usage recorded/);
});

test('what the records show: ticks, check-ins and meals as rates', () => {
  const d = fixture({
    logs: [
      { id: 'l1', kind: 'done', itemId: 'a', day: '2026-11-10', at: '2026-11-10T21:10:00.000Z' },
      { id: 'l2', kind: 'done', itemId: 'b', day: '2026-11-10', at: '2026-11-10T21:10:40.000Z' },
      { id: 'l3', kind: 'done', itemId: 'c', day: '2026-11-10', at: '2026-11-10T11:00:00.000Z', source: 'hevy' },
    ],
    journal: [
      { id: 'reflect:2026-11-10:a', kind: 'reflect', day: '2026-11-10', why: 'done', said: 'fine', answeredAt: '2026-11-10T21:11:00.000Z' },
      { id: 'reflect:2026-11-10:b', kind: 'reflect', day: '2026-11-10', why: 'missed', said: '', answeredAt: null },
    ],
  });
  d.meals.m1 = { id: 'm1', kind: 'meal', status: 'active', day: '2026-11-09', at: '2026-11-09T12:00:00.000Z', updated: '2026-11-10T20:00:00.000Z', state: 'pending' };
  const text = behaviourLines(d, '2026-11-11', 14).join('\n');
  assert.match(text, /^Ticks: 3 \(by hand 2 · hevy 1\)/);
  assert.match(text, /by hand: 2 of 2 after 20:00 · 1 within two minutes of another/);
  assert.match(text, /Check-ins: 2 asked · 1 answered \(50%\) · 0 skipped · 1 left unanswered/);
  assert.match(text, /after a tick: 1 of 1 answered · after a missed block: 0 of 1 answered/);
  assert.match(text, /Meals: 1 on 1 of 14 days · 1 logged more than 12 h after eating · 0 with a photo · 0 from a usual meal · 1 still waiting/);
  assert.match(text, /Never used \(no records\): rules, outcomes, reviews, workflowRuns/);
  assert.match(usageRead(d, '2026-11-11', '7'), /^The last 7 days\./);
});

test('usage records from two devices merge without touching each other', () => {
  const a = setup();
  const b = setup();
  const phone = createUsage({ storage: new MemoryStorage(), device: { id: 'ph1', kind: 'phone' }, today: () => b.store.today(), now: () => b.now().getTime() });
  a.usage.visible({ hour: 9 });
  a.usage.flush(a.store);
  phone.visible({ hour: 22 });
  phone.flush(b.store);
  const merged = mergeDocs(a.store.doc(), b.store.doc());
  assert.deepEqual(usageByDevice(merged, '2026-11-11').map((d) => d.kind), ['laptop', 'phone']);
});
