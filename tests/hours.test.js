import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isShiftTitle, payPeriodOf, paydayOf, shifts, hoursSummary, payForecast, netRatio, countId, UPCOMING_ID, PAY_ID, payslipId } from '../js/hours.js';
import { emptyDoc } from '../js/doc.js';

// Invented figures only: this repo is public.
const shift = (eventId, day, hours, title = '', prefix = 'work') => ({
  id: `${prefix}:${eventId}`, status: 'active', day, start: `${day}T09:00:00.000Z`, end: `${day}T${String(9 + hours).padStart(2, '0')}:00:00.000Z`, minutes: hours * 60, title,
});
function docWith(...recs) {
  const doc = emptyDoc();
  for (const r of recs) doc.calendar[r.id] = r;
  return doc;
}
const pay = { id: PAY_ID, status: 'active', rate: 10, holidayPct: 12.07, cutoff: 23 };

test('isShiftTitle: untitled and every spelling of Signify count; an interview does not', () => {
  for (const t of ['', '  ', 'Signify', 'Signifi', 'signifi', 'Singify', 'Shift']) assert.equal(isShiftTitle(t), true, t);
  for (const t of ['Interview : Pre-Training Assessment', 'Dentist', 'Gym']) assert.equal(isShiftTitle(t), false, t);
});

test('payPeriodOf: the cut-off day is in its own month, the day after in the next', () => {
  assert.equal(payPeriodOf('2026-10-23', 23), '2026-10');
  assert.equal(payPeriodOf('2026-10-24', 23), '2026-11');
  assert.equal(payPeriodOf('2026-12-30', 23), '2027-01');
});

test('paydayOf: the last weekday of the month', () => {
  assert.equal(paydayOf('2026-10'), '2026-10-30'); // 31 Oct 2026 is a Saturday
  assert.equal(paydayOf('2026-09'), '2026-09-30');
});

test('shifts: a work: record wins over an imported hours: one for the same event', () => {
  const doc = docWith(shift('e1', '2026-10-01', 2), shift('e1', '2026-10-01', 5, '', 'hours'), shift('e2', '2026-06-01', 3, 'Signifi', 'hours'));
  const list = shifts(doc);
  assert.equal(list.length, 2);
  assert.equal(list.find((s) => s.eventId === 'e1').minutes, 120);
  assert.equal(list.find((s) => s.eventId === 'e1').source, 'work');
});

test('shifts: an override counts an interview in, or a shift out', () => {
  const doc = docWith(shift('i1', '2026-10-09', 2, 'Interview : London'), shift('s1', '2026-10-10', 2));
  assert.equal(shifts(doc).find((s) => s.eventId === 'i1').counted, false);
  doc.calendar[countId('i1')] = { id: countId('i1'), status: 'active', count: true };
  doc.calendar[countId('s1')] = { id: countId('s1'), status: 'active', count: false };
  const list = shifts(doc);
  assert.equal(list.find((s) => s.eventId === 'i1').counted, true);
  assert.equal(list.find((s) => s.eventId === 's1').counted, false);
});

test('shifts: booked shifts ahead come from the planner list, without doubling a recorded one', () => {
  const doc = docWith(shift('a', '2026-11-03', 2), {
    id: UPCOMING_ID, status: 'active',
    list: [{ eventId: 'a', day: '2026-11-03', minutes: 120 }, { eventId: 'b', day: '2026-11-10', minutes: 180, title: '' }],
  });
  const list = shifts(doc);
  assert.equal(list.length, 2);
  assert.equal(list.find((s) => s.eventId === 'b').source, 'upcoming');
});

test('hoursSummary: expected pay is hours × rate plus holiday, for the first unpaid period', () => {
  const doc = docWith(pay, shift('a', '2026-10-20', 3), shift('b', '2026-10-24', 4), shift('c', '2026-11-02', 2));
  doc.calendar[payslipId('2026-10')] = { id: payslipId('2026-10'), status: 'active', period: '2026-10', paid: '2026-10-30', hours: 3, gross: 33.62, net: 33.62 };
  const s = hoursSummary(doc, '2026-11-05');
  assert.equal(s.period, '2026-11');
  assert.equal(s.periodHours, 6);
  assert.equal(s.expected.period, '2026-11');
  assert.equal(s.expected.hours, 6);
  assert.equal(s.expected.gross, 67.24); // 6 × 10 × 1.1207
  assert.equal(s.expected.net, 67.24);
  assert.equal(s.expected.payday, '2026-11-30');
  assert.equal(s.slips[0].calendarHours, 3);
  assert.equal(s.slips[0].diff, 0);
});

test('hoursSummary: the payslip difference is paid hours less calendar hours', () => {
  const doc = docWith(pay, shift('a', '2026-10-05', 2));
  doc.calendar[payslipId('2026-10')] = { id: payslipId('2026-10'), status: 'active', period: '2026-10', hours: 6, gross: 0, net: 0 };
  assert.equal(hoursSummary(doc, '2026-11-01').slips[0].diff, 4);
});

test('hoursSummary: no rate yet means no money figures, not NaN', () => {
  const s = hoursSummary(docWith(shift('a', '2026-11-02', 2)), '2026-11-05');
  assert.equal(s.expected.gross, null);
  assert.equal(s.expected.net, null);
  assert.equal(s.weeklyAverage, 0);
});

test('netRatio: whole pay unless a recent payslip took tax', () => {
  assert.equal(netRatio([{ gross: 100, net: 100, tax: 0, ni: 0 }]), 1);
  assert.equal(netRatio([{ gross: 100, net: 80, tax: 20, ni: 0 }, { gross: 100, net: 100, tax: 0, ni: 0 }]), 0.9);
});

test('payForecast: booked hours plus the weekly average for the days not yet booked', () => {
  const recs = [pay];
  // Eight full weeks of 7 h before the week of 2 Nov 2026.
  for (let w = 1; w <= 8; w++) recs.push(shift(`p${w}`, new Date(Date.UTC(2026, 10, 2 - 7 * w)).toISOString().slice(0, 10), 7));
  recs.push({ id: UPCOMING_ID, status: 'active', list: [{ eventId: 'u1', day: '2026-11-10', minutes: 240 }] });
  const doc = docWith(...recs);
  const f = payForecast(doc, '2026-11-05', '2026-12', '2026-12');
  // December's period is 24 Nov to 23 Dec: nothing booked, 30 days at 7 h a week = 30 h.
  assert.equal(f['2026-12'].booked, 0);
  assert.equal(f['2026-12'].guessed, 30);
  assert.equal(f['2026-12'].net, 336.21); // 30 × 10 × 1.1207
});
