import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitRounds, gunMagAttribution, magLifetimeRounds } from '../src/lib/mags.ts';

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
  assert.equal(magLifetimeRounds(mag, sessions), 1000 + 50 + 60 + 70);
});

test('lifetime: sessions without mag data add nothing (historical records)', () => {
  const sessions = [liveSession([{ firearmId: 'f1', rounds: 500 }])];
  assert.equal(magLifetimeRounds(mag, sessions), 1000);
});

test('lifetime: trashed, planned, and dry-fire sessions do not count', () => {
  const attributed = [{ firearmId: 'f1', rounds: 100, magIds: ['mg-a'] }];
  const sessions = [
    liveSession(attributed, { deletedAt: 123 }),
    liveSession(attributed, { planned: true }),
    liveSession(attributed, { type: 'dry_fire' }),
    liveSession(attributed), // the only one that counts: +100
  ];
  assert.equal(magLifetimeRounds(mag, sessions), 1100);
});

test('lifetime: multi-gun session attributes each gun separately', () => {
  const sessions = [liveSession([
    { firearmId: 'f1', rounds: 100, magIds: ['mg-a'] },
    { firearmId: 'f2', rounds: 50, magIds: ['mg-a'] }, // same mag on two guns
  ])];
  assert.equal(magLifetimeRounds(mag, sessions), 1150);
});

test('lifetime: junk starting count treated as zero', () => {
  assert.equal(magLifetimeRounds({ id: 'mg-x', totalRounds: NaN }, []), 0);
});
