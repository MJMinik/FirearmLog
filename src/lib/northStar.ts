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
//  - AN EXISTING PIN IS NEVER TOUCHED. If the user (or the demo data) already
//    pinned a goal, we only mark the install seeded — so unpinning later can't
//    surprise-summon the starter goal.
//  - "START FRESH" RE-SEEDS — correct, because Clear All wipes settings too:
//    an erased device is a brand-new install again by definition.
//
// The seed's id is FIXED so the write is idempotent: if the app dies between
// the goal write and the settings write, the retry overwrites the same record
// instead of duplicating it.

import { countAll, getAll, getSettings, putSettings, putOne } from './db.ts';
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
  return pinIsLive ? 'mark' : 'seed';        // never touch an existing pin
}

/**
 * Run the seed check against the database. Returns true only the single time
 * the starter goal is actually created (so the caller knows to re-render);
 * marking-only and no-op runs return false. Fail-safe: a storage hiccup can
 * never break app open — it just means we try again next time.
 */
export async function ensureNorthStar(now: number = Date.now()): Promise<boolean> {
  try {
    const settings = await getSettings<AppSettings>();
    if (settings?.northStarSeeded) return false; // cheap early exit, every open
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
    // Seed: goal first, then the guard+pin. If we die in between, the fixed id
    // makes the retry overwrite (not duplicate) the goal.
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
    await putOne('goals', goal);
    await putSettings<AppSettings>({
      northStarSeeded: true,
      goldenGoalId: NORTH_STAR_GOAL_ID,
    });
    return true;
  } catch (e) {
    console.error('North Star seed check failed', e);
    return false; // resilience-first: never let the seed break an app open
  }
}
