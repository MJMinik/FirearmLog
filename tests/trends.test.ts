import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Firearm, Session } from '../src/lib/types.ts';
import type { MonthBucket } from '../src/lib/dashboard.ts';
import { isLiveSession, roundsByMonth } from '../src/lib/dashboard.ts';
import {
  bucketTotals, MAX_SPAN_MONTHS, malfunctionsInRange, monthsSinceFirst, ratePerThousand,
  sessionRatioCounts, spanEndExclusive, spanStartDate
} from '../src/lib/trends.ts';

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

// ---- malfunctionsInRange (H-3: shared window edges + live-only rate) ----

test('malfunctionsInRange respects date window, gun/category filter, and live-session set', () => {
  const malfs = [
    { date: '2026-06-01', firearmId: 'g1', sessionId: 'sa' },
    { date: '2026-06-10', firearmId: 'g2', sessionId: 'sb' },
    { date: '2026-01-01', firearmId: 'g1', sessionId: 'sc' } // before cutoff
  ];
  const live = new Set(['sa', 'sb', 'sc']);
  assert.equal(malfunctionsInRange(malfs, '2026-05-01', '2026-07-01', {}, firearms, live), 2);
  assert.equal(malfunctionsInRange(malfs, '2026-05-01', '2026-07-01', { firearmId: 'g1' }, firearms, live), 1);
  assert.equal(malfunctionsInRange(malfs, '2026-05-01', '2026-07-01', { category: 'Rifle' }, firearms, live), 1);
  assert.equal(malfunctionsInRange(malfs, '2026-01-01', '2026-07-01', {}, firearms, live), 3);
});

test('malfunctionsInRange: untilDate is exclusive', () => {
  const malfs = [
    { date: '2026-06-30', firearmId: 'g1', sessionId: 's1' },
    { date: '2026-07-01', firearmId: 'g1', sessionId: 's1' }, // on the exclusive edge — excluded
  ];
  const live = new Set(['s1']);
  assert.equal(malfunctionsInRange(malfs, '2026-01-01', '2026-07-01', {}, firearms, live), 1);
});

test('malfunctionsInRange: a malfunction tied to a non-live sessionId is excluded regardless of date/filter', () => {
  const malfs = [
    { date: '2026-06-01', firearmId: 'g1', sessionId: 'dry-session' },
    { date: '2026-06-02', firearmId: 'g1', sessionId: 'live-session' },
  ];
  const live = new Set(['live-session']); // 'dry-session' deliberately absent
  assert.equal(malfunctionsInRange(malfs, '2026-01-01', '2026-07-01', {}, firearms, live), 1);
});

test('malfunctionsInRange: a malfunction with no sessionId can\'t be classified, so it\'s included by date alone', () => {
  const malfs = [
    { date: '2026-06-01', firearmId: 'g1', sessionId: null },
  ];
  const live = new Set<string>(); // empty — irrelevant since sessionId is null
  assert.equal(malfunctionsInRange(malfs, '2026-01-01', '2026-07-01', {}, firearms, live), 1);
});

test('spanStartDate returns the first day of the span', () => {
  assert.equal(spanStartDate(12, new Date(2026, 5, 14)), '2025-07-01'); // 12 months back incl. current
  assert.equal(spanStartDate(1, new Date(2026, 5, 14)), '2026-06-01');
});

test('spanEndExclusive returns the first day of the month AFTER now', () => {
  assert.equal(spanEndExclusive(new Date(2026, 5, 14)), '2026-07-01');
  assert.equal(spanEndExclusive(new Date(2026, 11, 31)), '2027-01-01'); // year rollover
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

test('monthsSinceFirst: no data → 1 (H-4: no fake 12-month "all time" history)', () => {
  assert.equal(monthsSinceFirst([], [], new Date(2026, 6, 1)), 1);
});

test('monthsSinceFirst: same-month first entry → 1', () => {
  const sessions = [{ date: '2026-07-05', planned: false }];
  assert.equal(monthsSinceFirst(sessions, [], new Date(2026, 6, 20)), 1);
});

// ---- M-6(a): the all-time span always starts on the earliest record's own month ----

test('monthsSinceFirst + spanStartDate: the All-time span always starts on the earliest record\'s own month', () => {
  const NOW = new Date(2026, 6, 25); // 2026-07-25
  const earliestDates = [
    '2024-02-29', // leap day
    '2025-12-31', // one day before a year boundary
    '2026-01-01', // right after a year boundary
    '2020-06-15', // several years back
    '2026-07-01', // same month as NOW
  ];
  for (const earliest of earliestDates) {
    const sessions = [{ date: earliest, planned: false }];
    const months = monthsSinceFirst(sessions, [], NOW);
    const since = spanStartDate(months, NOW);
    assert.equal(since, `${earliest.slice(0, 7)}-01`, `since for earliest=${earliest}`);
  }
});

// ---- M-6(b): the earliest record lands in bucket 0 with its rounds counted ----

test('the earliest record lands in bucket 0 of the All-time span, with its rounds counted', () => {
  const NOW = new Date(2026, 6, 25);
  const sessions = [
    { id: 's1', date: '2024-03-10', planned: false, type: 'practice', guns: [{ firearmId: 'g1', rounds: 77 }] } as unknown as Session,
  ];
  const months = monthsSinceFirst(sessions, [], NOW);
  const buckets = roundsByMonth(sessions, [], months, NOW, {}, firearms);
  assert.equal(buckets[0].key, '2024-03');
  assert.equal(buckets[0].liveRounds, 77);
});

// ---- M-6(c): an unparseable date never yields a NaN span ----

test('monthsSinceFirst: an unparseable date never yields a NaN span, alone or mixed with real dates', () => {
  const NOW = new Date(2026, 6, 25);

  // Alone: the only date is malformed → no valid earliest → falls back to 1, not NaN.
  const alone = monthsSinceFirst([{ date: '12/03/2025', planned: false }], [], NOW);
  assert.equal(Number.isNaN(alone), false);
  assert.equal(alone, 1);

  // Mixed with real ISO dates: '12/03/2025' (US format, sorts before all ISO
  // dates as a string) must be ignored rather than becoming `earliest`.
  const mixed = [
    { date: '12/03/2025', planned: false }, // malformed — must not win
    { date: '2025-05-01', planned: false }, // real earliest
    { date: '2026-01-01', planned: false },
  ];
  const months = monthsSinceFirst(mixed, [], NOW);
  assert.equal(Number.isNaN(months), false);
  assert.equal(months, 15); // May 2025 → Jul 2026 inclusive
});

// ---- M-6(d): a mistyped year cannot exceed MAX_SPAN_MONTHS ----

test('monthsSinceFirst: a mistyped year is clamped to MAX_SPAN_MONTHS', () => {
  const NOW = new Date(2026, 6, 25);
  // '0216-01-01' passes the strict YYYY-MM-DD shape (4 digits) but is a
  // corrupted/typo'd year sitting ~1800 years back — the regex guard alone
  // doesn't catch this, so the MAX_SPAN_MONTHS clamp must.
  const months = monthsSinceFirst([{ date: '0216-01-01', planned: false }], [], NOW);
  assert.equal(Number.isNaN(months), false);
  assert.ok(months <= MAX_SPAN_MONTHS);
  assert.equal(months, MAX_SPAN_MONTHS);
});

// ---- M-6(e): the malfunction numerator uses the same window AND live-session
// set as the rounds denominator ----

test('H-3 case (a): a session mistyped into next year cannot inflate the malfunction rate', () => {
  const NOW = new Date(2026, 6, 25); // 2026-07-25
  const sessions = [
    { id: 's1', date: '2026-02-01', planned: false, type: 'practice', guns: [{ firearmId: 'g1', rounds: 1000 }] } as unknown as Session,
    { id: 's2', date: '2027-01-01', planned: false, type: 'practice', guns: [{ firearmId: 'g1', rounds: 500 }] } as unknown as Session, // mistyped year
  ];
  const malfs = [
    { date: '2026-03-01', firearmId: 'g1', sessionId: 's1' },
    { date: '2027-01-01', firearmId: 'g1', sessionId: 's2' },
    { date: '2027-01-02', firearmId: 'g1', sessionId: 's2' },
    { date: '2027-01-03', firearmId: 'g1', sessionId: 's2' },
  ];
  const months = 6; // Feb–Jul 2026
  const since = spanStartDate(months, NOW);
  const until = spanEndExclusive(NOW);
  const buckets = roundsByMonth(sessions, [], months, NOW, {}, firearms);
  const totals = bucketTotals(buckets);
  const liveSessionIds = new Set(
    sessions.filter((s) => s.date && s.date >= since && s.date < until && isLiveSession(s)).map((s) => s.id)
  );
  const malfCount = malfunctionsInRange(malfs, since, until, {}, firearms, liveSessionIds);
  assert.equal(totals.liveAndMatch, 1000); // the mistyped-2027 session never enters the window
  assert.equal(malfCount, 1); // only the in-window malfunction counts
  assert.equal(ratePerThousand(malfCount, totals.liveAndMatch), 1.0); // was 4.0 pre-fix
});

test('H-3 case (b): a dry-fire stoppage is excluded from the live-rounds malfunction rate', () => {
  const NOW = new Date(2026, 6, 25);
  const sessions = [
    { id: 's1', date: '2026-06-01', planned: false, type: 'practice', guns: [{ firearmId: 'g1', rounds: 1000 }] } as unknown as Session,
    { id: 's2', date: '2026-06-05', planned: false, type: 'dry_fire', guns: [{ firearmId: 'g1', rounds: 500 }] } as unknown as Session,
  ];
  const malfs = [
    { date: '2026-06-02', firearmId: 'g1', sessionId: 's1' }, // live stoppage
    { date: '2026-06-06', firearmId: 'g1', sessionId: 's2' }, // dry-fire stoppage — excluded
  ];
  const months = 12;
  const since = spanStartDate(months, NOW);
  const until = spanEndExclusive(NOW);
  const buckets = roundsByMonth(sessions, [], months, NOW, {}, firearms);
  const totals = bucketTotals(buckets);
  const liveSessionIds = new Set(
    sessions.filter((s) => s.date && s.date >= since && s.date < until && isLiveSession(s)).map((s) => s.id)
  );
  const malfCount = malfunctionsInRange(malfs, since, until, {}, firearms, liveSessionIds);
  assert.equal(totals.liveAndMatch, 1000); // dry reps aren't in liveAndMatch
  assert.equal(malfCount, 1); // the dry-fire stoppage is dropped
  assert.equal(ratePerThousand(malfCount, totals.liveAndMatch), 1.0); // was 2.0 pre-fix
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
  const c = sessionRatioCounts(sessions, '2026-01-01', '2027-01-01', {}, firearms);
  assert.deepEqual(c, { liveSessions: 2, drySessions: 2 }); // 2 dry : 2 live → 1.0 : 1
});

test('sessionRatioCounts scopes to the span (sessions before the cutoff drop)', () => {
  const sessions = [
    on('2026-06-01', 'practice', false),   // in span
    on('2026-06-02', 'dry_fire', false),   // in span
    on('2025-01-01', 'practice', false),   // before cutoff — excluded
    on('2025-01-02', 'dry_fire', false),   // before cutoff — excluded
  ];
  const c = sessionRatioCounts(sessions, '2026-05-01', '2027-01-01', {}, firearms);
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
    sessionRatioCounts(sessions, '2026-01-01', '2027-01-01', { firearmId: 'g1' }, firearms),
    { liveSessions: 1, drySessions: 2 }
  );
  // Filter to a category (Rifle = g2): only sessions that used g2.
  assert.deepEqual(
    sessionRatioCounts(sessions, '2026-01-01', '2027-01-01', { category: 'Rifle' }, firearms),
    { liveSessions: 1, drySessions: 1 }
  );
});

test('sessionRatioCounts zero-live edge: dry sessions but no live → live 0', () => {
  const sessions = [
    on('2026-06-01', 'dry_fire', false),
    on('2026-06-02', 'dry_fire', false),
  ];
  const c = sessionRatioCounts(sessions, '2026-01-01', '2027-01-01', {}, firearms);
  assert.deepEqual(c, { liveSessions: 0, drySessions: 2 }); // caller shows "—"
});

test('sessionRatioCounts dry-only-is-zero edge: live sessions, no dry → ratio 0.0 : 1', () => {
  const sessions = [
    on('2026-06-01', 'practice', false),
    on('2026-06-02', 'class', false),
  ];
  const c = sessionRatioCounts(sessions, '2026-01-01', '2027-01-01', {}, firearms);
  assert.deepEqual(c, { liveSessions: 2, drySessions: 0 });
});

test('sessionRatioCounts counts a session dated exactly on the cutoff (boundary is inclusive)', () => {
  const sessions = [
    on('2026-05-01', 'practice', false),  // exactly ON sinceDate — MUST count
    on('2026-05-01', 'dry_fire', false),  // exactly ON sinceDate — MUST count
    on('2026-04-30', 'practice', false),  // one day before — excluded
  ];
  // An `s.date <= sinceDate` exclusion bug would drop the two boundary rows.
  const c = sessionRatioCounts(sessions, '2026-05-01', '2027-01-01', {}, firearms);
  assert.deepEqual(c, { liveSessions: 1, drySessions: 1 });
});

test('sessionRatioCounts skips a session with no date', () => {
  const sessions = [
    on('', 'practice', false),            // empty date — skipped
    on('', 'dry_fire', false),            // empty date — skipped
    on('2026-06-01', 'practice', false),  // real live session
  ];
  const c = sessionRatioCounts(sessions, '2026-01-01', '2027-01-01', {}, firearms);
  assert.deepEqual(c, { liveSessions: 1, drySessions: 0 });
});

// ---- M-6(f): sessionRatioCounts excludes sessions after the window ----

test('sessionRatioCounts excludes sessions dated after the window (mistyped future year)', () => {
  const NOW = new Date(2026, 6, 25);
  const sessions = [
    on('2027-01-01', 'dry_fire', false), // mistyped year — after the window
    on('2027-02-01', 'dry_fire', false), // mistyped year — after the window
    on('2026-06-01', 'practice', false), // real, in window
  ];
  const since = spanStartDate(12, NOW);
  const until = spanEndExclusive(NOW);
  const c = sessionRatioCounts(sessions, since, until, {}, firearms);
  assert.deepEqual(c, { liveSessions: 1, drySessions: 0 }); // was drySessions: 2 pre-fix
});

test('sessionRatioCounts: untilDate is exclusive', () => {
  const sessions = [
    on('2026-06-30', 'dry_fire', false), // inside
    on('2026-07-01', 'dry_fire', false), // on the exclusive edge — excluded
  ];
  const c = sessionRatioCounts(sessions, '2026-01-01', '2026-07-01', {}, firearms);
  assert.deepEqual(c, { liveSessions: 0, drySessions: 1 });
});
