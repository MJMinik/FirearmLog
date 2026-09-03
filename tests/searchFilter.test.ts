// B6 — Log search & filter behavior, pinned by tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLogFilter, filterCount, sessionKind,
  sessionMatchesFilter, matchMatchesFilter
} from '../src/lib/searchFilter.ts';
import type { LogFilter } from '../src/lib/searchFilter.ts';
import type { Firearm, Match, Session } from '../src/lib/types.ts';

const base = { createdAt: 0, updatedAt: 0 };

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

function f(p: Partial<LogFilter>): LogFilter { return { ...emptyLogFilter(), ...p }; }

test('empty filter lets everything through and counts zero', () => {
  assert.equal(filterCount(emptyLogFilter()), 0);
  assert.equal(sessionMatchesFilter(ses({}), emptyLogFilter(), guns), true);
  assert.equal(matchMatchesFilter(mat({}), emptyLogFilter(), guns), true);
});

test('sessionKind buckets old-app type strings', () => {
  assert.equal(sessionKind('practice'), 'practice');
  assert.equal(sessionKind('dry_fire'), 'dry');
  assert.equal(sessionKind('class'), 'class');
  assert.equal(sessionKind('anything-else'), 'practice');
});

test('From/To dates clip both sessions and matches (inclusive)', () => {
  const range = f({ from: '2026-06-01', to: '2026-06-07' });
  assert.equal(sessionMatchesFilter(ses({ date: '2026-06-01' }), range, guns), true);
  assert.equal(sessionMatchesFilter(ses({ date: '2026-05-31' }), range, guns), false);
  assert.equal(matchMatchesFilter(mat({ date: '2026-06-07' }), range, guns), true);
  assert.equal(matchMatchesFilter(mat({ date: '2026-06-08' }), range, guns), false);
});

test('individual gun wins; category matches ANY gun in a split session', () => {
  const split = ses({ guns: [{ firearmId: 'g1', rounds: 50 }, { firearmId: 'g2', rounds: 25 }] });
  assert.equal(sessionMatchesFilter(split, f({ firearmId: 'g2' }), guns), true);
  assert.equal(sessionMatchesFilter(ses({}), f({ firearmId: 'g2' }), guns), false);
  assert.equal(sessionMatchesFilter(split, f({ category: 'Shotgun' }), guns), true);
  assert.equal(sessionMatchesFilter(ses({}), f({ category: 'Shotgun' }), guns), false);
  assert.equal(matchMatchesFilter(mat({}), f({ category: 'Pistol' }), guns), true);
  assert.equal(matchMatchesFilter(mat({}), f({ firearmId: 'g2' }), guns), false);
});

test('kind toggles: dry fire only, matches only', () => {
  const dryOnly = f({ kinds: ['dry'] });
  assert.equal(sessionMatchesFilter(ses({ type: 'dry_fire' }), dryOnly, guns), true);
  assert.equal(sessionMatchesFilter(ses({}), dryOnly, guns), false);
  assert.equal(matchMatchesFilter(mat({}), dryOnly, guns), false);
  assert.equal(matchMatchesFilter(mat({}), f({ kinds: ['match'] }), guns), true);
});

test('planned: only / hide; matches never count as planned', () => {
  assert.equal(sessionMatchesFilter(ses({ planned: true }), f({ planned: 'only' }), guns), true);
  assert.equal(sessionMatchesFilter(ses({}), f({ planned: 'only' }), guns), false);
  assert.equal(sessionMatchesFilter(ses({ planned: true }), f({ planned: 'hide' }), guns), false);
  assert.equal(matchMatchesFilter(mat({}), f({ planned: 'only' }), guns), false);
  assert.equal(matchMatchesFilter(mat({}), f({ planned: 'hide' }), guns), true);
});

test('global search reaches location, instructor, drills, gun names, match fields', () => {
  const s = ses({ location: 'Shoot Straight: University', instructor: 'Ben Stoeger', drills: [
    { name: 'Bill Drill', distance: '7y', time: null, score: null, maxScore: null, notes: 'worked the draw' }
  ] });
  assert.equal(sessionMatchesFilter(s, f({ query: 'university' }), guns), true);
  assert.equal(sessionMatchesFilter(s, f({ query: 'stoeger' }), guns), true);
  assert.equal(sessionMatchesFilter(s, f({ query: 'bill drill' }), guns), true);
  assert.equal(sessionMatchesFilter(s, f({ query: 'erebus' }), guns), true);
  assert.equal(sessionMatchesFilter(s, f({ query: 'zebra' }), guns), false);
  assert.equal(matchMatchesFilter(mat({}), f({ query: 'carry optics' }), guns), true);
  assert.equal(matchMatchesFilter(mat({}), f({ query: 'zebra' }), guns), false);
});

// Power-factor-codes fix: searchFilter.ts mirrors canonicalDivision with
// suggestPowerFactor, so a match stored under PractiScore's raw short code
// is findable by the canonical word too, not only by the code itself.
test('global search finds a "Maj"-stored match by "major", and "minor" does not match it', () => {
  const majMatch = mat({ powerFactor: 'Maj' });
  assert.equal(matchMatchesFilter(majMatch, f({ query: 'major' }), guns), true);
  assert.equal(matchMatchesFilter(majMatch, f({ query: 'minor' }), guns), false);
  // The raw code itself still matches too -- nothing about the raw string search is lost.
  assert.equal(matchMatchesFilter(majMatch, f({ query: 'maj' }), guns), true);
});

test('filterCount tallies one per active criterion', () => {
  assert.equal(filterCount(f({ from: '2026-01-01' })), 1);
  assert.equal(filterCount(f({ firearmId: 'g1', category: 'Pistol' })), 1); // gun wins, counts once
  assert.equal(filterCount(f({ kinds: ['dry'], planned: 'hide', query: 'x' })), 3);
  assert.equal(filterCount(f({ kinds: ['practice', 'dry', 'class', 'match'] })), 0); // all on = no narrowing
});
