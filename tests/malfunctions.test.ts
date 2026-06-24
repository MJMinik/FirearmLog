// App 2 — the merge that remembers custom malfunction types/methods.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeOptions, MALF_TYPES } from '../src/lib/malfunctions.ts';

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
