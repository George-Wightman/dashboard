import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore } from './helpers.js';
import { runOp } from '../claude/ops.js';
import { READS } from '../claude/read.js';
import { shifts, paySettings } from '../js/hours.js';

// Invented figures only. makeStore's clock is Thursday 10 Sep 2026.
const fresh = () => makeStore({ prefix: 'rec-' });

test('hours op: imports old shifts, skipping ones the planner already recorded', () => {
  const s = fresh();
  s.putCalendar('work:e2', { status: 'active', day: '2026-09-01', minutes: 120, title: '' });
  const out = runOp(s, { op: 'hours', shifts: [
    { eventId: 'e1', start: '2026-06-12T12:00:00Z', end: '2026-06-12T14:00:00Z', title: 'Signifi' },
    { eventId: 'e2', start: '2026-09-01T07:00:00Z', end: '2026-09-01T09:00:00Z' },
  ] });
  assert.match(out, /^Imported 1 shift \(1 already recorded by the planner\)/);
  assert.equal(s.doc().calendar['hours:e1'].minutes, 120);
  assert.equal(s.doc().calendar['hours:e2'], undefined);
  assert.equal(shifts(s.doc()).length, 2);
});

test('hours op: sets pay, records a payslip, counts an event in', () => {
  const s = fresh();
  assert.match(runOp(s, { op: 'hours', pay: { rate: 10, cutoff: 23 } }), /£10\.00 an hour \+ 12\.07% holiday, hours paid up to the 23rd · /);
  assert.deepEqual(paySettings(s.doc()), { rate: 10, holidayPct: 12.07, cutoff: 23 });
  assert.match(runOp(s, { op: 'hours', payslip: { period: '2026-08', paid: '2026-08-28', hours: 5, gross: 56.04, net: 56.04 } }), /Payslip for 2026-08: 5 h, £56\.04 paid/);
  assert.equal(s.doc().calendar['payslip:2026-08'].hours, 5);
  runOp(s, { op: 'hours', count: { eventId: 'x1', on: true } });
  assert.equal(s.doc().calendar['hours-count:x1'].count, true);
});

test('hours op: refuses two parts at once and bad shapes', () => {
  const s = fresh();
  assert.throws(() => runOp(s, { op: 'hours', pay: { rate: 1 }, count: { eventId: 'a', on: true } }), /exactly one/);
  assert.throws(() => runOp(s, { op: 'hours', payslip: { period: 'Aug', hours: 1, gross: 1, net: 1 } }), /YYYY-MM/);
  assert.throws(() => runOp(s, { op: 'hours', pay: { cutoff: 40 } }), /day of the month/);
});

test('hours read: pay, next pay and payslips against the calendar', () => {
  const s = fresh();
  runOp(s, { op: 'hours', pay: { rate: 10, cutoff: 23 } });
  runOp(s, { op: 'hours', shifts: [{ eventId: 'a', start: '2026-08-20T08:00:00Z', end: '2026-08-20T11:00:00Z' }] });
  runOp(s, { op: 'hours', payslip: { period: '2026-08', hours: 4, gross: 44.83, net: 44.83 } });
  const text = READS.hours(s.doc(), s.today());
  assert.match(text, /Pay: £10\.00 an hour/);
  assert.match(text, /2026-08 \(2026-07-24 to 2026-08-23\): paid 4 h, calendar 3 h \(\+1\)/);
  assert.match(text, /Next pay \(2026-09/);
});
