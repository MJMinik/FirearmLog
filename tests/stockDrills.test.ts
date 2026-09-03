// The stock drill seed tests (F4). The rules under test (lib/stockDrills.ts):
// at most once per install (drillsSeeded guard); only once the log is real
// (≥1 gun); an existing drill library is marked, never added to; Clear All
// re-seeds (Q1); fixed 'drs-' ids keep a crash-retry idempotent. The decision
// is pure (stockDrillsAction) and each branch is covered directly; the
// orchestrator (ensureStockDrills) then runs against fake-indexeddb.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureStockDrills,
  stockDrillsAction,
  stockDrillDefs,
  stockDrillId,
  STOCK_DRILLS,
} from '../src/lib/stockDrills.ts';
import {
  clearAllData,
  getAll,
  getSettings,
  putOne,
  putSettings,
} from '../src/lib/db.ts';
import { stampNew } from '../src/lib/stamps.ts';
import type { AppSettings, DrillDef, Firearm } from '../src/lib/types.ts';

const aGun = (id: string): Firearm =>
  stampNew({ name: 'Test Pistol', manufacturer: '', model: '', caliber: '9mm' } as unknown as Omit<Firearm, 'id' | 'createdAt' | 'updatedAt'>, id, 1000);

// ---------- the pure decision, branch by branch ----------

test('decision: a seeded install never acts again, whatever else is true', () => {
  assert.equal(stockDrillsAction({ seeded: true, gunCount: 3, drillCount: 0 }), 'none');
  assert.equal(stockDrillsAction({ seeded: true, gunCount: 3, drillCount: 20 }), 'none');
});

test('decision: an empty device (zero guns) stays genuinely empty', () => {
  assert.equal(stockDrillsAction({ seeded: undefined, gunCount: 0, drillCount: 0 }), 'none');
});

test('decision: an existing drill library (import or custom) is marked, never added to', () => {
  assert.equal(stockDrillsAction({ seeded: undefined, gunCount: 1, drillCount: 14 }), 'mark');
  assert.equal(stockDrillsAction({ seeded: undefined, gunCount: 1, drillCount: 1 }), 'mark');
});

test('decision: guns and no drills — the true first library — seeds', () => {
  assert.equal(stockDrillsAction({ seeded: undefined, gunCount: 1, drillCount: 0 }), 'seed');
});

// ---------- the library itself ----------

test('the library is the authored 14, ids all drs-, holster deliberate where the drill draws', () => {
  assert.equal(STOCK_DRILLS.length, 14);
  const defs = stockDrillDefs(1234);
  assert.equal(defs.length, 14);
  for (const d of defs) {
    assert.ok(d.id.startsWith('drs-'), `${d.id} carries the stock prefix`);
    assert.equal(d.id.startsWith('dr-'), false, 'stock ids stay out of the dr- range that imported drills use, so the two never collide');
    assert.ok(d.name && d.briefDescription && d.fullDescription, `${d.name} is fully authored`);
  }
  assert.equal(stockDrillId('Bill Drill'), 'drs-bill-drill');
  assert.equal(stockDrillId('Doubles / Hammers'), 'drs-doubles-hammers');
  assert.equal(defs.find((d) => d.name === 'Bill Drill')?.requiresHolster, true);
  assert.equal(defs.find((d) => d.name === 'Reload Practice')?.requiresHolster, false);
});

// ---------- the orchestrator, against fake-indexeddb ----------

async function wipe(): Promise<void> {
  await clearAllData();
}

test('seeds once a gun exists: all 14 land and the install is marked, one report of change', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  assert.equal(await ensureStockDrills(1234), true);

  const drills = await getAll<DrillDef>('drills');
  assert.equal(drills.length, 14);
  assert.ok(drills.every((d) => d.id.startsWith('drs-')));
  assert.equal((await getSettings<AppSettings>())?.drillsSeeded, true);

  // Second run: guarded, silent, nothing doubled.
  assert.equal(await ensureStockDrills(9999), false);
  assert.equal((await getAll<DrillDef>('drills')).length, 14);
});

test('an empty device is never seeded — and not marked, so it stays eligible', async () => {
  await wipe();
  assert.equal(await ensureStockDrills(1234), false);
  assert.equal((await getAll<DrillDef>('drills')).length, 0);
  assert.notEqual((await getSettings<AppSettings>())?.drillsSeeded, true);
});

test('an install with drills of its own is marked and left alone (no name duplicates)', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  await putOne('drills', stampNew(
    { name: 'Bill Drill', gunCategories: ['Pistol'], fire: 'live', briefDescription: '', fullDescription: '', scoring: 'time', requiresHolster: true, tags: [] },
    'dr-bill-drill', 500
  ));
  assert.equal(await ensureStockDrills(1234), false);
  const drills = await getAll<DrillDef>('drills');
  assert.equal(drills.length, 1, 'nothing was added on top of the existing library');
  assert.equal((await getSettings<AppSettings>())?.drillsSeeded, true, 'marked so it never re-checks');
});

test('deleting stock drills after seeding is respected forever (the guard holds)', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  assert.equal(await ensureStockDrills(1000), true);
  // The user deletes the whole library…
  const { deleteOne } = await import('../src/lib/db.ts');
  for (const d of await getAll<DrillDef>('drills')) await deleteOne('drills', d.id);
  // …and it must NOT come back.
  assert.equal(await ensureStockDrills(2000), false);
  assert.equal((await getAll<DrillDef>('drills')).length, 0);
});

test('Clear All re-seeds (Q1): an erased device is a brand-new install again', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  assert.equal(await ensureStockDrills(1000), true);
  await clearAllData(); // wipes drills AND the settings guard
  assert.equal(await ensureStockDrills(2000), false); // no gun yet — still empty
  await putOne('firearms', aGun('fa-2'));
  assert.equal(await ensureStockDrills(3000), true); // gun back → seeds again
  assert.equal((await getAll<DrillDef>('drills')).length, 14);
});

test('idempotent: a crash-retry double-write overwrites the same records, never duplicates', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  // Simulate the retry by forcing two full seed passes (guard cleared between).
  assert.equal(await ensureStockDrills(1000), true);
  await putSettings<AppSettings>({ drillsSeeded: undefined as unknown as boolean });
  // Guard off, but drills exist → 'mark', not a duplicate seed.
  assert.equal(await ensureStockDrills(2000), false);
  assert.equal((await getAll<DrillDef>('drills')).length, 14);
});

test('a custom drill created after seeding coexists with the stock set', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  await ensureStockDrills(1000);
  await putOne('drills', stampNew(
    { name: 'My Drill', gunCategories: ['Pistol'], fire: 'dry', briefDescription: '', fullDescription: '', scoring: '', requiresHolster: false, tags: [] },
    'drx-my-drill', 2000
  ));
  const drills = await getAll<DrillDef>('drills');
  assert.equal(drills.length, 15);
  assert.ok(drills.some((d) => d.id === 'drx-my-drill'));
});
