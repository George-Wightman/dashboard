import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatAmount, formatProgress } from '../js/parse.js';

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
