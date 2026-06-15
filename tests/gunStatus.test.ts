import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Firearm } from '../src/lib/types.ts';
import {
  gunStatus, isActive, isRetired, isFormer, isOwned,
  pickableGuns, ownedGuns, statusBadge
} from '../src/lib/gunStatus.ts';

const gun = (id: string, status?: 'active' | 'retired' | 'former', reason?: string): Firearm =>
  ({ id, status, statusReason: reason } as unknown as Firearm);

test('a gun with no status field reads as active (no migration needed)', () => {
  const g = gun('fa-1');
  assert.equal(gunStatus(g), 'active');
  assert.equal(isActive(g), true);
  assert.equal(isOwned(g), true);
});

test('retired is owned but not active; former is neither', () => {
  const r = gun('fa-2', 'retired');
  const f = gun('fa-3', 'former', 'Sold');
  assert.equal(isRetired(r), true);
  assert.equal(isOwned(r), true);
  assert.equal(isActive(r), false);
  assert.equal(isFormer(f), true);
  assert.equal(isOwned(f), false);
});

test('pickableGuns: active only, unless the id is already on the record', () => {
  const list = [gun('a'), gun('b', 'retired'), gun('c', 'former', 'Lost')];
  assert.deepEqual(pickableGuns(list).map((g) => g.id), ['a']);
  // a retired gun already on the session/match still shows there
  assert.deepEqual(pickableGuns(list, ['b']).map((g) => g.id), ['a', 'b']);
});

test('ownedGuns: active + retired, never former (unless kept)', () => {
  const list = [gun('a'), gun('b', 'retired'), gun('c', 'former', 'Gifted')];
  assert.deepEqual(ownedGuns(list).map((g) => g.id), ['a', 'b']);
  assert.deepEqual(ownedGuns(list, ['c']).map((g) => g.id), ['a', 'b', 'c']);
});

test('statusBadge wording', () => {
  assert.equal(statusBadge(gun('a')), '');
  assert.equal(statusBadge(gun('b', 'retired')), 'Retired');
  assert.equal(statusBadge(gun('c', 'former', 'Stolen')), 'Stolen');
  assert.equal(statusBadge(gun('d', 'former')), 'No longer owned');
});
