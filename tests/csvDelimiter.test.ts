import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCsvLine, DELIMITER_CANDIDATES } from '../src/lib/csv.ts';

test('splitCsvLine still splits on commas by default, quotes honoured', () => {
  assert.deepEqual(splitCsvLine('a,b,c'), ['a', 'b', 'c']);
  assert.deepEqual(splitCsvLine('"Last, First",2'), ['Last, First', '2']);
});

test('an explicit comma delimiter still honours quotes', () => {
  assert.deepEqual(splitCsvLine('"Last, First",2', ','), ['Last, First', '2']);
  assert.deepEqual(splitCsvLine('"a""b",2', ','), ['a"b', '2']);
});

test('a tab delimiter treats a double quote as an ordinary character', () => {
  // Browser-copied text has no quoting convention, so an inch mark or a
  // nickname must not swallow the rest of the row. Proved by the field count:
  // honouring the quote here returns 3 fields and loses the score.
  const row = splitCsvLine('1\tSmith, Bob\tLO 5" bbl\t100.00', '\t');
  assert.equal(row.length, 4);
  assert.deepEqual(row, ['1', 'Smith, Bob', 'LO 5" bbl', '100.00']);
});

test('quote handling can be forced on for a tab file if a caller needs it', () => {
  assert.deepEqual(splitCsvLine('"has\ttab"\tb', '\t', true), ['has\ttab', 'b']);
});

test('a semicolon delimiter splits on semicolons and honours quotes', () => {
  assert.deepEqual(splitCsvLine('a;b;c', ';'), ['a', 'b', 'c']);
  assert.deepEqual(splitCsvLine('"x;y";z', ';'), ['x;y', 'z']);
});

test('the comma is the first candidate, so it wins any tie', () => {
  assert.equal(DELIMITER_CANDIDATES[0], ',');
  assert.deepEqual(DELIMITER_CANDIDATES, [',', '\t', ';']);
});
