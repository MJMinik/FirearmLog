// Round-count math in ONE place (DRY). The importer and every screen use these,
// so the numbers can never disagree with each other.

import type { Session } from './types.ts';

/** Rounds fired in one session, all guns combined. */
export function sessionRounds(s: Pick<Session, 'guns'>): number {
  // Null-safe on purpose: a record that reached the store without a guns array
  // (an old or hand-edited file) counts as zero rounds instead of throwing.
  return (s.guns ?? []).reduce((sum, g) => {
    const r = g?.rounds;
    return sum + (typeof r === 'number' && Number.isFinite(r) ? r : 0);
  }, 0);
}

interface FirearmLike { id: string; startingRoundCount: number; }
// Only the two fields the math reads — every match shape satisfies this.
interface MatchLike { firearmId?: string; totalRounds?: number | null; }

/**
 * Lifetime round count for one gun: starting count + every non-planned
 * LIVE session's rounds for that gun + match rounds. Dry-fire reps are not
 * rounds fired — they never count toward round totals or maintenance
 * (Michael, June 11, 2026).
 */
export function roundsForFirearm(
  firearmId: string,
  firearms: FirearmLike[],
  sessions: Pick<Session, 'guns' | 'planned' | 'type'>[],
  matches: MatchLike[]
): number {
  const fa = firearms.find(f => f.id === firearmId);
  if (!fa) return 0;
  let total = fa.startingRoundCount || 0;
  for (const s of sessions) {
    if (s.planned || s.type === 'dry_fire') continue;
    for (const g of s.guns) {
      if (g.firearmId === firearmId) total += g.rounds || 0;
    }
  }
  for (const m of matches) {
    if (m.firearmId === firearmId && typeof m.totalRounds === 'number') total += m.totalRounds;
  }
  return total;
}

/** Lifetime rounds across all guns (live fire + matches only). */
export function totalRounds(
  firearms: FirearmLike[],
  sessions: Pick<Session, 'guns' | 'planned' | 'type'>[],
  matches: MatchLike[]
): number {
  return firearms.reduce((sum, f) => sum + roundsForFirearm(f.id, firearms, sessions, matches), 0);
}

/** Dry-fire reps for one gun — tracked, just never mixed into rounds fired. */
export function dryRepsForFirearm(
  firearmId: string,
  sessions: Pick<Session, 'guns' | 'planned' | 'type'>[]
): number {
  let total = 0;
  for (const s of sessions) {
    if (s.planned || s.type !== 'dry_fire') continue;
    for (const g of s.guns) {
      if (g.firearmId === firearmId) total += g.rounds || 0;
    }
  }
  return total;
}
