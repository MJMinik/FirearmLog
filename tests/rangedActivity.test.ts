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
  const sessions = [
    sess({ date: '2026-06-01', type: 'live_fire', guns: [{ firearmId: 'g', rounds: 100 }] }), // in
    sess({ date: '2026-06-02', type: 'dry_fire', guns: [{ firearmId: 'g', rounds: 50 }] }),   // in, dry
    sess({ date: '2025-01-01', type: 'live_fire', guns: [{ firearmId: 'g', rounds: 999 }] }), // out
    sess({ date: '2026-06-03', planned: true, type: 'live_fire', guns: [{ firearmId: 'g', rounds: 7 }] }), // planned
  ];
  const matches = [
    match({ date: '2026-06-05', totalRounds: 30 }),  // in
    match({ date: '2025-02-01', totalRounds: 500 }), // out
  ];
  const r = rangedActivity([], sessions, matches, '2026-01-01');
  assert.equal(r.liveFireRounds, 130); // 100 (session) + 30 (match); dry/planned/out excluded
  assert.equal(r.liveSessions, 1);
  assert.equal(r.drySessions, 1);
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
