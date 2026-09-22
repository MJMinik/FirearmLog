// FirearmLog free-trial counting (ENTITLEMENT_SPEC_2026-09-18.md §5.1-5.2).
//
// Kept separate from licence.ts on purpose: licence.ts is pure cryptographic
// verification of a licence text, this file is the session-counting rule
// that decides whether the wall applies. Neither imports the other. Nothing
// in the app imports this file yet (build-order step 1 of spec §11).
//
// Arithmetic on records already in memory, never a network call.

import { isLiveSession } from './dashboard.ts';
import type { AppSettings, Session } from './types.ts';

/** Spec §5.2: the tenth live-fire session is free; the wall appears at the
 *  eleventh. */
export const FREE_LIVE_FIRE_SESSIONS = 10;

/**
 * The live-fire session count the wall is measured against (spec §5.1),
 * derived from the records every time, never stored (decision 12.1). A
 * session counts only when all of these hold:
 *
 *  - it passes `isLiveSession` (dashboard.ts): not planned, not `dry_fire`.
 *    `class` sessions pass this and are counted (decision 12.5).
 *  - it is not in the trash: `deletedAt` is null or absent.
 *  - it was not imported: it carries no `legacy` object at all, whether from
 *    the CSV engine (`legacy.importBatch`) or the migration reader
 *    (decision 12.6).
 *
 * While the sample log is loaded the count is zero regardless of the
 * records (decision 12.7): the sample is someone else's eighteen months of
 * history, and it would wall a shooter who has logged nothing of his own.
 *
 * Two known gaps, left open on purpose for step 3, recorded here so they are
 * not silently forgotten (cold audit, 21 September 2026):
 *
 *  - The `legacy` check below does not fully meet decision 12.6 for every
 *    importer. The CSV engine always stamps `legacy.importBatch`, but the
 *    migration reader (src/lib/import/pistolTracker.ts) sets
 *    `legacy` only through `takeRest`, which returns undefined when the old
 *    record has no unmapped keys, so a session migrated that way can pass
 *    this check and count even though it was never logged in FirearmLog.
 *    Fixing this belongs in the migration reader, not here.
 *  - `sampleLogLoaded` stays true after the shooter starts logging real
 *    sessions on top of the bundled sample (it clears only on Clear All or a
 *    restore), so real sessions logged while it is set also read as free.
 *    Decision 12.7 covers the sample's own sessions, not this case; whether
 *    to narrow the exclusion to just the sample's own session ids is the
 *    owner's call before step 3 wires the wall to anything.
 */
export function countLiveFireSessions(
  sessions: readonly Session[],
  settings: Pick<AppSettings, 'sampleLogLoaded'> | undefined,
): number {
  if (settings?.sampleLogLoaded) return 0;

  let count = 0;
  for (const s of sessions) {
    // Belt and braces: records reach the app through the read boundary, so
    // this should never see a malformed entry, but a defensive skip is
    // cheaper than a crash if one ever does.
    if (s == null || typeof s !== 'object') continue;
    if (s.deletedAt != null) continue;
    if (s.legacy) continue;
    if (!isLiveSession(s)) continue;
    count++;
  }
  return count;
}

/**
 * Spec §5.2, in code: the wall blocks starting one more live-fire session
 * once an unlicensed shooter has reached the free count. The tenth session
 * itself is never blocked; the eleventh is.
 */
export function wallBlocksNewLiveSession(count: number, licensed: boolean): boolean {
  return !licensed && count >= FREE_LIVE_FIRE_SESSIONS;
}
