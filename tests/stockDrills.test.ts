// The stock drill seed tests (F4, plus stock library version 2 — the eight
// Steel Challenge stage drills). The rules under test (lib/stockDrills.ts):
// at most once per install (drillsSeeded guard); only once the log is real
// (≥1 gun); an existing drill library is marked, never added to; Clear All
// re-seeds (Q1); fixed 'drs-' ids keep a crash-retry idempotent; and, new
// for version 2, an install that already carries `drillsSeeded` from before
// the eight Steel Challenge drills shipped gets them added exactly once, by
// fixed id, while an "own library" install (or one that deleted the stock
// set entirely) gets nothing and is marked `drillsSeededV2` so it never
// checks again. The decisions are pure (stockDrillsAction,
// stockDrillsV2Action) and each branch is covered directly; the
// orchestrator (ensureStockDrills) then runs against fake-indexeddb.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureStockDrills,
  stockDrillsAction,
  stockDrillsV2Action,
  stockDrillDefs,
  stockDrillId,
  STOCK_DRILLS,
  STOCK_DRILLS_V1,
  STOCK_DRILLS_V2_STEEL,
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

/** Build ONLY the original 14 as storable records — standing in for an
 *  install that seeded before the eight Steel Challenge drills existed,
 *  the shape ensureStockDrills wrote before this build shipped. */
function v1OnlyRecords(now: number): DrillDef[] {
  return STOCK_DRILLS_V1.map((d) => stampNew(
    {
      name: d.name, gunCategories: ['Pistol'], fire: d.fire,
      briefDescription: d.brief, fullDescription: d.full, scoring: d.scoring,
      requiresHolster: d.holster, tags: [],
    } as unknown as Omit<DrillDef, 'id' | 'createdAt' | 'updatedAt'>,
    stockDrillId(d.name), now
  ));
}

// ---------- the pure v1 decision, branch by branch ----------

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

// ---------- the pure v2 (version-2 top-up) decision, branch by branch ----------

test('v2 decision: a v2-seeded install never acts again, whatever else is true', () => {
  assert.equal(stockDrillsV2Action({ seededV1: true, seededV2: true, hasAnyStockDrill: true }), 'none');
  assert.equal(stockDrillsV2Action({ seededV1: true, seededV2: true, hasAnyStockDrill: false }), 'none');
  assert.equal(stockDrillsV2Action({ seededV1: false, seededV2: true, hasAnyStockDrill: true }), 'none');
});

test('v2 decision: v1 not yet seeded returns wait, never writes', () => {
  assert.equal(stockDrillsV2Action({ seededV1: false, seededV2: undefined, hasAnyStockDrill: false }), 'wait');
  assert.equal(stockDrillsV2Action({ seededV1: undefined, seededV2: undefined, hasAnyStockDrill: false }), 'wait');
});

test('v2 decision: v1 seeded, zero drs- ids present (own-library mark case) returns none', () => {
  assert.equal(stockDrillsV2Action({ seededV1: true, seededV2: undefined, hasAnyStockDrill: false }), 'none');
});

test('v2 decision: v1 seeded, zero drs- ids present (all-stock-deleted case) returns none — same outward state, same outcome, on purpose', () => {
  // stockDrillsV2Action can't distinguish "never had a stock drill" from
  // "had them all and deleted them" — it isn't supposed to. Both inputs are
  // identical (hasAnyStockDrill: false) and both must resolve to 'none',
  // exactly like this call above: the two scenarios are the SAME call.
  assert.equal(stockDrillsV2Action({ seededV1: true, seededV2: undefined, hasAnyStockDrill: false }), 'none');
});

test('v2 decision: v1 seeded, at least one drs- id present (even if not all 14) returns topup', () => {
  assert.equal(stockDrillsV2Action({ seededV1: true, seededV2: undefined, hasAnyStockDrill: true }), 'topup');
});

// ---------- the library itself ----------

test('the library is 22: the original 14 plus the eight Steel Challenge stage drills, ids all drs-', () => {
  assert.equal(STOCK_DRILLS_V1.length, 14);
  assert.equal(STOCK_DRILLS_V2_STEEL.length, 8);
  assert.equal(STOCK_DRILLS.length, 22);
  const defs = stockDrillDefs(1234);
  assert.equal(defs.length, 22);
  for (const d of defs) {
    assert.ok(d.id.startsWith('drs-'), `${d.id} carries the stock prefix`);
    assert.equal(d.id.startsWith('dr-'), false, 'stock ids stay out of the dr- range that imported drills use, so the two never collide');
    assert.ok(d.name && d.briefDescription && d.fullDescription, `${d.name} is fully authored`);
  }
  const ids = defs.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, 'no id collisions across all 22');
  assert.equal(stockDrillId('Bill Drill'), 'drs-bill-drill');
  assert.equal(stockDrillId('Doubles / Hammers'), 'drs-doubles-hammers');
  assert.equal(defs.find((d) => d.name === 'Bill Drill')?.requiresHolster, true);
  assert.equal(defs.find((d) => d.name === 'Reload Practice')?.requiresHolster, false);
});

test('the eight Steel Challenge ids are distinct, prefixed drs-, and match the slug rule (colon + ampersand included)', () => {
  const ids = STOCK_DRILLS_V2_STEEL.map((d) => stockDrillId(d.name));
  assert.equal(new Set(ids).size, 8);
  for (const id of ids) assert.ok(id.startsWith('drs-'));
  assert.equal(stockDrillId('Steel Challenge: Smoke & Hope'), 'drs-steel-challenge-smoke-hope');
  assert.equal(stockDrillId('Steel Challenge: Five to Go'), 'drs-steel-challenge-five-to-go');
  assert.equal(stockDrillId('Steel Challenge: Outer Limits'), 'drs-steel-challenge-outer-limits');
});

test('every Steel Challenge full description cites Appendix B and names the stop plate', () => {
  assert.equal(STOCK_DRILLS_V2_STEEL.length, 8);
  for (const d of STOCK_DRILLS_V2_STEEL) {
    assert.match(d.full, /Appendix B\.\d/, `${d.name}'s full description cites its Appendix B diagram`);
    assert.match(d.full, /stop plate/, `${d.name}'s full description names the stop plate`);
    assert.match(d.full, /9\.1|9\.2|8\.2|2\.2/, `${d.name}'s full description cites the procedure sections`);
  }
});

test('the eight Steel Challenge drills carry fire: both, scoring: time, holster: true, and the widened gun categories', () => {
  for (const d of STOCK_DRILLS_V2_STEEL) {
    assert.equal(d.fire, 'both', `${d.name} is both dry and live`);
    assert.equal(d.scoring, 'time', `${d.name} scores by time (lower is better)`);
    assert.equal(d.holster, true, `${d.name} starts from the holster in centerfire handgun`);
  }
  const defs = stockDrillDefs(1234);
  for (const name of STOCK_DRILLS_V2_STEEL.map((d) => d.name)) {
    const def = defs.find((d) => d.name === name);
    assert.deepEqual(def?.gunCategories, ['Pistol', 'Rifle', 'PCC'], `${name} covers pistol, rifle, and PCC`);
  }
  // The original 14 are untouched: still Pistol-only.
  for (const name of STOCK_DRILLS_V1.map((d) => d.name)) {
    const def = defs.find((d) => d.name === name);
    assert.deepEqual(def?.gunCategories, ['Pistol'], `${name} stays Pistol-only, unchanged`);
  }
});

// ---------- the orchestrator, against fake-indexeddb ----------

async function wipe(): Promise<void> {
  await clearAllData();
}

test('seeds once a gun exists: all 22 land and the install is marked (v1 and v2), one report of change', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  assert.equal(await ensureStockDrills(1234), true);

  const drills = await getAll<DrillDef>('drills');
  assert.equal(drills.length, 22);
  assert.ok(drills.every((d) => d.id.startsWith('drs-')));
  const settings = await getSettings<AppSettings>();
  assert.equal(settings?.drillsSeeded, true);
  assert.equal(settings?.drillsSeededV2, true);

  // Second run: guarded, silent, nothing doubled.
  assert.equal(await ensureStockDrills(9999), false);
  assert.equal((await getAll<DrillDef>('drills')).length, 22);
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
  const settings = await getSettings<AppSettings>();
  assert.equal(settings?.drillsSeeded, true, 'marked so it never re-checks v1');
  assert.equal(settings?.drillsSeededV2, true, 'an own-library install never owes the v2 top-up either');
});

test('deleting stock drills after seeding is respected forever (the guard holds, v2 included)', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  assert.equal(await ensureStockDrills(1000), true);
  // The user deletes the whole library…
  const { deleteOne } = await import('../src/lib/db.ts');
  for (const d of await getAll<DrillDef>('drills')) await deleteOne('drills', d.id);
  // …and it must NOT come back, for either version.
  assert.equal(await ensureStockDrills(2000), false);
  assert.equal((await getAll<DrillDef>('drills')).length, 0);
});

test('Clear All re-seeds (Q1): an erased device is a brand-new install again, with all 22', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  assert.equal(await ensureStockDrills(1000), true);
  await clearAllData(); // wipes drills AND the settings guards
  assert.equal(await ensureStockDrills(2000), false); // no gun yet — still empty
  await putOne('firearms', aGun('fa-2'));
  assert.equal(await ensureStockDrills(3000), true); // gun back → seeds again
  assert.equal((await getAll<DrillDef>('drills')).length, 22);
});

test('idempotent: a crash-retry double-write overwrites the same records, never duplicates', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  // Simulate the retry by forcing two full seed passes (v1 guard cleared between).
  assert.equal(await ensureStockDrills(1000), true);
  await putSettings<AppSettings>({ drillsSeeded: undefined as unknown as boolean });
  // v1 guard off, but drills exist → 'mark', not a duplicate seed.
  assert.equal(await ensureStockDrills(2000), false);
  assert.equal((await getAll<DrillDef>('drills')).length, 22);
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
  assert.equal(drills.length, 23);
  assert.ok(drills.some((d) => d.id === 'drx-my-drill'));
});

// ---------- stock library version 2: the top-up itself ----------

test('v2 top-up: an install already seeded with the original 14 gets exactly the eight new drills, once', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  for (const d of v1OnlyRecords(500)) await putOne('drills', d);
  await putSettings<AppSettings>({ drillsSeeded: true }); // pre-existing install; no drillsSeededV2 field at all

  assert.equal((await getAll<DrillDef>('drills')).length, 14);

  assert.equal(await ensureStockDrills(1000), true);
  const drills = await getAll<DrillDef>('drills');
  assert.equal(drills.length, 22, 'exactly eight new drs- records landed on top of the original 14');
  for (const d of STOCK_DRILLS_V2_STEEL) {
    assert.ok(drills.some((rec) => rec.id === stockDrillId(d.name)), `${d.name} was added`);
  }
  // The top-up must never rewrite the original 14: their createdAt stamp
  // (500, from the pre-existing install this test simulates) has to survive
  // untouched, not get overwritten with the top-up's own `now` (1000).
  const billDrill = drills.find((d) => d.id === stockDrillId('Bill Drill'));
  assert.equal(billDrill?.createdAt, 500, "the top-up left the original 14's own records alone");
  assert.equal((await getSettings<AppSettings>())?.drillsSeededV2, true);

  // Second run: guarded, silent, nothing doubled.
  assert.equal(await ensureStockDrills(2000), false);
  assert.equal((await getAll<DrillDef>('drills')).length, 22);
});

test('v2 top-up: an install marked seeded-with-its-own-library gets nothing', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  await putOne('drills', stampNew(
    { name: 'My Own Import', gunCategories: ['Pistol'], fire: 'live', briefDescription: '', fullDescription: '', scoring: 'time', requiresHolster: true, tags: [] },
    'dr-my-own-import', 500
  ));
  await putSettings<AppSettings>({ drillsSeeded: true }); // v1's 'mark' branch, from before v2 existed; no drs- ids at all

  assert.equal(await ensureStockDrills(1000), false);
  const drills = await getAll<DrillDef>('drills');
  assert.equal(drills.length, 1, 'the own-library install is untouched');
  assert.ok(!drills.some((d) => d.id.startsWith('drs-')), 'none of the eight new drs- ids appear');
  assert.equal((await getSettings<AppSettings>())?.drillsSeededV2, true, 'marked so it stops checking on future opens');
});

test('v2 top-up: a fresh install gets all 22 at once (no separate top-up needed)', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  assert.equal(await ensureStockDrills(1000), true);
  const drills = await getAll<DrillDef>('drills');
  assert.equal(drills.length, 22);
  const settings = await getSettings<AppSettings>();
  assert.equal(settings?.drillsSeeded, true);
  assert.equal(settings?.drillsSeededV2, true);
});

test('v2 top-up: an install that kept some but not all of the original 14 is still eligible and gets all eight new ones', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  // Kept 8 of the original 14 (deleted the rest before this build ever ran).
  for (const d of v1OnlyRecords(500).slice(0, 8)) await putOne('drills', d);
  await putSettings<AppSettings>({ drillsSeeded: true });

  assert.equal((await getAll<DrillDef>('drills')).length, 8);
  assert.equal(await ensureStockDrills(1000), true);
  const drills = await getAll<DrillDef>('drills');
  assert.equal(drills.length, 16, '8 kept originals + 8 new Steel Challenge drills');
  for (const d of STOCK_DRILLS_V2_STEEL) {
    assert.ok(drills.some((rec) => rec.id === stockDrillId(d.name)), `${d.name} was added`);
  }
});
