import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lifetimeFromStart, startFromLifetime } from '../src/lib/lifetimeRounds.ts';

// A1: the two-way sync between "Rounds fired before FirearmLog" (the stored
// startingRoundCount) and "Lifetime rounds (total)" the shooter sees.

test('lifetimeFromStart: lifetime = starting count + logged rounds', () => {
  assert.equal(lifetimeFromStart(0, 0), 0);
  assert.equal(lifetimeFromStart(500, 0), 500);   // brand-new gun, nothing logged
  assert.equal(lifetimeFromStart(500, 1200), 1700); // started at 500, logged 1200 since
  assert.equal(lifetimeFromStart(0, 1200), 1200);   // all rounds logged in-app
});

test('startFromLifetime: starting count = lifetime - logged rounds, never clamped when valid', () => {
  assert.deepEqual(startFromLifetime(1700, 1200), { start: 500, clamped: false });
  assert.deepEqual(startFromLifetime(1200, 1200), { start: 0, clamped: false }); // exactly at logged
  assert.deepEqual(startFromLifetime(500, 0), { start: 500, clamped: false });   // nothing logged yet
  assert.deepEqual(startFromLifetime(0, 0), { start: 0, clamped: false });
});

test('startFromLifetime: a lifetime below logged rounds clamps starting count at 0 and reports it', () => {
  assert.deepEqual(startFromLifetime(1000, 1200), { start: 0, clamped: true });
  assert.deepEqual(startFromLifetime(0, 1), { start: 0, clamped: true });
});

test('round-trip: editing one field and back leaves the number unchanged (no logged rounds)', () => {
  const logged = 0;
  const life = lifetimeFromStart(750, logged);
  assert.equal(life, 750);
  assert.deepEqual(startFromLifetime(life, logged), { start: 750, clamped: false });
});

test('round-trip: editing lifetime then reading it back holds with logged rounds', () => {
  const logged = 3400;
  const { start } = startFromLifetime(5000, logged);
  assert.equal(start, 1600);
  assert.equal(lifetimeFromStart(start, logged), 5000);
});
