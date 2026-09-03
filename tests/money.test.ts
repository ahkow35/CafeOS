import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMoney, toMoneyOrNull, formatSGD } from '../src/lib/money';

test('toMoney converts pg NUMERIC strings', () => {
  assert.equal(toMoney('123.40'), 123.4);
  assert.equal(toMoney('0.00'), 0);
  assert.equal(toMoney(null), 0);
  assert.equal(toMoney(7), 7);
});

test('toMoneyOrNull keeps null', () => {
  assert.equal(toMoneyOrNull(null), null);
  assert.equal(toMoneyOrNull('5.50'), 5.5);
});

test('formatSGD', () => {
  assert.equal(formatSGD(1234.5), 'S$1,234.50');
  assert.equal(formatSGD(0), 'S$0.00');
});
