// findLikelyDuplicate (DUPLICATE_IMPORT_DETECTION_SPEC.md §5, 22 Aug 2026,
// session 129/130): same date + normalised name is the honest signal for
// "this looks like a match you already saved" — every case below names the
// impostor it would catch. Follows dashboard.test.ts's node:test +
// assert/strict conventions and its minimal-literal-with-a-helper shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLikelyDuplicate } from '../src/lib/matchDupe.ts';
import type { Match } from '../src/lib/types.ts';

const base = { createdAt: 0, updatedAt: 0 };

/** A minimal, valid Match literal — every field the type demands gets an
 *  inert default, and callers override only what a given test cares about. */
function match(p: Partial<Match> & { id: string; date: string; name: string }): Match {
  return {
    ...base,
    matchType: 'USPSA Level 1', division: 'Carry Optics', powerFactor: 'Minor',
    firearmId: 'g1', totalRounds: null, overallPlace: null, overallOf: null,
    divisionPlace: null, divisionOf: null, matchPercent: null, stages: [],
    entryFee: null, practiScoreUrl: '', notes: '',
    ...p,
  };
}

test('same date and name hits', () => {
  const existing = [match({ id: 'm1', date: '2026-08-09', name: 'Gun Craft Steel Challenge' })];
  assert.equal(findLikelyDuplicate('2026-08-09', 'Gun Craft Steel Challenge', existing)?.id, 'm1');
});

test('case and whitespace variants still hit — normalisation lives inside the helper', () => {
  // Catches: a mutant that compares the raw strings instead of the
  // normalised ones.
  const existing = [match({ id: 'm1', date: '2026-08-09', name: '  Gun  Craft ' })];
  assert.equal(findLikelyDuplicate('2026-08-09', 'gun craft', existing)?.id, 'm1');
});

test('a different date misses, even with the identical name', () => {
  const existing = [match({ id: 'm1', date: '2026-08-09', name: 'Gun Craft Steel Challenge' })];
  assert.equal(findLikelyDuplicate('2026-08-10', 'Gun Craft Steel Challenge', existing), null);
});

test('a different name misses, even on the identical date', () => {
  const existing = [match({ id: 'm1', date: '2026-08-09', name: 'Gun Craft Steel Challenge' })];
  assert.equal(findLikelyDuplicate('2026-08-09', 'Red Brush Steel Challenge', existing), null);
});

test('a soft-deleted match is never a hit', () => {
  // Catches: a mutant that drops the deletedAt check — a trashed match is
  // restorable, but not currently in the log, and must not warn against a
  // match the shooter can't even see.
  const existing = [match({ id: 'm1', date: '2026-08-09', name: 'Gun Craft Steel Challenge', deletedAt: Date.now() })];
  assert.equal(findLikelyDuplicate('2026-08-09', 'Gun Craft Steel Challenge', existing), null);
});

test('an empty name matches only an empty name — ordinary equality needs no special case', () => {
  const existing = [match({ id: 'm1', date: '2026-08-09', name: '' })];
  assert.equal(findLikelyDuplicate('2026-08-09', '', existing)?.id, 'm1');
  assert.equal(findLikelyDuplicate('2026-08-09', 'Gun Craft Steel Challenge', existing), null);
});

test('an empty date argument returns null unconditionally — fails safe even if a caller forgets to guard it', () => {
  // Catches: a mutant that drops the empty-date guard and lets a blank date
  // match a record whose own date also happens to be blank.
  const existing = [match({ id: 'm1', date: '', name: 'Gun Craft Steel Challenge' })];
  assert.equal(findLikelyDuplicate('', 'Gun Craft Steel Challenge', existing), null);
});

test('the FIRST qualifying record is returned when two exist', () => {
  const existing = [
    match({ id: 'm1', date: '2026-08-09', name: 'Gun Craft Steel Challenge' }),
    match({ id: 'm2', date: '2026-08-09', name: 'Gun Craft Steel Challenge' }),
  ];
  assert.equal(findLikelyDuplicate('2026-08-09', 'Gun Craft Steel Challenge', existing)?.id, 'm1');
});
