// Per-session AND per-match magazine tracking (session spec: vault, July 22
// 2026; match spec: vault, 17 Aug 2026 "Magazines in competitions"). Everything
// here is DERIVED, never mutated: a session stores which mags each gun ran
// (SessionGun.magIds) and a match stores which mags ran it (Match.magIds) —
// and, only when the shooter overrode the default even split, the per-mag
// counts (SessionGun.magOverrides / Match.magOverrides). A magazine's lifetime
// rounds are computed from its starting count plus every session AND match
// attribution. Nothing ever writes back to the Magazine record on session or
// match save, so editing or deleting either can never drift or double-count a
// mag — the same single-source-of-truth pattern as gun lifetime rounds and
// FIFO ammo costing.
import type { Magazine, Match, Session, SessionGun } from './types.ts';

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
  // Array.isArray, not ?? — a hand-edited backup can carry magIds as a bare
  // string ("DR9-1"), and .map on a string throws. The read boundary
  // (recordShape) repairs strings, not arrays, so the guard lives here, once,
  // for every caller (audit finding A, 17 Aug 2026).
  const ids = Array.isArray(gun.magIds) ? gun.magIds : [];
  if (ids.length === 0) return [];
  if (Array.isArray(gun.magOverrides) && gun.magOverrides.length > 0) {
    return gun.magOverrides.map((o) => ({ magId: o.magId, rounds: Number(o.rounds) || 0 }));
  }
  const split = splitRounds(gun.rounds || 0, ids.length);
  return ids.map((magId, i) => ({ magId, rounds: split[i] }));
}

/**
 * One match's per-mag attribution — the match-side counterpart to
 * gunMagAttribution. A match has one gun, so there is no per-gun repetition:
 * overrides verbatim when present, otherwise the even split of `totalRounds`
 * across the picked mags. Returns [] when no mags are picked. Also returns []
 * when `totalRounds` is null/undefined and there are no overrides — the
 * "pending a round count" state (spec: never a silent zero; a KNOWN zero
 * total is not pending, and splits to zeros for every mag). Overrides cannot
 * exist while `totalRounds` is null in the app's own UI (there is nothing to
 * sum to), but a hand-edited file could carry them anyway; if so they are
 * honored verbatim rather than inventing a rule for a state the app itself
 * never produces. This is the single rule magLifetimeRounds uses too, so the
 * match form and the aggregation can never disagree.
 */
export function matchMagAttribution(
  match: Pick<Match, 'totalRounds' | 'magIds' | 'magOverrides'>
): { magId: string; rounds: number }[] {
  const ids = Array.isArray(match.magIds) ? match.magIds : [];
  if (ids.length === 0) return [];
  if (Array.isArray(match.magOverrides) && match.magOverrides.length > 0) {
    return match.magOverrides.map((o) => ({ magId: o.magId, rounds: Number(o.rounds) || 0 }));
  }
  // Pending unless the total is a real, finite number. A hand-edited file can
  // carry totalRounds as a string or NaN — guessing "that means zero" would be
  // a silent zero, the exact thing decision 2a forbids; 0 itself is a KNOWN
  // zero and splits to zeros (audit finding B, 17 Aug 2026).
  if (typeof match.totalRounds !== 'number' || !Number.isFinite(match.totalRounds)) return [];
  const split = splitRounds(match.totalRounds, ids.length);
  return ids.map((magId, i) => ({ magId, rounds: split[i] }));
}

/**
 * A magazine's lifetime rounds: its stored `totalRounds` (the STARTING count —
 * rounds through it before FirearmLog began attributing) plus every round
 * attributed to it by real live-fire sessions AND by matches. Planned sessions
 * haven't fired yet, dry fire spends no rounds, and trashed sessions
 * (deletedAt) don't count — restoring one brings its rounds back
 * automatically. Trashed matches (deletedAt) are skipped the same way.
 * `matches` is a required parameter, not optional-with-a-default: every
 * caller must consciously decide what it is passing (even `[]`), so a call
 * site can never silently forget competition rounds.
 */
export function magLifetimeRounds(
  mag: Pick<Magazine, 'id' | 'totalRounds'>,
  sessions: Pick<Session, 'guns' | 'planned' | 'type' | 'deletedAt'>[],
  matches: Pick<Match, 'totalRounds' | 'magIds' | 'magOverrides' | 'deletedAt'>[]
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
  for (const m of matches) {
    if (m.deletedAt) continue;
    if (!m.magIds?.length) continue;
    for (const a of matchMagAttribution(m)) {
      if (a.magId === mag.id) total += a.rounds;
    }
  }
  return total;
}
