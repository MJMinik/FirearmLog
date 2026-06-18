// C3 — Home dashboard aggregation, pinned by tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dashboardStats, roundsByMonth, daysSinceLastSession, selfRatingDipping,
  alertDismissKey, isAlertDismissed, personalRecords, formatDrillScore, allClassifications,
  changesSinceBackup, BACKUP_REMINDER_THRESHOLD
} from '../src/lib/dashboard.ts';
import type { Firearm, Match, Session, DrillDef } from '../src/lib/types.ts';

const base = { createdAt: 0, updatedAt: 0 };

test('changesSinceBackup counts only records edited after the backup time', () => {
  const recs = [{ updatedAt: 100 }, { updatedAt: 200 }, { updatedAt: 50 }, {}];
  assert.equal(changesSinceBackup(recs, 100), 1);   // only updatedAt 200 is newer
  assert.equal(changesSinceBackup(recs, 0), 3);     // never backed up: all stamped records count
  assert.equal(changesSinceBackup(recs, 500), 0);   // all older than the backup
  assert.equal(changesSinceBackup([], 0), 0);       // nothing logged
});

test('BACKUP_REMINDER_THRESHOLD default is 10', () => {
  assert.equal(BACKUP_REMINDER_THRESHOLD, 10);
});

const guns: Firearm[] = [
  { ...base, id: 'g1', name: 'Atlas Erebus', manufacturer: 'Atlas', model: 'Erebus', caliber: '9mm', category: 'Pistol', serialNumber: null, dateAcquired: '', startingRoundCount: 0, photoIds: [], referenceId: null, notes: '' },
  { ...base, id: 'g2', name: 'Remington 870', manufacturer: 'Remington', model: '870', caliber: '12ga', category: 'Shotgun', serialNumber: null, dateAcquired: '', startingRoundCount: 0, photoIds: [], referenceId: null, notes: '' }
];

function ses(p: Partial<Session>): Session {
  return {
    ...base, id: 's1', date: '2026-06-01', type: 'practice', guns: [{ firearmId: 'g1', rounds: 100 }],
    location: '', distances: '', notes: '', ammoUsage: [], drills: [], targetMediaIds: [],
    malfunctions: [], selfRating: null, rangeFee: null, planned: false, checklist: null, ...p
  };
}

function mat(p: Partial<Match>): Match {
  return {
    ...base, id: 'm1', date: '2026-06-07', name: 'Club Match', matchType: 'USPSA Level 1',
    division: 'Carry Optics', powerFactor: 'Minor', firearmId: 'g1', totalRounds: 150,
    overallPlace: null, overallOf: null, divisionPlace: null, divisionOf: null,
    matchPercent: null, stages: [], entryFee: 25, practiScoreUrl: '', notes: '', ...p
  };
}

function drill(p: Partial<DrillDef>): DrillDef {
  return {
    ...base, id: 'd1', name: 'Bill Drill', gunCategories: ['Pistol'], fire: 'live',
    briefDescription: '', fullDescription: '', scoring: 'time', requiresHolster: false, tags: [], ...p
  };
}

// ---- roundsByMonth ----

test('roundsByMonth buckets live, match, and dry separately by calendar month', () => {
  const now = new Date(2026, 5, 13); // June 13, 2026
  const sessions: Session[] = [
    ses({ id: 's1', date: '2026-06-01', type: 'practice', guns: [{ firearmId: 'g1', rounds: 100 }] }),
    ses({ id: 's2', date: '2026-06-05', type: 'dry_fire', guns: [{ firearmId: 'g1', rounds: 20 }] }),
    ses({ id: 's3', date: '2026-05-15', type: 'practice', guns: [{ firearmId: 'g2', rounds: 50 }] }),
    ses({ id: 's4', date: '2026-06-10', type: 'practice', guns: [{ firearmId: 'g1', rounds: 30 }], planned: true })
  ];
  const matches: Match[] = [mat({ date: '2026-06-07', totalRounds: 150, firearmId: 'g1' })];
  const buckets = roundsByMonth(sessions, matches, 3, now);
  assert.equal(buckets.length, 3);
  assert.equal(buckets[2].key, '2026-06');
  // June: 100 live + 150 match + 20 dry; planned session excluded
  assert.equal(buckets[2].liveRounds, 100);
  assert.equal(buckets[2].matchRounds, 150);
  assert.equal(buckets[2].dryReps, 20);
  assert.equal(buckets[2].total, 270);
  // May
  assert.equal(buckets[1].key, '2026-05');
  assert.equal(buckets[1].liveRounds, 50);
});

test('roundsByMonth filter narrows to one gun or one category', () => {
  const now = new Date(2026, 5, 13);
  const sessions: Session[] = [
    ses({ id: 's1', date: '2026-06-01', type: 'practice', guns: [{ firearmId: 'g1', rounds: 100 }, { firearmId: 'g2', rounds: 25 }] })
  ];
  const matches: Match[] = [mat({ date: '2026-06-07', totalRounds: 150, firearmId: 'g1' })];

  const allBuckets = roundsByMonth(sessions, matches, 1, now);
  assert.equal(allBuckets[0].liveRounds, 125);
  assert.equal(allBuckets[0].matchRounds, 150);

  const pistolOnly = roundsByMonth(sessions, matches, 1, now, { firearmId: 'g1' }, guns);
  assert.equal(pistolOnly[0].liveRounds, 100);
  assert.equal(pistolOnly[0].matchRounds, 150);

  const shotgunOnly = roundsByMonth(sessions, matches, 1, now, { firearmId: 'g2' }, guns);
  assert.equal(shotgunOnly[0].liveRounds, 25);
  assert.equal(shotgunOnly[0].matchRounds, 0);

  const byCategory = roundsByMonth(sessions, matches, 1, now, { category: 'Shotgun' }, guns);
  assert.equal(byCategory[0].liveRounds, 25);
  assert.equal(byCategory[0].matchRounds, 0);
});

// ---- daysSinceLastSession ----

test('daysSinceLastSession ignores planned sessions and picks the latest date', () => {
  const now = new Date(2026, 5, 20); // June 20, 2026
  const sessions: Session[] = [
    ses({ date: '2026-06-01', planned: false }),
    ses({ date: '2026-06-25', planned: true }) // future planned session shouldn't count
  ];
  assert.equal(daysSinceLastSession(sessions, now), 18);
  assert.equal(daysSinceLastSession([], now), null);
});

// ---- selfRatingDipping ----

test('selfRatingDipping flags a declining fundamentals trend', () => {
  const sessions: Session[] = [
    ses({ id: '1', date: '2026-06-07', selfRating: { fundamentals: 8 } }),
    ses({ id: '2', date: '2026-06-08', selfRating: { fundamentals: 8 } }),
    ses({ id: '3', date: '2026-06-09', selfRating: { fundamentals: 7 } }),
    ses({ id: '4', date: '2026-06-10', selfRating: { fundamentals: 6 } }),
    ses({ id: '5', date: '2026-06-11', selfRating: { fundamentals: 5 } }),
    ses({ id: '6', date: '2026-06-12', selfRating: { fundamentals: 4 } })
  ];
  const trend = selfRatingDipping(sessions);
  assert.ok(trend);
  assert.equal(trend?.dipping, true);
});

test('selfRatingDipping returns null with fewer than 4 rated sessions', () => {
  const sessions: Session[] = [
    ses({ id: '1', date: '2026-06-10', selfRating: { fundamentals: 5 } })
  ];
  assert.equal(selfRatingDipping(sessions), null);
});

// ---- alert dismissal ----

test('alertDismissKey and isAlertDismissed track dismissal by trigger detail', () => {
  const key = alertDismissKey('g1', 'deep_clean', 'warn');
  assert.equal(isAlertDismissed(key, {}, '4,500 / 5,000 rounds'), false);
  const dismissed = { [key]: '4,500 / 5,000 rounds' };
  assert.equal(isAlertDismissed(key, dismissed, '4,500 / 5,000 rounds'), true);
  // Once the underlying number changes, the alert reappears even if dismissed before.
  assert.equal(isAlertDismissed(key, dismissed, '5,000 / 5,000 rounds'), false);
});

// ---- personalRecords / formatDrillScore ----

test('personalRecords picks the fastest time for time-scored drills', () => {
  const drills: DrillDef[] = [drill({ name: 'Bill Drill', scoring: 'time' })];
  const sessions: Session[] = [
    ses({ id: 's1', date: '2026-06-01', drills: [{ name: 'Bill Drill', distance: '7yd', time: 2.1, score: null, maxScore: null, notes: '' }] }),
    ses({ id: 's2', date: '2026-06-05', drills: [{ name: 'Bill Drill', distance: '7yd', time: 1.85, score: null, maxScore: null, notes: '' }] }),
    ses({ id: 's3', date: '2026-06-08', drills: [{ name: 'Bill Drill', distance: '7yd', time: 2.4, score: null, maxScore: null, notes: '' }] })
  ];
  const prs = personalRecords(sessions, drills);
  assert.equal(prs.length, 1);
  assert.equal(prs[0].attempts, 3);
  assert.equal(prs[0].best?.time, 1.85);
  assert.equal(prs[0].best?.date, '2026-06-05');
  assert.equal(formatDrillScore(prs[0].best, prs[0].scoring), '1.85s');
});

test('personalRecords picks the highest score for score-scored drills, and best HF for time_score', () => {
  const drills: DrillDef[] = [
    drill({ name: 'El Presidente', scoring: 'score' }),
    drill({ name: 'Dot Torture', scoring: 'time_score' })
  ];
  const sessions: Session[] = [
    ses({ id: 's1', date: '2026-06-01', drills: [
      { name: 'El Presidente', distance: '10yd', time: null, score: 80, maxScore: 100, notes: '' },
      { name: 'Dot Torture', distance: '3yd', time: 20, score: 40, maxScore: 50, notes: '' }
    ] }),
    ses({ id: 's2', date: '2026-06-08', drills: [
      { name: 'El Presidente', distance: '10yd', time: null, score: 92, maxScore: 100, notes: '' },
      { name: 'Dot Torture', distance: '3yd', time: 18, score: 38, maxScore: 50, notes: '' }
    ] })
  ];
  const prs = personalRecords(sessions, drills);
  const elPres = prs.find(p => p.name === 'El Presidente')!;
  assert.equal(elPres.best?.score, 92);
  assert.equal(formatDrillScore(elPres.best, elPres.scoring), '92/100');

  const dotTorture = prs.find(p => p.name === 'Dot Torture')!;
  // 40/20 = 2.00 HF vs 38/18 = 2.11 HF — the second attempt wins
  assert.equal(dotTorture.best?.score, 38);
  assert.equal(formatDrillScore(dotTorture.best, dotTorture.scoring), '38/50 in 18.00s (HF 2.11)');
});

test('personalRecords returns null best when no scoreable attempts exist yet', () => {
  const drills: DrillDef[] = [drill({ name: 'Bill Drill', scoring: 'time' })];
  const sessions: Session[] = [
    ses({ id: 's1', date: '2026-06-01', drills: [{ name: 'Bill Drill', distance: '7yd', time: null, score: null, maxScore: null, notes: '' }] })
  ];
  const prs = personalRecords(sessions, drills);
  assert.equal(prs[0].best, null);
  assert.equal(formatDrillScore(prs[0].best, prs[0].scoring), '—');
});

// ---- dashboardStats ----

test('dashboardStats summarizes live rounds, sessions, ammo, and training-since', () => {
  const sessions: Session[] = [
    ses({ id: 's1', date: '2026-01-10', type: 'practice', guns: [{ firearmId: 'g1', rounds: 100 }] }),
    ses({ id: 's2', date: '2026-02-01', type: 'dry_fire', guns: [{ firearmId: 'g1', rounds: 30 }] })
  ];
  const stats = dashboardStats(guns, sessions, [], [], [{ ...base, id: 'a1', brand: 'Federal', caliber: '9mm', grain: '115', bulletType: 'FMJ', quantity: 250, costPerRound: 0.25, notes: '' }]);
  assert.equal(stats.liveFireRounds, 100);
  assert.equal(stats.liveSessions, 1);
  assert.equal(stats.drySessions, 1);
  assert.equal(stats.ammoInventory, 250);
  assert.equal(stats.trainingSince, 'January 2026');
  assert.equal(stats.classification, null);
});

// ---- allClassifications ----

test('allClassifications returns one entry per division with an average, sorted highest first', () => {
  const classifiers = [
    { date: '2026-05-01', percent: 70, division: 'Carry Optics' },
    { date: '2026-05-05', percent: 80, division: 'Limited' },
    { date: '2026-05-10', percent: 75, division: 'Carry Optics' },
    { date: '2026-05-12', percent: null, division: 'Open' } // no valid score yet
  ];
  const divs = allClassifications(classifiers);
  assert.equal(divs.length, 2);
  assert.equal(divs[0].division, 'Limited');
  assert.equal(divs[1].division, 'Carry Optics');
});
