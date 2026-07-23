// T3-1: timed-skill sets. Pure engine functions (trend, PR, cold-vs-warm) and
// the storage paths — crash-catalog-grade: malformed records, missing
// fields, empty states never crash a screen (rule 23 / charter §3).
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIMED_SKILLS, activeSkillSets, coldVsWarm, formatRepTimes, formatSec, parseRepTimes,
  skillLabel, skillPR, skillSetsForSession, skillSetsFor, skillTrend, skillsWithData
} from '../src/lib/skillSets.ts';
import { commitDataSet, getAll, restoreSnapshot, validateSnapshotShape } from '../src/lib/db.ts';
import type { DataSet, TimedSkill } from '../src/lib/types.ts';
import type { Snapshot } from '../src/lib/flog.ts';

// ---------------------------------------------------------------------------
// Engine: TIMED_SKILLS / skillLabel / formatSec
// ---------------------------------------------------------------------------

test('TIMED_SKILLS lists exactly the five v1 skills, in spec order', () => {
  assert.deepEqual(TIMED_SKILLS.map((s) => s.key), ['draw', 'reload', 'split', 'transition', 'par']);
});

test('skillLabel resolves a known key and falls back to the raw string for an unknown one', () => {
  assert.equal(skillLabel('split'), 'Splits');
  assert.equal(skillLabel('par'), 'Par Drill');
  assert.equal(skillLabel('bogus'), 'bogus');
});

test('formatSec renders two decimal places with a trailing s', () => {
  assert.equal(formatSec(1.4), '1.40s');
  assert.equal(formatSec(1.425), '1.43s'); // rounds, doesn't truncate
});

// ---------------------------------------------------------------------------
// Engine: activeSkillSets / skillSetsForSession / skillSetsFor
// ---------------------------------------------------------------------------

test('activeSkillSets drops sets filed against a trashed session (mirrors activeMalfunctions)', () => {
  const sets = [
    { sessionId: 's1' }, { sessionId: 's2' }, { sessionId: 's1' },
  ];
  const out = activeSkillSets(sets, new Set(['s1']));
  assert.deepEqual(out, [{ sessionId: 's2' }]);
});

test('activeSkillSets with an empty trashed set returns everything', () => {
  const sets = [{ sessionId: 's1' }, { sessionId: 's2' }];
  assert.deepEqual(activeSkillSets(sets, new Set()), sets);
});

test('skillSetsForSession filters to one session; empty list on no match', () => {
  const sets = [{ sessionId: 'a' }, { sessionId: 'b' }, { sessionId: 'a' }];
  assert.equal(skillSetsForSession(sets, 'a').length, 2);
  assert.deepEqual(skillSetsForSession(sets, 'zzz'), []);
});

test('skillSetsFor filters to one skill', () => {
  const sets: { skill: TimedSkill }[] = [{ skill: 'draw' }, { skill: 'reload' }, { skill: 'draw' }];
  assert.equal(skillSetsFor(sets, 'draw').length, 2);
});

// ---------------------------------------------------------------------------
// Engine: skillTrend
// ---------------------------------------------------------------------------

function set(over: Partial<{
  id: string; sessionId: string; date: string; skill: TimedSkill; bestSec: number; cold: boolean;
}>) {
  return {
    id: 'ss-1', sessionId: 'se-1', date: '2026-07-01', skill: 'draw' as TimedSkill, bestSec: 1.5, cold: false,
    ...over,
  };
}

test('skillTrend sorts oldest -> newest and keeps only the requested skill', () => {
  const sets = [
    set({ id: 'a', date: '2026-07-05', bestSec: 1.4 }),
    set({ id: 'b', date: '2026-07-01', bestSec: 1.6 }),
    set({ id: 'c', date: '2026-07-03', skill: 'reload', bestSec: 2.0 }),
  ];
  const out = skillTrend(sets, 'draw');
  assert.deepEqual(out.map((p) => p.id), ['b', 'a']);
});

test('skillTrend drops non-scoreable sets (zero, negative, NaN, Infinity) without throwing', () => {
  const sets = [
    set({ id: 'ok', bestSec: 1.2 }),
    set({ id: 'zero', bestSec: 0 }),
    set({ id: 'neg', bestSec: -1 }),
    set({ id: 'nan', bestSec: NaN }),
    set({ id: 'inf', bestSec: Infinity }),
  ];
  const out = skillTrend(sets, 'draw');
  assert.deepEqual(out.map((p) => p.id), ['ok']);
});

test('skillTrend on an empty list returns an empty array, not a crash', () => {
  assert.deepEqual(skillTrend([], 'draw'), []);
});

test('skillTrend carries the cold flag through untouched', () => {
  const sets = [set({ id: 'a', cold: true }), set({ id: 'b', cold: false, date: '2026-07-02' })];
  const out = skillTrend(sets, 'draw');
  assert.equal(out.find((p) => p.id === 'a')?.cold, true);
  assert.equal(out.find((p) => p.id === 'b')?.cold, false);
});

// ---------------------------------------------------------------------------
// Engine: skillPR
// ---------------------------------------------------------------------------

test('skillPR picks the fastest (lowest) scoreable set, cold sets included', () => {
  const sets = [
    set({ id: 'a', bestSec: 1.6 }),
    set({ id: 'b', bestSec: 1.2, cold: true }), // fastest, but cold — still counts as PR
    set({ id: 'c', bestSec: 1.4 }),
  ];
  const pr = skillPR(sets, 'draw');
  assert.equal(pr?.set.id, 'b');
  assert.equal(pr?.set.cold, true);
});

test('skillPR ties keep the earliest-seen set', () => {
  const sets = [set({ id: 'first', bestSec: 1.3 }), set({ id: 'second', bestSec: 1.3 })];
  assert.equal(skillPR(sets, 'draw')?.set.id, 'first');
});

test('skillPR ignores non-scoreable sets and returns null when nothing qualifies', () => {
  assert.equal(skillPR([set({ bestSec: 0 }), set({ bestSec: NaN })], 'draw'), null);
  assert.equal(skillPR([], 'draw'), null);
});

test('skillPR only looks at the requested skill', () => {
  const sets = [set({ id: 'a', skill: 'reload', bestSec: 0.5 }), set({ id: 'b', skill: 'draw', bestSec: 1.8 })];
  assert.equal(skillPR(sets, 'draw')?.set.id, 'b');
});

// ---------------------------------------------------------------------------
// Engine: coldVsWarm
// ---------------------------------------------------------------------------

test('coldVsWarm averages each side independently', () => {
  const sets = [
    set({ id: 'c1', cold: true, bestSec: 2.0 }),
    set({ id: 'c2', cold: true, bestSec: 2.4 }),
    set({ id: 'w1', cold: false, bestSec: 1.5 }),
  ];
  const split = coldVsWarm(sets, 'draw');
  assert.equal(split.coldAvgSec, 2.2);
  assert.equal(split.warmAvgSec, 1.5);
  assert.equal(split.coldCount, 2);
  assert.equal(split.warmCount, 1);
});

test('coldVsWarm returns null (not NaN, not zero) for a side with no data — honest "not enough data" shape', () => {
  const split = coldVsWarm([set({ cold: false, bestSec: 1.5 })], 'draw');
  assert.equal(split.coldAvgSec, null);
  assert.equal(split.coldCount, 0);
  assert.equal(split.warmAvgSec, 1.5);
});

test('coldVsWarm on no sets at all: both sides null, never throws', () => {
  const split = coldVsWarm([], 'draw');
  assert.deepEqual(split, { coldAvgSec: null, warmAvgSec: null, coldCount: 0, warmCount: 0 });
});

// ---------------------------------------------------------------------------
// Engine: skillsWithData
// ---------------------------------------------------------------------------

test('skillsWithData lists only skills with at least one scoreable set, in TIMED_SKILLS order', () => {
  const sets = [
    set({ skill: 'par', bestSec: 5 }),
    set({ skill: 'draw', bestSec: 1.2 }),
    set({ skill: 'reload', bestSec: 0 }), // not scoreable
  ];
  assert.deepEqual(skillsWithData(sets), ['draw', 'par']);
});

test('skillsWithData on an empty log returns an empty array', () => {
  assert.deepEqual(skillsWithData([]), []);
});

// ---------------------------------------------------------------------------
// Engine: parseRepTimes / formatRepTimes
// ---------------------------------------------------------------------------

test('parseRepTimes splits on commas and/or spaces and drops junk tokens', () => {
  assert.deepEqual(parseRepTimes('1.42, 1.51 1.38'), [1.42, 1.51, 1.38]);
  assert.deepEqual(parseRepTimes('1.4,,  1.5,'), [1.4, 1.5]);
});

test('parseRepTimes drops non-positive and non-numeric tokens without failing the whole entry', () => {
  assert.deepEqual(parseRepTimes('1.4, oops, -1, 0, 1.6'), [1.4, 1.6]);
});

test('parseRepTimes on empty/whitespace input returns an empty array', () => {
  assert.deepEqual(parseRepTimes(''), []);
  assert.deepEqual(parseRepTimes('   '), []);
});

test('formatRepTimes round-trips through parseRepTimes and handles null/undefined', () => {
  assert.equal(formatRepTimes([1.42, 1.51]), '1.42, 1.51');
  assert.equal(formatRepTimes(null), '');
  assert.equal(formatRepTimes(undefined), '');
});

// ---------------------------------------------------------------------------
// Storage: commitDataSet / restoreSnapshot / validateSnapshotShape
// ---------------------------------------------------------------------------

function dataSetWith(over: Record<string, unknown[]>): DataSet {
  const base: Record<string, unknown[]> = {
    firearms: [], sessions: [], drills: [], ammunition: [], purchases: [],
    maintenance: [], malfunctions: [], magazines: [], optics: [], parts: [],
    goals: [], skills: [], skillSets: [], matches: [], classifiers: [], references: [], trash: [], media: [],
  };
  return { ...base, ...over } as unknown as DataSet;
}

function snapshotWith(stores: Record<string, unknown[]>): Snapshot {
  return { exportedAt: Date.now(), lastModified: Date.now(), stores, media: [] } as unknown as Snapshot;
}

const has = (rows: { id: string }[], id: string) => rows.some((r) => r.id === id);

test('commitDataSet writes skillSets records that getAll reads back', async () => {
  await commitDataSet(dataSetWith({
    skillSets: [{ id: 'ss-commit', sessionId: 'se-1', skill: 'draw', bestSec: 1.4 }],
  }), undefined);
  assert.ok(has(await getAll('skillSets'), 'ss-commit'));
});

test('commitDataSet with skillSets OMITTED entirely (an older import shape) writes nothing for it, never throws', async () => {
  // Simulates a DataSet built before this field existed reaching commitDataSet —
  // `putAll` treats a missing section as empty (existing convention, see db.ts).
  const partial = dataSetWith({});
  delete (partial as unknown as Record<string, unknown>).skillSets;
  await assert.doesNotReject(commitDataSet(partial, undefined));
});

test('restoreSnapshot round-trips skillSets like any other store', async () => {
  await restoreSnapshot(snapshotWith({
    skillSets: [{ id: 'ss-restore', sessionId: 'se-1', skill: 'reload', bestSec: 2.1 }],
  }));
  assert.ok(has(await getAll('skillSets'), 'ss-restore'));
});

test('restoreSnapshot with skillSets absent from the file (an OLDER .flog) treats it as empty, not an error', async () => {
  // A pre-T3-1 .flog file simply has no "skillSets" key in stores{}.
  await assert.doesNotReject(restoreSnapshot(snapshotWith({ firearms: [{ id: 'g1' }] })));
  assert.deepEqual(await getAll('skillSets'), []);
});

test('validateSnapshotShape rejects a skillSets row with no id, before any write', () => {
  assert.throws(
    () => validateSnapshotShape(snapshotWith({ skillSets: [{ sessionId: 'se-1', skill: 'draw' }] })),
    /"skillSets"/
  );
  // A well-formed row does not throw.
  validateSnapshotShape(snapshotWith({ skillSets: [{ id: 'ok', sessionId: 'se-1' }] }));
});

test('validateSnapshotShape rejects a skillSets section that is not an array', () => {
  assert.throws(
    () => validateSnapshotShape(snapshotWith({ skillSets: { not: 'an array' } as unknown as unknown[] })),
    /"skillSets"/
  );
});
