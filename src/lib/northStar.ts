// The setup goal (F10, session 55 — supersedes the session-47 auto-seed).
//
// Originally a brand-new install was auto-assigned ONE starter goal — "Reach
// A class" — the moment the log was real. That was a USPSA competitor's goal
// handed to every shooter, hunters included, so the Setup Wizard now ASKS
// instead: presets + write-your-own + skip. This module keeps the pieces the
// wizard needs; the boot-time auto-seed (ensureNorthStar) is gone.
//
// The rules that survive from the old seeder, each still earned:
//
//  - AT MOST ONCE PER INSTALL. `northStarSeeded` in settings still guards:
//    once the question is ANSWERED (any answer, including skip), it is never
//    asked again — re-running the wizard from Help must not nag. Existing
//    installs already carry the flag from the auto-seed era, so they are
//    never asked either (untouched, by design).
//  - ONLY ONCE THE LOG IS REAL (at least one gun). A goal written on an
//    otherwise-empty device would make a fresh install claim "newer work than
//    the file" during a backup restore, and would break the sample-data
//    confirm gate's "genuinely empty" read. No gun → no question.
//  - AN INSTALL WITH GOALS OF ITS OWN IS NOT ASKED. A restored backup or an
//    upgrade already has goals; asking would talk past them. We deliberately
//    do NOT mark the install seeded in that case — if those goals are ever
//    cleared and setup re-runs, the question is still available.
//  - "START FRESH" ASKS AGAIN — correct, because Clear All wipes settings
//    too: an erased device is a brand-new install again by definition.
//
// The chosen goal's id is FIXED so the write is idempotent: a retry after a
// crash overwrites the same record instead of duplicating it. The write path
// is the existing, tested seedGoalWithSettings (goal + guard + pin in ONE
// transaction), under the same cross-tab exclusion as restore/import/erase.

import { putSettings, seedGoalWithSettings, withExclusiveIo } from './db.ts';
import { stampNew } from './stamps.ts';
import { todayKey } from './dates.ts';
import type { AppSettings, Goal } from './types.ts';

export const NORTH_STAR_GOAL_ID = 'go-north-star';

/**
 * The wizard's goal presets (Michael-approved wording, session-54 spec).
 * Categories reuse the free-text vocabulary the Goals screen already speaks —
 * they show as the goal's grouping line and feed the category suggestions.
 */
export const SETUP_GOAL_PRESETS = [
  { text: 'Shoot tighter groups', category: 'Accuracy' },
  { text: 'Build confident, safe gun handling', category: 'Fundamentals' },
  { text: 'Reach a USPSA/IDPA classification', category: 'Classification' },
  { text: 'Be ready for hunting season', category: 'Hunting' },
] as const;

/**
 * Should the wizard show the goal step? Pure — no storage — so every branch
 * is unit-tested without IndexedDB. The caller decides from a FRESH read at
 * tap time (the wizard's cached counts can lag).
 */
export function goalStepNeeded(input: {
  seeded: boolean | undefined;
  gunCount: number;
  goals: Pick<Goal, 'id'>[];
}): boolean {
  if (input.seeded) return false;        // answered once, never asked again
  if (input.gunCount === 0) return false; // the log isn't real yet
  if (input.goals.length > 0) return false; // they have goals — don't talk past them
  return true;
}

export type SetupGoalChoice =
  | { kind: 'skip' }
  | { kind: 'goal'; text: string; category?: string };

/**
 * Record the user's answer. Skip marks the install answered and writes no
 * goal; a chosen goal is created under the fixed id, pinned as the North
 * Star, and the answered flag lands in the SAME transaction. NOT fail-safe
 * on purpose: this is a user-initiated write, so a failure must surface to
 * the wizard (which shows it and offers retry) rather than vanish silently.
 */
export async function applySetupGoal(
  choice: SetupGoalChoice,
  now: number = Date.now(),
): Promise<void> {
  if (choice.kind === 'skip') {
    await putSettings<AppSettings>({ northStarSeeded: true });
    return;
  }
  const goal: Goal = stampNew(
    {
      text: choice.text,
      category: choice.category ?? '',
      target: '',
      achieved: false,
      dateSet: todayKey(new Date(now)),
      dateAchieved: '',
    },
    NORTH_STAR_GOAL_ID,
    now
  );
  // Same cross-tab exclusion as restore/import/erase (B6), so the write can't
  // interleave with a restore running in another tab.
  await withExclusiveIo('the setup goal', async () => {
    await seedGoalWithSettings<AppSettings>(goal, {
      northStarSeeded: true,
      goldenGoalId: NORTH_STAR_GOAL_ID,
    });
  });
}
