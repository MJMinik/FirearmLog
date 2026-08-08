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
  rewriteSessionSkillSets,
  trashSession,
  untrashSession,
  clearAllData,
  getAll,
  getAllMediaWholeStore,
  getMediaForOwner,
  getSettings,
  putSettings,
  validateSnapshotShape,
  putOne,
  localLastModified,
  hasOversizedMedia,
  scanMediaImageIds,
} from '../src/lib/db.ts';
import type { DataSet } from '../src/lib/types.ts';
import { newestStamp } from '../src/lib/flog.ts';
import type { Snapshot } from '../src/lib/flog.ts';

// Minimal DataSet with every array commitDataSet reads (empty unless overridden).
function dataSetWith(over: Record<string, unknown[]>): DataSet {
  const base: Record<string, unknown[]> = {
    firearms: [], sessions: [], drills: [], ammunition: [], purchases: [],
    maintenance: [], malfunctions: [], magazines: [], optics: [], parts: [],
    goals: [], skills: [], skillSets: [], matches: [], classifiers: [], references: [], trash: [], media: [],
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

test('commitDataSet keeps stock (drs-) drills — the F4 prefix survives the dr- cleanup', async () => {
  // Pin the fact the whole scheme leans on: 'drs-…' does NOT start with 'dr-'
  // (third character is 's', not '-'), so the re-import cleanup spares it.
  assert.equal('drs-bill-drill'.startsWith('dr-'), false);
  await commitDataSet(dataSetWith({ drills: [{ id: 'dr-old' }] }), undefined);
  const { seedDrillsWithSettings } = await import('../src/lib/db.ts');
  await seedDrillsWithSettings([{ id: 'drs-bill-drill' }], { drillsSeeded: true });
  // A re-import replaces dr- drills; the stock drill must ride through.
  await commitDataSet(dataSetWith({ drills: [{ id: 'dr-new' }] }), undefined);
  const drills = await getAll<{ id: string }>('drills');
  assert.ok(has(drills, 'drs-bill-drill'), 'stock drill survived the re-import');
  assert.ok(has(drills, 'dr-new') && !has(drills, 'dr-old'));
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

test('M2: rewriteSessionSkillSets replaces one session\'s sets in one transaction', async () => {
  await clearAllData();
  await rewriteSessionSkillSets([], [
    { id: 'ss-old-1', sessionId: 'se-rw', skill: 'draw', count: 5, bestSec: 1.4 },
    { id: 'ss-old-2', sessionId: 'se-rw', skill: 'reload', count: 3, bestSec: 2.1 },
  ]);
  let rows = await getAll<{ id: string; sessionId: string }>('skillSets');
  assert.ok(has(rows, 'ss-old-1') && has(rows, 'ss-old-2'));

  // A save() rewrite: delete the old ids, put a fresh set — must land together.
  await rewriteSessionSkillSets(['ss-old-1', 'ss-old-2'], [
    { id: 'ss-new-1', sessionId: 'se-rw', skill: 'split', count: 10, bestSec: 0.9 },
  ]);
  rows = await getAll<{ id: string; sessionId: string }>('skillSets');
  assert.ok(!has(rows, 'ss-old-1') && !has(rows, 'ss-old-2'), 'the old rows are gone');
  assert.ok(has(rows, 'ss-new-1'), 'the new row landed');
});

test('M2: rewriteSessionSkillSets is atomic — a poisoned new row rolls the WHOLE rewrite back', async () => {
  await clearAllData();
  await rewriteSessionSkillSets([], [
    { id: 'ss-keep-1', sessionId: 'se-rw2', skill: 'draw', count: 5, bestSec: 1.4 },
  ]);
  // IndexedDB cannot clone a function, so this put throws mid-transaction and
  // the whole transaction (including the delete of ss-keep-1) aborts.
  await assert.rejects(rewriteSessionSkillSets(['ss-keep-1'], [
    { id: 'ss-poison', sessionId: 'se-rw2', skill: 'reload', oops: () => {} },
  ]));
  const rows = await getAll<{ id: string }>('skillSets');
  assert.ok(has(rows, 'ss-keep-1'), 'the old row survived the failed rewrite (never deleted without a replacement)');
  assert.ok(!has(rows, 'ss-poison'), 'no partial write from the failed rewrite');
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

  for (const store of ['firearms', 'sessions', 'goals', 'meta', 'matches', 'classifiers', 'trash', 'skillSets'] as const) {
    assert.equal((await getAll(store)).length, 0, `${store} is empty after clearAllData`);
  }
  assert.equal((await getAllMediaWholeStore()).length, 0, 'media is empty after clearAllData');
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
  const media = await getAllMediaWholeStore();
  assert.ok(has(media, 'md-old'), 'existing photo survived the interrupted restore');
});

test('S-5: getMediaForOwner returns only that owner\'s media (not the whole store)', async () => {
  await clearAllData();
  await restoreSnapshot({
    ...snapshotWith({ sessions: [{ id: 's-mm' }] }),
    media: [
      { id: 'mm-1', ownerType: 'session', ownerId: 's-mm', kind: 'image', data: new ArrayBuffer(2) },
      { id: 'mm-2', ownerType: 'session', ownerId: 's-mm', kind: 'image', data: new ArrayBuffer(2) },
      { id: 'mm-3', ownerType: 'session', ownerId: 's-other', kind: 'image', data: new ArrayBuffer(2) },
      { id: 'mm-4', ownerType: 'firearm', ownerId: 's-mm', kind: 'image', data: new ArrayBuffer(2) },
    ],
  } as Snapshot);
  const mine = await getMediaForOwner('session', 's-mm');
  // Only the two rows matching BOTH ownerType and ownerId — a different ownerId
  // (mm-3) and a different ownerType with the same id (mm-4) are excluded.
  assert.deepEqual(mine.map((m) => m.id).sort(), ['mm-1', 'mm-2']);
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

// Appended LAST (it leaves an opt-out flag behind, and clearAllData now honors it):
// decision 2a / R-4 — an analytics opt-out is a refusal that must survive a reset.
test('2a/R-4: an analytics opt-out survives Clear All, and ONLY that flag does', async () => {
  await clearAllData();
  await commitDataSet(dataSetWith({ firearms: [{ id: 'g-2a' }], goals: [{ id: 'go-2a' }] }), { theme: 'dark' });
  await putSettings({ analyticsOptOut: true, goldenGoalId: 'go-2a' });

  await clearAllData();

  assert.equal((await getAll('firearms')).length, 0, 'data gone');
  assert.equal((await getAll('goals')).length, 0, 'goals gone');
  const settings = await getSettings<{ analyticsOptOut?: boolean; goldenGoalId?: string; theme?: string }>();
  assert.equal(settings?.analyticsOptOut, true, 'the opt-out refusal survived the wipe');
  assert.equal(settings?.goldenGoalId, undefined, 'nothing else was carried over');
  assert.equal(settings?.theme, undefined, 'nothing else was carried over');
});


// ---- D-1: atomic trash / restore (fix/atomic-session-trash) ----
// These tests exercise trashSession and untrashSession in db.ts directly.
// Six tests: a happy-path round-trip for each direction, a poison-ammo
// atomicity test for each direction, and a poison-session discriminator
// test for each direction (see the discriminator note further down).

test('D-1: trashSession writes session tombstone and ammo update together (happy path)', async () => {
  await clearAllData();
  const can = { id: 'can-d1-trash', label: '9mm', quantity: 100, caliber: '9mm', brand: '', grains: 0,
    type: '', purchased: 0, cost: 0, createdAt: 0, updatedAt: 0 };
  await putOne('ammunition', can);
  await putOne('sessions', { id: 'se-d1-trash', planned: false, ammoUsage: [{ ammoId: 'can-d1-trash', rounds: 50 }], createdAt: 0, updatedAt: 0 });

  const updatedCan = { ...can, quantity: 150 }; // rounds returned on trash
  const ammoRecords = [updatedCan];
  const trashedSession = { id: 'se-d1-trash', planned: false, ammoUsage: [{ ammoId: 'can-d1-trash', rounds: 50 }],
    createdAt: 0, updatedAt: 1, deletedAt: 1 };

  await trashSession(trashedSession, ammoRecords);

  const sessions = await getAll<{ id: string; deletedAt?: number | null }>('sessions');
  const cans = await getAll<{ id: string; quantity: number }>('ammunition');
  const se = sessions.find((s) => s.id === 'se-d1-trash');
  const c = cans.find((a) => a.id === 'can-d1-trash');
  assert.equal(se?.deletedAt, 1, 'session is tombstoned');
  assert.equal(c?.quantity, 150, 'ammo quantity updated');
});

test('D-1: untrashSession clears session tombstone and ammo update together (happy path)', async () => {
  await clearAllData();
  const can = { id: 'can-d1-restore', label: '9mm', quantity: 150, caliber: '9mm', brand: '', grains: 0,
    type: '', purchased: 0, cost: 0, createdAt: 0, updatedAt: 0 };
  await putOne('ammunition', can);
  await putOne('sessions', { id: 'se-d1-restore', planned: false, ammoUsage: [{ ammoId: 'can-d1-restore', rounds: 50 }],
    deletedAt: 1, createdAt: 0, updatedAt: 0 });

  const updatedCan = { ...can, quantity: 100 }; // rounds re-deducted on restore
  const ammoRecords = [updatedCan];
  const restoredSession = { id: 'se-d1-restore', planned: false, ammoUsage: [{ ammoId: 'can-d1-restore', rounds: 50 }],
    createdAt: 0, updatedAt: 2, deletedAt: null };

  await untrashSession(restoredSession, ammoRecords);

  const sessions = await getAll<{ id: string; deletedAt?: number | null }>('sessions');
  const cans = await getAll<{ id: string; quantity: number }>('ammunition');
  const se = sessions.find((s) => s.id === 'se-d1-restore');
  const c = cans.find((a) => a.id === 'can-d1-restore');
  assert.equal(se?.deletedAt, null, 'session tombstone cleared');
  assert.equal(c?.quantity, 100, 'ammo quantity re-deducted');
});

test('D-1: trashSession is atomic — a poisoned ammo record rolls BOTH writes back (B7 pattern)', async () => {
  await clearAllData();
  const can = { id: 'can-d1-poison', label: '9mm', quantity: 100, caliber: '9mm', brand: '', grains: 0,
    type: '', purchased: 0, cost: 0, createdAt: 0, updatedAt: 0 };
  await putOne('ammunition', can);
  await putOne('sessions', { id: 'se-d1-poison', planned: false, ammoUsage: [{ ammoId: 'can-d1-poison', rounds: 50 }],
    createdAt: 0, updatedAt: 0 });

  // IndexedDB cannot clone a function, so the put throws mid-transaction and
  // queueOrAbort aborts the whole transaction — neither the ammo change nor the
  // session tombstone should land.
  const poisonedCan = { ...can, quantity: 150, oops: () => {} };
  const ammoRecords = [poisonedCan];
  const trashedSession = { id: 'se-d1-poison', planned: false, ammoUsage: [{ ammoId: 'can-d1-poison', rounds: 50 }],
    createdAt: 0, updatedAt: 1, deletedAt: 1 };

  await assert.rejects(trashSession(trashedSession, ammoRecords),
    'a poisoned ammo record causes the whole transaction to reject');

  const sessions = await getAll<{ id: string; deletedAt?: number | null }>('sessions');
  const cans = await getAll<{ id: string; quantity: number }>('ammunition');
  const se = sessions.find((s) => s.id === 'se-d1-poison');
  const c = cans.find((a) => a.id === 'can-d1-poison');
  assert.equal(se?.deletedAt, undefined, 'session tombstone did NOT land after ammo put failed');
  assert.equal(c?.quantity, 100, 'ammo quantity unchanged after failed transaction');
});

test('D-1: untrashSession is atomic — a poisoned ammo record rolls BOTH writes back (B7 pattern)', async () => {
  await clearAllData();
  const can = { id: 'can-d1-upoi', label: '9mm', quantity: 150, caliber: '9mm', brand: '', grains: 0,
    type: '', purchased: 0, cost: 0, createdAt: 0, updatedAt: 0 };
  await putOne('ammunition', can);
  await putOne('sessions', { id: 'se-d1-upoi', planned: false, ammoUsage: [{ ammoId: 'can-d1-upoi', rounds: 50 }],
    deletedAt: 1, createdAt: 0, updatedAt: 0 });

  const poisonedCan = { ...can, quantity: 100, oops: () => {} };
  const ammoRecords = [poisonedCan];
  const restoredSession = { id: 'se-d1-upoi', planned: false, ammoUsage: [{ ammoId: 'can-d1-upoi', rounds: 50 }],
    createdAt: 0, updatedAt: 2, deletedAt: null };

  await assert.rejects(untrashSession(restoredSession, ammoRecords),
    'a poisoned ammo record causes the whole transaction to reject');

  const sessions = await getAll<{ id: string; deletedAt?: number | null }>('sessions');
  const cans = await getAll<{ id: string; quantity: number }>('ammunition');
  const se = sessions.find((s) => s.id === 'se-d1-upoi');
  const c = cans.find((a) => a.id === 'can-d1-upoi');
  assert.equal(se?.deletedAt, 1, 'session tombstone still present (restore did NOT commit)');
  assert.equal(c?.quantity, 150, 'ammo quantity unchanged after failed transaction');
});

// D-1 discriminator tests — poison the SESSION record instead of the ammo record.
// The existing ammo-poison tests queue ammo FIRST, so even a non-atomic impl that
// puts each store in its own transaction would pass (the ammo put throws before the
// session put runs). These tests poison the SESSION record (queued SECOND) so the
// ammo put succeeds first — only a truly shared transaction rolls the ammo write
// back when the session put fails.

test('D-1 discriminator: trashSession — poisoned session rolls back the ammo update too', async () => {
  await clearAllData();
  const can = { id: 'can-d1-disc-t', label: '9mm', quantity: 100, caliber: '9mm', brand: '', grains: 0,
    type: '', purchased: 0, cost: 0, createdAt: 0, updatedAt: 0 };
  // Seed via putOne (live path, not commitDataSet).
  await putOne('ammunition', can);
  await putOne('sessions', { id: 'se-d1-disc-t', planned: false,
    ammoUsage: [{ ammoId: 'can-d1-disc-t', rounds: 50 }], createdAt: 0, updatedAt: 0 });

  const updatedCan = { ...can, quantity: 150 };
  // Poison is on the SESSION record (queued second inside queueOrAbort).
  const poisonedSession = { id: 'se-d1-disc-t', planned: false,
    ammoUsage: [{ ammoId: 'can-d1-disc-t', rounds: 50 }],
    createdAt: 0, updatedAt: 1, deletedAt: 1, oops: () => {} };

  await assert.rejects(
    trashSession(poisonedSession, [updatedCan]),
    'a poisoned session record causes the whole transaction to reject',
  );

  // Ammo must be unchanged — if the impl used two transactions the ammo write
  // would already have committed before the session put threw.
  const cans = await getAll<{ id: string; quantity: number }>('ammunition');
  const sessions = await getAll<{ id: string; deletedAt?: number | null }>('sessions');
  const c = cans.find((a) => a.id === 'can-d1-disc-t');
  const se = sessions.find((s) => s.id === 'se-d1-disc-t');
  assert.equal(c?.quantity, 100, 'ammo quantity unchanged — ammo write rolled back with the session');
  assert.equal(se?.deletedAt, undefined, 'session tombstone did not land');
});

test('D-1 discriminator: untrashSession — poisoned session rolls back the ammo update too', async () => {
  await clearAllData();
  const can = { id: 'can-d1-disc-u', label: '9mm', quantity: 150, caliber: '9mm', brand: '', grains: 0,
    type: '', purchased: 0, cost: 0, createdAt: 0, updatedAt: 0 };
  // Seed via putOne (live path, not commitDataSet).
  await putOne('ammunition', can);
  await putOne('sessions', { id: 'se-d1-disc-u', planned: false,
    ammoUsage: [{ ammoId: 'can-d1-disc-u', rounds: 50 }],
    deletedAt: 1, createdAt: 0, updatedAt: 0 });

  const updatedCan = { ...can, quantity: 100 };
  // Poison is on the SESSION record (queued second inside queueOrAbort).
  const poisonedSession = { id: 'se-d1-disc-u', planned: false,
    ammoUsage: [{ ammoId: 'can-d1-disc-u', rounds: 50 }],
    createdAt: 0, updatedAt: 2, deletedAt: null, oops: () => {} };

  await assert.rejects(
    untrashSession(poisonedSession, [updatedCan]),
    'a poisoned session record causes the whole transaction to reject',
  );

  // Ammo must be unchanged — the ammo put ran first and must be rolled back too.
  const cans = await getAll<{ id: string; quantity: number }>('ammunition');
  const sessions = await getAll<{ id: string; deletedAt?: number | null }>('sessions');
  const c = cans.find((a) => a.id === 'can-d1-disc-u');
  const se = sessions.find((s) => s.id === 'se-d1-disc-u');
  assert.equal(c?.quantity, 150, 'ammo quantity unchanged — ammo write rolled back with the session');
  assert.equal(se?.deletedAt, 1, 'session tombstone still present (restore did NOT commit)');
});

// ---- P-series media-load discipline tests (P-4 / P-7 / P-8) ----
// These tests go through the PUBLIC API so the cursor-vs-getAll distinction is
// a source-level property, not something visible in a unit test. The memory
// behaviour is not directly observable here — source-level guards handle that
// (mediaGetAllFence.test.ts, the P-5 source guard in syncCardBlobCopy.test.ts).
// What these tests prove: the RESULT of localLastModified, hasOversizedMedia,
// scanMediaImageIds, and the stale-media deletion paths is correct.

// P-4: localLastModified returns the media record's updatedAt when that is newest.
test('P-4: localLastModified picks up a media updatedAt that is newer than every store record', async () => {
  await clearAllData();
  // Seed a session with an older stamp and a media record with a newer one.
  const olderStamp = 1_000_000;
  const newerStamp = 2_000_000;
  await putOne('sessions', { id: 'se-p4', planned: false, ammoUsage: [], updatedAt: olderStamp, createdAt: 0 });
  await putOne('media', { id: 'md-p4', ownerType: 'session', ownerId: 'se-p4', kind: 'image',
    name: 'test.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(4), updatedAt: newerStamp, createdAt: 0 });
  const stamp = await localLastModified();
  assert.equal(stamp, newerStamp, 'media updatedAt drives localLastModified when it is newest');
});

test('P-4: localLastModified returns 0 when the store is empty', async () => {
  await clearAllData();
  const stamp = await localLastModified();
  assert.equal(stamp, 0, 'empty store returns 0');
});

test('P-4: localLastModified returns the store stamp when it is newer than any media record', async () => {
  await clearAllData();
  const olderMediaStamp = 500;
  const newerSessionStamp = 999_999;
  await putOne('sessions', { id: 'se-p4b', planned: false, ammoUsage: [], updatedAt: newerSessionStamp, createdAt: 0 });
  await putOne('media', { id: 'md-p4b', ownerType: 'session', ownerId: 'se-p4b', kind: 'image',
    name: 'x.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(4), updatedAt: olderMediaStamp, createdAt: 0 });
  const stamp = await localLastModified();
  assert.equal(stamp, newerSessionStamp, 'session updatedAt wins when it is newest');
});

// P-7: hasOversizedMedia — probe returns true on first oversized hit, false when none.
test('P-7: hasOversizedMedia returns false when no image exceeds the threshold', async () => {
  await clearAllData();
  await putOne('media', { id: 'md-small', ownerType: 'firearm', ownerId: 'g1', kind: 'image',
    name: 'small.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(100), updatedAt: 1, createdAt: 0 });
  const result = await hasOversizedMedia(1_000);
  assert.equal(result, false, 'small image: hasOversizedMedia is false');
});

test('P-7: hasOversizedMedia returns true when an image exceeds the threshold', async () => {
  await clearAllData();
  await putOne('media', { id: 'md-big', ownerType: 'firearm', ownerId: 'g1', kind: 'image',
    name: 'big.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(5_000), updatedAt: 1, createdAt: 0 });
  const result = await hasOversizedMedia(1_000);
  assert.equal(result, true, 'big image: hasOversizedMedia is true');
});

test('P-7: hasOversizedMedia ignores video records even if their data is large', async () => {
  await clearAllData();
  await putOne('media', { id: 'md-vid', ownerType: 'session', ownerId: 's1', kind: 'video',
    name: 'clip.mp4', annotations: [], mime: 'video/mp4',
    data: new ArrayBuffer(9_999_999), updatedAt: 1, createdAt: 0 });
  const result = await hasOversizedMedia(1_000);
  assert.equal(result, false, 'video is not counted as oversized');
});

// P-7: scanMediaImageIds — returns ids of image records only, skips videos.
test('P-7: scanMediaImageIds returns ids of images and skips videos', async () => {
  await clearAllData();
  await putOne('media', { id: 'md-img-a', ownerType: 'firearm', ownerId: 'g1', kind: 'image',
    name: 'a.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(4), updatedAt: 1, createdAt: 0 });
  await putOne('media', { id: 'md-img-b', ownerType: 'session', ownerId: 's1', kind: 'image',
    name: 'b.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(4), updatedAt: 1, createdAt: 0 });
  await putOne('media', { id: 'md-vid-c', ownerType: 'session', ownerId: 's1', kind: 'video',
    name: 'c.mp4', annotations: [], mime: 'video/mp4',
    data: new ArrayBuffer(4), updatedAt: 1, createdAt: 0 });
  const ids = await scanMediaImageIds();
  assert.ok(ids.includes('md-img-a'), 'image a included');
  assert.ok(ids.includes('md-img-b'), 'image b included');
  assert.ok(!ids.includes('md-vid-c'), 'video excluded');
  assert.equal(ids.length, 2, 'exactly 2 image ids returned');
});

// P-8: delete-stale-media path in commitDataSet removes the right photos and keeps the right ones.
test('P-8: commitDataSet deletes stale media for re-imported owners and keeps media for other owners', async () => {
  await clearAllData();
  // Seed two guns each with one photo. Only gun-a is in the re-import.
  const gunAPhoto = { id: 'md-gun-a-old', ownerType: 'firearm', ownerId: 'gun-a', kind: 'image',
    name: 'old.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(4), updatedAt: 1, createdAt: 0 };
  const gunBPhoto = { id: 'md-gun-b', ownerType: 'firearm', ownerId: 'gun-b', kind: 'image',
    name: 'b.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(4), updatedAt: 1, createdAt: 0 };
  await putOne('media', gunAPhoto);
  await putOne('media', gunBPhoto);

  // Re-import: gun-a with a NEW photo; gun-b not in the import at all.
  const newAPhoto = { id: 'md-gun-a-new', ownerType: 'firearm', ownerId: 'gun-a', kind: 'image',
    name: 'new.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(4), updatedAt: 2, createdAt: 0 };
  const ds = {
    firearms: [{ id: 'gun-a', name: 'A' }], sessions: [], drills: [], ammunition: [],
    purchases: [], maintenance: [], malfunctions: [], magazines: [], optics: [], parts: [],
    goals: [], skills: [], skillSets: [], matches: [], classifiers: [], references: [], trash: [],
    media: [newAPhoto],
  };
  await commitDataSet(ds as unknown as import('../src/lib/types.ts').DataSet, undefined);

  const media = await getAllMediaWholeStore();
  const ids = media.map((m) => m.id);
  assert.ok(!ids.includes('md-gun-a-old'), 'stale photo for re-imported owner deleted');
  assert.ok(ids.includes('md-gun-a-new'), 'new photo for re-imported owner kept');
  assert.ok(ids.includes('md-gun-b'), 'photo for non-imported owner untouched');
});

// P-8: restoreSnapshot delete-stale path keeps the right photos and removes the rest.
test('P-8: restoreSnapshot deletes media not in the snapshot and keeps media that is', async () => {
  await clearAllData();
  const oldPhoto = { id: 'md-restore-old', ownerType: 'session', ownerId: 's-old', kind: 'image',
    name: 'old.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(4), updatedAt: 1, createdAt: 0 };
  await putOne('media', oldPhoto);

  const newPhoto = { id: 'md-restore-new', ownerType: 'session', ownerId: 's-new', kind: 'image',
    name: 'new.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(4), updatedAt: 2, createdAt: 0 };
  const snap = {
    exportedAt: Date.now(), lastModified: Date.now(),
    stores: { firearms: [], sessions: [{ id: 's-new', planned: false, ammoUsage: [], updatedAt: 2, createdAt: 0 }],
      drills: [], ammunition: [], purchases: [], maintenance: [], malfunctions: [],
      magazines: [], optics: [], parts: [], goals: [], skills: [], skillSets: [],
      matches: [], classifiers: [], references: [], reminders: [], trash: [], meta: [] },
    media: [newPhoto],
  } as unknown as import('../src/lib/flog.ts').Snapshot;
  await restoreSnapshot(snap);

  const media = await getAllMediaWholeStore();
  const ids = media.map((m) => m.id);
  assert.ok(!ids.includes('md-restore-old'), 'photo not in snapshot deleted');
  assert.ok(ids.includes('md-restore-new'), 'photo in snapshot kept');
});

// ---------------------------------------------------------------------------
// Audit finding 1 (session 114): the stale-media passes must not decide by
// reading a raw record field. The first version of the P-8 fix read
// cursor.value.ownerId directly and skipped anything that was not a string —
// which meant a media record with a missing, null or non-string ownerId, or a
// non-string id, survived restore FOREVER. Nothing deletes it later: it gets
// packed into every .flog backup, travels to the other device, and eats space
// until the free-space preflight starts refusing to load files.
//
// Restore decides purely by id, so it now walks primary KEYS (openKeyCursor) and
// never reads a record field at all — structurally immune to the whole class.
// These tests are the proof: each one fails on the pre-fix code.
// ---------------------------------------------------------------------------
test('audit-1: restore deletes an orphaned photo whose ownerId is missing', async () => {
  await clearAllData();
  // A damaged record: no ownerId at all. Reading the field raw would skip it.
  await putOne('media', { id: 'md-no-owner', ownerType: 'firearm', kind: 'image',
    name: 'orphan.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(4), updatedAt: 1, createdAt: 0 });

  const snap = snapshotWith({ firearms: [], sessions: [], drills: [], ammunition: [],
    purchases: [], maintenance: [], malfunctions: [], magazines: [], optics: [], parts: [],
    goals: [], skills: [], skillSets: [], matches: [], classifiers: [], references: [],
    reminders: [], trash: [], meta: [] });
  await restoreSnapshot(snap);

  const ids = (await getAllMediaWholeStore()).map((m) => m.id);
  assert.ok(!ids.includes('md-no-owner'), 'a photo with no ownerId is still cleaned up by restore');
});

test('audit-1: restore deletes an orphaned photo whose ownerId is null', async () => {
  await clearAllData();
  await putOne('media', { id: 'md-null-owner', ownerType: 'firearm', ownerId: null, kind: 'image',
    name: 'orphan.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(4), updatedAt: 1, createdAt: 0 });

  const snap = snapshotWith({ firearms: [], sessions: [], drills: [], ammunition: [],
    purchases: [], maintenance: [], malfunctions: [], magazines: [], optics: [], parts: [],
    goals: [], skills: [], skillSets: [], matches: [], classifiers: [], references: [],
    reminders: [], trash: [], meta: [] });
  await restoreSnapshot(snap);

  const ids = (await getAllMediaWholeStore()).map((m) => m.id);
  assert.ok(!ids.includes('md-null-owner'), 'a photo with a null ownerId is still cleaned up by restore');
});

test('audit-1: restore deletes a photo whose id is not a string', async () => {
  await clearAllData();
  // normalizeRecord never coerces id (it is the key, and rewriting a key would
  // move the record). So the delete must go by the key the store actually holds.
  await putOne('media', { id: 12345, ownerType: 'firearm', ownerId: 'g1', kind: 'image',
    name: 'numeric.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(4), updatedAt: 1, createdAt: 0 });

  const snap = snapshotWith({ firearms: [], sessions: [], drills: [], ammunition: [],
    purchases: [], maintenance: [], malfunctions: [], magazines: [], optics: [], parts: [],
    goals: [], skills: [], skillSets: [], matches: [], classifiers: [], references: [],
    reminders: [], trash: [], meta: [] });
  await restoreSnapshot(snap);

  const all = await getAllMediaWholeStore();
  assert.equal(all.length, 0, 'a photo with a numeric id is deleted by key, not by a string comparison');
});

test('audit-1: the import commit deletes a superseded photo whose id is not a string', async () => {
  await clearAllData();
  await putOne('media', { id: 999, ownerType: 'firearm', ownerId: 'gun-a', kind: 'image',
    name: 'old.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(4), updatedAt: 1, createdAt: 0 });

  const newPhoto = { id: 'md-new', ownerType: 'firearm', ownerId: 'gun-a', kind: 'image',
    name: 'new.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(4), updatedAt: 2, createdAt: 0 };
  await commitDataSet(dataSetWith({ firearms: [{ id: 'gun-a', name: 'A' }], media: [newPhoto] }), undefined);

  const ids = (await getAllMediaWholeStore()).map((m) => m.id);
  assert.ok(!ids.includes(999 as unknown as string), 'the superseded photo is deleted by its real key');
  assert.ok(ids.includes('md-new'), 'the replacement photo is kept');
});

// Observation 10 (session 114): hasOversizedMedia's comparison is `>`, so a photo
// exactly ON the threshold is NOT oversized. Nothing pinned that boundary, which
// meant `>` could drift to `>=` unnoticed and the Free Up Space card would start
// offering to shrink photos it cannot improve. Both sides are now pinned.
test('P-7: hasOversizedMedia is false for a photo exactly on the threshold', async () => {
  await clearAllData();
  await putOne('media', { id: 'md-exact', ownerType: 'firearm', ownerId: 'g1', kind: 'image',
    name: 'exact.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(1_000), updatedAt: 1, createdAt: 0 });
  assert.equal(await hasOversizedMedia(1_000), false, 'exactly on the threshold is not oversized');
});

test('P-7: hasOversizedMedia is true one byte over the threshold', async () => {
  await clearAllData();
  await putOne('media', { id: 'md-plus-one', ownerType: 'firearm', ownerId: 'g1', kind: 'image',
    name: 'plusone.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(1_001), updatedAt: 1, createdAt: 0 });
  assert.equal(await hasOversizedMedia(1_000), true, 'one byte over the threshold is oversized');
});

// Audit finding D (second pass, session 114): the Free Up Space card's mount
// probe and its run pass must answer the same question. The probe used to ignore
// the id while the run required a string id, so a photo with a numeric id made
// the card appear promising space to free — and then the run freed none.
test('P-7: the probe and the id scan agree — a photo the run cannot touch does not raise the card', async () => {
  await clearAllData();
  await putOne('media', { id: 77, ownerType: 'firearm', ownerId: 'g1', kind: 'image',
    name: 'numeric.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(5_000), updatedAt: 1, createdAt: 0 });
  assert.equal(await hasOversizedMedia(1_000), false, 'probe does not raise the card');
  assert.equal((await scanMediaImageIds()).length, 0, 'and the run would touch nothing — the two agree');
});

// Audit finding E (second pass, session 114): newestStamp compared media
// timestamps without checking the type, while the cursor path checked. So a
// timestamp stored as TEXT won the comparison in one path and was ignored in the
// other, and the two functions answering "when did this last change?" disagreed.
test('audit-E: a timestamp stored as text is ignored by both the backup path and the device path', async () => {
  await clearAllData();
  await putOne('media', { id: 'md-text-stamp', ownerType: 'firearm', ownerId: 'g1', kind: 'image',
    name: 'x.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(4), updatedAt: '9999999999', createdAt: 0 });
  const device = await localLastModified();
  assert.equal(device, 0, 'the device stamp ignores a non-number');
  assert.equal(typeof device, 'number', 'and is still a number, not a string');
  const viaSnapshot = newestStamp({}, [{ updatedAt: '9999999999' } as unknown as { updatedAt: number }]);
  assert.equal(viaSnapshot, 0, 'the backup path now applies the same rule');
});
