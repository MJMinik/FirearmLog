// D9 fix (session 141) — the shared "(removed)" ghost-option helper every
// filter/picker select this class can happen to now shares. See
// src/ui/removedOption.ts for the full reasoning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removedOption } from '../src/ui/removedOption.ts';

test('empty id: no option', () => {
  assert.deepEqual(removedOption('', []), []);
  assert.deepEqual(removedOption('', [{ id: 'a' }]), []);
});

test('non-empty id present in the list: no option', () => {
  assert.deepEqual(removedOption('a', [{ id: 'a' }, { id: 'b' }]), []);
});

test('non-empty id absent from the list: the (removed) option', () => {
  assert.deepEqual(removedOption('gone', [{ id: 'a' }, { id: 'b' }]), [
    { value: 'gone', label: '(removed)' },
  ]);
});

test('non-empty id absent from an empty list: still the (removed) option', () => {
  assert.deepEqual(removedOption('gone', []), [{ value: 'gone', label: '(removed)' }]);
});

// F2 (cold audit, session 141): the string overload CompeteFilterBar's Match
// type / Division filters use, where the list IS the value (no {id} wrapper).
test('string overload: present value, no option', () => {
  assert.deepEqual(removedOption('Practice', ['Practice', 'Match']), []);
});

test('string overload: absent value, the (removed) option', () => {
  assert.deepEqual(removedOption('Steel Challenge', ['Practice', 'Match']), [
    { value: 'Steel Challenge', label: '(removed)' },
  ]);
});

test('string overload: absent value, empty list, still the (removed) option', () => {
  assert.deepEqual(removedOption('Steel Challenge', []), [{ value: 'Steel Challenge', label: '(removed)' }]);
});
