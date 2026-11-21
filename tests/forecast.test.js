import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementSpend, statementSplit, agreedSettings, forecastSettings, forecastPresets, matchingPreset, withPreset, runForecast, hoursFor, monthlySpend, FORECAST_ID, WEEKS_A_MONTH } from '../js/forecast.js';
import { emptyMoney, START_ID, validMoney, mergeMoney } from '../js/money.js';
import { PAY_ID } from '../js/hours.js';
import { emptyDoc } from '../js/doc.js';
import { addDays } from '../js/dates.js';

// Invented figures only: this repo is public.
function ledger() {
  const m = emptyMoney();
  for (let d = '2026-08-01'; d <= '2026-10-31'; d = addDays(d, 1)) m.days[d] = { groceries: 1000, ...(d === '2026-09-10' ? { car: 90000 } : {}) };
  m.covered = [{ from: '2026-08-01', to: '2026-10-31' }];
  m.since = '2026-08-01';
  m.balances = [{ day: '2026-10-31', total: 200000 }];
  return m;
}
function doc() {
  const d = emptyDoc();
  d.calendar[PAY_ID] = { id: PAY_ID, status: 'active', rate: 10, holidayPct: 0, cutoff: 23 };
  d.calendar[START_ID] = { id: START_ID, status: 'active', day: '2027-02-01' };
  return d;
}

test('statementSpend: average a month, 5% over, up to £10; one-off categories left out', () => {
  const s = statementSpend(ledger());
  // £10 a day over 92 days is about £304 a month; 5% over and rounded up to £10 is £320.
  assert.equal(s.groceries, 32000);
  assert.equal(s.car, undefined);
});

test('forecastSettings: statements, then what Claude agreed, then his own changes', () => {
  const m = ledger();
  m.forecast = { hours: 8, spend: { groceries: 25000 }, flights: { count: 2, price: 8000 }, oneOffs: [{ id: 'gift', label: 'Birthday money', amount: 20000, month: '2027-01', on: true }] };
  assert.equal(validMoney(m), true);
  const d = doc();
  assert.equal(agreedSettings(m).spend.groceries, 25000);
  d.calendar[FORECAST_ID] = { id: FORECAST_ID, status: 'active', hours: 5, spend: { groceries: 20000 }, oneOffs: [{ id: 'gift', on: false, amount: 20000, month: '2027-01' }] };
  const s = forecastSettings(m, d);
  assert.equal(s.hours, 5);
  assert.equal(s.spend.groceries, 20000);
  assert.equal(s.flights.count, 2);
  assert.equal(s.oneOffs[0].on, false);
  assert.equal(s.oneOffs[0].label, 'Birthday money');
  d.calendar[FORECAST_ID].status = 'archived';
  assert.equal(forecastSettings(m, d).hours, 8);
});

test('runForecast: from the latest balance, pay at his hours, spending, flights and one-offs', () => {
  const m = ledger();
  const d = doc();
  const settings = { hours: 10, spend: { groceries: 30000 }, flights: { count: 3, price: 6000 }, oneOffs: [{ id: 'x', label: 'Car sale', amount: 50000, month: '2026-12', on: true }] };
  const f = runForecast({ money: m, doc: d, today: '2026-11-05', settings });
  assert.deepEqual(f.rows.map((r) => r.month), ['2026-10', '2026-11', '2026-12', '2027-01']);
  assert.equal(f.rows[0].spend, 6000 * 3 / 4); // October: no days left after the balance, a quarter of the flights
  // December's pay period runs 24 Nov – 23 Dec: 30 days at 10 h a week.
  assert.equal(f.rows[2].pay, Math.round((10 / 7) * 30 * 10 * 100));
  assert.equal(f.rows[2].oneOff, 50000);
  const total = f.rows.reduce((t, r) => t + r.pay - r.spend + r.oneOff, 0);
  assert.equal(f.end, 200000 + total);
  assert.equal(f.lowest.pot, Math.min(...f.rows.map((r) => r.pot)));
  assert.equal(monthlySpend(settings), 30000);
});

test('hoursFor: the hours a week that end on a target, and more spending needs more hours', () => {
  const m = ledger();
  const d = doc();
  const settings = { hours: 0, spend: { groceries: 30000 }, flights: { count: 0, price: 8000 }, oneOffs: [] };
  const h = hoursFor({ money: m, doc: d, today: '2026-11-05', settings, target: 200000 });
  const f = runForecast({ money: m, doc: d, today: '2026-11-05', settings, hours: h });
  assert.ok(Math.abs(f.end - 200000) < 100);
  const more = hoursFor({ money: m, doc: d, today: '2026-11-05', settings: { ...settings, spend: { groceries: 40000 } }, target: 200000 });
  assert.ok(more > h);
});

test('mergeMoney: forecast is replaced whole by an import, cleared by null, and checked', () => {
  const m = mergeMoney(ledger(), { forecast: { hours: 9 } });
  assert.equal(m.forecast.hours, 9);
  assert.equal(mergeMoney(m, { forecast: null }).forecast, undefined);
  assert.equal(validMoney({ ...m, forecast: { spend: { casino: 100 } } }), false);
  assert.equal(validMoney({ ...m, forecast: { oneOffs: [{ id: 'a', label: 'A', amount: 1, month: 'Dec', on: true }] } }), false);
});

test('runForecast: days marked in the EU cost the Salzburg rate, the rest the home rate', () => {
  const m = ledger();
  const d = doc();
  for (let day = '2026-12-01'; day <= '2026-12-31'; day = addDays(day, 1)) d.calendar[`eu:${day}`] = { id: `eu:${day}`, status: 'active', day };
  const settings = { hours: 0, spend: { groceries: 31000 }, away: { groceries: 15500 }, flights: { count: 0, price: 8000 }, oneOffs: [] };
  const f = runForecast({ money: m, doc: d, today: '2026-11-05', settings });
  const dec = f.rows.find((r) => r.month === '2026-12');
  assert.equal(dec.spend, 15500);
  assert.equal(dec.awayDays, 31);
  assert.equal(f.rows.find((r) => r.month === '2027-01').spend, 31000);
  // Without an away rate, Salzburg costs the same as home.
  const same = runForecast({ money: m, doc: d, today: '2026-11-05', settings: { ...settings, away: undefined } });
  assert.equal(same.rows.find((r) => r.month === '2026-12').spend, 31000);
});

test('statementSplit and presets: exact averages at home and away, Claude\'s presets over the agreed figures', () => {
  const m = ledger();
  const d = doc();
  // October in Salzburg, at £20 a day instead of £10.
  for (let day = '2026-10-01'; day <= '2026-10-31'; day = addDays(day, 1)) { d.calendar[`eu:${day}`] = { id: `eu:${day}`, status: 'active', day }; m.days[day] = { groceries: 2000 }; }
  const split = statementSplit(m, d);
  assert.equal(split.awayDays, 31);
  assert.equal(split.home.groceries, Math.round(1000 * 365.25 / 12));
  assert.equal(split.away.groceries, Math.round(2000 * 365.25 / 12));
  m.forecast = { hours: 6, oneOffs: [{ id: 'car', label: 'Car sale', amount: 100000, month: '2027-01', on: false }],
    presets: [{ id: 'plan', label: 'Plan', hours: 9, spend: { groceries: 25000 }, oneOffs: [{ id: 'car', on: true }] }] };
  assert.equal(validMoney(m), true);
  const presets = forecastPresets(m, d);
  assert.deepEqual(presets.map((p) => p.id), ['agreed', 'averages', 'plan']);
  const plan = presets[2];
  assert.deepEqual(plan.spend, { groceries: 25000 });
  assert.deepEqual(plan.away, { groceries: 25000 });
  assert.equal(presets[1].away.groceries, Math.round(split.away.groceries / 500) * 500); // to the nearest £5
  // A preset swaps spending only: his hours, flights and one-offs stay.
  const mine = { ...forecastSettings(m, d), hours: 12.5, flights: { count: 4, price: 9000 } };
  const applied = withPreset(mine, plan);
  assert.equal(applied.hours, 12.5);
  assert.deepEqual(applied.flights, { count: 4, price: 9000 });
  assert.equal(applied.oneOffs[0].on, false);
  assert.deepEqual(applied.spend, { groceries: 25000 });
  assert.equal(matchingPreset(forecastSettings(m, d), presets).id, 'agreed');
  assert.equal(matchingPreset(applied, presets).id, 'plan');
  assert.equal(matchingPreset({ ...applied, hours: 3 }, presets).id, 'plan');
  assert.equal(matchingPreset({ ...applied, spend: { groceries: 26000 } }, presets), null);
  // A preset may only change agreed one-offs, and can't take the built-in ids.
  assert.equal(validMoney({ ...m, forecast: { ...m.forecast, presets: [{ id: 'p', label: 'P', oneOffs: [{ id: 'nope', on: true }] }] } }), false);
  assert.equal(validMoney({ ...m, forecast: { ...m.forecast, presets: [{ id: 'agreed', label: 'P' }] } }), false);
  assert.equal(validMoney({ ...m, forecast: { ...m.forecast, away: { casino: 5 } } }), false);
});

test('averages leave flights out of Trips: the Flights setting counts them', () => {
  const m = ledger();
  const d = doc();
  const day = Object.keys(m.days).filter((x) => x >= m.since).sort()[3];
  m.days[day] = { ...m.days[day], trips: 12000 };
  m.places = { ...(m.places ?? {}), [day]: { trips: { Ryanair: 9000, Trainline: 3000 } } };
  const split = statementSplit(m, d);
  const days = split.homeDays + split.awayDays;
  assert.equal(split.home.trips, Math.round((3000 / days) * 365.25 / 12));
  const presets = forecastPresets(m, d);
  assert.equal(presets[1].spend.trips % 500, 0);
});
