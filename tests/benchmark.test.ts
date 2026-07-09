import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidContribution,
  isAllowedBracket,
  classifierContribution,
  accuracyContributions,
  summarizeContributions,
  contributionsToSend,
  recordSent,
  bucketKeyOf,
  type BenchmarkContribution,
  type SentLedger,
} from '../src/lib/benchmark.ts';
import type { Match, MatchStage } from '../src/lib/types.ts';

const base = (): BenchmarkContribution => ({
  scoringType: 'uspsa',
  division: 'Carry Optics',
  class: 'C',
  gunCategory: 'Pistol',
  metric: 'classifier_percent',
  value: 58,
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

// --- R-B: division / class enum allow-list ---------------------------------

test('R-B: a division not on the canonical USPSA list is refused', () => {
  assert.equal(isValidContribution({ ...base(), division: 'Bogus Division' }), false);
  assert.equal(isAllowedBracket('uspsa', 'Bogus Division', 'C'), false);
});

test('R-B: a class not on the USPSA ladder is refused', () => {
  assert.equal(isValidContribution({ ...base(), class: 'Z' }), false);
  assert.equal(isValidContribution({ ...base(), class: 'GrandMaster' }), false);
});

test('R-B: every real USPSA division + class is allowed', () => {
  for (const division of ['Carry Optics', 'Open', 'Limited', 'Limited Optics', 'Production', 'Revolver', 'PCC']) {
    for (const cls of ['GM', 'M', 'A', 'B', 'C', 'D']) {
      assert.equal(isAllowedBracket('uspsa', division, cls), true, `${division} / ${cls}`);
    }
  }
});

test('R-B: a non-USPSA bracket is refused (no metric / class ladder yet)', () => {
  // Even a real IDPA division has no class ladder in v1 → refused, so the server
  // never banks a bucket it cannot validate.
  assert.equal(isAllowedBracket('idpa', 'Stock Service Pistol (SSP)', 'Expert'), false);
  assert.equal(isAllowedBracket('steel', 'Open', 'A'), false);
});

// --- classifierContribution ------------------------------------------------

test('classifierContribution: null percent => null (nothing to report)', () => {
  const c = classifierContribution({ division: 'Carry Optics', class: 'C', gunCategory: 'Pistol', percent: null });
  assert.equal(c, null);
});

test('classifierContribution: valid percent => a well-formed 6-field contribution', () => {
  const c = classifierContribution({ division: 'Open', class: 'B', gunCategory: 'Pistol', percent: 71.4 });
  assert.deepEqual(c, {
    scoringType: 'uspsa', division: 'Open', class: 'B', gunCategory: 'Pistol',
    metric: 'classifier_percent', value: 71.4,
  });
});

test('classifierContribution: implausible percent is dropped (returns null)', () => {
  const c = classifierContribution({ division: 'Open', class: 'B', gunCategory: 'Pistol', percent: 999 });
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
  const out = accuracyContributions(matches, () => ({ class: 'C', gunCategory: 'Pistol' }));
  assert.equal(out.length, 2);
  assert.equal(out[0]!.value, 1);    // Jan, 100%
  assert.equal(out[1]!.value, 0.8);  // Feb, 80%
  assert.equal(out[0]!.metric, 'accuracy_points_kept');
  assert.equal(out[0]!.division, 'Carry Optics');
  assert.equal(out[0]!.class, 'C');
  assert.equal('appVersion' in out[0]!, false); // dropped from the wire
});

test('accuracyContributions: a match the resolver skips (null) is excluded', () => {
  const matches = [
    mkMatch({ id: 'a', date: '2026-01-01', stages: [cleanStage] }),
    mkMatch({ id: 'b', date: '2026-02-01', stages: [looseStage] }),
  ];
  const resolve = (m: Match) => (m.id === 'b' ? null : { class: 'C' as string, gunCategory: 'Pistol' as const });
  const out = accuracyContributions(matches, resolve);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.value, 1);
});

test('accuracyContributions: non-USPSA matches never contribute', () => {
  const matches = [
    mkMatch({ id: 'i', date: '2026-01-02', scoringType: 'idpa', stages: [stage({ time: 20, idpaDown1: 1 })] }),
  ];
  const out = accuracyContributions(matches, () => ({ class: 'C', gunCategory: 'Pistol' }));
  assert.equal(out.length, 0);
});

// --- R-A: current-standing summary (k means SHOOTERS, not samples) ----------

const acc = (value: number, over: Partial<BenchmarkContribution> = {}): BenchmarkContribution => ({
  scoringType: 'uspsa', division: 'Carry Optics', class: 'C', gunCategory: 'Pistol',
  metric: 'accuracy_points_kept', value, ...over,
});

test('bucketKeyOf: the five bracket fields joined', () => {
  assert.equal(bucketKeyOf(acc(0.9)), 'uspsa|Carry Optics|C|Pistol|accuracy_points_kept');
});

test('R-A: many matches in one bucket collapse to ONE sample (the median)', () => {
  const out = summarizeContributions([acc(1.0), acc(0.8)]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.value, 0.9); // median of [1.0, 0.8]
});

test('R-A: one install cannot open a bucket alone (50 matches → 1 sample)', () => {
  const raw = Array.from({ length: 50 }, () => acc(0.8));
  const out = summarizeContributions(raw);
  assert.equal(out.length, 1); // k=50 therefore needs ~50 DIFFERENT installs
});

test('R-A: different brackets each get their own single sample', () => {
  const out = summarizeContributions([acc(0.8), acc(0.6, { class: 'B' }), acc(0.7, { class: 'B' })]);
  assert.equal(out.length, 2);
  const byBucket = new Map(out.map((c) => [bucketKeyOf(c), c.value]));
  assert.equal(byBucket.get('uspsa|Carry Optics|C|Pistol|accuracy_points_kept'), 0.8);
  assert.equal(byBucket.get('uspsa|Carry Optics|B|Pistol|accuracy_points_kept'), 0.65); // median of [0.6,0.7]
});

test('R-A: only the most recent BENCHMARK_RECENT_SAMPLES feed the median', () => {
  // Oldest→newest: five 0.2s then four 0.9s (9 values). The recent-8 window drops
  // the oldest 0.2, leaving four 0.2s + four 0.9s → median 0.55; all-nine would be 0.2.
  const raw = [0.2, 0.2, 0.2, 0.2, 0.2, 0.9, 0.9, 0.9, 0.9].map((v) => acc(v));
  assert.equal(summarizeContributions(raw)[0]!.value, 0.55);
});

test('R-A: invalid raw contributions are ignored by the summary', () => {
  const out = summarizeContributions([acc(0.8), acc(5 /* out of range */), acc(0.6, { division: 'Junk' })]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.value, 0.8);
});

// --- R-A: the sent-ledger makes re-contribution idempotent (R-2) ------------

test('R-A: contributionsToSend sends new/changed buckets and NOTHING unchanged', () => {
  const summary = summarizeContributions([acc(0.9)]);
  const key = bucketKeyOf(summary[0]!);

  assert.deepEqual(contributionsToSend(summary, {}), summary);              // new → send
  assert.deepEqual(contributionsToSend(summary, { [key]: 0.9 }), []);       // unchanged → send nothing
  assert.deepEqual(contributionsToSend(summary, { [key]: 0.8 }), summary);  // changed → send
});

test('R-A: recordSent updates the ledger immutably', () => {
  const summary = summarizeContributions([acc(0.9)]);
  const before: SentLedger = {};
  const after = recordSent(before, summary);
  assert.deepEqual(before, {}); // original untouched
  assert.equal(after[bucketKeyOf(summary[0]!)], 0.9);
  // Re-running over the same data now sends nothing.
  assert.deepEqual(contributionsToSend(summary, after), []);
});
