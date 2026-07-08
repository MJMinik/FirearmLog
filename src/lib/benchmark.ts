// Rung-1 benchmark contributions — the on-device math for the aggregate
// "you vs. shooters like you" flywheel (DATA_MOAT_SPEC §3 / §5B).
//
// PURE + inert: these functions only COMPUTE contribution objects from data the
// shooter already has on the device. Nothing here transmits, stores, or reads
// I/O — sending is the telemetry chokepoint's job, wired in a later step. Every
// value is derived from the SAME scoring functions the shooter sees
// (matchAccuracyTrend), never a parallel calculation, so a benchmark number can
// never disagree with the app's own.
//
// v1 metrics (LOCKED — Michael, July 7 2026): classifier percentage + accuracy
// (points-kept). Draw/split micro-metrics wait for the shot-timer capture (T3-1).

import type { GunCategory, Match } from './types.ts';
import { GUN_CATEGORIES } from './types.ts';
import { matchAccuracyTrend } from './competition.ts';

export type BenchmarkMetric = 'classifier_percent' | 'accuracy_points_kept';

/** One anonymous benchmark sample — the exact wire shape (spec §5B). No id, no
 *  timestamp, no free text, no gun identity: only a bracket plus a single
 *  derived number. `class` is the shooter's classification in this division. */
export interface BenchmarkContribution {
  scoringType: 'uspsa' | 'idpa' | 'steel';
  division: string;
  class: string;
  gunCategory: GunCategory;
  metric: BenchmarkMetric;
  value: number;
  appVersion: string;
}

/** Plausibility bounds per metric — the client half of the junk-data guard
 *  (spec §5B/§7). A value outside these is dropped, never sent, so one fat-
 *  fingered entry can't poison a bucket. Exported because the server (the
 *  Cloudflare Worker in `worker/`) enforces the SAME bounds from this same
 *  object — one source of truth, so client and server can never disagree. */
export const METRIC_BOUNDS: Record<BenchmarkMetric, { min: number; max: number }> = {
  classifier_percent: { min: 0, max: 100 }, // USPSA classification is capped at 100%
  accuracy_points_kept: { min: 0, max: 1 }, // a fraction of available points
};

/** True only if the contribution is well-formed AND plausible. Anything false
 *  here must never leave the device. */
export function isValidContribution(c: BenchmarkContribution): boolean {
  if (c.scoringType !== 'uspsa' && c.scoringType !== 'idpa' && c.scoringType !== 'steel')
    return false;
  if (!c.division) return false;
  if (!c.class) return false;
  if (!GUN_CATEGORIES.includes(c.gunCategory)) return false;
  const bounds = METRIC_BOUNDS[c.metric];
  if (!bounds) return false;
  if (!Number.isFinite(c.value)) return false;
  if (c.value < bounds.min || c.value > bounds.max) return false;
  return true;
}

/** The shooter's classification + gun category for a given match — the bracket
 *  fields the raw match record doesn't carry directly. Resolved by the caller
 *  (from the classifier history + the linked firearm) and injected, so this
 *  module stays pure and testable; the real resolver is built at wiring time. */
export interface MatchBracket {
  class: string;
  gunCategory: GunCategory;
}

/** Build one classifier-percentage contribution. Returns null when there is no
 *  percent to report or the value is implausible (guarded, never sent). */
export function classifierContribution(
  input: { division: string; class: string; gunCategory: GunCategory; percent: number | null },
  appVersion: string,
): BenchmarkContribution | null {
  if (input.percent === null) return null;
  const c: BenchmarkContribution = {
    scoringType: 'uspsa',
    division: input.division,
    class: input.class,
    gunCategory: input.gunCategory,
    metric: 'classifier_percent',
    value: input.percent,
    appVersion,
  };
  return isValidContribution(c) ? c : null;
}

/** Build accuracy (points-kept) contributions from the shooter's matches.
 *  Reuses matchAccuracyTrend so the value is exactly the app's own accuracy
 *  figure. `resolveBracket` supplies the shooter's class + gun category per
 *  match (null to skip a match, e.g. no linked gun / unknown class). Only
 *  plausible contributions are returned. */
export function accuracyContributions(
  matches: Match[],
  resolveBracket: (match: Match) => MatchBracket | null,
  appVersion: string,
): BenchmarkContribution[] {
  const byId = new Map((matches ?? []).map((m) => [m.id, m]));
  const out: BenchmarkContribution[] = [];
  for (const point of matchAccuracyTrend(matches).points) {
    const match = byId.get(point.matchId);
    if (!match) continue;
    const bracket = resolveBracket(match);
    if (!bracket) continue;
    const c: BenchmarkContribution = {
      scoringType: 'uspsa',
      division: match.division,
      class: bracket.class,
      gunCategory: bracket.gunCategory,
      metric: 'accuracy_points_kept',
      value: point.pointsKept,
      appVersion,
    };
    if (isValidContribution(c)) out.push(c);
  }
  return out;
}
