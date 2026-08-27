import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangedActivity } from '../src/lib/dashboard.ts';
import type { Session, Match, Firearm } from '../src/lib/types.ts';

// Only the fields rangedActivity reads matter; cast the rest.
const sess = (o: Record<string, unknown>): Session =>
  ({ id: 's', createdAt: 0, updatedAt: 0, date: '2026-06-01', planned: false,
     type: 'live_fire', guns: [], ...o } as unknown as Session);
const match = (o: Record<string, unknown>): Match =>
  ({ id: 'm', date: '2026-06-01', totalRounds: 0, ...o } as unknown as Match);

test('bounded window counts only rounds fired in it (live sessions + match rounds)', () => {
  const guns = [{ id: 'g' } as unknown as Firearm];
  const sessions = [
    sess({ date: '2026-06-01', type: 'live_fire', guns: [{ firearmId: 'g', rounds: 100 }] }), // in
    sess({ date: '2026-06-02', type: 'dry_fire', guns: [{ firearmId: 'g', rounds: 50 }] }),   // in, dry
    sess({ date: '2025-01-01', type: 'live_fire', guns: [{ firearmId: 'g', rounds: 999 }] }), // out
    sess({ date: '2026-06-03', planned: true, type: 'live_fire', guns: [{ firearmId: 'g', rounds: 7 }] }), // planned
  ];
  const matches = [
    match({ date: '2026-06-05', firearmId: 'g', totalRounds: 30 }),  // in
    match({ date: '2025-02-01', firearmId: 'g', totalRounds: 500 }), // out
  ];
  const r = rangedActivity(guns, sessions, matches, '2026-01-01');
  assert.equal(r.liveFireRounds, 130); // 100 (session) + 30 (match); dry/planned/out excluded
  assert.equal(r.liveSessions, 1);
  assert.equal(r.drySessions, 1);
});

test('linked-only rule: a bounded window can never exceed all-time (M-8)', () => {
  const guns = [{ id: 'g', startingRoundCount: 0 } as unknown as Firearm];
  const sessions = [
    sess({ date: '2026-06-01', type: 'live_fire',
      guns: [{ firearmId: 'g', rounds: 100 }, { firearmId: 'ghost', rounds: 50 }] }),
  ];
  // A match pointing at a deleted gun contributes to NEITHER view.
  const matches = [match({ date: '2026-06-05', firearmId: 'ghost', totalRounds: 150 })];
  const bounded = rangedActivity(guns, sessions, matches, '2026-01-01');
  const allTime = rangedActivity(guns, sessions, matches, null);
  assert.equal(bounded.liveFireRounds, 100); // ghost rounds excluded, same rule as all-time
  assert.equal(allTime.liveFireRounds, 100);
  assert.ok(bounded.liveFireRounds <= allTime.liveFireRounds);
});

test('dry-fire is a session, never counted as rounds', () => {
  const r = rangedActivity([], [
    sess({ date: '2026-06-01', type: 'dry_fire', guns: [{ firearmId: 'g', rounds: 200 }] }),
  ], [], '2026-01-01');
  assert.equal(r.liveFireRounds, 0);
  assert.equal(r.drySessions, 1);
  assert.equal(r.liveSessions, 0);
});

test('all-time (null cutoff) counts every session regardless of date', () => {
  const sessions = [
    sess({ date: '2020-01-01', type: 'live_fire' }),
    sess({ date: '2026-06-01', type: 'live_fire' }),
    sess({ date: '2026-06-02', type: 'dry_fire' }),
  ];
  const r = rangedActivity([] as Firearm[], sessions, [], null);
  assert.equal(r.liveSessions, 2);
  assert.equal(r.drySessions, 1);
});

// ---------------------------------------------------------------------------
// MATCHES CARRIED BESIDE THE SESSION COUNT (Michael, 27 Aug 2026, after the
// board was convened on what common practice is)
// ---------------------------------------------------------------------------
//
// The tile used to read "1 session" for a month of three matches and one
// practice, and nothing on screen said matches were excluded. Matches are now
// counted and shown alongside, the way dry fire already was -- never added INTO
// liveSessions, because this sport treats a match as the test rather than the
// practice.

test('matches are counted beside the session count, never added into it', () => {
  const guns = [{ id: 'g' } as unknown as Firearm];
  const sessions = [sess({ date: '2026-06-01', type: 'live_fire', guns: [{ firearmId: 'g', rounds: 100 }] })];
  const matches = [
    match({ date: '2026-06-05', firearmId: 'g', totalRounds: 30 }),
    match({ date: '2026-06-12', firearmId: 'g', totalRounds: 40 }),
    match({ date: '2026-06-19', firearmId: 'g', totalRounds: 50 }),
  ];
  const r = rangedActivity(guns, sessions, matches, '2026-01-01');
  assert.equal(r.matches, 3);
  assert.equal(r.liveSessions, 1, 'the session count must NOT absorb the matches');
  assert.equal(r.liveFireRounds, 220, 'rounds still come from both, as before');
});

test('the window bounds matches the same way it bounds sessions', () => {
  const guns = [{ id: 'g' } as unknown as Firearm];
  const matches = [
    match({ date: '2026-06-05', firearmId: 'g', totalRounds: 30 }),
    match({ date: '2025-02-01', firearmId: 'g', totalRounds: 500 }),
  ];
  assert.equal(rangedActivity(guns, [], matches, '2026-01-01').matches, 1);
  assert.equal(rangedActivity(guns, [], matches, null).matches, 2, 'all-time counts both');
});

test('a match whose gun was deleted still COUNTS as a match, though its rounds do not', () => {
  // Deliberate, and the asymmetry is the point: the linked-firearm rule exists
  // to stop a bounded round count exceeding all-time. It says nothing about
  // whether you shot the match. This mirrors liveSessions, which counts a
  // session whatever guns it names.
  const guns = [{ id: 'g' } as unknown as Firearm];
  const matches = [match({ date: '2026-06-05', firearmId: 'ghost', totalRounds: 150 })];
  const r = rangedActivity(guns, [], matches, '2026-01-01');
  assert.equal(r.matches, 1);
  assert.equal(r.liveFireRounds, 0);
});

test('a bounded window can never report more matches than all-time', () => {
  const guns = [{ id: 'g' } as unknown as Firearm];
  const matches = [
    match({ date: '2026-06-05', firearmId: 'g', totalRounds: 30 }),
    match({ date: '2025-02-01', firearmId: 'g', totalRounds: 20 }),
    match({ date: '', firearmId: 'g', totalRounds: 10 }), // no date at all
  ];
  const bounded = rangedActivity(guns, [], matches, '2026-01-01');
  const allTime = rangedActivity(guns, [], matches, null);
  assert.ok(bounded.matches <= allTime.matches, 'the same invariant the round counts obey');
  assert.equal(bounded.matches, 1, 'a dateless match cannot fall inside a window');
  assert.equal(allTime.matches, 3, 'but all-time counts it, as it does a dateless session');
});

test('no matches means no rider at all, not a zero', () => {
  const r = rangedActivity([] as Firearm[], [sess({ date: '2026-06-01', type: 'live_fire' })], [], null);
  assert.equal(r.matches, 0);
});
