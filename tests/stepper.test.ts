import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepValue } from '../src/lib/stepper.ts';

test('increments an existing count', () => {
  assert.equal(stepValue('5', 1), '6');
});

test('decrements an existing count', () => {
  assert.equal(stepValue('5', -1), '4');
});

test('empty + becomes 1 (empty treated as 0)', () => {
  assert.equal(stepValue('', 1), '1');
});

test('empty − stays 0 (never negative)', () => {
  assert.equal(stepValue('', -1), '0');
});

test('floors at 0 — cannot go below zero', () => {
  assert.equal(stepValue('0', -1), '0');
});

test('non-numeric is treated as 0', () => {
  assert.equal(stepValue('abc', 1), '1');
});
