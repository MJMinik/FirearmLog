import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCsvLine, sniffDelimiter } from '../src/lib/csv.ts';

test('splitCsvLine still splits on commas by default', () => {
  assert.deepEqual(splitCsvLine('a,b,c'), ['a', 'b', 'c']);
  assert.deepEqual(splitCsvLine('"Last, First",2'), ['Last, First', '2']);
});

test('splitCsvLine honours an explicit delimiter, quotes included', () => {
  assert.deepEqual(splitCsvLine('a\tb\tc', '\t'), ['a', 'b', 'c']);
  assert.deepEqual(splitCsvLine('"has\ttab"\tb', '\t'), ['has\ttab', 'b']);
  assert.deepEqual(splitCsvLine('Last, First\t2', '\t'), ['Last, First', '2']);
});

test('a comma table is sniffed as comma', () => {
  const csv = ['Place,Name,Division', '1,Robin Alder,Open', '2,Casey Brandt,Open'].join('\n');
  assert.equal(sniffDelimiter(csv), ',');
});

test('a tab table wrapped in page furniture is sniffed as tab', () => {
  // The failure this closes: the furniture outnumbers the table, so any
  // average or median over all lines reports "one column" for every candidate
  // and the real table never gets a vote.
  const pasted = [
    'Scores', 'Matches', 'Events', 'Clubs', 'Shooters', 'Guns', 'Support',
    'Login', 'Register', 'Settings', 'New Results', 'Match Results - Combined',
    ['Place', 'Name', 'Div', 'Match %'].join('\t'),
    ['1', 'Alder, Robin', 'LO', '100.0000%'].join('\t'),
    ['2', 'Brandt, Casey', 'CO', '91.8211%'].join('\t'),
    'Search links', 'Scores', 'Matches', 'Misc links',
  ].join('\n');
  assert.equal(sniffDelimiter(pasted), '\t');
});

test('names containing commas do not out-vote a real tab table', () => {
  // Every data row holds "Last, First", so a comma finds two fragments on each
  // line and agrees on the same shape as the tab table does. The tab wins on
  // how much table it accounts for, not on how many lines it split.
  const pasted = [
    ['Place', 'Name', 'Div', 'PF', 'Match %'].join('\t'),
    ['1', 'Alder, Robin', 'LO', 'Min', '100.0000%'].join('\t'),
    ['2', 'Brandt, Casey', 'CO', 'Min', '91.8211%'].join('\t'),
    ['3', 'Nolan, Devin', 'LO', 'Min', '90.4514%'].join('\t'),
  ].join('\n');
  assert.equal(sniffDelimiter(pasted), '\t');
});

test('a semicolon table is sniffed as semicolon', () => {
  const text = ['Place;Name;Division', '1;Robin Alder;Open', '2;Casey Brandt;Open'].join('\n');
  assert.equal(sniffDelimiter(text), ';');
});

test('empty or shapeless text falls back to a comma', () => {
  assert.equal(sniffDelimiter(''), ',');
  assert.equal(sniffDelimiter('just one line of prose'), ',');
});
