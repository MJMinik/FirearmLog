import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshotShape } from '../src/lib/db.ts';
import type { Snapshot } from '../src/lib/flog.ts';

// Audit CR-5: the destructive pull/restore must reject a damaged file BEFORE it
// touches the device. These cover the validator that guards that boundary.
const snap = (over: Record<string, unknown>): Snapshot =>
  ({ exportedAt: 1, lastModified: 1, stores: {}, media: [], ...over } as unknown as Snapshot);

test('accepts a well-formed snapshot', () => {
  assert.doesNotThrow(() => validateSnapshotShape(
    snap({ stores: { firearms: [{ id: 'fa-1' }], meta: [{ key: 'settings' }] }, media: [{ id: 'md-1' }] })));
});

test('accepts a snapshot with missing stores (treated as empty)', () => {
  assert.doesNotThrow(() => validateSnapshotShape(snap({ stores: {}, media: [] })));
});

test('rejects a store that is not an array', () => {
  assert.throws(() => validateSnapshotShape(snap({ stores: { firearms: {} } })), /malformed/);
});

test('rejects a record missing its id', () => {
  assert.throws(() => validateSnapshotShape(snap({ stores: { firearms: [{ name: 'x' }] } })), /missing its id/);
});

test('rejects a meta record missing its key', () => {
  assert.throws(() => validateSnapshotShape(snap({ stores: { meta: [{ value: 1 }] } })), /missing its key/);
});

test('rejects a malformed media list', () => {
  assert.throws(() => validateSnapshotShape(snap({ media: {} })), /photo list/);
});

test('rejects a photo missing its id', () => {
  assert.throws(() => validateSnapshotShape(snap({ media: [{ name: 'p' }] })), /missing its id/);
});

test('rejects a completely unreadable snapshot', () => {
  assert.throws(() => validateSnapshotShape(null as unknown as Snapshot), /unreadable/);
});
