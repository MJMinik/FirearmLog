// The storage-touching half of permanently deleting a gun.
//
// WHY THIS FILE EXISTS, and it is worth reading before adding to it. The
// purchase-link clear below shipped INSIDE GunRemoveSheet.deleteForever, where
// nothing could test it: the whole unit suite stayed green with the loop deleted,
// and the E2E written to guard it could not fail either -- once the gun record is
// gone its <option> never renders, so the "For which gun" select reads empty
// whether the link was cleared or is still dangling. The test asserted a property
// it had no way to observe, which is the failure mode this project treats as
// worse than no test at all, because it stops the next person looking.
//
// The fix is not a cleverer assertion, it is moving the rule somewhere a test can
// reach it. Same pattern as sessionDelete.ts: the operations that touch IndexedDB
// live in the UI layer as plain functions, so the fake-IndexedDB harness can run
// the real code and read the real records back.
import type { Purchase } from '../lib/types.ts';
import { getAll, putOne } from '../lib/db.ts';
import { stampUpdate } from '../lib/stamps.ts';

/**
 * Clear the gun link from every purchase naming this gun, and report how many
 * were changed.
 *
 * A purchase linked to a gun keeps its money and loses its gun. The purchase is
 * a real thing the shooter spent and must survive; the link cannot, because the
 * gun it names is about to stop existing. Left dangling it is invisible on every
 * surface (no gun row left to carry it), re-opening the purchase shows a blank
 * picker while form state still holds the dead id, and saving it untouched writes
 * the dead id straight back.
 *
 * ONLY for permanent delete. Retiring a gun or marking it no longer owned KEEPS
 * the gun record, so the link stays true and the historical cost goes on naming
 * the right gun -- which is why this is not part of freeAccessories.
 *
 * Cleared to `null`, not `''`: `Purchase.firearmId` is `string | null` and that is
 * what the save path writes. (`Optic` and `Part` use `''` because their firearmId
 * is a required string -- a different convention for a different type.)
 */
export async function clearGunLinkFromPurchases(gunId: string, now = Date.now()): Promise<number> {
  if (!gunId) return 0;
  const purchases = await getAll<Purchase>('purchases');
  let cleared = 0;
  for (const p of purchases) {
    if (p.firearmId === gunId) {
      await putOne('purchases', stampUpdate({ ...p, firearmId: null }, now));
      cleared += 1;
    }
  }
  return cleared;
}
