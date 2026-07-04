import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSpeedAccuracy } from '../src/lib/competition.ts';
import type { MatchStage } from '../src/lib/types.ts';

const mk = (o: Partial<MatchStage>): MatchStage =>
  ({ number: 1, points: null, time: null, percent: null, notes: '', ...o });

test('USPSA: hit-zone points kept, and a very clean match flags overAccuracy', () => {
  const stages = [
    mk({ number: 1, time: 10, alphas: 10 }),                 // 50 of 50
    mk({ number: 2, time: 10, alphas: 8, charlies: 2 }),     // minor: 40 + 6 = 46 of 50
  ];
  const r = matchSpeedAccuracy(stages, 'uspsa', 'Minor');
  assert.equal(r?.discipline, 'uspsa');
  if (r?.discipline !== 'uspsa') return;
  assert.equal(r.pointsKept, 0.96);
  assert.equal(r.pointsDown, 4);
  assert.equal(r.misses, 0);
  assert.equal(r.stagesUsed, 2);
  assert.equal(r.overAccuracy, true); // >= 95% kept over >= 2 stages
});

test('USPSA: a miss lowers accuracy; no-shoots & procedurals are counted separately, not folded in', () => {
  const stages = [
    mk({ number: 1, time: 10, alphas: 6, charlies: 1, misses: 1, noShoots: 1, procedurals: 1 }),
  ];
  const r = matchSpeedAccuracy(stages, 'uspsa', 'Minor');
  assert.equal(r?.discipline, 'uspsa');
  if (r?.discipline !== 'uspsa') return;
  // rawHit = 5*6 + 3*1 = 33; available = 5*(6+1+0+1) = 40 → 0.825; the miss is in the denominator.
  assert.equal(r.pointsKept, 0.825);
  assert.equal(r.pointsDown, 7);
  assert.equal(r.misses, 1);
  assert.equal(r.noShoots, 1);      // separate error, NOT in the accuracy fraction
  assert.equal(r.procedurals, 1);
  assert.equal(r.overAccuracy, false); // only 1 stage → never nudges
});

test('USPSA: no hit breakdown on any stage → null (nothing computable)', () => {
  const stages = [mk({ number: 1, points: 80, time: 8 }), mk({ number: 2, points: 60, time: 12 })];
  assert.equal(matchSpeedAccuracy(stages, 'uspsa', 'Minor'), null);
});

test('IDPA: the time-plus seconds split, and a clean run flags overAccuracy', () => {
  const stages = [
    mk({ number: 1, time: 20, idpaDown1: 1 }),  // 1s down
    mk({ number: 2, time: 20, idpaDown1: 1 }),  // 1s down
  ];
  const r = matchSpeedAccuracy(stages, 'idpa');
  assert.equal(r?.discipline, 'idpa');
  if (r?.discipline !== 'idpa') return;
  assert.equal(r.timeSeconds, 40);
  assert.equal(r.downSeconds, 2);
  assert.equal(r.penaltySeconds, 0);
  assert.equal(r.totalTime, 42);
  assert.equal(r.overAccuracy, true); // 2/42 ≈ 4.8% < 5%
});

test('IDPA: a lot of dropped points does not flag overAccuracy', () => {
  const stages = [
    mk({ number: 1, time: 10, idpaMisses: 1 }), // 5s down
    mk({ number: 2, time: 10, idpaMisses: 1 }), // 5s down
  ];
  const r = matchSpeedAccuracy(stages, 'idpa');
  if (r?.discipline !== 'idpa') { assert.fail('expected idpa'); return; }
  assert.equal(r.downSeconds, 10);
  assert.equal(r.overAccuracy, false); // 10/30 = 33%
});

test('IDPA: no raw time recorded → null', () => {
  assert.equal(matchSpeedAccuracy([mk({ number: 1, idpaDown1: 2 })], 'idpa'), null);
});

test('Steel: totals missed plates and their 3s-each cost', () => {
  const stages = [
    mk({ number: 1, steelStage: '5 to Go',
      strings: [3, 3.5, 4, 4.5, 6], stringMisses: [0, 1, 0, 0, 0] }),
  ];
  const r = matchSpeedAccuracy(stages, 'steel');
  assert.equal(r?.discipline, 'steel');
  if (r?.discipline !== 'steel') return;
  assert.equal(r.misses, 1);
  assert.equal(r.missSeconds, 3);
  assert.equal(r.stagesUsed, 1);
});

test('Steel: nothing entered → null', () => {
  assert.equal(matchSpeedAccuracy([mk({ number: 1 })], 'steel'), null);
});
