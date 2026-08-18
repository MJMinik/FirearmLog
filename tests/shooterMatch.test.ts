// The rule that decides which rows in an imported field are the shooter's own.
// Every awkward case below is a REAL row from a real match — Michael's Gun Craft
// results of 2 August 2026 — because a rule written against tidy names would
// have missed four of the seventy-eight on the first page he tried.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseName, normaliseMemberNumber, normaliseStoredNames, findOwnRows, isOwnName,
  memberNumberVerdict, shouldRememberScsaNumber,
} from '../src/lib/shooterMatch.ts';

const row = (name: string, memberNumber = '') => ({ name, memberNumber });

test('the two conventions for writing a name are the same name', () => {
  assert.equal(normaliseName('Minik, Michael'), normaliseName('Michael Minik'));
  assert.equal(normaliseName('  minik ,  MICHAEL '), normaliseName('Michael Minik'));
});

test('a nickname in quotes is not part of the name — both quote styles', () => {
  assert.equal(normaliseName('Santiago, Yaritsa “PewPew”'), normaliseName('Yaritsa Santiago'));
  assert.equal(normaliseName('Crosby, Kelly "KC"'), normaliseName('Kelly Crosby'));
});

test('a nickname in parentheses is not part of the name', () => {
  assert.equal(normaliseName('Araniego, Segismond (Joey)'), normaliseName('Segismond Araniego'));
  assert.equal(normaliseName('Perla, Livio (Lee)'), normaliseName('Livio Perla'));
});

test('a results page that shouts or whispers a name still means the same person', () => {
  assert.equal(normaliseName('PIMENTEL, JUAN'), normaliseName('Juan Pimentel'));
  assert.equal(normaliseName('coon, elliott'), normaliseName('Elliott Coon'));
});

test('a disqualification marker describes the run, not the person', () => {
  assert.equal(normaliseName('(DQ) Poulin, Jon'), normaliseName('Jon Poulin'));
});

test('two-word surnames survive', () => {
  assert.equal(normaliseName('Aviles Flores, Pedro'), normaliseName('Pedro Aviles Flores'));
});

test('different people never collide', () => {
  assert.notEqual(normaliseName('Lima, Breno'), normaliseName('Lima, Ana'));
  assert.notEqual(normaliseName('Blosser, David'), normaliseName('Blosser, Ann'));
  assert.notEqual(normaliseName('Goodwald, David'), normaliseName('Goodwald, Daniel'));
});

test('an empty or punctuation-only name normalises to nothing and can never match', () => {
  assert.equal(normaliseName(''), '');
  assert.equal(normaliseName('  ,, '), '');
  assert.deepEqual(findOwnRows([row(''), row(' , ')], ['']), []);
  assert.deepEqual(findOwnRows([row(''), row(' , ')], ['Michael Minik']), []);
});

test('no stored names means no suggestions, and the field is left exactly as it is', () => {
  assert.deepEqual(findOwnRows([row('Minik, Michael'), row('Lima, Breno')], []), []);
  assert.deepEqual(findOwnRows([row('Minik, Michael')], ['   ']), []);
});

test('finds the shooter wherever they finished', () => {
  const field = [row('Lima, Breno'), row('Alvarado, Roberto'), row('Minik, Michael', 'A185321')];
  const m = findOwnRows(field, ['Michael Minik']);
  assert.equal(m.length, 1);
  assert.equal(m[0].index, 2);
  assert.equal(m[0].matchedName, 'Michael Minik');
});

test('the household case: two names, two suggestions, in field order', () => {
  // Michael's own reason for the feature: "sometimes husband and wife or father
  // and child may both attend a match and they have to be able to choose".
  const field = [row('Blosser, Ann'), row('Lima, Breno'), row('Blosser, David')];
  const m = findOwnRows(field, ['David Blosser', 'Blosser, Ann']);
  assert.deepEqual(m.map((x) => x.index), [0, 2]);
  assert.deepEqual(m.map((x) => x.matchedName), ['Blosser, Ann', 'David Blosser']);
});

test('the same person stored twice in two spellings suggests their row once', () => {
  const m = findOwnRows([row('Minik, Michael')], ['Minik, Michael', 'Michael Minik', ' MICHAEL  MINIK ']);
  assert.equal(m.length, 1);
});

test('a stored name matching nobody in the field changes nothing', () => {
  assert.deepEqual(findOwnRows([row('Lima, Breno'), row('Nunez, Jeff')], ['Michael Minik']), []);
});

test('matching is EXACT on the normalised form — a near miss is not a match', () => {
  // A fuzzy rule would lift a stranger to the top of the list, which makes the
  // wrong tap MORE likely and is the opposite of what the feature is for.
  assert.deepEqual(findOwnRows([row('Minik, Michele')], ['Michael Minik']), []);
  assert.deepEqual(findOwnRows([row('Minik, M')], ['Michael Minik']), []);
  assert.deepEqual(findOwnRows([row('Minikk, Michael')], ['Michael Minik']), []);
});

test('a duplicated name in the field suggests both rows rather than guessing', () => {
  const m = findOwnRows([row('Smith, Michael', 'A1'), row('Smith, Michael', 'A2')], ['Michael Smith']);
  assert.equal(m.length, 2);
});

test('member numbers normalise for reading, whatever the punctuation and case', () => {
  assert.equal(normaliseMemberNumber('a185231'), 'A185231');
  assert.equal(normaliseMemberNumber('A-185 231'), 'A185231');
  assert.equal(normaliseMemberNumber(''), '');
});

// --- Everything below was added after a cold audit found the first version
// --- lifting the wrong person to the top of the field. Each one is a defect it
// --- found, written as the test that would have stopped it.

test('SURNAME ORDER IS MEANING — two different people never collide by swapping words', () => {
  // The first version sorted the words to make "Minik, Michael" equal
  // "Michael Minik". That also made these equal, and put a stranger under
  // "This looks like you" on a screen whose whole purpose is the opposite.
  assert.notEqual(normaliseName('Martin, Lee'), normaliseName('Lee, Martin'));
  assert.notEqual(normaliseName('Aviles Flores, Pedro'), normaliseName('Flores Aviles, Pedro'));
  assert.notEqual(normaliseName('Garcia Lopez, Ana'), normaliseName('Lopez Garcia, Ana'));
  assert.deepEqual(findOwnRows([row('Lee, Martin')], ['Martin, Lee']), []);
});

test('the comma is what tells the two conventions apart, and it still works', () => {
  assert.equal(normaliseName('Aviles Flores, Pedro'), normaliseName('Pedro Aviles Flores'));
  assert.equal(normaliseName('Minik, Michael'), normaliseName('Michael Minik'));
});

test("an apostrophe belongs to the surname, not to a nickname", () => {
  // Treating a straight apostrophe as an opening quote shredded O'Brien to
  // nothing, so the shooter was silently never found.
  assert.equal(normaliseName("O'Brien, Sean"), normaliseName("Sean O'Brien"));
  assert.equal(normaliseName("O'Brien, Sean"), normaliseName('Sean OBrien'));
  assert.equal(normaliseName('O\u2019Brien, Sean'), normaliseName("Sean O'Brien"));
  assert.equal(normaliseName("O'Brien, D'Angelo"), normaliseName("D'Angelo O'Brien"));
  // ...and a real nickname beside a real apostrophe still comes off.
  assert.equal(normaliseName('O\'Brien, Sean "Ace"'), normaliseName("Sean O'Brien"));
  assert.notEqual(normaliseName('O\'Brien, Sean "Ace"'), normaliseName('O\'Malley, Kevin "Ace"'));
});

test('accents fold, because a page and a keyboard rarely agree about them', () => {
  assert.equal(normaliseName('Pe\u00f1a, Jos\u00e9'), normaliseName('Jose Pena'));
  assert.equal(normaliseName('Senra, Felipe'), normaliseName('Felipe Senra'));
});

test('a name that merely BEGINS with dq is not a disqualification', () => {
  // The old rule stripped a bare leading "dq", so this shooter could never be
  // matched under any spelling.
  assert.equal(normaliseName('Dquan Smith'), 'dquan smith');
  assert.equal(normaliseName('DQuinn, Alex'), normaliseName('Alex DQuinn'));
  // The parenthesised marker still comes off, which is all that was ever needed.
  assert.equal(normaliseName('(DQ) Poulin, Jon'), normaliseName('Jon Poulin'));
});

test('a stored list that is not a list of names cannot take a screen down', () => {
  // Settings arrive from IndexedDB and from any .flog a shooter loads, and the
  // restore path never checks the shape of a value. A string here threw
  // "names.map is not a function" and replaced Settings with the error screen —
  // which hid the Clear-all-data button that would have fixed it.
  assert.deepEqual(normaliseStoredNames('Minik, Michael'), []);
  assert.deepEqual(normaliseStoredNames(undefined), []);
  assert.deepEqual(normaliseStoredNames(null), []);
  assert.deepEqual(normaliseStoredNames(42), []);
  assert.deepEqual(normaliseStoredNames({ 0: 'a' }), []);
  assert.deepEqual(normaliseStoredNames([42, 'Minik, Michael', null, '  ', 'Ann Blosser']),
    ['Minik, Michael', 'Ann Blosser']);
});

test('findOwnRows survives a competitor whose name is not a string', () => {
  const rough = [{ name: undefined as unknown as string, memberNumber: '' }, row('Minik, Michael')];
  const m = findOwnRows(rough, ['Michael Minik']);
  assert.deepEqual(m.map((x) => x.index), [1]);
});

// --- isOwnName: the Steel Challenge screen's single-name version of
// --- findOwnRows, added after the screen's own inline `.toLowerCase()`
// --- compare missed Michael's Hansen file of 12 Aug 2026 (fixed 18 Aug 2026).

test('isOwnName: the Hansen case — first/last fields written separately still match "Last, First" stored in Settings', () => {
  // Michael's Hansen Steel Challenge file of 12 Aug 2026 wrote his name across
  // separate first/last fields as "Michael Minik"; Settings held "Minik,
  // Michael". The Steel screen's own inline compare missed it — this is the
  // fix, and the shape it was written against.
  assert.equal(isOwnName('Michael Minik', ['Minik, Michael']), true);
  assert.equal(isOwnName('Michael Minik', ['MINIK, MICHAEL']), true);
  assert.equal(isOwnName('Michael Minik', ['Michael Minik']), true);
});

test('isOwnName: other shapes really present in the Hansen file', () => {
  // A trailing-space first-name field wrote "Elizabeth  Gross" with a double
  // space; the file also carried an accented "Alexandria Morón" against a
  // Settings entry typed without the accent.
  assert.equal(isOwnName('Elizabeth  Gross', ['Gross, Elizabeth']), true);
  assert.equal(isOwnName('Alexandria Morón', ['Moron, Alexandria']), true);
});

test('isOwnName: surname order carries meaning — "Martin, Lee" never matches "Martin Lee"', () => {
  // Lee is the family name here; a person whose FIRST name is Martin and last
  // name Lee is a different person entirely. The comma is what tells the two
  // conventions apart, and it must keep telling them apart here too.
  assert.equal(isOwnName('Martin Lee', ['Martin, Lee']), false);
});

test('isOwnName: first name still has to match — same surname is not the same person', () => {
  // The household case, pointed at isOwnName itself: findOwnRows is tested
  // against it, and a surname-only compare would pass every test above while
  // suggesting Ann's row to David. Found by the tests-constrain audit.
  assert.equal(isOwnName('Ann Blosser', ['Blosser, David']), false);
  assert.equal(isOwnName('David Blosser', ['Blosser, Ann']), false);
});

test('isOwnName: empties never match', () => {
  assert.equal(isOwnName('', ['Minik, Michael']), false);
  assert.equal(isOwnName('Michael Minik', []), false);
  assert.equal(isOwnName('Michael Minik', ['  ,, ']), false);
});

// --- memberNumberVerdict: MEMBER_NUMBER_SPEC.md §6 — the number is a
// --- CONFIRMATION beside a name match, never a key. null means no verdict is
// --- possible (nothing to say), not "no match".

test('memberNumberVerdict: an exact match reads as a match', () => {
  assert.equal(memberNumberVerdict('A185231', 'A185231'), 'match');
});

test('memberNumberVerdict: case, spaces and hyphens are not identity', () => {
  assert.equal(memberNumberVerdict('a 185-231', 'A185231'), 'match');
});

test('memberNumberVerdict: a renewed prefix still reads as a match — the digits are the person', () => {
  // USPSA prefixes change with membership type as a member renews (A -> TY ->
  // L); the digits stay theirs. Without this a renewed shooter would see
  // "Member # differs" on every import forever, on a number that is genuinely
  // theirs.
  assert.equal(memberNumberVerdict('TY185231', 'A185231'), 'match');
});

test('memberNumberVerdict: the real transposition pair still differs', () => {
  // Michael's own Gun Craft registration, the case that started this build:
  // the club typed A185321 where A185231 is correct.
  assert.equal(memberNumberVerdict('A185321', 'A185231'), 'differs');
});

test('memberNumberVerdict: a blank side means no verdict, not "no match"', () => {
  assert.equal(memberNumberVerdict('', 'A185231'), null);
  assert.equal(memberNumberVerdict('A185231', ''), null);
  assert.equal(memberNumberVerdict(undefined, undefined), null);
  assert.equal(memberNumberVerdict('', ''), null);
});

test('memberNumberVerdict: punctuation-only normalises to nothing, same as blank', () => {
  assert.equal(memberNumberVerdict('--', 'A185231'), null);
  assert.equal(memberNumberVerdict('A185231', '  ,, '), null);
});

test('memberNumberVerdict: digits alone still match a prefixed number', () => {
  assert.equal(memberNumberVerdict('185231', 'A185231'), 'match');
});

// --- shouldRememberScsaNumber: the fill-only-when-empty contract (Decision 4,
// --- extended by MEMBER_NUMBER_SPEC.md §3) — an import may fill a blank field
// --- and must never overwrite one the shooter can see.

test('shouldRememberScsaNumber: fills a genuinely empty field', () => {
  assert.equal(shouldRememberScsaNumber('', 'A185231'), true);
  assert.equal(shouldRememberScsaNumber(undefined, 'A185231'), true);
});

test('shouldRememberScsaNumber: never overwrites a value already there', () => {
  assert.equal(shouldRememberScsaNumber('A185231', 'A999999'), false);
});

test('shouldRememberScsaNumber: a blank incoming value never fills anything', () => {
  assert.equal(shouldRememberScsaNumber('', ''), false);
  assert.equal(shouldRememberScsaNumber('', undefined), false);
});

test('shouldRememberScsaNumber: whitespace counts as blank on either side', () => {
  assert.equal(shouldRememberScsaNumber('   ', 'A185231'), true);
  assert.equal(shouldRememberScsaNumber('A185231', '   '), false);
});
