// M1 (T3-1 audit): the Session Report's timed-skill cells must render '—' for
// a malformed/missing number instead of throwing (Number.prototype.toFixed
// on NaN/undefined doesn't throw, but the OLD code's `undefined.toFixed`
// pattern for a genuinely missing field would) or printing "NaNs" /
// "undefined". These two helpers are the guard; the surrounding report
// builder needs a DOM (window.open), so it isn't unit-tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFiniteSec, formatFiniteCount } from '../src/ui/sessionReport.ts';

test('formatFiniteSec renders a real number as seconds', () => {
  assert.equal(formatFiniteSec(1.4), '1.40s');
  assert.equal(formatFiniteSec(0), '0.00s');
});

test('formatFiniteSec falls back to em dash for NaN, Infinity, null, undefined', () => {
  assert.equal(formatFiniteSec(NaN), '—');
  assert.equal(formatFiniteSec(Infinity), '—');
  assert.equal(formatFiniteSec(null), '—');
  assert.equal(formatFiniteSec(undefined), '—');
});

test('formatFiniteCount renders a real count, falls back to em dash otherwise', () => {
  assert.equal(formatFiniteCount(10), '10');
  assert.equal(formatFiniteCount(0), '0');
  assert.equal(formatFiniteCount(NaN), '—');
  assert.equal(formatFiniteCount(undefined), '—');
});
