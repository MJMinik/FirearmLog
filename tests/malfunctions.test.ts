// App 2 — the merge that remembers custom malfunction types/methods.
// App 3a — the magazine picker filter and round-number parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeOptions, MALF_TYPES, magazinesForFirearm, parseRoundCount } from '../src/lib/malfunctions.ts';

test('built-ins come first, then custom values sorted', () => {
  const out = mergeOptions(MALF_TYPES, ['Squib', 'Brass over bolt']);
  assert.deepEqual(out.slice(0, MALF_TYPES.length), MALF_TYPES);
  assert.deepEqual(out.slice(MALF_TYPES.length), ['Brass over bolt', 'Squib']);
});

test('drops blanks, the literal "Other", and duplicates (case-insensitive)', () => {
  const out = mergeOptions(['Stovepipe'], ['', '  ', 'Other', 'other', 'Stovepipe', 'stovepipe', 'Squib', 'Squib']);
  assert.deepEqual(out, ['Stovepipe', 'Squib']);
});

test('a custom value already in the built-ins is not added twice', () => {
  assert.deepEqual(mergeOptions(['Stovepipe'], ['Stovepipe']), ['Stovepipe']);
});

// --- App 3a: magazinesForFirearm ---

const mags = [
  { id: 'm1', label: 'Mag A', firearmIds: ['g1'], active: true },
  { id: 'm2', label: 'Mag B', firearmIds: ['g2'], active: true },
  { id: 'm3', label: 'Mag C (retired)', firearmIds: ['g1'], active: false },
];

test('returns only magazines linked to the gun, active first', () => {
  const out = magazinesForFirearm(mags, 'g1').map((m) => m.id);
  assert.deepEqual(out, ['m1', 'm3']); // both fit g1; active m1 before retired m3
});

test('falls back to ALL magazines when none are linked to the gun', () => {
  const out = magazinesForFirearm(mags, 'gZ').map((m) => m.id).sort();
  assert.deepEqual(out, ['m1', 'm2', 'm3']);
});

test('empty magazine list returns empty (never throws)', () => {
  assert.deepEqual(magazinesForFirearm([], 'g1'), []);
});

// --- App 3a: parseRoundCount ---

test('parses a positive whole number', () => {
  assert.equal(parseRoundCount('47'), 47);
  assert.equal(parseRoundCount('  100 '), 100);
  assert.equal(parseRoundCount('0'), 0);
});

test('empty / non-numeric / negative / fractional all become null', () => {
  for (const bad of ['', '   ', 'abc', '-5', '3.5', 'NaN', '1e3x']) {
    assert.equal(parseRoundCount(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});
