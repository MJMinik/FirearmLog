// Pass 2: the storage half of the stage-scores importer. Runs against
// fake-indexeddb (an in-memory IndexedDB) so the real db.ts logic executes,
// exactly as tests/csvImportStore.test.ts and tests/db.test.ts do.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOne, putOne } from '../src/lib/db.ts';
import { stampNew } from '../src/lib/stamps.ts';
import { scoreStageHits } from '../src/lib/competition.ts';
import {
  applyStageScore, commitStageScore, stageFilled, StageScoreWriteError,
} from '../src/lib/stageScoresWrite.ts';
import type { AcceptedStageScore, StageReviewRow } from '../src/lib/stageScores.ts';
import type { Match } from '../src/lib/types.ts';

/** A minimal but realistic Review row -- only the fields applyStageScore and
 *  its callers actually read carry real values; the rest are inert filler. */
function row(over: Partial<StageReviewRow> = {}): StageReviewRow {
  return {
    name: 'Minik, Michael', memberNumber: 'A200101', squad: '1', classLetter: 'B',
    category: '', division: 'CO', powerFactor: 'Min',
    alphas: 20, bravos: 0, charlies: 2, deltas: 0, misses: 0, noShoots: 0, procedurals: 0,
    additionalPenalties: 0, time: 12.34, printedHitFactor: null, timeOfDay: '10:00:00', edited: false, dnf: false,
    ...over,
  };
}

/** Build a real AcceptedStageScore the same way parseStagePaste would --
 *  scored through the real scorer, so the honesty-gate math this file relies
 *  on is genuine, not hand-typed. */
function accept(over: Partial<StageReviewRow> = {}): AcceptedStageScore {
  const r = row(over);
  const hits = { alphas: r.alphas, charlies: r.charlies, deltas: r.deltas, misses: r.misses, noShoots: r.noShoots, procedurals: r.procedurals };
  const derived = scoreStageHits(hits, 'Minor', r.time)!;
  return { row: r, hits, time: r.time as number, derived, printedHitFactor: derived.hitFactor as number };
}

function match(stages: Match['stages'], over: Partial<Match> = {}): Match {
  return stampNew({
    date: '2026-08-02', name: 'Gun Craft Match', matchType: 'USPSA Level 1', division: 'Carry Optics',
    powerFactor: 'Minor', scoringType: 'uspsa', firearmId: 'fa-1', totalRounds: null,
    matchPercent: null, divisionPlace: null, divisionOf: null, overallPlace: null, overallOf: null,
    stages, entryFee: null, practiScoreUrl: '', notes: '',
    ...over,
  }, 'mt-test', 1) as Match;
}

function blankStage(number: number): Match['stages'][number] {
  return { number, points: null, time: null, percent: null, notes: '' };
}

// ── applyStageScore (pure merge) ────────────────────────────────────────────

test('applyStageScore writes the six hit fields + time onto the target stage only', () => {
  const m = match([blankStage(1), blankStage(2)]);
  const out = applyStageScore(m, 2, accept(), 1000)!;
  assert.equal(out.stages[0].alphas, undefined); // stage 1 untouched
  assert.equal(out.stages[1].alphas, 20);
  assert.equal(out.stages[1].charlies, 2);
  assert.equal(out.stages[1].time, 12.34);
});

test('applyStageScore never touches percent', () => {
  const m = match([{ ...blankStage(1), percent: 87.5 }]);
  const out = applyStageScore(m, 1, accept(), 1000)!;
  assert.equal(out.stages[0].percent, 87.5);
});

test('applyStageScore does not mutate its input', () => {
  const m = match([blankStage(1)]);
  const before = JSON.stringify(m);
  applyStageScore(m, 1, accept(), 1000);
  assert.equal(JSON.stringify(m), before);
});

test('applyStageScore returns null for a stage number that does not exist', () => {
  const m = match([blankStage(1)]);
  assert.equal(applyStageScore(m, 5, accept(), 1000), null);
});

test('applyStageScore adds one legacy note per stage, independently keyed', () => {
  const m = match([blankStage(1), blankStage(2)]);
  const afterOne = applyStageScore(m, 1, accept(), 1000)!;
  const afterTwo = applyStageScore(afterOne, 2, accept(), 2000)!;
  const log = afterTwo.legacy!.stageScores as Record<string, { importedAt: number }>;
  assert.equal(Object.keys(log).length, 2);
  assert.equal(log['1'].importedAt, 1000);
  assert.equal(log['2'].importedAt, 2000);
});

test('applyStageScore re-importing the SAME stage updates its one note, never adds a second', () => {
  const m = match([blankStage(1)]);
  const first = applyStageScore(m, 1, accept(), 1000)!;
  const second = applyStageScore(first, 1, accept(), 5000)!;
  const log = second.legacy!.stageScores as Record<string, { importedAt: number }>;
  assert.equal(Object.keys(log).length, 1);
  assert.equal(log['1'].importedAt, 5000);
});

test('applyStageScore preserves an existing legacy field from another importer (add, never replace)', () => {
  const m = match([blankStage(1)], { legacy: { source: 'practiscore', memberNumber: 'A200101' } });
  const out = applyStageScore(m, 1, accept(), 1000)!;
  assert.equal(out.legacy!.source, 'practiscore');
  assert.equal(out.legacy!.memberNumber, 'A200101');
  assert.ok(out.legacy!.stageScores);
});

// ── stageFilled ──────────────────────────────────────────────────────────

test('stageFilled is false for a blank stage and true once a breakdown exists', () => {
  const m = match([blankStage(1)]);
  assert.equal(stageFilled(m, 1), false);
  const filled = applyStageScore(m, 1, accept(), 1000)!;
  assert.equal(stageFilled(filled, 1), true);
});

test('stageFilled is false for a stage number that does not exist', () => {
  const m = match([blankStage(1)]);
  assert.equal(stageFilled(m, 9), false);
});

// ── commitStageScore (the real read-then-write) ─────────────────────────────

test('commitStageScore writes the match and is readable back afterward', async () => {
  const m = match([blankStage(1)]);
  await putOne('matches', m);
  const out = await commitStageScore(m.id, 1, accept(), false);
  assert.equal(out.stages[0].alphas, 20);
  const onDisk = await getOne<Match>('matches', m.id);
  assert.equal(onDisk!.stages[0].alphas, 20);
});

test('commitStageScore refuses to overwrite a filled stage without allowOverwrite', async () => {
  const m = match([blankStage(1)]);
  await putOne('matches', m);
  await commitStageScore(m.id, 1, accept(), false);
  await assert.rejects(
    () => commitStageScore(m.id, 1, accept({ alphas: 1, charlies: 0 }), false),
    (e: unknown) => e instanceof StageScoreWriteError && e.code === 'stage-already-filled',
  );
  // Nothing was overwritten by the refused call.
  const onDisk = await getOne<Match>('matches', m.id);
  assert.equal(onDisk!.stages[0].alphas, 20);
});

test('commitStageScore overwrites a filled stage when allowOverwrite is true', async () => {
  const m = match([blankStage(1)]);
  await putOne('matches', m);
  await commitStageScore(m.id, 1, accept(), false);
  const secondAccept = accept({ alphas: 15, charlies: 4, deltas: 1 });
  await commitStageScore(m.id, 1, secondAccept, true);
  const onDisk = await getOne<Match>('matches', m.id);
  assert.equal(onDisk!.stages[0].alphas, 15);
  // Still exactly one provenance note for the stage, not two.
  const log = onDisk!.legacy!.stageScores as Record<string, unknown>;
  assert.equal(Object.keys(log).length, 1);
});

test('commitStageScore refuses when the match no longer exists', async () => {
  await assert.rejects(
    () => commitStageScore('mt-does-not-exist', 1, accept(), false),
    (e: unknown) => e instanceof StageScoreWriteError && e.code === 'match-not-found',
  );
});

test('commitStageScore refuses when the stage number does not exist on the match', async () => {
  const m = match([blankStage(1)]);
  await putOne('matches', m);
  await assert.rejects(
    () => commitStageScore(m.id, 7, accept(), false),
    (e: unknown) => e instanceof StageScoreWriteError && e.code === 'stage-not-found',
  );
});

// THE re-read-before-write test: a stale in-memory snapshot must never win
// over what is actually on disk. This is the observable behaviour spec
// section 6a Seat 8 condition 4 requires, and the exact bug class the whole
// function exists to prevent -- a screen held open while something else
// (another tab, a sync, an edit elsewhere) changed the match.
test('commitStageScore re-reads from disk immediately before writing -- a concurrent change survives', async () => {
  const m = match([blankStage(1), blankStage(2)]);
  await putOne('matches', m);

  // Something else changes the match's notes AFTER the screen would have
  // loaded it but BEFORE this write happens -- commitStageScore itself does
  // the loading, so there is no stale object anywhere in this call for it to
  // have been handed; the only way the concurrent edit survives is a real
  // re-read at write time.
  const concurrentlyEdited = { ...m, notes: 'edited elsewhere while the paste screen was open' };
  await putOne('matches', concurrentlyEdited);

  await commitStageScore(m.id, 1, accept(), false);

  const onDisk = await getOne<Match>('matches', m.id);
  assert.equal(onDisk!.notes, 'edited elsewhere while the paste screen was open');
  assert.equal(onDisk!.stages[0].alphas, 20);
  // The other stage, untouched by either write, is exactly as it started.
  assert.equal(onDisk!.stages[1].alphas, undefined);
});
