// Stage-scores importer -- unit tests (design doc / STAGE_SCORES_SPEC.md
// section 7). Runner: node --test, same as every other tests/*.test.ts.
//
// This file covers the rules one at a time with small, purpose-built Review
// pages (the same split practiscore-real-capture.test.ts describes: rule-by-
// rule here, one whole real page in tests/stageScores-real-capture.test.ts).
// Every fixture built here is fabricated -- no claim of being a real page --
// except where a test explicitly says it reuses a real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStagePaste, selectShooterRow, hitFactorsAgree, isDnfRow,
  humanStageNumber, zeroBasedStageIndex, detectStagePageSurface,
  type StageScoreContext,
} from '../src/lib/stageScores.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const REVIEW_TITLE = 'Stage Results - Review';
const REVIEW_HEADER = [
  'Name', 'Member#', 'Squad', 'Class', 'Category', 'Div', 'PF',
  'A', 'B', 'C', 'D', 'M', 'NS', 'Proc', 'AP', 'Time', 'Hit Factor', 'TOD',
];

/** Build a Review page's TAB-separated text from data rows (each an array
 *  of cell strings in REVIEW_HEADER's order). Mirrors a real capture's
 *  shape: title line, then header, with no blank line between them. */
function reviewPage(rows: string[][], header: string[] = REVIEW_HEADER): string {
  return [REVIEW_TITLE, header.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n');
}

/** One data row in REVIEW_HEADER's column order, with sane accepting
 *  defaults (Michael's real Stage 1 shape: 19A 6C 1M, Minor, 103 pts,
 *  103/52.02 = 1.9800) that a test overrides only the cells it cares about. */
function row(overrides: Partial<Record<
  'name' | 'member' | 'squad' | 'class' | 'category' | 'div' | 'pf'
  | 'a' | 'b' | 'c' | 'd' | 'm' | 'ns' | 'proc' | 'ap' | 'time' | 'hf' | 'tod',
  string
>> = {}): string[] {
  const base = {
    name: 'Test, Shooter', member: 'A100001', squad: '1', class: 'U', category: '',
    div: 'O', pf: 'Min', a: '19', b: '-', c: '6', d: '-', m: '1', ns: '-', proc: '-',
    ap: '-', time: '52.02', hf: '1.9800', tod: '08-02 11:07',
  };
  const v = { ...base, ...overrides };
  return [v.name, v.member, v.squad, v.class, v.category, v.div, v.pf,
    v.a, v.b, v.c, v.d, v.m, v.ns, v.proc, v.ap, v.time, v.hf, v.tod];
}

const ctxFor = (over: Partial<StageScoreContext> = {}): StageScoreContext => ({
  powerFactor: 'Minor',
  memberNumber: 'A100001',
  storedNames: ['Test, Shooter'],
  ...over,
});

// ---------------------------------------------------------------------------
// The basic accept path (also proves round-to-4-decimals is load-bearing:
// 103 / 52.02 is 1.980007689... in raw floating point, NOT bit-identical to
// the parsed printed "1.9800" -- this test only passes because both sides
// go through the same round-to-4-decimals comparison. Deleting that
// rounding sends this test red, which is exactly the sabotage-awareness
// this file is asked to prove.)
// ---------------------------------------------------------------------------

test('accepts a clean row: derives the printed hit factor exactly', () => {
  const text = reviewPage([row()]);
  const result = parseStagePaste(text, ctxFor());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.accepted.derived.stagePoints, 103);
  assert.equal(result.accepted.derived.hitFactor, 1.98);
  assert.equal(result.accepted.printedHitFactor, 1.98);
  assert.equal(result.accepted.time, 52.02);
  assert.deepEqual(result.accepted.hits, {
    alphas: 19, charlies: 6, deltas: 0, misses: 1, noShoots: 0, procedurals: 0,
  });
});

// ---------------------------------------------------------------------------
// The honesty gate: a doctored mismatch, and an unparseable printed cell
// ---------------------------------------------------------------------------

test('refuses when the printed hit factor disagrees with the derivation (doctored)', () => {
  // Same hits/time as the clean accept above; only the printed HF cell is
  // changed to a value the real derivation (1.98) cannot reproduce.
  const text = reviewPage([row({ hf: '9.9999' })]);
  const result = parseStagePaste(text, ctxFor());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'hf-mismatch');
  if (result.code !== 'hf-mismatch') return;
  assert.equal(result.derived.hitFactor, 1.98);
  assert.equal(result.printedHitFactor, 9.9999);
});

test('refuses an unparseable printed HF cell rather than skipping the check', () => {
  // Every OTHER stat cell carries a real value (so this is NOT the all-dash
  // DNF shape) -- only the Hit Factor cell itself is unreadable.
  for (const hf of ['-', '', '  ']) {
    const text = reviewPage([row({ hf })]);
    const result = parseStagePaste(text, ctxFor());
    assert.equal(result.ok, false, `hf=${JSON.stringify(hf)} must refuse`);
    if (result.ok) continue;
    assert.equal(result.code, 'unparseable-hf', `hf=${JSON.stringify(hf)}`);
  }
});

// ---------------------------------------------------------------------------
// Synthetic B>0 and AP>0 rows -- neither is modelled by the app's scorer, so
// a printed HF that reflects them can never be reproduced (spec section 6a
// Seat 12 condition 10: USPSA cardboard has never had a B zone; AP is the
// range officer's additional penalty, also unmodelled).
// ---------------------------------------------------------------------------

test('a B-zone (bravo) hit refuses: the scorer does not model B', () => {
  // Same A/C/D/M as the clean accept (which derives 1.98); B=5 added, and
  // the printed HF bumped up as a real page would show once B counts for
  // something the app's own derivation never sees.
  const text = reviewPage([row({ b: '5', hf: '2.3500' })]);
  const result = parseStagePaste(text, ctxFor());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'hf-mismatch');
  if (result.code !== 'hf-mismatch') return;
  // The derivation is UNCHANGED by B -- proof the scorer truly ignores it
  // rather than silently reading the wrong column.
  assert.equal(result.derived.hitFactor, 1.98);
});

test('an AP (additional penalty) value refuses: the scorer does not model AP', () => {
  const text = reviewPage([row({ ap: '5', hf: '1.5000' })]);
  const result = parseStagePaste(text, ctxFor());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'hf-mismatch');
  if (result.code !== 'hf-mismatch') return;
  assert.equal(result.derived.hitFactor, 1.98);
});

// ---------------------------------------------------------------------------
// All-dash DNF: its own branch, checked before dash-reads-as-zero, and never
// handed to the scorer as zeros.
// ---------------------------------------------------------------------------

test('an all-dash row (including Time) is DNF -- never zeros into the scorer', () => {
  const text = reviewPage([row({
    a: '-', b: '-', c: '-', d: '-', m: '-', ns: '-', proc: '-', ap: '-',
    time: '-', hf: '-',
  })]);
  const result = parseStagePaste(text, ctxFor());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'dnf');
  // The refusal variant structurally carries no row/derived data at all --
  // there is nothing here that COULD leak a zero-filled score even by
  // accident; see the type of the 'dnf' branch in StageScoreResult.
  assert.deepEqual(Object.keys(result), ['ok', 'code']);
});

test('isDnfRow reflects the row parsed off an all-dash line, and only that shape', () => {
  // Two shooters on the same page: one all-dash (DNF), one a clean accept.
  // selectShooterRow's own 'found' branch is what hands parseStagePaste (and
  // this test) a real StageReviewRow to ask isDnfRow about.
  const withDecoy = reviewPage([
    row({ name: 'Decoy, One', member: 'A900001' }),
    row({
      name: 'Dnf, Shooter', member: 'A900002',
      a: '-', b: '-', c: '-', d: '-', m: '-', ns: '-', proc: '-', ap: '-',
      time: '-', hf: '-',
    }),
  ]);
  const dnfResult = parseStagePaste(withDecoy, ctxFor({ memberNumber: 'A900002', storedNames: ['Dnf, Shooter'] }));
  assert.equal(dnfResult.ok, false);
  if (dnfResult.ok === false) assert.equal(dnfResult.code, 'dnf');

  const okResult = parseStagePaste(withDecoy, ctxFor({ memberNumber: 'A900001', storedNames: ['Decoy, One'] }));
  assert.equal(okResult.ok, true);
  if (okResult.ok) assert.equal(isDnfRow(okResult.accepted.row), false);
});

// ---------------------------------------------------------------------------
// [N] edit-marker stripping
// ---------------------------------------------------------------------------

test('a trailing [N] edit marker is stripped from TOD and never breaks parsing', () => {
  const text = reviewPage([row({ tod: '08-02 11:07 [1]' })]);
  const result = parseStagePaste(text, ctxFor());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.accepted.row.timeOfDay, '08-02 11:07');
  assert.equal(result.accepted.row.edited, true);
  // The marker sat on the SAME line as every number this stage was scored
  // from; stripping it must not have disturbed any of them.
  assert.equal(result.accepted.derived.hitFactor, 1.98);
});

test('a row with no edit marker reports edited: false', () => {
  const text = reviewPage([row()]);
  const result = parseStagePaste(text, ctxFor());
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.accepted.row.edited, false);
});

// ---------------------------------------------------------------------------
// Member#: '0' and blank both mean "no number" -> fall back to name; mixed
// case is honoured on a real match.
// ---------------------------------------------------------------------------

test('Member# literal "0" on the row falls back to name matching', () => {
  const text = reviewPage([row({ member: '0' })]);
  // ctx's own stored number matches nothing on the page -- if the '0' row
  // were wrongly treated as a real number, this would still fail to match
  // it; the only way this passes is via the name.
  const result = parseStagePaste(text, ctxFor({ memberNumber: 'A999999' }));
  assert.equal(result.ok, true);
});

test('Member# blank on the row falls back to name matching', () => {
  const text = reviewPage([row({ member: '' })]);
  const result = parseStagePaste(text, ctxFor({ memberNumber: 'A999999' }));
  assert.equal(result.ok, true);
});

test('mixed-case member numbers still match (a100001 vs A100001)', () => {
  const text = reviewPage([row({ member: 'a100001' })]);
  const result = parseStagePaste(text, ctxFor({ memberNumber: 'A100001', storedNames: [] }));
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// Name collision: two rows match -> BOTH candidates surfaced, never a pick
// ---------------------------------------------------------------------------

test('two rows sharing a stored name is a collision -- both candidates surfaced', () => {
  const text = reviewPage([
    row({ name: 'Doe, Jordan', member: 'A700001' }),
    row({ name: 'Doe, Jordan', member: 'A700002', hf: '1.5000' }),
  ]);
  const result = parseStagePaste(text, ctxFor({ memberNumber: undefined, storedNames: ['Doe, Jordan'] }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'name-collision');
  if (result.code !== 'name-collision') return;
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates.map((c) => c.memberNumber).sort(), ['A700001', 'A700002']);
});

test('a stored member number that matches two rows is also a collision, never the first', () => {
  const text = reviewPage([
    row({ name: 'Alpha, One', member: 'A800001' }),
    row({ name: 'Beta, Two', member: 'A800001', hf: '1.5000' }),
  ]);
  const result = parseStagePaste(text, ctxFor({ memberNumber: 'A800001', storedNames: [] }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'name-collision');
});

test('no matching row at all is shooter-not-found, not a silent pick', () => {
  const text = reviewPage([row({ name: 'Nobody, Here', member: 'A600001' })]);
  const result = parseStagePaste(text, ctxFor({ memberNumber: 'Z999999', storedNames: ['Someone, Else'] }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'shooter-not-found');
});

// ---------------------------------------------------------------------------
// Unknown / mutated header
// ---------------------------------------------------------------------------

test('a mutated header (A renamed to Alpha) refuses as unknown-header, guesses nothing', () => {
  const mutated = REVIEW_HEADER.map((h) => (h === 'A' ? 'Alpha' : h));
  const text = reviewPage([row()], mutated);
  const result = parseStagePaste(text, ctxFor());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'unknown-header');
});

test('a header missing the AP column entirely refuses as unknown-header', () => {
  const apIdx = REVIEW_HEADER.indexOf('AP');
  const mutatedHeader = REVIEW_HEADER.filter((_, i) => i !== apIdx);
  const dataRow = row();
  const mutatedRow = dataRow.filter((_, i) => i !== apIdx);
  const text = reviewPage([mutatedRow], mutatedHeader);
  const result = parseStagePaste(text, ctxFor());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'unknown-header');
});

test('garbage text with no recognisable header at all refuses as unknown-header', () => {
  const text = 'This is a paragraph of ordinary prose.\nIt mentions no results table.\n';
  const result = parseStagePaste(text, ctxFor());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'unknown-header');
  assert.equal(detectStagePageSurface(text), 'unknown');
});

test('empty text refuses as unknown-header rather than throwing', () => {
  const result = parseStagePaste('', ctxFor());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'unknown-header');
});

// ---------------------------------------------------------------------------
// Wrong-surface detection (synthetic pages, both directions)
// ---------------------------------------------------------------------------

test('a stage-level Combined page is detected and routed, not parsed as Review', () => {
  const combinedText = [
    'Stage Results - Combined',
    ['Place', 'Name', 'No.', 'Class', 'Div', 'PF', 'Points', 'Pen', 'Time', 'Hit Factor', 'Stage Pts', 'Stage %'].join('\t'),
    ['1', 'Test, Shooter', 'A100001', 'U', 'O', 'Min', '103', '10', '52.02', '1.9800', '113.0000', '100.00%'].join('\t'),
  ].join('\n');
  assert.equal(detectStagePageSurface(combinedText), 'combined');
  const result = parseStagePaste(combinedText, ctxFor());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'wrong-surface-combined');
});

test('the overall match-results page is detected and routed, not parsed as Review', () => {
  const overallText = [
    'Some Match - 2026-08-02',
    ['Place', 'Name', 'No.', 'Class', 'Div', 'PF', 'Category', 'Match Pts', 'Match %'].join('\t'),
    ['1', 'Test, Shooter', 'A100001', 'U', 'O', 'Min', '', '830.6178', '100.00%'].join('\t'),
  ].join('\n');
  assert.equal(detectStagePageSurface(overallText), 'overall');
  const result = parseStagePaste(overallText, ctxFor());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'wrong-surface-overall');
});

test('a wrong-surface page that shows the target shooter as (DQ) reports dq-absent', () => {
  const combinedText = [
    'Stage Results - Combined',
    ['Place', 'Name', 'No.', 'Class', 'Div', 'PF', 'Points', 'Pen', 'Time', 'Hit Factor', 'Stage Pts', 'Stage %'].join('\t'),
    ['1', '(DQ) Test, Shooter', 'A100001', 'U', 'O', 'Min', '', '', '', '', '', ''].join('\t'),
  ].join('\n');
  const result = parseStagePaste(combinedText, ctxFor());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'dq-absent');
  if (result.code !== 'dq-absent') return;
  assert.equal(result.name, 'Test, Shooter');
});

test('a Combined page pasted for a DIFFERENT shooter (not DQd) is the plain wrong-surface refusal', () => {
  const combinedText = [
    'Stage Results - Combined',
    ['Place', 'Name', 'No.', 'Class', 'Div', 'PF', 'Points', 'Pen', 'Time', 'Hit Factor', 'Stage Pts', 'Stage %'].join('\t'),
    ['1', '(DQ) Someone, Else', 'A999999', 'U', 'O', 'Min', '', '', '', '', '', ''].join('\t'),
  ].join('\n');
  const result = parseStagePaste(combinedText, ctxFor());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'wrong-surface-combined');
});

// ---------------------------------------------------------------------------
// Zero-based stage-index <-> human stage-number mapping
// ---------------------------------------------------------------------------

test('humanStageNumber: stage0 is Stage 1, stage6 is Stage 7', () => {
  assert.equal(humanStageNumber(0), 1);
  assert.equal(humanStageNumber(6), 7);
  assert.equal(humanStageNumber(-1), null);
  assert.equal(humanStageNumber(1.5), null);
});

test('zeroBasedStageIndex is the inverse of humanStageNumber', () => {
  assert.equal(zeroBasedStageIndex(1), 0);
  assert.equal(zeroBasedStageIndex(7), 6);
  assert.equal(zeroBasedStageIndex(0), null);
  assert.equal(zeroBasedStageIndex(0.5), null);
  for (const n of [1, 2, 3, 7, 12]) {
    const zb = zeroBasedStageIndex(n);
    assert.ok(zb !== null);
    assert.equal(humanStageNumber(zb as number), n);
  }
});

// ---------------------------------------------------------------------------
// hitFactorsAgree: the comparison contract directly (round-to-4-decimals,
// -0 normalised, either side missing -> false, never a guessed pass)
// ---------------------------------------------------------------------------

test('hitFactorsAgree: exact match at 4 decimals', () => {
  assert.equal(hitFactorsAgree(1.98, 1.98), true);
  assert.equal(hitFactorsAgree(1.980007689, 1.98), true, 'both round to 1.9800');
  assert.equal(hitFactorsAgree(1.9805, 1.98), false);
});

test('hitFactorsAgree: -0 normalises to 0', () => {
  assert.equal(hitFactorsAgree(-0, 0), true);
  assert.equal(hitFactorsAgree(0, -0), true);
});

test('hitFactorsAgree: either side missing is false, never a guessed pass', () => {
  assert.equal(hitFactorsAgree(null, 1.98), false);
  assert.equal(hitFactorsAgree(1.98, null), false);
  assert.equal(hitFactorsAgree(null, null), false);
});

// ---------------------------------------------------------------------------
// selectShooterRow directly (member number first, name second)
// ---------------------------------------------------------------------------

test('selectShooterRow: member number wins over an absent/blank name match', () => {
  const text = reviewPage([
    row({ name: 'Real, Name', member: 'A500001' }),
    row({ name: 'Also, Matches', member: 'A500002', hf: '1.5000' }),
  ]);
  const result = parseStagePaste(text, ctxFor({ memberNumber: 'A500001', storedNames: ['Also, Matches'] }));
  // The stored NAME would match the second row, but the stored NUMBER
  // uniquely matches the first -- member number is checked first and wins.
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.accepted.row.name, 'Real, Name');
});

test('selectShooterRow: an empty rows list is not-found, not a crash', () => {
  const result = selectShooterRow([], 'A100001', ['Test, Shooter']);
  assert.equal(result.kind, 'not-found');
});
