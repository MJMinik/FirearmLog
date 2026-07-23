import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeMatch, classFor, classificationProgress, classificationWindow, hitFactor,
  isMinorOnly, MINOR_ONLY_DIVISIONS, nextClassifierNeeded, scoreStageHits,
} from '../src/lib/competition.ts';
import type { MatchStage } from '../src/lib/types.ts';

const stage = (number: number, points: number | null, time: number | null,
  percent: number | null = null, notes = ''): MatchStage => ({ number, points, time, percent, notes });

test('hit factor is points per second, rounded to 4 places', () => {
  assert.equal(hitFactor(130, 25.55), 5.0881);
  assert.equal(hitFactor(0, 10), 0);
  assert.equal(hitFactor(100, 0), null);
  assert.equal(hitFactor(null, 10), null);
  assert.equal(hitFactor(100, null), null);
});

test('class bands match USPSA', () => {
  assert.equal(classFor(96), 'GM');
  assert.equal(classFor(95), 'GM');
  assert.equal(classFor(85), 'M');
  assert.equal(classFor(75), 'A');
  assert.equal(classFor(60), 'B');
  assert.equal(classFor(59.99), 'C');
  assert.equal(classFor(40), 'C');
  assert.equal(classFor(39.99), 'D');
});

test('progress: best 6 of the most recent 8', () => {
  // 10 scores; the two oldest (90s) must NOT count.
  const scores = [
    { date: '2026-01-01', percent: 90 }, { date: '2026-01-02', percent: 90 },
    { date: '2026-02-01', percent: 50 }, { date: '2026-02-02', percent: 52 },
    { date: '2026-03-01', percent: 54 }, { date: '2026-03-02', percent: 56 },
    { date: '2026-04-01', percent: 58 }, { date: '2026-04-02', percent: 60 },
    { date: '2026-05-01', percent: 44 }, { date: '2026-05-02', percent: 46 }
  ];
  const p = classificationProgress(scores);
  // recent 8: 52..60 plus 44,46 → best 6: 60,58,56,54,52,50? No — 50 is 9th oldest, excluded.
  // recent 8 = 46,44,60,58,56,54,52,50? recent by date desc: 46,44,60,58,56,54,52,50 → 50 IS in (8th).
  assert.equal(p.scoresUsed.length, 6);
  assert.deepEqual(p.scoresUsed, [60, 58, 56, 54, 52, 50]);
  assert.equal(p.average, 55);
  assert.equal(p.currentClass, 'C');
  assert.deepEqual(p.next, { name: 'B', threshold: 60 });
});

test('fewer than 4 scores: average shows progress but no class is granted (USPSA min-4)', () => {
  const p = classificationProgress([
    { date: '2026-01-01', percent: 61 },
    { date: '2026-02-01', percent: 63 },
    { date: '2026-03-01', percent: null }
  ]);
  assert.equal(p.average, 62);
  assert.equal(p.currentClass, null); // 2 valid scores — the sport grants no class yet
  assert.equal(p.scoresOnRecord, 2);
  assert.deepEqual(p.next, { name: 'A', threshold: 75 }); // progress target still shown
});

test('exactly 4 scores is the boundary where a class is granted', () => {
  const scores = [61, 63, 65, 67].map((percent, i) => ({ date: `2026-0${i + 1}-01`, percent }));
  assert.equal(classificationProgress(scores.slice(0, 3)).currentClass, null);
  assert.equal(classificationProgress(scores).currentClass, 'B');
});

test('one hot score cannot mint a GM badge', () => {
  const p = classificationProgress([{ date: '2026-01-01', percent: 96 }]);
  assert.equal(p.average, 96);
  assert.equal(p.currentClass, null);
  assert.equal(p.next, null); // would-be GM — nothing above to climb toward
});

test('M-10: each classifier score is capped at USPSA\'s 110% ceiling before averaging', () => {
  // One score computed above the 110% ceiling must count as 110, not 115.
  const p = classificationProgress([
    { date: '2026-01-01', percent: 115 }, // over the ceiling → treated as 110
    { date: '2026-02-01', percent: 110 }, // exactly at the ceiling → unchanged
    { date: '2026-03-01', percent: 100 },
    { date: '2026-04-01', percent: 90 },
  ]);
  assert.deepEqual(p.scoresUsed, [110, 110, 100, 90]); // the 115 became 110
  assert.equal(p.average, 102.5); // (110 + 110 + 100 + 90) / 4, not 103.75
  assert.equal(p.currentClass, 'GM');
});

test('M-10: a score just under the ceiling (109.9%) is left untouched', () => {
  const p = classificationProgress([
    { date: '2026-01-01', percent: 109.9 },
    { date: '2026-02-01', percent: 90 },
    { date: '2026-03-01', percent: 80 },
    { date: '2026-04-01', percent: 70 },
  ]);
  assert.equal(p.scoresUsed[0], 109.9); // below the 110 cap → unchanged
});

test('progress with nothing returns empty', () => {
  const p = classificationProgress([]);
  assert.equal(p.average, null);
  assert.equal(p.currentClass, null);
});

test('analyzeMatch ranks by stage percent and flags toughest + strongest', () => {
  const a = analyzeMatch([stage(1, 80, 8, 90), stage(2, 60, 12, 54), stage(3, 70, 9, 72)]);
  assert.equal(a.rankedBy, 'percent');
  assert.equal(a.strongest?.number, 1);
  assert.deepEqual(a.toughest.map((s) => s.number), [2]);
  assert.equal(a.stages.find((s) => s.number === 2)?.isToughest, true);
  assert.equal(a.stages.find((s) => s.number === 1)?.isStrongest, true);
});

test('analyzeMatch falls back to hit factor when no percents recorded', () => {
  const a = analyzeMatch([stage(1, 80, 8), stage(2, 60, 12)]); // HF 10 vs 5
  assert.equal(a.rankedBy, 'hitFactor');
  assert.equal(a.strongest?.number, 1);
  assert.deepEqual(a.toughest.map((s) => s.number), [2]);
});

test('analyzeMatch: 4+ stages flag the two toughest', () => {
  const a = analyzeMatch([stage(1, 100, 10, 95), stage(2, 50, 10, 50), stage(3, 80, 10, 80), stage(4, 40, 10, 40)]);
  assert.equal(a.strongest?.number, 1);
  assert.deepEqual(a.toughest.map((s) => s.number).sort(), [2, 4]);
});

test('analyzeMatch: a single stage gets no toughest/strongest flags', () => {
  const a = analyzeMatch([stage(1, 80, 8, 90)]);
  assert.equal(a.strongest, null);
  assert.deepEqual(a.toughest, []);
  assert.equal(a.stages[0].isToughest, false);
  assert.equal(a.stages[0].isStrongest, false);
});

test('analyzeMatch: empty and all-null data degrade to none without throwing', () => {
  assert.equal(analyzeMatch([]).rankedBy, 'none');
  const a = analyzeMatch([stage(1, null, null), stage(2, null, null)]);
  assert.equal(a.rankedBy, 'none');
  assert.equal(a.strongest, null);
  assert.deepEqual(a.toughest, []);
});

test('scoreStageHits: minor 1A 1C in 2s = HF 4.0, all-alpha 5.0 (+1.0)', () => {
  const r = scoreStageHits({ alphas: 1, charlies: 1 }, 'Minor', 2)!;
  assert.equal(r.stagePoints, 8);        // 5 + 3
  assert.equal(r.availablePoints, 10);   // 2 scoring shots * 5
  assert.equal(r.pctAvailable, 0.8);
  assert.equal(r.hitFactor, 4);
  assert.equal(r.allAlphaHitFactor, 5);
  assert.equal(r.allAlphaDelta, 1);
});

test('scoreStageHits: major charlie is worth more than minor', () => {
  const r = scoreStageHits({ alphas: 1, charlies: 1 }, 'Major', 2)!;
  assert.equal(r.stagePoints, 9);        // 5 + 4
  assert.equal(r.hitFactor, 4.5);
});

test('scoreStageHits: a miss zeroes a 2-shot stage; all-alpha shows the gain', () => {
  const r = scoreStageHits({ alphas: 1, misses: 1 }, 'Major', 2)!;
  assert.equal(r.stagePoints, 0);        // max(0, 5 - 10)
  assert.equal(r.hitFactor, 0);
  assert.equal(r.availablePoints, 10);   // the miss still counts as a scoring shot
  assert.equal(r.allAlphaHitFactor, 5);  // both shots as A: 10 / 2
  assert.equal(r.allAlphaDelta, 5);
});

test('scoreStageHits: all-alphas cannot erase a no-shoot/procedural', () => {
  const r = scoreStageHits({ alphas: 2, noShoots: 1 }, 'Major', 2)!;
  assert.equal(r.stagePoints, 0);        // 10 - 10
  assert.equal(r.availablePoints, 10);   // 2 scoring shots (NS is not one)
  assert.equal(r.allAlphaHitFactor, 0);  // (10 - 10) / 2
  assert.equal(r.allAlphaDelta, 0);
});

test('scoreStageHits: no breakdown returns null (legacy mode)', () => {
  assert.equal(scoreStageHits({}, 'Minor', 10), null);
  assert.equal(scoreStageHits({ alphas: null, charlies: null }, 'Minor', 10), null);
});

test('scoreStageHits: an explicit 0 still counts as a breakdown', () => {
  assert.notEqual(scoreStageHits({ alphas: 0, misses: 2 }, 'Minor', 4), null);
});

test('scoreStageHits: no time yields null hit factors but keeps counts/points', () => {
  const r = scoreStageHits({ alphas: 2 }, 'Major', null)!;
  assert.equal(r.stagePoints, 10);
  assert.equal(r.hitFactor, null);
  assert.equal(r.allAlphaDelta, null);
});

// ---- T3-5: classificationWindow + nextClassifierNeeded ----

test('classificationWindow: agrees with classificationProgress on the same average (incl. ties)', () => {
  // Same 10-score fixture as "progress: best 6 of the most recent 8" above, with
  // a tie added at the very top (two 90s) so the tie-break path is exercised too.
  const scores = [
    { date: '2026-01-01', percent: 90 }, { date: '2026-01-02', percent: 90 },
    { date: '2026-02-01', percent: 50 }, { date: '2026-02-02', percent: 52 },
    { date: '2026-03-01', percent: 54 }, { date: '2026-03-02', percent: 56 },
    { date: '2026-04-01', percent: 58 }, { date: '2026-04-02', percent: 60 },
    { date: '2026-05-01', percent: 44 }, { date: '2026-05-02', percent: 46 }
  ];
  const progress = classificationProgress(scores);
  const rows = classificationWindow(scores);
  assert.equal(rows.length, 8); // most recent 8 only
  const used = rows.filter((r) => r.counts);
  assert.equal(used.length, progress.scoresUsed.length);
  const avg = Math.round((used.reduce((s, r) => s + r.percent, 0) / used.length) * 100) / 100;
  assert.equal(avg, progress.average);
  // 10 on record -> the oldest row of the 8-window drops with the next score.
  assert.equal(rows[rows.length - 1].dropsNext, true);
  assert.equal(rows.slice(0, -1).every((r) => !r.dropsNext), true);
});

test('classificationWindow: fewer than 8 on record -- nothing drops, everything counts', () => {
  const rows = classificationWindow([
    { date: '2026-01-01', percent: 50 }, { date: '2026-01-02', percent: 55 },
    { date: '2026-01-03', percent: 60 },
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows.every((r) => r.counts), true); // only 3 scores, all <= 6 count
  assert.equal(rows.every((r) => !r.dropsNext), true); // fewer than 8 on record
});

test('classificationWindow: preserves extra fields (e.g. a classifier\'s name) by identity', () => {
  const rows = classificationWindow([
    { date: '2026-01-01', percent: 60, code: '03-09', name: 'On the Move' },
  ]);
  assert.equal(rows[0].code, '03-09');
  assert.equal(rows[0].name, 'On the Move');
  assert.equal(rows[0].percent, 60);
});

test('nextClassifierNeeded: unclassified (fewer than 4 scores) returns null', () => {
  const p = nextClassifierNeeded([
    { date: '2026-01-01', percent: 60 }, { date: '2026-01-02', percent: 60 }, { date: '2026-01-03', percent: 60 },
  ]);
  assert.equal(p, null);
});

test('nextClassifierNeeded: already Grand Master returns null (top of the ladder)', () => {
  const p = nextClassifierNeeded([
    { date: '2026-01-01', percent: 96 }, { date: '2026-01-02', percent: 96 },
    { date: '2026-01-03', percent: 96 }, { date: '2026-01-04', percent: 96 },
  ]);
  assert.equal(p, null);
});

test('nextClassifierNeeded: fewer than 8 scores -- no drop, straightforward average', () => {
  // 4 scores at 50%; window would be [S,50,50,50,50] (size 5, all count).
  // (S + 200) / 5 >= 60 -> S >= 100.
  const p = nextClassifierNeeded([
    { date: '2026-01-01', percent: 50 }, { date: '2026-01-02', percent: 50 },
    { date: '2026-01-03', percent: 50 }, { date: '2026-01-04', percent: 50 },
  ]);
  assert.deepEqual(p, { percent: 100 });
});

test('nextClassifierNeeded: exactly 8 -- the dropped (oldest) score WAS counting, so the drop matters', () => {
  // 8 scores; oldest (80%) is high enough to be one of the current best-6 (top-6 of
  // {80,58,56,54,52,50,48,46} = 80,58,56,54,52,50 -> avg 58.33, C -> next B@60).
  // Once it drops, the kept 7 are 58,56,54,52,50,48,46. Window = [S, those 7]; for
  // S >= 58 the bottom two (48,46) drop, top6 = S + 58+56+54+52+50 = S + 270.
  // S + 270 >= 360 -> S >= 90.
  const scores = [
    { date: '2026-01-08', percent: 58 }, { date: '2026-01-07', percent: 56 },
    { date: '2026-01-06', percent: 54 }, { date: '2026-01-05', percent: 52 },
    { date: '2026-01-04', percent: 50 }, { date: '2026-01-03', percent: 48 },
    { date: '2026-01-02', percent: 46 }, { date: '2026-01-01', percent: 80 },
  ];
  const progress = classificationProgress(scores);
  assert.equal(progress.currentClass, 'C');
  assert.equal(progress.next?.threshold, 60);
  const rows = classificationWindow(scores);
  assert.equal(rows[rows.length - 1].counts, true); // the oldest (80) WAS counting
  const p = nextClassifierNeeded(scores);
  assert.deepEqual(p, { percent: 90 });
});

test('nextClassifierNeeded: exactly 8 -- the dropped (oldest) score was NOT counting, so nothing changes', () => {
  // 8 scores; seven 70s plus an oldest 40 that was already excluded from the
  // best-6 (top-6 of eight 70/40 values is six 70s -- neither the 40 nor the
  // 7th 70 counts). Current avg 70 -> B, next A@75. Dropping the 40 removes a
  // score that was never in the average, so the kept 7 (all 70s) are the same
  // shape as before: window = [S, 70x7]; for S >= 70, top6 = S + 70*5 = S + 350.
  // S + 350 >= 450 -> S >= 100.
  const scores = [
    { date: '2026-01-08', percent: 70 }, { date: '2026-01-07', percent: 70 },
    { date: '2026-01-06', percent: 70 }, { date: '2026-01-05', percent: 70 },
    { date: '2026-01-04', percent: 70 }, { date: '2026-01-03', percent: 70 },
    { date: '2026-01-02', percent: 70 }, { date: '2026-01-01', percent: 40 },
  ];
  const progress = classificationProgress(scores);
  assert.equal(progress.currentClass, 'B');
  assert.equal(progress.next?.threshold, 75);
  const rows = classificationWindow(scores);
  assert.equal(rows[rows.length - 1].counts, false); // the oldest (40) was NOT counting
  const p = nextClassifierNeeded(scores);
  assert.deepEqual(p, { percent: 100 });
});

test('nextClassifierNeeded: ties at the best-6 boundary are handled by sum, not identity', () => {
  // 6 scores, a tie at the bottom (two 53s) right at the best-6 cutoff (all 6
  // count since there are only 6). Window = [S,55,55,54,54,53,53] (7 values, only
  // the single minimum drops). For S >= 55: drop one 53, top6 = S + 55+55+54+54+53
  // = S + 271. S + 271 >= 360 -> S >= 89.
  const scores = [
    { date: '2026-01-06', percent: 55 }, { date: '2026-01-05', percent: 55 },
    { date: '2026-01-04', percent: 54 }, { date: '2026-01-03', percent: 54 },
    { date: '2026-01-02', percent: 53 }, { date: '2026-01-01', percent: 53 },
  ];
  const progress = classificationProgress(scores);
  assert.equal(progress.currentClass, 'C');
  assert.equal(progress.next?.threshold, 60);
  const p = nextClassifierNeeded(scores);
  assert.deepEqual(p, { percent: 89 });
});

test('nextClassifierNeeded: the 110% cap binds -- an over-ceiling score counts as 110, not its raw value', () => {
  // One score entered as 115% (over the ceiling) must be treated as 110 -- if it
  // weren't capped, the required S would be 5 points lower (65 instead of 70).
  // window = [S,110,40,40,40] (size 5, all count). (S+230)/5 >= 60 -> S >= 70.
  const scores = [
    { date: '2026-01-04', percent: 115 }, { date: '2026-01-03', percent: 40 },
    { date: '2026-01-02', percent: 40 }, { date: '2026-01-01', percent: 40 },
  ];
  const progress = classificationProgress(scores);
  assert.equal(progress.scoresUsed[0], 110); // M-10: capped before use
  const p = nextClassifierNeeded(scores);
  assert.deepEqual(p, { percent: 70 }); // NOT 65 -- proves the cap is applied here too
});

test('nextClassifierNeeded: impossible when even a 110 can\'t clear the bar', () => {
  // 8 scores all at 5% -- even a maxed 110 only lifts the average to 22.5%,
  // nowhere near the 40% needed to reach C.
  const scores = Array.from({ length: 8 }, (_, i) => ({ date: `2026-01-0${i + 1}`, percent: 5 }));
  const progress = classificationProgress(scores);
  assert.equal(progress.next?.threshold, 40);
  const p = nextClassifierNeeded(scores);
  assert.equal(p, 'impossible');
});

// ---- T3-6a: Minor-only power factor guardrail ----

test('MINOR_ONLY_DIVISIONS / isMinorOnly: the four rulebook-true divisions, and no others', () => {
  assert.deepEqual(MINOR_ONLY_DIVISIONS, ['Production', 'Carry Optics', 'Limited Optics', 'PCC']);
  for (const d of MINOR_ONLY_DIVISIONS) assert.equal(isMinorOnly(d), true);
  for (const d of ['Open', 'Limited', 'Single Stack', 'Revolver', 'Other']) assert.equal(isMinorOnly(d), false);
});

test('analyzeMatch uses the derived hit factor when a stage has a breakdown', () => {
  // Stage 1: breakdown only (no manual points), 2A in 1s Major -> derived HF 10.
  // Stage 2: legacy points/time -> HF 5. Stage 1 should rank strongest.
  const s1: MatchStage = { number: 1, points: null, time: 1, percent: null, notes: '', alphas: 2 };
  const s2: MatchStage = { number: 2, points: 50, time: 10, percent: null, notes: '' };
  const a = analyzeMatch([s1, s2], 'Major');
  assert.equal(a.rankedBy, 'hitFactor');
  assert.equal(a.strongest?.number, 1);
  assert.equal(a.stages.find((s) => s.number === 1)?.score?.hitFactor, 10);
  assert.equal(a.stages.find((s) => s.number === 2)?.score, null);
});
