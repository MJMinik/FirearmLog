import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Firearm } from '../src/lib/types.ts';
import type { MonthBucket } from '../src/lib/dashboard.ts';
import { bucketTotals, malfunctionsInRange, ratePerThousand, spanStartDate } from '../src/lib/trends.ts';

test('ratePerThousand scales events by rounds, null when no rounds', () => {
  assert.equal(ratePerThousand(3, 1500), 2);
  assert.equal(ratePerThousand(0, 1000), 0);
  assert.equal(ratePerThousand(5, 0), null);
});

test('bucketTotals sums live/match/dry across buckets', () => {
  const b = (o: Partial<MonthBucket>): MonthBucket => ({ key: '', label: '', liveRounds: 0, matchRounds: 0, dryReps: 0, total: 0, ...o });
  const t = bucketTotals([b({ liveRounds: 100, matchRounds: 20, dryReps: 50 }), b({ liveRounds: 200, dryReps: 10 })]);
  assert.deepEqual(t, { live: 300, match: 20, dry: 60, liveAndMatch: 320 });
});

const firearms = [
  { id: 'g1', category: 'Pistol' as const },
  { id: 'g2', category: 'Rifle' as const }
] as Firearm[];

test('malfunctionsInRange respects date cutoff and gun/category filter', () => {
  const malfs = [
    { date: '2026-06-01', firearmId: 'g1' },
    { date: '2026-06-10', firearmId: 'g2' },
    { date: '2026-01-01', firearmId: 'g1' } // before cutoff
  ];
  assert.equal(malfunctionsInRange(malfs, '2026-05-01', {}, firearms), 2);
  assert.equal(malfunctionsInRange(malfs, '2026-05-01', { firearmId: 'g1' }, firearms), 1);
  assert.equal(malfunctionsInRange(malfs, '2026-05-01', { category: 'Rifle' }, firearms), 1);
  assert.equal(malfunctionsInRange(malfs, '2026-01-01', {}, firearms), 3);
});

test('spanStartDate returns the first day of the span', () => {
  assert.equal(spanStartDate(12, new Date(2026, 5, 14)), '2025-07-01'); // 12 months back incl. current
  assert.equal(spanStartDate(1, new Date(2026, 5, 14)), '2026-06-01');
});
