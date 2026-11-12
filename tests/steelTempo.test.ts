import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_PEAK_SEC, MIN_TRANSITION_SEC, TEMPO_BANDS, beatTimes, stageTimeFor, tempoTargets, transitionSec, truncHundredths
} from '../src/lib/steelTempo.ts';
import { SCSA_PEAKS, SCSA_STAGES } from '../src/lib/scsaPeaks.ts';
import { classFor } from '../src/lib/competition.ts';

const row = (peak: number, counted: number, band: string) =>
  tempoTargets(peak, counted).find((t) => t.band === band)!;

test('the spec\'s worked case: Carry Optics, Smoke & Hope, Master is 2.94 s a string', () => {
  const m = row(SCSA_PEAKS['Carry Optics'][2], 4, 'M');
  assert.equal(m.stageSec, 11.76);
  assert.equal(m.perStringSec, 2.94);
});

// Hand-computed on paper, not by this code: peak / pct / strings, cut to hundredths.
test('hand-computed targets, three stages', () => {
  // Open, Five to Go, peak 11.25, 4 strings
  assert.deepEqual(tempoTargets(11.25, 4).map((t) => [t.band, t.stageSec, t.perStringSec]), [
    ['Peak', 11.25, 2.81], // 2.8125
    ['GM', 11.84, 2.96], // 11.8421 / 2.9605
    ['M', 13.23, 3.3], // 13.2352 / 3.3088
    ['A', 15, 3.75],
    ['B', 18.75, 4.68], // 4.6875
    ['C', 28.12, 7.03] // 28.125 / 7.0312
  ]);
  // Carry Optics, Smoke & Hope, peak 10, 4 strings
  assert.deepEqual(tempoTargets(10, 4).map((t) => [t.band, t.stageSec, t.perStringSec]), [
    ['Peak', 10, 2.5],
    ['GM', 10.52, 2.63], // 10.5263 / 2.6315
    ['M', 11.76, 2.94], // 11.7647 / 2.9411
    ['A', 13.33, 3.33],
    ['B', 16.66, 4.16],
    ['C', 25, 6.25]
  ]);
  // Rimfire Rifle Optics, Outer Limits, peak 10.75, THREE strings
  assert.deepEqual(tempoTargets(10.75, 3).map((t) => [t.band, t.stageSec, t.perStringSec]), [
    ['Peak', 10.75, 3.58], // 3.5833
    ['GM', 11.31, 3.77], // 11.3157 / 3.7719
    ['M', 12.64, 4.21], // 12.6470 / 4.2156
    ['A', 14.33, 4.77], // 14.3333 / 4.7777
    ['B', 17.91, 5.97], // 17.9166 / 5.9722
    ['C', 26.87, 8.95] // 26.875 / 8.9583
  ]);
});

test('Outer Limits divides by three, every other stage by four', () => {
  const peak = SCSA_PEAKS['Open'][3]; // 12.5
  assert.equal(row(peak, SCSA_STAGES[3].countedStrings, 'Peak').perStringSec, 4.16); // 12.5 / 3
  assert.equal(row(peak, 4, 'Peak').perStringSec, 3.12); // what a wrong divisor would show
});

// The property that matters to the shooter: holding the shown per-string time
// on every counted string EARNS the class on the row. Checked for every class,
// every stage, every division: 6 x 8 x 16 = 768 cases.
test('holding the shown time earns the class, on all 768 rows', () => {
  let n = 0;
  for (const [div, peaks] of Object.entries(SCSA_PEAKS)) {
    peaks.forEach((peak, i) => {
      const counted = SCSA_STAGES[i].countedStrings;
      for (const t of tempoTargets(peak, counted)) {
        const shot = t.perStringSec * counted;
        const pct = (100 * peak) / shot;
        assert.ok(pct >= t.pct - 1e-9, `${div} ${SCSA_STAGES[i].name} ${t.band}: ${pct}`);
        if (t.band !== 'Peak') assert.equal(classFor(pct), t.band, `${div} ${SCSA_STAGES[i].name}`);
        // and the target is not needlessly fast: within one hundredth a string
        assert.ok(peak / (t.pct / 100) - shot < 0.01 * counted + 1e-9);
        n++;
      }
    });
  }
  assert.equal(n, 768);
});

test('targets get slower down the table and never cross', () => {
  const t = tempoTargets(12.5, 4);
  assert.deepEqual(t.map((x) => x.band), TEMPO_BANDS.map((b) => b.name));
  for (let i = 1; i < t.length; i++) assert.ok(t[i].perStringSec > t[i - 1].perStringSec);
});

test('a time is cut, never rounded up, and float noise does not cost a hundredth', () => {
  assert.equal(truncHundredths(2.9451), 2.94);
  assert.equal(truncHundredths(2.999), 2.99);
  assert.equal(truncHundredths(0.1 + 0.2), 0.3); // 0.30000000000000004
  assert.equal(truncHundredths(2.9999999999), 3);
  assert.equal(truncHundredths(4.35), 4.35); // 4.35 * 100 = 434.99999999999994
  assert.equal(truncHundredths(25), 25);
});

test('beats: the first at the draw, the last exactly on the string time, even between', () => {
  const b = beatTimes(2.94, 1)!;
  assert.equal(b.length, 5); // four plates and the stop plate
  assert.equal(b[0], 1);
  assert.equal(b[4], 2.94);
  for (let i = 1; i < b.length; i++) assert.ok(Math.abs(b[i] - b[i - 1] - 0.485) < 1e-9);
  assert.ok(Math.abs(transitionSec(2.94, 1)! - 0.485) < 1e-9);
  // the spec's second figure: a 1.94 s draw leaves 0.25 s per transition
  assert.ok(Math.abs(transitionSec(2.94, 1.94)! - 0.25) < 1e-9);
});

test('the stop-plate beat is the string time itself, not four gaps added up', () => {
  // 0.06 + 4 x 0.1275 is 0.5700000000000001 in floating point.
  assert.equal(beatTimes(0.57, 0.06)![4], 0.57);
  assert.equal(beatTimes(3.33, 1.01)![4], 3.33);
});

test('changing the draw moves the middle beats and never the stop plate', () => {
  const a = beatTimes(3.33, 0.9)!, b = beatTimes(3.33, 1.6)!;
  assert.equal(a[4], 3.33);
  assert.equal(b[4], 3.33);
  assert.notEqual(a[2], b[2]);
});

test('a draw that leaves no time for four more shots is refused, not played', () => {
  assert.equal(beatTimes(2.94, 2.94), null);
  assert.equal(beatTimes(2.94, 3.5), null);
  assert.equal(beatTimes(2.94, 0), null);
  assert.equal(beatTimes(2.94, -1), null);
  assert.equal(beatTimes(2.94, NaN), null);
  assert.equal(beatTimes(NaN, 1), null);
  assert.equal(beatTimes(Infinity, 1), null);
  assert.equal(transitionSec(2.94, 3), null);
});

test('beats closer together than a tenth of a second are refused', () => {
  assert.equal(MIN_TRANSITION_SEC, 0.1);
  assert.equal(beatTimes(2.94, 2.93), null); // five beats inside 10 ms
  assert.equal(beatTimes(2.94, 2.9399999999999995), null);
  assert.equal(beatTimes(2.94, 2.55), null); // 0.0975 apart
  assert.equal(transitionSec(2.94, 2.55), null);
  const edge = beatTimes(2.94, 2.54)!; // exactly 0.1 apart: played
  assert.equal(edge.length, 5);
  assert.ok(Math.abs(edge[1] - edge[0] - 0.1) < 1e-9);
  // no two beats ever share a moment
  for (const [s, d] of [[2.5, 0.01], [2.94, 2.54], [11.45, 1], [0.57, 0.06]]) {
    const b = beatTimes(s, d)!;
    for (let i = 1; i < b.length; i++) assert.ok(b[i] - b[i - 1] >= 0.1 - 1e-9, `${s}/${d}`);
  }
});

test('an edited peak recomputes every row', () => {
  // Shooter's own figure of 9.5 in place of the official 10. On paper:
  // 9.5 / 0.95 = 10, /4 = 2.5 ; 9.5 / 0.85 = 11.1764, /4 = 2.7941 ; 9.5 / 0.4 = 23.75, /4 = 5.9375
  const edited = tempoTargets(9.5, 4);
  assert.deepEqual(edited.map((t) => [t.band, t.stageSec, t.perStringSec]), [
    ['Peak', 9.5, 2.37], ['GM', 10, 2.5], ['M', 11.17, 2.79],
    ['A', 12.66, 3.16], ['B', 15.83, 3.95], ['C', 23.75, 5.93]
  ]);
});

test('a typed peak too small to give six different honest rows gives none', () => {
  assert.equal(MIN_PEAK_SEC, 1);
  assert.deepEqual(tempoTargets(0.99, 4), []);
  assert.deepEqual(tempoTargets(0.01, 4), []);
  assert.deepEqual(tempoTargets(1e308, 4), []); // would be Infinity on the C row
  assert.equal(tempoTargets(1, 4).length, 6);
  // From the floor up, every row is a real, distinct time that earns its class.
  for (let cents = 100; cents <= 6000; cents++) {
    for (const counted of [3, 4]) {
      const t = tempoTargets(cents / 100, counted);
      assert.equal(t.length, 6);
      for (let i = 0; i < t.length; i++) {
        assert.ok(t[i].perStringSec > 0 && Number.isFinite(t[i].perStringSec));
        if (i) assert.ok(t[i].perStringSec > t[i - 1].perStringSec, `${cents} ${counted} ${t[i].band}`);
        assert.ok((100 * (cents / 100)) / (t[i].perStringSec * counted) >= t[i].pct - 1e-9);
      }
    }
  }
});

test('unusable input gives no rows rather than NaN on a screen', () => {
  assert.deepEqual(tempoTargets(0, 4), []);
  assert.deepEqual(tempoTargets(-5, 4), []);
  assert.deepEqual(tempoTargets(NaN, 4), []);
  assert.deepEqual(tempoTargets(Infinity, 4), []);
  assert.deepEqual(tempoTargets(10, 0), []);
  assert.deepEqual(tempoTargets(10, -4), []);
  assert.deepEqual(tempoTargets(10, 2.5), []);
  assert.equal(stageTimeFor(10, 0), null);
});
