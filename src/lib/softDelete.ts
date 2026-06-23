// Soft-delete for sessions (App 7). ONE place defines what "in the Trash" means
// and how to filter it out, so every screen stays consistent (DRY) and the
// blast radius — a deleted session leaking back into a list or a total — is
// closed by reusing these helpers rather than re-checking the field by hand.
//
// Design: a session is tombstoned with a `deletedAt` timestamp instead of being
// erased. It then disappears from every active view but survives for
// TRASH_WINDOW_DAYS so it can be restored; after that a purge removes it for good.
// Pure functions only (no IndexedDB) so they are fully unit-tested.

/** How long a deleted session stays restorable before it is purged for good. */
export const TRASH_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

interface Tombstoned {
  deletedAt?: number | null;
}

/** True when a record has been moved to the Trash (carries a real timestamp). */
export function isTrashed(r: Tombstoned): boolean {
  return typeof r.deletedAt === 'number' && r.deletedAt > 0;
}

/** The live (non-trashed) records — the default everywhere outside the Trash view. */
export function activeOnly<T extends Tombstoned>(list: T[]): T[] {
  return list.filter((r) => !isTrashed(r));
}

/** The trashed records, newest deletion first (how Recently Deleted lists them). */
export function trashedOnly<T extends Tombstoned>(list: T[]): T[] {
  return list
    .filter(isTrashed)
    .sort((a, b) => (b.deletedAt as number) - (a.deletedAt as number));
}

/** IDs of the trashed sessions — used to drop their malfunctions from reports. */
export function trashedIdSet(list: ({ id: string } & Tombstoned)[]): Set<string> {
  const set = new Set<string>();
  for (const r of list) if (isTrashed(r)) set.add(r.id);
  return set;
}

/**
 * Malfunctions that belong to a live session (or to none). A malfunction filed
 * against a trashed session is excluded so it can't inflate the malfunctions
 * report or the malfunction rate. `trashedIds` comes from trashedIdSet().
 */
export function activeMalfunctions<T extends { sessionId?: string | null }>(
  malfunctions: T[],
  trashedIds: Set<string>
): T[] {
  return malfunctions.filter((m) => !m.sessionId || !trashedIds.has(m.sessionId));
}

/** Whole days left before a trashed session is purged (0..TRASH_WINDOW_DAYS). */
export function daysLeft(deletedAt: number, now: number): number {
  const elapsed = Math.floor((now - deletedAt) / DAY_MS);
  return Math.max(0, TRASH_WINDOW_DAYS - elapsed);
}

/** True once a trashed session has passed its window and is ready to purge. */
export function isExpired(deletedAt: number, now: number): boolean {
  return now - deletedAt >= TRASH_WINDOW_DAYS * DAY_MS;
}

/** Of a list, the trashed sessions whose window has elapsed (ready to purge). */
export function expiredOnly<T extends { id: string } & Tombstoned>(list: T[], now: number): T[] {
  return list.filter((r) => isTrashed(r) && isExpired(r.deletedAt as number, now));
}
