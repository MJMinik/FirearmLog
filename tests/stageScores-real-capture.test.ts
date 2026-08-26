// Real PractiScore stage Review/Combined captures, driven through the stage-
// scores parser end to end (same split as practiscore-real-capture.test.ts:
// tests/stageScores.test.ts covers the rules one at a time with small,
// purpose-built inputs; this file takes whole real pages exactly as a
// shooter obtains them and asserts what comes out).
//
// Every hit/time/HF figure asserted below is the REAL posted number from
// the signed spec's evidence-capture (STAGE_SCORES_SPEC.md section 3a/3):
// only shooter names and member numbers were anonymised for this public
// repo -- see the fixtures' own headers for the alias map and why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStagePaste, type StageScoreContext } from '../src/lib/stageScores.ts';
import {
  GUNCRAFT_2026_08_02_STAGE1_REVIEW,
  GUNCRAFT_2026_08_02_STAGE7_REVIEW,
  GUNCRAFT_2026_08_02_STAGE1_COMBINED,
} from './fixtures/stageScoresGuncraft-2026-08-02.ts';
import {
  TAKE_AIM_2026_08_03_STAGE1_REVIEW,
} from './fixtures/stageScoresTakeAim-2026-08-03.ts';
import { GUN_CRAFT_2026_08_02 } from './fixtures/practiscore-guncraft-2026-08-02.ts';

const ctx = (over: Partial<StageScoreContext>): StageScoreContext => ({
  powerFactor: 'Minor', storedNames: [], ...over,
});

// ---------------------------------------------------------------------------
// Gun Craft, Stage 1 -- the three hand-verified rows from the signed spec
// (section 3): Ashgrove/Priya (was Minik/Michael), Salazar/Devon (was
// Birrey/Vinny, the penalty case), Ferreira/Mateo (was Alvarado/Roberto,
// the Major-PF case).
// ---------------------------------------------------------------------------

test('Gun Craft Stage 1: Ashgrove, Priya -- 19A 6C 1M, Minor, 103 pts, HF 1.9800', () => {
  const result = parseStagePaste(
    GUNCRAFT_2026_08_02_STAGE1_REVIEW,
    ctx({ powerFactor: 'Minor', memberNumber: 'A200101', storedNames: ['Ashgrove, Priya'] }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.accepted.hits, {
    alphas: 19, charlies: 6, deltas: 0, misses: 1, noShoots: 0, procedurals: 0,
  });
  assert.equal(result.accepted.time, 52.02);
  assert.equal(result.accepted.derived.stagePoints, 103);
  assert.equal(result.accepted.derived.hitFactor, 1.98);
  assert.equal(result.accepted.printedHitFactor, 1.98);
});

test('Gun Craft Stage 1: Salazar, Devon -- 13A 9C 1D 3M 1Proc, Minor, 53 pts, HF 2.9379 (penalty case)', () => {
  const result = parseStagePaste(
    GUNCRAFT_2026_08_02_STAGE1_REVIEW,
    ctx({ powerFactor: 'Minor', memberNumber: 'A200102', storedNames: ['Salazar, Devon'] }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.accepted.hits, {
    alphas: 13, charlies: 9, deltas: 1, misses: 3, noShoots: 0, procedurals: 1,
  });
  assert.equal(result.accepted.derived.stagePoints, 53);
  assert.equal(result.accepted.derived.hitFactor, 2.9379);
  assert.equal(result.accepted.printedHitFactor, 2.9379);
});

test('Gun Craft Stage 1: Ferreira, Mateo -- 15A 8C 1D 2M, Major, 89 pts, HF 5.3776 (Major-PF case)', () => {
  const result = parseStagePaste(
    GUNCRAFT_2026_08_02_STAGE1_REVIEW,
    ctx({ powerFactor: 'Major', memberNumber: 'A200103', storedNames: ['Ferreira, Mateo'] }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.accepted.hits, {
    alphas: 15, charlies: 8, deltas: 1, misses: 2, noShoots: 0, procedurals: 0,
  });
  assert.equal(result.accepted.derived.stagePoints, 89);
  assert.equal(result.accepted.derived.hitFactor, 5.3776);
  assert.equal(result.accepted.printedHitFactor, 5.3776);
});

// ---------------------------------------------------------------------------
// The floored-to-zero hit factor, and the same shooter DNF'ing the next
// stage (both real: Whitlock, Nadia, was Gross, Alex -- blank member number
// on the real page, selected by name alone).
// ---------------------------------------------------------------------------

test('Gun Craft Stage 1: Whitlock, Nadia -- raw -67 floors to 0, HF 0.0000 (not negative, not refused)', () => {
  const result = parseStagePaste(
    GUNCRAFT_2026_08_02_STAGE1_REVIEW,
    ctx({ powerFactor: 'Minor', storedNames: ['Whitlock, Nadia'] }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.accepted.hits, {
    alphas: 10, charlies: 4, deltas: 1, misses: 11, noShoots: 0, procedurals: 2,
  });
  assert.equal(result.accepted.derived.rawHitPoints, 63); // 10*5 + 4*3 + 1*1
  assert.equal(result.accepted.derived.stagePoints, 0);   // max(0, 63 - 10*13)
  assert.equal(result.accepted.derived.hitFactor, 0);
  assert.equal(result.accepted.printedHitFactor, 0);
});

test('Gun Craft Stage 7: the same shooter (Whitlock, Nadia) did not shoot -- refused as dnf, never zeros', () => {
  const result = parseStagePaste(
    GUNCRAFT_2026_08_02_STAGE7_REVIEW,
    ctx({ powerFactor: 'Minor', storedNames: ['Whitlock, Nadia'] }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'dnf');
});

// ---------------------------------------------------------------------------
// Take Aim, Stage 1: the blank-Member# club (real evidence for the "no
// number" case -- see the fixture's own header note on the spec's "literal
// 0" description vs. the actual captured bytes) and a real edit-marker row.
// ---------------------------------------------------------------------------

test('Take Aim Stage 1: Ashgrove, Priya -- blank Member#, found by name, 17A 5C 2D, HF 3.4228', () => {
  const result = parseStagePaste(
    TAKE_AIM_2026_08_03_STAGE1_REVIEW,
    ctx({ powerFactor: 'Minor', memberNumber: 'Z999999', storedNames: ['Ashgrove, Priya'] }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.accepted.hits, {
    alphas: 17, charlies: 5, deltas: 2, misses: 0, noShoots: 0, procedurals: 0,
  });
  assert.equal(result.accepted.derived.stagePoints, 102);
  assert.equal(result.accepted.derived.hitFactor, 3.4228);
  assert.equal(result.accepted.printedHitFactor, 3.4228);
});

test('Take Aim Stage 1: Whitcombe, Jon -- a real [1] edit marker, still accepted and derived exactly', () => {
  const result = parseStagePaste(
    TAKE_AIM_2026_08_03_STAGE1_REVIEW,
    ctx({ powerFactor: 'Minor', storedNames: ['Whitcombe, Jon'] }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.accepted.row.edited, true);
  assert.equal(result.accepted.row.timeOfDay, '08-03 19:15');
  assert.deepEqual(result.accepted.hits, {
    alphas: 9, charlies: 8, deltas: 3, misses: 4, noShoots: 0, procedurals: 0,
  });
  assert.equal(result.accepted.derived.hitFactor, 1.5414);
  assert.equal(result.accepted.printedHitFactor, 1.5414);
});

// ---------------------------------------------------------------------------
// Mixed-case member numbers, real shapes (a200104 on the page, checked
// case-insensitively against a differently-cased stored number).
// ---------------------------------------------------------------------------

test('Gun Craft Stage 1: a real mixed-case member number (a200104) matches its uppercase stored form', () => {
  const result = parseStagePaste(
    GUNCRAFT_2026_08_02_STAGE1_REVIEW,
    ctx({ powerFactor: 'Minor', memberNumber: 'A200104', storedNames: [] }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // The fixture's raw name carries a real non-breaking space (U+00A0) --
  // exactly what the source page renders (see the fixture's own header) --
  // so the exact-string check below matches on that, not a regular space.
  assert.equal(result.accepted.row.name, 'Bishop, Owen');
  assert.equal(result.accepted.row.memberNumber, 'a200104');
});

// ---------------------------------------------------------------------------
// Wrong-surface detection against REAL Combined and overall pages, both
// directions, including the real DQ'd-shooter case each page evidences.
// ---------------------------------------------------------------------------

test('the real Gun Craft Stage 1 Combined page is detected and routed, not parsed as Review', () => {
  const result = parseStagePaste(
    GUNCRAFT_2026_08_02_STAGE1_COMBINED,
    ctx({ storedNames: ['Ashgrove, Priya'] }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'wrong-surface-combined');
});

test('the real Gun Craft Combined page shows a DQd shooter -- dq-absent, not a generic refusal', () => {
  // Three real DQ rows on this page (spec section 3a): Delgado, Marco;
  // Kwan, Owenn; Reyes, Isabela -- all absent from both Review pages.
  // storedNames matching is NBSP-agnostic (normaliseName collapses both
  // to the same form), but the RETURNED name is the raw fixture text,
  // which carries a real non-breaking space (\u00a0) after the comma --
  // see the fixture's own header. searchName drives the match; rawName
  // is what the exact-string assertion below checks.
  const dqNames: [searchName: string, rawName: string][] = [
    ['Delgado, Marco', 'Delgado,\u00a0Marco'],
    ['Kwan, Owenn', 'Kwan,\u00a0Owenn'],
    ['Reyes, Isabela', 'Reyes,\u00a0Isabela'],
  ];
  for (const [searchName, rawName] of dqNames) {
    const result = parseStagePaste(GUNCRAFT_2026_08_02_STAGE1_COMBINED, ctx({ storedNames: [searchName] }));
    assert.equal(result.ok, false, searchName);
    if (result.ok) continue;
    assert.equal(result.code, 'dq-absent', searchName);
    if (result.code !== 'dq-absent') continue;
    assert.equal(result.name, rawName, searchName);
  }
});

test('the real overall match-results page (a different real capture) is detected and routed, not parsed as Review', () => {
  // GUN_CRAFT_2026_08_02 is the SHIPPED PractiScore importer's own real
  // fixture (an overall Combined/results page) -- reused here rather than
  // re-captured, to prove the two importers agree on what an overall page
  // looks like.
  const result = parseStagePaste(GUN_CRAFT_2026_08_02, ctx({ storedNames: ['Alder, Robin'] }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'wrong-surface-overall');
});

test('the real overall page shows its own DQd shooters -- dq-absent there too', () => {
  const result = parseStagePaste(GUN_CRAFT_2026_08_02, ctx({ storedNames: ['Kirkland, Bay'] }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'dq-absent');
  if (result.code !== 'dq-absent') return;
  assert.equal(result.name, 'Kirkland, Bay');
});
