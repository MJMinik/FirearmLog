// "What it cost" + coaching read (T3-4): the match-level cost of the day's mistakes,
// and the debrief paragraph assembled from signals we already compute. Display math
// only -- these read the same stage fields the debrief uses and store nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchWhatItCost, coachingRead, PACE_QUESTION, analyzeMatch, matchSpeedAccuracy } from '../src/lib/competition.ts';
import type { MatchStage } from '../src/lib/types.ts';

const mk = (o: Partial<MatchStage>): MatchStage =>
  ({ number: 1, points: null, time: null, percent: null, notes: '', ...o });

// ---- USPSA ----

test('USPSA: penalty points, points down, and the anchored what-if percent', () => {
  const stages = [
    // 8A 1C 1M in 10s (Minor): 43 hit points - 10 penalty = 33; HF 3.3; all-A HF 5.0
    mk({ number: 1, time: 10, percent: 60, alphas: 8, charlies: 1, misses: 1 }),
    // 10A in 10s: 50 points; HF 5.0 = all-A HF
    mk({ number: 2, time: 10, percent: 90, alphas: 10 }),
  ];
  const r = matchWhatItCost(stages, 'uspsa', 'Minor');
  assert.equal(r?.discipline, 'uspsa');
  if (r?.discipline !== 'uspsa') return;
  assert.equal(r.misses, 1);
  assert.equal(r.penaltyPoints, 10);
  assert.equal(r.pointsDown, 7); // stage 1: 50 available - 43 hit points
  assert.equal(r.stagesUsed, 2);
  // Actual: (60*50 + 90*50) / 100 = 75. Hypothetical: stage 1 becomes 60 * (5/3.3) = 90.909...,
  // stage 2 stays 90 -> (4545.45 + 4500) / 100 = 90.5 (weighted by available points).
  assert.equal(r.actualPercent, 75);
  assert.equal(r.hypotheticalPercent, 90.5);
  assert.equal(r.exceeds100, false);
});

test('USPSA: a what-if past 100 is capped and flagged', () => {
  const stages = [
    // HF 3.3 at 95% implies a winner the all-A run (HF 5.0) would beat: 95 * 5/3.3 = 143.9
    mk({ number: 1, time: 10, percent: 95, alphas: 8, charlies: 1, misses: 1 }),
  ];
  const r = matchWhatItCost(stages, 'uspsa', 'Minor');
  assert.equal(r?.discipline, 'uspsa');
  if (r?.discipline !== 'uspsa') return;
  assert.equal(r.actualPercent, 95);
  assert.equal(r.hypotheticalPercent, 100); // capped
  assert.equal(r.exceeds100, true);
});

test('USPSA: the percent what-if needs EVERY stage anchored; points still compute without it', () => {
  const stages = [
    mk({ number: 1, time: 10, percent: 80, alphas: 8, charlies: 1, misses: 1 }),
    mk({ number: 2, time: 10, alphas: 9, noShoots: 1 }), // breakdown, but no stage percent
  ];
  const r = matchWhatItCost(stages, 'uspsa', 'Minor');
  assert.equal(r?.discipline, 'uspsa');
  if (r?.discipline !== 'uspsa') return;
  assert.equal(r.penaltyPoints, 20); // 1 miss + 1 no-shoot
  assert.equal(r.actualPercent, null);
  assert.equal(r.hypotheticalPercent, null);
});

test('USPSA: a stage with no hit breakdown blocks the percent anchor too', () => {
  const stages = [
    mk({ number: 1, time: 10, percent: 80, alphas: 10 }),
    mk({ number: 2, points: 40, time: 8, percent: 70 }), // legacy stage: points/time only
  ];
  const r = matchWhatItCost(stages, 'uspsa', 'Minor');
  assert.equal(r?.discipline, 'uspsa');
  if (r?.discipline !== 'uspsa') return;
  assert.equal(r.stagesUsed, 1);
  assert.equal(r.stagesTotal, 2);
  assert.equal(r.hypotheticalPercent, null); // a partial-day match percent would be a guess
});

test('USPSA: a typo percent (over 100) cannot anchor the what-if', () => {
  const stages = [mk({ number: 1, time: 10, percent: 600, alphas: 10 })];
  const r = matchWhatItCost(stages, 'uspsa', 'Minor');
  assert.equal(r?.discipline, 'uspsa');
  if (r?.discipline !== 'uspsa') return;
  assert.equal(r.hypotheticalPercent, null); // a stage winner is 100 by definition
  assert.equal(r.exceeds100, false);
});

test('USPSA: null when no stage has a hit breakdown', () => {
  assert.equal(matchWhatItCost([mk({ number: 1, points: 40, time: 8 })], 'uspsa', 'Minor'), null);
});

// ---- IDPA ----

test('IDPA: the cost is already in seconds; clean total keeps penalties (down-zero only)', () => {
  const stages = [
    mk({ number: 1, time: 20, idpaDown1: 4, idpaProceduralErrors: 1 }), // 20 + 4 + 3 = 27; clean 23
    mk({ number: 2, time: 30, idpaDown3: 2 }),                          // 30 + 6 = 36; clean 30
  ];
  const r = matchWhatItCost(stages, 'idpa');
  assert.equal(r?.discipline, 'idpa');
  if (r?.discipline !== 'idpa') return;
  assert.equal(r.downSeconds, 10);
  assert.equal(r.penaltySeconds, 3);
  assert.equal(r.costSeconds, 13);
  assert.equal(r.totalTime, 63);
  assert.equal(r.cleanTotal, 53); // penalties stay: they're separate errors, not accuracy
});

// ---- Steel ----

test('Steel: the clean what-if re-drops the slowest string, so misses can cost less than 3s each', () => {
  const stages = [mk({
    number: 1,
    strings: [3.0, 3.1, 3.2, 3.3, 4.0],
    stringMisses: [2, 0, 0, 0, 0], // string 1 scores 9.0 and becomes the drop
  })];
  const r = matchWhatItCost(stages, 'steel');
  assert.equal(r?.discipline, 'steel');
  if (r?.discipline !== 'steel') return;
  assert.equal(r.misses, 2);
  assert.equal(r.missSeconds, 6);
  assert.equal(r.totalTime, 13.6);  // 3.1 + 3.2 + 3.3 + 4.0 -- the 9.0 string is the drop
  assert.equal(r.cleanTotal, 12.6); // 3.0 + 3.1 + 3.2 + 3.3 -- clean drops the 4.0 instead: the misses truly cost 1.0s
});

test('Steel: a missed stop plate stays at the 30s maximum in the clean what-if (time unknown)', () => {
  const stages = [mk({
    number: 1,
    strings: [3, 3, 3, 3, null],
    stringStopMissed: [false, false, false, false, true],
  })];
  const r = matchWhatItCost(stages, 'steel');
  assert.equal(r?.discipline, 'steel');
  if (r?.discipline !== 'steel') return;
  assert.equal(r.totalTime, 12);   // the 30s string is the drop
  assert.equal(r.cleanTotal, 12);  // unchanged: an unfinished string's real time is unknowable
});

// ---- Coaching read ----

test('coaching read (USPSA): toughest stage with penalties + points kept; no pace question when not clean', () => {
  const stages = [
    mk({ number: 1, time: 10, percent: 80, alphas: 10 }),
    mk({ number: 2, time: 10, percent: 50, alphas: 7, charlies: 1, misses: 2 }),
  ];
  const read = coachingRead(analyzeMatch(stages, 'Minor'), matchSpeedAccuracy(stages, 'uspsa', 'Minor'));
  assert.equal(read.length, 2);
  assert.equal(read[0], 'Stage 2 was the expensive one -- 2 misses there cost about 20 points.');
  assert.equal(read[1], 'Across the match you kept 88% of your points.');
});

test('coaching read (USPSA): the expensive stage wins even when another stage ranked tougher', () => {
  const stages = [
    // Toughest by percent (50%) but clean -- slow, not sloppy.
    mk({ number: 1, time: 10, percent: 50, alphas: 10 }),
    // Higher percent but 2 misses: this is the one the mistakes actually cost.
    mk({ number: 2, time: 10, percent: 80, alphas: 8, misses: 2 }),
  ];
  const read = coachingRead(analyzeMatch(stages, 'Minor'), matchSpeedAccuracy(stages, 'uspsa', 'Minor'));
  assert.equal(read[0], 'Stage 2 was the expensive one -- 2 misses there cost about 20 points.');
  assert.equal(read[1], 'Across the match you kept 90% of your points.');
});

test('coaching read (USPSA): a very clean match gets the pace question', () => {
  const stages = [
    mk({ number: 1, time: 10, percent: 80, alphas: 10 }),
    mk({ number: 2, time: 10, percent: 90, alphas: 9, charlies: 1 }),
  ];
  const read = coachingRead(analyzeMatch(stages, 'Minor'), matchSpeedAccuracy(stages, 'uspsa', 'Minor'));
  assert.equal(read.length, 3);
  assert.equal(read[read.length - 1], PACE_QUESTION);
});

test('coaching read (IDPA): pace question only, and only when very clean', () => {
  const clean = [
    mk({ number: 1, time: 20, idpaDown1: 1 }),
    mk({ number: 2, time: 20, idpaDown1: 1 }),
  ];
  assert.deepEqual(
    coachingRead(analyzeMatch(clean), matchSpeedAccuracy(clean, 'idpa')), [PACE_QUESTION]);
  const notClean = [
    mk({ number: 1, time: 20, idpaDown3: 3 }),
    mk({ number: 2, time: 20, idpaDown3: 3 }),
  ];
  assert.deepEqual(coachingRead(analyzeMatch(notClean), matchSpeedAccuracy(notClean, 'idpa')), []);
});

test('coaching read: empty when there is nothing to compute', () => {
  assert.deepEqual(coachingRead(analyzeMatch([]), null), []);
});
