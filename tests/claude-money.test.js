import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importMoney, readMoney, moneyLines } from '../claude/money.js';
import { emptyDoc } from '../js/doc.js';

// A file store in memory, like claude/files.js's.
const fakeFiles = () => {
  const files = new Map();
  return { files, async read(p) { return files.has(p) ? { text: files.get(p) } : null; }, async write(p, text) { files.set(p, text); } };
};
const statement = (from, to, perDay) => {
  const days = {};
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) days[d.toISOString().slice(0, 10)] = { groceries: perDay };
  return JSON.stringify({ days, covered: [{ from, to }], income: [], balances: [{ day: to, total: 100000 }] });
};

test('money-import: merges statements into money.json and refuses a malformed one', async () => {
  const f = fakeFiles();
  assert.match(await importMoney(f, statement('2026-09-01', '2026-09-30', 1000)), /30 days of spending.*covered up to 2026-09-30/);
  assert.match(await importMoney(f, statement('2026-10-01', '2026-10-31', 500)), /covered up to 2026-10-31/);
  const m = await readMoney(f);
  assert.deepEqual(m.covered, [{ from: '2026-09-01', to: '2026-10-31' }]);
  await assert.rejects(importMoney(f, JSON.stringify({ days: { '2026-11-01': { casino: 5 } } })), /doesn't fit money.json/);
  await assert.rejects(importMoney(f, 'not json'), /needs a JSON file/);
});

test('money read: the pot at the start and the months, or how to begin', async () => {
  const f = fakeFiles();
  assert.match(moneyLines(null, emptyDoc(), '2026-11-05').join('\n'), /No ledger yet/);
  await importMoney(f, statement('2026-08-01', '2026-10-31', 1000));
  const text = moneyLines(await readMoney(f), emptyDoc(), '2026-11-05').join('\n');
  assert.match(text, /Start date in London: 2027-05-01/);
  // With a balance there's a forecast, and it is "what he'll have"; the plain average is only a cross-check.
  assert.match(text, /Forecast to the start/);
  assert.doesNotMatch(text, /what he'll have at the start: /);
  assert.match(text, /Month by month at the plain average, as a cross-check/);
  assert.match(text, /Average month \(last 3 full\)/);
  assert.match(text, /~2026-11:/);
  // With no balance there's no forecast, and the plain average says what he'll have.
  const noBalance = { ...(await readMoney(f)), balances: [] };
  assert.match(moneyLines(noBalance, emptyDoc(), '2026-11-05').join('\n'), /what he'll have at the start: /);
});

test('London starts from where his Money forecast ends', async () => {
  const { startingPot } = await import('../js/ui/london.js');
  const { runForecast, forecastSettings } = await import('../js/forecast.js');
  const { moneySummary } = await import('../js/money.js');
  const f = fakeFiles();
  await importMoney(f, statement('2026-08-01', '2026-10-31', 1000));
  const m = await readMoney(f);
  const doc = emptyDoc();
  assert.equal(startingPot(m, doc, '2026-11-05'), runForecast({ money: m, doc, today: '2026-11-05', settings: forecastSettings(m, doc) }).end);
  assert.equal(startingPot({ ...m, balances: [] }, doc, '2026-11-05'), moneySummary({ ...m, balances: [] }, doc, '2026-11-05').atStart);
  assert.equal(startingPot(null, doc, '2026-11-05'), null);
});
