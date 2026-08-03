import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeCsvField, neutralizeFormula, toCsvText, joinCell, exportFilename,
} from '../src/lib/csvExport.ts';
import type { CsvColumn } from '../src/lib/csvExport.ts';

const BOM = '﻿';

// ---------------------------------------------------------------------------
// Field escaping — RFC 4180
// ---------------------------------------------------------------------------

test('a plain field is emitted bare', () => {
  assert.equal(escapeCsvField('Glock 34'), 'Glock 34');
  assert.equal(escapeCsvField(150), '150');
  assert.equal(escapeCsvField(0), '0');
  assert.equal(escapeCsvField(false), 'false');
});

test('null and undefined become an EMPTY cell, never the word null', () => {
  assert.equal(escapeCsvField(null), '');
  assert.equal(escapeCsvField(undefined), '');
  // The failure this guards: a spreadsheet column full of the literal text
  // "null" is the tell of an export nobody opened.
  assert.ok(!escapeCsvField(null).includes('null'));
});

test('a field containing the delimiter is quoted', () => {
  assert.equal(escapeCsvField('Ruskin, FL'), '"Ruskin, FL"');
});

test('an embedded double quote is doubled and the field quoted', () => {
  assert.equal(escapeCsvField('the "good" run'), '"the ""good"" run"');
});

test('a field containing a line break is quoted and keeps the break', () => {
  const out = escapeCsvField('first line\nsecond line');
  assert.equal(out, '"first line\nsecond line"');
  // The break survives — this is the case the current line-by-line importer
  // cannot read back (csv.ts / practiscore.ts split on lines first), and the
  // reason the import side needs a whole-text parser.
  assert.ok(out.includes('\n'));
});

test('a semicolon delimiter quotes semicolons and leaves commas alone', () => {
  assert.equal(escapeCsvField('a;b', ';'), '"a;b"');
  assert.equal(escapeCsvField('a,b', ';'), 'a,b');
});

test('an object is serialised as JSON rather than [object Object]', () => {
  assert.equal(escapeCsvField({ a: 1 }), '"{""a"":1}"');
});

// ---------------------------------------------------------------------------
// CSV injection — the guard that matters most in this file
// ---------------------------------------------------------------------------

test('a cell that a spreadsheet would run as a formula is neutralised', () => {
  for (const dangerous of ['=1+1', '+1x', '-1a', '@SUM(A1)', '=cmd|\' /c calc\'!A1']) {
    const out = neutralizeFormula(dangerous);
    assert.equal(out[0], "'", `expected a leading quote on ${dangerous}`);
    assert.ok(out.endsWith(dangerous));
  }
});

test('the guard runs through escapeCsvField, not only when called directly', () => {
  assert.equal(escapeCsvField('=1+1'), "'=1+1");
  // And it survives quoting when the value also contains a delimiter.
  assert.equal(escapeCsvField('=1,2'), '"\'=1,2"');
});

test('a note that merely begins with a minus is neutralised too', () => {
  // Not hostile — just a shooter writing "-2 seconds on the draw". Excel would
  // otherwise read it as a formula and mangle or reject the cell.
  assert.equal(escapeCsvField('-2 seconds on the draw'), "'-2 seconds on the draw");
});

test('a NEGATIVE NUMBER stays a number — the guard exempts well-formed numbers', () => {
  // The blunt version of this guard neutralises every field starting + or -,
  // which turns every negative number in the log into TEXT in the spreadsheet:
  // unsortable, unsummable. Excel reads -5 as the number minus five, not as a
  // formula, so there is nothing to defend against.
  assert.equal(escapeCsvField(-5), '-5');
  assert.equal(escapeCsvField(-0.25), '-0.25');
  assert.equal(escapeCsvField('+12'), '+12');
  assert.equal(escapeCsvField('-1e3'), '-1e3');
});

test('a signed value that is NOT purely a number is still neutralised', () => {
  // Excel evaluates this one, so the exemption must not reach it.
  assert.equal(escapeCsvField('-1+1'), "'-1+1");
  assert.equal(escapeCsvField('-2 seconds'), "'-2 seconds");
  assert.equal(escapeCsvField('--5'), "'--5");
});

test('an ordinary number is untouched', () => {
  assert.equal(escapeCsvField(150), '150');
  assert.equal(escapeCsvField(1.5), '1.5');
});

// ---------------------------------------------------------------------------
// Whole-file serialisation
// ---------------------------------------------------------------------------

interface Row { name: string; rounds: number | null; notes: string }

const cols: CsvColumn<Row>[] = [
  { header: 'Name', get: (r) => r.name },
  { header: 'Rounds', get: (r) => r.rounds },
  { header: 'Notes', get: (r) => r.notes },
];

test('writes a header row and one row per record, CRLF terminated', () => {
  const out = toCsvText<Row>(
    [{ name: 'Apollo', rounds: 300, notes: '' }],
    cols,
    { withBom: false },
  );
  assert.equal(out, 'Name,Rounds,Notes\r\nApollo,300,\r\n');
});

test('emits a UTF-8 BOM by default so Excel reads accents correctly', () => {
  const out = toCsvText<Row>([{ name: 'Ré', rounds: 1, notes: '' }], cols);
  assert.ok(out.startsWith(BOM));
  // …and only one, at the very front.
  assert.equal(out.indexOf(BOM), 0);
  assert.equal(out.lastIndexOf(BOM), 0);
});

test('a header-only file is valid when there are no records', () => {
  const out = toCsvText<Row>([], cols, { withBom: false });
  assert.equal(out, 'Name,Rounds,Notes\r\n');
});

test('a column accessor that throws yields #ERROR and does not lose the file', () => {
  const boom: CsvColumn<Row>[] = [
    { header: 'Name', get: (r) => r.name },
    { header: 'Bad', get: () => { throw new Error('legacy record'); } },
    { header: 'Rounds', get: (r) => r.rounds },
  ];
  const out = toCsvText<Row>([{ name: 'Apollo', rounds: 300, notes: '' }], boom, { withBom: false });
  assert.equal(out, 'Name,Bad,Rounds\r\nApollo,#ERROR,300\r\n');
  // The point: one bad record must never cost the user the whole export.
});

test('a value that cannot be SERIALISED yields #ERROR and does not lose the file', () => {
  // safeGet only wrapped the accessor, so a value that threw inside
  // escapeCsvField itself took the whole export down rather than one cell.
  // Neither of these is reachable from what the app writes today; the point is
  // that the guard's stated contract is now true rather than nearly true.
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const cols2: CsvColumn<Row>[] = [
    { header: 'Name', get: (r) => r.name },
    { header: 'Bad', get: () => new Date(NaN) },
    { header: 'Worse', get: () => circular },
    { header: 'Rounds', get: (r) => r.rounds },
  ];
  const out = toCsvText<Row>([{ name: 'Apollo', rounds: 300, notes: '' }], cols2, { withBom: false });
  assert.equal(out, 'Name,Bad,Worse,Rounds\r\nApollo,#ERROR,#ERROR,300\r\n');
});

test('headers are escaped like any other field', () => {
  const weird: CsvColumn<Row>[] = [{ header: 'Rounds, total', get: (r) => r.rounds }];
  const out = toCsvText<Row>([], weird, { withBom: false });
  assert.equal(out, '"Rounds, total"\r\n');
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

test('joinCell joins a list and drops empties', () => {
  assert.equal(joinCell(['Bill Drill', 'Doubles']), 'Bill Drill; Doubles');
  assert.equal(joinCell([]), '');
  assert.equal(joinCell(null), '');
  assert.equal(joinCell(['a', '', null, undefined, 'b']), 'a; b');
});

test('exportFilename is sortable, dated in LOCAL time, and legal everywhere', () => {
  const d = new Date(2026, 7, 2, 23, 30); // 2 Aug 2026, 23:30 local
  assert.equal(exportFilename('sessions', d), 'FirearmLog-sessions-2026-08-02.csv');
  // A UTC date would read as the 3rd here for anyone east of Greenwich; the
  // filename is the one thing the user reads before opening the file.
});

test('exportFilename strips anything a filesystem would refuse', () => {
  assert.equal(exportFilename('ses/sions', new Date(2026, 0, 1)), 'FirearmLog-sessions-2026-01-01.csv');
});
