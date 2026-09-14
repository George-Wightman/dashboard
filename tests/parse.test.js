import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatAmount, formatProgress } from '../js/parse.js';
import { parseLength, parseClock, splitTaskInput, checkLength, checkClock } from '../js/parse.js';

test('parseAmount: counts', () => {
  assert.equal(parseAmount('1', 'count'), 1);
  assert.equal(parseAmount(' 3 ', 'count'), 3);
  assert.equal(parseAmount('2.5', 'count'), 2.5);
  assert.equal(parseAmount('0', 'count'), null);
  assert.equal(parseAmount('-2', 'count'), null);
  assert.equal(parseAmount('3m', 'count'), null);
  assert.equal(parseAmount('', 'count'), null);
});

test('parseAmount: minutes', () => {
  assert.equal(parseAmount('45m', 'minutes'), 45);
  assert.equal(parseAmount('45', 'minutes'), 45);
  assert.equal(parseAmount('1.5h', 'minutes'), 90);
  assert.equal(parseAmount('2h', 'minutes'), 120);
  assert.equal(parseAmount('1h30', 'minutes'), 90);
  assert.equal(parseAmount('1h 30m', 'minutes'), 90);
  assert.equal(parseAmount('0.5H', 'minutes'), 30);
  assert.equal(parseAmount('abc', 'minutes'), null);
  assert.equal(parseAmount('0m', 'minutes'), null);
  assert.equal(parseAmount('1h75', 'minutes'), null);
  assert.equal(parseAmount(null, 'minutes'), null);
});

test('formatAmount', () => {
  assert.equal(formatAmount(3, 'count'), '3');
  assert.equal(formatAmount(2.5, 'count'), '2.5');
  assert.equal(formatAmount(45, 'minutes'), '45m');
  assert.equal(formatAmount(60, 'minutes'), '1h');
  assert.equal(formatAmount(90, 'minutes'), '1.5h');
  assert.equal(formatAmount(100, 'minutes'), '1.7h');
  assert.equal(formatAmount(240, 'minutes'), '4h');
});

test('formatProgress', () => {
  assert.equal(formatProgress(3, 5, 'count'), '3 / 5');
  assert.equal(formatProgress(90, 240, 'minutes'), '1.5 / 4h');
  assert.equal(formatProgress(45, 240, 'minutes'), '0.8 / 4h');
  assert.equal(formatProgress(0, 240, 'minutes'), '0 / 4h');
});

test('parseLength: a length from 5 minutes to 12 hours', () => {
  assert.equal(parseLength('45m'), 45);
  assert.equal(parseLength('2h'), 120);
  assert.equal(parseLength('1h30'), 90);
  assert.equal(parseLength('1.5h'), 90);
  assert.equal(parseLength('90'), 90);
  assert.equal(parseLength('3m'), null);
  assert.equal(parseLength('13h'), null);
  assert.equal(parseLength('soon'), null);
});

test('parseClock: a time of day', () => {
  assert.equal(parseClock('14:00'), '14:00');
  assert.equal(parseClock('9:30'), '09:30');
  assert.equal(parseClock('24:00'), null);
  assert.equal(parseClock('9.30'), null);
});

test('splitTaskInput: a trailing length and time come off the title', () => {
  assert.deepEqual(splitTaskInput('Draft cover letter 2h'), { title: 'Draft cover letter', minutes: 120, time: null });
  assert.deepEqual(splitTaskInput('Call NatCen 14:00'), { title: 'Call NatCen', minutes: null, time: '14:00' });
  assert.deepEqual(splitTaskInput('Mock interview 14:00 1h'), { title: 'Mock interview', minutes: 60, time: '14:00' });
  assert.deepEqual(splitTaskInput('Read 20 pages'), { title: 'Read 20 pages', minutes: null, time: null });
  assert.deepEqual(splitTaskInput('2h'), { title: '2h', minutes: null, time: null }, 'a title keeps at least one word');
});

test('checkLength and checkClock: null for nothing, the value when right, a sentence when not', () => {
  assert.equal(checkLength(null), null);
  assert.equal(checkLength(''), null);
  assert.equal(checkLength(30), 30);
  assert.throws(() => checkLength(2.5), /A length should be from 5 minutes to 12 hours/);
  assert.equal(checkClock(null), null);
  assert.equal(checkClock('07:05'), '07:05');
  assert.throws(() => checkClock('7am'), /A time should look like 14:00/);
});
