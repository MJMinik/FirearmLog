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
  clearAllData,
  getAll,
  getSettings,
  putSettings,
  validateSnapshotShape,
} from '../src/lib/db.ts';
import type { DataSet } from '../src/lib/types.ts';
import type { Snapshot } from '../src/lib/flog.ts';

// Minimal DataSet with every array commitDataSet reads (empty unless overridden).
function dataSetWith(over: Record<string, unknown[]>): DataSet {
  const base: Record<string, unknown[]> = {
    firearms: [], sessions: [], drills: [], ammunition: [], purchases: [],
    maintenance: [], malfunctions: [], magazines: [], optics: [], parts: [],
    goals: [], skills: [], matches: [], classifiers: [], references: [], trash: [], media: [],
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

// Placed LAST: clearAllData wipes the shared in-memory DB, so it must not run
// before the other tests that seed their own data above.
test('clearAllData erases every store and the settings (hard-gate)', async () => {
  await commitDataSet(dataSetWith({
    firearms: [{ id: 'g-wipe' }],
    sessions: [{ id: 's-wipe' }],
    goals: [{ id: 'go-wipe' }],
    media: [{ id: 'm-wipe' }],
  }), { theme: 'dark' });
  await putSettings({ goldenGoalId: 'go-wipe' });
  // Sanity: the data (and settings) are present before the wipe.
  assert.ok(has(await getAll('firearms'), 'g-wipe'));
  assert.notEqual(await getSettings(), undefined);

  await clearAllData();

  for (const store of ['firearms', 'sessions', 'goals', 'media', 'meta', 'matches', 'classifiers', 'trash'] as const) {
    assert.equal((await getAll(store)).length, 0, `${store} is empty after clearAllData`);
  }
  assert.equal(await getSettings(), undefined, 'settings gone after clearAllData');
});

// ---- Batch B (code review 2026-07-06): the danger-zone quartet's gates ----

test('B3/M-2: two near-simultaneous putSettings patches BOTH land', async () => {
  await clearAllData();
  // Fire both without awaiting in between — the old get-then-put could read the
  // same "before" and the second write silently dropped the first patch.
  await Promise.all([
    putSettings<{ a?: number; b?: number }>({ a: 1 }),
    putSettings<{ a?: number; b?: number }>({ b: 2 }),
  ]);
  const settings = await getSettings<{ a?: number; b?: number }>();
  assert.equal(settings?.a, 1, 'first patch survived');
  assert.equal(settings?.b, 2, 'second patch survived');
});

test('B4/M-4: references travel through commitDataSet (were silently dropped)', async () => {
  await clearAllData();
  await commitDataSet(dataSetWith({
    references: [{ id: 'ref-keep', name: 'Atlas' }],
    firearms: [{ id: 'g-refs' }],
  }), undefined);
  assert.ok(has(await getAll('references'), 'ref-keep'), 'reference row landed');
});

test('B7: a mid-batch unstorable record rolls the WHOLE restore back (atomicity)', async () => {
  await clearAllData();
  await restoreSnapshot(snapshotWith({ firearms: [{ id: 'g-before' }], goals: [{ id: 'goal-before' }] }));
  // Shape-valid (has an id) but unstorable: IndexedDB cannot clone a function,
  // so the put throws mid-transaction and IndexedDB aborts the transaction.
  const poisoned = snapshotWith({
    firearms: [{ id: 'g-after' }],
    goals: [{ id: 'goal-bad', oops: () => {} }],
  });
  await assert.rejects(restoreSnapshot(poisoned));
  const firearms = await getAll<{ id: string }>('firearms');
  const goals = await getAll<{ id: string }>('goals');
  assert.ok(has(firearms, 'g-before'), 'old gun survived the failed restore');
  assert.ok(!has(firearms, 'g-after'), 'no partial write from the failed restore');
  assert.ok(has(goals, 'goal-before'), 'old goal survived the failed restore');
});

test('B7: a restore interrupted in the media phase never LOSES existing photos', async () => {
  await clearAllData();
  const oldMedia = { id: 'md-old', ownerType: 'session', ownerId: 's1', kind: 'image', data: new ArrayBuffer(4) };
  await restoreSnapshot({ ...snapshotWith({ sessions: [{ id: 's1' }] }), media: [oldMedia] } as Snapshot);
  // New snapshot: first media record is unstorable → the media phase dies on
  // record 1, AFTER the regular stores committed. Add-before-delete means the
  // old photo must still be there (worst case is extras, never loss).
  const poisoned = {
    ...snapshotWith({ sessions: [{ id: 's2' }] }),
    media: [{ id: 'md-bad', oops: () => {} }, { id: 'md-new', ownerType: 'session', ownerId: 's2', kind: 'image', data: new ArrayBuffer(4) }],
  } as Snapshot;
  await assert.rejects(restoreSnapshot(poisoned));
  const media = await getAll<{ id: string }>('media');
  assert.ok(has(media, 'md-old'), 'existing photo survived the interrupted restore');
});

test('B6/M-3: a lock held by ANOTHER TAB refuses the restore with the plain message', async () => {
  await clearAllData();
  // Simulate the Web Locks API reporting the lock as held elsewhere. Node has a
  // global navigator without .locks, so patch just the .locks property.
  const nav = globalThis.navigator as { locks?: unknown };
  const hadLocks = 'locks' in nav ? nav.locks : undefined;
  try {
    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: {
        request: async (_name: string, _opts: unknown, cb: (lock: unknown) => Promise<unknown>) => cb(null),
      },
    });
    await assert.rejects(
      restoreSnapshot(snapshotWith({ firearms: [{ id: 'g-locked' }] })),
      /still finishing/
    );
    assert.ok(!has(await getAll<{ id: string }>('firearms'), 'g-locked'), 'nothing written while locked');
  } finally {
    if (hadLocks === undefined) delete (globalThis.navigator as { locks?: unknown }).locks;
    else Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: hadLocks });
  }
});
