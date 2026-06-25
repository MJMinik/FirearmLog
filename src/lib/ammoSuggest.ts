// Auto-default for the session form's "Ammo Used" section.
//
// When you log gun rounds on a NEW session, this proposes a single ammo row so
// your inventory actually moves — instead of the row staying blank and nothing
// coming off the can (the silent-miss bug). The deduction math itself lives in
// costing.ts and is unchanged; this only decides the DEFAULT the shooter sees.
//
//   - rounds  = the sum of the gun rounds entered.
//   - ammoId  = your most-recently-used ammo of the guns' caliber WHEN that is
//               unambiguous; otherwise '' (blank). We never auto-pick when we
//               can't be sure, because a wrong guess would deduct the wrong
//               ammo — the form then shows an amber notice telling you to pick
//               a type, or the rounds won't leave inventory.
//
// Everything stays editable: the moment the shooter touches the ammo section,
// the form stops auto-syncing (so borrow/lend cases, where rounds fired and
// ammo used legitimately differ, are preserved).
//
// Pure + unit-tested; the form wires real data into it.

export interface SuggestedAmmoRow { ammoId: string; rounds: string; }

/** Calibers compared trimmed + case-insensitively, EXACT match only. We do not
 *  fuzzy-match (e.g. "9mm" vs "9mm Luger"): a wrong match would deduct the wrong
 *  ammo, so when calibers don't line up exactly we leave the type blank. */
function sameCaliber(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The single caliber shared by every gun that has rounds entered, or null if
 * the guns-with-rounds span more than one caliber (or none have rounds yet).
 * Null means "don't auto-pick a type" — one ammo row can't represent two
 * calibers, so we leave it to the shooter.
 */
export function sharedCaliber(gunRounds: { caliber: string; rounds: number }[]): string | null {
  const withRounds = gunRounds.filter((g) => g.rounds > 0);
  if (withRounds.length === 0) return null;
  const distinct = new Set(withRounds.map((g) => g.caliber.trim().toLowerCase()));
  return distinct.size === 1 ? withRounds[0].caliber : null;
}

export function suggestAmmoRow(params: {
  totalRounds: number;
  caliber: string | null;
  ammoLib: { id: string; caliber: string }[];
  recentAmmoIds: string[]; // ammoIds used in past sessions, most-recent first
}): SuggestedAmmoRow | null {
  const { totalRounds, caliber, ammoLib, recentAmmoIds } = params;
  if (!Number.isFinite(totalRounds) || totalRounds <= 0) return null;

  let ammoId = '';
  if (caliber) {
    const matching = ammoLib.filter((a) => sameCaliber(a.caliber, caliber));
    if (matching.length > 0) {
      const recent = recentAmmoIds.find((id) => matching.some((m) => m.id === id));
      if (recent) ammoId = recent;            // most-recently-used of this caliber
      else if (matching.length === 1) ammoId = matching[0].id; // only one option
      // multiple matches, none used before -> ambiguous -> leave blank
    }
  }
  return { ammoId, rounds: String(totalRounds) };
}
