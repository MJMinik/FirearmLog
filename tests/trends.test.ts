import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Firearm, Session } from '../src/lib/types.ts';
import type { MonthBucket } from '../src/lib/dashboard.ts';
import { bucketTotals, malfunctionsInRange, monthsSinceFirst, ratePerThousand, sessionRatioCounts, spanStartDate } from '../src/lib/trends.ts';

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

// ---- monthsSinceFirst ----

test('monthsSinceFirst: earliest session Jan 2025, now Jul 2026 → 19', () => {
  const sessions = [
    { date: '2025-01-15', planned: false },
    { date: '2025-06-01', planned: false },
  ];
  assert.equal(monthsSinceFirst(sessions, [], new Date(2026, 6, 1)), 19);
});

test('monthsSinceFirst: planned sessions and undated entries are ignored', () => {
  const sessions = [
    { date: '2025-01-15', planned: true },   // planned — ignored
    { date: '', planned: false },             // no date — ignored
    { date: '2026-03-01', planned: false },   // first real session
  ];
  // Earliest real: Mar 2026, now Jul 2026 → (2026-2026)*12 + (7-3) + 1 = 5
  assert.equal(monthsSinceFirst(sessions, [], new Date(2026, 6, 1)), 5);
});

test('monthsSinceFirst: a match earlier than any session sets the floor', () => {
  const sessions = [{ date: '2025-06-01', planned: false }];
  const matches = [{ date: '2025-01-10' }];
  // Earliest: Jan 2025, now Jul 2026 → 19
  assert.equal(monthsSinceFirst(sessions, matches, new Date(2026, 6, 1)), 19);
});

test('monthsSinceFirst: no data → 12', () => {
  assert.equal(monthsSinceFirst([], [], new Date(2026, 6, 1)), 12);
});

test('monthsSinceFirst: same-month first entry → 1', () => {
  const sessions = [{ date: '2026-07-05', planned: false }];
  assert.equal(monthsSinceFirst(sessions, [], new Date(2026, 6, 20)), 1);
});

// ---- sessionRatioCounts (Tester-2 Change-1): dry-fire vs live SESSION counts ----

const on = (date: string, type: Session['type'], planned: boolean, gunIds: string[] = []): Session =>
  ({ id: 's', date, type, planned, drills: [],
     guns: gunIds.map((firearmId) => ({ firearmId, rounds: 50 })) } as unknown as Session);

test('sessionRatioCounts splits live vs dry sessions and excludes planned', () => {
  const sessions = [
    on('2026-06-01', 'practice', false),   // live
    on('2026-06-02', 'class', false),      // live (class is not dry-fire)
    on('2026-06-03', 'dry_fire', false),   // dry
    on('2026-06-04', 'dry_fire', false),   // dry
    on('2026-06-05', 'practice', true),    // planned live — excluded
    on('2026-06-06', 'dry_fire', true),    // planned dry — excluded
  ];
  const c = sessionRatioCounts(sessions, '2026-01-01', {}, firearms);
  assert.deepEqual(c, { liveSessions: 2, drySessions: 2 }); // 2 dry : 2 live → 1.0 : 1
});

test('sessionRatioCounts scopes to the span (sessions before the cutoff drop)', () => {
  const sessions = [
    on('2026-06-01', 'practice', false),   // in span
    on('2026-06-02', 'dry_fire', false),   // in span
    on('2025-01-01', 'practice', false),   // before cutoff — excluded
    on('2025-01-02', 'dry_fire', false),   // before cutoff — excluded
  ];
  const c = sessionRatioCounts(sessions, '2026-05-01', {}, firearms);
  assert.deepEqual(c, { liveSessions: 1, drySessions: 1 });
});

test('sessionRatioCounts counts a session only when it used the filtered gun/category', () => {
  const sessions = [
    on('2026-06-01', 'practice', false, ['g1']),         // pistol live
    on('2026-06-02', 'practice', false, ['g2']),         // rifle live
    on('2026-06-03', 'dry_fire', false, ['g1']),         // pistol dry
    on('2026-06-04', 'dry_fire', false, ['g2', 'g1']),   // used both — counts for g1
  ];
  // Filter to one gun (g1): the g2-only live session drops out.
  assert.deepEqual(
    sessionRatioCounts(sessions, '2026-01-01', { firearmId: 'g1' }, firearms),
    { liveSessions: 1, drySessions: 2 }
  );
  // Filter to a category (Rifle = g2): only sessions that used g2.
  assert.deepEqual(
    sessionRatioCounts(sessions, '2026-01-01', { category: 'Rifle' }, firearms),
    { liveSessions: 1, drySessions: 1 }
  );
});

test('sessionRatioCounts zero-live edge: dry sessions but no live → live 0', () => {
  const sessions = [
    on('2026-06-01', 'dry_fire', false),
    on('2026-06-02', 'dry_fire', false),
  ];
  const c = sessionRatioCounts(sessions, '2026-01-01', {}, firearms);
  assert.deepEqual(c, { liveSessions: 0, drySessions: 2 }); // caller shows "—"
});

test('sessionRatioCounts dry-only-is-zero edge: live sessions, no dry → ratio 0.0 : 1', () => {
  const sessions = [
    on('2026-06-01', 'practice', false),
    on('2026-06-02', 'class', false),
  ];
  const c = sessionRatioCounts(sessions, '2026-01-01', {}, firearms);
  assert.deepEqual(c, { liveSessions: 2, drySessions: 0 });
});

test('sessionRatioCounts counts a session dated exactly on the cutoff (boundary is inclusive)', () => {
  const sessions = [
    on('2026-05-01', 'practice', false),  // exactly ON sinceDate — MUST count
    on('2026-05-01', 'dry_fire', false),  // exactly ON sinceDate — MUST count
    on('2026-04-30', 'practice', false),  // one day before — excluded
  ];
  // An `s.date <= sinceDate` exclusion bug would drop the two boundary rows.
  const c = sessionRatioCounts(sessions, '2026-05-01', {}, firearms);
  assert.deepEqual(c, { liveSessions: 1, drySessions: 1 });
});

test('sessionRatioCounts skips a session with no date', () => {
  const sessions = [
    on('', 'practice', false),            // empty date — skipped
    on('', 'dry_fire', false),            // empty date — skipped
    on('2026-06-01', 'practice', false),  // real live session
  ];
  const c = sessionRatioCounts(sessions, '2026-01-01', {}, firearms);
  assert.deepEqual(c, { liveSessions: 1, drySessions: 0 });
});
