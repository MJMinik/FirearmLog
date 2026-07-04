import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchAccuracyTrend } from '../src/lib/competition.ts';
import type { Match, MatchStage } from '../src/lib/types.ts';

const stage = (o: Partial<MatchStage>): MatchStage =>
  ({ number: 1, points: null, time: null, percent: null, notes: '', ...o });

const mkMatch = (o: Partial<Match>): Match => ({
  id: 'm', createdAt: 0, updatedAt: 0, date: '2026-01-01', name: '', matchType: 'USPSA Level 1 (club match)',
  division: 'Carry Optics', powerFactor: 'Minor', firearmId: '', totalRounds: null, overallPlace: null,
  overallOf: null, divisionPlace: null, divisionOf: null, matchPercent: null, stages: [], entryFee: null,
  practiScoreUrl: '', notes: '', ...o,
});

// One all-alpha stage → 100% of points; a 5A/5C(minor) stage → (25 + 15) / 50 = 80%.
const cleanStage = stage({ alphas: 10 });                       // 100%
const looseStage = stage({ alphas: 5, charlies: 5 });           // 80%

test('builds a chronological USPSA points-kept trend, oldest → newest', () => {
  const matches = [
    mkMatch({ id: 'b', date: '2026-03-01', name: 'March', stages: [looseStage] }),
    mkMatch({ id: 'a', date: '2026-01-01', name: 'Jan', stages: [cleanStage] }),
  ];
  const t = matchAccuracyTrend(matches);
  assert.equal(t.points.length, 2);
  assert.deepEqual(t.points.map((p) => p.name), ['Jan', 'March']); // sorted by date
  assert.equal(t.points[0].pointsKept, 1);     // Jan = 100%
  assert.equal(t.points[1].pointsKept, 0.8);   // March = 80%
});

test('excludes non-USPSA matches and matches with no hit breakdown', () => {
  const matches = [
    mkMatch({ id: 'u', date: '2026-01-01', stages: [cleanStage] }),
    mkMatch({ id: 'i', date: '2026-01-02', scoringType: 'idpa', stages: [stage({ time: 20, idpaDown1: 1 })] }),
    mkMatch({ id: 'n', date: '2026-01-03', stages: [stage({ points: 80, time: 8 })] }), // no A/C/D breakdown
  ];
  const t = matchAccuracyTrend(matches);
  assert.equal(t.points.length, 1);
  assert.equal(t.points[0].matchId, 'u');
});

test('consistentlyClean is true when the recent run is all >= 95%', () => {
  const matches = [
    mkMatch({ id: '1', date: '2026-01-01', stages: [cleanStage] }),
    mkMatch({ id: '2', date: '2026-02-01', stages: [cleanStage] }),
    mkMatch({ id: '3', date: '2026-03-01', stages: [cleanStage] }),
  ];
  assert.equal(matchAccuracyTrend(matches).consistentlyClean, true);
});

test('consistentlyClean is false when a recent match dropped points', () => {
  const matches = [
    mkMatch({ id: '1', date: '2026-01-01', stages: [cleanStage] }),
    mkMatch({ id: '2', date: '2026-02-01', stages: [cleanStage] }),
    mkMatch({ id: '3', date: '2026-03-01', stages: [looseStage] }), // 80%
  ];
  assert.equal(matchAccuracyTrend(matches).consistentlyClean, false);
});

test('consistentlyClean is false with fewer than 3 matches (too small a sample)', () => {
  const matches = [
    mkMatch({ id: '1', date: '2026-01-01', stages: [cleanStage] }),
    mkMatch({ id: '2', date: '2026-02-01', stages: [cleanStage] }),
  ];
  assert.equal(matchAccuracyTrend(matches).consistentlyClean, false);
});
