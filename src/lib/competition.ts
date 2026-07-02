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

/** IDPA's 8 divisions (official 2026.2 IDPA Rulebook Sec 8.1.1.1) -- a distinct set from
 *  USPSA's above. Used for the division picker when a match's scoringType is 'idpa'. */
export const IDPA_DIVISIONS = [
  'Stock Service Pistol (SSP)', 'Enhanced Service Pistol (ESP)', 'Custom Defensive Pistol (CDP)',
  'Compact Carry Pistol (CCP)', 'Revolver (REV)', 'Backup Gun (BUG)', 'Carry Optics (CO)',
  'Pistol Caliber Carbine (PCC)'
];

export const POWER_FACTORS = ['Minor', 'Major'];

/** Stage hit factor: points per second. */
export function hitFactor(points: number | null, time: number | null): number | null {
  if (points === null || time === null || !(time > 0) || points < 0) return null;
  return Math.round((points / time) * 10000) / 10000;
}

/** Exact rulebook quotes for USPSA stage scoring, so the in-app wiki can show the
 *  source verbatim rather than paraphrasing. Direct quotations from the official
 *  USPSA Competition Rules, edition 2026-03 (rules.uspsa.org/uspsa); `section`
 *  locates each. The A/C/D point values live in Appendix B1's scoring-zone table. */
export const USPSA_SCORING_QUOTES = [
  { section: 'Appendix B1 (Scoring Zones – All Cardboard Targets)', quote:
    'A 5 5 · C 4 3 · D 2 1 (Scoring Zone / Major Power Factor / Minor Power Factor).' },
  { section: 'Rule 9.2.2.1 (Comstock)', quote:
    'A competitor’s score is calculated by adding the highest value stipulated number of hits per target, minus penalties, divided by the total time (recorded to two decimal places) taken by the competitor to complete the course of fire, to arrive at a hit factor.' },
  { section: 'Rule 9.4.4 (miss)', quote:
    'Each miss will be penalized twice the value of the maximum scoring hit available on that target…' },
  { section: 'Rule 9.4.2 (no-shoot)', quote:
    'Each hit visible on the scoring area of a cardboard no-shoot will be penalized the equivalent of twice the point value of a maximum scoring hit.' },
  { section: 'Rule 10.1.2 (procedural)', quote:
    'If the maximum available scoring hit on a cardboard target is 5 points, each procedural penalty will be minus 10 points.' },
] as const;

/** Exact rulebook quotes for USPSA classification. Direct quotations from the
 *  official USPSA Classification System document (github.com/USPSA-public/Classification,
 *  the source USPSA publishes at uspsa.org/classification/about). */
export const USPSA_CLASS_QUOTES = [
  { section: 'Earning A Classification', quote:
    'If more than four scores are in the database when the averages are calculated, the best six of the most recent eight valid scores will be used.' },
  { section: 'Classification Bracket Percentages', quote:
    'Grand Master 95 to 110% · Master 85 to 94.9% · A 75 to 84.9% · B 60 to 74.9% · C 40 to 59.9% · D 2 to 40%.' },
] as const;

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

// ---- Steel Challenge (SCSA) scoring: time-only, best-4-of-5 ----
// Cited (SCSA rulebook; to be shown in the in-app "How the numbers work" wiki):
//   Each string scores its raw time + 3.00s per missed plate, capped at 30.00s;
//   a string whose stop plate is never hit scores the 30.00s maximum. A stage takes
//   the best 4 of 5 strings (drop the single slowest); "Outer Limits" is 4 strings
//   scored best 3 of 4 (also drop the single slowest). Match total = sum of stage
//   times; LOWEST wins.

export const STEEL_MAX_STRING = 30;   // seconds — per-string maximum / stop-plate-missed value
export const STEEL_MISS_PENALTY = 3;  // seconds added per missed plate

/** Exact rulebook quotes for Steel Challenge scoring, so the in-app wiki can show
 *  the source verbatim. Direct quotations from the official Steel Challenge Rules,
 *  edition 2026-03 (rules.uspsa.org/scsa); `section` locates each.
 *  Outer Limits (rule 9.1.2) counts "the best three out of four strings" — the slowest
 *  of its four strings is dropped, which is exactly what scoreSteelStage does. */
export const STEEL_RULE_QUOTES = [
  { section: 'Rule 9.3 (misses – standard plates)', quote:
    'Each Miss on a standard plate will result in a 3 second penalty, added to the competitor’s time for that string.' },
  { section: 'Rule 9.2 / 9.2.1 (maximum time)', quote:
    'The maximum score for any string is 30 seconds, no matter how many misses or penalties may have been accrued during the string.' },
  { section: 'Rule 9.4 (misses – stop plate)', quote:
    'If the stop plate is not hit, the score for that string is 30 seconds.' },
  { section: 'Rule 9.1.2 (strings counted)', quote:
    'The best four out of five strings will be counted as the total score for each stage, except for Outer Limits, which will be the best three out of four strings.' },
] as const;

/** The 8 official SCSA classifier stages; Outer Limits is the only 4-string stage. */
export const STEEL_STAGES: { name: string; strings: 4 | 5 }[] = [
  { name: '5 to Go', strings: 5 },
  { name: 'Showdown', strings: 5 },
  { name: 'Smoke & Hope', strings: 5 },
  { name: 'Outer Limits', strings: 4 },
  { name: 'Accelerator', strings: 5 },
  { name: 'Pendulum', strings: 5 },
  { name: 'Speed Option', strings: 5 },
  { name: 'Roundabout', strings: 5 },
];

export interface SteelStringScore {
  raw: number | null;
  misses: number;
  stopMissed: boolean;
  capped: number | null; // min(raw + misses*3, 30); 30 if stop plate missed; null if not entered
}
export interface SteelStageScore {
  strings: SteelStringScore[];
  stringsExpected: 4 | 5;
  droppedIndex: number | null; // index of the single dropped (slowest) string; null when none dropped
  stageTime: number | null;    // sum of the counted strings; null if nothing entered
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Number of strings SHOT: Outer Limits is 4 (scored best 3 of 4); every other stage is 5 (best 4 of 5). */
export function steelStringsExpected(steelStage?: string): 4 | 5 {
  return steelStage === 'Outer Limits' ? 4 : 5;
}

export interface SteelStageInput {
  strings?: (number | null)[];
  stringMisses?: (number | null)[];
  stringStopMissed?: boolean[];
  steelStage?: string;
}

/**
 * Score a Steel Challenge stage. Pure; never throws; unentered strings are ignored.
 * Drops the single slowest string: best 4 of 5, and best 3 of 4 on Outer Limits.
 * (Partial entries keep whatever is entered; nothing drops until the full set is in.)
 * Times round to 0.01s (the timer's resolution).
 */
export function scoreSteelStage(stage: SteelStageInput): SteelStageScore {
  const raws = stage.strings ?? [];
  const missesArr = stage.stringMisses ?? [];
  const stopArr = stage.stringStopMissed ?? [];
  const expected = steelStringsExpected(stage.steelStage);
  const scored: SteelStringScore[] = raws.map((raw, i) => {
    const misses = nonNeg(missesArr[i]);
    const stopMissed = stopArr[i] === true;
    const rawNum = (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) ? raw : null;
    let capped: number | null;
    if (stopMissed) capped = STEEL_MAX_STRING;
    else if (rawNum !== null) capped = Math.min(round2(rawNum + misses * STEEL_MISS_PENALTY), STEEL_MAX_STRING);
    else capped = null; // not entered
    return { raw: rawNum, misses, stopMissed, capped };
  });
  const counted = scored.map((s, i) => (s.capped !== null ? i : -1)).filter((i) => i >= 0);
  if (counted.length === 0) {
    return { strings: scored, stringsExpected: expected, droppedIndex: null, stageTime: null };
  }
  // Drop the single slowest string: best 4 of 5, and best 3 of 4 on Outer Limits
  // (SCSA rule 9.1.2). keepCount clamps below, so nothing drops until the full set
  // is entered (a partial stage keeps whatever was logged).
  const keepCount = expected - 1;
  const byTimeAsc = [...counted].sort((a, b) => (scored[a].capped as number) - (scored[b].capped as number));
  const keep = byTimeAsc.slice(0, Math.min(keepCount, byTimeAsc.length));
  const dropped = byTimeAsc.slice(Math.min(keepCount, byTimeAsc.length));
  const droppedIndex = dropped.length === 1 ? dropped[0] : null;
  const stageTime = round2(keep.reduce((sum, i) => sum + (scored[i].capped as number), 0));
  return { strings: scored, stringsExpected: expected, droppedIndex, stageTime };
}

/** Steel match total = sum of stage times; lowest wins. Null if no stage is scored. */
export function steelMatchTotal(stages: SteelStageInput[]): number | null {
  let total = 0;
  let any = false;
  for (const st of stages ?? []) {
    const s = scoreSteelStage(st);
    if (s.stageTime !== null) { total += s.stageTime; any = true; }
  }
  return any ? round2(total) : null;
}

// ---- IDPA scoring (time-plus): stage = raw time + points down (1s each) + penalties ----
// Values verified against the official 2026.2 IDPA Rulebook. The in-app "How the numbers
// work" wiki shows each with its VERBATIM rulebook quote + section (see IDPA_RULE_QUOTES).
// FTN ("Failure to Neutralize") was REMOVED -- it is absent from the 2026 rulebook; too-few
// hits show up as misses (-5 each) plus a PE, not a separate penalty. A non-threat hit is
// the 5s HNT penalty and is NOT also counted as points down (no double-count). Match total
// = sum of stage times; LOWEST wins.
export const IDPA_SECONDS_PER_POINT_DOWN = 1;
export const IDPA_DOWN1_POINTS = 1; // points down for a -1 hit
export const IDPA_DOWN3_POINTS = 3; // points down for a -3 hit
export const IDPA_MISS_POINTS = 5; // points down for a miss (-5)
export const IDPA_HNT_SECONDS = 5; // seconds per hit on a non-threat
export const IDPA_PE_SECONDS = 3; // seconds per procedural error
export const IDPA_FP_SECONDS = 10; // seconds per flagrant penalty
export const IDPA_FTDR_SECONDS = 20; // seconds for a failure to do right

/** Exact rulebook quotes for each value, so the in-app wiki can show the source verbatim.
 *  Direct quotations from the official 2026.2 IDPA Rulebook; `section` locates each. */
export const IDPA_RULE_QUOTES = [
  { section: 'Sec 4', quote: 'Each point down adds 1 second to the time for the stage.' },
  { section: 'Sec 4.1.3', quote:
    'The raw time is added to the total points down for the stage multiplied by 1 second, and then added to any other penalties if applicable.' },
  { section: 'Sec 4.12.1.1', quote: 'Threat targets will be scored as marked, as -0, -1, -3, and a miss is -5.' },
  { section: 'Sec 4.11.2', quote: 'Each hit on a Non-Threat adds 5 seconds to the shooter’s score.' },
  { section: 'Sec 5.1.1', quote: 'Procedural Errors add 3 seconds per infraction.' },
  { section: 'Sec 5.2.1', quote: 'A Flagrant Penalty (FP) adds ten (10) seconds.' },
  { section: 'Sec 5.3.1', quote: 'A 20 second Failure To Do Right penalty is assessed for gross unsportsmanlike conduct.' },
] as const;

export interface IdpaStageInput {
  time?: number | null; // raw time from the timer (seconds)
  idpaDown0?: number | null;
  idpaDown1?: number | null;
  idpaDown3?: number | null;
  idpaMisses?: number | null;
  idpaNonThreatHits?: number | null;
  idpaProceduralErrors?: number | null;
  idpaFlagrantPenalties?: number | null;
  idpaFailureToDoRight?: number | null;
}

export interface IdpaStageScore {
  rawTime: number | null;
  down0: number; down1: number; down3: number; misses: number;
  nonThreatHits: number; proceduralErrors: number; flagrantPenalties: number; failureToDoRight: number;
  pointsDown: number; // down1*1 + down3*3 + misses*5
  accuracySeconds: number; // pointsDown x 1s -- the time cost of dropped points
  penaltySeconds: number; // HNT*5 + PE*3 + FP*10 + FTDR*20
  stageTime: number | null; // raw + accuracy + penalty; null until a raw time is recorded
  cleanTime: number | null; // raw + penalty (every hit -0): the honest down-zero reference
}

/**
 * Score an IDPA stage (time-plus). Pure; never throws; negative/blank counts are ignored.
 * pointsDown converts hit zones to seconds at 1s each (-1 = 1, -3 = 3, miss = 5); penalties
 * add their fixed seconds. A non-threat hit is the 5s HNT penalty ONLY (never also points
 * down). stageTime is null until a raw time is recorded (nothing to add penalties to yet).
 * Times round to 0.01s. `cleanTime` is an honest "if every hit were -0" reference that KEEPS
 * penalties (they aren't accuracy), so the down-zero hypothetical can't erase a procedural.
 */
export function scoreIdpaStage(stage: IdpaStageInput): IdpaStageScore {
  const down0 = nonNeg(stage.idpaDown0), down1 = nonNeg(stage.idpaDown1),
    down3 = nonNeg(stage.idpaDown3), misses = nonNeg(stage.idpaMisses);
  const hnt = nonNeg(stage.idpaNonThreatHits), pe = nonNeg(stage.idpaProceduralErrors),
    fp = nonNeg(stage.idpaFlagrantPenalties), ftdr = nonNeg(stage.idpaFailureToDoRight);
  const pointsDown = down1 * IDPA_DOWN1_POINTS + down3 * IDPA_DOWN3_POINTS + misses * IDPA_MISS_POINTS;
  const accuracySeconds = pointsDown * IDPA_SECONDS_PER_POINT_DOWN;
  const penaltySeconds =
    hnt * IDPA_HNT_SECONDS + pe * IDPA_PE_SECONDS + fp * IDPA_FP_SECONDS + ftdr * IDPA_FTDR_SECONDS;
  const rawTime =
    typeof stage.time === 'number' && Number.isFinite(stage.time) && stage.time >= 0 ? stage.time : null;
  const stageTime = rawTime !== null ? round2(rawTime + accuracySeconds + penaltySeconds) : null;
  const cleanTime = rawTime !== null ? round2(rawTime + penaltySeconds) : null;
  return {
    rawTime, down0, down1, down3, misses,
    nonThreatHits: hnt, proceduralErrors: pe, flagrantPenalties: fp, failureToDoRight: ftdr,
    pointsDown, accuracySeconds, penaltySeconds, stageTime, cleanTime,
  };
}

/** IDPA match total = sum of stage times; lowest wins. Null if no stage has a time. */
export function idpaMatchTotal(stages: IdpaStageInput[]): number | null {
  let total = 0;
  let any = false;
  for (const st of stages ?? []) {
    const s = scoreIdpaStage(st);
    if (s.stageTime !== null) { total += s.stageTime; any = true; }
  }
  return any ? round2(total) : null;
}

/** Reconcile a FirearmLog-computed time against an entered official time (for the
 *  time-plus sports, Steel + IDPA). diff = official - ours (positive = the official is
 *  higher than ours), rounded to 0.01s; `matches` when within half a hundredth of a
 *  second. Null-safe: a blank side yields no diff. Pure. */
export function reconcileTime(ours: number | null, official: number | null): { diff: number | null; matches: boolean } {
  if (ours == null || official == null || !Number.isFinite(ours) || !Number.isFinite(official)) {
    return { diff: null, matches: false };
  }
  const diff = round2(official - ours);
  return { diff, matches: Math.abs(diff) < 0.005 };
}

/** Derive a match's scoring system from its match type (used to default new matches). */
export function scoringTypeFor(matchType: string): 'uspsa' | 'idpa' | 'steel' {
  if (matchType === 'Steel Challenge') return 'steel';
  if (matchType.startsWith('IDPA')) return 'idpa';
  return 'uspsa';
}
