import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePractiScore, countInDivision, beats, SAMPLE_PRACTISCORE_CSV, type PsMatch
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

// ---------------------------------------------------------------------------
// Regressions from the cold audit of 5 August 2026. Each reproduction below is
// the auditor's, and each one is proved to FAIL on commit 4ada3a5, the version
// that introduced the delimiter handling.
// ---------------------------------------------------------------------------

const TAB_HEADER = ['Place', 'Name', 'No.', 'Class', 'Div', 'PF', 'Category', 'Match Pts', 'Match %'].join('\t');

test('AUDIT-1: comma-bearing prose above the table cannot out-vote the table', () => {
  // Twelve lines of ordinary prose carrying one comma each used to beat a
  // two-shooter tab table, and the reader was told to re-copy a page that was
  // already correct. Nothing here depends on how MUCH furniture there is,
  // because furniture yields no competitors under any separator.
  const prose = Array.from({ length: 12 }, () => 'PractiScore LLC, Boise ID').join('\n');
  const text = [
    prose,
    'Small Club Match - 2026-08-02',
    TAB_HEADER,
    ['1', 'Alder, Robin', '', '', 'LO', 'Min', '', '100.0000', '100.0000%'].join('\t'),
    ['2', 'Brandt, Casey', '', '', 'CO', 'Min', '', '90.0000', '90.0000%'].join('\t'),
  ].join('\n');
  const m = parsePractiScore(text);
  assert.equal(m.competitors.length, 2);
  assert.equal(m.competitors[1].name, 'Brandt, Casey');
});

test('AUDIT-1b: a long run of page furniture before the table is still read', () => {
  // The old sampler looked at the first 200 lines only, so a long copy hid the
  // table from the delimiter decision entirely.
  const furniture = Array.from({ length: 205 }, (_, i) => 'Nav link ' + i).join('\n');
  const text = [
    furniture,
    TAB_HEADER,
    ['1', 'Alder, Robin', '', '', 'LO', 'Min', '', '100.0000', '100.0000%'].join('\t'),
    ['2', 'Brandt, Casey', '', '', 'CO', 'Min', '', '90.0000', '90.0000%'].join('\t'),
  ].join('\n');
  assert.equal(parsePractiScore(text).competitors.length, 2);
});

test('AUDIT-2: the dated line NEAREST the table titles it, not the first one', () => {
  // A copied page can carry a link to the next fixture above the results. The
  // first dated line used to win, which wrote a wrong date into the saved
  // record with nothing to give it away, because the field was populated.
  const text = [
    'Next club match - 2026-09-14',
    'Spring Classic - 2026-05-17',
    'Match Results - Combined',
    TAB_HEADER,
    ['1', 'Alder, Robin', '', '', 'LO', 'Min', '', '100.0000', '100.0000%'].join('\t'),
    ['2', 'Brandt, Casey', '', '', 'CO', 'Min', '', '90.0000', '90.0000%'].join('\t'),
  ].join('\n');
  const m = parsePractiScore(text);
  assert.equal(m.date, '2026-05-17');
  assert.equal(m.name, 'Spring Classic');
});

test('AUDIT-2b: an em dash in the title line is read like the other dashes', () => {
  const text = [
    'Autumn Open — 2026-10-04',
    TAB_HEADER,
    ['1', 'Alder, Robin', '', '', 'LO', 'Min', '', '100.0000', '100.0000%'].join('\t'),
    ['2', 'Brandt, Casey', '', '', 'CO', 'Min', '', '90.0000', '90.0000%'].join('\t'),
  ].join('\n');
  const m = parsePractiScore(text);
  assert.equal(m.name, 'Autumn Open');
  assert.equal(m.date, '2026-10-04');
});

test('AUDIT-3: a per-stage points column is never read as the match score', () => {
  // "Stage 1 Pts" used to be claimed as the match points, so one stage's score
  // was stored as the whole match's.
  const text = [
    'Place,Name,Div,Match %,Stage 1 Pts,Stage 2 Pts',
    '1,Robin Alder,Open,100.00,120.5,98.2',
    '2,Casey Brandt,Open,90.00,110.1,88.0',
  ].join('\n');
  const m = parsePractiScore(text);
  assert.equal(m.competitors[0].matchPoints, null, 'no match-points column exists in this table');
  assert.equal(m.competitors[1].matchPoints, null);
  assert.deepEqual(m.competitors[0].stages.map((s) => s.number), [1, 2]);
});

test('AUDIT-4: a "No." column of plain row numbers is not read as a member number', () => {
  // A USPSA member number always carries a letter prefix; a row counter never
  // does. Believing the heading alone wrote "USPSA# 1" into a saved record.
  const text = [
    'No.,Place,Name,Div,Match %',
    '1,1,Robin Alder,Open,100.00',
    '2,2,Casey Brandt,Open,90.00',
  ].join('\n');
  const m = parsePractiScore(text);
  assert.equal(m.competitors[0].memberNumber, '');
  assert.equal(m.competitors[1].memberNumber, '');
});

test('AUDIT-4b: a real "No." column of member numbers is still read', () => {
  const text = [
    TAB_HEADER,
    ['1', 'Alder, Robin', 'A101033', 'G', 'O', 'Maj', '', '830.6178', '100.0000%'].join('\t'),
    ['2', 'Brandt, Casey', '', '', 'CO', 'Min', '', '685.4327', '82.5208%'].join('\t'),
  ].join('\n');
  const m = parsePractiScore(text);
  assert.equal(m.competitors[0].memberNumber, 'A101033', 'one lettered value is enough to trust the column');
  assert.equal(m.competitors[1].memberNumber, '');
});

test('AUDIT-5: semicolons inside a category cell do not sweep a genuine CSV', () => {
  const text = [
    'Place,Name,Categories',
    '1,Robin Alder,Senior;Lady;Mil;LE;Junior',
    '2,Casey Brandt,Senior;Lady;Mil;LE;Junior',
  ].join('\n');
  const m = parsePractiScore(text);
  assert.equal(m.competitors.length, 2);
  assert.equal(m.competitors[0].name, 'Robin Alder');
});

test('AUDIT-6: an inch mark in a tab row does not swallow the rest of the row', () => {
  // The shooter carrying the stray quote used to lose their score while
  // everyone around them kept theirs.
  const text = [
    TAB_HEADER,
    ['1', 'Alder, Robin', '', '', 'LO', 'Min', '', '100.0000', '100.0000%'].join('\t'),
    ['2', 'Smith, Bob', '', '', 'LO 5" bbl', 'Min', '', '90.0000', '90.0000%'].join('\t'),
  ].join('\n');
  const m = parsePractiScore(text);
  const bob = m.competitors.find((c) => c.name === 'Smith, Bob');
  assert.equal(bob!.matchPercent, 90, 'the score survives the stray quote');
  assert.equal(bob!.division, 'LO 5" bbl');
});

test('AUDIT-7: a header plus ONE ragged row still parses', () => {
  // The reported input was a header and a SINGLE row that dropped its trailing
  // cell. An earlier version of this test used two rows, which did not
  // reproduce the defect and passed on the broken code — a test named for
  // something it never constrained.
  const text = [
    TAB_HEADER,
    ['1', 'Alder, Robin', '', '', 'LO', 'Min', '', '100.0000'].join('\t'),
  ].join('\n');
  const m = parsePractiScore(text);
  assert.equal(m.competitors.length, 1);
  assert.equal(m.competitors[0].name, 'Alder, Robin');
  assert.equal(m.competitors[0].matchPoints, 100);
});

test('AUDIT-8: a genuine comma export is never displaced by another separator', () => {
  // The guard on the whole delimiter change: the shape that worked before must
  // keep working, and the sample is the shape the screen ships with.
  const m = parsePractiScore(SAMPLE_PRACTISCORE_CSV);
  assert.equal(m.competitors.length, 5);
  assert.equal(m.competitors[2].name, 'Chris Calder');
  assert.equal(m.competitors[2].matchPoints, 612.34);
});

// ---------------------------------------------------------------------------
// Round two of the cold audit. Every finding below was created by round one's
// own fixes, which is the documented shape of this feature rather than a
// surprise. Each reproduction is the auditor's; each fails on c2129ef.
// ---------------------------------------------------------------------------

test('AUDIT-9: nameless summary rows never out-vote real shooters', () => {
  // Split on tabs, ",,,100" is one field and looseNum strips the commas to a
  // place of 100, so three nameless rows beat two real ones and the reader was
  // offered "(no name)" three times with a saved place of 100 behind it.
  const text = [
    'Place,Name,Div,Match %',
    '1,Robin Alder,Open,100.00',
    '2,Casey Brandt,Open,90.00',
    ',,,100',
    ',,,90',
    ',,,80',
  ].join('\n');
  const m = parsePractiScore(text);
  assert.equal(m.competitors.length, 2);
  assert.equal(m.competitors[0].name, 'Robin Alder');
  assert.equal(m.competitors[1].name, 'Casey Brandt');
});

test('AUDIT-10: the page footer cannot vouch for a row-counter column', () => {
  // The copy instructions say to select the whole page, so the footer comes
  // with it. A guard that asked "does any value contain a letter" took its
  // answer from a line outside the table and trusted a row counter.
  const text = [
    ['No.', 'Place', 'Name', 'Div', 'Match %'].join('\t'),
    ['1', '1', 'Alder, Robin', 'LO', '100.00'].join('\t'),
    ['2', '2', 'Brandt, Casey', 'CO', '90.00'].join('\t'),
    ['Search links', 'Scores', 'Matches', 'Misc', 'Links'].join('\t'),
  ].join('\n');
  const m = parsePractiScore(text);
  assert.equal(m.competitors[0].memberNumber, '', 'a row number is not a member number');
  assert.equal(m.competitors[1].memberNumber, '');
});

test('AUDIT-11: a match name containing a comma is not truncated', () => {
  const text = [
    'Spring Classic, Level 1 - 2026-05-17',
    'Place,Name,Div,Match %',
    '1,Robin Alder,Open,100.00',
    '2,Casey Brandt,Open,90.00',
  ].join('\n');
  assert.equal(parsePractiScore(text).name, 'Spring Classic, Level 1');
});

test('AUDIT-11b: a title sitting in a table cell drops its neighbouring cells', () => {
  // A tab IS structural, unlike a comma: anything before the last one is a
  // neighbouring cell rather than part of the title.
  const text = [
    ['Match Results', 'Spring Classic - 2026-05-17'].join('\t'),
    TAB_HEADER,
    ['1', 'Alder, Robin', '', '', 'LO', 'Min', '', '100.0000', '100.0000%'].join('\t'),
    ['2', 'Brandt, Casey', '', '', 'CO', 'Min', '', '90.0000', '90.0000%'].join('\t'),
  ].join('\n');
  const m = parsePractiScore(text);
  assert.equal(m.name, 'Spring Classic');
  assert.equal(m.date, '2026-05-17');
});

test('AUDIT-12: a real member number under a bare "No." heading is still read', () => {
  const text = [
    TAB_HEADER,
    ['1', 'Alder, Robin', 'A101033', 'G', 'O', 'Maj', '', '830.6178', '100.0000%'].join('\t'),
    ['2', 'Nolan, Devin', 'TY112817', 'M', 'LO', 'Min', '', '705.7027', '84.9612%'].join('\t'),
    ['3', 'Okonkwo, Sam', 'a133555', 'M', 'O', 'Maj', '', '607.8751', '73.1000%'].join('\t'),
    ['4', 'Widman, Daniel', 'L5268', 'M', 'LO', 'Min', '', '659.9473', '79.4526%'].join('\t'),
  ].join('\n');
  const m = parsePractiScore(text);
  assert.deepEqual(
    m.competitors.map((c) => c.memberNumber),
    ['A101033', 'TY112817', 'a133555', 'L5268'],
    'every real prefix shape survives, upper and lower case',
  );
});

test('AUDIT-13: an unambiguous member-number heading is taken as given', () => {
  // The shape test applies only under the ambiguous "No." heading. A column
  // that says what it is gets believed whatever it holds.
  const text = [
    'Place,Name,USPSA #,Div,Match %',
    '1,Robin Alder,101033,Open,100.00',
    '2,Casey Brandt,172032,Open,90.00',
  ].join('\n');
  const m = parsePractiScore(text);
  assert.equal(m.competitors[0].memberNumber, '101033');
  assert.equal(m.competitors[1].memberNumber, '172032');
});

function reading(names: string[]): PsMatch {
  return {
    name: '', date: '', stageCount: null,
    competitors: names.map((n, i) => ({
      overallPlace: i + 1, divisionPlace: null, name: n, memberNumber: '',
      division: '', classLetter: '', powerFactor: '',
      matchPoints: null, matchPercent: null, stages: [],
    })),
  };
}

test('AUDIT-14: a later separator must BEAT the incumbent, never tie it', () => {
  // The property the try-each-separator design rests on: a comma export can
  // never be displaced, because the comma is tried first and holds any tie.
  // It was asserted nowhere, and changing the comparison to >= left every
  // other test green.
  assert.equal(beats(reading(['A']), reading(['B'])), false, 'an equal reading does not displace');
  assert.equal(beats(reading(['A', 'B']), reading(['C'])), true, 'more named shooters wins');
  assert.equal(beats(reading(['A']), reading(['B', 'C'])), false, 'fewer named shooters loses');
});

test('AUDIT-14b: named shooters decide before raw row count', () => {
  // Three nameless rows must not beat two real ones, which is the whole point
  // of AUDIT-9 stated as a property rather than as one input.
  const nameless = reading(['', '', '']);
  const real = reading(['Robin Alder', 'Casey Brandt']);
  assert.equal(beats(nameless, real), false);
  assert.equal(beats(real, nameless), true);
});

test('AUDIT-14c: with no names anywhere, the bigger table wins', () => {
  assert.equal(beats(reading(['', '', '']), reading(['', ''])), true);
  assert.equal(beats(reading(['', '']), reading(['', '', ''])), false);
});

// ---------------------------------------------------------------------------
// Round three of the cold audit. Same shape again: both findings are children
// of round two's own fixes.
// ---------------------------------------------------------------------------

test('AUDIT-15: a heading that does not split into columns is the wrong separator', () => {
  // "Pos" and "Shooter" pass the header sniff on the joined string, so under a
  // tab split the single cell was claimed as the NAME column and every raw
  // line in the file became a named shooter — one more than the correct
  // reading had, because of a trailing line of page text. The reader was then
  // offered "1,Robin Alder,100.00" as a person to be.
  const text = [
    'Pos,Shooter,Score',
    '1,Robin Alder,100.00',
    '2,Casey Brandt,90.00',
    '3,Devin Nolan,85.00',
    'Results generated by PractiScore',
  ].join('\n');
  const m = parsePractiScore(text);
  assert.equal(m.competitors.length, 3, 'the trailing prose line is not a shooter');
  assert.deepEqual(
    m.competitors.map((c) => c.name),
    ['Robin Alder', 'Casey Brandt', 'Devin Nolan'],
  );
});

test('AUDIT-16: real member-number formats survive the shape test', () => {
  // Each of these is a format the narrower shape silently discarded, and a
  // discarded member number has no cue anywhere on screen.
  const shapes = ['A185321', 'TY112817', 'L5268', 'FY100686', 'a133555', 'A12', 'L52', 'USA-12345', 'A 12345', 'TYFA12345'];
  const text = [
    ['Place', 'Name', 'No.', 'Div', 'Match %'].join('\t'),
    ...shapes.map((n, i) => [String(i + 1), 'Shooter ' + (i + 1), n, 'O', '90.00'].join('\t')),
  ].join('\n');
  const m = parsePractiScore(text);
  assert.deepEqual(m.competitors.map((c) => c.memberNumber), shapes);
});

test('AUDIT-16b: the shape test still rejects a row counter and page text', () => {
  // The bounds, both of them, pinned in the rejecting direction. Widening the
  // digit count or the prefix length to "anything" has to break a test.
  // 'A1' pins the digit-count bound: a lone digit behind a letter is a
  // spreadsheet cell reference or a squad label far more often than it is a
  // member number, and relaxing \d{2,} to \d+ has to break a test.
  const rejects = ['1', '2', '12', '0001', '99', 'A1', 'Search links', 'Scores', 'ABCDE12345'];
  const text = [
    ['Place', 'Name', 'No.', 'Div', 'Match %'].join('\t'),
    ...rejects.map((n, i) => [String(i + 1), 'Shooter ' + (i + 1), n, 'O', '90.00'].join('\t')),
  ].join('\n');
  const m = parsePractiScore(text);
  assert.deepEqual(
    m.competitors.map((c) => c.memberNumber),
    rejects.map(() => ''),
    'a value with no letters, or with too long a prefix, is not believed',
  );
});
