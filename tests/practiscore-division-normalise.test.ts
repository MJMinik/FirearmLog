// Unit tests for the PractiScore division normalisation feature (spec §5.1,
// branch import-division-normalise, session 108, 7 Aug 2026).
//
// Three areas covered:
//   §5.1.1 -- suggestDivision empty-string case (already covered in
//             divisionPicker.test.ts; added here for round-trip completeness).
//   §5.1.2 -- countInDivision canonicalises both sides.
//   §5.1.3 -- divisionActuallyChanged truth table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestDivision, DIVISIONS } from '../src/lib/competition.ts';
import { countInDivision, type PsCompetitor } from '../src/lib/practiscore.ts';
import { divisionActuallyChanged } from '../src/lib/divisionNormalise.ts';

// ---------------------------------------------------------------------------
// §5.1.1 — suggestDivision: the empty-string case
// ---------------------------------------------------------------------------

test('suggestDivision: empty string returns null', () => {
  assert.equal(suggestDivision('', DIVISIONS), null);
});

test('suggestDivision: whitespace-only string returns null', () => {
  assert.equal(suggestDivision('   ', DIVISIONS), null);
});

// ---------------------------------------------------------------------------
// §5.1.2 — countInDivision: canonicalises both sides
// ---------------------------------------------------------------------------

function makeCompetitors(divisions: string[]): PsCompetitor[] {
  return divisions.map((div, i) => ({
    overallPlace: i + 1,
    divisionPlace: 1,
    name: `Shooter ${i + 1}`,
    memberNumber: '',
    division: div,
    classLetter: '',
    powerFactor: 'Min',
    matchPoints: null,
    matchPercent: null,
    stages: [],
  }));
}

test('countInDivision: an all-"CO" list counts under "Carry Optics" (code -> name direction)', () => {
  const competitors = makeCompetitors(['CO', 'CO', 'CO', 'LO', 'LO']);
  assert.equal(countInDivision(competitors, 'Carry Optics'), 3);
});

test('countInDivision: an all-"CO" list also counts under "CO" (code -> code direction)', () => {
  const competitors = makeCompetitors(['CO', 'CO', 'CO', 'LO', 'LO']);
  assert.equal(countInDivision(competitors, 'CO'), 3);
});

test('countInDivision: an all-"Carry Optics" list counts under "CO" (name -> code direction)', () => {
  const competitors = makeCompetitors(['Carry Optics', 'Carry Optics', 'Limited', 'Open']);
  assert.equal(countInDivision(competitors, 'CO'), 2);
});

test('countInDivision: an all-"Carry Optics" list counts under "Carry Optics" (name -> name direction)', () => {
  const competitors = makeCompetitors(['Carry Optics', 'Carry Optics', 'Limited', 'Open']);
  assert.equal(countInDivision(competitors, 'Carry Optics'), 2);
});

test('countInDivision: mixed codes and names in one list count as the same division', () => {
  // A hypothetical mixed file: canonicalisation handles it.
  const competitors = makeCompetitors(['CO', 'Carry Optics', 'CO', 'Open']);
  assert.equal(countInDivision(competitors, 'Carry Optics'), 3);
  assert.equal(countInDivision(competitors, 'CO'), 3);
});

test('countInDivision: other known codes canonicalise correctly', () => {
  const competitors = makeCompetitors(['O', 'LO', 'LTD', 'O', 'PROD']);
  assert.equal(countInDivision(competitors, 'Open'), 2);
  assert.equal(countInDivision(competitors, 'Limited Optics'), 1);
  assert.equal(countInDivision(competitors, 'Limited'), 1);
  assert.equal(countInDivision(competitors, 'Production'), 1);
});

test('countInDivision: an empty division stays separate from every named division', () => {
  const competitors = makeCompetitors(['', 'CO', 'CO']);
  assert.equal(countInDivision(competitors, ''), 1);
  assert.equal(countInDivision(competitors, 'Carry Optics'), 2);
});

// ---------------------------------------------------------------------------
// §5.1.3 — divisionActuallyChanged truth table (spec §3.3)
// ---------------------------------------------------------------------------

test('divisionActuallyChanged: scored="O", selected="Open" -> false (canonical match)', () => {
  assert.equal(divisionActuallyChanged('O', 'Open', DIVISIONS), false);
});

test('divisionActuallyChanged: scored="O", selected="O" -> false (exact match)', () => {
  assert.equal(divisionActuallyChanged('O', 'O', DIVISIONS), false);
});

test('divisionActuallyChanged: scored="O", selected="Limited" -> true (genuine change)', () => {
  assert.equal(divisionActuallyChanged('O', 'Limited', DIVISIONS), true);
});

test('divisionActuallyChanged: scored="CO", selected="Carry Optics" -> false (canonical match)', () => {
  assert.equal(divisionActuallyChanged('CO', 'Carry Optics', DIVISIONS), false);
});

test('divisionActuallyChanged: scored="Carry Optics", selected="Carry Optics" -> false (exact)', () => {
  assert.equal(divisionActuallyChanged('Carry Optics', 'Carry Optics', DIVISIONS), false);
});

test('divisionActuallyChanged: scored="LO", selected="Limited Optics" -> false (canonical match)', () => {
  assert.equal(divisionActuallyChanged('LO', 'Limited Optics', DIVISIONS), false);
});

test('divisionActuallyChanged: scored="LO", selected="Open" -> true (genuine change)', () => {
  assert.equal(divisionActuallyChanged('LO', 'Open', DIVISIONS), true);
});

test('divisionActuallyChanged: scored="", selected="" -> false (both empty)', () => {
  assert.equal(divisionActuallyChanged('', '', DIVISIONS), false);
});

test('divisionActuallyChanged: scored="", selected="Open" -> true (was no division, now has one)', () => {
  assert.equal(divisionActuallyChanged('', 'Open', DIVISIONS), true);
});
