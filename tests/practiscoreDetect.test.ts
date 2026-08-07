// Unit tests for the PractiScore new-style results detector (practiscoreDetect.ts).
// Runner: node --test (same as existing practiscore.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeNewStyleResults } from '../src/lib/practiscoreDetect.ts';
import { parsePractiScore } from '../src/lib/practiscore.ts';
import { TAKE_AIM_MINI_2026_08_03_NEWSTYLE } from './fixtures/practiscore-take-aim-mini-2026-08-03_newstyle.ts';
import { TAKE_AIM_MINI_2026_08_03_OLDSTYLE } from './fixtures/practiscore-take-aim-mini-2026-08-03_oldstyle.ts';
import { TAKE_AIM_MINI_2026_08_03_TRUNCATED_OLDSTYLE } from './fixtures/practiscore-take-aim-mini-2026-08-03_truncated_oldstyle.ts';

// Precondition: confirm fixtures contain real tab characters
test('new-style fixture contains real tab characters', () => {
  assert.ok(TAKE_AIM_MINI_2026_08_03_NEWSTYLE.includes('\t'), 'expected real \\t in new-style fixture');
});

test('old-style fixture contains real tab characters', () => {
  assert.ok(TAKE_AIM_MINI_2026_08_03_OLDSTYLE.includes('\t'), 'expected real \\t in old-style fixture');
});

// Parser preconditions: new-style throws, old-style parses
test('parser throws on new-style fixture (detector only matters on refused input)', () => {
  assert.throws(
    () => parsePractiScore(TAKE_AIM_MINI_2026_08_03_NEWSTYLE),
    Error,
    'parsePractiScore must throw on new-style paste',
  );
});

test('parser succeeds on old-style fixture', () => {
  const m = parsePractiScore(TAKE_AIM_MINI_2026_08_03_OLDSTYLE);
  assert.ok(m.competitors.length > 0, 'old-style fixture must yield at least one competitor');
});

// Main detector cases
test('new-style fixture → true', () => {
  assert.equal(looksLikeNewStyleResults(TAKE_AIM_MINI_2026_08_03_NEWSTYLE), true);
});

test('old-style fixture → false', () => {
  assert.equal(looksLikeNewStyleResults(TAKE_AIM_MINI_2026_08_03_OLDSTYLE), false);
});

test('truncated old-style fixture → false', () => {
  assert.equal(looksLikeNewStyleResults(TAKE_AIM_MINI_2026_08_03_TRUNCATED_OLDSTYLE), false);
});

test('garbage prose → false', () => {
  const prose = `This is a paragraph of ordinary English text with no shooting content.
It mentions nothing about divisions or power factors.
A shooter might paste the wrong thing. Nothing here should trigger the detector.
The words limited and open appear in regular English contexts without adjacent power factors.`;
  assert.equal(looksLikeNewStyleResults(prose), false);
});

test('empty string → false', () => {
  assert.equal(looksLikeNewStyleResults(''), false);
});

test('whitespace-only string → false', () => {
  assert.equal(looksLikeNewStyleResults('   \n\t\n   '), false);
});

// Edge cases: single-signal inputs must not fire
test('only furniture signals (one family) → false', () => {
  const onlyFurniture = 'Old style results\nScore Edit History\nHorizontal Scroll';
  assert.equal(looksLikeNewStyleResults(onlyFurniture), false);
});

test('only place-hyphen lines (one family) → false', () => {
  const onlyPlaceHyphen = '1-Matt Olinchak\n2-Chris Slack\n3-Mike Buehler';
  assert.equal(looksLikeNewStyleResults(onlyPlaceHyphen), false);
});

test('only division+PF adjacency (one family) → false', () => {
  const onlyDivPF = 'Carry Optics\tMINOR\nLimited Optics\tMINOR';
  assert.equal(looksLikeNewStyleResults(onlyDivPF), false);
});

// Two-family combinations must fire
test('furniture + place-hyphen → true', () => {
  const twoSignals = 'Horizontal Scroll\n1-Matt Olinchak\n2-Chris Slack';
  assert.equal(looksLikeNewStyleResults(twoSignals), true);
});

test('division+PF adjacency + place-hyphen → true', () => {
  const twoSignals = 'Carry Optics\tMINOR\n1-Matt Olinchak';
  assert.equal(looksLikeNewStyleResults(twoSignals), true);
});

test('a parseable old-style capture with new-style chrome around it: parser accepts it AND the detector would fire — pinning that the UI must consult the detector only after a refusal', () => {
  const withChrome = 'Horizontal Scroll\nOld style results\n1-Matt Olinchak\n' + TAKE_AIM_MINI_2026_08_03_OLDSTYLE;
  assert.doesNotThrow(() => parsePractiScore(withChrome));
  assert.equal(looksLikeNewStyleResults(withChrome), true);
});

test('"reopen major" is not a division: word boundary pins Family A (audit finding 3)', () => {
  // Without the leading \b, 'reopen Major' matched the Open+MAJOR pattern, and
  // together with the place-hyphen line this text fired both families.
  const prose = 'Please reopen Major season planning.\n1-Matt Olinchak said so.';
  assert.equal(looksLikeNewStyleResults(prose), false);
});

test('a phone number is not a place: letter-after-hyphen pins Family B (audit finding 4)', () => {
  // Without requiring a letter after the hyphen, '1-800-555-0100' at line start
  // matched Family B, and with the division line this text fired both families.
  const prose = '1-800-555-0100 is the range office.\nShe shoots Carry Optics MINOR this season.';
  assert.equal(looksLikeNewStyleResults(prose), false);
});

test('line-leading ISO dates are not places (audit finding 4)', () => {
  const prose = '2026-08-04 was the make-up date.\nHe moved from Production MAJOR loads years ago.';
  assert.equal(looksLikeNewStyleResults(prose), false);
});

test('case-insensitive PF matching (minor/major in any case)', () => {
  const lower = '1-Matt Olinchak\nLimited Optics\tminor';
  assert.equal(looksLikeNewStyleResults(lower), true);
});
