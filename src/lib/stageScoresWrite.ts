// Stage-scores importer -- PASS 2, storage half. Merges one accepted stage
// score (pass 1's AcceptedStageScore) onto a Match's existing stage array and
// writes it back. STAGE_SCORES_SPEC.md section 4, 6a Seat 8 condition 4.
//
// db.ts itself is NOT touched: this file only calls its existing exports
// (getOne/putOne), the same pattern every screen in this app already uses to
// read-then-write a record. The merge logic is kept pure and separate from
// the async read/write wrapper so it can be unit-tested without touching
// storage at all -- tests/stageScoresWrite.test.ts exercises both halves.

import { getOne, putOne } from './db.ts';
import { stampUpdate } from './stamps.ts';
import { hasHitBreakdown } from './competition.ts';
import type { Match } from './types.ts';
import type { AcceptedStageScore } from './stageScores.ts';

/** One stage's import provenance -- source page + when. */
export interface StageScoreProvenance {
  source: 'practiscore-stage-review';
  importedAt: number; // ms epoch
}

/** Keyed by stage number (as a string -- object keys are always strings), so
 *  importing stage 4 can never disturb stage 1's note, and re-importing the
 *  SAME stage updates its one entry in place rather than adding a second
 *  (spec: "one legacy note ... per stage"). Lives under match.legacy --
 *  additive alongside whatever else an importer may have already written
 *  there (e.g. PractiScoreImport's own `legacy.source`/`memberNumber` on the
 *  match), per the ADD-NEVER-REPLACE rule that governs everything on disk. */
export type StageScoreLog = Record<string, StageScoreProvenance>;

function readStageScoreLog(match: Match): StageScoreLog {
  const raw = (match.legacy as Record<string, unknown> | undefined)?.stageScores;
  return (raw && typeof raw === 'object') ? (raw as StageScoreLog) : {};
}

/** Whether this match already carries a hit breakdown for the given stage
 *  number -- the fact the screen's confirm-overwrite gate reads. `false`
 *  (never a throw) when the stage number doesn't exist at all; the caller
 *  finds that out for itself from the disk-driven stage list, not from here. */
export function stageFilled(match: Match, stageNumber: number): boolean {
  const st = match.stages.find((s) => s.number === stageNumber);
  return !!st && hasHitBreakdown(st);
}

/**
 * Merge one accepted stage score onto a match, ADDITIVELY: the six Layer-2
 * hit fields + `time` land on the existing stage at `stageNumber`; `percent`
 * is left exactly as it was (spec section 4 -- "Stage percent keeps its
 * existing value; do not touch it"). `points`/hit factor are never written
 * here -- they stay derived, same as any hand-entered breakdown.
 *
 * Pure. Never mutates its input; returns a brand-new Match object ready for
 * putOne, or `null` when the match has no stage at that number (the caller's
 * job is to never offer one that doesn't exist).
 */
export function applyStageScore(
  match: Match, stageNumber: number, accepted: AcceptedStageScore, now: number,
): Match | null {
  const idx = match.stages.findIndex((s) => s.number === stageNumber);
  if (idx === -1) return null;

  const stages = match.stages.slice();
  stages[idx] = {
    ...stages[idx],
    time: accepted.time,
    alphas: accepted.hits.alphas,
    charlies: accepted.hits.charlies,
    deltas: accepted.hits.deltas,
    misses: accepted.hits.misses,
    noShoots: accepted.hits.noShoots,
    procedurals: accepted.hits.procedurals,
  };

  const stageScores: StageScoreLog = {
    ...readStageScoreLog(match),
    [String(stageNumber)]: { source: 'practiscore-stage-review', importedAt: now },
  };

  return { ...match, stages, legacy: { ...(match.legacy ?? {}), stageScores } };
}

/** Thrown by commitStageScore -- the three ways a write can be refused, each
 *  distinguishable by `code` so the screen can render the right message
 *  rather than a generic failure. */
export class StageScoreWriteError extends Error {
  code: 'match-not-found' | 'stage-not-found' | 'stage-already-filled';
  constructor(code: 'match-not-found' | 'stage-not-found' | 'stage-already-filled') {
    super(code);
    this.name = 'StageScoreWriteError';
    this.code = code;
  }
}

/**
 * Read-then-write, for real (spec section 6a Seat 8 condition 4). Re-reads
 * the match from disk immediately before writing -- never a snapshot the
 * screen has been holding since it loaded, which could be stale if anything
 * else touched the match while the paste/confirm flow was on screen -- merges
 * the one accepted stage onto THAT fresh copy, and writes it back in one
 * `putOne`.
 *
 * `allowOverwrite` must be true to write over a stage that already carries a
 * hit breakdown; the screen's own explicit confirm-overwrite step is what
 * sets it. This function is the LAST guard, not just the screen's -- a
 * screen bug that skips its own confirm can never still overwrite silently.
 *
 * Writes nothing and throws StageScoreWriteError on any refusal.
 */
export async function commitStageScore(
  matchId: string, stageNumber: number, accepted: AcceptedStageScore, allowOverwrite: boolean,
): Promise<Match> {
  const fresh = await getOne<Match>('matches', matchId);
  if (!fresh) throw new StageScoreWriteError('match-not-found');
  if (stageFilled(fresh, stageNumber) && !allowOverwrite) throw new StageScoreWriteError('stage-already-filled');
  const updated = applyStageScore(fresh, stageNumber, accepted, Date.now());
  if (!updated) throw new StageScoreWriteError('stage-not-found');
  await putOne('matches', stampUpdate(updated, Date.now()));
  return updated;
}
