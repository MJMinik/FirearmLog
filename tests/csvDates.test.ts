// Date-engine tests (design doc section 5, the date-detection list).
//
// Several of these exist because the same defect was found by measurement in an
// earlier build of this engine: a column carrying proof of both orders read as
// a third thing, yy/mm/dd read a decade out, a column with times attached
// blocked the whole file, a blank column reached the question, and the value
// shown in the question was one the offered readings could not read. Each is
// named in the test title so nobody has to rediscover it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyseDateColumn, convertDateValue, distinguishingDateSample, orderCandidates,
  stripTime, dateAmbiguityMessage, dateFormatLabel,
} from '../src/lib/import/csvDates.ts';

// ---------------------------------------------------------------------------
// Columns that need no question
// ---------------------------------------------------------------------------

test('an ISO column is settled without asking', () => {
  const result = analyseDateColumn(['2026-03-04', '2026-03-05', '2025-12-31']);
  assert.equal(result.ambiguous, false);
  assert.equal(result.ambiguous === false && result.format, 'ymd');
  assert.equal(convertDateValue('2026-03-04', 'ymd'), '2026-03-04');
});

test('an unambiguous month-first column is settled as month first', () => {
  // 06/25 can only be June 25th: there is no month 25.
  const result = analyseDateColumn(['03/04/2026', '06/25/2026', '01/09/2026']);
  assert.equal(result.ambiguous, false);
  assert.equal(result.ambiguous === false && result.format, 'mdy');
  assert.equal(convertDateValue('03/04/2026', 'mdy'), '2026-03-04');
});

test('an unambiguous day-first column is settled as day first', () => {
  const result = analyseDateColumn(['03/04/2026', '25/06/2026', '09/01/2026']);
  assert.equal(result.ambiguous, false);
  assert.equal(result.ambiguous === false && result.format, 'dmy');
  assert.equal(convertDateValue('03/04/2026', 'dmy'), '2026-04-03');
});

test('a named-month column needs no order at all', () => {
  const result = analyseDateColumn(['Jun 14, 2025', '14 June 2025', 'Mar. 4 2026']);
  assert.equal(result.ambiguous, false);
  assert.equal(convertDateValue('Jun 14, 2025', 'dmy'), '2025-06-14');
  assert.equal(convertDateValue('14 June 2025', 'mdy'), '2025-06-14');
  assert.equal(convertDateValue('Mar. 4 2026', 'ymd'), '2026-03-04');
});

// ---------------------------------------------------------------------------
// Columns that must ask
// ---------------------------------------------------------------------------

test('a genuinely ambiguous column ASKS rather than guessing', () => {
  const result = analyseDateColumn(['03/04/2026', '05/06/2026', '01/02/2026']);
  assert.equal(result.ambiguous, true);
  if (result.ambiguous) {
    assert.equal(result.reason, 'order');
    assert.deepEqual(result.options, ['dmy', 'mdy']);
    assert.equal(result.sample, '03/04/2026');
  }
});

test('GUARD: a column proving BOTH orders reports the contradiction and never picks a third reading', () => {
  // 25/06 can only be day first. 06/25 can only be month first. Both are here.
  const result = analyseDateColumn(['25/06/2026', '06/25/2026', '03/04/2026']);
  assert.equal(result.ambiguous, true, 'a column that contradicts itself must be reported, not resolved');
  if (result.ambiguous) {
    assert.equal(result.reason, 'contradiction');
    // Not year-first, not day-first, not month-first: the shooter is asked.
    assert.deepEqual(result.options, ['dmy', 'mdy']);
  }
});

test('GUARD: evidence is collected across the WHOLE column, including past four-digit leading groups', () => {
  // The ISO rows come first. An engine that returned as soon as it met a
  // four-digit leading group would throw away the proof waiting in row four.
  const result = analyseDateColumn(['2026-01-02', '2026-01-03', '03/04/2026', '25/06/2026']);
  assert.equal(result.ambiguous, false);
  assert.equal(result.ambiguous === false && result.format, 'dmy');
});

test('GUARD: a two-digit-year column is NOT read as day first', () => {
  // 25/06/14 is 14 June 2025 read as yy/mm/dd and 25 June 2014 read as day
  // first. Guessing day first here puts every session a decade out.
  const result = analyseDateColumn(['25/06/14', '25/07/02', '26/01/09']);
  assert.equal(result.ambiguous, true, 'two-digit years must be asked about, never assumed');
  if (result.ambiguous) {
    assert.equal(result.reason, 'twoDigitYear');
    assert.ok(result.options.includes('ymd'), 'year first has to stay on the table');
    assert.ok(result.options.includes('dmy'));
  }
  assert.equal(convertDateValue('25/06/14', 'ymd'), '2025-06-14');
  assert.equal(convertDateValue('25/06/14', 'dmy'), '2014-06-25');
});

test('a two-digit-year column still resolves when one row rules the others out', () => {
  // 25/06/32 cannot be year first (there is no 32nd day) and cannot be month
  // first (there is no month 25), so the whole column is day first and no
  // question is asked.
  const result = analyseDateColumn(['25/06/14', '25/06/32']);
  assert.equal(result.ambiguous, false);
  assert.equal(result.ambiguous === false && result.format, 'dmy');
  assert.equal(convertDateValue('25/06/14', 'dmy'), '2014-06-25');
});

test('GUARD: an all-blank date column never reaches the question', () => {
  const result = analyseDateColumn(['', '   ', '']);
  assert.equal(result.ambiguous, false, 'there is nothing to ask about');
});

test('a column of nothing but garbage is not a question either', () => {
  const result = analyseDateColumn(['not a date', 'later', '']);
  assert.equal(result.ambiguous, false);
});

// ---------------------------------------------------------------------------
// GUARD: the value shown in the question
// ---------------------------------------------------------------------------

test('GUARD: the sample must be readable by BOTH offered readings, not merely render differently', () => {
  // 31/12/2026 is day first only: month first cannot read it, so a renderer
  // that falls back to raw text would offer a button showing "31/12/2026",
  // and tapping it would select the reading that cannot read it.
  const values = ['31/12/2026', '03/04/2026'];
  const naive = values.find((v) => {
    const a = convertDateValue(v, 'dmy') ?? v;
    const b = convertDateValue(v, 'mdy') ?? v;
    return a !== b;
  });
  assert.equal(naive, '31/12/2026', 'the naive check picks the value only one reading can read');
  assert.equal(
    distinguishingDateSample(values, ['dmy', 'mdy']),
    '03/04/2026',
    'the sample has to be one both readings can read',
  );
});

test('a value both readings agree on is not a sample', () => {
  assert.equal(distinguishingDateSample(['05/05/2026', '07/07/2026'], ['dmy', 'mdy']), null);
});

test('a column with no distinguishing value returns null instead of an unusable question', () => {
  assert.equal(distinguishingDateSample(['31/12/2026'], ['dmy', 'mdy']), null);
  assert.equal(distinguishingDateSample(['03/04/2026'], ['dmy']), null, 'one reading is not a choice');
});

// ---------------------------------------------------------------------------
// GUARD: dates with a time attached
// ---------------------------------------------------------------------------

test('GUARD: a date column with times attached parses instead of blocking the file', () => {
  assert.equal(convertDateValue('2026-03-04 14:22', 'ymd'), '2026-03-04');
  assert.equal(convertDateValue('2026-03-04T14:22:31', 'ymd'), '2026-03-04');
  assert.equal(convertDateValue('04/03/2026 2:05 PM', 'dmy'), '2026-03-04');
  assert.equal(stripTime('2026-03-04 14:22'), '2026-03-04');
  const result = analyseDateColumn(['2026-03-04 14:22', '2026-03-05 09:00']);
  assert.equal(result.ambiguous, false);
});

test('times do not invent order evidence', () => {
  assert.equal(orderCandidates('2026-03-04 14:22'), null);
});

// ---------------------------------------------------------------------------
// Values that cannot be read
// ---------------------------------------------------------------------------

test('mixed garbage stays a per-row matter and does not decide the column', () => {
  const values = ['2026-03-04', 'sometime last spring', '2026-03-05', ''];
  const result = analyseDateColumn(values);
  assert.equal(result.ambiguous, false, 'one unreadable value must not make the column a question');
  assert.equal(convertDateValue('sometime last spring', 'ymd'), null, 'the bad row reports itself, not a blank date');
  assert.equal(convertDateValue('', 'ymd'), null);
});

test('an impossible date is refused rather than rolled over', () => {
  assert.equal(convertDateValue('02/30/2026', 'mdy'), null, 'there is no February 30th');
  assert.equal(convertDateValue('13/13/2026', 'dmy'), null);
  assert.equal(convertDateValue('2026-02-29', 'ymd'), null, '2026 is not a leap year');
  assert.equal(convertDateValue('2024-02-29', 'ymd'), '2024-02-29');
  assert.deepEqual(orderCandidates('13/13/2026'), [], 'unreadable by every reading, so it narrows nothing');
});

test('a four-digit leading group is read as a year whatever the column format says', () => {
  assert.equal(convertDateValue('2026-03-04', 'dmy'), '2026-03-04');
  assert.equal(convertDateValue('2026-03-04', 'mdy'), '2026-03-04');
});

test('dots and slashes both work as separators', () => {
  assert.equal(convertDateValue('04.03.2026', 'dmy'), '2026-03-04');
  assert.equal(convertDateValue('2026/03/04', 'ymd'), '2026-03-04');
});

// ---------------------------------------------------------------------------
// The words we use
// ---------------------------------------------------------------------------

test('the two-digit-year message does not name an action that will not work', () => {
  const message = dateAmbiguityMessage('twoDigitYear');
  // That file already uses one order clearly. The fix is a four-digit year.
  assert.doesNotMatch(message, /use one order/i);
  assert.match(message, /four-digit years/i);
});

test('each reason gets its own words', () => {
  assert.notEqual(dateAmbiguityMessage('order'), dateAmbiguityMessage('contradiction'));
  assert.notEqual(dateAmbiguityMessage('order'), dateAmbiguityMessage('twoDigitYear'));
  assert.equal(dateFormatLabel('dmy'), 'Day first');
  assert.equal(dateFormatLabel('mdy'), 'Month first');
  assert.equal(dateFormatLabel('ymd'), 'Year first');
});

// Appended session 103, while building the import screen. A column whose every
// value is numeric but readable by nothing ("13/13/2026") used to come back
// ambiguous with all three readings alive, and the reason inference read that
// surviving year-first reading as proof of two-digit years. The shooter was
// then shown a question about a column nothing could read, explained by a
// sentence that was false about their file, ending in advice to save it again
// with four-digit years it already had. Same shape as the two-digit-year remedy
// finding: a line naming an action that cannot help.
test('a column nothing can read is every row\'s problem, not a question about the file', () => {
  const result = analyseDateColumn(['13/13/2026', '14/15/2026']);
  assert.equal(result.ambiguous, false, 'there is nothing here to ask about');
  assert.equal(convertDateValue('13/13/2026', 'ymd'), null, 'each row reports itself instead');
  assert.equal(convertDateValue('14/15/2026', 'ymd'), null);
});

test('one unreadable value still leaves a genuinely ambiguous column asking', () => {
  const result = analyseDateColumn(['13/13/2026', '03/04/2026']);
  assert.equal(result.ambiguous, true, 'the readable value is what decides');
  if (result.ambiguous) assert.deepEqual(result.options, ['dmy', 'mdy']);
});
