// Steel Challenge (SCSA) scoring — time-only; string = raw + 3s/miss, capped at 30;
// stop-plate-missed = 30. A stage drops the single slowest string: best 4 of 5, and
// best 3 of 4 on Outer Limits. Match total = sum of stage times, lowest wins. Worked
// examples verified by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreSteelStage,
  steelMatchTotal,
  steelStringsExpected,
  scoringTypeFor,
  STEEL_MAX_STRING,
  STEEL_DIVISIONS,
} from '../src/lib/competition.ts';

test('STEEL_DIVISIONS is the official SCSA 2026-03 Appendix D list (+ Other)', () => {
  // Source: https://rules.uspsa.org/scsa/divisions (edition 2026-03, D1-D11), in
  // rulebook order. Guards a domain-critical, cited constant against accidental
  // edits. Steel is primarily a rimfire sport, so the list MUST carry the rimfire
  // divisions the USPSA DIVISIONS list omitted -- the whole point of finding H4.
  assert.deepEqual(STEEL_DIVISIONS, [
    'Open', 'Limited', 'Rimfire Pistol', 'Production', 'Single Stack',
    'Revolver', 'Carry Optics', 'Pistol Caliber Carbine', 'Rimfire Rifle',
    'Limited Optics', 'Rimfire Revolver', 'Other',
  ]);
  for (const d of ['Rimfire Pistol', 'Rimfire Rifle', 'Rimfire Revolver']) {
    assert.ok(STEEL_DIVISIONS.includes(d), `Steel list missing rimfire division: ${d}`);
  }
});

test('best 4 of 5: drops the single slowest string', () => {
  const s = scoreSteelStage({ strings: [3.21, 3.44, 3.6, 3.71, 4.9] });
  assert.equal(s.stageTime, 13.96); // 3.21 + 3.44 + 3.60 + 3.71
  assert.equal(s.droppedIndex, 4); // the 4.90 string
  assert.equal(s.stringsExpected, 5);
});

test('a miss adds 3s and can make a string the one dropped', () => {
  // String 0 raw 3.10 + 1 miss = 6.10 -> becomes the slowest -> dropped.
  const s = scoreSteelStage({
    strings: [3.1, 3.44, 3.6, 3.71, 3.8],
    stringMisses: [1, 0, 0, 0, 0],
  });
  assert.equal(s.strings[0].capped, 6.1);
  assert.equal(s.droppedIndex, 0);
  assert.equal(s.stageTime, 14.55); // 3.44 + 3.60 + 3.71 + 3.80
});

test('stop plate never hit scores the 30s max (and is the dropped string)', () => {
  const s = scoreSteelStage({
    strings: [3.2, 3.4, 3.6, 3.7, null],
    stringStopMissed: [false, false, false, false, true],
  });
  assert.equal(s.strings[4].capped, STEEL_MAX_STRING);
  assert.equal(s.droppedIndex, 4);
  assert.equal(s.stageTime, 13.9); // the four real strings
});

test('a string time is capped at 30s', () => {
  const s = scoreSteelStage({ strings: [29.5], stringMisses: [1] }); // 29.5 + 3 = 32.5 -> 30
  assert.equal(s.strings[0].capped, 30);
});

test('Outer Limits: 4 strings, best 3 count (the slowest is dropped)', () => {
  assert.equal(steelStringsExpected('Outer Limits'), 4); // 4 strings SHOT
  const s = scoreSteelStage({ steelStage: 'Outer Limits', strings: [4.0, 4.5, 5.0, 5.5] });
  assert.equal(s.droppedIndex, 3); // the 5.5 string (slowest) is dropped
  assert.equal(s.stageTime, 13.5); // best 3: 4.0 + 4.5 + 5.0
});

test('fewer than 5 strings entered on a 5-string stage keeps them all (nothing to drop)', () => {
  const s = scoreSteelStage({ strings: [3.0, 3.5, 4.0, 4.5] });
  assert.equal(s.droppedIndex, null);
  assert.equal(s.stageTime, 15.0);
});

test('nothing entered -> null stage time, no crash', () => {
  const s = scoreSteelStage({ strings: [null, null] });
  assert.equal(s.stageTime, null);
  assert.equal(scoreSteelStage({}).stageTime, null);
});

test('match total sums stage times (lowest wins)', () => {
  const total = steelMatchTotal([
    { strings: [3.21, 3.44, 3.6, 3.71, 4.9] }, // 13.96 (best 4 of 5)
    { steelStage: 'Outer Limits', strings: [4.0, 4.5, 5.0, 5.5] }, // 13.50 (best 3 of 4)
  ]);
  assert.equal(total, 27.46);
  assert.equal(steelMatchTotal([]), null);
});

test('scoringTypeFor maps match types', () => {
  assert.equal(scoringTypeFor('Steel Challenge'), 'steel');
  assert.equal(scoringTypeFor('IDPA Match'), 'idpa');
  assert.equal(scoringTypeFor('USPSA Level 1 (club match)'), 'uspsa');
});
