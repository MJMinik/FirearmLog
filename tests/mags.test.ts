import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitRounds, gunMagAttribution, magLifetimeRounds, matchMagAttribution } from '../src/lib/mags.ts';

// ---------- splitRounds: the largest-remainder even split ----------

test('split: divides evenly when it can', () => {
  assert.deepEqual(splitRounds(100, 2), [50, 50]);
  assert.deepEqual(splitRounds(90, 3), [30, 30, 30]);
});

test('split: remainder lands on the earlier mags, sum always exact', () => {
  assert.deepEqual(splitRounds(35, 3), [12, 12, 11]);
  assert.deepEqual(splitRounds(100, 3), [34, 33, 33]);
  assert.deepEqual(splitRounds(1, 3), [1, 0, 0]);
  for (const [total, count] of [[97, 4], [250, 7], [1, 1], [0, 5], [9999, 13]] as const) {
    const parts = splitRounds(total, count);
    assert.equal(parts.length, count);
    assert.equal(parts.reduce((t, n) => t + n, 0), total, `${total} across ${count}`);
  }
});

test('split: edge inputs — one mag, zero rounds, no mags, junk', () => {
  assert.deepEqual(splitRounds(50, 1), [50]);
  assert.deepEqual(splitRounds(0, 2), [0, 0]);
  assert.deepEqual(splitRounds(50, 0), []);
  assert.deepEqual(splitRounds(NaN, 2), [0, 0]);
  assert.deepEqual(splitRounds(-5, 2), [0, 0]);
});

// ---------- gunMagAttribution ----------

test('attribution: even split when no overrides', () => {
  const gun = { rounds: 100, magIds: ['mg-a', 'mg-b', 'mg-c'] };
  assert.deepEqual(gunMagAttribution(gun), [
    { magId: 'mg-a', rounds: 34 }, { magId: 'mg-b', rounds: 33 }, { magId: 'mg-c', rounds: 33 }
  ]);
});

test('attribution: overrides win verbatim', () => {
  const gun = {
    rounds: 100, magIds: ['mg-a', 'mg-b'],
    magOverrides: [{ magId: 'mg-a', rounds: 80 }, { magId: 'mg-b', rounds: 20 }]
  };
  assert.deepEqual(gunMagAttribution(gun), [
    { magId: 'mg-a', rounds: 80 }, { magId: 'mg-b', rounds: 20 }
  ]);
});

test('attribution: no mags picked → nothing attributed (old records unaffected)', () => {
  assert.deepEqual(gunMagAttribution({ rounds: 100 }), []);
  assert.deepEqual(gunMagAttribution({ rounds: 100, magIds: [] }), []);
});

// ---------- magLifetimeRounds: derived, never mutated ----------

const mag = { id: 'mg-a', totalRounds: 1000 };
const liveSession = (guns: object[], extra: object = {}) =>
  ({ type: 'practice', planned: false, guns, ...extra }) as never;

test('lifetime = starting count + attributed rounds across sessions', () => {
  const sessions = [
    liveSession([{ firearmId: 'f1', rounds: 100, magIds: ['mg-a', 'mg-b'] }]),      // +50
    liveSession([{ firearmId: 'f1', rounds: 60, magIds: ['mg-a'] }]),               // +60
    liveSession([{
      firearmId: 'f1', rounds: 90, magIds: ['mg-a', 'mg-b'],
      magOverrides: [{ magId: 'mg-a', rounds: 70 }, { magId: 'mg-b', rounds: 20 }]  // +70
    }].map((g) => g)),
  ];
  assert.equal(magLifetimeRounds(mag, sessions, []), 1000 + 50 + 60 + 70);
});

test('lifetime: sessions without mag data add nothing (historical records)', () => {
  const sessions = [liveSession([{ firearmId: 'f1', rounds: 500 }])];
  assert.equal(magLifetimeRounds(mag, sessions, []), 1000);
});

test('lifetime: trashed, planned, and dry-fire sessions do not count', () => {
  const attributed = [{ firearmId: 'f1', rounds: 100, magIds: ['mg-a'] }];
  const sessions = [
    liveSession(attributed, { deletedAt: 123 }),
    liveSession(attributed, { planned: true }),
    liveSession(attributed, { type: 'dry_fire' }),
    liveSession(attributed), // the only one that counts: +100
  ];
  assert.equal(magLifetimeRounds(mag, sessions, []), 1100);
});

test('lifetime: multi-gun session attributes each gun separately', () => {
  const sessions = [liveSession([
    { firearmId: 'f1', rounds: 100, magIds: ['mg-a'] },
    { firearmId: 'f2', rounds: 50, magIds: ['mg-a'] }, // same mag on two guns
  ])];
  assert.equal(magLifetimeRounds(mag, sessions, []), 1150);
});

test('lifetime: junk starting count treated as zero', () => {
  assert.equal(magLifetimeRounds({ id: 'mg-x', totalRounds: NaN }, [], []), 0);
});

// ---------- matchMagAttribution ----------
// Seat 8's must-test list (spec §5), Pass-1-testable items.

test('match attribution: pending — totalRounds null means no silent zero (must-test #6)', () => {
  assert.deepEqual(matchMagAttribution({ totalRounds: null, magIds: ['mg-a', 'mg-b'] }), []);
});

test('match attribution: totalRounds 0 is a known zero, not pending — zeros attributed', () => {
  assert.deepEqual(matchMagAttribution({ totalRounds: 0, magIds: ['mg-a', 'mg-b'] }), [
    { magId: 'mg-a', rounds: 0 }, { magId: 'mg-b', rounds: 0 }
  ]);
});

test('match attribution: no mags picked → nothing attributed regardless of totalRounds', () => {
  assert.deepEqual(matchMagAttribution({ totalRounds: 100 }), []);
  assert.deepEqual(matchMagAttribution({ totalRounds: 100, magIds: [] }), []);
});

test('match attribution: overrides win verbatim', () => {
  const match = {
    totalRounds: 100, magIds: ['mg-a', 'mg-b'],
    magOverrides: [{ magId: 'mg-a', rounds: 80 }, { magId: 'mg-b', rounds: 20 }]
  };
  assert.deepEqual(matchMagAttribution(match), [
    { magId: 'mg-a', rounds: 80 }, { magId: 'mg-b', rounds: 20 }
  ]);
});

test('match attribution: overrides survive even with no total — a state the UI never offers but a hand-edited file could carry', () => {
  const match = {
    totalRounds: null, magIds: ['mg-a', 'mg-b'],
    magOverrides: [{ magId: 'mg-a', rounds: 5 }, { magId: 'mg-b', rounds: 5 }]
  };
  assert.deepEqual(matchMagAttribution(match), [
    { magId: 'mg-a', rounds: 5 }, { magId: 'mg-b', rounds: 5 }
  ]);
});

test('match attribution: even split otherwise, consistent with splitRounds (largest-remainder)', () => {
  const match = { totalRounds: 35, magIds: ['mg-a', 'mg-b', 'mg-c'] };
  const expected = splitRounds(35, 3);
  assert.deepEqual(matchMagAttribution(match), [
    { magId: 'mg-a', rounds: expected[0] }, { magId: 'mg-b', rounds: expected[1] }, { magId: 'mg-c', rounds: expected[2] }
  ]);
  assert.deepEqual(matchMagAttribution(match), [
    { magId: 'mg-a', rounds: 12 }, { magId: 'mg-b', rounds: 12 }, { magId: 'mg-c', rounds: 11 }
  ]);
});

// ---------- magLifetimeRounds: matches on top of sessions ----------

test('lifetime: sessions-only baseline unchanged when matches is empty (must-test #4-style: no matches present)', () => {
  const sessions = [liveSession([{ firearmId: 'f1', rounds: 100, magIds: ['mg-a'] }])];
  assert.equal(magLifetimeRounds(mag, sessions, []), 1100);
});

test('lifetime: matches add on top of sessions', () => {
  const sessions = [liveSession([{ firearmId: 'f1', rounds: 100, magIds: ['mg-a'] }])]; // +100
  const matches = [{ totalRounds: 60, magIds: ['mg-a'] }]; // +60
  assert.equal(magLifetimeRounds(mag, sessions, matches), 1000 + 100 + 60);
});

test('lifetime: trashed match (deletedAt set) is excluded', () => {
  const matches = [
    { totalRounds: 60, magIds: ['mg-a'], deletedAt: Date.now() },
    { totalRounds: 40, magIds: ['mg-a'] }, // the only one that counts: +40
  ];
  assert.equal(magLifetimeRounds(mag, [], matches), 1040);
});

test('lifetime: a match whose magIds does not include this mag contributes nothing, and nothing is reattributed', () => {
  const matches = [{ totalRounds: 60, magIds: ['mg-b'] }];
  assert.equal(magLifetimeRounds(mag, [], matches), 1000);
});

test('lifetime: totalRounds-null match contributes nothing (pending, not zero) (must-test #6)', () => {
  const matches = [{ totalRounds: null, magIds: ['mg-a'] }];
  assert.equal(magLifetimeRounds(mag, [], matches), 1000);
});

test('corrupt shapes from a hand-edited file: magIds as a bare string never throws, attributes nothing (audit A)', () => {
  // recordShape repairs strings, not arrays, so these shapes are reachable.
  const badMatch = { totalRounds: 60, magIds: 'mg-a' } as never;
  assert.doesNotThrow(() => matchMagAttribution(badMatch));
  assert.deepEqual(matchMagAttribution(badMatch), []);
  const badGun = { rounds: 100, magIds: 'mg-a' } as never;
  assert.doesNotThrow(() => gunMagAttribution(badGun));
  assert.deepEqual(gunMagAttribution(badGun), []);
  const badOverrides = { totalRounds: 60, magIds: ['mg-a'], magOverrides: { magId: 'mg-a', rounds: 60 } } as never;
  assert.doesNotThrow(() => matchMagAttribution(badOverrides));
  // A non-array overrides shape is ignored; the even split still applies.
  assert.deepEqual(matchMagAttribution(badOverrides), [{ magId: 'mg-a', rounds: 60 }]);
});

test('non-numeric totalRounds is PENDING, never a guessed zero (audit B)', () => {
  assert.deepEqual(matchMagAttribution({ totalRounds: NaN, magIds: ['mg-a'] } as never), []);
  assert.deepEqual(matchMagAttribution({ totalRounds: '40', magIds: ['mg-a'] } as never), []);
  // 0 stays a KNOWN zero, not pending.
  assert.deepEqual(matchMagAttribution({ totalRounds: 0, magIds: ['mg-a'] }), [{ magId: 'mg-a', rounds: 0 }]);
});

test('lifetime: a match magIds referencing a deleted magazine skips it silently, never throws, never reattributes to a survivor (must-test #1)', () => {
  // mg-a survives; 'mg-deleted' no longer exists as a Magazine record. Asking
  // for mg-a's lifetime must not pick up 'mg-deleted''s share of the split.
  const matches = [{ totalRounds: 60, magIds: ['mg-a', 'mg-deleted'] }]; // even split: +30 to mg-a
  assert.equal(magLifetimeRounds(mag, [], matches), 1030);
  // A magazine asking for a fully-unknown id gets nothing, and it never throws.
  assert.doesNotThrow(() => magLifetimeRounds({ id: 'mg-unknown', totalRounds: 0 }, [], matches));
  assert.equal(magLifetimeRounds({ id: 'mg-unknown', totalRounds: 0 }, [], matches), 0);
});
