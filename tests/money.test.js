import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validMoney, emptyMoney, monthActuals, averageSpend, potForecast, compare, mergeMoney, startDay, moneySummary, gbp, START_ID, inOut } from '../js/money.js';
import { emptyDoc } from '../js/doc.js';
import { addDays } from '../js/dates.js';

// An invented ledger: £10 a day on groceries through Aug–Oct 2026, £5 a day eating out in October.
function ledger() {
  const m = emptyMoney();
  for (let d = '2026-08-01'; d <= '2026-10-31'; d = addDays(d, 1)) {
    m.days[d] = { groceries: 1000, ...(d >= '2026-10-01' ? { 'eating-out': 500 } : {}) };
  }
  m.covered = [{ from: '2026-08-01', to: '2026-10-31' }];
  m.income = [{ day: '2026-09-30', amount: 50000, kind: 'pay' }, { day: '2026-10-30', amount: 40000, kind: 'pay' }, { day: '2026-10-15', amount: 20000, kind: 'refund', oneOff: true }];
  m.balances = [{ day: '2026-10-31', total: 300000 }];
  return m;
}

test('validMoney: a good ledger passes, an unknown category or a fraction of a penny fails', () => {
  assert.equal(validMoney(ledger()), true);
  const bad = ledger(); bad.days['2026-08-01'].casino = 100;
  assert.equal(validMoney(bad), false);
  const frac = ledger(); frac.days['2026-08-01'].groceries = 10.5;
  assert.equal(validMoney(frac), false);
});

test('monthActuals: spending by category, with a one-off refund kept apart from income', () => {
  const a = monthActuals(ledger(), '2026-10');
  assert.equal(a.spend.groceries, 31000);
  assert.equal(a.spend['eating-out'], 15500);
  assert.equal(a.income, 40000);
  assert.equal(a.oneOff, 20000);
  assert.equal(a.full, true);
});

test('averageSpend: over the last fully covered months before this one', () => {
  const avg = averageSpend(ledger(), '2026-11-05');
  assert.equal(avg.months, 3);
  assert.equal(avg.spend.groceries, Math.round((31000 + 30000 + 31000) / 3));
  assert.equal(avg.spend['eating-out'], Math.round(15500 / 3));
});

test('potForecast: starts at the latest balance and steps month by month to the start date', () => {
  const doc = emptyDoc();
  doc.calendar[START_ID] = { id: START_ID, status: 'active', day: '2027-01-01' };
  const f = potForecast({ money: ledger(), doc, today: '2026-11-05' });
  assert.deepEqual(f.rows.map((r) => r.month), ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
  assert.equal(f.rows[0].pot, null);
  assert.equal(f.rows[2].pot, 300000); // the balance is the October close
  const avg = averageSpend(ledger(), '2026-11-05').total;
  // No pay rate set, so no income ahead: the pot falls by the average each month.
  assert.equal(f.rows[3].pot, 300000 - avg);
  assert.equal(f.atStart, 300000 - 2 * avg);
});

test('potForecast: a plan line lands in its month', () => {
  const doc = emptyDoc();
  doc.calendar[START_ID] = { id: START_ID, status: 'active', day: '2027-01-01' };
  const m = ledger();
  m.plan = [{ month: '2026-12', label: 'Flight', amount: 12000, kind: 'spend', cat: 'trips' }];
  const avg = averageSpend(m, '2026-11-05').total;
  assert.equal(potForecast({ money: m, doc, today: '2026-11-05' }).atStart, 300000 - 2 * avg - 12000);
});

test('compare: EU days against the rest, per week', () => {
  const doc = emptyDoc();
  for (let d = '2026-10-11'; d <= '2026-10-19'; d = addDays(d, 1)) doc.calendar[`eu:${d}`] = { id: `eu:${d}`, status: 'active', day: d };
  const c = compare(ledger(), doc, { eu: true });
  assert.equal(c.a.days, 9);
  assert.equal(c.a.perWeek.groceries, 7000);
  assert.equal(c.a.perWeek['eating-out'], 3500);
  assert.equal(c.b.days, 92 - 9);
});

test('mergeMoney: days replace, covered stretches join, a zero plan line is removed', () => {
  const base = ledger();
  base.plan = [{ month: '2026-12', label: 'Flight', amount: 12000, kind: 'spend' }];
  const out = mergeMoney(base, { days: { '2026-11-01': { groceries: 200 } }, covered: [{ from: '2026-11-01', to: '2026-11-04' }], plan: [{ month: '2026-12', label: 'Flight', amount: 0, kind: 'spend' }] });
  assert.deepEqual(out.covered, [{ from: '2026-08-01', to: '2026-11-04' }]);
  assert.equal(out.days['2026-11-01'].groceries, 200);
  assert.equal(out.plan.length, 0);
  assert.equal(validMoney(out), true);
});

test('startDay and the summary with no ledger yet: nothing is NaN', () => {
  assert.equal(startDay(emptyDoc()), '2027-05-01');
  const s = moneySummary(null, emptyDoc(), '2026-11-05');
  assert.equal(s.atStart, null);
  assert.equal(s.spent, null);
  assert.equal(gbp(s.atStart), '—');
  assert.equal(gbp(123456), '£1,235');
  assert.equal(gbp(-500, { pennies: true }), '−£5.00');
});

test('inOut: month by month from `since`, one-offs apart, and the pot either side', () => {
  const m = ledger();
  m.since = '2026-09-01';
  m.balances = [{ day: '2026-08-31', total: 100000 }, { day: '2026-10-31', total: 120000 }];
  const r = inOut(m);
  assert.equal(r.from, '2026-09-01');
  assert.deepEqual(r.rows.map((x) => x.month), ['2026-09', '2026-10']);
  const oct = r.rows[1];
  assert.equal(oct.spend, 31000 + 15500);
  assert.equal(oct.regular, 40000);
  assert.equal(oct.oneOff, 20000);
  assert.equal(oct.net, 60000 - 46500);
  assert.equal(oct.netRegular, 40000 - 46500);
  assert.equal(r.totals.spend, 30000 + 46500);
  assert.equal(r.totals.net, 110000 - 76500);
  assert.equal(r.base.total, 100000);
  assert.equal(r.now.total, 120000);
  // The pot rose £200 but £335 came in net: £135 went somewhere that isn't spending.
  assert.equal(r.outside, 20000 - 33500);
});

test('inOut: without `since` it counts from the first statement day, and no balance means no pot', () => {
  const m = ledger();
  m.balances = [];
  const r = inOut(m);
  assert.equal(r.from, '2026-08-01');
  assert.equal(r.rows.length, 3);
  assert.equal(r.base, null);
  assert.equal(r.outside, null);
  assert.equal(inOut(emptyMoney()), null);
});

test('mergeMoney: `since` is set by an import, cleared by an empty one, and checked', () => {
  const a = mergeMoney(ledger(), { since: '2026-09-01' });
  assert.equal(a.since, '2026-09-01');
  assert.equal(mergeMoney(a, {}).since, '2026-09-01');
  assert.equal(mergeMoney(a, { since: null }).since, undefined);
  assert.equal(validMoney({ ...a, since: 'May' }), false);
});
