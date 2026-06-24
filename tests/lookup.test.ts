// Shared labelOrRemoved display helper (review 3.3/2.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelOrRemoved } from '../src/lib/lookup.ts';

const ammo = [{ id: 'a1', label: 'Blazer 9mm' }, { id: 'a2', label: 'Federal 9mm' }];
const labelOf = (x: { label: string }) => x.label;

test('resolves a present id to its label', () => {
  assert.equal(labelOrRemoved(ammo, 'a2', labelOf), 'Federal 9mm');
});

test('an id that no longer resolves reads "(removed)"', () => {
  assert.equal(labelOrRemoved(ammo, 'gone', labelOf), '(removed)');
});

test('no id returns the default empty placeholder', () => {
  assert.equal(labelOrRemoved(ammo, null, labelOf), '');
  assert.equal(labelOrRemoved(ammo, undefined, labelOf), '');
  assert.equal(labelOrRemoved(ammo, '', labelOf), '');
});

test('no id honors a caller-chosen placeholder (report tables want a dash)', () => {
  assert.equal(labelOrRemoved(ammo, null, labelOf, '—'), '—');
});
