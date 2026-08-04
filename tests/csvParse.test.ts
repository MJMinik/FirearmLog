// CSV parser tests (design doc section 5, the parser list). Run against the
// app's REAL functions, under plain Node:  npm test
//
// Every fixture in this file is fabricated. No file here claims to be any real
// app's export, because no real export format has been verified.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, detectDelimiter, columnName, rowLooksLikeData, cellAt } from '../src/lib/import/csvParse.ts';

// ---------------------------------------------------------------------------
// Quoting: the part a line-by-line splitter cannot do
// ---------------------------------------------------------------------------

test('a quoted field keeps the separator inside it', () => {
  const parsed = parseCsv('Date,Notes\n2026-03-04,"Windy, cold"\n');
  assert.deepEqual(parsed.headers, ['Date', 'Notes']);
  assert.deepEqual(parsed.rows, [['2026-03-04', 'Windy, cold']]);
});

test('a doubled quote inside a quoted field is one quote', () => {
  const parsed = parseCsv('Notes\n"He said ""fast hands"" all day"\n');
  assert.deepEqual(parsed.rows, [['He said "fast hands" all day']]);
});

test('a line break inside a quoted field stays in ONE row', () => {
  const parsed = parseCsv('Date,Notes\n2026-03-04,"first line\nsecond line"\n2026-03-05,dry\n');
  assert.equal(parsed.rows.length, 2, 'the multi-line note must not tear the row in two');
  assert.equal(parsed.rows[0][1], 'first line\nsecond line');
  // The line numbers still point at the real file, so a problem message can be
  // looked up by the shooter.
  assert.deepEqual(parsed.rowLines, [2, 4]);
});

// ---------------------------------------------------------------------------
// Separators, byte-order marker, line endings
// ---------------------------------------------------------------------------

test('a semicolon file parses, and says so', () => {
  const parsed = parseCsv('Date;Gun;Rounds\n2026-03-04;Apollo;150\n');
  assert.equal(parsed.delimiter, ';');
  assert.deepEqual(parsed.headers, ['Date', 'Gun', 'Rounds']);
  assert.deepEqual(parsed.rows, [['2026-03-04', 'Apollo', '150']]);
});

test('a tab file parses', () => {
  const parsed = parseCsv('Date\tGun\tRounds\n2026-03-04\tApollo\t150\n');
  assert.equal(parsed.delimiter, '\t');
  assert.deepEqual(parsed.rows, [['2026-03-04', 'Apollo', '150']]);
});

test('a comma file with semicolons inside the text still reads as commas', () => {
  const text = 'Date,Notes\n2026-03-04,"draw; reload; transition"\n2026-03-05,"one; two"\n';
  assert.equal(detectDelimiter(text), ',');
  assert.equal(parseCsv(text).headers.length, 2);
});

test('the delimiter can be forced by the caller', () => {
  const parsed = parseCsv('a;b\n1;2\n', { delimiter: ',' });
  assert.equal(parsed.delimiter, ',');
  assert.deepEqual(parsed.headers, ['a;b']);
});

test('the byte-order marker some spreadsheets prepend is stripped', () => {
  const parsed = parseCsv('﻿Date,Gun\n2026-03-04,Apollo\n');
  assert.deepEqual(parsed.headers, ['Date', 'Gun'], 'the first header must not carry an invisible character');
});

test('CRLF line endings parse the same as plain newlines', () => {
  const parsed = parseCsv('Date,Gun\r\n2026-03-04,Apollo\r\n2026-03-05,Vesta\r\n');
  assert.deepEqual(parsed.headers, ['Date', 'Gun']);
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[1], ['2026-03-05', 'Vesta']);
});

// ---------------------------------------------------------------------------
// Rows that do not fit
// ---------------------------------------------------------------------------

test('a ragged row is KEPT and reported with its line number, not discarded', () => {
  const parsed = parseCsv('Date,Gun,Rounds\n2026-03-04,Apollo,150\n2026-03-05,Vesta\n');
  assert.equal(parsed.rows.length, 2, 'the short row is kept for the planner to report');
  const problem = parsed.problems.find((p) => p.row === 1);
  assert.ok(problem, 'the short row must be reported');
  assert.equal(problem.line, 3);
  assert.match(problem.message, /2 values but the header row has 3/);
});

test('fully blank rows are skipped without shifting the line numbers', () => {
  const parsed = parseCsv('Date,Gun\n\n2026-03-04,Apollo\n\n\n2026-03-05,Vesta\n');
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rowLines, [3, 6]);
});

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

test('a first row that looks like data is flagged rather than silently eaten', () => {
  const parsed = parseCsv('2026-03-04,Apollo,150\n2026-03-05,Vesta,200\n');
  assert.equal(parsed.headerLooksLikeData, true);
  const named = parseCsv('Date,Gun,Rounds\n2026-03-04,Apollo,150\n');
  assert.equal(named.headerLooksLikeData, false);
});

test('a file with no header row gets Column A, B, C and keeps every row', () => {
  const parsed = parseCsv('2026-03-04,Apollo,150\n2026-03-05,Vesta,200\n', { hasHeader: false });
  assert.deepEqual(parsed.headers, ['Column A', 'Column B', 'Column C']);
  assert.equal(parsed.rows.length, 2);
});

test('blank and repeated column names are given names, and it says so', () => {
  const parsed = parseCsv('Date,,Date,Gun\n2026-03-04,x,2026-03-05,Apollo\n');
  assert.deepEqual(parsed.headers, ['Date', 'Column B', 'Date (2)', 'Gun']);
  assert.equal(parsed.headersDisambiguated, true);
});

test('ordinary headers are left alone', () => {
  const parsed = parseCsv('Date,Gun,Rounds\n2026-03-04,Apollo,150\n');
  assert.equal(parsed.headersDisambiguated, false);
});

test('columnName counts past Z the way a spreadsheet does', () => {
  assert.equal(columnName(0), 'Column A');
  assert.equal(columnName(25), 'Column Z');
  assert.equal(columnName(26), 'Column AA');
});

// ---------------------------------------------------------------------------
// Files with nothing in them
// ---------------------------------------------------------------------------

test('an empty file is refused in words, and never throws', () => {
  const parsed = parseCsv('');
  assert.deepEqual(parsed.rows, []);
  assert.deepEqual(parsed.headers, []);
  assert.equal(parsed.problems.length, 1);
  assert.match(parsed.problems[0].message, /no rows/i);
});

test('a header-only file keeps its headers and says there are no rows', () => {
  const parsed = parseCsv('Date,Gun,Rounds\n');
  assert.deepEqual(parsed.headers, ['Date', 'Gun', 'Rounds']);
  assert.deepEqual(parsed.rows, []);
  assert.equal(parsed.problems.length, 1);
  assert.match(parsed.problems[0].message, /no rows/i);
});

test('whitespace-only text is refused like an empty file', () => {
  const parsed = parseCsv('\n\n   \n');
  assert.deepEqual(parsed.rows, []);
  assert.ok(parsed.problems.length > 0);
});

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

test('rowLooksLikeData reads numbers and dates as data, words as names', () => {
  assert.equal(rowLooksLikeData(['2026-03-04', 'Apollo', '150']), true);
  assert.equal(rowLooksLikeData(['Date', 'Gun', 'Rounds']), false);
  assert.equal(rowLooksLikeData(['', '', '']), false);
});

test('cellAt returns an empty string past the end of a short row', () => {
  assert.equal(cellAt(['a', 'b'], 1), 'b');
  assert.equal(cellAt(['a', 'b'], 5), '');
  assert.equal(cellAt(['a', 'b'], -1), '');
});
