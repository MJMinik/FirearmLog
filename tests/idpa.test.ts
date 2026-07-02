// IDPA scoring (time-plus): stage = raw time + points down (1s each) + penalties.
// Points down: -1 = 1, -3 = 3, miss = 5. Penalties: non-threat 5s, PE 3s, flagrant
// 10s, FTDR 20s. FTN removed. Match total = sum of stage times, LOWEST wins. Worked
// examples verified by hand against the official 2026.2 IDPA Rulebook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreIdpaStage,
  idpaMatchTotal,
  scoringTypeFor,
  reconcileTime,
  IDPA_HNT_SECONDS,
  IDPA_FTDR_SECONDS,
  IDPA_RULE_QUOTES,
} from '../src/lib/competition.ts';

test('worked example: 20s raw + 2 down + 1 non-threat + 1 PE = 30s', () => {
  const s = scoreIdpaStage({ time: 20, idpaDown1: 2, idpaNonThreatHits: 1, idpaProceduralErrors: 1 });
  assert.equal(s.pointsDown, 2); // two -1 hits
  assert.equal(s.penaltySeconds, 8); // 5 (HNT) + 3 (PE)
  assert.equal(s.stageTime, 30); // 20 + 2 + 8
});

test('worked example: 15s raw + one -3 + five -1 = 8 down = 23s', () => {
  const s = scoreIdpaStage({ time: 15, idpaDown3: 1, idpaDown1: 5 });
  assert.equal(s.pointsDown, 8); // 3 + 5
  assert.equal(s.stageTime, 23);
});

test('a miss is 5 points down (5 seconds)', () => {
  const s = scoreIdpaStage({ time: 10, idpaMisses: 1 });
  assert.equal(s.pointsDown, 5);
  assert.equal(s.stageTime, 15);
});

test('a non-threat hit is 5s and is NOT double-counted as points down', () => {
  const s = scoreIdpaStage({ time: 10, idpaNonThreatHits: 2 });
  assert.equal(s.pointsDown, 0);
  assert.equal(s.penaltySeconds, 2 * IDPA_HNT_SECONDS); // 10
  assert.equal(s.stageTime, 20);
});

test('flagrant (10s) and FTDR (20s) add fixed seconds', () => {
  const s = scoreIdpaStage({ time: 12, idpaFlagrantPenalties: 1, idpaFailureToDoRight: 1 });
  assert.equal(s.penaltySeconds, 10 + IDPA_FTDR_SECONDS); // 30
  assert.equal(s.stageTime, 42);
});

test('cleanTime keeps penalties but zeroes points down (honest down-zero reference)', () => {
  const s = scoreIdpaStage({ time: 20, idpaDown1: 4, idpaProceduralErrors: 1 });
  assert.equal(s.stageTime, 27); // 20 + 4 + 3
  assert.equal(s.cleanTime, 23); // 20 + 3 (PE kept); the 4 down would save 4s
});

test('no raw time -> stageTime null (nothing to add to yet), but points still derive', () => {
  const s = scoreIdpaStage({ idpaDown1: 3 });
  assert.equal(s.rawTime, null);
  assert.equal(s.stageTime, null);
  assert.equal(s.pointsDown, 3);
});

test('negative / blank counts are ignored (defensive)', () => {
  const s = scoreIdpaStage({ time: 10, idpaDown1: -2, idpaMisses: null });
  assert.equal(s.pointsDown, 0);
  assert.equal(s.stageTime, 10);
});

test('match total = sum of stage times; lowest wins', () => {
  const total = idpaMatchTotal([
    { time: 20, idpaDown1: 2, idpaNonThreatHits: 1, idpaProceduralErrors: 1 }, // 30
    { time: 15, idpaDown3: 1, idpaDown1: 5 }, // 23
  ]);
  assert.equal(total, 53);
});

test('idpaMatchTotal is null when no stage has a time', () => {
  assert.equal(idpaMatchTotal([{ idpaDown1: 2 }, {}]), null);
});

test('scoringTypeFor maps IDPA match types to idpa', () => {
  assert.equal(scoringTypeFor('IDPA Match'), 'idpa');
  assert.equal(scoringTypeFor('IDPA Sanctioned (Tier 2+)'), 'idpa');
});

test('reconcileTime: diff = official - ours, rounded, with a match tolerance', () => {
  assert.deepEqual(reconcileTime(30, 30), { diff: 0, matches: true });
  assert.deepEqual(reconcileTime(30, 35), { diff: 5, matches: false }); // official higher
  assert.deepEqual(reconcileTime(30, 28.5), { diff: -1.5, matches: false }); // ours higher
  assert.deepEqual(reconcileTime(13.96, 13.96), { diff: 0, matches: true });
  assert.deepEqual(reconcileTime(null, 30), { diff: null, matches: false });
  assert.deepEqual(reconcileTime(30, null), { diff: null, matches: false });
});

test('every rule quote carries a section label and non-empty verbatim text', () => {
  assert.ok(IDPA_RULE_QUOTES.length >= 5);
  for (const q of IDPA_RULE_QUOTES) {
    assert.ok(q.section.length > 0);
    assert.ok(q.quote.length > 0);
  }
});
