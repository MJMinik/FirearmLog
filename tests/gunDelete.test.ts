// The purchase-link clear that runs when a gun is deleted permanently.
//
// This file exists because the rule shipped untestable. It lived inside
// GunRemoveSheet.deleteForever, and the session-135 verify pass demonstrated
// two things about that: the whole unit suite stayed green with the loop
// deleted, and the E2E written to guard it could not fail either, because once
// the gun record is gone its <option> never renders and the "For which gun"
// select reads empty whether the link was cleared or is still dangling.
//
// Runs against fake-indexeddb so the real db.ts writes execute and the records
// can be read back -- the only vantage point from which a cleared link and a
// dangling one look different.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearAllData, getAll, putOne } from '../src/lib/db.ts';
import { clearGunLinkFromPurchases } from '../src/ui/gunDelete.ts';
import type { Purchase } from '../src/lib/types.ts';

const buy = (id: string, firearmId: string | null, category = 'Gear / Equipment'): object => ({
  id, createdAt: 1, updatedAt: 1, date: '2026-02-02', category,
  item: 'Holster ' + id, vendor: 'Local shop', cost: 60, notes: '', firearmId,
});

const byId = (rows: Purchase[], id: string): Purchase => {
  const found = rows.find((r) => r.id === id);
  assert.ok(found, 'purchase ' + id + ' must still exist');
  return found;
};

test('clearGunLinkFromPurchases: the doomed gun\'s links go, and nothing else moves', async () => {
  await clearAllData();
  await putOne('purchases', buy('pu-doomed', 'fa-doomed'));
  await putOne('purchases', buy('pu-doomed-2', 'fa-doomed', 'Service / Repair'));
  await putOne('purchases', buy('pu-other', 'fa-keeper'));
  await putOne('purchases', buy('pu-unlinked', null, 'Travel'));

  const cleared = await clearGunLinkFromPurchases('fa-doomed');
  assert.equal(cleared, 2, 'both of the doomed gun\'s purchases are reported cleared');

  const rows = await getAll<Purchase>('purchases');
  assert.equal(rows.length, 4, 'no purchase is deleted -- the money survives, only the link goes');
  assert.equal(byId(rows, 'pu-doomed').firearmId, null, 'cleared to null, not left dangling');
  assert.equal(byId(rows, 'pu-doomed-2').firearmId, null, 'Service / Repair links clear too');
  assert.equal(byId(rows, 'pu-other').firearmId, 'fa-keeper', 'another gun\'s link is untouched');
  assert.equal(byId(rows, 'pu-unlinked').firearmId, null, 'an already-unlinked purchase is unchanged');
  // The money is the part that must never move.
  assert.equal(byId(rows, 'pu-doomed').cost, 60);
  assert.equal(byId(rows, 'pu-doomed').item, 'Holster pu-doomed');
});

test('clearGunLinkFromPurchases: cleared to null specifically, never the empty string', async () => {
  // Purchase.firearmId is `string | null` and the save path writes null. An empty
  // string would read as "linked to a gun whose id is blank" rather than "not
  // linked", and would not match the `?? ''` form load the way null does.
  await clearAllData();
  await putOne('purchases', buy('pu-1', 'fa-1'));
  await clearGunLinkFromPurchases('fa-1');
  const p = byId(await getAll<Purchase>('purchases'), 'pu-1');
  assert.strictEqual(p.firearmId, null);
  assert.notStrictEqual(p.firearmId as unknown, '');
});

test('clearGunLinkFromPurchases: a gun nothing points at changes nothing, and reports 0', async () => {
  await clearAllData();
  await putOne('purchases', buy('pu-1', 'fa-1'));
  const before = await getAll<Purchase>('purchases');
  const cleared = await clearGunLinkFromPurchases('fa-nobody');
  assert.equal(cleared, 0);
  assert.deepEqual(await getAll<Purchase>('purchases'), before, 'the store is byte-for-byte unchanged');
});

test('clearGunLinkFromPurchases: an empty gun id is a no-op, never a wildcard', async () => {
  // Defensive, and the failure it prevents is severe: if an empty id were treated
  // as "match anything falsy", a gun record with no id would strip the link off
  // every unlinked purchase and bump their updatedAt, churning the sync clock for
  // no reason.
  await clearAllData();
  await putOne('purchases', buy('pu-1', null));
  await putOne('purchases', buy('pu-2', 'fa-1'));
  const cleared = await clearGunLinkFromPurchases('');
  assert.equal(cleared, 0);
  const rows = await getAll<Purchase>('purchases');
  assert.equal(byId(rows, 'pu-2').firearmId, 'fa-1', 'a real link survives an empty-id call');
});
