// Power-factor short codes -- POWER_FACTOR_NORMALISATION_SPEC.md, the mirror of
// the division-normalisation fix, and the part that is worse: PractiScore's own
// pages write 'Min'/'Maj' far more often than the full words, and the readers
// that decide Major from the stored string used to compare it to the literal
// 'Major' -- so a stored 'Maj' silently scored as Minor. Runner: node --test,
// same as every other tests/*.test.ts. Import paths use explicit .ts extensions,
// matching every existing test in this repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestPowerFactor, isMajor, scoreStageHits } from '../src/lib/competition.ts';
import { rowPowerFactorDisagrees } from '../src/lib/stageScores.ts';
import { parseStagePaste, type StageScoreContext } from '../src/lib/stageScores.ts';
import { GUNCRAFT_2026_08_02_STAGE1_REVIEW } from './fixtures/stageScoresGuncraft-2026-08-02.ts';

// ---------------------------------------------------------------------------
// suggestPowerFactor -- the truth table (spec section 4.1)
// ---------------------------------------------------------------------------

test('suggestPowerFactor: short codes and full words, case-insensitive and trimmed', () => {
  assert.equal(suggestPowerFactor('Min'), 'Minor');
  assert.equal(suggestPowerFactor('min'), 'Minor');
  assert.equal(suggestPowerFactor('MIN'), 'Minor');
  assert.equal(suggestPowerFactor(' Minor '), 'Minor');
  assert.equal(suggestPowerFactor('Maj'), 'Major');
  assert.equal(suggestPowerFactor('MAJOR'), 'Major');
  assert.equal(suggestPowerFactor('Major'), 'Major');
});

test('suggestPowerFactor: anything unrecognised returns null, never a guess', () => {
  assert.equal(suggestPowerFactor(''), null);
  assert.equal(suggestPowerFactor('M'), null);
  assert.equal(suggestPowerFactor('???'), null);
  assert.equal(suggestPowerFactor('Minor Major'), null);
});

// Cold audit M-1 (power-factor-codes verify pass): recordShape.ts deliberately
// passes a record's fields through unchanged when they don't match the expected
// shape (ADD, NEVER REPLACE), so a malformed .flog can hand this an object or
// array at runtime -- past what the `string` parameter type promises. Before the
// fix, `(stored ?? '').trim()` threw on that (no `.trim` on an object/array),
// which took the Log tab and Match detail down behind the error boundary for a
// record that rendered fine on main. `as never` bypasses the type checker to
// exercise exactly the runtime shape recordShape.ts can actually hand it.
test('suggestPowerFactor: a non-string value (a malformed record, past the type checker) reads as unrecognised, never throws (cold audit M-1)', () => {
  assert.equal(suggestPowerFactor(['Maj'] as never), null);
  assert.equal(suggestPowerFactor({} as never), null);
  assert.equal(suggestPowerFactor(undefined as never), null);
});

test('isMajor: a non-string value is false, not a throw (cold audit M-1)', () => {
  assert.equal(isMajor(['Maj'] as never), false);
  assert.equal(isMajor({} as never), false);
  assert.equal(isMajor(undefined as never), false);
});

// ---------------------------------------------------------------------------
// isMajor -- the single source of truth every scorer must call (decision 2a)
// ---------------------------------------------------------------------------

test('isMajor: true for every spelling of Major, false for everything else including unrecognised', () => {
  assert.equal(isMajor('Major'), true);
  assert.equal(isMajor('Maj'), true);
  assert.equal(isMajor('MAJOR'), true);
  assert.equal(isMajor('maj'), true);
  assert.equal(isMajor('Minor'), false);
  assert.equal(isMajor('Min'), false);
  assert.equal(isMajor(''), false);
  assert.equal(isMajor('???'), false);
});

// ---------------------------------------------------------------------------
// scoreStageHits -- 'Maj' must score identically to 'Major' (the scoring
// defect, not just a display one: §1 of the spec, proof 1)
// ---------------------------------------------------------------------------

test('scoreStageHits("Maj") deep-equals scoreStageHits("Major") -- the real Gun Craft Stage 1 Ferreira hits', () => {
  const hits = { alphas: 15, charlies: 8, deltas: 1, misses: 2, noShoots: 0, procedurals: 0 };
  const time = 16.55;
  const viaMaj = scoreStageHits(hits, 'Maj', time);
  const viaMajor = scoreStageHits(hits, 'Major', time);
  assert.deepEqual(viaMaj, viaMajor);
  assert.equal(viaMaj?.stagePoints, 89);
  assert.equal(viaMaj?.hitFactor, 5.3776);
});

// ---------------------------------------------------------------------------
// rowPowerFactorDisagrees -- canonical-to-canonical (spec section 4.1)
// ---------------------------------------------------------------------------

test('rowPowerFactorDisagrees: short code vs short code -- both sides go through the same canonicaliser', () => {
  assert.equal(rowPowerFactorDisagrees('Maj', 'Maj'), false);
  assert.equal(rowPowerFactorDisagrees('Maj', 'Major'), false);
  assert.equal(rowPowerFactorDisagrees('Min', 'Maj'), true);
  assert.equal(rowPowerFactorDisagrees('???', 'Maj'), false);
});

test('rowPowerFactorDisagrees: the existing six cases still hold', () => {
  assert.equal(rowPowerFactorDisagrees('Min', 'Minor'), false);
  assert.equal(rowPowerFactorDisagrees('Minor', 'Minor'), false);
  assert.equal(rowPowerFactorDisagrees('Maj', 'Minor'), true);
  assert.equal(rowPowerFactorDisagrees('Major', 'Major'), false);
  assert.equal(rowPowerFactorDisagrees('', 'Minor'), false);
  assert.equal(rowPowerFactorDisagrees('???', 'Minor'), false);
});

// Cold audit M-2 (power-factor-codes verify pass): a blank or unrecognised
// MATCH value still scores Minor in scoreStageHits (isMajor returns false for
// it), so a 'Maj' row against such a match IS a real disagreement -- the
// `matchPf !== null &&` guard the first pass added hid exactly that, silently
// treating an unreadable match value the same as "no disagreement". The fix
// compares the ROW's canonical reading against what the match actually scores
// as (isMajor(matchPowerFactor)), not against a second independently-
// recognised match value.
test('rowPowerFactorDisagrees: a blank or unrecognised MATCH value is compared against what the scorer actually did (cold audit M-2)', () => {
  assert.equal(rowPowerFactorDisagrees('Maj', ''), true);     // blank match scores Minor; row says Major -> real disagreement
  assert.equal(rowPowerFactorDisagrees('Min', ''), false);    // blank match scores Minor; row says Minor -> agrees
  assert.equal(rowPowerFactorDisagrees('Maj', '???'), true);  // unrecognised match scores Minor (isMajor false); row says Major
  assert.equal(rowPowerFactorDisagrees('Maj', 'Maj'), false);
  assert.equal(rowPowerFactorDisagrees('Maj', 'Major'), false);
  assert.equal(rowPowerFactorDisagrees('Min', 'Maj'), true);
  assert.equal(rowPowerFactorDisagrees('???', 'Maj'), false); // row still never guesses
});

// ---------------------------------------------------------------------------
// Real-fixture proof (spec section 4.2 / 1.1 Proof 2): the stage-scores
// importer must stop refusing a Major shooter whose match is stored 'Maj' --
// exactly what the overall-results import writes for him.
// ---------------------------------------------------------------------------

const ctx = (over: Partial<StageScoreContext>): StageScoreContext => ({
  powerFactor: 'Minor', storedNames: [], ...over,
});

test('Gun Craft Stage 1: Ferreira, Mateo scored against a match stored "Maj" (pre-fix shape) is accepted, not refused as hf-mismatch', () => {
  const result = parseStagePaste(
    GUNCRAFT_2026_08_02_STAGE1_REVIEW,
    ctx({ powerFactor: 'Maj', memberNumber: 'A200103', storedNames: ['Ferreira, Mateo'] }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.accepted.hits, {
    alphas: 15, charlies: 8, deltas: 1, misses: 2, noShoots: 0, procedurals: 0,
  });
  assert.equal(result.accepted.time, 16.55);
  assert.equal(result.accepted.derived.stagePoints, 89);
  assert.equal(result.accepted.derived.hitFactor, 5.3776);
  assert.equal(result.accepted.printedHitFactor, 5.3776);
});
