import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidContribution,
  classifierContribution,
  accuracyContributions,
  type BenchmarkContribution,
} from '../src/lib/benchmark.ts';
import type { Match, MatchStage } from '../src/lib/types.ts';

const VER = '1.0.0';

const base = (): BenchmarkContribution => ({
  scoringType: 'uspsa',
  division: 'Carry Optics',
  class: 'C',
  gunCategory: 'Pistol',
  metric: 'classifier_percent',
  value: 58,
  appVersion: VER,
});

// --- isValidContribution: the junk-data guard ------------------------------

test('valid classifier contribution passes', () => {
  assert.equal(isValidContribution(base()), true);
});

test('valid accuracy contribution passes', () => {
  assert.equal(isValidContribution({ ...base(), metric: 'accuracy_points_kept', value: 0.82 }), true);
});

test('rejects an unknown scoringType', () => {
  assert.equal(isValidContribution({ ...base(), scoringType: 'bogus' as never }), false);
});

test('rejects an unknown gunCategory', () => {
  assert.equal(isValidContribution({ ...base(), gunCategory: 'Bazooka' as never }), false);
});

test('rejects empty division or class', () => {
  assert.equal(isValidContribution({ ...base(), division: '' }), false);
  assert.equal(isValidContribution({ ...base(), class: '' }), false);
});

test('rejects a non-finite value', () => {
  assert.equal(isValidContribution({ ...base(), value: Number.NaN }), false);
  assert.equal(isValidContribution({ ...base(), value: Number.POSITIVE_INFINITY }), false);
});

test('rejects out-of-range classifier percent (junk-data guard)', () => {
  assert.equal(isValidContribution({ ...base(), value: 150 }), false);
  assert.equal(isValidContribution({ ...base(), value: -3 }), false);
});

test('rejects out-of-range accuracy fraction', () => {
  assert.equal(isValidContribution({ ...base(), metric: 'accuracy_points_kept', value: 1.5 }), false);
});

// --- classifierContribution ------------------------------------------------

test('classifierContribution: null percent => null (nothing to report)', () => {
  const c = classifierContribution(
    { division: 'Carry Optics', class: 'C', gunCategory: 'Pistol', percent: null },
    VER,
  );
  assert.equal(c, null);
});

test('classifierContribution: valid percent => a well-formed contribution', () => {
  const c = classifierContribution(
    { division: 'Open', class: 'B', gunCategory: 'Pistol', percent: 71.4 },
    VER,
  );
  assert.deepEqual(c, {
    scoringType: 'uspsa', division: 'Open', class: 'B', gunCategory: 'Pistol',
    metric: 'classifier_percent', value: 71.4, appVersion: VER,
  });
});

test('classifierContribution: implausible percent is dropped (returns null)', () => {
  const c = classifierContribution(
    { division: 'Open', class: 'B', gunCategory: 'Pistol', percent: 999 },
    VER,
  );
  assert.equal(c, null);
});

// --- accuracyContributions (reuses the app's own matchAccuracyTrend) --------

const stage = (o: Partial<MatchStage>): MatchStage =>
  ({ number: 1, points: null, time: null, percent: null, notes: '', ...o });

const mkMatch = (o: Partial<Match>): Match => ({
  id: 'm', createdAt: 0, updatedAt: 0, date: '2026-01-01', name: '', matchType: 'USPSA Level 1 (club match)',
  division: 'Carry Optics', powerFactor: 'Minor', firearmId: '', totalRounds: null, overallPlace: null,
  overallOf: null, divisionPlace: null, divisionOf: null, matchPercent: null, stages: [], entryFee: null,
  practiScoreUrl: '', notes: '', ...o,
});

const cleanStage = stage({ alphas: 10 });              // 100% points kept => 1.0
const looseStage = stage({ alphas: 5, charlies: 5 });  // 80% points kept => 0.8

test('accuracyContributions: one contribution per scored match, value = points kept', () => {
  const matches = [
    mkMatch({ id: 'a', date: '2026-01-01', stages: [cleanStage] }),
    mkMatch({ id: 'b', date: '2026-02-01', stages: [looseStage] }),
  ];
  const out = accuracyContributions(matches, () => ({ class: 'C', gunCategory: 'Pistol' }), VER);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.value, 1);    // Jan, 100%
  assert.equal(out[1]!.value, 0.8);  // Feb, 80%
  assert.equal(out[0]!.metric, 'accuracy_points_kept');
  assert.equal(out[0]!.division, 'Carry Optics');
  assert.equal(out[0]!.class, 'C');
});

test('accuracyContributions: a match the resolver skips (null) is excluded', () => {
  const matches = [
    mkMatch({ id: 'a', date: '2026-01-01', stages: [cleanStage] }),
    mkMatch({ id: 'b', date: '2026-02-01', stages: [looseStage] }),
  ];
  const resolve = (m: Match) => (m.id === 'b' ? null : { class: 'C' as string, gunCategory: 'Pistol' as const });
  const out = accuracyContributions(matches, resolve, VER);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.value, 1);
});

test('accuracyContributions: non-USPSA matches never contribute', () => {
  const matches = [
    mkMatch({ id: 'i', date: '2026-01-02', scoringType: 'idpa', stages: [stage({ time: 20, idpaDown1: 1 })] }),
  ];
  const out = accuracyContributions(matches, () => ({ class: 'C', gunCategory: 'Pistol' }), VER);
  assert.equal(out.length, 0);
});
