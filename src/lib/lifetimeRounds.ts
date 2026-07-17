// A1 (session, July 2026): the Gun form shows a gun's LIFETIME round count and
// lets the shooter edit it directly, instead of only the "rounds fired before
// FirearmLog" starting count. The two fields are two views of the same number:
//
//   lifetime = startingCount + loggedRounds
//
// where loggedRounds is the live-fire + match rounds already logged against this
// gun (dry fire never counts — see roundsForFirearm in stats.ts). The stored
// field is still startingRoundCount ONLY; lifetime is a convenience the shooter
// thinks in. This math lives here, pure and unit-tested, so the two-way sync in
// the form can't quietly drift.

/** The lifetime total to show for a given starting count. */
export function lifetimeFromStart(startingCount: number, loggedRounds: number): number {
  return startingCount + loggedRounds;
}

/**
 * The starting count implied by an entered lifetime. Clamped at 0: you can't
 * have fewer lifetime rounds than the sessions already logged with this gun, so
 * a lifetime below loggedRounds pins the starting count at 0 and reports the
 * clamp so the form can explain it in plain language.
 */
export function startFromLifetime(
  lifetime: number,
  loggedRounds: number
): { start: number; clamped: boolean } {
  const raw = lifetime - loggedRounds;
  if (raw < 0) return { start: 0, clamped: true };
  return { start: raw, clamped: false };
}
