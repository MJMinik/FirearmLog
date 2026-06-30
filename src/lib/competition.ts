// Competition math and vocabulary (spec §11). Pure logic, fully tested.

import type { MatchStage } from './types.ts';

export const MATCH_TYPES = [
  'USPSA Level 1 (club match)',
  'USPSA Level 2',
  'USPSA Level 3',
  'USPSA Section Championship',
  'USPSA State Championship',
  'USPSA Area Championship',
  'USPSA Nationals',
  'IDPA Match',
  'IDPA Sanctioned (Tier 2+)',
  'Steel Challenge',
  'Local / Outlaw',
  'Other'
];

export const DIVISIONS = [
  'Carry Optics', 'Open', 'Limited', 'Limited Optics', 'Production',
  'Single Stack', 'Revolver', 'PCC', 'Other'
];

export const POWER_FACTORS = ['Minor', 'Major'];

/** Stage hit factor: points per second. */
export function hitFactor(points: number | null, time: number | null): number | null {
  if (points === null || time === null || !(time > 0) || points < 0) return null;
  return Math.round((points / time) * 10000) / 10000;
}

/** USPSA classification bands. */
export const USPSA_CLASSES = [
  { name: 'GM', min: 95 },
  { name: 'M', min: 85 },
  { name: 'A', min: 75 },
  { name: 'B', min: 60 },
  { name: 'C', min: 40 },
  { name: 'D', min: 0 }
] as const;

export function classFor(percent: number): string {
  for (const band of USPSA_CLASSES) {
    if (percent >= band.min) return band.name;
  }
  return 'D';
}

export interface ClassifierScore { date: string; percent: number | null; }

export interface ClassProgress {
  average: number | null;   // best 6 of the most recent 8 scores
  scoresUsed: number[];     // the percents that made the average
  scoresOnRecord: number;   // how many valid scores exist at all
  currentClass: string | null;
  next: { name: string; threshold: number } | null;
}

/** USPSA-style progress: best 6 of the most recent 8 valid scores. */
export function classificationProgress(scores: ClassifierScore[]): ClassProgress {
  const valid = scores
    .filter((s) => s.percent !== null && Number.isFinite(s.percent))
    .sort((a, b) => b.date.localeCompare(a.date));
  const recent = valid.slice(0, 8).map((s) => s.percent as number);
  const used = [...recent].sort((a, b) => b - a).slice(0, 6);
  if (used.length === 0) {
    return { average: null, scoresUsed: [], scoresOnRecord: 0, currentClass: null, next: null };
  }
  const average = Math.round((used.reduce((s, p) => s + p, 0) / used.length) * 100) / 100;
  const currentClass = classFor(average);
  const band = USPSA_CLASSES.findIndex((b) => b.name === currentClass);
  const next = band > 0
    ? { name: USPSA_CLASSES[band - 1].name, threshold: USPSA_CLASSES[band - 1].min }
    : null;
  return { average, scoresUsed: used, scoresOnRecord: valid.length, currentClass, next };
}

// ---- Match-after analysis (Layer 1: derive + rank, no new stored data) ----

export interface StageInsight {
  number: number;
  points: number | null;
  time: number | null;
  hitFactor: number | null;   // derived: points / time
  percent: number | null;     // stage % of the stage winner (as recorded)
  notes: string;
  rank: number | null;        // 1 = strongest by the ranking metric; null = unranked
  isToughest: boolean;
  isStrongest: boolean;
  score: StageScore | null;   // Layer 2: derived hit-breakdown score, when present
}

export interface MatchInsights {
  stages: StageInsight[];                     // original order, annotated
  rankedBy: 'percent' | 'hitFactor' | 'none'; // which metric drove the ranking
  strongest: StageInsight | null;             // only when >= 2 stages are rankable
  toughest: StageInsight[];                   // 1-2 lowest; only when >= 2 rankable
}

/**
 * Layer-1 match-after analysis: derive each stage's hit factor, rank the stages
 * by stage percent (or hit factor when percents aren't recorded), and flag the
 * toughest and strongest. Pure and defensive -- any missing/partial data degrades
 * gracefully and never throws.
 *
 * Honest scope: this reasons ONLY about points vs time vs percent. It does NOT
 * infer accuracy-vs-speed -- that needs the A/C/D/miss breakdown, which is Layer 2.
 */
export function analyzeMatch(stages: MatchStage[], powerFactor = 'Minor'): MatchInsights {
  const insights: StageInsight[] = (stages ?? []).map((st) => {
    // When a stage has a hit breakdown, its hit factor is DERIVED from the hits
    // (so a breakdown-only stage still ranks); otherwise use the manual points/time.
    const score = scoreStageHits(st, powerFactor, st.time);
    return {
      number: st.number,
      points: st.points,
      time: st.time,
      hitFactor: score ? score.hitFactor : hitFactor(st.points, st.time),
      percent: st.percent,
      notes: st.notes ?? '',
      rank: null,
      isToughest: false,
      isStrongest: false,
      score,
    };
  });

  const hasPercent = insights.some((s) => s.percent !== null && Number.isFinite(s.percent));
  const hasHf = insights.some((s) => s.hitFactor !== null);
  const rankedBy: MatchInsights['rankedBy'] = hasPercent ? 'percent' : hasHf ? 'hitFactor' : 'none';

  const metric = (s: StageInsight): number | null =>
    rankedBy === 'percent' ? s.percent : rankedBy === 'hitFactor' ? s.hitFactor : null;

  if (rankedBy === 'none') {
    return { stages: insights, rankedBy, strongest: null, toughest: [] };
  }

  // Rank only stages that have the chosen metric; highest first, ties broken by
  // stage number so the order is deterministic. These are the same object refs
  // as in `insights`, so setting flags here annotates the returned stages too.
  const ranked = insights
    .filter((s) => metric(s) !== null)
    .sort((a, b) => (metric(b) as number) - (metric(a) as number) || a.number - b.number);
  ranked.forEach((s, i) => { s.rank = i + 1; });

  if (ranked.length < 2) {
    return { stages: insights, rankedBy, strongest: null, toughest: [] };
  }

  const strongest = ranked[0];
  strongest.isStrongest = true;
  const toughCount = ranked.length >= 4 ? 2 : 1;
  const toughest = ranked.slice(ranked.length - toughCount);
  toughest.forEach((s) => { s.isToughest = true; });

  return { stages: insights, rankedBy, strongest, toughest };
}

// ---- Layer 2: per-stage hit breakdown -> derived USPSA scoring ----
// Scoring values (verified against USPSA scoring; to be cited in the in-app wiki):
//   alpha A = 5 (both PFs); charlie C = 4 (Major) / 3 (Minor); delta D = 2 (Major)
//   / 1 (Minor); miss / no-shoot / procedural = -10 each; hit factor = points /
//   time. A stage's points cannot go below zero (floored at 0).
// We DERIVE from the breakdown; we never store points/HF as independent truth, so
// they can't contradict the entered hits.

export type StageHitFields = Pick<MatchStage,
  'alphas' | 'charlies' | 'deltas' | 'misses' | 'noShoots' | 'procedurals'>;

export interface StageScore {
  powerFactor: 'Major' | 'Minor';
  alphas: number; charlies: number; deltas: number;
  misses: number; noShoots: number; procedurals: number;
  stagePoints: number;          // floored at 0
  availablePoints: number;      // 5 * scoring shots (A + C + D + M)
  pctAvailable: number | null;  // stagePoints / availablePoints (0.9 = 90%)
  hitFactor: number | null;     // stagePoints / time
  allAlphaHitFactor: number | null; // if every scoring shot were an A (NS/proc kept)
  allAlphaDelta: number | null;     // allAlphaHitFactor - hitFactor (the gain)
}

const round4 = (x: number): number => Math.round(x * 10000) / 10000;
const nonNeg = (x: number | null | undefined): number =>
  (typeof x === 'number' && Number.isFinite(x) && x > 0) ? x : 0;

/** True when a stage has ANY hit-breakdown value entered (0 counts as entered). */
export function hasHitBreakdown(s: StageHitFields): boolean {
  return [s.alphas, s.charlies, s.deltas, s.misses, s.noShoots, s.procedurals]
    .some((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * Derive a stage's USPSA score from its hit breakdown + power factor + time.
 * Returns null when NO breakdown is entered (caller falls back to legacy
 * points/time). Pure; floors stage points at 0; never throws on missing/partial
 * data. "All alphas" turns every scoring shot (including misses) into an A at the
 * same time, but keeps no-shoot/procedural penalties -- those are separate errors,
 * not accuracy, so the all-A hypothetical can't erase them (honest by design).
 */
export function scoreStageHits(
  hits: StageHitFields, powerFactor: string, time: number | null
): StageScore | null {
  if (!hasHitBreakdown(hits)) return null;
  const major = powerFactor === 'Major';
  const cVal = major ? 4 : 3;
  const dVal = major ? 2 : 1;
  const A = nonNeg(hits.alphas), C = nonNeg(hits.charlies), D = nonNeg(hits.deltas);
  const M = nonNeg(hits.misses), NS = nonNeg(hits.noShoots), P = nonNeg(hits.procedurals);
  const rawHitPoints = 5 * A + cVal * C + dVal * D;
  const penalties = 10 * (M + NS + P);
  const stagePoints = Math.max(0, rawHitPoints - penalties);
  const scoringShots = A + C + D + M;
  const availablePoints = 5 * scoringShots;
  const pctAvailable = availablePoints > 0 ? round4(stagePoints / availablePoints) : null;
  const t = (typeof time === 'number' && time > 0) ? time : null;
  const hitFactor = t ? round4(stagePoints / t) : null;
  const allAlphaStagePoints = Math.max(0, availablePoints - 10 * (NS + P));
  const allAlphaHitFactor = t ? round4(allAlphaStagePoints / t) : null;
  const allAlphaDelta = (hitFactor !== null && allAlphaHitFactor !== null)
    ? round4(allAlphaHitFactor - hitFactor) : null;
  return {
    powerFactor: major ? 'Major' : 'Minor',
    alphas: A, charlies: C, deltas: D, misses: M, noShoots: NS, procedurals: P,
    stagePoints, availablePoints, pctAvailable, hitFactor, allAlphaHitFactor, allAlphaDelta,
  };
}
