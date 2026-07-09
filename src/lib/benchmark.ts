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
import {
  matchAccuracyTrend,
  DIVISIONS,
  IDPA_DIVISIONS,
  STEEL_DIVISIONS,
  USPSA_CLASSES,
} from './competition.ts';

export type BenchmarkMetric = 'classifier_percent' | 'accuracy_points_kept';
export type BenchmarkScoringType = 'uspsa' | 'idpa' | 'steel';

/** One anonymous benchmark sample — the exact wire shape (spec §5B). No id, no
 *  timestamp, no free text, no gun identity, no app version: only a bracket plus
 *  a single derived number. `class` is the shooter's classification in this
 *  division. (appVersion was removed July 9 2026 — R-11: demanded on the wire
 *  then dropped by the store, so it was dead payload, and would have been a
 *  re-identification slicing dimension if ever persisted per bucket.) */
export interface BenchmarkContribution {
  scoringType: BenchmarkScoringType;
  division: string;
  class: string;
  gunCategory: GunCategory;
  metric: BenchmarkMetric;
  value: number;
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

/** Division allow-list per scoring system — the SAME lists the app's division
 *  pickers use (competition.ts), so a contribution can only ever carry a real,
 *  canonical division. Single source of truth, exactly like METRIC_BOUNDS; the
 *  server (worker/) enforces it too, via isValidContribution. Closes R-3: no
 *  free-text / junk division can mint a bucket or carry a club or person name
 *  off the device, and no attacker string can inflate a bucket past k. */
export const BENCHMARK_DIVISIONS: Record<BenchmarkScoringType, readonly string[]> = {
  uspsa: DIVISIONS,
  idpa: IDPA_DIVISIONS,
  steel: STEEL_DIVISIONS,
};

/** Classification allow-list per scoring system. The v1 benchmark metrics
 *  (classifier %, accuracy) are USPSA-only, so USPSA's GM…D ladder is the only
 *  LIVE set. IDPA and Steel have no benchmark metric yet AND no canonical class
 *  ladder in competition.ts; rather than invent one (getting the sport's own
 *  vocabulary wrong is the one unforgivable error), we refuse a non-USPSA class
 *  until its metric ships — verified against that sport's rulebook then — so the
 *  server never banks a bucket it cannot validate. */
export const BENCHMARK_CLASSES: Partial<Record<BenchmarkScoringType, readonly string[]>> = {
  uspsa: USPSA_CLASSES.map((c) => c.name),
};

/** True only if (scoringType, division, class) name a real, allow-listed bracket.
 *  An unknown scoringType, or a division/class not on its canonical list, is
 *  refused — the R-3 enum guard, enforced identically on client and server. */
export function isAllowedBracket(scoringType: string, division: string, cls: string): boolean {
  const divisions = BENCHMARK_DIVISIONS[scoringType as BenchmarkScoringType];
  const classes = BENCHMARK_CLASSES[scoringType as BenchmarkScoringType];
  return (
    divisions !== undefined &&
    classes !== undefined &&
    divisions.includes(division) &&
    classes.includes(cls)
  );
}

/** True only if the contribution is well-formed AND plausible. Anything false
 *  here must never leave the device. */
export function isValidContribution(c: BenchmarkContribution): boolean {
  if (!isAllowedBracket(c.scoringType, c.division, c.class)) return false; // R-B enum allow-list
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
export function classifierContribution(input: {
  division: string;
  class: string;
  gunCategory: GunCategory;
  percent: number | null;
}): BenchmarkContribution | null {
  if (input.percent === null) return null;
  const c: BenchmarkContribution = {
    scoringType: 'uspsa',
    division: input.division,
    class: input.class,
    gunCategory: input.gunCategory,
    metric: 'classifier_percent',
    value: input.percent,
  };
  return isValidContribution(c) ? c : null;
}

/** Build accuracy (points-kept) contributions from the shooter's matches.
 *  Reuses matchAccuracyTrend so the value is exactly the app's own accuracy
 *  figure. `resolveBracket` supplies the shooter's class + gun category per
 *  match (null to skip a match, e.g. no linked gun / unknown class). Only
 *  plausible contributions are returned, in chronological (oldest→newest) order
 *  — one per scored match; summarizeContributions collapses them to the single
 *  per-bucket sample that is actually sent. */
export function accuracyContributions(
  matches: Match[],
  resolveBracket: (match: Match) => MatchBracket | null,
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
    };
    if (isValidContribution(c)) out.push(c);
  }
  return out;
}

// ---- Current-standing contribution unit — k means SHOOTERS, not samples ------
//
// The producers above emit one contribution per match / per classifier read.
// Sent as-is, a shooter with many matches in a rare bracket would post many
// samples into it, so the k-anonymity gate (≈50) would be counting POSTs, not
// people — and one busy shooter could "open" a bucket alone (R-1). The remedy
// (Michael, decision 3a, July 9 2026): summarizeContributions collapses a
// shooter's raw contributions to AT MOST ONE per bucket — their *current
// standing* there, the median of their recent values — so ~50 in a bucket means
// ~50 shooters. The sent-ledger then makes re-running idempotent (R-2). Both are
// PURE here; the wiring branch persists the ledger in the meta store and sends
// through the telemetry chokepoint (build spec §5B, step 4/5).

/** The five bracket fields that name a bucket (everything but the value). */
export function bucketKeyOf(c: Omit<BenchmarkContribution, 'value'>): string {
  return [c.scoringType, c.division, c.class, c.gunCategory, c.metric].join('|');
}

/** How many of a bucket's most-recent values feed the current-standing median.
 *  Mirrors USPSA's "recent 8" recency, so an improving shooter's benchmark
 *  reflects where they are now, not results from when they were newer. */
export const BENCHMARK_RECENT_SAMPLES = 8;

/** Median of a non-empty numeric array, rounded to 4 dp (stable equality for the
 *  ledger; always within the metric's bounds since inputs already are). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return Math.round(m * 10000) / 10000;
}

/** Collapse many raw contributions to ONE current-standing sample per bucket:
 *  the median of that bucket's most-recent BENCHMARK_RECENT_SAMPLES values.
 *  Input order is treated as oldest→newest (accuracyContributions' order), so the
 *  tail is "recent". Only valid contributions count. Because one install yields
 *  at most one sample per bucket, it can never open a bucket alone — k honestly
 *  counts shooters. */
export function summarizeContributions(raw: BenchmarkContribution[]): BenchmarkContribution[] {
  const byBucket = new Map<string, { sample: BenchmarkContribution; values: number[] }>();
  for (const c of raw) {
    if (!isValidContribution(c)) continue;
    const key = bucketKeyOf(c);
    const entry = byBucket.get(key);
    if (entry) entry.values.push(c.value);
    else byBucket.set(key, { sample: c, values: [c.value] });
  }
  const out: BenchmarkContribution[] = [];
  for (const { sample, values } of byBucket.values()) {
    out.push({ ...sample, value: median(values.slice(-BENCHMARK_RECENT_SAMPLES)) });
  }
  return out;
}

/** The on-device record of what this install has already contributed: bucket key
 *  → last-sent (rounded) value. At wiring time this is persisted in the meta
 *  store and written in the SAME transaction as the outgoing queue entry, so a
 *  send is recorded atomically with being queued. Pure here; storage is step 4. */
export type SentLedger = Record<string, number>;

/** Of the current-standing summary, only the buckets whose value is NEW or has
 *  changed since last sent — so re-running contribution over unchanged data
 *  sends NOTHING (idempotent; closes R-2's re-contribution inflation). */
export function contributionsToSend(
  summary: BenchmarkContribution[],
  ledger: SentLedger,
): BenchmarkContribution[] {
  return summary.filter((c) => ledger[bucketKeyOf(c)] !== c.value);
}

/** The ledger after recording a batch as sent (immutably — returns a new map). */
export function recordSent(ledger: SentLedger, sent: BenchmarkContribution[]): SentLedger {
  const next: SentLedger = { ...ledger };
  for (const c of sent) next[bucketKeyOf(c)] = c.value;
  return next;
}
