import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, ValidationError } from '../src/lib/validators';

test('parseMoney accepts whole and 2dp amounts as string or number', () => {
  assert.equal(parseMoney('12', 'Amount'), 12);
  assert.equal(parseMoney('12.5', 'Amount'), 12.5);
  assert.equal(parseMoney(12.34, 'Amount'), 12.34);
  assert.equal(parseMoney(' 9999.99 ', 'Amount'), 9999.99);
});

test('parseMoney rejects zero, negatives, 3dp, non-numeric, and over max', () => {
  for (const bad of ['0', '-1', '1.234', 'abc', '', '1e3', '10000', null, undefined, {}]) {
    assert.throws(() => parseMoney(bad, 'Amount'), ValidationError, String(bad));
  }
});

test('parseMoney honours allowZero and max', () => {
  assert.equal(parseMoney('0', 'Cap', { allowZero: true, max: 99999.99 }), 0);
  assert.equal(parseMoney('50000', 'Cap', { allowZero: true, max: 99999.99 }), 50000);
  assert.throws(() => parseMoney('100000', 'Cap', { allowZero: true, max: 99999.99 }), ValidationError);
});
