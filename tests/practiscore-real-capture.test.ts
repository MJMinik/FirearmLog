// A real PractiScore results page, driven through the parser end to end.
//
// tests/practiscore.test.ts covers the parser's rules one at a time with small,
// purpose-built inputs. This file does the other job: it takes one whole
// results page exactly as a shooter obtains it and asserts what comes out. The
// two are not redundant — a rule can pass in isolation and still lose to a page
// that trips three of them at once, which is what happened on 5 August 2026
// when a real paste came back "no competitor rows" from a parser whose unit
// tests were all green.
//
// The capture is anonymised; see the fixture's own header for what was replaced
// and why. Every figure that the parser actually reads is the real posted one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePractiScore, countInDivision } from '../src/lib/practiscore.ts';
import { GUN_CRAFT_2026_08_02 } from './fixtures/practiscore-guncraft-2026-08-02.ts';

const m = parsePractiScore(GUN_CRAFT_2026_08_02);

test('reads every competitor on the page, and none extra', () => {
  assert.equal(m.competitors.length, 78);
});

test('takes the match name and date off the title line above the table', () => {
  assert.equal(m.name, 'Gun Craft Practical Shooters 1st Sunday August');
  assert.equal(m.date, '2026-08-02');
});

test('names every competitor — a nameless row means the wrong separator won', () => {
  assert.equal(m.competitors.filter((c) => c.name === '').length, 0);
});

test('the single-cell "Match Results - Combined" heading never becomes a shooter', () => {
  assert.equal(m.competitors.some((c) => /Match Results/i.test(c.name)), false);
});

test('a Category cell full of commas does not shred its row', () => {
  // Row 8's category reads "Lady, Super Senior, Law Enforcement, Distinguished
  // Senior". Under a comma reading those four fragments become four cells and
  // every column to their right shifts, so the row's own division and score are
  // the honest thing to assert.
  const c = m.competitors.find((x) => x.overallPlace === 8);
  assert.ok(c, 'row 8 is missing');
  assert.equal(c.division, 'L');
  assert.equal(c.powerFactor, 'Maj');
  assert.equal(c.matchPoints, 651.4238);
  assert.equal(c.matchPercent, 78.4264);
});

test('reads a mid-field row exactly, field for field', () => {
  const c = m.competitors.find((x) => x.overallPlace === 68);
  assert.ok(c, 'row 68 is missing');
  assert.equal(c.division, 'O');
  assert.equal(c.classLetter, 'U');
  assert.equal(c.powerFactor, 'Min');
  assert.equal(c.matchPoints, 181.5609);
  assert.equal(c.matchPercent, 21.8585);
  // The combined page carries no division-place column, so this must stay null
  // rather than being inferred. A guessed placing is worse than a blank one.
  assert.equal(c.divisionPlace, null);
});

test('keeps the disqualified rows and leaves their empty scores empty', () => {
  const dqs = m.competitors.filter((c) => c.name.startsWith('(DQ)'));
  assert.equal(dqs.length, 3);
  for (const d of dqs) {
    assert.equal(d.matchPoints, null);
    assert.equal(d.matchPercent, null);
  }
});

test('keeps rows with no member number and no class instead of dropping them', () => {
  const c = m.competitors.find((x) => x.overallPlace === 5);
  assert.ok(c, 'row 5 is missing');
  assert.equal(c.memberNumber, '');
  assert.equal(c.classLetter, '');
  assert.equal(c.division, 'CO');
  assert.notEqual(c.name, '');
});

test('the division mix matches what PractiScore posted', () => {
  const byDiv: Record<string, number> = {};
  for (const c of m.competitors) byDiv[c.division] = (byDiv[c.division] || 0) + 1;
  assert.deepEqual(byDiv, { O: 16, LO: 33, CO: 19, L: 2, PCC: 7, SS: 1 });
});

test('countInDivision agrees with the page for the divisions a shooter would see', () => {
  assert.equal(countInDivision(m.competitors, 'O'), 16);
  assert.equal(countInDivision(m.competitors, 'CO'), 19);
  assert.equal(countInDivision(m.competitors, 'SS'), 1);
});
