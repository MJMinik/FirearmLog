// T1-6: verify the atomic storage core (db.ts) — previously asserted safe in
// comments but never tested. Runs against fake-indexeddb (an in-memory
// IndexedDB) so the real db.ts logic executes in the node test runner.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commitDataSet,
  restoreSnapshot,
  applyAmmoMerge,
  commitClassifiers,
  getAll,
  validateSnapshotShape,
} from '../src/lib/db.ts';
import type { DataSet } from '../src/lib/types.ts';
import type { Snapshot } from '../src/lib/flog.ts';

// Minimal DataSet with every array commitDataSet reads (empty unless overridden).
function dataSetWith(over: Record<string, unknown[]>): DataSet {
  const base: Record<string, unknown[]> = {
    firearms: [], sessions: [], drills: [], ammunition: [], purchases: [],
    maintenance: [], malfunctions: [], magazines: [], optics: [], parts: [],
    goals: [], skills: [], matches: [], classifiers: [], trash: [], media: [],
  };
  return { ...base, ...over } as unknown as DataSet;
}

function snapshotWith(stores: Record<string, unknown[]>): Snapshot {
  return {
    exportedAt: Date.now(),
    lastModified: Date.now(),
    stores,
    media: [],
  } as unknown as Snapshot;
}

const has = (rows: { id: string }[], id: string) => rows.some((r) => r.id === id);

test('commitDataSet writes records that getAll reads back', async () => {
  await commitDataSet(dataSetWith({
    firearms: [{ id: 'g-commit', name: 'Test Pistol' }],
    classifiers: [{ id: 'cl-commit', code: '99-11' }],
  }), { theme: 'dark' });
  assert.ok(has(await getAll('firearms'), 'g-commit'));
  assert.ok(has(await getAll('classifiers'), 'cl-commit'));
});

test('commitDataSet replaces imported (dr-) drills but keeps custom (drx-) drills', async () => {
  // Seed one imported + one custom drill via a first import.
  await commitDataSet(dataSetWith({ drills: [{ id: 'dr-old' }, { id: 'drx-custom' }] }), undefined);
  assert.ok(has(await getAll('drills'), 'dr-old'));
  assert.ok(has(await getAll('drills'), 'drx-custom'));
  // A re-import brings a different imported drill; dr-old should be gone, drx-custom stays.
  await commitDataSet(dataSetWith({ drills: [{ id: 'dr-new' }] }), undefined);
  const drills = await getAll<{ id: string }>('drills');
  assert.ok(has(drills, 'dr-new'), 'new imported drill present');
  assert.ok(!has(drills, 'dr-old'), 'stale imported drill removed');
  assert.ok(has(drills, 'drx-custom'), 'custom drill survived the re-import');
});

test('applyAmmoMerge lands the kept can and repointed rows atomically', async () => {
  await applyAmmoMerge({
    keptCan: { id: 'can-keep', label: 'Kept' },
    sessions: [{ id: 's-merge', ammoId: 'can-keep' }],
    purchases: [{ id: 'p-merge', ammoId: 'can-keep' }],
    deleteCanId: 'can-gone',
  });
  assert.ok(has(await getAll('ammunition'), 'can-keep'));
  assert.ok(has(await getAll('sessions'), 's-merge'));
  assert.ok(has(await getAll('purchases'), 'p-merge'));
});

test('commitClassifiers writes all rows in one transaction (T1-5)', async () => {
  await commitClassifiers([{ id: 'cl-a' }, { id: 'cl-b' }, { id: 'cl-c' }]);
  const rows = await getAll<{ id: string }>('classifiers');
  assert.ok(has(rows, 'cl-a') && has(rows, 'cl-b') && has(rows, 'cl-c'));
});

test('validateSnapshotShape rejects a damaged file before any write', () => {
  assert.throws(() => validateSnapshotShape({} as unknown as Snapshot));
  assert.throws(() => validateSnapshotShape(snapshotWith({ firearms: [{ notAnId: true }] } as Record<string, unknown[]>)));
  // A well-formed one does not throw.
  validateSnapshotShape(snapshotWith({ firearms: [{ id: 'ok' }] }));
});

test('restoreSnapshot REPLACES device data (old gone, new present)', async () => {
  await commitDataSet(dataSetWith({ firearms: [{ id: 'g-before-restore' }] }), undefined);
  assert.ok(has(await getAll('firearms'), 'g-before-restore'));
  await restoreSnapshot(snapshotWith({ firearms: [{ id: 'g-from-file' }] }));
  const guns = await getAll<{ id: string }>('firearms');
  assert.ok(has(guns, 'g-from-file'), 'restored record present');
  assert.ok(!has(guns, 'g-before-restore'), 'pre-restore record cleared');
});

test('a second restore/import running concurrently is refused, not interleaved (T1-5)', async () => {
  const snap = snapshotWith({ firearms: [{ id: 'g-concurrent' }] });
  // Fire two at once without awaiting the first — the guard must refuse one.
  const results = await Promise.allSettled([restoreSnapshot(snap), restoreSnapshot(snap)]);
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(rejected.length, 1, 'exactly one concurrent restore is refused');
  // And the app still works afterward (the guard reset in finally).
  await restoreSnapshot(snap);
  assert.ok(has(await getAll('firearms'), 'g-concurrent'));
});
