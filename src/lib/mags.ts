// Per-session magazine tracking (spec: vault, July 22 2026). Everything here
// is DERIVED, never mutated: a session stores which mags each gun ran
// (SessionGun.magIds) and — only when the shooter overrode the default even
// split — the per-mag counts (SessionGun.magOverrides). A magazine's lifetime
// rounds are computed from its starting count plus those attributions.
// Nothing ever writes back to the Magazine record on session save, so editing
// or deleting a session can never drift or double-count a mag — the same
// single-source-of-truth pattern as gun lifetime rounds and FIFO ammo costing.
import type { Magazine, Session, SessionGun } from './types.ts';

/**
 * Largest-remainder even split: `total` rounds across `count` slots, whole
 * numbers that always sum to exactly `total`. Earlier slots get the extra
 * round (35 across 3 → [12, 12, 11]).
 */
export function splitRounds(total: number, count: number): number[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  const t = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const base = Math.floor(t / count);
  const extra = t - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * One gun's per-mag attribution for a session: the overrides verbatim when
 * present, otherwise the even split across its picked mags. This is the single
 * rule the lifetime aggregation uses. The form previews the same even split via
 * splitRounds and stores overrides only when the shooter's numbers differ from
 * it — so an untouched split here and on screen can never disagree. (Override
 * validation — whole numbers summing to the gun's rounds — lives in
 * SessionForm.saveProblem, where each failure gets its own message.)
 */
export function gunMagAttribution(
  gun: Pick<SessionGun, 'rounds' | 'magIds' | 'magOverrides'>
): { magId: string; rounds: number }[] {
  const ids = gun.magIds ?? [];
  if (ids.length === 0) return [];
  if (gun.magOverrides && gun.magOverrides.length > 0) {
    return gun.magOverrides.map((o) => ({ magId: o.magId, rounds: Number(o.rounds) || 0 }));
  }
  const split = splitRounds(gun.rounds || 0, ids.length);
  return ids.map((magId, i) => ({ magId, rounds: split[i] }));
}

/**
 * A magazine's lifetime rounds: its stored `totalRounds` (the STARTING count —
 * rounds through it before FirearmLog began attributing) plus every round
 * attributed to it by real live-fire sessions. Planned sessions haven't fired
 * yet, dry fire spends no rounds, and trashed sessions (deletedAt) don't
 * count — restoring one brings its rounds back automatically.
 */
export function magLifetimeRounds(
  mag: Pick<Magazine, 'id' | 'totalRounds'>,
  sessions: Pick<Session, 'guns' | 'planned' | 'type' | 'deletedAt'>[]
): number {
  let total = Number(mag.totalRounds) || 0;
  for (const s of sessions) {
    if (s.deletedAt || s.planned || s.type === 'dry_fire') continue;
    for (const g of s.guns ?? []) {
      if (!g.magIds?.length) continue;
      for (const a of gunMagAttribution(g)) {
        if (a.magId === mag.id) total += a.rounds;
      }
    }
  }
  return total;
}
