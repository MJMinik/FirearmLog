// The North Star seed (built session 47, landed session 48).
//
// A brand-new install gets ONE starter goal — "Reach A class" — created and
// pinned automatically, so the first real look at Home and Progress → Goals
// shows a north star instead of an empty list. Four rules, each earned:
//
//  - AT MOST ONCE PER INSTALL. `northStarSeeded` in settings is the guard:
//    once it's true this module never writes again, so deleting or unpinning
//    the seed is respected forever — the starter goal must never feel haunted.
//  - ONLY ONCE THE LOG IS REAL (at least one gun). Seeding an EMPTY device
//    would make a fresh install claim "newer work than the file" during a
//    backup restore (caught by the round-trip E2E), and would break the
//    sample-data confirm gate's "genuinely empty" read. An empty device stays
//    genuinely empty — which is also why the welcome-state Home shows no card.
//  - THE TRUE NEWCOMER ONLY (R-H / D-2, decision 1a, July 9 2026). The seed
//    gives a first-time shooter their first goal. An install that already has
//    goals of its own — an existing user upgrading into this feature, or an old
//    backup restored onto a fresh install — is NOT a newcomer, so it is left
//    entirely untouched: no goal is pinned unasked. (We don't even mark it
//    seeded, so if that user later clears their goals they can still be seeded.)
//  - AN EXISTING PIN IS NEVER TOUCHED. If the user (or the demo data) already
//    pinned a goal, we only mark the install seeded — so unpinning later can't
//    surprise-summon the starter goal.
//  - "START FRESH" RE-SEEDS — correct, because Clear All wipes settings too:
//    an erased device is a brand-new install again by definition.
//
// The seed's id is FIXED so the write is idempotent: if the app dies between
// the goal write and the settings write, the retry overwrites the same record
// instead of duplicating it.

import { countAll, getAll, getSettings, putSettings, seedGoalWithSettings, withExclusiveIo } from './db.ts';
import { stampNew } from './stamps.ts';
import { todayKey } from './dates.ts';
import type { AppSettings, Goal } from './types.ts';

export const NORTH_STAR_GOAL_ID = 'go-north-star';

/** The starter goal, verbatim (Michael-approved, session 47). */
export const NORTH_STAR_GOAL = {
  text: 'Reach A class',
  category: 'Classification',
  target: '75% classifier average',
} as const;

export type NorthStarAction = 'none' | 'mark' | 'seed';

/**
 * Decide what the seeder should do. Pure — no storage — so every branch is
 * unit-tested without IndexedDB.
 */
export function northStarAction(input: {
  seeded: boolean | undefined;
  gunCount: number;
  goldenGoalId: string | undefined;
  goals: Pick<Goal, 'id'>[];
}): NorthStarAction {
  if (input.seeded) return 'none';           // once per install, forever
  if (input.gunCount === 0) return 'none';   // the log isn't real yet
  const pinIsLive =
    !!input.goldenGoalId && input.goals.some((g) => g.id === input.goldenGoalId);
  if (pinIsLive) return 'mark';              // never touch an existing pin
  // R-H (decision 1a): the seed is for the true NEWCOMER. An install that
  // already has goals of its own — an upgrade into this feature, or a restored
  // backup — is not a newcomer, so leave it entirely untouched. We return
  // 'none' (not 'mark') on purpose: don't burn the one-shot, so if that user
  // later clears their own goals they can still be seeded as a fresh start.
  const hasOwnGoal = input.goals.some((g) => g.id !== NORTH_STAR_GOAL_ID);
  if (hasOwnGoal) return 'none';
  return 'seed';                             // guns, no pin, no goals of their own
}

/**
 * Run the seed check against the database. Returns true only the single time
 * the starter goal is actually created (so the caller knows to re-render);
 * marking-only and no-op runs return false. Fail-safe: a storage hiccup can
 * never break app open — it just means we try again next time.
 */
export async function ensureNorthStar(now: number = Date.now()): Promise<boolean> {
  try {
    // Cheap early-exit on every open, no lock needed: once seeded, never again.
    // (A restore rewrites settings in one atomic tx, so this read is never half.)
    if ((await getSettings<AppSettings>())?.northStarSeeded) return false;
    // Not yet seeded. Run the decision AND any write under the SAME exclusion as
    // restore/import/erase (B6), so a second tab's restore can't interleave with
    // our reads/writes (D-1). If a restore holds the lock this throws, and the
    // catch below turns it into "try again next open" — fail-safe, never a hang.
    return await withExclusiveIo('the goal seed', async () => {
      const settings = await getSettings<AppSettings>();
      if (settings?.northStarSeeded) return false; // another tab seeded meanwhile
      const gunCount = await countAll('firearms');
      const goals = gunCount > 0 ? await getAll<Goal>('goals') : [];
      const action = northStarAction({
        seeded: settings?.northStarSeeded,
        gunCount,
        goldenGoalId: settings?.goldenGoalId,
        goals,
      });
      if (action === 'none') return false;
      if (action === 'mark') {
        await putSettings<AppSettings>({ northStarSeeded: true });
        return false; // nothing on screen changed
      }
      // Seed: the goal AND the guard+pin in ONE transaction (D-1). The fixed id
      // keeps even this idempotent — a retry overwrites, never duplicates.
      const goal: Goal = stampNew(
        {
          text: NORTH_STAR_GOAL.text,
          category: NORTH_STAR_GOAL.category,
          target: NORTH_STAR_GOAL.target,
          achieved: false,
          dateSet: todayKey(new Date(now)),
          dateAchieved: '',
        },
        NORTH_STAR_GOAL_ID,
        now
      );
      await seedGoalWithSettings<AppSettings>(goal, {
        northStarSeeded: true,
        goldenGoalId: NORTH_STAR_GOAL_ID,
      });
      return true;
    });
  } catch (e) {
    console.error('North Star seed check failed', e);
    return false; // resilience-first: never let the seed break an app open
  }
}
