// The actual delete / restore / purge operations for sessions (App 7).
// These touch IndexedDB, so they live in the UI layer; the pure rules (what's
// trashed, when it expires) are in lib/softDelete.ts. Both the edit form and the
// Log list call THESE functions, so the behavior is identical everywhere (DRY).
//
// Ammo bookkeeping mirrors the old hard-delete: soft-deleting a LOGGED session
// puts its rounds back on the can; restoring takes them off again. Planned
// sessions never moved stock, so their ammo is left alone. Each write is its own
// IndexedDB transaction; nothing here rebuilds or relocates a record, so an
// interrupted run can't split a session across stores (the corruption risk we
// deliberately avoided by tombstoning rather than moving records).

import type { Ammunition, Session } from '../lib/types.ts';
import { attachedToSessions, deleteOne, getAll, putOne } from '../lib/db.ts';
import { stampUpdate } from '../lib/stamps.ts';
import { inventoryAfterUsageChange } from '../lib/costing.ts';
import { expiredOnly } from '../lib/softDelete.ts';

/** Put a session in the Trash. Logged sessions hand their rounds back to the can. */
export async function softDeleteSession(session: Session, ammo: Ammunition[], now = Date.now()): Promise<void> {
  if (!session.planned) {
    const changes = inventoryAfterUsageChange(ammo, session.ammoUsage ?? [], []);
    for (const [ammoId, quantity] of changes) {
      const can = ammo.find((a) => a.id === ammoId);
      if (can) await putOne('ammunition', stampUpdate({ ...can, quantity }, now));
    }
  }
  await putOne('sessions', stampUpdate({ ...session, deletedAt: now }, now));
}

/** Bring a session back from the Trash. Logged sessions re-deduct their rounds. */
export async function restoreSession(session: Session, ammo: Ammunition[], now = Date.now()): Promise<void> {
  if (!session.planned) {
    const changes = inventoryAfterUsageChange(ammo, [], session.ammoUsage ?? []);
    for (const [ammoId, quantity] of changes) {
      const can = ammo.find((a) => a.id === ammoId);
      if (can) await putOne('ammunition', stampUpdate({ ...can, quantity }, now));
    }
  }
  await putOne('sessions', stampUpdate({ ...session, deletedAt: null }, now));
}

/**
 * Permanently remove a session and everything filed against it (photos/videos,
 * malfunctions, timed-skill sets). Ammo is NOT touched here — it was already
 * returned when the session was trashed. Safe to call on an already-purged id
 * (the scan simply finds nothing). Used by "Delete Forever" and the automatic
 * 30-day purge.
 *
 * WHICH STORES those are is no longer written out here. `attachedToSessions`
 * (lib/db.ts) derives them from the data model, and the CSV import's undo asks
 * the same function, so the two cannot drift: this list used to be right and
 * that one used to be empty. It also reads with a cursor, so a purge no longer
 * pulls every photo in the log into memory to find one session's.
 */
export async function purgeSession(sessionId: string): Promise<void> {
  for (const row of await attachedToSessions([sessionId])) {
    await deleteOne(row.store, row.id);
  }
  await deleteOne('sessions', sessionId);
}

/**
 * Purge every session whose 30-day window has elapsed. Runs on app load. Fails
 * SAFE: any error is swallowed so a single bad record can never block a screen
 * from loading (resilience bar, CLAUDE.md rule 23). Returns how many were purged.
 */
export async function purgeExpiredSessions(now = Date.now()): Promise<number> {
  try {
    const sessions = await getAll<Session>('sessions');
    const expired = expiredOnly(sessions, now);
    for (const s of expired) {
      try { await purgeSession(s.id); } catch { /* skip one bad record, keep going */ }
    }
    return expired.length;
  } catch {
    return 0;
  }
}
