import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePractiScore, countInDivision, SAMPLE_PRACTISCORE_CSV
} from '../src/lib/practiscore.ts';

test('parses the sample match metadata', () => {
  const m = parsePractiScore(SAMPLE_PRACTISCORE_CSV);
  assert.equal(m.name, 'Spring Classic USPSA Level 1');
  assert.equal(m.date, '2026-05-17');
  assert.equal(m.stageCount, 5);
  assert.equal(m.competitors.length, 5);
});

test("reads a competitor's row correctly (Chris Calder)", () => {
  const m = parsePractiScore(SAMPLE_PRACTISCORE_CSV);
  const me = m.competitors.find((c) => c.name === 'Chris Calder');
  assert.ok(me, 'found Chris Calder');
  assert.equal(me!.overallPlace, 3);
  assert.equal(me!.divisionPlace, 2);
  assert.equal(me!.division, 'Carry Optics');
  assert.equal(me!.classLetter, 'C');
  assert.equal(me!.powerFactor, 'Minor');
  assert.equal(me!.memberNumber, 'TY79901');
  assert.equal(me!.matchPercent, 84.98);
  assert.equal(me!.matchPoints, 612.34);
  assert.equal(me!.stages.length, 5);
  assert.deepEqual(me!.stages.map((s) => s.number), [1, 2, 3, 4, 5]);
  assert.equal(me!.stages[2].percent, 79.5); // Stage 3 %
});

test('division counts drive "X of Y" division place', () => {
  const m = parsePractiScore(SAMPLE_PRACTISCORE_CSV);
  assert.equal(countInDivision(m.competitors, 'Carry Optics'), 4);
  assert.equal(countInDivision(m.competitors, 'Limited'), 1);
  assert.equal(countInDivision(m.competitors, 'Open'), 0);
});

test('works without a metadata block (headers as first line)', () => {
  const csv = [
    'Place,Division,Name,Power Factor,Match %,Stage 1 %,Stage 2 %',
    '1,Open,Lee Park,Major,100.00,100.00,98.0',
    '2,Open,Bo Tran,Major,90.50,88,92',
  ].join('\n');
  const m = parsePractiScore(csv);
  assert.equal(m.name, '');
  assert.equal(m.date, '');
  assert.equal(m.competitors.length, 2);
  assert.equal(m.competitors[0].name, 'Lee Park');
  assert.equal(m.competitors[0].division, 'Open');
  assert.equal(m.competitors[0].matchPercent, 100);
  assert.equal(m.competitors[0].stages[1].percent, 98);
});

test('adapts to abbreviated / alternate headers', () => {
  const csv = [
    'Pos,Div,Competitor,PF,Final %,Stage 1',
    '1,CO,A Shooter,Minor,95.5,95.5',
  ].join('\n');
  const m = parsePractiScore(csv);
  const c = m.competitors[0];
  assert.equal(c.overallPlace, 1);
  assert.equal(c.division, 'CO');
  assert.equal(c.name, 'A Shooter');
  assert.equal(c.powerFactor, 'Minor');
  assert.equal(c.matchPercent, 95.5);
  assert.equal(c.stages[0].percent, 95.5);
});

test('handles quoted fields with commas', () => {
  const csv = [
    'Place,Division,Name,Match %',
    '1,Limited,"Smith, John",100.00',
  ].join('\n');
  const m = parsePractiScore(csv);
  assert.equal(m.competitors[0].name, 'Smith, John');
});

test('skips blank lines and rows with no name or place', () => {
  const csv = [
    'Place,Division,Name,Match %',
    '1,Open,Real Person,100',
    '',
    ',,,',
  ].join('\n');
  const m = parsePractiScore(csv);
  assert.equal(m.competitors.length, 1);
});

test('throws a plain-language error on non-PractiScore text', () => {
  assert.throws(() => parsePractiScore('just some random text\nwith no table'), /PractiScore/);
});

// ---------------------------------------------------------------------------
// The shape a shooter can ACTUALLY obtain (added 5 August 2026).
//
// PractiScore's public results pages carry no download of any kind — every
// link and button on the results page, the Html Results page and the Match
// Breakdown page was enumerated on 5 August 2026 and there is no export. The
// only route is to open Html Results, choose Overall > Combined, and copy the
// page. A browser puts that on the clipboard TAB separated, with the match
// name and date on a title line and the site's own navigation wrapped around
// it. Before this was handled, a real paste threw "no competitor rows".
//
// Both fixtures are faithful to the real captures in column order, headings,
// empty cells, tab separation and the surrounding page furniture. Competitor
// names and member numbers other than Michael's own are substituted, including
// the real-world quirk of a lower-case member-number prefix.
// ---------------------------------------------------------------------------

const PAGE_CHROME_TOP = [
  "Practiscore's Terms of Service, and Privacy Policy notice. Learn more",
  'Got it!', 'Scores', 'Matches', 'Events', 'Clubs', 'Shooters', 'Guns',
  'Support', 'Login', 'Register', 'Settings ',
].join('\n');

const PAGE_CHROME_BOTTOM = ['Search links', 'Scores', 'Matches', 'Misc links'].join('\n');

/** A local Hit Factor match: no member numbers, no classes, no categories. */
const REAL_PASTE_LOCAL = [
  PAGE_CHROME_TOP,
  'New Results',
  'Take Aim Monday Night Mini Match 08-03-2026 - 2026-08-03',
  '',
  'Match Results - Combined',
  ['Place', 'Name', 'No.', 'Class', 'Div', 'PF', 'Category', 'Match Pts', 'Match %'].join('\t'),
  ['1', 'Olinchak, Matt', '', '', 'LO', 'Min', '', '347.0388', '100.0000%'].join('\t'),
  ['2', 'Slack, Chris', '', '', 'CO', 'Min', '', '318.6548', '91.8211%'].join('\t'),
  ['3', 'Buehler, Mike', '', '', 'LO', 'Min', '', '313.9015', '90.4514%'].join('\t'),
  ['5', 'Tutko, Tank', '', '', 'CO', 'Min', '', '249.0468', '71.7634%'].join('\t'),
  ['9', 'Cherry, Ian', '', '', 'O', 'Min', '', '223.0822', '64.2816%'].join('\t'),
  ['18', 'Minik, Michael', '', '', 'CO', 'Min', '', '129.7697', '37.3934%'].join('\t'),
  ['21', 'Nichols, Taylor', '', '', 'CO', 'Min', '', '96.5000', '27.8000%'].join('\t'),
  PAGE_CHROME_BOTTOM,
].join('\n');

/** A sanctioned USPSA match: member numbers, classes, both power factors. */
const REAL_PASTE_USPSA = [
  PAGE_CHROME_TOP,
  'New Results',
  'HHA USPSA August 2026 - 2026-08-02',
  '',
  'Match Results - Combined',
  ['Place', 'Name', 'No.', 'Class', 'Div', 'PF', 'Category', 'Match Pts', 'Match %'].join('\t'),
  ['1', 'Alder, Robin', 'A100001', 'M', 'LO', 'Min', '', '639.1358', '100.0000%'].join('\t'),
  ['2', 'Brandt, Casey', 'A100002', 'M', 'LO', 'Min', '', '636.2159', '99.5431%'].join('\t'),
  ['3', 'Nolan, Devin', 'TY100003', 'M', 'LO', 'Min', '', '624.1549', '97.6561%'].join('\t'),
  ['4', 'Okonkwo, Sam', 'a100004', 'M', 'O', 'Maj', '', '607.8751', '95.1089%'].join('\t'),
  ['5', 'Prieto, Alex', 'FY100005', 'A', 'O', 'Maj', '', '577.5828', '90.3693%'].join('\t'),
  ['6', 'Quill, Jordan', 'A100006', 'GM', 'CO', 'Min', 'Mil/LE', '573.0497', '89.6601%'].join('\t'),
  PAGE_CHROME_BOTTOM,
].join('\n');

test('a tab-separated Html Results paste parses (the local Hit Factor match)', () => {
  const m = parsePractiScore(REAL_PASTE_LOCAL);
  assert.equal(m.competitors.length, 7, 'page furniture must not become competitors');
  const me = m.competitors.find((c) => c.name === 'Minik, Michael');
  assert.ok(me, 'found the shooter');
  assert.equal(me!.overallPlace, 18);
  assert.equal(me!.division, 'CO');
  assert.equal(me!.powerFactor, 'Min');
  assert.equal(me!.matchPercent, 37.3934);
  assert.equal(me!.matchPoints, 129.7697);
});

test('the title line supplies the match name and date', () => {
  const m = parsePractiScore(REAL_PASTE_LOCAL);
  assert.equal(m.name, 'Take Aim Monday Night Mini Match 08-03-2026');
  assert.equal(m.date, '2026-08-03');
});

test('a tab-separated paste reads member number, class and power factor', () => {
  const m = parsePractiScore(REAL_PASTE_USPSA);
  assert.equal(m.name, 'HHA USPSA August 2026');
  assert.equal(m.date, '2026-08-02');
  assert.equal(m.competitors.length, 6);
  const gm = m.competitors.find((c) => c.name === 'Quill, Jordan');
  assert.equal(gm!.memberNumber, 'A100006', '"No." is the member-number column');
  assert.equal(gm!.classLetter, 'GM');
  assert.equal(gm!.division, 'CO');
  assert.equal(gm!.powerFactor, 'Min');
  assert.equal(gm!.matchPoints, 573.0497, '"Match Pts" is the points column');
  const lower = m.competitors.find((c) => c.name === 'Okonkwo, Sam');
  assert.equal(lower!.memberNumber, 'a100004', 'a lower-case prefix is preserved verbatim');
  assert.equal(lower!.powerFactor, 'Maj');
});

test('an explicit metadata block still beats the title line', () => {
  const text = [
    'Match Name,Explicit Wins',
    'Match Date,2026-01-02',
    'Some Other Match - 2026-09-09',
    'Overall Place,Name,Division,Match %',
    '1,Robin Alder,Open,100.00',
    '2,Casey Brandt,Open,90.00',
  ].join('\n');
  const m = parsePractiScore(text);
  assert.equal(m.name, 'Explicit Wins');
  assert.equal(m.date, '2026-01-02');
});
