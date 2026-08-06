/* A picker must be able to show what the record holds (session 106, 6 Aug 2026).
 *
 * The defect these guard: a <select> whose value matches no <option> renders the FIRST
 * option, so a match stored as "O" displayed as "Carry Optics" while the record kept
 * "O", and Save wrote "O" back. Eighteen existing checks missed it because every one of
 * them changed the value AWAY and none changed it back -- so the round-trip cases below
 * are the point, not the coverage. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  optionsWithStored, suggestDivision, divisionMismatchKind, DIVISION_CODE_ALIASES,
  DIVISIONS, IDPA_DIVISIONS, STEEL_DIVISIONS,
} from '../src/lib/competition.ts';

/* ---------------------------------------------------------------- optionsWithStored */

test('a stored value already in the list leaves the list untouched', () => {
  const out = optionsWithStored(DIVISIONS, 'Open');
  assert.deepEqual(out, DIVISIONS.slice());
  assert.equal(out.length, DIVISIONS.length);
});

test('a stored value the list cannot represent is injected, exactly once, at the front', () => {
  const out = optionsWithStored(DIVISIONS, 'O');
  assert.equal(out.length, DIVISIONS.length + 1);
  assert.equal(out[0], 'O');
  assert.equal(out.filter((d) => d === 'O').length, 1);
});

test('the injected value is the SAVED STRING, undecorated, so it round-trips byte for byte', () => {
  // If this ever returns a label like 'O (not a recognised division)', the screen will
  // write that label back into the record on save. That is the original defect wearing
  // a different hat, which is why the label belongs in the view and not here.
  // Uses a PADDED value on purpose. The first version of this test used 'O', where the
  // trimmed and untrimmed forms are identical -- so it passed against an implementation
  // that injected the trimmed string, which is the one input that could tell them apart.
  // A cold audit found that; the test now uses the input that distinguishes them.
  const stored = '  Weird Division  ';
  const out = optionsWithStored(DIVISIONS, stored);
  assert.equal(out[0], stored);
  assert.equal(out[0].length, stored.length);
});

test('a renamed Steel division IS injected, because the select is bound to the raw string', () => {
  // THIS TEST USED TO ASSERT THE OPPOSITE, and a cold audit caught it enshrining a bug.
  // The reasoning that produced the wrong version: 'Rimfire Pistol Open' canonicalises
  // to a member of STEEL_DIVISIONS, so it looked "recognised" and nothing was injected.
  // But the <select value> is the RAW stored string, which still matched no <option> --
  // so the picker rendered STEEL_DIVISIONS[0], 'Open', turning a rimfire match into a
  // centerfire one on screen while the callout underneath said something different.
  // That is precisely the population STEEL_DIVISION_ALIASES exists to protect.
  const out = optionsWithStored(STEEL_DIVISIONS, 'Rimfire Pistol Open');
  assert.equal(out[0], 'Rimfire Pistol Open');
  assert.equal(out.length, STEEL_DIVISIONS.length + 1);
  // And the suggestion offers the current name, so one tap fixes it.
  assert.equal(suggestDivision('Rimfire Pistol Open', STEEL_DIVISIONS), 'Rimfire Pistol Optics');
});

test('a padded value is injected and offered, rather than silently showing another division', () => {
  // Also from the cold audit. 'Open ' trimmed to a member, so nothing was injected and
  // nothing was suggested -- the select fell through to 'Carry Optics' with the screen
  // saying nothing at all. Both halves are asserted because fixing one without the other
  // leaves the user looking at a wrong division with no way to correct it.
  const out = optionsWithStored(DIVISIONS, 'Open ');
  assert.equal(out[0], 'Open ');
  assert.equal(suggestDivision('Open ', DIVISIONS), 'Open');
});

test('a blank or whitespace division IS injected, because it is a real stored state', () => {
  // THIS TEST ASSERTED THE OPPOSITE and was wrong, which a cold audit caught by measuring
  // the screen rather than reading the function: with nothing injected, a record holding
  // '' rendered as 'Carry Optics', because a <select> with an unmatched value falls
  // through to the first option. The old comment claimed 'no division chosen' was
  // representable as an empty select. There is no empty option, so it was not.
  assert.equal(optionsWithStored(DIVISIONS, '')[0], '');
  assert.equal(optionsWithStored(DIVISIONS, '   ')[0], '   ');
  // Only a genuinely absent value is left alone: there is nothing to represent.
  assert.deepEqual(optionsWithStored(DIVISIONS, undefined as unknown as string), DIVISIONS.slice());
});

test('optionsWithStored does not mutate the list it was given', () => {
  const source = DIVISIONS.slice();
  optionsWithStored(source, 'O');
  assert.deepEqual(source, DIVISIONS.slice());
});

/* ------------------------------------------------------------------ suggestDivision */

test('a known USPSA short code suggests its division', () => {
  assert.equal(suggestDivision('O', DIVISIONS), 'Open');
  assert.equal(suggestDivision('CO', DIVISIONS), 'Carry Optics');
  assert.equal(suggestDivision('LO', DIVISIONS), 'Limited Optics');
  assert.equal(suggestDivision('SS', DIVISIONS), 'Single Stack');
  assert.equal(suggestDivision('REV', DIVISIONS), 'Revolver');
});

test('short codes are matched case-insensitively', () => {
  assert.equal(suggestDivision('o', DIVISIONS), 'Open');
  assert.equal(suggestDivision('co', DIVISIONS), 'Carry Optics');
});

test('surrounding whitespace does not defeat a suggestion', () => {
  assert.equal(suggestDivision('  O  ', DIVISIONS), 'Open');
});

test('an IDPA code is derived from the option list, with no table entry for it', () => {
  // The point of this test: DIVISION_CODE_ALIASES contains NO IDPA codes, and must not
  // need to. If someone "helpfully" adds them, this still passes -- but the assertion
  // below that the table stays USPSA-only is what stops the table growing a keeper.
  assert.equal(suggestDivision('SSP', IDPA_DIVISIONS), 'Stock Service Pistol (SSP)');
  assert.equal(suggestDivision('ESP', IDPA_DIVISIONS), 'Enhanced Service Pistol (ESP)');
  assert.equal(suggestDivision('BUG', IDPA_DIVISIONS), 'Backup Gun (BUG)');
  for (const code of Object.keys(DIVISION_CODE_ALIASES)) {
    assert.ok(!['SSP', 'ESP', 'CDP', 'CCP', 'BUG'].includes(code),
      `${code} is an IDPA code and does not belong in the USPSA table`);
  }
});

test('a suggestion is NEVER offered from another sport', () => {
  // 'O' means Open in USPSA. Asked against the IDPA list, where Open does not exist,
  // it must return null rather than reaching into DIVISIONS.
  assert.equal(suggestDivision('O', IDPA_DIVISIONS), null);
  // 'REV' means Revolver in USPSA. Steel Challenge splits revolvers into Optical Sight
  // and Iron Sight and has no bare 'Revolver', so there is no confident answer here.
  assert.equal(suggestDivision('REV', STEEL_DIVISIONS), null);
});

test('a code IS offered across sports when both sports genuinely have that division', () => {
  // Written after this test file's own first run got it wrong, and kept because the
  // wrong version is the more obvious one to write. Steel Challenge really does have
  // Single Stack, Open, Limited and Carry Optics divisions -- see STEEL_DIVISIONS --
  // so suggesting them there is correct, not a leak from the USPSA list. The rule the
  // code actually implements is "only ever suggest something in the list you were
  // given", which is narrower and more useful than "never suggest across sports".
  assert.ok(STEEL_DIVISIONS.includes('Single Stack'));
  assert.equal(suggestDivision('SS', STEEL_DIVISIONS), 'Single Stack');
  assert.equal(suggestDivision('O', STEEL_DIVISIONS), 'Open');
});

test('an ambiguous code is deliberately NOT guessed', () => {
  // 'L' could be Limited or a truncated Limited Optics; 'R' could be Revolver or
  // Rimfire. A wrong suggestion is worse than none, because the user is being asked
  // to accept it.
  assert.equal(suggestDivision('L', DIVISIONS), null);
  assert.equal(suggestDivision('R', DIVISIONS), null);
  assert.equal(suggestDivision('X', DIVISIONS), null);
  assert.equal(suggestDivision('', DIVISIONS), null);
});

test('a value that is already exactly an option suggests nothing', () => {
  // There is nothing to offer; the picker can show it.
  assert.equal(suggestDivision('Open', DIVISIONS), null);
  assert.equal(suggestDivision('Carry Optics', DIVISIONS), null);
});

test('a case-differing spelling of a real division suggests the canonical spelling', () => {
  assert.equal(suggestDivision('open', DIVISIONS), 'Open');
  assert.equal(suggestDivision('CARRY OPTICS', DIVISIONS), 'Carry Optics');
});

test('a renamed Steel division suggests its current name', () => {
  assert.equal(suggestDivision('Rimfire Pistol Open', STEEL_DIVISIONS), 'Rimfire Pistol Optics');
});

/* ------------------------------------------------- the two helpers, used together */

test('ROUND TRIP: an unrecognised division survives load and save unchanged', () => {
  // This is the exact path the pre-fix build failed. The list can show it, and nothing
  // in the pipeline rewrites it, so what goes in comes out.
  const stored = 'O';
  const opts = optionsWithStored(DIVISIONS, stored);
  const selected = opts.includes(stored) ? stored : opts[0];
  assert.equal(selected, 'O', 'the picker must resolve to the stored value, not DIVISIONS[0]');
  assert.notEqual(selected, DIVISIONS[0]);
});

test('ROUND TRIP: accepting the suggestion replaces the injected entry entirely', () => {
  const accepted = suggestDivision('O', DIVISIONS);
  assert.equal(accepted, 'Open');
  const after = optionsWithStored(DIVISIONS, accepted as string);
  assert.deepEqual(after, DIVISIONS.slice(), 'the unrecognised entry must be gone once a real division is chosen');
  assert.ok(!after.includes('O'));
});

test('every alias in the table maps to a division that actually exists', () => {
  // Stops the table drifting away from DIVISIONS. A mapping to a division that is not
  // in the list would silently never be offered, which is a defect that looks like a
  // working feature.
  for (const [code, division] of Object.entries(DIVISION_CODE_ALIASES)) {
    assert.ok(DIVISIONS.includes(division), `${code} maps to "${division}", which is not a USPSA division`);
    assert.equal(code, code.toUpperCase(), `${code} must be upper case; lookup upper-cases the input`);
  }
});

/* -------------------------------------------------- round 3 of the cold audit */

test('a blank division gets an option of its own rather than falling through', () => {
  // The audit measured a record holding '' rendering as 'Carry Optics' with no callout.
  // The importer writes '' when the results table has no division column, so this is a
  // shipped state and not a hypothetical.
  const out = optionsWithStored(DIVISIONS, '');
  assert.equal(out[0], '');
  assert.equal(out.length, DIVISIONS.length + 1);
});

test('the mismatch kind names the real difference, which is what the sentence turns on', () => {
  // The callout used to read "saved as Open, which is not one of the divisions in the
  // list, it probably means Open" whenever the difference was whitespace: HTML collapses
  // the space, so the two read identically and the sentence was nonsense on screen.
  assert.equal(divisionMismatchKind('Open ', 'Open'), 'spacing');
  assert.equal(divisionMismatchKind('  Open', 'Open'), 'spacing');
  assert.equal(divisionMismatchKind('open', 'Open'), 'spelling');
  assert.equal(divisionMismatchKind('CARRY OPTICS', 'Carry Optics'), 'spelling');
  assert.equal(divisionMismatchKind('O', 'Open'), 'unlisted');
  assert.equal(divisionMismatchKind('Rimfire Pistol Open', 'Rimfire Pistol Optics'), 'unlisted');
});

test('a spacing difference is not reported as a spelling one, or the sentence lies twice', () => {
  // ' open ' differs by BOTH. Spacing is checked first only when trimming alone resolves
  // it; here it does not, so the honest answer is spelling.
  assert.equal(divisionMismatchKind(' open ', 'Open'), 'spelling');
});
